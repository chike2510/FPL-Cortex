/**
 * /api/account?route=config|me|checkout|push-subscribe|push-prefs|push-unsubscribe|push-test|link-team (Edge)
 * All entitlement decisions happen here, server-side, from the verified Supabase JWT.
 */
export const config = { runtime: 'edge' };
import { json, env, sameOrigin, clientIp } from './_lib/http.js';
import { getUser, isPlus, rest, supaConfigured } from './_lib/supa.js';
import { rateLimit, quotaUsed, redisConfigured } from './_lib/ratelimit.js';

// Display prices only (GBP). monthly/yearly = Pro (the existing Plus checkout); Starter has no checkout product yet.
const PRICES = {
  monthly: { gbp: 9.99, label: '£9.99/month' }, yearly: { gbp: 59.88, label: '£59.88/year (£4.99/mo)' },
  starter: { monthly: { gbp: 5.99, label: '£5.99/month' }, yearly: { gbp: 35.88, label: '£35.88/year (£2.99/mo)' } },
  pro: { monthly: { gbp: 9.99, label: '£9.99/month' }, yearly: { gbp: 59.88, label: '£59.88/year (£4.99/mo)' } },
};

async function lemonCheckout(user, plan, promo, extra = {}) {
  const variant = plan === 'league_pack' ? env('LEMONSQUEEZY_VARIANT_LEAGUE_PACK') : plan === 'yearly' ? env('LEMONSQUEEZY_VARIANT_YEARLY') : env('LEMONSQUEEZY_VARIANT_MONTHLY');
  if (!env('LEMONSQUEEZY_API_KEY') || !env('LEMONSQUEEZY_STORE_ID') || !variant) return { error: 'Card checkout is not live yet.' };
  const r = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', Authorization: `Bearer ${env('LEMONSQUEEZY_API_KEY')}` },
    body: JSON.stringify({ data: { type: 'checkouts', attributes: {
      checkout_data: { email: user.email, ...(promo ? { discount_code: promo } : {}), custom: { user_id: user.id, product: plan === 'league_pack' ? 'league_pack' : 'plus', promo: promo || '', ...extra } },
      product_options: { redirect_url: `${env('APP_URL') || 'https://fpl-cortex.vercel.app'}/app/#profile?upgraded=1` },
    }, relationships: { store: { data: { type: 'stores', id: String(env('LEMONSQUEEZY_STORE_ID')) } }, variant: { data: { type: 'variants', id: String(variant) } } } } }),
  });
  const o = await r.json().catch(() => ({}));
  return o?.data?.attributes?.url ? { url: o.data.attributes.url } : { error: 'Checkout could not start.' };
}

