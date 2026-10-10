import './team.css';
import { html, render, money, toast, $ } from '../lib/dom.js';
import { getModel, getEntry, getMe, settings } from '../lib/store.js';
import { api } from '../lib/api.js';
import { onboardCard, bindOnboard } from '../ui/onboard.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { lockedCard, bindPlus } from '../ui/plus.js';
import { mountPitch } from '../ui/pitch.js';
import { loadSquad, saveSquad, clearSquad, draftSquad, metrics, hits, transfer, transferBlock, undoLast, resetSquad, buildSquad } from '../lib/squad.js';
import { suggestTransfers, captainPicks } from '../../shared/xp.js';

const FPL_TRANSFERS = 'https://fantasy.premierleague.com/transfers';
const CHIPS = { wildcard: 'Wildcard', freehit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain', manager: 'Assistant Manager' };
const MODES = { pitch: 'Pitch', transfers: 'Transfers', chips: 'Chips', tools: 'Tools' };
let mode = 'pitch';

export async function mount(view) {
  const sub = location.hash.split('/')[1]; if (MODES[sub]) mode = sub;
  const model = await getModel();
  const [entry, me] = await Promise.all([settings.entryId ? getEntry() : null, getMe()]);
  let st = loadSquad(entry, model);
  if (!st) {
    if (settings.entryId && !entry?.picks) { render(view, html`<div class="card empty"><h3>No squad yet</h3><p class="muted">Pick your squad on the official FPL site, or build one here with the squad builder.</p><button class="btn primary" type="button" id="bld">Build a squad</button></div>`); $('#bld', view).addEventListener('click', () => openBuilder(model, null, view)); return; }
    render(view, html`${onboardCard()}<div class="card"><span class="eyebrow">No team yet?</span><p class="muted">Build a 15-man squad by the numbers and plan with it here.</p><button class="btn pill" type="button" id="bld">Build a squad →</button></div>`);
    bindOnboard(view, () => mount(view)); $('#bld', view).addEventListener('click', () => openBuilder(model, null, view)); return;
  }
  const ctx = { view, model, entry, me, st, rerender: () => mount(view) };
  render(view, html`<div class="seg" role="tablist">${Object.entries(MODES).map(([k, v]) => html`<button type="button" class="${mode === k ? 'on' : ''}" data-mode="${k}">${v}</button>`)}</div>
    ${st.key === 'draft' ? html`<p class="faint small">Draft squad built in Cortex. Add your Team ID in Settings to load your real team.</p>` : ''}<div id="tBody"></div>`);
  view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; history.replaceState(null, '', `#team/${mode}`); mount(view); }));
  const body = $('#tBody', view);
  await ({ pitch: pitchView, transfers: transfersView, chips: chipsView, tools: toolsView }[mode])(body, ctx);
}

// ---------- Pitch ----------
function pitchView(body, ctx) {
  const { model, st, entry } = ctx;
  render(body, html`<div id="pitchMount"></div>
    <div class="card"><div class="card-head"><h3>Chip preview</h3><span class="muted">changes the projection</span></div><div class="chips">${[[null, 'No chip'], ['3xc', 'Triple Captain'], ['bboost', 'Bench Boost']].map(([k, v]) => html`<button class="chip ${st.chip === k ? 'on' : ''}" type="button" data-chip="${k || ''}">${v}</button>`)}</div></div>
    <div id="sumCard"></div>
    <div class="tool-row">${st.base ? html`<button class="btn pill small" type="button" id="resetBtn">Reset to FPL team</button>` : html`<button class="btn pill small" type="button" id="clearBtn">Clear draft squad</button>`}${entry ? html`<button class="btn pill small" type="button" id="shareBtn">Share →</button>` : ''}</div>`);
  const sum = () => { const m = metrics(st, model); render($('#sumCard', body), html`<div class="tiles"><div class="tile"><small>Captain</small><b>${m.cap?.web_name || '—'}</b></div><div class="tile"><small>Captain pts</small><b>${m.capPts.toFixed(1)}</b></div><div class="tile"><small>Next 3 GWs</small><b>${m.h3.toFixed(0)}</b></div></div><div class="pitch-foot"><span>Bank ${money(st.bank)}</span><span>Value ${money(m.value)}</span>${st.moves.length ? html`<a href="#team/transfers">${st.moves.length} planned transfer${st.moves.length > 1 ? 's' : ''} →</a>` : ''}</div>`); };
  const pitch = mountPitch($('#pitchMount', body), { model, st, onChange: () => { pitch.redraw(); sum(); } });
  sum();
  body.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => { st.chip = b.dataset.chip || null; saveSquad(st); body.querySelectorAll('[data-chip]').forEach(x => x.classList.toggle('on', x === b)); pitch.redraw(); sum(); }));
  $('#resetBtn', body)?.addEventListener('click', () => { resetSquad(st); saveSquad(st); toast('Back to your FPL team'); ctx.rerender(); });
  $('#clearBtn', body)?.addEventListener('click', () => { clearSquad(); ctx.rerender(); });
  $('#shareBtn', body)?.addEventListener('click', () => share(model, entry, metrics(st, model).xi));
}

