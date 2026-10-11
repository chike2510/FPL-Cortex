// Server-side FPL fetch + cached model for edge routes.
import { env } from './http.js';
import { buildModel } from '../../shared/xp.js';
const FPL = 'https://fantasy.premierleague.com/api';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; FPL-Cortex/2.0; +https://fpl-cortex.vercel.app)', Accept: 'application/json', 'Accept-Language': 'en-GB,en;q=0.9' };

const BROWSER = { ...HEADERS, 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', Referer: 'https://fantasy.premierleague.com/' };
const transient = s => s === 403 || s === 429 || s >= 500 || !s;
async function once(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { data = null; }
  return { ok: r.ok && data !== null, status: r.status || (data === null ? 502 : 0), data };
}
// FPL's CDN throws short bursts of 403/429/503 (bot checks, nightly updates). Retry with a
// browser-style request, then the optional Worker upstream, before giving up.
export async function fetchFpl(path, base) {
  const p = String(path).replace(/^\/+/, '');
  const b = (base || env('FPL_UPSTREAM_BASE') || FPL).replace(/\/$/, '');
  let r;
  try { r = await once(`${b}/${p}`, HEADERS); } catch { r = { ok: false, status: 0 }; }
  if (r.ok || !transient(r.status)) return r;
  await new Promise(res => setTimeout(res, 350));
  try { r = await once(`${b}/${p}`, BROWSER); } catch { r = { ok: false, status: r.status || 0 }; }
  if (r.ok || base) return r;
  const alt = env('FPL_UPSTREAM_BASE') ? FPL : env('FPL_FALLBACK_BASE');
  if (alt) { try { const a = await once(`${alt.replace(/\/$/, '')}/${p}`, BROWSER); if (a.ok) return a; } catch { /* keep r */ } }
  return r;
}

let cache = { at: 0, model: null };
export async function getModel() {
  if (cache.model && Date.now() - cache.at < 5 * 60 * 1000) return cache.model;
  const [bs, fx] = await Promise.all([fetchFpl('bootstrap-static/'), fetchFpl('fixtures/')]);
  if (!bs.ok || !fx.ok) throw new Error(`FPL_UNAVAILABLE_${bs.status}_${fx.status}`);
  cache = { at: Date.now(), model: buildModel(bs.data, fx.data) };
  return cache.model;
}

export async function getSquad(entryId, gw) {
  const id = String(entryId || '').replace(/\D/g, '');
  if (!id) return null;
  const r = await fetchFpl(`entry/${id}/event/${gw}/picks/`);
  if (!r.ok) return null;
  return { picks: r.data.picks || [], bank: (r.data.entry_history?.bank || 0) / 10, points: r.data.entry_history?.points, rank: r.data.entry_history?.overall_rank, chip: r.data.active_chip };
}

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function findPlayer(model, name) {
  const n = norm(name);
  if (!n) return null;
  return model.players.find(p => norm(p.web_name) === n)
    || model.players.find(p => norm(`${p.first_name} ${p.second_name}`) === n)
    || model.players.filter(p => norm(`${p.first_name} ${p.second_name} ${p.web_name}`).includes(n)).sort((a, b) => b.selected - a.selected)[0]
    || null;
}
