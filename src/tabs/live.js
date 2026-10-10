import './live.css';
import { html, render, fmtNum, toast, $ } from '../lib/dom.js';
import { getModel, getEntry, settings, saveSettings } from '../lib/store.js';
import { fpl, api } from '../lib/api.js';
import { onboardCard, bindOnboard } from '../ui/onboard.js';
import { openSheet } from '../ui/sheet.js';
import { openPlus } from '../ui/plus.js';
let timer;

/** Provisional bonus from BPS per fixture (3/2/1, ties share) when official bonus isn't in yet. */
function provisionalBonus(fixtures, gw) {
  const bonus = new Map();
  for (const f of fixtures.filter(x => x.event === gw && x.started)) {
    const bps = f.stats?.find(s => s.identifier === 'bps'); const official = f.stats?.find(s => s.identifier === 'bonus');
    if (official && (official.h.length || official.a.length)) { [...official.h, ...official.a].forEach(x => bonus.set(x.element, x.value)); continue; }
    if (!bps) continue;
    const all = [...bps.h, ...bps.a].sort((a, b) => b.value - a.value);
    let award = 3, i = 0;
    while (award > 0 && i < all.length) { const v = all[i].value; const tied = all.filter(x => x.value === v); tied.forEach(x => bonus.set(x.element, award)); i += tied.length; award -= tied.length; }
  }
  return bonus;
}

function score(picksData, live, bonus) {
  const pts = id => { const e = live.get(id); return e ? e.stats.total_points + (e.stats.bonus ? 0 : (bonus.get(id) || 0)) : 0; };
  const picks = picksData?.picks || [];
  const chip = picksData?.active_chip;
  let total = 0; const rows = [];
  for (const pk of picks) { const p = pts(pk.element); const counted = pk.multiplier || (chip === 'bboost' ? 1 : 0); total += p * counted; rows.push({ id: pk.element, pts: p, mult: counted, pos: pk.position }); }
  return { total: total - (picksData?.entry_history?.event_transfers_cost || 0), rows, chip };
}

function rankTrend(history) {
  const cur = (history?.current || []).filter(h => h.overall_rank).slice(-6);
  if (cur.length < 2) return '';
  const max = Math.max(...cur.map(h => h.overall_rank)), min = Math.min(...cur.map(h => h.overall_rank));
  const y = r => max === min ? 50 : 8 + (r - min) / (max - min) * 84; // lower rank = higher on chart
  const pts = cur.map((h, i) => `${(i / (cur.length - 1) * 100).toFixed(1)},${y(h.overall_rank).toFixed(1)}`).join(' ');
  const last = cur[cur.length - 1], prev = cur[cur.length - 2];
  const up = last.overall_rank <= prev.overall_rank;
  return html`<div class="rank-trend"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="3" vector-effect="non-scaling-stroke"/></svg><span class="muted small">Rank GW${cur[0].event}–${last.event}: <b class="mv ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${fmtNum(Math.abs(prev.overall_rank - last.overall_rank))}</b> last week</span></div>`;
}

async function rivalPicks(entryId, gw) { try { return await fpl(`entry/${entryId}/event/${gw}/picks/`, 60); } catch { return null; } }

