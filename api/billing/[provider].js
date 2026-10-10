/**
 * Billing webhooks (Edge): /api/billing/lemonsqueezy and /api/billing/paystack.
 * Both verify the provider's HMAC signature over the raw body, de-duplicate by event id,
 * and write to the server-side `subscriptions` / `league_packs` / `promo_redemptions` tables.
 */
export const config = { runtime: 'edge' };
import { json, env, hmacHex, safeEqual } from '../_lib/http.js';
import { rest } from '../_lib/supa.js';


async function once(provider, eventId, payload) {
  try { await rest('webhook_events', { method: 'POST', body: { provider, event_id: eventId, payload } }); return true; }
  catch (e) { if (String(e.message).includes('409') || String(e.message).includes('23505')) return false; throw e; }
}

async function recordPromo(code, userId, provider, orderId, amountMinor, currency) {
  if (!code) return;
  const rows = await rest(`promo_codes?code=eq.${encodeURIComponent(code)}&select=code,rev_share_pct&limit=1`).catch(() => []);
  if (!rows?.length) return;
  await rest('promo_redemptions', { method: 'POST', body: { code, user_id: userId, provider, order_id: String(orderId), amount_minor: amountMinor || 0, currency: currency || 'GBP', rev_share_minor: Math.round((amountMinor || 0) * Number(rows[0].rev_share_pct || 0) / 100) } }).catch(() => {});
}

async function upsertSub(row) {
  await rest('subscriptions?on_conflict=provider,provider_subscription_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { ...row, updated_at: new Date().toISOString() } });
}

async function lemonsqueezy(req) {
  const raw = await req.text();
  const secret = env('LEMONSQUEEZY_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'not configured' }, 503);
  const sig = req.headers.get('x-signature') || '';
  if (!safeEqual(await hmacHex('SHA-256', secret, raw), sig)) return json({ error: 'bad signature' }, 401);
  const evt = JSON.parse(raw);
  const name = evt.meta?.event_name || '';
  const custom = evt.meta?.custom_data || {};
  const a = evt.data?.attributes || {};
  const userId = custom.user_id;
  if (!userId) return json({ ok: true, ignored: 'no user' });
  if (!(await once('lemonsqueezy', `${name}:${evt.data?.id}:${a.updated_at || ''}`, { name, id: evt.data?.id }))) return json({ ok: true, duplicate: true });

  if (name.startsWith('subscription_')) {
    await upsertSub({ user_id: userId, provider: 'lemonsqueezy', provider_subscription_id: String(evt.data.id), provider_customer_id: String(a.customer_id || ''), plan: 'plus', interval: /year/i.test(a.variant_name || '') ? 'yearly' : 'monthly', status: a.status === 'cancelled' && a.ends_at && Date.parse(a.ends_at) > Date.now() ? 'active' : a.status, current_period_end: a.ends_at || a.renews_at || null });
  }
  if (name === 'order_created') {
    const total = Number(a.total) || 0;
    if (custom.product === 'league_pack' && custom.league_id) {
      await rest('league_packs?on_conflict=league_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { league_id: Number(custom.league_id), admin_user_id: userId, status: 'active', provider: 'lemonsqueezy', provider_order_id: String(evt.data.id), period_end: new Date(Date.now() + 365 * 864e5).toISOString() } });
    }
    await recordPromo(custom.promo, userId, 'lemonsqueezy', evt.data.id, total, a.currency);
  }
  return json({ ok: true });
}

async function paystack(req) {
  const raw = await req.text();
  const secret = env('PAYSTACK_SECRET_KEY');
  if (!secret) return json({ error: 'not configured' }, 503);
  const sig = req.headers.get('x-paystack-signature') || '';
  if (!safeEqual(await hmacHex('SHA-512', secret, raw), sig)) return json({ error: 'bad signature' }, 401);
  const evt = JSON.parse(raw);
  const d = evt.data || {};
  const meta = typeof d.metadata === 'string' ? JSON.parse(d.metadata || '{}') : (d.metadata || {});
  const userId = meta.user_id;
  const subCode = d.subscription_code || d.subscription?.subscription_code || '';
  if (!(await once('paystack', `${evt.event}:${d.id || d.reference || subCode}`, { event: evt.event, id: d.id }))) return json({ ok: true, duplicate: true });

  if (evt.event === 'charge.success' && userId) {
    if (meta.product === 'league_pack' && meta.league_id) {
      await rest('league_packs?on_conflict=league_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { league_id: Number(meta.league_id), admin_user_id: userId, status: 'active', provider: 'paystack', provider_order_id: String(d.reference), period_end: new Date(Date.now() + 365 * 864e5).toISOString() } });
    } else {
      const days = meta.interval === 'yearly' ? 366 : 31;
      await upsertSub({ user_id: userId, provider: 'paystack', provider_subscription_id: String(d.plan?.plan_code ? `${d.customer?.customer_code}:${d.plan.plan_code}` : d.reference), provider_customer_id: String(d.customer?.customer_code || ''), plan: 'plus', interval: meta.interval === 'yearly' ? 'yearly' : 'monthly', status: 'active', current_period_end: new Date(Date.now() + days * 864e5).toISOString() });
    }
    await recordPromo(meta.promo, userId, 'paystack', d.reference, d.amount, d.currency);
  }
  if (['subscription.disable', 'subscription.not_renew'].includes(evt.event) && d.customer?.customer_code && d.plan?.plan_code) {
    // Keep access until the period ends; just stop renewal.
    await rest(`subscriptions?provider=eq.paystack&provider_subscription_id=eq.${encodeURIComponent(`${d.customer.customer_code}:${d.plan.plan_code}`)}`, { method: 'PATCH', body: { status: evt.event === 'subscription.disable' ? 'cancelled' : 'active', updated_at: new Date().toISOString() } });
  }
  return json({ ok: true });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const provider = new URL(req.url).pathname.split('/').pop();
  try {
    if (provider === 'lemonsqueezy') return await lemonsqueezy(req);
    if (provider === 'paystack') return await paystack(req);
    return json({ error: 'unknown provider' }, 404);
  } catch (e) {
    return json({ error: 'webhook failed', detail: String(e.message).slice(0, 120) }, 500);
  }
}