async function paystackCheckout(user, plan, promo, extra = {}) {
  const planCode = plan === 'yearly' ? env('PAYSTACK_PLAN_YEARLY') : env('PAYSTACK_PLAN_MONTHLY');
  if (!env('PAYSTACK_SECRET_KEY') || (!planCode && plan !== 'league_pack')) return { error: 'Naira checkout is not live yet.' };
  const amount = Number(plan === 'league_pack' ? env('PAYSTACK_LEAGUE_PACK_KOBO') : 0) || undefined;
  const r = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST', headers: { Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, currency: 'NGN', ...(plan === 'league_pack' ? { amount } : { plan: planCode, amount: 100 }), callback_url: `${env('APP_URL') || 'https://fpl-cortex.vercel.app'}/app/#profile?upgraded=1`, metadata: { user_id: user.id, product: plan === 'league_pack' ? 'league_pack' : 'plus', interval: plan, promo: promo || '', ...extra } }),
  });
  const o = await r.json().catch(() => ({}));
  return o?.data?.authorization_url ? { url: o.data.authorization_url } : { error: 'Checkout could not start.' };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const route = url.searchParams.get('route') || '';

  if (route === 'config') {
    return json({
      supabaseUrl: env('SUPABASE_URL') || null, supabaseAnonKey: env('SUPABASE_ANON_KEY') || null,
      vapidPublicKey: env('VAPID_PUBLIC_KEY') || null, fplProxyBase: env('PUBLIC_FPL_PROXY_BASE') || '/api/fpl',
      billing: { lemonsqueezy: !!env('LEMONSQUEEZY_API_KEY'), paystack: !!env('PAYSTACK_SECRET_KEY') }, prices: PRICES,
    }, 200, { 'Cache-Control': 'public, max-age=300' });
  }
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403);
  if (!(await rateLimit(`acct:${clientIp(req)}`, 30, 60))) return json({ error: 'Slow down' }, 429);
  const user = await getUser(req);

  if (route === 'me') {
    const plus = user ? await isPlus(user.id) : false;
    let profile = null;
    if (user) { try { profile = (await rest(`profiles?user_id=eq.${user.id}&select=fpl_entry_id,data_saver&limit=1`))?.[0] || null; } catch { /* */ } }
    return json({ user, plus, profile, auth: supaConfigured(), quotaBackend: redisConfigured() ? 'redis' : 'memory' });
  }
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  // Push alerts work per device, signed in or not. The endpoint URL is the device's unguessable capability.
  const PREF_KEYS = ['goal', 'assist', 'cs', 'cs_lost', 'red', 'pen_miss', 'bonus', 'deadline', 'prices', 'injuries'];
  const cleanPrefs = p => { const o = {}; for (const k of PREF_KEYS) o[k] = p?.[k] !== false; const tz = String(p?.tz || '').slice(0, 64); if (/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) o.tz = tz; return o; };
  const endpointOk = e => typeof e === 'string' && /^https:\/\//.test(e) && e.length < 1000;
  if (route === 'push-subscribe') {
    const s = body.subscription;
    if (!endpointOk(s?.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'Bad subscription' }, 400);
    await rest('push_subscriptions?on_conflict=endpoint', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: user?.id || null, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, fpl_entry_id: Number(body.entryId) || null, prefs: cleanPrefs(body.prefs), updated_at: new Date().toISOString() } });
    return json({ ok: true });
  }
  if (route === 'push-prefs') {
    if (!endpointOk(body.endpoint)) return json({ error: 'Bad endpoint' }, 400);
    const patch = { prefs: cleanPrefs(body.prefs), updated_at: new Date().toISOString() };
    if ('entryId' in body) patch.fpl_entry_id = Number(body.entryId) || null;
    const rows = await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(body.endpoint)}`, { method: 'PATCH', prefer: 'return=representation', body: patch });
    return json({ ok: !!rows?.length }, rows?.length ? 200 : 404);
  }
  if (route === 'push-unsubscribe') {
    if (!endpointOk(body.endpoint)) return json({ error: 'Bad endpoint' }, 400);
    await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(body.endpoint)}`, { method: 'DELETE' });
    return json({ ok: true });
  }
  if (route === 'push-test') {
    if (!endpointOk(body.endpoint) || !env('CRON_SECRET')) return json({ error: 'Bad endpoint' }, 400);
    if (!(await rateLimit(`pushtest:${clientIp(req)}`, 3, 300))) return json({ error: 'Slow down' }, 429);
    const r = await fetch(`${new URL(req.url).origin}/api/cron/live?test=1`, { method: 'POST', headers: { Authorization: `Bearer ${env('CRON_SECRET')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: body.endpoint }) });
    const o = await r.json().catch(() => ({}));
    return json({ ok: !!o.ok, pushStatus: o.pushStatus || null }, o.ok ? 200 : 502);
  }

  if (!user) return json({ error: 'SIGN_IN_REQUIRED' }, 401);

  if (route === 'link-team') {
    const entry = Number(String(body.entryId || '').replace(/\D/g, '')) || null;
    await rest('profiles?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: user.id, fpl_entry_id: entry, updated_at: new Date().toISOString() } });
    return json({ ok: true });
  }
  if (route === 'checkout') {
    const plan = ['monthly', 'yearly', 'league_pack'].includes(body.plan) ? body.plan : 'monthly';
    let promo = String(body.promo || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    if (promo) { try { const ok = await rest(`promo_codes?code=eq.${promo}&active=eq.true&select=code&limit=1`); if (!ok?.length) promo = ''; } catch { promo = ''; } }
    const extra = plan === 'league_pack' ? { league_id: String(body.leagueId || '').replace(/\D/g, '') } : {};
    if (plan === 'league_pack' && !extra.league_id) return json({ error: 'League ID required' }, 400);
    const out = body.provider === 'paystack' ? await paystackCheckout(user, plan, promo, extra) : await lemonCheckout(user, plan, promo, extra);
    return json(out, out.url ? 200 : 503);
  }
  return json({ error: 'Unknown route' }, 404);
}
