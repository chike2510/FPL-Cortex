// Supabase auth over GoTrue REST (no SDK, keeps the bundle small). Tokens are only proof of identity;
// entitlements (Plus) are always decided by the API after verifying the token.
import { getConfig } from './api.js';
const KEY = 'cortex_session';
let session = null; try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
const save = s => { session = s; s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); };

export function captureRedirect() {
  const h = location.hash;
  if (!h.includes('access_token=')) return false;
  const p = new URLSearchParams(h.replace(/^#/, ''));
  save({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 });
  history.replaceState(null, '', `${location.pathname}#profile`);
  return true;
}

export async function token() {
  if (!session) return null;
  if (session.expires_at - Date.now() > 60000) return session.access_token;
  const cfg = await getConfig();
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
    if (!r.ok) throw new Error();
    const o = await r.json();
    save({ access_token: o.access_token, refresh_token: o.refresh_token, expires_at: Date.now() + o.expires_in * 1000 });
    return session.access_token;
  } catch { save(null); return null; }
}

export const signedIn = () => !!session;
export function signOut() { save(null); }

export async function magicLink(email) {
  const cfg = await getConfig();
  if (!cfg.supabaseUrl) throw new Error('Sign-in is not configured yet.');
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/otp?redirect_to=${encodeURIComponent(location.origin + '/app/')}`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, create_user: true }) });
  if (!r.ok) throw new Error('Could not send the link. Check the email and try again.');
}

export async function google() {
  const cfg = await getConfig();
  if (!cfg.supabaseUrl) throw new Error('Sign-in is not configured yet.');
  location.href = `${cfg.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(location.origin + '/app/')}`;
}
