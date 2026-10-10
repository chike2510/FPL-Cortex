// Draft add-on (reachable from Profile): Draft league standings and a manager's squad.
import { html, render, toast, $ } from '../lib/dom.js';
import { settings, saveSettings } from '../lib/store.js';

const draftGet = (route, params = '') => fetch(`/api/fpl?route=${route}${params}`).then(r => r.json());

export async function mount(view) {
  render(view, html`<div class="card"><span class="eyebrow">Add-on</span><h2>FPL Draft</h2><p class="muted">Enter your Draft league ID (from draft.premierleague.com/league/<b>ID</b>).</p>
    <form class="inline-form" id="dForm"><input id="dLeague" inputmode="numeric" placeholder="Draft league ID" value="${settings.draftLeague || ''}"><button class="btn primary" type="submit">Load</button></form></div><div id="dBody"></div>`);
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
  render(body, html`<div class="card"><h3>${d.data.league?.name}</h3><div class="list">${(d.data.standings || []).map(s => { const e = names.get(s.league_entry); return html`<button class="row-card" type="button" data-entry="${e?.entry_id}"><span class="row-kit">${s.rank}</span><span class="row-main"><strong>${e?.entry_name}</strong><small>${e?.player_first_name} ${e?.player_last_name} · GW ${s.event_total}</small></span><span></span><span class="row-stat"><b>${s.total}</b><small>pts</small></span></button>`; })}</div></div><div id="dSquad"></div>`);
  body.querySelectorAll('[data-entry]').forEach(b => b.addEventListener('click', async () => {
    const r = await draftGet('draft-entry-public', `&entryId=${b.dataset.entry}`);
    if (!r.ok) return toast('Squad unavailable');
    const picks = r.data?.picks || r.data?.entry?.picks || [];
    render($('#dSquad', view), html`<div class="card"><h3>${r.data?.entry?.name || 'Squad'}</h3>${picks.length ? html`<div class="chips wrap">${picks.map(p => html`<span class="chip">${players.get(p.element) || p.element}</span>`)}</div>` : html`<p class="muted">Squad is hidden until the next deadline.</p>`}</div>`);
  }));
}
