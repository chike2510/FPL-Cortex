// Player card: kit is the biggest element, name steps up, one key stat carries weight, the rest steps back.
import { html, raw, money } from '../lib/dom.js';
import { kitSvg, kitColour } from '../../shared/kits.js';
import { settings } from '../lib/store.js';
import { priceOutlook } from '../../shared/xp.js';

export const kit = (p, size = 64) => settings.dataSaver
  ? html`<span class="kit-dot" style="background:${kitColour(p.teamShort)}" aria-hidden="true"></span>`
  : raw(kitSvg(p.teamShort, p.element_type === 1, size));

const statusFlag = p => p.status !== 'a' ? html`<span class="flag ${p.status === 'd' ? 'warn' : 'bad'}" title="${p.news}">${p.chance ?? 0}%</span>` : '';
const fix = p => p.upcoming.slice(0, 3).map(f => html`<span class="fdr fdr-${f.difficulty}">${f.home ? f.opponent : f.opponent.toLowerCase()}</span>`);

// Molten hero numeral: gradient face + extruded glow layer (::before reads data-v).
export const glow = (v, cls = '') => html`<span class="glow ${cls}" data-v="${v}">${v}</span>`;

export function playerCard(p, { stat = 'xp', tag = '', compact = false, top = false } = {}) {
  const key = stat === 'price' ? money(p.price) : stat === 'form' ? p.form.toFixed(1) : stat === 'total' ? p.total_points : stat === 'own' ? `${p.selected}%` : p.xp.toFixed(1);
  const keyLabel = { price: 'price', form: 'form', total: 'pts', own: 'owned' }[stat] || 'xP next';
  const po = priceOutlook(p);
  if (compact) {
    return html`<button class="row-card${top ? ' top' : ''}" type="button" data-pid="${p.id}"><span class="row-kit">${kit(p, 36)}</span><span class="row-main"><strong>${p.web_name}</strong> ${statusFlag(p)}<small>${p.teamShort} · ${p.pos} · ${money(p.price)}</small></span><span class="row-stat">${tag ? html`<span class="tag">${tag}</span>` : html`<small>${keyLabel}</small>`}<b>${key}</b></span></button>`;
  }
  return html`<button class="p-card" type="button" data-pid="${p.id}">
    ${tag ? html`<span class="tag tag-top">${tag}</span>` : ''}
    <span class="p-kit">${kit(p, 84)}</span>
    <span class="p-name">${p.web_name} ${statusFlag(p)}</span>
    <span class="p-meta">${p.teamShort} · ${p.pos} · ${money(p.price)}${po.dir !== 'flat' ? html` <span class="mv ${po.dir}">${po.dir === 'up' ? '▲' : '▼'}</span>` : ''}</span>
    <span class="p-key"><b>${key}</b><small>${keyLabel}</small></span>
    <span class="p-fix">${fix(p)}</span>
  </button>`;
}