// ---------- Transfers (planner) ----------
async function transfersView(body, ctx) {
  const { model, st, me } = ctx;
  const draw = () => {
    render(body, html`
      <div class="card"><div class="card-head"><h3>Transfer planner</h3><span class="muted">GW${model.startGW}</span></div>
        <div class="tiles"><div class="tile"><small>Bank</small><b>${money(st.bank)}</b></div><div class="tile"><small>Planned</small><b>${st.moves.length}</b></div><div class="tile"><small>Hit</small><b class="${hits(st) ? 'mv down' : ''}">${hits(st) ? '−' + hits(st) : '0'}</b></div></div>
        <div class="toggle-row"><span class="muted">Free transfers</span><div class="chips">${[1, 2, 3, 4, 5].map(n => html`<button class="chip ${st.ft === n ? 'on' : ''}" type="button" data-ft="${n}">${n}</button>`)}</div></div>
        ${st.moves.length ? html`<div class="list">${st.moves.map(m => html`<div class="move"><span class="out">${model.byId.get(m.out)?.web_name} <small>${money(m.outPrice)}</small></span><span>→</span><span class="in">${model.byId.get(m.in)?.web_name} <small>${money(m.inPrice)}</small></span><small class="muted">GW${m.gw}</small></div>`)}</div><div class="tool-row"><button class="btn pill small" type="button" id="undoBtn">Undo last</button>${st.base ? html`<button class="btn pill small" type="button" id="resetBtn">Reset plan</button>` : ''}</div>` : html`<p class="muted small">Tap a player on the pitch, then “Transfer out”. Swaps and captaincy work here too.</p>`}
      </div>
      <div id="planPitch"></div>
      <div class="card" id="trCard"></div>
      <a class="btn primary block" href="${FPL_TRANSFERS}" target="_blank" rel="noopener">Make it official on FPL ↗</a>`);
    mountPitch($('#planPitch', body), { model, st, compact: true, onChange: draw, onOut: id => pickReplacement(model, st, id, draw) });
    body.querySelectorAll('[data-ft]').forEach(b => b.addEventListener('click', () => { st.ft = Number(b.dataset.ft); saveSquad(st); draw(); }));
    $('#undoBtn', body)?.addEventListener('click', () => { undoLast(st, model); saveSquad(st); draw(); });
    $('#resetBtn', body)?.addEventListener('click', () => { resetSquad(st); saveSquad(st); draw(); });
    const moves = suggestTransfers(model, st.order, st.bank, 3, me.plus ? 5 : 1);
    render($('#trCard', body), html`<div class="card-head"><h3>Suggested transfers</h3><span class="muted">next 3 GWs</span></div>${moves.length ? html`<div class="list">${moves.map((m, i) => html`<div class="move"><span class="out">${m.out.name}</span><span>→</span><span class="in">${m.in.name}</span><button class="btn pill small" type="button" data-plan="${i}">+${m.gain} · Plan</button></div>`)}</div>` : html`<p class="muted">No clear upgrade within your bank.</p>`}${me.plus ? '' : lockedCard('Full transfer projections', 'Every worthwhile move ranked by projected gain, plus a 5-gameweek planner.')}`);
    body.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => { const m = moves[b.dataset.plan]; if (transfer(st, model, m.out.id, m.in.id, model.startGW)) { saveSquad(st); toast(`${m.out.name} → ${m.in.name} planned`); draw(); } }));
    bindPlus(body, 'Plus unlocks full transfer projections and the planner.');
  };
  draw();
}

