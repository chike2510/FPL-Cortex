import { html, render, fmtNum, esc, raw } from '../lib/dom.js';
import { getModel, getEntry, getMe, settings } from '../lib/store.js';
import { news } from '../lib/api.js';
import { onboardCard, bindOnboard } from '../ui/onboard.js';
import { captainPicks, priceOutlook } from '../../shared/xp.js';
let timer;

function countdown(deadline) {
  const ms = Date.parse(deadline) - Date.now();
  if (!(ms > 0)) return 'Deadline passed';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
}

function alertsFor(model, ids) {
  const out = [];
  for (const id of ids) {
    const p = model.byId.get(id); if (!p) continue;
    if (p.status !== 'a') out.push({ level: p.status === 'd' ? 2 : 3, text: `${p.web_name}: ${p.news || 'flagged'}` });
    const po = priceOutlook(p); if (po.dir !== 'flat' && Math.abs(po.pct) >= 90) out.push({ level: 1, text: `${p.web_name} ${po.label.toLowerCase()}` });
    const n = model.gwFixtures(p.team, model.startGW).length;
    if (n === 0) out.push({ level: 3, text: `${p.web_name} has no fixture in GW${model.startGW}` });
    if (n > 1) out.push({ level: 1, text: `${p.web_name} plays twice in GW${model.startGW}` });
  }
  return out.sort((a, b) => b.level - a.level).slice(0, 3);
}

export async function mount(view) {
  const model = await getModel();
  const dl = model.deadline;
  if (!settings.entryId) {
    render(view, html`<div class="card hero"><span class="eyebrow">GW${model.startGW} deadline</span><div class="big" id="cd">${countdown(dl)}</div></div>${onboardCard()}<p class="foot-note">Unofficial · not affiliated with the Premier League or FPL</p>`);
    bindOnboard(view, () => mount(view));
  } else {
    const [entry, me] = await Promise.all([getEntry(), getMe()]);
    const e = entry.entry;
    const starters = entry.picks?.picks?.filter(p => p.position <= 11).map(p => p.element) || [];
    const cap = captainPicks(model, starters)[0];
    const alerts = alertsFor(model, entry.ids);
    const last = entry.history?.current?.slice(-1)[0];
    render(view, html`
      <div class="card hero"><div class="card-head"><span class="eyebrow">GW${model.startGW} deadline</span><a href="https://fantasy.premierleague.com/my-team" target="_blank" rel="noopener" class="muted">Open FPL ↗</a></div><div class="big" id="cd">${countdown(dl)}</div></div>
      <div class="card"><div class="card-head"><h3>${e.name}</h3><span class="muted">${e.player_first_name} ${e.player_last_name}</span></div>
        <div class="stat-row"><div class="stat"><b class="accent">${last?.points ?? e.summary_event_points ?? '—'}</b><small>GW${last?.event ?? model.currentGW} points</small></div><div class="stat"><b>${fmtNum(e.summary_overall_rank)}</b><small>overall rank</small></div><div class="stat"><b>${fmtNum(e.summary_overall_points)}</b><small>total points</small></div></div></div>
      ${cap ? html`<a class="card link-card" href="#team"><span class="eyebrow">Captain pick · GW${model.startGW}</span><div class="card-head"><h2>${cap.name}</h2><span class="big accent">${cap.captainXp}</span></div><p class="muted">${cap.team} · projected ${cap.xp} pts doubled.${me.plus ? '' : ' Confidence and alternatives with Plus.'}</p></a>` : ''}
      <div class="card"><span class="eyebrow">Alerts</span>${alerts.length ? html`<ul class="alerts">${alerts.map(a => html`<li class="lvl-${a.level}">${a.text}</li>`)}</ul>` : html`<p class="muted">No flags in your squad. Nice.</p>`}</div>
      <div id="intel" class="card"><span class="eyebrow">Intel</span><div class="sk"></div></div>
      <p class="foot-note">Unofficial · not affiliated with the Premier League or FPL</p>`);
  }
  clearInterval(timer);
  timer = setInterval(() => { const el = view.querySelector('#cd'); if (el) el.textContent = countdown(dl); }, 1000);
  const intel = view.querySelector('#intel');
  if (intel) news().then(n => render(intel, html`<span class="eyebrow">Intel</span>${(n.items || []).slice(0, settings.dataSaver ? 3 : 5).map(i => html`<a class="intel-item" ${i.link ? raw(`href="${esc(i.link)}" target="_blank" rel="noopener"`) : ''}><strong>${i.title}</strong><small class="muted">${i.source}</small></a>`)}`));
}
export function unmount() { clearInterval(timer); }
