// Local squad state: the user's 15 (11 starters + 4 bench), captaincy, chip preview and planned transfers.
// Seeded from the official FPL picks (or an auto-built draft) and persisted in localStorage.
const KEY = 'cortex_v2_squad';
const LIMITS = { 1: [1, 1], 2: [3, 5], 3: [2, 5], 4: [1, 3] }; // starters per element_type [min, max]
const SQUAD_MAX = { 1: 2, 2: 5, 3: 5, 4: 3 };

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
export const saveSquad = st => { localStorage.setItem(KEY, JSON.stringify(st)); document.dispatchEvent(new CustomEvent('cortex:squad')); };
export const clearSquad = () => localStorage.removeItem(KEY);

/** Squad for an entry (official picks) or the saved draft squad when there is no entry. */
export function loadSquad(entry, model) {
  const saved = read();
  if (!entry?.picks) return saved?.key === 'draft' ? saved : null;
  const picks = [...entry.picks.picks].sort((a, b) => a.position - b.position);
  const order = picks.map(p => p.element).filter(id => model.byId.has(id));
  const base = { order, captain: picks.find(p => p.is_captain)?.element ?? order[0], vice: picks.find(p => p.is_vice_captain)?.element ?? order[1] };
  const key = `entry:${entry.entry.id}:${entry.picks.gw}`;
  if (saved?.key === key && saved.order?.length === 15 && saved.order.every(id => model.byId.has(id))) return saved;
  const st = { key, base, ...base, bank: entry.bank, baseBank: entry.bank, moves: [], chip: null, ft: 1 };
  saveSquad(st);
  return st;
}

export function draftSquad(ids, bank) {
  const st = { key: 'draft', base: null, order: ids, captain: ids[0], vice: ids[1], bank, baseBank: bank, moves: [], chip: null, ft: 1 };
  return st;
}

const counts = (ids, model) => { const c = { 1: 0, 2: 0, 3: 0, 4: 0 }; ids.forEach(id => { const p = model.byId.get(id); if (p) c[p.element_type]++; }); return c; };
export function validXI(ids, model) {
  if (ids.length !== 11) return false;
  const c = counts(ids, model);
  return Object.entries(LIMITS).every(([t, [lo, hi]]) => c[t] >= lo && c[t] <= hi);
}
export const formation = (st, model) => { const c = counts(st.order.slice(0, 11), model); return `${c[2]}-${c[3]}-${c[4]}`; };

/** Can a and b trade places? Starter<->bench must leave a legal XI; bench<->bench reorders outfield subs (bench GK stays first). */
export function canSwap(st, model, a, b) {
  const ia = st.order.indexOf(a), ib = st.order.indexOf(b);
  if (ia < 0 || ib < 0 || ia === ib) return false;
  if (ia < 11 && ib < 11) return false;
  const ta = model.byId.get(a)?.element_type, tb = model.byId.get(b)?.element_type;
  if (ia >= 11 && ib >= 11) return ta !== 1 && tb !== 1;
  const next = [...st.order]; next[ia] = b; next[ib] = a;
  return validXI(next.slice(0, 11), model);
}

export function swap(st, model, a, b) {
  if (!canSwap(st, model, a, b)) return false;
  const ia = st.order.indexOf(a), ib = st.order.indexOf(b);
  st.order[ia] = b; st.order[ib] = a;
  // keep the bench GK in the first bench slot
  const bench = st.order.slice(11); const gk = bench.find(id => model.byId.get(id)?.element_type === 1);
  if (gk) st.order = [...st.order.slice(0, 11), gk, ...bench.filter(id => id !== gk)];
  fixArmband(st, model);
  return true;
}

function fixArmband(st, model) {
  const xi = st.order.slice(0, 11);
  const best = [...xi].sort((x, y) => (model.byId.get(y)?.xp || 0) - (model.byId.get(x)?.xp || 0));
  if (!xi.includes(st.captain)) st.captain = xi.includes(st.vice) ? st.vice : best[0];
  if (!xi.includes(st.vice) || st.vice === st.captain) st.vice = best.find(id => id !== st.captain);
}

export function setArmband(st, model, id, role) {
  if (!st.order.slice(0, 11).includes(id)) return false;
  if (role === 'vice') { if (id === st.captain) st.captain = st.vice; st.vice = id; }
  else { if (id === st.vice) st.vice = st.captain; st.captain = id; }
  fixArmband(st, model);
  return true;
}

/** Why a transfer is not allowed (or '' when it is). Uses current price as the selling price. */
export function transferBlock(st, model, outId, inId) {
  const o = model.byId.get(outId), n = model.byId.get(inId);
  if (!o || !n) return 'Unknown player';
  if (st.order.includes(inId)) return 'Already in your squad';
  if (o.element_type !== n.element_type) return `Must be a ${o.pos}`;
  if (n.price > o.price + st.bank + 1e-9) return `Over budget by £${(n.price - o.price - st.bank).toFixed(1)}m`;
  const club = st.order.filter(id => id !== outId && model.byId.get(id)?.team === n.team).length;
  if (club >= 3) return `Max 3 from ${n.teamShort}`;
  return '';
}