function pickReplacement(model, st, outId, done) {
  const o = model.byId.get(outId);
  const h3 = p => model.horizon(p, 3).reduce((s, g) => s + g.xp, 0);
  const pool = model.players.filter(p => p.element_type === o.element_type && p.id !== outId && !st.order.includes(p.id)).map(p => ({ p, s: h3(p) })).sort((a, b) => b.s - a.s);
  let q = '';
  const list = () => html`${pool.filter(x => !q || `${x.p.web_name} ${x.p.teamName} ${x.p.teamShort}`.toLowerCase().includes(q)).slice(0, 30).map(({ p, s }) => { const why = transferBlock(st, model, outId, p.id); return html`<button class="row-card ${why ? 'blocked' : ''}" type="button" data-in="${p.id}" ${why ? 'aria-disabled="true"' : ''}><span class="row-kit">${p.teamShort}</span><span class="row-main"><strong>${p.web_name}</strong><small>${money(p.price)} · ${why || `${p.selected}% owned`}</small></span><span class="row-stat"><small>3-GW xP</small><b>${s.toFixed(1)}</b></span></button>`; })}`;
  const sheet = openSheet({ title: `Replace ${o.web_name}`, body: html`<p class="muted small">${o.pos} · sells for ${money(o.price)} · bank ${money(st.bank)} → max ${money(o.price + st.bank)}</p><input type="search" id="rq" placeholder="Search ${o.pos}" aria-label="Search replacements"><div class="list" id="rl">${list()}</div>` });
  const bind = () => sheet.querySelectorAll('[data-in]').forEach(b => b.addEventListener('click', () => {
    const id = Number(b.dataset.in), why = transferBlock(st, model, outId, id);
    if (why) return toast(why);
    transfer(st, model, outId, id, model.startGW); saveSquad(st); closeSheet(); toast(`${o.web_name} → ${model.byId.get(id).web_name}`); done();
  }));
  sheet.querySelector('#rq').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(sheet.querySelector('#rl'), list()); bind(); });
  bind();
}

