import './players.css';
import { html, render, money, $ } from '../lib/dom.js';
import { getModel, getEntry, settings, saveSettings } from '../lib/store.js';
import { playerCard } from '../ui/card.js';
import { openPlayer } from '../ui/playerSheet.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { priceOutlook } from '../../shared/xp.js';

const POS = ['GKP', 'DEF', 'MID', 'FWD'];
const QUICK = [
  { id: 'all', label: 'All' }, ...POS.map(p => ({ id: p, label: p })),
  { id: 'u6', label: '£6.0 and under' }, { id: 'form', label: 'In form' }, { id: 'diff', label: 'Differentials' }, { id: 'risers', label: 'Price risers' },
];
const SORTS = { xp: 'Projected points', form: 'Form', price: 'Price', total: 'Total points', own: 'Ownership' };
const OWN = [{ id: 5, label: 'Under 5%' }, { id: 10, label: 'Under 10%' }, { id: 20, label: 'Under 20%' }];
const PRICE_CHIPS = [4.5, 5.5, 6.0, 7.5, 9.0];

let st = null, model = null, entry = null, shown = 40;

const initState = () => ({ q: '', quick: 'all', pos: new Set(), min: 3.5, max: 15.5, own: null, avail: false, easy: false, sort: 'xp', mode: 'players' });

function matches(p, s, skip = '') {
  if (s.q) { const q = s.q.toLowerCase(); if (!(`${p.web_name} ${p.first_name} ${p.second_name} ${p.teamName} ${p.teamShort} ${p.pos}`.toLowerCase().includes(q))) return false; }
  if (skip !== 'quick') {
    if (POS.includes(s.quick) && p.pos !== s.quick) return false;
    if (s.quick === 'u6' && p.price > 6.0) return false;
    if (s.quick === 'form' && p.form < 5) return false;
    if (s.quick === 'diff' && !(p.selected < 5 && p.xp >= 4)) return false;
    if (s.quick === 'risers' && priceOutlook(p).dir !== 'up') return false;
  }
  if (skip !== 'pos' && s.pos.size && !s.pos.has(p.pos)) return false;
  if (skip !== 'price' && (p.price < s.min - 1e-9 || p.price > s.max + 1e-9)) return false;
  if (skip !== 'own' && s.own && p.selected >= s.own) return false;
  if (skip !== 'avail' && s.avail && p.status !== 'a') return false;
  if (skip !== 'easy' && s.easy && p.avgFDR > 2.5) return false;
  return true;
}
const sorter = k => (a, b) => k === 'price' ? b.price - a.price : k === 'form' ? b.form - a.form : k === 'total' ? b.total_points - a.total_points : k === 'own' ? b.selected - a.selected : b.xp - a.xp;
const filtered = (s = st) => model.players.filter(p => matches(p, s)).sort(sorter(s.sort));

function bestPickTags() {
  const tags = new Map(); if (!entry?.ids?.length) return tags;
  for (const pos of POS) {
    const mine = entry.ids.map(id => model.byId.get(id)).filter(p => p?.pos === pos);
    if (!mine.length) continue;
    const budget = Math.min(...mine.map(p => p.price)) + entry.bank;
    const weakest = mine.reduce((a, b) => (a.xp < b.xp ? a : b));
    const best = model.players.filter(p => p.pos === pos && !entry.ids.includes(p.id) && p.price <= budget && p.status === 'a').sort((a, b) => b.xp - a.xp)[0];
    if (best && best.xp > weakest.xp) tags.set(best.id, 'Best pick for your team');
  }
  return tags;
}

