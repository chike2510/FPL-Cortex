/**
 * /api/cron/live — live FPL push alerts (Node). Called every minute by cron-job.org with
 * `Authorization: Bearer $CRON_SECRET`. Cheap when idle: one small Supabase read, then return.
 *
 * Alerts (per subscriber, only for players in their saved squad; each toggled in prefs):
 *   goal, assist, cs (clean sheet at full time, GK/DEF), cs_lost (first goal conceded while on the pitch, GK/DEF),
 *   red, pen_miss, bonus (provisional, from BPS at full time), deadline (24h + 1h), prices (after the nightly update).
 * State lives in Supabase: live_state (meta, idx, live:<gw>, prices), entry_picks (picks cache), push_log (dedupe).
 * FPL blocks Node serverless IPs, so FPL is read through our own edge proxy ($APP_URL/api/fpl).
 *
 * Test: POST ?test=1 with {subscription:{endpoint,keys}} or {endpoint} → sends "⚽ Test goal", returns the push status.
 * Status: GET ?status=1 → which windows are open (no side effects beyond a meta refresh).
 */
import webpush from 'web-push';

export const config = { maxDuration: 60 };

const env = k => process.env[k] || '';
const APP = () => env('APP_URL') || 'https://fpl-cortex.vercel.app';
const MIN = 60e3, HOUR = 36e5;
const DEFAULT_PREFS = { goal: true, assist: true, cs: true, cs_lost: true, red: true, pen_miss: true, bonus: true, deadline: true, prices: true, injuries: true };

