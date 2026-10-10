// Settings → Alerts: enable web push on this device and toggle each alert type.
import { html, toast, $ } from '../lib/dom.js';
import { settings, saveSettings } from '../lib/store.js';
import { api } from '../lib/api.js';

export const ALERT_TYPES = [
  ['goal', 'Goals', 'A player in your squad scores'],
  ['assist', 'Assists', 'A player in your squad assists'],
  ['cs', 'Clean sheets', 'Your GK/DEF keeps a clean sheet at full time'],
  ['cs_lost', 'Clean sheet lost', 'Your GK/DEF concedes while on the pitch'],
  ['red', 'Red cards', 'One of your players is sent off'],
  ['pen_miss', 'Penalty misses', 'One of your players misses a penalty'],
  ['bonus', 'Provisional bonus', 'Bonus points at full time'],
  ['deadline', 'Deadline reminders', '24 hours and 1 hour before, in your time'],
  ['prices', 'Price changes', 'Your players rise or fall overnight'],
  ['injuries', 'Injury news', 'New flags on your players (daily)'],
];
const prefs = () => { const p = { ...Object.fromEntries(ALERT_TYPES.map(([k]) => [k, true])), ...(settings.alerts || {}) }; try { p.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* */ } return p; };
const b64ToU8 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function currentSub() { if (!supported()) return null; const reg = await navigator.serviceWorker.getRegistration('/'); return reg ? reg.pushManager.getSubscription() : null; }

async function enable(cfg) {
  if (!supported()) throw new Error(/iphone|ipad/i.test(navigator.userAgent) ? 'On iPhone, add Cortex to your Home Screen first, then turn alerts on from the app.' : 'This browser does not support notifications. Try Chrome.');
  if (!cfg.vapidPublicKey) throw new Error('Alerts are not switched on yet.');
  if (Notification.permission === 'denied') throw new Error('Notifications are blocked. Tap the lock icon by the address bar → Permissions → Notifications → Allow.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(cfg.vapidPublicKey) });
  const r = await api('/api/account?route=push-subscribe', { method: 'POST', body: { subscription: sub.toJSON(), entryId: settings.entryId || null, prefs: prefs() } });
  if (!r.ok) throw new Error('Could not save alerts. Try again in a moment.');
  saveSettings({ pushOn: true });
  return sub;
}

export function alertsCard() {
  const p = prefs();
  return html`<div class="card" id="alertsCard"><span class="eyebrow">Alerts</span>
    <div class="toggle-row"><span><strong>Notifications</strong><br><small class="muted" id="pushState">Live goals, clean sheets, deadlines and price changes for your squad</small></span><button class="btn small primary" type="button" id="pushBtn">Turn on</button></div>
    ${ALERT_TYPES.map(([k, label, hint]) => html`<div class="toggle-row"><span><strong>${label}</strong><br><small class="muted">${hint}</small></span><button class="switch" role="switch" type="button" data-alert="${k}" aria-checked="${String(p[k] !== false)}" aria-label="${label}"></button></div>`)}
    <button class="btn block" type="button" id="pushTest" hidden>Send a test alert</button>
    ${settings.entryId ? '' : html`<p class="muted small">Add your FPL team above so match and price alerts know your players.</p>`}</div>`;
}

export async function syncAlertsTeam() {
  const sub = await currentSub().catch(() => null);
  if (sub) api('/api/account?route=push-prefs', { method: 'POST', body: { endpoint: sub.endpoint, entryId: settings.entryId || null, prefs: prefs() } });
}

export async function bindAlerts(view, cfg) {
  const btn = $('#pushBtn', view), state = $('#pushState', view), test = $('#pushTest', view);
  const show = sub => {
    const on = !!sub && Notification.permission === 'granted';
    btn.textContent = on ? 'On' : 'Turn on'; btn.classList.toggle('primary', !on); test.hidden = !on;
    if (on) state.textContent = 'On for this device'; else if (supported() && Notification.permission === 'denied') state.textContent = 'Blocked in browser settings';
  };
  let sub = await currentSub().catch(() => null);
  show(sub);
  // Keep the server copy fresh (team, prefs, timezone) whenever Settings opens.
  if (sub && Notification.permission === 'granted') api('/api/account?route=push-subscribe', { method: 'POST', body: { subscription: sub.toJSON(), entryId: settings.entryId || null, prefs: prefs() } });

  btn.addEventListener('click', async () => {
    if (sub && Notification.permission === 'granted') {
      if (!confirm('Turn off alerts on this device?')) return;
      await api('/api/account?route=push-unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe().catch(() => {}); sub = null; saveSettings({ pushOn: false }); show(null); toast('Alerts off'); return;
    }
    btn.disabled = true; btn.textContent = '…';
    try { sub = await enable(cfg); show(sub); toast('Alerts on'); } catch (err) { show(sub); toast(err.message); } finally { btn.disabled = false; }
  });
  view.querySelectorAll('[data-alert]').forEach(sw => sw.addEventListener('click', async e => {
    const k = e.currentTarget.dataset.alert, next = e.currentTarget.getAttribute('aria-checked') !== 'true';
    e.currentTarget.setAttribute('aria-checked', String(next));
    saveSettings({ alerts: { ...(settings.alerts || {}), [k]: next } });
    if (sub) { const r = await api('/api/account?route=push-prefs', { method: 'POST', body: { endpoint: sub.endpoint, prefs: prefs() } }); if (!r.ok) toast('Could not save. Try again.'); }
  }));
  test.addEventListener('click', async () => {
    if (!sub) return;
    test.disabled = true;
    const r = await api('/api/account?route=push-test', { method: 'POST', body: { endpoint: sub.endpoint } });
    test.disabled = false;
    toast(r.ok ? 'Test sent. It should arrive in a few seconds.' : r.status === 429 ? 'Wait a few minutes before another test.' : 'Test failed. Turn alerts off and on again.');
  });
}
