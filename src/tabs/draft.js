// Draft add-on (reachable from Profile): Draft league standings and a manager's squad.
import { html, render, toast, $ } from '../lib/dom.js';
import { settings, saveSettings, getModel } from '../lib/store.js';

const draftGet = (route, params = '') => fetch(`/api/fpl?route=${route}${params}`).then(r => r.json());

export async function mount(view) {
  render(view, html`<div class="card"><span class="eyebrow">Add-on</span><h2>FPL Draft</h2><p class="muted">Enter your Draft league ID (from draft.premierleague.com/league/<b>ID</b>).</p>
    <form class="inline-form" id="dForm"><input id="dLeague" inputmode="numeric" placeholder="Draft league ID" value="${settings.draftLeague || ''}"><button class="btn primary" type="submit">Load</button></form></div><div id="dBody"></div><div class="card"><div class="card-head"><h3>Mock draft</h3><span class="muted">practice vs 7 bots</span></div><p class="muted small">Snake draft, 15 rounds, squad limits 2 GK · 5 DEF · 5 MID · 3 FWD.</p><button class="btn pill" type="button" id="mockBtn">Start a mock draft →</button><div id="mock"></div></div>`);
  $('#mockBtn', view).addEventListener('click', () => mock(view));
  $('#dForm', view).addEventListener('submit', e => { e.preventDefault(); saveSettings({ draftLeague: $('#dLeague', view).value.replace(/\D/g, '') }); load(view); });
  if (settings.draftLeague) load(view);
}

async function load(view) {
  const body = $('#dBody', view);
  render(body, html`<div class="sk"></div>`);
  const [d, boot] = await Promise.all([draftGet('draft-league-details', `&leagueId=${settings.draftLeague}`), draftGet('draft-bootstrap')]);
  if (!d.ok) { render(body, html`<div class="card"><p class="muted">League not found.</p></div>`); return; }
  const names = new Map((d.data.league_entries || []).map(e => [e.id, e]));
  const players = new Map((boot.data?.elements || []).map(p => [p.id, p.web_name]));
  render(body, html`<div class="card"><h3>${d.data.league?.name}</h3><div class="list">${(d.data.standings || []).map(s => { const e = names.get(s.league_entry); return html`<button class="row-card" type="button" data-entry="${e?.entry_id}"><span class="row-kit">${s.rank}</span><span class="row-main"><strong>${e?.entry_name}</strong><small>${e?.player_first_name} ${e?.player_last_name} · GW ${s.event_total}</small></span><span class="row-stat"><b>${s.total}</b><small>pts</small></span></button>`; })}</div></div><div id="dSquad"></div>`);
  body.querySelectorAll('[data-entry]').forEach(b => b.addEventListener('click', async () => {
    const r = await draftGet('draft-entry-public', `&entryId=${b.dataset.entry}`);
    if (!r.ok) return toast('Squad unavailable');
    const picks = r.data?.picks || r.data?.entry?.picks || [];
    render($('#dSquad', view), html`<div class="card"><h3>${r.data?.entry?.name || 'Squad'}</h3>${picks.length ? html`<div class="chips wrap">${picks.map(p => html`<span class="chip">${players.get(p.element) || p.element}</span>`)}</div>` : html`<p class="muted">Squad is hidden until the next deadline.</p>`}</div>`);
  }));
}

const QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 };
async function mock(view) {
  const model = await getModel();
  const N = 8, me = Math.floor(Math.random() * N), teams = Array.from({ length: N }, () => []);
  const taken = new Set(); const score = p => p.total_points * .6 + p.xp * 4 + p.form * 2;
  const pool = [...model.players].sort((a, b) => score(b) - score(a));
  const fits = (t, p) => teams[t].filter(x => x.element_type === p.element_type).length < QUOTA[p.element_type];
  let pick = 0, q = '';
  const turn = () => { const r = Math.floor(pick / N), i = pick % N; return r % 2 ? N - 1 - i : i; };
  const advance = () => { while (pick < N * 15 && turn() !== me) { const t = turn(); const p = pool.find(x => !taken.has(x.id) && fits(t, x)); if (p) { taken.add(p.id); teams[t].push(p); } pick++; } draw(); };
  const draw = () => {
    const done = pick >= N * 15;
    const avail = pool.filter(p => !taken.has(p.id) && fits(me, p) && (!q || `${p.web_name} ${p.teamShort} ${p.pos}`.toLowerCase().includes(q))).slice(0, 12);
    render($('#mock', view), html`<p class="small">${done ? html`<b>Draft complete.</b> Your squad projects <b class="accent">${teams[me].reduce((s, p) => s + p.xp, 0).toFixed(1)}</b> xP next GW (bots avg ${(teams.filter((_, i) => i !== me).reduce((s, t) => s + t.reduce((a, p) => a + p.xp, 0), 0) / (N - 1)).toFixed(1)}).` : html`Pick <b>${pick + 1}</b> of ${N * 15} · you are slot ${me + 1} · your turn`}</p>
      <div class="chips wrap">${teams[me].map(p => html`<span class="chip">${p.pos} ${p.web_name}</span>`)}</div>
      ${done ? '' : html`<input type="search" id="mq" placeholder="Search available players" value="${q}" aria-label="Search available players"><div class="list">${avail.map(p => html`<button class="row-card" type="button" data-mp="${p.id}"><span class="row-kit">${p.pos}</span><span class="row-main"><strong>${p.web_name}</strong><small>${p.teamShort} · ${p.total_points} pts · form ${p.form.toFixed(1)}</small></span><span class="row-stat"><b>${p.xp.toFixed(1)}</b><small>xP</small></span></button>`)}</div>`}`);
    view.querySelectorAll('[data-mp]').forEach(b => b.addEventListener('click', () => { const p = model.byId.get(Number(b.dataset.mp)); taken.add(p.id); teams[me].push(p); pick++; q = ''; advance(); }));
    $('#mq', view)?.addEventListener('change', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  };
  advance();
}
