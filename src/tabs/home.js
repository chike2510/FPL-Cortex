import { html, render, fmtNum, esc, raw, toast } from '../lib/dom.js';
import { getModel, getEntry, getMe, settings, saveSettings } from '../lib/store.js';
import { fpl } from '../lib/api.js';
import { news } from '../lib/api.js';
import { onboardCard, bindOnboard } from '../ui/onboard.js';
import { captainPicks, priceOutlook } from '../../shared/xp.js';
import { kit, glow } from '../ui/card.js';
let timer;

function countdown(deadline) {
  const ms = Date.parse(deadline) - Date.now();
  if (!(ms > 0)) return html`<span class="cd-done">Deadline passed</span>`;
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const parts = d ? [[d, 'd'], [h, 'h']] : h ? [[h, 'h'], [m, 'm']] : [[m, 'm'], [String(s).padStart(2, '0'), 's']];
  return html`${parts.map(([n, u]) => html`${glow(n)}${glow(u, 'unit')}`)}`;
}
const dlLabel = (gw, dl) => `Gameweek ${gw} · Deadline ${new Date(dl).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')}`;
const shortNum = n => n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : fmtNum(n);
const heroCard = (model, dl) => html`<section class="hero-cd" aria-label="Time to deadline"><span class="eyebrow">${dlLabel(model.startGW, dl)}</span><div class="cd" id="cd" role="timer">${countdown(dl)}</div></section>`;
function captainCard(model, cap, sub) {
  const p = cap && model.byId.get(cap.id); if (!p) return '';
  return html`<a class="card cap-card" href="#team"><span class="eyebrow">Captain pick · GW${model.startGW}</span><div class="cap-body"><span class="cap-kit">${kit(p, 88)}</span><div><h2>${p.web_name}</h2><p class="muted">${p.teamShort} · ${p.pos} · £${p.price.toFixed(1)}m</p><p class="cap-form"><b>${p.form.toFixed(1)}</b> form</p><p class="faint small">${cap.captainXp} projected as captain</p></div></div>${sub ? html`<p class="muted small">${sub}</p>` : ''}</a>`;
}

function pulse(model) {
  const ev = model.events.find(e => e.id === model.currentGW);
  const top = [...model.players].sort((a, b) => b.form - a.form)[0];
  let easy = null; Object.values(model.teams).forEach(t => { const f = model.gwFixtures(t.id, model.startGW)[0]; if (f && (!easy || f.difficulty < easy.f.difficulty || (f.difficulty === easy.f.difficulty && f.home && !easy.f.home))) easy = { t, f }; });
  const capd = ev?.most_captained && model.byId.get(ev.most_captained);
  return html`<div class="card"><span class="eyebrow">This week</span><div class="tiles pulse"><div class="tile"><small>GW${ev?.id ?? '—'} avg</small><b>${ev?.average_entry_score ?? '—'}</b></div><div class="tile"><small>Top score</small><b>${ev?.highest_score ?? '—'}</b></div><div class="tile"><small>Most captained</small><b>${capd?.web_name ?? '—'}</b></div><div class="tile"><small>Hottest form</small><b>${top?.web_name ?? '—'}</b></div><div class="tile"><small>Fixture watch</small><b>${easy ? `${easy.t.short_name} ${easy.f.home ? 'v' : '@'} ${easy.f.opponent}` : '—'}</b></div><div class="tile"><small>Transfers made</small><b>${ev?.transfers_made ? shortNum(ev.transfers_made) : '—'}</b></div></div></div>`;
}

const weatherCard = () => html`<div class="card" id="wx"><div class="card-head"><span class="eyebrow">Matchday weather</span><button class="btn pill small" type="button" id="wxBtn">Check →</button></div></div>`;
async function loadWeather(el, model) {
  const { STADIUMS } = await import('../lib/stadiums.js');
  render(el, html`<span class="eyebrow">Matchday weather</span><div class="sk"></div>`);
  const fx = (await fpl(`fixtures/?event=${model.startGW}`, 300)).filter(f => !f.finished).slice(0, 10);
  const rows = await Promise.all(fx.map(async f => { const h = model.teams[f.team_h]?.short_name, st = STADIUMS[h]; if (!st) return null; try { const r = await fetch(`/api/weather?lat=${st[0]}&lon=${st[1]}`); if (!r.ok) return null; return { h, a: model.teams[f.team_a]?.short_name, st: st[2], w: await r.json() }; } catch { return null; } }));
  const ok = rows.filter(Boolean);
  render(el, html`<span class="eyebrow">Matchday weather · GW${model.startGW}</span>${ok.length ? html`<div class="list">${ok.map(r => { const wet = ['Rain', 'Drizzle', 'Thunderstorm', 'Snow'].includes(r.w.main), windy = r.w.wind_kph > 30; return html`<div class="live-row"><span><strong>${r.h} v ${r.a}</strong><small class="muted"> ${r.st} · ${r.w.description}</small></span><span class="${wet || windy ? 'mv down' : 'muted'} small">${wet || windy ? 'may affect scoring' : 'good'}</span><b>${r.w.temp}°</b></div>`; })}</div><p class="faint small">Current conditions at each ground.</p>` : html`<p class="muted">Weather is unavailable right now.</p>`}`);
}

