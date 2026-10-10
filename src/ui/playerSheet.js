import { html, money } from '../lib/dom.js';
import { openSheet } from './sheet.js';
import { kit } from './card.js';
import { priceOutlook } from '../../shared/xp.js';

export function openPlayer(model, id) {
  const p = model.byId.get(Number(id)); if (!p) return;
  const hz = model.horizon(p, 5), po = priceOutlook(p);
  openSheet({
    title: p.web_name,
    body: html`<div class="pd-head"><span class="pd-kit">${kit(p, 96)}</span><div><h2>${p.first_name} ${p.second_name}</h2><p class="muted">${p.teamName} · ${p.pos} · ${money(p.price)} · ${p.selected}% owned</p>${p.news ? html`<p class="flag-line">${p.news}</p>` : ''}</div></div>
      <div class="stat-row"><div class="stat"><b class="accent">${p.xp.toFixed(1)}</b><small>xP next GW</small></div><div class="stat"><b>${p.form.toFixed(1)}</b><small>form</small></div><div class="stat"><b>${p.total_points}</b><small>points</small></div><div class="stat"><b class="mv ${po.dir}">${po.dir === 'up' ? '▲' : po.dir === 'down' ? '▼' : '–'}</b><small>${po.label}</small></div></div>
      <div><span class="eyebrow">Next 5 gameweeks</span><div class="hz">${hz.map(g => html`<div class="hz-cell"><small>GW${g.gw}</small>${g.fixtures.length ? g.fixtures.map(f => html`<span class="fdr fdr-${f.fdr}">${f.home ? f.opp : f.opp.toLowerCase()}</span>`) : html`<span class="fdr">blank</span>`}<b>${g.xp}</b></div>`)}</div></div>
      <div class="stat-row"><div class="stat"><b>${p.xg90.toFixed(2)}</b><small>xG / 90</small></div><div class="stat"><b>${p.xa90.toFixed(2)}</b><small>xA / 90</small></div><div class="stat"><b>${p.minutes}</b><small>minutes</small></div></div>`,
  });
}
