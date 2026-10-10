// Plus upsell + checkout launcher. Checkout URLs come from the API (server knows who you are).
import { html, toast } from '../lib/dom.js';
import { openSheet } from './sheet.js';
import { api, getConfig } from '../lib/api.js';
import { signedIn } from '../lib/auth.js';

export async function openPlus(reason = '') {
  const cfg = await getConfig();
  openSheet({
    title: 'Cortex Plus',
    body: html`${reason ? html`<p class="lead">${reason}</p>` : ''}
      <ul class="ticks"><li>Captain picker with confidence</li><li>Transfer projections over 3 gameweeks</li><li>5-gameweek planner with chip windows</li><li>Unlimited Ask Cortex</li><li>Deadline, injury and price alerts</li></ul>
      <div class="plan-grid"><label class="plan"><input type="radio" name="plan" value="monthly" checked><span><b>£4.99</b> / month</span></label><label class="plan"><input type="radio" name="plan" value="yearly"><span><b>£47.90</b> / year <em>save 20%</em></span></label></div>
      <label class="field"><span>Creator code (optional)</span><input name="promo" autocomplete="off" placeholder="e.g. FPLMATE" maxlength="32"></label>
      ${!signedIn() ? html`<p class="muted">You'll sign in first so your Plus follows you on every device.</p>` : ''}`,
    footer: html`<button class="btn primary block" data-pay="lemonsqueezy" type="button">Pay by card (GBP)</button><button class="btn block" data-pay="paystack" type="button">Pay in Naira (Paystack)</button>`,
    onMount(sheet) {
      sheet.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', async () => {
        if (!signedIn()) { location.hash = '#profile'; toast('Sign in to upgrade'); return; }
        const provider = b.dataset.pay;
        if (!cfg.billing?.[provider]) { toast('Checkout opens soon. Thanks for your interest!'); return; }
        b.disabled = true;
        const plan = sheet.querySelector('input[name=plan]:checked').value;
        const r = await api('/api/account?route=checkout', { method: 'POST', body: { provider, plan, promo: sheet.querySelector('input[name=promo]').value } });
        b.disabled = false;
        if (r.data?.url) location.href = r.data.url; else toast(r.data?.error || 'Checkout unavailable');
      }));
    },
  });
}

export const lockedCard = (title, copy) => html`<div class="card locked"><div><span class="eyebrow">Plus</span><h3>${title}</h3><p class="muted">${copy}</p></div><button class="btn primary" type="button" data-plus>Unlock</button></div>`;
export function bindPlus(root, reason) { root.querySelectorAll('[data-plus]').forEach(b => b.addEventListener('click', () => openPlus(reason))); }