function alertsFor(model, ids) {
  const out = [];
  for (const id of settings.watch || []) { const p = model.byId.get(id); if (p && !ids.includes(id)) out.push({ level: p.status !== 'a' ? 3 : 1, text: `Tracking ${p.web_name}: ${p.status !== 'a' ? (p.news || 'flagged') : 'fit, no news'}` }); }
  for (const id of ids) {
    const p = model.byId.get(id); if (!p) continue;
    if (p.status !== 'a') out.push({ level: p.status === 'd' ? 2 : 3, text: `${p.web_name}: ${p.news || 'flagged'}` });
    const po = priceOutlook(p); if (po.dir !== 'flat' && Math.abs(po.pct) >= 90) out.push({ level: 1, text: `${p.web_name} ${po.label.toLowerCase()}` });
    const n = model.gwFixtures(p.team, model.startGW).length;
    if (n === 0) out.push({ level: 3, text: `${p.web_name} has no fixture in GW${model.startGW}` });
    if (n > 1) out.push({ level: 1, text: `${p.web_name} plays twice in GW${model.startGW}` });
  }
  return out.sort((a, b) => b.level - a.level).slice(0, 6);
}

export async function mount(view) {
  const model = await getModel();
  const dl = model.deadline;
  if (!settings.entryId) {
    const cap = captainPicks(model, model.players.filter(p => p.status === 'a').map(p => p.id))[0];
    render(view, html`${heroCard(model, dl)}${captainCard(model, cap, 'Top projected captain this gameweek. Add your team for a pick from your own squad.')}${pulse(model)}${onboardCard()}${weatherCard()}<p class="foot-note">Unofficial · not affiliated with the Premier League or FPL</p>`);
    bindOnboard(view, () => mount(view));
  } else {
    const [entry, me] = await Promise.all([getEntry(), getMe()]);
    const e = entry.entry;
    const starters = entry.picks?.picks?.filter(p => p.position <= 11).map(p => p.element) || [];
    const cap = captainPicks(model, starters)[0];
    const alerts = alertsFor(model, entry.ids);
    const last = entry.history?.current?.slice(-1)[0];
    render(view, html`
      ${heroCard(model, dl)}
      ${captainCard(model, cap, me.plus ? '' : 'Confidence and alternatives with Plus.')}
      <div class="tiles"><div class="tile"><small>GW${last?.event ?? model.currentGW}</small><b>${last?.points ?? e.summary_event_points ?? '—'} pts</b></div><div class="tile"><small>Rank</small><b>${shortNum(e.summary_overall_rank)}</b></div><div class="tile"><small>Bank</small><b>£${entry.bank.toFixed(1)}m</b></div></div>
      <div class="card"><div class="card-head"><h3>${e.name}</h3><a href="https://fantasy.premierleague.com/my-team" target="_blank" rel="noopener" class="muted">Open FPL ↗</a></div><p class="muted small">${e.player_first_name} ${e.player_last_name} · ${fmtNum(e.summary_overall_points)} total points</p></div>
      ${pulse(model)}
      <div class="card"><span class="eyebrow">Alerts</span>${alerts.length ? html`<ul class="alerts">${alerts.map(a => html`<li class="lvl-${a.level}">${a.text}</li>`)}</ul>` : html`<p class="muted">No flags in your squad. Nice.</p>`}
        <form class="inline-form" id="watchForm"><input id="watchIn" list="watchList" placeholder="Track any player's availability" aria-label="Player to track"><button class="btn small" type="submit">Track</button></form><datalist id="watchList">${[...model.players].sort((a, b) => b.selected - a.selected).slice(0, 250).map(p => html`<option value="${p.web_name}">`)}</datalist>
        ${(settings.watch || []).length ? html`<div class="chips wrap">${settings.watch.map(id => html`<button class="chip" type="button" data-unwatch="${id}">${model.byId.get(id)?.web_name || id} ✕</button>`)}</div>` : ''}</div>
      ${weatherCard()}
      <div id="intel" class="card"><span class="eyebrow">Intel</span><div class="sk"></div></div>
      <p class="foot-note">Unofficial · not affiliated with the Premier League or FPL</p>`);
  }
  view.querySelector('#wxBtn')?.addEventListener('click', () => loadWeather(view.querySelector('#wx'), model).catch(() => render(view.querySelector('#wx'), html`<p class="muted">Weather is unavailable right now.</p>`)));
  view.querySelector('#watchForm')?.addEventListener('submit', e => { e.preventDefault(); const q = view.querySelector('#watchIn').value.trim().toLowerCase(); const p = model.players.find(x => x.web_name.toLowerCase() === q) || model.players.find(x => `${x.web_name} ${x.second_name}`.toLowerCase().includes(q)); if (!p) return toast('Player not found'); saveSettings({ watch: [...new Set([...(settings.watch || []), p.id])].slice(-10) }); toast(`Tracking ${p.web_name}`); mount(view); });
  view.querySelectorAll('[data-unwatch]').forEach(b => b.addEventListener('click', () => { saveSettings({ watch: (settings.watch || []).filter(x => x !== Number(b.dataset.unwatch)) }); mount(view); }));
  clearInterval(timer);
  timer = setInterval(() => { const el = view.querySelector('#cd'); if (el) render(el, countdown(dl)); }, 1000);
  const intel = view.querySelector('#intel');
  if (intel) news().then(n => render(intel, html`<span class="eyebrow">Intel</span>${(n.items || []).slice(0, settings.dataSaver ? 3 : 5).map(i => html`<a class="intel-item" ${i.link ? raw(`href="${esc(i.link)}" target="_blank" rel="noopener"`) : ''}><strong>${i.title}</strong><small class="muted">${i.source}</small></a>`)}`)).catch(() => render(intel, html`<span class="eyebrow">Intel</span><p class="muted">News is unavailable right now.</p>`));
}
export function unmount() { clearInterval(timer); }
