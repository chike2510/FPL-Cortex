// Team search: type a team name, manager name, Team ID or paste an FPL link. No FPL password, ever.
// Server route /api/fpl?route=team-search (fplbot entry index → live FPL enrich; IDs/links resolve directly).
import { html, render, toast, fmtNum } from '../lib/dom.js';
import { saveSettings } from '../lib/store.js';
import { teamSearch, leagueManagers } from '../lib/api.js';

const idOf = q => (q.match(/entry\/(\d{1,9})/i) || q.match(/^\s*#?(\d{1,9})\s*$/) || [])[1];

export const teamSearchBox = ({ id = 'ts', placeholder = 'Team name, manager or Team ID', value = '', button = 'Go' } = {}) => html`<div class="ts-wrap" data-ts="${id}">
  <form class="inline-form" id="${id}Form"><input id="${id}Input" type="search" inputmode="search" autocomplete="off" enterkeyhint="search" placeholder="${placeholder}" value="${value}" aria-label="Search FPL team by name, manager or Team ID"><button class="btn primary" type="submit">${button}</button></form>
  <div id="${id}Results" class="ts-results" aria-live="polite"></div></div>`;

const row = t => html`<button class="row-card" type="button" data-id="${t.id}"><span class="row-kit">◫</span><span class="row-main"><strong>${t.teamName}</strong><small>${t.realName}${t.league ? ' · ' + t.league : t.country ? ' · ' + t.country : ''}</small></span><span class="row-stat"><b>${t.overallRank ? fmtNum(t.overallRank) : '—'}</b><small>ID ${t.id}</small></span></button>`;

export function bindTeamSearch(root, id, onPick) {
  const form = root.querySelector(`#${id}Form`); if (!form) return;
  const input = root.querySelector(`#${id}Input`), out = root.querySelector(`#${id}Results`);
  let timer, ctrl, last = '';
  const show = (results, note) => {
    render(out, results.length ? html`${results.length ? html`<div class="result-bar"><span class="eyebrow">Teams</span><span class="faint small">overall rank</span></div>` : ''}${results.map(row)}${note ? html`<p class="faint small">${note}</p>` : ''}` : html`<p class="muted small">${note || 'No teams found. Try your exact team name, or paste your FPL link / Team ID.'}</p>`);
    out.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => onPick(Number(b.dataset.id))));
  };
  const run = async (q, submit) => {
    q = q.trim(); if (q === last && !submit) return; last = q;
    ctrl?.abort();
    if (!q) return render(out, '');
    const direct = idOf(q);
    if (!direct && q.length < 3) return render(out, html`<p class="faint small">Keep typing…</p>`);
    ctrl = new AbortController();
    render(out, html`<p class="muted small">Searching…</p>`);
    const r = await teamSearch(q, ctrl.signal);
    if (r === null) return; // superseded
    let results = r.results || [];
    let note = '';
    if (!results.length && !direct) {
      const local = leagueManagers(q);
      if (local.length) { results = local; note = 'From leagues you have opened.'; }
    }
    if (r.ok === false && !results.length) note = direct ? 'Could not reach FPL. Try again in a moment.' : 'Name search is unavailable right now. Paste your FPL link or Team ID instead.';
    if (submit && direct && results.length === 1) return onPick(results[0].id);
    show(results, note);
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 350); });
  form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); const d = idOf(input.value); if (d && !input.value.match(/[a-z]{3,}/i)) return onPick(Number(d)); run(input.value, true); });
}

export const onboardCard = () => html`<div class="card onboard">
  <span class="eyebrow">Get started</span><h2>Add your FPL team</h2>
  <p class="muted">Search your team or manager name, or enter your Team ID. Cortex only reads public FPL data, so it never needs your FPL password.</p>
  ${teamSearchBox({ id: 'ob' })}
  <details class="muted"><summary>Where's my Team ID?</summary><p>On the official FPL site open <b>Points</b>; the number in the address bar after <code>/entry/</code> is your Team ID. You can paste the whole link here.</p></details>
</div>`;

export function bindOnboard(root, onDone) {
  bindTeamSearch(root, 'ob', id => { saveSettings({ entryId: id }); toast('Team added'); onDone?.(); });
}
