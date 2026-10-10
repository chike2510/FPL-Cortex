/**
 * /api/cron/notify — daily backup push: deadline (shares the dl24 key with /api/cron/live so it never doubles), injury flags, likely price changes (Node).
 * Triggered by Vercel Cron (vercel.json; Hobby plan = once a day) or any external scheduler
 * calling it with `Authorization: Bearer $CRON_SECRET`.
 * FPL blocks Node serverless IPs, so FPL data is read through our own edge proxy at $APP_URL/api/fpl.
 */
import webpush from 'web-push';

const env = k => process.env[k] || '';
async function sb(path, opts = {}) {
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { method: opts.method || 'GET', headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json', ...(opts.prefer ? { Prefer: opts.prefer } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`sb ${r.status} ${t.slice(0, 120)}`); return t ? JSON.parse(t) : null;
}
const fpl = async path => { const r = await fetch(`${env('APP_URL') || 'https://fpl-cortex.vercel.app'}/api/fpl?path=${encodeURIComponent(path)}`); if (!r.ok) throw new Error(`fpl ${r.status}`); return r.json(); };

export default async function handler(req, res) {
  if (!env('CRON_SECRET') || req.headers.authorization !== `Bearer ${env('CRON_SECRET')}`) return res.status(401).json({ error: 'unauthorized' });
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY') || !env('SUPABASE_SERVICE_ROLE_KEY')) return res.status(200).json({ skipped: 'push not configured' });
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:hello@fpl-cortex.app', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

  const bs = await fpl('bootstrap-static/');
  const next = bs.events.find(e => e.is_next);
  const cur = bs.events.find(e => e.is_current) || next;
  const players = new Map(bs.elements.map(p => [p.id, p]));
  const hoursToDeadline = next ? (Date.parse(next.deadline_time) - Date.now()) / 36e5 : 999;
  const subs = await sb('push_subscriptions?select=id,endpoint,p256dh,auth,fpl_entry_id,prefs&limit=2000');
  let sent = 0, removed = 0;

  for (const s of subs || []) {
    const msgs = [];
    if (s.prefs?.deadline !== false && hoursToDeadline > 0 && hoursToDeadline <= 24) msgs.push({ key: `dl24:${next.id}`, title: `⏰ GW${next.id} deadline in ${Math.round(hoursToDeadline)}h`, body: 'Check your captain and transfers before the deadline.', url: '/app/#team' });
    if (s.fpl_entry_id && cur) {
      try {
        const picks = (await fpl(`entry/${s.fpl_entry_id}/event/${cur.id}/picks/`)).picks || [];
        for (const pk of picks) {
          const p = players.get(pk.element); if (!p) continue;
          const fresh = p.news_added && Date.now() - Date.parse(p.news_added) < 26 * 36e5;
          if (s.prefs?.injuries !== false && fresh && p.status !== 'a') msgs.push({ key: `inj:${p.id}:${p.news_added}`, title: `${p.web_name}: ${p.chance_of_playing_next_round ?? 0}% chance`, body: String(p.news || 'Flagged').slice(0, 120), url: '/app/#team' });
          const pct = parseFloat(p.price_change_percent);
          if (s.prefs?.prices !== false && Math.abs(pct) >= 100) msgs.push({ key: `price:${p.id}:${new Date().toISOString().slice(0, 10)}`, title: `${p.web_name} price ${pct > 0 ? 'rise' : 'fall'} likely tonight`, body: `£${(p.now_cost / 10).toFixed(1)}m now.`, url: '/app/#players' });
        }
      } catch { /* entry fetch failed; skip squad alerts */ }
    }
    for (const m of msgs.slice(0, 4)) {
      try { await sb('push_log', { method: 'POST', body: { subscription_id: s.id, key: m.key } }); } catch { continue; } // unique => already sent
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(m)); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await sb(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }).catch(() => {}); removed++; break; } }
    }
  }
  return res.status(200).json({ ok: true, subscriptions: subs?.length || 0, sent, removed });
}