// ---------- Chips ----------
async function chipsView(body, ctx) {
  const { model, entry, me, st } = ctx;
  const used = new Map((entry?.history?.chips || []).map(c => [c.name, c.event]));
  const start = model.startGW, dgw = [], bgw = [];
  for (let gw = start; gw < start + 8; gw++) {
    const d = [], b = [];
    Object.values(model.teams).forEach(t => { const n = model.gwFixtures(t.id, gw).length; if (n > 1) d.push(t.short_name); if (n === 0) b.push(t.short_name); });
    if (d.length) dgw.push({ gw, teams: d }); if (b.length && b.length < 20) bgw.push({ gw, teams: b });
  }
  const mine = new Set(st.order.map(id => model.byId.get(id)?.teamShort));
  render(body, html`
    <div class="card" id="capCard"><div class="card-head"><h3>Captain</h3><span class="muted">GW${start}</span></div><div class="sk"></div></div>
    <div class="card"><div class="card-head"><h3>Your chips</h3></div><div class="list">${Object.entries(CHIPS).map(([k, v]) => html`<div class="live-row"><span><strong>${v}</strong></span><span></span><b class="${used.has(k) ? 'muted' : 'accent'}">${used.has(k) ? `used GW${used.get(k)}` : 'available'}</b></div>`)}</div></div>
    <div class="card"><div class="card-head"><h3>Doubles & blanks</h3><span class="muted">next 8 GWs</span></div>
      ${dgw.length || bgw.length ? html`<div class="list">${dgw.map(d => html`<div class="bd-banner dbl"><b>GW${d.gw} double</b> <span>${d.teams.map(t => html`<span class="${mine.has(t) ? 'accent' : ''}">${t}</span> `)}</span></div>`)}${bgw.map(d => html`<div class="bd-banner blank"><b>GW${d.gw} blank</b> <span>${d.teams.map(t => html`<span class="${mine.has(t) ? 'accent' : ''}">${t}</span> `)}</span></div>`)}</div><p class="faint small">Clubs in orange are in your squad. Doubles suit Bench Boost / Triple Captain; blanks suit Free Hit.</p>` : html`<p class="muted">No doubles or blanks scheduled in the next 8 gameweeks.</p>`}</div>
    <div class="card"><div class="card-head"><h3>5-gameweek planner</h3></div><div id="planner"></div></div>`);
  const capCard = $('#capCard', body), planner = $('#planner', body);
  if (me.plus && settings.entryId) {
    const [cap, pl] = await Promise.all(['captain', 'planner'].map(r => api(`/api/plus?route=${r}&entry=${settings.entryId}`)));
    render(capCard, html`<div class="card-head"><h3>Captain</h3><span class="muted">confidence</span></div><div class="list">${(cap.data.picks || []).slice(0, 4).map((c, i) => html`<div class="cap-row ${i === 0 ? 'top' : ''}"><strong>${c.name}</strong><span class="muted">${c.team}</span><span>${c.captainXp} pts</span><span class="conf"><i style="width:${c.confidence}%"></i></span><b>${c.confidence}%</b></div>`)}</div>`);
    if (pl.ok) render(planner, html`<div class="scroll-x"><table class="table"><thead><tr><th>Player</th>${pl.data.gws.map(g => html`<th>GW${g}</th>`)}</tr></thead><tbody>${pl.data.rows.map((r, i) => html`<tr class="${i === 11 ? 'bench-start' : ''}"><td>${r.name}</td>${r.gws.map(g => html`<td><span class="fdr fdr-${g.fixtures[0]?.fdr || 3}">${g.fixtures.map(f => f.opp).join('+') || '—'}</span> ${g.xp}</td>`)}</tr>`)}</tbody></table></div>${pl.data.chipHints.filter(c => c.hint).map(c => html`<p class="accent">GW${c.gw}: ${c.hint}</p>`)}`);
  } else {
    const c = captainPicks(model, st.order.slice(0, 11))[0];
    render(capCard, html`<div class="card-head"><h3>Captain</h3><span class="muted">GW${start}</span></div>${c ? html`<div class="cap-row top"><strong>${c.name}</strong><span class="muted">${c.team}</span><span>${c.captainXp} pts</span></div>` : ''}<p class="muted">Plus adds a confidence score and the best alternatives.</p><button class="btn small" type="button" data-plus>See confidence</button>`);
    render(planner, lockedCard('5-gameweek planner', 'Projected points per player per gameweek, with chip windows flagged.'));
    bindPlus(body, 'Plus unlocks captain confidence, projections and the planner.');
  }
}