export async function mount(view) {
  if (!settings.entryId) { render(view, onboardCard()); bindOnboard(view, () => mount(view)); return; }
  const model = await getModel();
  const gw = model.currentGW || model.startGW;
  const [entry, liveData, fixtures] = await Promise.all([getEntry(), fpl(`event/${gw}/live/`, 30), fpl(`fixtures/?event=${gw}`, 30)]);
  const live = new Map((liveData.elements || []).map(e => [e.id, e]));
  const bonus = provisionalBonus(fixtures, gw);
  const mine = score(entry.picks, live, bonus);
  const ev = model.events.find(e => e.id === gw);
  const leagues = (entry.entry.leagues?.classic || []).filter(l => l.league_type === 'x').slice(0, 8);
  const rivals = (settings.rivals || []).slice(0, 5);
  const rivalData = await Promise.all(rivals.map(async r => ({ ...r, picks: await rivalPicks(r.id, gw) })));
  const P = id => model.byId.get(id);

  render(view, html`
    <div class="card hero"><div class="card-head"><span class="eyebrow">GW${gw} live</span><span class="muted">${ev?.finished ? 'final' : 'updating'}</span></div>
      <div class="stat-row"><div class="stat"><b class="accent big">${mine.total}</b><small>live points${mine.chip ? ' · ' + mine.chip : ''}</small></div><div class="stat"><b>${ev?.average_entry_score ?? '—'}</b><small>GW average</small></div><div class="stat"><b>${fmtNum(entry.entry.summary_overall_rank)}</b><small>overall rank (FPL)</small></div></div>
      ${rankTrend(entry.history)}
      <p class="muted small">Includes provisional bonus from BPS. FPL updates official rank a few times a day.</p></div>
    <div class="card"><h3>Your players</h3><div class="list">${mine.rows.filter(r => r.mult > 0 || r.pos <= 11).map(r => { const p = P(r.id); const st = live.get(r.id)?.stats || {}; const b = st.bonus || bonus.get(r.id) || 0; return p ? html`<div class="live-row"><span><strong>${p.web_name}</strong>${r.mult > 1 ? html` <span class="tag">x${r.mult}</span>` : ''}<small class="muted"> ${p.teamShort} · ${st.minutes || 0}'</small></span>${b ? html`<span class="bonus">+${b} bonus</span>` : html`<span></span>`}<b>${r.pts * Math.max(1, r.mult)}</b></div>` : ''; })}</div></div>
    <div class="card"><div class="card-head"><h3>Rivals</h3><button class="btn small" type="button" id="addRival">Add rival</button></div>
      ${rivalData.length ? html`<div class="list">${rivalData.map(r => { const s = r.picks ? score(r.picks, live, bonus) : null; const gap = s ? mine.total - s.total : 0; return html`<button class="row-card" type="button" data-rival="${r.id}"><span class="row-kit">⚔</span><span class="row-main"><strong>${r.name}</strong><small>${s ? 'live ' + s.total : 'no picks yet'}</small></span><span></span><span class="row-stat"><b class="${gap >= 0 ? 'mv up' : 'mv down'}">${gap >= 0 ? '+' : ''}${gap}</b><small>gap</small></span></button>`; })}</div>` : html`<p class="muted">Add a rival by Team ID or from a mini-league below to see the live gap and the differentials deciding it.</p>`}</div>
    <div class="card"><h3>Mini-leagues</h3>${leagues.length ? html`<div class="list">${leagues.map(l => html`<button class="row-card" type="button" data-league="${l.id}"><span class="row-kit">🏆</span><span class="row-main"><strong>${l.name}</strong><small>rank ${fmtNum(l.entry_rank)} ${l.entry_last_rank ? (l.entry_rank < l.entry_last_rank ? '▲' : l.entry_rank > l.entry_last_rank ? '▼' : '') : ''}</small></span><span></span><span class="row-stat">›</span></button>`)}</div>` : html`<p class="muted">No private classic leagues found.</p>`}</div>`);

  view.querySelector('#addRival').addEventListener('click', () => addRival(view));
  view.querySelectorAll('[data-rival]').forEach(b => b.addEventListener('click', () => { const r = rivalData.find(x => String(x.id) === b.dataset.rival); compare(model, entry.picks, r, live, bonus); }));
  view.querySelectorAll('[data-league]').forEach(b => b.addEventListener('click', () => openLeague(view, model, Number(b.dataset.league), leagues.find(l => String(l.id) === b.dataset.league)?.name)));
  clearInterval(timer);
  if (!ev?.finished) timer = setInterval(() => { if (document.visibilityState === 'visible' && location.hash.startsWith('#live')) mount(view).catch(() => {}); }, settings.dataSaver ? 180000 : 60000);
}

function addRival(view, preset) {
  const sheet = openSheet({ title: 'Add rival', body: html`<form class="inline-form" id="rvForm"><input id="rvId" inputmode="numeric" placeholder="Rival's Team ID" required value="${preset || ''}"><button class="btn primary" type="submit">Add</button></form>` });
  sheet.querySelector('#rvForm').addEventListener('submit', async e => {
    e.preventDefault(); const id = Number(sheet.querySelector('#rvId').value.replace(/\D/g, ''));
    try { const en = await fpl(`entry/${id}/`, 300); saveSettings({ rivals: [...(settings.rivals || []).filter(r => r.id !== id), { id, name: en.name }].slice(-5) }); toast('Rival added'); mount(view); }
    catch { toast('Team not found'); }
  });
}

function compare(model, myPicks, rival, live, bonus) {
  if (!rival?.picks) return toast('No picks for this rival yet');
  const mult = p => new Map((p.picks || []).map(x => [x.element, x.multiplier]));
  const a = mult(myPicks), b = mult(rival.picks);
  const ids = new Set([...a.keys(), ...b.keys()]);
  const rows = [...ids].map(id => { const e = live.get(id); const pts = e ? e.stats.total_points + (e.stats.bonus ? 0 : bonus.get(id) || 0) : 0; const ma = a.get(id) || 0, mb = b.get(id) || 0; return { p: model.byId.get(id), ma, mb, swing: pts * (ma - mb), pts, eo: (ma + mb) / 2 }; })
    .filter(r => r.p && r.ma !== r.mb).sort((x, y) => Math.abs(y.swing) - Math.abs(x.swing) || y.p.xp - x.p.xp);
  openSheet({ title: `You vs ${rival.name}`, body: html`<p class="muted">Players you don't share (or captain differently). Effective ownership is between the two of you; swing = points gained over your rival.</p><div class="list">${rows.map(r => html`<div class="live-row"><span><strong>${r.p.web_name}</strong><small class="muted"> you x${r.ma} · them x${r.mb} · EO ${Math.round(r.eo * 100)}%</small></span><span class="muted">${r.pts} pts</span><b class="${r.swing >= 0 ? 'mv up' : 'mv down'}">${r.swing >= 0 ? '+' : ''}${r.swing}</b></div>`)}</div>` });
}

async function openLeague(view, model, leagueId, name) {
  const sheet = openSheet({ title: name || 'League', body: html`<div class="sk"></div>`, footer: html`<button class="btn primary block" type="button" id="recapBtn">Weekly recap & awards</button>` });
  try {
    const st = await fpl(`leagues-classic/${leagueId}/standings/`, 120);
    render(sheet.querySelector('.sheet-body'), html`<div class="list">${(st.standings?.results || []).slice(0, 25).map(r => html`<div class="live-row"><span><strong>${r.rank}. ${r.entry_name}</strong><small class="muted"> ${r.player_name} · GW ${r.event_total}</small></span><b>${r.total}</b><button class="btn small" type="button" data-addrival="${r.entry}">Rival</button></div>`)}</div>`);
    sheet.querySelectorAll('[data-addrival]').forEach(b => b.addEventListener('click', async () => { const id = Number(b.dataset.addrival); const row = st.standings.results.find(r => r.entry === id); saveSettings({ rivals: [...(settings.rivals || []).filter(r => r.id !== id), { id, name: row.entry_name }].slice(-5) }); toast('Rival added'); mount(view); }));
  } catch { render(sheet.querySelector('.sheet-body'), html`<p class="muted">Couldn't load standings.</p>`); }
  sheet.querySelector('#recapBtn').addEventListener('click', async () => {
    const r = await api(`/api/plus?route=league-recap&league=${leagueId}`);
    if (r.status === 402 || r.status === 401) return leaguePackOffer(leagueId, r.data?.message);
    if (!r.ok) return toast('Recap unavailable right now');
    const d = r.data;
    openSheet({ title: `${d.league} · GW${d.gw}`, body: html`<div class="list">${d.awards.map(a => { const q = new URLSearchParams({ type: 'award', title: a.title, winner: a.winner?.manager || '', stat: a.stat || '', league: d.league, gw: String(d.gw) }); return html`<div class="award"><span class="eyebrow">${a.title}</span><strong>${a.winner?.manager}</strong><small class="muted">${a.winner?.team} · ${a.stat}</small><a class="btn small" target="_blank" rel="noopener" href="${'https://wa.me/?text=' + encodeURIComponent(`${a.title}: ${a.winner?.manager} (${a.stat}) ${location.origin}/api/og?${q}&format=html`)}">Share</a></div>`; })}</div>` });
  });
}

function leaguePackOffer(leagueId, msg) {
  openSheet({ title: 'League Pack', body: html`<p class="lead">${msg || 'Weekly recaps and award cards for your whole mini-league.'}</p><ul class="ticks"><li>Manager of the Week, Wooden Spoon, Captain Fantastic, Bench Disaster, Biggest Climber</li><li>Shareable award cards for your group chat</li><li>Bought once by the league admin; everyone in the league sees it</li></ul><p class="muted small">Cortex sells the recap tool only. No entry fees or prizes are involved.</p>`, footer: html`<button class="btn primary block" type="button" id="buyPack">Get League Pack</button><button class="btn block" type="button" id="orPlus">Or get Cortex Plus</button>`, onMount(s) {
    s.querySelector('#orPlus').addEventListener('click', () => openPlus());
    s.querySelector('#buyPack').addEventListener('click', async () => { const r = await api('/api/account?route=checkout', { method: 'POST', body: { plan: 'league_pack', leagueId } }); if (r.data?.url) location.href = r.data.url; else toast(r.status === 401 ? 'Sign in from Profile first' : 'League Packs open soon'); });
  } });
}
export function unmount() { clearInterval(timer); }
