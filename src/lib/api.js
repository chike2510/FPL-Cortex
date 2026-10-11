// Data access. FPL goes through our proxy (base from server config, default /api/fpl).
import { token } from './auth.js';
let cfgPromise;
export function getConfig() {
  cfgPromise ||= fetch('/api/account?route=config').then(r => r.ok ? r.json() : {}).catch(() => ({})).then(c => ({ fplProxyBase: '/api/fpl', billing: {}, ...c }));
  return cfgPromise;
}
const mem = new Map();
export async function fpl(path, ttlSec = 60) {
  const hit = mem.get(path);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.data;
  const { fplProxyBase } = await getConfig();
  const base = fplProxyBase || '/api/fpl';
  const url = base.startsWith('/api/fpl') ? `${base}?path=${encodeURIComponent(path)}` : `${base.replace(/\/$/, '')}/${path}`;
  let r, data;
  for (let i = 0; i < 3; i++) {
    r = await fetch(url).catch(() => ({ ok: false, status: 0, json: async () => null }));
    data = await r.json().catch(() => null);
    if (r.ok && data && data.ok !== false) break;
    if (!(r.status === 403 || r.status === 429 || r.status >= 500 || !r.status) || i === 2) break;
    await new Promise(res => setTimeout(res, 900 * (i + 1)));
  }
  if (!r.ok || !data || data.ok === false) {
    if (hit) return hit.data; // older copy beats an error screen
    const e = new Error(data?.message || `FPL ${r.status}`); e.status = r.status; throw e;
  }
  mem.set(path, { at: Date.now(), data });
  return data;
}
export async function api(path, { method = 'GET', body } = {}) {
  const t = await token();
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
export const teamSearch = (q, signal) => fetch(`/api/fpl?route=team-search&query=${encodeURIComponent(q)}`, { signal }).then(r => r.json()).catch(e => e.name === 'AbortError' ? null : ({ ok: false, results: [] }));
// Fallback (c): managers in league standings this session already loaded (no extra requests).
export function leagueManagers(q) {
  const f = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const n = f(q).trim(); if (n.length < 3) return [];
  const out = new Map();
  for (const [path, { data }] of mem) {
    if (!/^leagues-classic\//.test(path)) continue;
    for (const r of data?.standings?.results || []) if (f(r.entry_name).includes(n) || f(r.player_name).includes(n)) out.set(r.entry, { id: r.entry, teamName: r.entry_name, realName: r.player_name, overallRank: null, league: data.league?.name || '' });
  }
  return [...out.values()].slice(0, 8);
}
export const news = () => fetch('/api/news').then(r => r.json()).catch(() => ({ items: [] }));
