/**
 * /api/account?route=config|me|checkout|push-subscribe|push-unsubscribe|link-team (Edge)
 * All entitlement decisions happen here, server-side, from the verified Supabase JWT.
 */
export const config = { runtime: 'edge' };
import { json, env, sameOrigin, clientIp } from './_lib/http.js';
import { getUser, isPlus, rest, supaConfigured } from './_lib/supa.js';
import { rateLimit, quotaUsed, redisConfigured } from './_lib/ratelimit.js';

const PRICES = { monthly: { gbp: 4.99, label: '£4.99/month' }, yearly: { gbp: 47.90, label: '£47.90/year' } };

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
  if (!user) return json({ error: 'SIGN_IN_REQUIRED' }, 401);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

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
  if (route === 'push-subscribe') {
    const s = body.subscription;
    if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'Bad subscription' }, 400);
    await rest('push_subscriptions?on_conflict=endpoint', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, fpl_entry_id: Number(body.entryId) || null, prefs: { deadline: true, injuries: true, prices: true, ...(body.prefs || {}) } } });
    return json({ ok: true });
  }
  if (route === 'push-unsubscribe') {
    await rest(`push_subscriptions?user_id=eq.${user.id}&endpoint=eq.${encodeURIComponent(String(body.endpoint || ''))}`, { method: 'DELETE' });
    return json({ ok: true });
  }
  return json({ error: 'Unknown route' }, 404);
}