function draw(view) {
  const list = filtered();
  const tags = bestPickTags();
  const compact = settings.view === 'compact';
  render($('#pResults', view), html`
    <div class="result-bar"><b>${list.length} players</b><span class="muted">sorted by ${SORTS[st.sort].toLowerCase()}</span></div>
    <div class="${compact ? 'list' : 'card-grid'}">${list.slice(0, shown).map(p => playerCard(p, { stat: st.sort === 'own' ? 'own' : st.sort, tag: tags.get(p.id) || '', compact }))}</div>
    ${list.length > shown ? html`<button class="btn block" type="button" id="moreBtn">Show more (${list.length - shown} left)</button>` : ''}`);
  view.querySelectorAll('#pResults [data-pid]').forEach(b => b.addEventListener('click', () => openPlayer(model, b.dataset.pid)));
  $('#moreBtn', view)?.addEventListener('click', () => { shown += 40; draw(view); });
  view.querySelectorAll('[data-quick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.quick === st.quick)));
  const nf = (st.pos.size ? 1 : 0) + (st.min > 3.5 || st.max < 15.5 ? 1 : 0) + (st.own ? 1 : 0) + (st.avail ? 1 : 0) + (st.easy ? 1 : 0);
  $('#filterBtn', view).textContent = nf ? `Filter · ${nf}` : 'Filter';
}

function fdrGrid() {
  const start = model.startGW, gws = Array.from({ length: 6 }, (_, i) => start + i);
  const teams = Object.values(model.teams).map(t => ({ t, cells: gws.map(gw => model.gwFixtures(t.id, gw)) }))
    .map(r => ({ ...r, score: r.cells.reduce((s, c) => s + (c.length ? c.reduce((a, f) => a + f.difficulty, 0) / c.length : 5), 0) })).sort((a, b) => a.score - b.score);
  return html`<div class="card"><div class="card-head"><h3>Fixture difficulty</h3><span class="muted">easiest run first</span></div><div class="scroll-x"><table class="table fdr-table"><thead><tr><th>Team</th>${gws.map(g => html`<th>GW${g}</th>`)}</tr></thead><tbody>${teams.map(r => html`<tr><td><b>${r.t.short_name}</b></td>${r.cells.map(c => html`<td>${c.length ? c.map(f => html`<span class="fdr fdr-${f.difficulty}">${f.home ? f.opponent : f.opponent.toLowerCase()}</span>`) : html`<span class="fdr">—</span>`}</td>`)}</tr>`)}</tbody></table></div></div>`;
}

function movers() {
  const withO = model.players.map(p => ({ p, o: priceOutlook(p) }));
  const up = withO.filter(x => x.o.dir === 'up').sort((a, b) => b.o.pct - a.o.pct).slice(0, 10);
  const down = withO.filter(x => x.o.dir === 'down').sort((a, b) => a.o.pct - b.o.pct).slice(0, 10);
  const col = (title, arr) => html`<div class="card"><h3>${title}</h3><div class="list">${arr.length ? arr.map(x => html`<button class="row-card" type="button" data-pid="${x.p.id}"><span class="row-kit"></span><span class="row-main"><strong>${x.p.web_name}</strong><small>${x.p.teamShort} · ${money(x.p.price)}</small></span><span></span><span class="row-stat"><b class="mv ${x.o.dir}">${x.o.label}</b></span></button>`) : html`<p class="muted">Nothing close tonight.</p>`}</div></div>`;
  return html`<p class="muted small">Predicted from FPL's own price-change progress and net transfers. Changes happen overnight UK time.</p>${col('Likely risers', up)}${col('Likely fallers', down)}`;
}

function openFilters(view) {
  const draft = { ...st, pos: new Set(st.pos) };
  const prices = model.players.map(p => p.price);
  const lo = 3.5, hi = 15.5, bins = 24, step = (hi - lo) / bins;
  const counts = Array(bins).fill(0); prices.forEach(v => { counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / step)))]++; });
  const maxC = Math.max(...counts);
  const budget = entry ? Math.max(...entry.ids.map(id => model.byId.get(id)?.price || 0)) + entry.bank : null;
  const count = patch => model.players.filter(p => matches(p, { ...draft, ...patch })).length;

  const body = () => html`
    <section><div class="card-head"><span class="eyebrow">Price</span><span class="muted">${money(draft.min)} – ${money(draft.max)}</span></div>
      <div class="histo">${counts.map((c, i) => { const from = lo + i * step; const inR = from + step > draft.min && from < draft.max; return html`<i class="${inR ? 'in' : ''}" style="height:${Math.max(4, c / maxC * 100)}%"></i>`; })}${budget ? html`<span class="budget" style="left:${(Math.min(hi, budget) - lo) / (hi - lo) * 100}%" title="Your max spend">bank ${money(budget)}</span>` : ''}</div>
      <div class="dual"><input type="range" min="${lo}" max="${hi}" step="0.5" value="${draft.min}" id="rMin" aria-label="Minimum price"><input type="range" min="${lo}" max="${hi}" step="0.5" value="${draft.max}" id="rMax" aria-label="Maximum price"></div>
      <div class="inline-form"><label class="field"><span>Min £m</span><input type="number" step="0.1" min="${lo}" max="${hi}" value="${draft.min}" id="nMin"></label><label class="field"><span>Max £m</span><input type="number" step="0.1" min="${lo}" max="${hi}" value="${draft.max}" id="nMax"></label></div>
      <div class="chips wrap">${PRICE_CHIPS.map(v => html`<button class="chip ${draft.min === v && draft.max === hi ? 'on' : ''}" type="button" data-pmin="${v}">${v.toFixed(1)}+<span class="count">${count({ min: v, max: hi })}</span></button>`)}</div></section>
    <section><span class="eyebrow">Position</span><div class="chips wrap">${POS.map(p => html`<button class="chip ${draft.pos.has(p) ? 'on' : ''}" type="button" data-pos="${p}">${p}<span class="count">${count({ pos: new Set([p]) })}</span></button>`)}</div></section>
    <section><span class="eyebrow">Ownership</span><div class="chips wrap">${OWN.map(o => html`<button class="chip ${draft.own === o.id ? 'on' : ''}" type="button" data-own="${o.id}">${o.label}<span class="count">${count({ own: o.id })}</span></button>`)}</div></section>
    <section><span class="eyebrow">Availability & fixtures</span><div class="chips wrap"><button class="chip ${draft.avail ? 'on' : ''}" type="button" data-tog="avail">Fit to play<span class="count">${count({ avail: true })}</span></button><button class="chip ${draft.easy ? 'on' : ''}" type="button" data-tog="easy">Easy next 3<span class="count">${count({ easy: true })}</span></button></div></section>`;

  const sheet = openSheet({ title: 'Filter players', body: body(), footer: html`<div class="foot-row"><button class="btn" type="button" id="fReset">Reset</button><button class="btn primary" type="button" id="fApply">Show players</button></div>` });
  const refresh = () => {
    render(sheet.querySelector('.sheet-body'), body()); bind();
    const n = model.players.filter(p => matches(p, draft)).length;
    sheet.querySelector('#fApply').textContent = `Show ${n} players`; sheet.querySelector('#fApply').disabled = n === 0;
  };
  const clampP = v => Math.max(lo, Math.min(hi, Math.round(Number(v) * 10) / 10 || lo));
  function bind() {
    const b = sheet.querySelector('.sheet-body');
    b.querySelector('#rMin').addEventListener('change', e => { draft.min = Math.min(clampP(e.target.value), draft.max); refresh(); });
    b.querySelector('#rMax').addEventListener('change', e => { draft.max = Math.max(clampP(e.target.value), draft.min); refresh(); });
    b.querySelector('#nMin').addEventListener('change', e => { draft.min = Math.min(clampP(e.target.value), draft.max); refresh(); });
    b.querySelector('#nMax').addEventListener('change', e => { draft.max = Math.max(clampP(e.target.value), draft.min); refresh(); });
    b.querySelectorAll('[data-pmin]').forEach(c => c.addEventListener('click', () => { const v = Number(c.dataset.pmin); if (draft.min === v && draft.max === hi) { draft.min = lo; } else { draft.min = v; draft.max = hi; } refresh(); }));
    b.querySelectorAll('[data-pos]').forEach(c => c.addEventListener('click', () => { const p = c.dataset.pos; draft.pos.has(p) ? draft.pos.delete(p) : draft.pos.add(p); refresh(); }));
    b.querySelectorAll('[data-own]').forEach(c => c.addEventListener('click', () => { const v = Number(c.dataset.own); draft.own = draft.own === v ? null : v; refresh(); }));
    b.querySelectorAll('[data-tog]').forEach(c => c.addEventListener('click', () => { draft[c.dataset.tog] = !draft[c.dataset.tog]; refresh(); }));
  }
  sheet.querySelector('#fReset').addEventListener('click', () => { Object.assign(draft, { pos: new Set(), min: lo, max: hi, own: null, avail: false, easy: false }); refresh(); });
  sheet.querySelector('#fApply').addEventListener('click', () => { st = { ...draft }; shown = 40; closeSheet(); draw(view); });
  refresh();
}

