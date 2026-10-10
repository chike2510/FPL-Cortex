// Rate limiting + quotas. Uses Upstash Redis REST when configured (UPSTASH_REDIS_REST_URL/TOKEN,
// or the Vercel Marketplace names KV_REST_API_URL/TOKEN); otherwise an in-memory best effort
// that only holds within one warm edge isolate.
import { env } from './http.js';
const mem = new Map();
const url = () => env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL');
const tok = () => env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN');
export const redisConfigured = () => !!(url() && tok());

async function incr(key, ttlSec) {
  if (redisConfigured()) {
    try {
      const r = await fetch(`${url()}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify([['INCR', key], ['EXPIRE', key, String(ttlSec), 'NX']]) });
      const out = await r.json();
      return Number(out?.[0]?.result) || 1;
    } catch { /* fall through to memory */ }
  }
  const now = Date.now(), hit = mem.get(key);
  if (!hit || hit.exp < now) { mem.set(key, { n: 1, exp: now + ttlSec * 1000 }); return 1; }
  hit.n += 1; return hit.n;
}

async function get(key) {
  if (redisConfigured()) {
    try { const r = await fetch(`${url()}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${tok()}` } }); const o = await r.json(); return Number(o?.result) || 0; } catch { /* */ }
  }
  const hit = mem.get(key); return hit && hit.exp > Date.now() ? hit.n : 0;
}

/** Sliding-ish fixed window: returns true if allowed. */
export async function rateLimit(id, limit, windowSec) {
  const n = await incr(`rl:${id}:${Math.floor(Date.now() / 1000 / windowSec)}`, windowSec + 5);
  return n <= limit;
}

export const quotaUsed = (who, gw) => get(`aiq:${who}:${gw}`);
export const quotaConsume = (who, gw) => incr(`aiq:${who}:${gw}`, 60 * 60 * 24 * 14);