export function transfer(st, model, outId, inId, gw) {
  if (transferBlock(st, model, outId, inId)) return false;
  const o = model.byId.get(outId), n = model.byId.get(inId);
  st.order[st.order.indexOf(outId)] = inId;
  if (st.captain === outId) st.captain = inId;
  if (st.vice === outId) st.vice = inId;
  st.bank = Math.round((st.bank + o.price - n.price) * 10) / 10;
  st.moves.push({ gw, out: outId, in: inId, outPrice: o.price, inPrice: n.price });
  fixArmband(st, model);
  return true;
}

export function undoLast(st, model) {
  const m = st.moves.pop(); if (!m) return false;
  const i = st.order.indexOf(m.in); if (i >= 0) st.order[i] = m.out;
  if (st.captain === m.in) st.captain = m.out;
  if (st.vice === m.in) st.vice = m.out;
  st.bank = Math.round((st.bank - m.outPrice + m.inPrice) * 10) / 10;
  fixArmband(st, model);
  return true;
}

export function resetSquad(st) {
  if (!st.base) return st;
  Object.assign(st, { ...st.base, order: [...st.base.order], bank: st.baseBank, moves: [], chip: null, wildcard: false });
  return st;
}

export const hits = st => st.wildcard ? 0 : Math.max(0, st.moves.length - (st.ft || 1)) * 4;

/** Projection, rating and captain points for the current local squad. */
export function metrics(st, model) {
  const P = id => model.byId.get(id);
  const xi = st.order.slice(0, 11).map(P).filter(Boolean), bench = st.order.slice(11).map(P).filter(Boolean);
  const cap = P(st.captain);
  const capMult = st.chip === '3xc' ? 3 : 2;
  const base = xi.reduce((s, p) => s + p.xp, 0) + (st.chip === 'bboost' ? bench.reduce((s, p) => s + p.xp, 0) : 0);
  const projected = base + (cap ? cap.xp * (capMult - 1) : 0) - hits(st);
  const rating = Math.round(Math.max(0, Math.min(100, projected)));
  const h3 = xi.reduce((s, p) => s + model.horizon(p, 3).reduce((a, g) => a + g.xp, 0), 0);
  return { xi, bench, cap, projected, rating, capPts: cap ? cap.xp * capMult : 0, h3, value: [...xi, ...bench].reduce((s, p) => s + p.price, 0) };
}

/** Greedy squad builder (ported from classic buildSquad). priority: value | form | fixtures | wildcard */
export function buildSquad(model, budget = 100, priority = 'value') {
  const score = p => priority === 'form' ? p.form * (2 - p.avgFDR / 5) : priority === 'fixtures' ? p.xp * (2 - p.avgFDR / 5)
    : priority === 'wildcard' ? model.horizon(p, 5).reduce((s, g) => s + g.xp, 0) : p.xp / p.price;
  const elig = model.players.filter(p => p.minutes > 90 && p.status === 'a').map(p => ({ p, s: score(p) })).sort((a, b) => b.s - a.s).map(x => x.p);
  const need = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const sel = [], club = {}; let spent = 0;
  const cheapest = t => Math.min(...model.players.filter(p => p.element_type === t).map(p => p.price));
  const reserve = () => Object.entries(need).reduce((s, [t, n]) => s + Math.max(0, n - sel.filter(p => p.element_type === +t).length) * cheapest(+t), 0);
  for (const p of elig) {
    if (sel.length >= 15) break;
    const t = p.element_type;
    if (sel.filter(x => x.element_type === t).length >= SQUAD_MAX[t] || (club[p.team] || 0) >= 3) continue;
    if (spent + p.price + reserve() - cheapest(t) > budget + 1e-9) continue;
    sel.push(p); club[p.team] = (club[p.team] || 0) + 1; spent += p.price;
  }
  for (const t of [1, 2, 3, 4]) { // fill any gap with the cheapest legal option
    while (sel.filter(p => p.element_type === t).length < need[t]) {
      const c = model.players.filter(p => p.element_type === t && !sel.includes(p) && (club[p.team] || 0) < 3).sort((a, b) => a.price - b.price || b.xp - a.xp)[0];
      if (!c) break; sel.push(c); club[c.team] = (club[c.team] || 0) + 1; spent += c.price;
    }
  }
  if (sel.length < 15) return null;
  // best legal XI: 1 GK, then 3/2/1 minimums, then highest xP outfielders
  const by = t => sel.filter(p => p.element_type === t).sort((a, b) => b.xp - a.xp);
  const xi = [by(1)[0], ...by(2).slice(0, 3), ...by(3).slice(0, 2), ...by(4).slice(0, 1)];
  const rest = sel.filter(p => p.element_type !== 1 && !xi.includes(p)).sort((a, b) => b.xp - a.xp);
  xi.push(...rest.slice(0, 4));
  const bench = [by(1)[1], ...rest.slice(4)];
  const order = [...xi.sort((a, b) => a.element_type - b.element_type), ...bench].map(p => p.id);
  const cap = [...xi].sort((a, b) => b.xp - a.xp);
  return { ids: order, captain: cap[0].id, vice: cap[1].id, spent: Math.round(spent * 10) / 10, bank: Math.round((budget - spent) * 10) / 10 };
}