function openSort(view) {
  const sheet = openSheet({ title: 'Sort by', body: html`<div class="list">${Object.entries(SORTS).map(([k, v]) => html`<button class="row-card sort-opt ${st.sort === k ? 'on' : ''}" type="button" data-sort="${k}"><span></span><span class="row-main"><strong>${v}</strong></span><span></span><span class="row-stat">${st.sort === k ? '✓' : ''}</span></button>`)}</div>` });
  sheet.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { st.sort = b.dataset.sort; closeSheet(); draw(view); }));
}

export async function mount(view) {
  model = await getModel();
  entry = settings.entryId ? await getEntry().catch(() => null) : null;
  st ||= initState(); shown = 40;
  render(view, html`
    <div class="seg" role="tablist">${['players', 'fixtures', 'movers'].map(m => html`<button type="button" class="${st.mode === m ? 'on' : ''}" data-mode="${m}">${m === 'players' ? 'Players' : m === 'fixtures' ? 'Fixtures' : 'Price movers'}</button>`)}</div>
    <div id="pBody"></div>`);
  view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { st.mode = b.dataset.mode; mount(view); }));
  const body = $('#pBody', view);
  if (st.mode === 'fixtures') { render(body, fdrGrid()); return; }
  if (st.mode === 'movers') { render(body, movers()); body.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => openPlayer(model, b.dataset.pid))); return; }
  render(body, html`
    <div class="search-bar"><input type="search" id="pSearch" placeholder="Players, teams or positions" value="${st.q}" aria-label="Search players, teams or positions"></div>
    <div class="chips" id="quick">${QUICK.map(c => html`<button class="chip" type="button" data-quick="${c.id}" aria-pressed="false">${c.label}</button>`)}</div>
    <div class="tool-row"><button class="btn small" type="button" id="filterBtn">Filter</button><button class="btn small" type="button" id="sortBtn">Sort</button><div class="seg mini"><button type="button" class="${settings.view !== 'compact' ? 'on' : ''}" data-view="cards" aria-label="Card view">▦</button><button type="button" class="${settings.view === 'compact' ? 'on' : ''}" data-view="compact" aria-label="Compact list">☰</button></div></div>
    <div id="pResults"></div>`);
  let t; $('#pSearch', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); shown = 40; draw(view); }, 150); });
  view.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => { st.quick = b.dataset.quick; shown = 40; draw(view); }));
  $('#filterBtn', view).addEventListener('click', () => openFilters(view));
  $('#sortBtn', view).addEventListener('click', () => openSort(view));
  view.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { saveSettings({ view: b.dataset.view }); view.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b)); draw(view); }));
  draw(view);
}
