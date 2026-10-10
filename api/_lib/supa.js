// Minimal Supabase helpers over REST (edge-compatible, no SDK).
import { env } from './http.js';

export const supaConfigured = () => !!(env('SUPABASE_URL') && env('SUPABASE_ANON_KEY'));

/** Verify the caller's Supabase JWT server-side by asking GoTrue. Returns the user or null. */
export async function getUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !supaConfigured()) return null;
  try {
    const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: u.email || '' } : null;
  } catch { return null; }
}

/** Service-role REST call (server only). */
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!env('SUPABASE_URL') || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`SUPABASE_${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Server-side entitlement check. Plus = an active/trialing subscription not past its period end. */
export async function isPlus(userId) {
  if (!userId || !env('SUPABASE_SERVICE_ROLE_KEY')) return false;
  try {
    const rows = await rest(`subscriptions?user_id=eq.${userId}&status=in.(active,on_trial,trialing,past_due)&select=status,current_period_end&limit=5`);
    const now = Date.now();
    return (rows || []).some(r => !r.current_period_end || new Date(r.current_period_end).getTime() > now);
  } catch { return false; }
}

export async function entitlement(req) {
  const user = await getUser(req);
  return { user, plus: user ? await isPlus(user.id) : false };
}
