import { html, render, toast, $ } from '../lib/dom.js';
import { settings, saveSettings, getMe } from '../lib/store.js';
import { api, getConfig } from '../lib/api.js';
import { signedIn, magicLink, google, signOut } from '../lib/auth.js';
import { openPlus } from '../ui/plus.js';
import { teamSearchBox, bindTeamSearch } from '../ui/onboard.js';

const b64ToU8 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };

async function enablePush(cfg) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser does not support notifications.');
  if (!cfg.vapidPublicKey) throw new Error('Alerts are not switched on yet.');
  if (!signedIn()) throw new Error('Sign in first so alerts follow your account.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were blocked.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(cfg.vapidPublicKey) });
  const r = await api('/api/account?route=push-subscribe', { method: 'POST', body: { subscription: sub.toJSON(), entryId: settings.entryId } });
  if (!r.ok) throw new Error('Could not save alerts.');
}

export async function mount(view) {
  const [me, cfg] = await Promise.all([getMe(true), getConfig()]);
  const upgraded = location.hash.includes('upgraded=1');
  render(view, html`
    ${upgraded ? html`<div class="card"><h3>Thanks!</h3><p class="muted">Your payment is processing. Plus switches on as soon as the provider confirms it (usually under a minute).</p></div>` : ''}
    <div class="card"><span class="eyebrow">Account</span>
      ${me.user ? html`<div class="card-head"><h3>${me.user.email}</h3>${me.plus ? html`<span class="tag">Plus</span>` : html`<span class="muted">Free</span>`}</div><button class="btn small" type="button" id="signOut">Sign out</button>`
        : me.auth ? html`<p class="muted">Sign in to keep Plus and alerts on every device.</p><form class="inline-form" id="mlForm"><input type="email" id="mlEmail" placeholder="you@example.com" required autocomplete="email"><button class="btn primary" type="submit">Email me a link</button></form><button class="btn block" type="button" id="gBtn">Continue with Google</button>`
        : html`<p class="muted">Accounts are coming soon. Everything free works without one.</p>`}
    </div>
    ${me.plus ? '' : html`<div class="card"><div class="card-head"><h3>Cortex Plus</h3><span class="muted">£4.99/mo · £47.90/yr</span></div><p class="muted">Captain confidence, transfer projections, 5-GW planner, unlimited Ask and alerts.</p><button class="btn primary" type="button" id="plusBtn">See Plus</button></div>`}
    <div class="card"><span class="eyebrow">Your FPL team</span>
      ${settings.entryId ? html`<p class="small">Current Team ID <b>${settings.entryId}</b></p>` : ''}${teamSearchBox({ id: 'pt', button: 'Save', placeholder: 'Team name, manager or Team ID' })}
      <p class="muted small">Cortex reads public FPL data only. It never asks for your FPL password.</p></div>
    <div class="card"><span class="eyebrow">Settings</span>
      <div class="toggle-row"><span><strong>Data saver</strong><br><small class="muted">No images, slower live refresh</small></span><button class="switch" role="switch" type="button" id="dsToggle" aria-checked="${String(!!settings.dataSaver)}" aria-label="Data saver"></button></div>
      <div class="toggle-row"><span><strong>Install app</strong><br><small class="muted">Add Cortex to your home screen</small></span><button class="btn small" type="button" id="installBtn">Install</button></div>
      <div class="toggle-row"><span><strong>Alerts</strong><br><small class="muted">Deadline reminders, injury flags, price changes</small></span><button class="btn small" type="button" id="pushBtn">Turn on</button></div></div>
    <div class="card"><span class="eyebrow">Add-ons</span>
      <a class="row-card" href="#draft"><span class="row-kit">✎</span><span class="row-main"><strong>FPL Draft</strong><small>League standings and squads for Draft leagues</small></span><span class="row-stat">›</span></a>
      <a class="row-card" href="#live"><span class="row-kit">🏆</span><span class="row-main"><strong>League Pack</strong><small>Weekly recap & awards for your mini-league (open a league in Live)</small></span><span class="row-stat">›</span></a>
      <a class="row-card" href="/classic/"><span class="row-kit">◷</span><span class="row-main"><strong>Classic Cortex</strong><small>The previous version, kept as a fallback</small></span><span class="row-stat">›</span></a></div>
    <p class="foot-note">FPL Cortex is unofficial and not affiliated with the Premier League or Fantasy Premier League.</p>`);

  $('#signOut', view)?.addEventListener('click', () => { signOut(); getMe(true); mount(view); });
  $('#mlForm', view)?.addEventListener('submit', async e => { e.preventDefault(); try { await magicLink($('#mlEmail', view).value); toast('Check your email for the sign-in link'); } catch (err) { toast(err.message); } });
  $('#gBtn', view)?.addEventListener('click', () => google().catch(err => toast(err.message)));
  $('#plusBtn', view)?.addEventListener('click', () => openPlus());
  bindTeamSearch(view, 'pt', id => { saveSettings({ entryId: id }); if (signedIn()) api('/api/account?route=link-team', { method: 'POST', body: { entryId: id } }); toast(`Team ${id} saved`); mount(view); });
  $('#dsToggle', view).addEventListener('click', e => { saveSettings({ dataSaver: !settings.dataSaver }); e.currentTarget.setAttribute('aria-checked', String(settings.dataSaver)); });
  $('#installBtn', view).addEventListener('click', async () => { const p = window.__cortexInstall; if (p) { p.prompt(); await p.userChoice.catch(() => {}); window.__cortexInstall = null; } else toast(/iphone|ipad/i.test(navigator.userAgent) ? 'Tap Share, then “Add to Home Screen”' : 'Use your browser menu: “Install app” / “Add to Home screen”'); });
  $('#pushBtn', view).addEventListener('click', async e => { try { await enablePush(cfg); e.target.textContent = 'On'; toast('Alerts on'); } catch (err) { toast(err.message); } });
}
