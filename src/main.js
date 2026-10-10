import './styles/base.css';
import { $, $$, html, render, skeleton, esc } from './lib/dom.js';
import { captureRedirect } from './lib/auth.js';
import { getModel, settings } from './lib/store.js';
import { closeSheet } from './ui/sheet.js';

captureRedirect();
const TABS = {
  home: () => import('./tabs/home.js'),
  team: () => import('./tabs/team.js'),
  players: () => import('./tabs/players.js'),
  live: () => import('./tabs/live.js'),
  ask: () => import('./tabs/ask.js'),
  profile: () => import('./tabs/profile.js'),
  draft: () => import('./tabs/draft.js'),
};
let active = null, seq = 0;

async function route() {
  const name = (location.hash.replace(/^#/, '').split(/[?/]/)[0]) || 'home';
  const tab = TABS[name] ? name : 'home';
  const my = ++seq;
  closeSheet();
  active?.unmount?.();
  active = null;
  $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  const view = $('#view');
  render(view, skeleton(4));
  try {
    const mod = await TABS[tab]();
    if (my !== seq) return;
    active = mod;
    await mod.mount(view);
    if (my === seq) view.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    if (my !== seq) return;
    render(view, html`<div class="card empty"><h3>Couldn't load this</h3><p class="muted">${e.status === 403 ? 'FPL is refusing connections right now.' : esc(e.message || 'Network problem')}</p><button class="btn primary" type="button" id="retryBtn">Try again</button></div>`);
    $('#retryBtn')?.addEventListener('click', () => { getModel(true); route(); });
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
$('#avatarBtn').addEventListener('click', () => { location.hash = '#profile'; });
document.addEventListener('cortex:settings', () => document.body.classList.toggle('data-saver', !!settings.dataSaver));
document.body.classList.toggle('data-saver', !!settings.dataSaver);
getModel().then(m => { $('#gwBadge').textContent = `GW ${m.startGW}`; }).catch(() => {});
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
