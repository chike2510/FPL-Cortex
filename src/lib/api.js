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
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || data.ok === false) { const e = new Error(data?.message || `FPL ${r.status}`); e.status = r.status; throw e; }
  mem.set(path, { at: Date.now(), data });
  return data;
}
export async function api(path, { method = 'GET', body } = {}) {
  const t = await token();
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
export const teamSearch = q => fetch(`/api/fpl?route=team-search&query=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => ({ results: [] }));
export const news = () => fetch('/api/news').then(r => r.json()).catch(() => ({ items: [] }));
