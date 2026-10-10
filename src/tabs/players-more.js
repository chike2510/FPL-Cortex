// Players > Fixtures (GW fixture list, FDR calendar, team form) and Players > Compare. Lazy-loaded.
import { html, render, money, toast, $ } from '../lib/dom.js';
import { fpl } from '../lib/api.js';
import { openPlayer } from '../ui/playerSheet.js';

let gwSel = null, span = 6;

export async function fixtures(body, model, entry) {
  const all = await fpl('fixtures/', 120);
  gwSel ||= model.startGW;
  const T = id => model.teams[id]?.short_name || '?';
  const mine = new Set((entry?.ids || []).map(id => model.byId.get(id)?.team));
  const draw = () => {
    const list = all.filter(f => f.event === gwSel).sort((a, b) => String(a.kickoff_time).localeCompare(String(b.kickoff_time)));
    const gws = Array.from({ length: span }, (_, i) => model.startGW + i);
    const teams = Object.values(model.teams).map(t => ({ t, cells: gws.map(gw => model.gwFixtures(t.id, gw)) }))
      .map(r => ({ ...r, score: r.cells.reduce((s, c) => s + (c.length ? c.reduce((a, f) => a + f.difficulty, 0) / c.length - (c.length - 1) : 5), 0) })).sort((a, b) => a.score - b.score);
    const form = Object.values(model.teams).map(t => {
      const last = all.filter(f => f.finished && (f.team_h === t.id || f.team_a === t.id)).sort((a, b) => a.event - b.event).slice(-5);
      let pts = 0, gd = 0; const res = last.map(f => { const h = f.team_h === t.id, gf = h ? f.team_h_score : f.team_a_score, ga = h ? f.team_a_score : f.team_h_score; gd += gf - ga; const r = gf > ga ? 'W' : gf === ga ? 'D' : 'L'; pts += r === 'W' ? 3 : r === 'D' ? 1 : 0; return r; });
      return { t, res, pts, gd };
    }).sort((a, b) => b.pts - a.pts || b.gd - a.gd);
    render(body, html`
      <div class="card"><div class="card-head"><button class="btn pill small" type="button" data-gw="-1" aria-label="Previous gameweek">‹</button><h3>Gameweek ${gwSel}</h3><button class="btn pill small" type="button" data-gw="1" aria-label="Next gameweek">›</button></div>
        <div class="list">${list.length ? list.map(f => html`<div class="live-row fx"><span><strong class="${mine.has(f.team_h) ? 'accent' : ''}">${T(f.team_h)}</strong> v <strong class="${mine.has(f.team_a) ? 'accent' : ''}">${T(f.team_a)}</strong></span><span class="muted small">${f.kickoff_time ? new Date(f.kickoff_time).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'TBC'}</span><b>${f.started ? `${f.team_h_score ?? 0}–${f.team_a_score ?? 0}` : html`<span class="fdr fdr-${f.team_h_difficulty}">${f.team_h_difficulty}</span>`}</b></div>`) : html`<p class="muted">No fixtures.</p>`}</div></div>
      <div class="card"><div class="card-head"><h3>Fixture difficulty</h3><div class="chips">${[3, 6, 8].map(n => html`<button class="chip ${span === n ? 'on' : ''}" type="button" data-span="${n}">${n} GWs</button>`)}</div></div>
        <div class="scroll-x"><table class="table fdr-table"><thead><tr><th>Team</th>${gws.map(g => html`<th>GW${g}</th>`)}</tr></thead><tbody>${teams.map(r => html`<tr><td><b class="${mine.has(r.t.id) ? 'accent' : ''}">${r.t.short_name}</b></td>${r.cells.map(c => html`<td>${c.length ? c.map(f => html`<span class="fdr fdr-${f.difficulty}">${f.home ? f.opponent : f.opponent.toLowerCase()}</span>`) : html`<span class="fdr">—</span>`}</td>`)}</tr>`)}</tbody></table></div><p class="faint small">Easiest run first · doubles count as a bonus · upper case = home.</p></div>
      <div class="card"><div class="card-head"><h3>Team form</h3><span class="muted">last 5</span></div><div class="list">${form.map(r => html`<div class="live-row"><span><strong>${r.t.short_name}</strong> <span class="form-dots">${r.res.map(x => html`<i class="r-${x}">${x}</i>`)}</span></span><span class="muted small">GD ${r.gd > 0 ? '+' : ''}${r.gd}</span><b>${r.pts}</b></div>`)}</div></div>`);
    body.querySelectorAll('[data-gw]').forEach(b => b.addEventListener('click', () => { gwSel = Math.max(1, Math.min(38, gwSel + Number(b.dataset.gw))); draw(); }));
    body.querySelectorAll('[data-span]').forEach(b => b.addEventListener('click', () => { span = Number(b.dataset.span); draw(); }));
  };
  draw();
}