// ---------- Tools ----------
function toolsView(body, ctx) {
  const { model, st } = ctx;
  const m = metrics(st, model), squad = [...m.xi, ...m.bench];
  const avgGW = Math.max(1, model.currentGW);
  const risk = squad.map(p => { let r = 0; if (p.chance != null) r += (100 - p.chance) * .4; const am = p.minutes / avgGW; r += am > 85 ? 20 : am > 75 ? 10 : 0; if (p.element_type === 4) r += 5; if (p.form < 2) r += 15; if (p.status !== 'a') r += 25; return { p, r: Math.min(100, Math.round(r)) }; }).sort((a, b) => b.r - a.r).slice(0, 6);
  render(body, html`
    <div class="card"><div class="card-head"><h3>Squad builder</h3><span class="muted">by the numbers</span></div><p class="muted small">Builds a legal 15 (max 3 per club) within budget. Load it as a plan or wildcard draft.</p><button class="btn pill" type="button" id="bld">Build a squad →</button></div>
    <div class="card"><div class="card-head"><h3>Sell or hold?</h3></div><form class="inline-form" id="sohForm"><input id="sohIn" placeholder="Player name" aria-label="Player to check" list="sohList"><datalist id="sohList">${squad.map(p => html`<option value="${p.web_name}">`)}</datalist><button class="btn primary" type="submit">Check</button></form><div id="sohOut"></div></div>
    <div class="card"><div class="card-head"><h3>Squad DNA</h3><span class="muted">identity</span></div>${dna(model, m)}</div>
    <div class="card"><div class="card-head"><h3>Injury risk</h3><span class="muted">your 15</span></div><div class="list">${risk.map(({ p, r }) => html`<div class="live-row"><span><strong>${p.web_name}</strong><small class="muted"> ${p.teamShort}${p.news ? ' · ' + p.news : ''}</small></span><span class="conf"><i style="width:${r}%;background:${r >= 70 ? 'var(--bad)' : r >= 40 ? 'var(--warn)' : 'var(--good)'}"></i></span><b>${r}</b></div>`)}</div></div>
    <div class="card"><div class="card-head"><h3>Gameweek diary</h3><span class="muted">GW${model.startGW}</span></div><textarea id="diary" placeholder="Why you made this week's moves…" maxlength="1000">${(JSON.parse(localStorage.getItem('cortex_diary') || '{}'))[model.startGW] || ''}</textarea><button class="btn pill small" type="button" id="diarySave">Save note</button>${diaryList(model)}</div>
    <div class="card"><div class="card-head"><h3>Template check</h3></div><p class="muted small">Compare your squad with any manager (e.g. a top-10k team).</p><form class="inline-form" id="tplForm"><input id="tplId" inputmode="text" placeholder="Their Team ID or FPL link" aria-label="Team ID or FPL link to compare"><button class="btn primary" type="submit">Compare</button></form><div id="tplOut"></div></div>`);
  $('#bld', body).addEventListener('click', () => openBuilder(model, st, ctx.view));
  $('#diarySave', body).addEventListener('click', () => { const d = JSON.parse(localStorage.getItem('cortex_diary') || '{}'); d[model.startGW] = $('#diary', body).value.trim(); if (!d[model.startGW]) delete d[model.startGW]; localStorage.setItem('cortex_diary', JSON.stringify(d)); toast('Note saved'); toolsView(body, ctx); });
  $('#sohForm', body).addEventListener('submit', e => { e.preventDefault(); render($('#sohOut', body), sellOrHold(model, $('#sohIn', body).value.trim().toLowerCase())); });
  $('#tplForm', body).addEventListener('submit', async e => {
    e.preventDefault(); const v = $('#tplId', body).value; const id = Number((v.match(/entry\/(\d{1,9})/i) || [])[1] || v.replace(/\D/g, '')); const out = $('#tplOut', body); if (!id) return;
    render(out, html`<div class="sk"></div>`);
    try {
      const { fpl } = await import('../lib/api.js');
      const gw = model.currentGW || model.startGW;
      const [p, en] = await Promise.all([fpl(`entry/${id}/event/${gw}/picks/`, 120), fpl(`entry/${id}/`, 300)]);
      const theirs = p.picks.map(x => x.element), mine = new Set(st.order);
      const same = theirs.filter(x => mine.has(x)), diff = theirs.filter(x => !mine.has(x)), yours = st.order.filter(x => !theirs.includes(x));
      const nm = x => model.byId.get(x)?.web_name || `#${x}`;
      render(out, html`<div class="stat-row"><div class="stat"><b class="accent">${Math.round(same.length / 15 * 100)}%</b><small>overlap with ${en.name}</small></div></div><p class="small"><b>They have:</b> <span class="muted">${diff.map(nm).join(', ') || '—'}</span></p><p class="small"><b>Only you:</b> <span class="muted">${yours.map(nm).join(', ') || '—'}</span></p>`);
    } catch { render(out, html`<p class="muted">Team not found or picks hidden.</p>`); }
  });
}

function diaryList(model) {
  const d = JSON.parse(localStorage.getItem('cortex_diary') || '{}');
  const past = Object.entries(d).filter(([gw]) => Number(gw) !== model.startGW).sort((a, b) => b[0] - a[0]);
  return past.length ? html`<div class="list">${past.map(([gw, t]) => html`<div class="live-row"><span><small class="muted">GW${gw}</small> ${t}</span><span></span><span></span></div>`)}</div>` : '';
}

