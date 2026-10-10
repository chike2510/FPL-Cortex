// Plus upsell + checkout launcher. Checkout URLs come from the API (server knows who you are).
import { html, toast } from '../lib/dom.js';
import { openSheet } from './sheet.js';
import { api, getConfig } from '../lib/api.js';
import { signedIn } from '../lib/auth.js';

const TIERS = {
  starter: { name: 'Starter', m: '£5.99', y: '£2.99', yt: '£35.88', ticks: ['AI transfer ideas for your squad', 'Squad rating and points projections', 'Chip and gameweek planner', 'Live rank and price tracking'] },
  pro: { name: 'Pro', m: '£9.99', y: '£4.99', yt: '£59.88', ticks: ['Everything in Starter', 'Full multi-gameweek planner', 'Captain picks with confidence', 'Unlimited Ask Cortex', 'Price-change alerts', 'Mini-league war room and shareable cards'] },
};

export async function openPlus(reason = '', opts = {}) {
  const cfg = await getConfig();
  const tier = TIERS[opts.tier] ? opts.tier : 'pro', period = opts.period === 'monthly' ? 'monthly' : 'yearly';
  openSheet({
    title: 'Choose your plan',
    body: html`${reason ? html`<p class="lead">${reason}</p>` : ''}
      <div class="plan-grid">${Object.entries(TIERS).map(([k, t]) => html`<label class="plan"><input type="radio" name="tier" value="${k}" ${k === tier ? 'checked' : ''}><span><b>${t.name}</b><em>from ${t.y}/mo yearly</em></span></label>`)}</div>
      <ul class="ticks" id="tierTicks"></ul>
      <div class="plan-grid"><label class="plan"><input type="radio" name="plan" value="yearly" ${period === 'yearly' ? 'checked' : ''}><span><b id="pY"></b> / mo, billed yearly <em>save 50%</em></span></label><label class="plan"><input type="radio" name="plan" value="monthly" ${period === 'monthly' ? 'checked' : ''}><span><b id="pM"></b> / month</span></label></div>
      <p class="muted small">Prices are shown in your local currency at checkout.</p>
      <label class="field"><span>Creator code (optional)</span><input name="promo" autocomplete="off" placeholder="e.g. FPLMATE" maxlength="32"></label>
      ${!signedIn() ? html`<p class="muted">You'll sign in first so your Plus follows you on every device.</p>` : ''}`,
    footer: html`<button class="btn primary block" data-pay="lemonsqueezy" type="button">Pay by card (GBP)</button><button class="btn block" data-pay="paystack" type="button">Pay in Naira (Paystack)</button>`,
    onMount(sheet) {
      const sync = () => { const t = TIERS[sheet.querySelector('input[name=tier]:checked').value]; sheet.querySelector('#tierTicks').innerHTML = t.ticks.map(x => `<li>${x}</li>`).join(''); sheet.querySelector('#pY').textContent = t.y; sheet.querySelector('#pM').textContent = t.m; };
      sheet.querySelectorAll('input[name=tier]').forEach(r => r.addEventListener('change', sync)); sync();
      sheet.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', async () => {
        if (!signedIn()) { location.hash = '#profile'; toast('Sign in to upgrade'); return; }
        const provider = b.dataset.pay;
        if (!cfg.billing?.[provider]) { toast('Checkout opens soon. Thanks for your interest!'); return; }
        b.disabled = true;
        const plan = sheet.querySelector('input[name=plan]:checked').value;
        const r = await api('/api/account?route=checkout', { method: 'POST', body: { provider, plan, tier: sheet.querySelector('input[name=tier]:checked').value, promo: sheet.querySelector('input[name=promo]').value } });
        b.disabled = false;
        if (r.data?.url) location.href = r.data.url; else toast(r.data?.error || 'Checkout unavailable');
      }));
    },
  });
}

export const lockedCard = (title, copy) => html`<div class="card locked"><div><span class="eyebrow">Plus</span><h3>${title}</h3><p class="muted">${copy}</p></div><button class="btn primary" type="button" data-plus>Unlock</button></div>`;
export function bindPlus(root, reason) { root.querySelectorAll('[data-plus]').forEach(b => b.addEventListener('click', () => openPlus(reason))); }