const picks = [];
export function compare(body, model) {
  const find = q => { q = q.trim().toLowerCase(); if (!q) return null; return model.players.find(p => p.web_name.toLowerCase() === q) || model.players.filter(p => `${p.web_name} ${p.first_name} ${p.second_name}`.toLowerCase().includes(q)).sort((a, b) => b.total_points - a.total_points)[0] || null; };
  const rows = [['Team', p => p.teamShort], ['Price', p => money(p.price), p => -p.price], ['xP next', p => p.xp.toFixed(1), p => p.xp], ['xP next 5', p => model.horizon(p, 5).reduce((s, g) => s + g.xp, 0).toFixed(1), p => model.horizon(p, 5).reduce((s, g) => s + g.xp, 0)],
    ['Form', p => p.form.toFixed(1), p => p.form], ['Total pts', p => p.total_points, p => p.total_points], ['xG / 90', p => p.xg90.toFixed(2), p => p.xg90], ['xA / 90', p => p.xa90.toFixed(2), p => p.xa90], ['ICT', p => p.ict.toFixed(1), p => p.ict], ['Minutes', p => p.minutes, p => p.minutes], ['Owned', p => `${p.selected}%`], ['Next 3', p => p.upcoming.map(f => f.home ? f.opponent : f.opponent.toLowerCase()).join(' '), p => -p.avgFDR]];
  const draw = () => {
    const ps = picks.map(id => model.byId.get(id)).filter(Boolean);
    render($('#cmpOut', body), ps.length < 2 ? html`${ps.map(p => html`<span class="chip on">${p.web_name}</span> `)}<p class="muted">Add ${ps.length ? 'one or two more' : 'two or three players'} to compare.</p>` : html`<div class="scroll-x"><table class="table cmp"><thead><tr><th></th>${ps.map((p, i) => html`<th><button class="linkish" type="button" data-pid="${p.id}">${p.web_name}</button> <button class="linkish faint" type="button" data-rm="${i}" aria-label="Remove ${p.web_name}">✕</button></th>`)}</tr></thead><tbody>${rows.map(([l, f, n]) => { const best = n ? Math.max(...ps.map(n)) : null; return html`<tr><td class="muted">${l}</td>${ps.map(p => html`<td class="${n && n(p) === best ? 'accent' : ''}">${f(p)}</td>`)}</tr>`; })}</tbody></table></div><a class="btn pill" href="#ask" id="cmpAsk">Ask Cortex which to pick →</a>`);
    body.querySelectorAll('#cmpOut [data-pid]').forEach(b => b.addEventListener('click', () => openPlayer(model, b.dataset.pid)));
    body.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { picks.splice(Number(b.dataset.rm), 1); draw(); }));
    $('#cmpAsk', body)?.addEventListener('click', () => sessionStorage.setItem('cortex_ask_prefill', `Compare ${ps.map(p => p.web_name).join(' vs ')} over the next 5 gameweeks. Who should I pick?`));
  };
  render(body, html`<div class="card"><span class="eyebrow">Compare players</span><form class="inline-form" id="cmpForm"><input id="cmpIn" list="cmpList" placeholder="Add a player (up to 3)" aria-label="Player to compare"><button class="btn primary" type="submit">Add</button></form><datalist id="cmpList">${[...model.players].sort((a, b) => b.total_points - a.total_points).slice(0, 300).map(p => html`<option value="${p.web_name}">`)}</datalist><div id="cmpOut"></div></div>`);
  $('#cmpForm', body).addEventListener('submit', e => { e.preventDefault(); const p = find($('#cmpIn', body).value); if (!p) return toast('Player not found'); if (!picks.includes(p.id)) { picks.push(p.id); if (picks.length > 3) picks.shift(); } $('#cmpIn', body).value = ''; draw(); });
  draw();
}