function sellOrHold(model, q) {
  if (!q) return '';
  const p = model.players.find(x => x.web_name.toLowerCase() === q) || model.players.find(x => `${x.web_name} ${x.first_name} ${x.second_name}`.toLowerCase().includes(q));
  if (!p) return html`<p class="muted">Player not found.</p>`;
  const h5 = x => model.horizon(x, 5).reduce((s, g) => s + g.xp, 0);
  const mine = h5(p);
  const alt = model.players.filter(x => x.element_type === p.element_type && x.id !== p.id && x.price <= p.price + .5 && x.status === 'a').map(x => ({ x, s: h5(x) })).sort((a, b) => b.s - a.s)[0];
  const gap = alt ? alt.s - mine : 0;
  const verdict = p.status === 'i' || p.status === 's' || p.status === 'n' ? 'SELL' : gap > 4 ? 'SELL' : gap > 1.5 ? 'CONSIDER' : 'HOLD';
  return html`<div class="soh"><span class="tag ${verdict === 'HOLD' ? 'good' : verdict === 'SELL' ? 'bad' : ''}">${verdict}</span><p class="small"><b>${p.web_name}</b> projects <b>${mine.toFixed(1)}</b> over 5 GWs · form ${p.form.toFixed(1)}${p.news ? ' · ' + p.news : ''}.</p>${alt ? html`<p class="small muted">Best like-for-like (≤ ${money(p.price + .5)}): <b>${alt.x.web_name}</b> ${alt.s.toFixed(1)} pts (${gap >= 0 ? '+' : ''}${gap.toFixed(1)}).</p>` : ''}</div>`;
}

function dna(model, m) {
  const all = [...m.xi, ...m.bench], n = Math.max(1, all.length), clamp = v => Math.max(0, Math.min(100, v));
  const scores = [
    ['Attack', clamp(m.xi.filter(p => p.element_type > 2).reduce((s, p) => s + p.xp, 0) * 4)],
    ['Defence', clamp(m.xi.filter(p => p.element_type <= 2).reduce((s, p) => s + p.total_points, 0) / 3)],
    ['Form', clamp(all.reduce((s, p) => s + p.form * 10, 0) / n)],
    ['Value', clamp(all.reduce((s, p) => s + p.xp / p.price * 10, 0) / n * 1.5)],
    ['Template', clamp(all.filter(p => p.selected > 30).length / 15 * 100)],
    ['Fixtures', clamp((5 - all.reduce((s, p) => s + p.avgFDR, 0) / n) / 4 * 100)],
  ];
  const cx = 120, cy = 110, r = 80, pt = (i, v) => { const a = i / 6 * 2 * Math.PI - Math.PI / 2; return `${(cx + r * v * Math.cos(a)).toFixed(1)},${(cy + r * v * Math.sin(a)).toFixed(1)}`; };
  const ring = v => scores.map((_, i) => pt(i, v)).join(' ');
  return html`<svg class="dna" viewBox="0 0 240 220" role="img" aria-label="Squad DNA radar">${[.25, .5, .75, 1].map(v => html`<polygon points="${ring(v)}" fill="none" stroke="#2c2c2c"/>`)}<polygon points="${scores.map(([, v], i) => pt(i, v / 100)).join(' ')}" fill="rgba(247,147,30,.22)" stroke="#F7931E" stroke-width="2"/>${scores.map(([l, v], i) => { const [x, y] = pt(i, 1.2).split(','); return html`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#A8A39E">${l} ${Math.round(v)}</text>`; })}</svg>`;
}