async function sb(path, opts = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { method: opts.method || 'GET', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.prefer ? { Prefer: opts.prefer } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const t = await r.text(); if (!r.ok) { const e = new Error(`sb ${r.status} ${t.slice(0, 160)}`); e.status = r.status; throw e; } return t ? JSON.parse(t) : null;
}
const getState = async k => (await sb(`live_state?k=eq.${encodeURIComponent(k)}&select=v`))?.[0]?.v || null;
const getStates = async ks => Object.fromEntries(((await sb(`live_state?k=in.(${ks.map(encodeURIComponent).join(',')})&select=k,v`)) || []).map(r => [r.k, r.v]));
const setState = (k, v) => sb('live_state?on_conflict=k', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { k, v, updated_at: new Date().toISOString() } });
async function fpl(path) {
  const r = await fetch(`${APP()}/api/fpl?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const e = new Error(`fpl ${r.status} ${path}`); e.status = r.status; throw e; }
  return r.json();
}

const ukParts = (t = Date.now()) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute) }; };
const fmtLocal = (ms, tz) => { try { return new Date(ms).toLocaleString('en-GB', { timeZone: tz || 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + (tz ? '' : ' UK'); } catch { return new Date(ms).toUTCString().slice(0, 22) + ' GMT'; } };
const money = c => `£${(c / 10).toFixed(1)}m`;

/** Refresh the schedule (current/next GW, kickoffs, deadline) and the player index from bootstrap + fixtures. */
async function refreshMeta(old) {
  const bs = await fpl('bootstrap-static/');
  const cur = bs.events.find(e => e.is_current) || null;
  const next = bs.events.find(e => e.is_next) || null;
  const gws = [cur?.id, next?.id].filter(Boolean);
  const fx = (await Promise.all(gws.map(g => fpl(`fixtures/?event=${g}`).catch(() => [])))).flat();
  const meta = {
    gw: cur?.id || next?.id || 1,
    next: next ? { id: next.id, deadline: Date.parse(next.deadline_time) } : null,
    kickoffs: [...new Set(fx.filter(f => f.kickoff_time && !f.finished).map(f => Date.parse(f.kickoff_time)))].sort(),
    refreshed: Date.now(), liveOpen: old?.liveOpen || false, priceDone: old?.priceDone || null, priceTried: old?.priceTried || 0,
  };
  const idx = { p: Object.fromEntries(bs.elements.map(p => [p.id, [p.web_name, p.element_type, p.team]])), t: Object.fromEntries(bs.teams.map(t => [t.id, t.short_name])) };
  await Promise.all([setState('idx', idx), setState('meta', meta)]);
  return { meta, idx };
}

/** Provisional bonus for one fixture from its BPS stat (FPL tie rules). */
function provisionalBonus(f) {
  const bps = (f.stats || []).find(s => s.identifier === 'bps'); if (!bps) return [];
  const rows = [...bps.h, ...bps.a].sort((x, y) => y.value - x.value);
  const out = []; let award = 3, i = 0;
  while (i < rows.length && award > 0) {
    const tie = rows.filter(r => r.value === rows[i].value);
    tie.forEach(r => out.push({ element: r.element, bonus: award }));
    i += tie.length; award -= tie.length;
  }
  return out;
}

async function loadSubs() {
  return (await sb('push_subscriptions?select=id,endpoint,p256dh,auth,fpl_entry_id,prefs&limit=5000')) || [];
}

/** Picks for entries in a GW, cached in entry_picks. Returns Map(entryId → picks[]). */
async function picksFor(entryIds, gw) {
  const out = new Map(); const ids = [...new Set(entryIds.filter(Boolean))]; if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await sb(`entry_picks?gw=eq.${gw}&entry_id=in.(${ids.slice(i, i + 200).join(',')})&select=entry_id,picks`);
    (rows || []).forEach(r => out.set(Number(r.entry_id), r.picks));
  }
  const missing = ids.filter(id => !out.has(id));
  for (let i = 0; i < missing.length; i += 6) {
    await Promise.all(missing.slice(i, i + 6).map(async id => {
      try {
        const d = await fpl(`entry/${id}/event/${gw}/picks/`);
        const picks = (d.picks || []).map(p => ({ e: p.element, pos: p.position, c: p.is_captain ? 1 : 0 }));
        if (!picks.length) return;
        out.set(id, picks);
        await sb('entry_picks?on_conflict=entry_id,gw', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { entry_id: id, gw, picks } }).catch(() => {});
      } catch { /* entry missing or FPL updating */ }
    }));
  }
  return out;
}

async function send(s, m) {
  try { await sb('push_log', { method: 'POST', prefer: 'return=minimal', body: { subscription_id: s.id, key: m.key } }); } catch { return 'dup'; }
  try {
    const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(m), { TTL: m.ttl || 3600, urgency: 'high' });
    return r.statusCode;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { await sb(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }).catch(() => {}); return 'gone'; }
    return e.statusCode || 'err';
  }
}

async function deliver(subs, build) {
  let sent = 0, gone = 0;
  for (let i = 0; i < subs.length; i += 10) {
    await Promise.all(subs.slice(i, i + 10).map(async s => {
      let n = 0;
      for (const m of build(s).slice(0, 40)) { if (n >= 8) break; const r = await send(s, m); if (r === 'dup') continue; n++; if (r === 201 || r === 200) sent++; if (r === 'gone') { gone++; break; } }
    }));
  }
  return { sent, gone };
}
const prefOn = (s, k) => ({ ...DEFAULT_PREFS, ...(s.prefs || {}) })[k] !== false;

/** Live match diff → alerts. */
async function runLive(meta, idx) {
  const gw = meta.gw;
  const [fixtures, live, prev] = await Promise.all([fpl(`fixtures/?event=${gw}`), fpl(`event/${gw}/live/`), getState(`live:${gw}`)]);
  const fxById = new Map(fixtures.map(f => [f.id, f]));
  const cur = { els: {}, fx: {} };
  for (const f of fixtures) cur.fx[f.id] = [f.started ? 1 : 0, f.finished_provisional ? 1 : 0];
  for (const el of live.elements || []) { const s = el.stats; cur.els[el.id] = [s.goals_scored, s.assists, s.goals_conceded, s.red_cards, s.penalties_missed, s.minutes]; }
  const liveOpen = fixtures.some(f => f.started && !f.finished_provisional);
  if (!prev) { await setState(`live:${gw}`, cur); return { seeded: true, liveOpen, events: 0 }; }

  const score = fid => { const f = fxById.get(fid); return f ? `${idx.t[f.team_h]} ${f.team_h_score ?? 0}–${f.team_a_score ?? 0} ${idx.t[f.team_a]}` : ''; };
  const fixOf = el => el.explain?.[el.explain.length - 1]?.fixture;
  const events = [];
  for (const el of live.elements || []) {
    const s = el.stats, p = prev.els[el.id] || [0, 0, 0, 0, 0, 0], type = idx.p[el.id]?.[1], fid = fixOf(el);
    for (let n = p[0] + 1; n <= s.goals_scored; n++) events.push({ kind: 'goal', el: el.id, id: n, fid });
    for (let n = p[1] + 1; n <= s.assists; n++) events.push({ kind: 'assist', el: el.id, id: n, fid });
    if ((type === 1 || type === 2) && s.minutes > 0 && p[2] === 0 && s.goals_conceded > 0) events.push({ kind: 'cs_lost', el: el.id, id: fid, fid });
    if (s.red_cards > p[3]) events.push({ kind: 'red', el: el.id, id: fid, fid });
    if (s.penalties_missed > p[4]) events.push({ kind: 'pen_miss', el: el.id, id: s.penalties_missed, fid });
  }
  for (const f of fixtures) {
    const was = prev.fx[f.id];
    if (!f.finished_provisional || !was || was[1]) continue; // only on the transition to full time we observed
    for (const el of live.elements || []) {
      const type = idx.p[el.id]?.[1]; if (type !== 1 && type !== 2) continue;
      const ex = (el.explain || []).find(x => x.fixture === f.id); if (!ex) continue;
      if ((ex.stats || []).some(st => st.identifier === 'clean_sheets' && st.value > 0)) events.push({ kind: 'cs', el: el.id, id: f.id, fid: f.id });
    }
    for (const b of provisionalBonus(f)) events.push({ kind: 'bonus', el: b.element, id: f.id, fid: f.id, bonus: b.bonus });
  }
  await setState(`live:${gw}`, cur);
  if (!events.length) return { liveOpen, events: 0 };

  const subs = (await loadSubs()).filter(s => s.fpl_entry_id);
  const picks = await picksFor(subs.map(s => Number(s.fpl_entry_id)), gw);
  const text = (ev, pk) => {
    const name = idx.p[ev.el]?.[0] || 'Your player', tag = (pk.c ? ' (C)' : '') + (pk.pos > 11 ? ' · bench' : ''), sc = score(ev.fid);
    switch (ev.kind) {
      case 'goal': return [`⚽ GOAL! ${name}${tag}`, `${sc}`];
      case 'assist': return [`🅰️ Assist: ${name}${tag}`, `${sc}`];
      case 'cs': return [`🧤 Clean sheet: ${name}${tag}`, `Full time: ${sc}`];
      case 'cs_lost': return [`💔 Clean sheet gone: ${name}${tag}`, `${sc}`];
      case 'red': return [`🟥 Red card: ${name}${tag}`, `${sc}`];
      case 'pen_miss': return [`❌ Penalty missed: ${name}${tag}`, `${sc}`];
      case 'bonus': return [`⭐ +${ev.bonus} bonus: ${name}${tag}`, `Provisional, full time: ${sc}`];
    }
  };
  const r = await deliver(subs, s => {
    const mine = new Map((picks.get(Number(s.fpl_entry_id)) || []).map(p => [p.e, p]));
    return events.filter(ev => mine.has(ev.el) && prefOn(s, ev.kind)).map(ev => { const [title, body] = text(ev, mine.get(ev.el)); return { key: `${ev.kind}:${gw}:${ev.el}:${ev.id}`, title, body, url: '/app/#live', ttl: 1800 }; });
  });
  return { liveOpen, events: events.length, ...r };
}

async function runDeadline(meta, which) {
  const subs = await loadSubs();
  const gw = meta.next.id, dl = meta.next.deadline;
  return deliver(subs.filter(s => prefOn(s, 'deadline')), s => [{
    key: `dl${which}:${gw}`, ttl: which === 1 ? 3000 : 7200,
    title: which === 1 ? `⏰ GW${gw} deadline in 1 hour` : `⏰ GW${gw} deadline in 24 hours`,
    body: `Deadline ${fmtLocal(dl, s.prefs?.tz)}. Check your captain and transfers.`, url: '/app/#team',
  }]);
}

async function runPrices(meta) {
  const bs = await fpl('bootstrap-static/');
  const now = Object.fromEntries(bs.elements.map(p => [p.id, p.now_cost]));
  const snap = await getState('prices');
  await setState('prices', now);
  if (!snap) return { seeded: true, changes: 0 };
  const changes = bs.elements.filter(p => snap[p.id] != null && snap[p.id] !== p.now_cost).map(p => ({ id: p.id, name: p.web_name, old: snap[p.id], now: p.now_cost }));
  if (!changes.length) return { changes: 0 };
  const byId = new Map(changes.map(c => [c.id, c]));
  const subs = (await loadSubs()).filter(s => s.fpl_entry_id && prefOn(s, 'prices'));
  const picks = await picksFor(subs.map(s => Number(s.fpl_entry_id)), meta.gw);
  const day = ukParts().date;
  const r = await deliver(subs, s => {
    const mine = (picks.get(Number(s.fpl_entry_id)) || []).map(p => byId.get(p.e)).filter(Boolean);
    if (!mine.length) return [];
    const up = mine.filter(c => c.now > c.old), down = mine.filter(c => c.now < c.old);
    const line = c => `${c.name} ${money(c.old)}→${money(c.now)}`;
    const title = mine.length === 1 ? `${up.length ? '📈' : '📉'} ${mine[0].name} price ${up.length ? 'rise' : 'fall'}` : `💷 ${mine.length} price changes in your squad`;
    return [{ key: `price:${day}:${mine.map(c => c.id).sort().join('-')}`.slice(0, 200), title, body: [...up.map(c => '▲ ' + line(c)), ...down.map(c => '▼ ' + line(c))].join(', '), url: '/app/#players/movers', ttl: 6 * 3600 }];
  });
  return { changes: changes.length, ...r };
}

export default async function handler(req, res) {
  const secret = env('CRON_SECRET');
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY') || !env('SUPABASE_SERVICE_ROLE_KEY')) return res.status(200).json({ skipped: 'push not configured' });
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:onovochikeziri37@gmail.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const q = req.query || {};

  if (q.test) {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let sub = b.subscription;
    if (!sub && b.endpoint) { const row = (await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(b.endpoint)}&select=endpoint,p256dh,auth&limit=1`))?.[0]; if (row) sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }; }
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ error: 'subscription required' });
    try {
      const r = await webpush.sendNotification(sub, JSON.stringify({ key: `test:${Date.now()}`, title: '⚽ Test goal', body: 'Haaland scores! This is a test alert from FPL Cortex.', url: '/app/#live' }), { TTL: 600, urgency: 'high' });
      return res.status(200).json({ ok: true, pushStatus: r.statusCode });
    } catch (e) { return res.status(200).json({ ok: false, pushStatus: e.statusCode || null, error: String(e.body || e.message).slice(0, 200) }); }
  }

  const t0 = Date.now(), now = Date.now();
  let meta = await getState('meta').catch(() => null);
  let idx = null;
  if (!meta || now - meta.refreshed > 6 * HOUR || (meta.next && now > meta.next.deadline + 5 * MIN)) ({ meta, idx } = await refreshMeta(meta));

  const inLive = meta.liveOpen || meta.kickoffs.some(k => now >= k - 2 * MIN && now <= k + 150 * MIN);
  const toDl = meta.next ? meta.next.deadline - now : -1;
  const dl24 = toDl > 23 * HOUR && toDl <= 24 * HOUR, dl1 = toDl > 0 && toDl <= HOUR;
  const uk = ukParts(now);
  const priceWin = uk.mins >= 150 && uk.mins < 360 && meta.priceDone !== uk.date && (!meta.priceTried || now - meta.priceTried >= 15 * MIN);
  const windows = { live: inLive, dl24, dl1, price: priceWin };
  if (q.status) return res.status(200).json({ ok: true, gw: meta.gw, next: meta.next, windows, kickoffsAhead: meta.kickoffs.filter(k => k > now).length, ukDate: uk.date });
  if (!inLive && !dl24 && !dl1 && !priceWin) return res.status(200).json({ ok: true, idle: true, ms: Date.now() - t0 });

  const out = { ok: true, windows };
  const patch = {};
  try {
    if (inLive) { idx = idx || await getState('idx'); const r = await runLive(meta, idx); out.live = r; patch.liveOpen = r.liveOpen; if (!r.liveOpen && meta.liveOpen) patch.refreshed = 0; }
  } catch (e) { out.liveError = e.message.slice(0, 160); }
  try { if (dl24) out.dl24 = await runDeadline(meta, 24); if (dl1) out.dl1 = await runDeadline(meta, 1); } catch (e) { out.dlError = e.message.slice(0, 160); }
  try {
    if (priceWin) { patch.priceTried = now; const r = await runPrices(meta); out.prices = r; if (r.changes || r.seeded || uk.mins >= 345) patch.priceDone = uk.date; }
  } catch (e) { out.priceError = e.message.slice(0, 160); }
  if (Object.keys(patch).length) await setState('meta', { ...meta, ...patch });
  out.ms = Date.now() - t0;
  return res.status(200).json(out);
}
