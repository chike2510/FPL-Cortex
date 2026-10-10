// Shared helpers for edge API routes. Files under api/_lib are not deployed as functions.
export const env = k => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined) || '';

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

export function clientIp(req) {
  return (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '0.0.0.0').split(',')[0].trim();
}

/** Same-origin check: allow requests whose Origin/Referer host matches the request host,
 *  any *.vercel.app preview of this project, or ALLOWED_ORIGINS (comma list). */
export function sameOrigin(req) {
  const host = req.headers.get('host') || new URL(req.url).host;
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!origin) return false;
  let o; try { o = new URL(origin); } catch { return false; }
  if (o.host === host) return true;
  const extra = env('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean);
  if (extra.some(a => { try { return new URL(a).host === o.host; } catch { return false; } })) return true;
  return /^fpl-cortex[a-z0-9-]*\.vercel\.app$/.test(o.host);
}

export async function hmacHex(algo, secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: algo }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a = '', b = '') {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