function openBuilder(model, st, view) {
  let built = null;
  const sheet = openSheet({
    title: 'Squad builder',
    body: html`<div class="inline-form"><label class="field"><span>Budget £m</span><input type="number" id="bBudget" step="0.5" min="80" max="110" value="${st ? (metrics(st, model).value + st.bank).toFixed(1) : '100.0'}"></label></div>
      <div class="chips wrap" id="bPri">${[['value', 'Value'], ['form', 'Form'], ['fixtures', 'Fixtures'], ['wildcard', 'Wildcard (5 GW)']].map(([k, v], i) => html`<button class="chip ${i === 0 ? 'on' : ''}" type="button" data-pri="${k}">${v}</button>`)}</div>
      <button class="btn primary" type="button" id="bGo">Build candidate</button><div id="bOut"></div>`,
    footer: html`<button class="btn primary block" type="button" id="bUse" disabled>${st?.base ? 'Load as my plan (wildcard draft)' : 'Use this squad'}</button>`,
  });
  let pri = 'value';
  sheet.querySelectorAll('[data-pri]').forEach(b => b.addEventListener('click', () => { pri = b.dataset.pri; sheet.querySelectorAll('[data-pri]').forEach(x => x.classList.toggle('on', x === b)); }));
  sheet.querySelector('#bGo').addEventListener('click', () => {
    built = buildSquad(model, Number(sheet.querySelector('#bBudget').value) || 100, pri);
    const out = sheet.querySelector('#bOut');
    if (!built) { render(out, html`<p class="muted">Couldn't fit a full squad in that budget. Try a little more.</p>`); return; }
    const ps = built.ids.map(id => model.byId.get(id));
    render(out, html`<p class="small"><b>${money(built.spent)}</b> spent · ${money(built.bank)} left · XI projects <b>${ps.slice(0, 11).reduce((s, p) => s + p.xp, 0).toFixed(1)}</b></p><div class="list">${ps.map((p, i) => html`<div class="live-row ${i === 11 ? 'bench-start' : ''}"><span><strong>${p.web_name}</strong><small class="muted"> ${p.pos} · ${p.teamShort}${i >= 11 ? ' · bench' : ''}</small></span><span class="muted">${money(p.price)}</span><b>${p.xp.toFixed(1)}</b></div>`)}</div>`);
    sheet.querySelector('#bUse').disabled = false;
  });
  sheet.querySelector('#bUse').addEventListener('click', () => {
    if (!built) return;
    const next = st?.base ? Object.assign(st, { order: built.ids, captain: built.captain, vice: built.vice, bank: built.bank, moves: [], wildcard: true }) : Object.assign(draftSquad(built.ids, built.bank), { captain: built.captain, vice: built.vice });
    saveSquad(next); closeSheet(); toast('Squad loaded'); mode = 'pitch'; mount(view);
  });
}

function share(model, entry, xiPlayers) {
  const last = entry.history?.current?.slice(-1)[0];
  const q = new URLSearchParams({ t: entry.entry.name, m: `${entry.entry.player_first_name} ${entry.entry.player_last_name}`, gw: String(last?.event ?? model.currentGW), pts: String(last?.points ?? ''), rank: String(entry.entry.summary_overall_rank || ''), xi: xiPlayers.map(p => `${p.web_name.replace(/[:,]/g, '')}:${p.pos}:${p.teamShort}:${p.event_points}`).join(',') });
  const pageUrl = `${location.origin}/api/og?${q}&format=html`, img = `/api/og?${q}`;
  const text = `${entry.entry.name}: ${last?.points ?? '—'} pts in GW${last?.event ?? ''} 📊`;
  openSheet({
    title: 'Share your team',
    body: html`${settings.dataSaver ? html`<p class="muted">Image preview hidden in data saver.</p>` : html`<img class="share-img" src="${img}" alt="Team card preview" loading="lazy">`}
      <div class="share-btns"><a class="btn primary" target="_blank" rel="noopener" href="${'https://wa.me/?text=' + encodeURIComponent(text + ' ' + pageUrl)}">WhatsApp</a><a class="btn" target="_blank" rel="noopener" href="${'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(pageUrl)}">Post on X</a><button class="btn" type="button" id="copyLink">Copy link</button></div>`,
    onMount(s) {
      s.querySelector('#copyLink').addEventListener('click', async () => { try { if (navigator.share) await navigator.share({ title: 'FPL Cortex', text, url: pageUrl }); else { await navigator.clipboard.writeText(pageUrl); toast('Link copied'); } } catch { /* cancelled */ } });
    },
  });
}
