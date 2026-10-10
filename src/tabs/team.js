import './team.css';
import { html, render, money, toast, fmtNum } from '../lib/dom.js';
import { getModel, getEntry, getMe, settings } from '../lib/store.js';
import { api } from '../lib/api.js';
import { onboardCard, bindOnboard } from '../ui/onboard.js';
import { kit } from '../ui/card.js';
import { openPlayer } from '../ui/playerSheet.js';
import { openSheet } from '../ui/sheet.js';
import { lockedCard, bindPlus } from '../ui/plus.js';
import { suggestTransfers, captainPicks } from '../../shared/xp.js';

const FPL_TRANSFERS = 'https://fantasy.premierleague.com/transfers';
const CHIPS = { wildcard: 'Wildcard', freehit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain', manager: 'Assistant Manager' };

const pitchPlayer = (p, pk) => html`<button class="pp" type="button" data-pid="${p.id}"><span class="pp-kit">${kit(p, 52)}</span>${pk.is_captain ? html`<span class="cap">C</span>` : pk.is_vice_captain ? html`<span class="cap v">V</span>` : ''}<span class="pp-name">${p.web_name}</span><span class="pp-xp">${p.xp.toFixed(1)}</span></button>`;

export async function mount(view) {
  if (!settings.entryId) { render(view, onboardCard()); bindOnboard(view, () => mount(view)); return; }
  const [model, entry, me] = await Promise.all([getModel(), getEntry(), getMe()]);
  if (!entry.picks) { render(view, html`<div class="card empty"><h3>No squad yet</h3><p class="muted">Pick your squad on the official FPL site, then come back.</p><a class="btn primary" href="https://fantasy.premierleague.com/" target="_blank" rel="noopener">Open FPL</a></div>`); return; }
  const picks = entry.picks.picks;
  const P = pk => model.byId.get(pk.element);
  const xi = picks.filter(pk => pk.position <= 11 && P(pk)), bench = picks.filter(pk => pk.position > 11 && P(pk));
  const rows = [1, 2, 3, 4].map(t => xi.filter(pk => P(pk).element_type === t));
  const capPk = picks.find(pk => pk.is_captain);
  const projected = xi.reduce((s, pk) => s + P(pk).xp, 0) + (capPk && P(capPk) ? P(capPk).xp : 0);
  const rating = Math.round(Math.max(0, Math.min(100, projected / 80 * 100)));
  const freeMove = suggestTransfers(model, entry.ids, entry.bank, 3, 1)[0];
  const used = new Set((entry.history?.chips || []).map(c => c.name));
  const nextGW = model.startGW;
  const dgw = [], bgw = [];
  for (let gw = nextGW; gw < nextGW + 6; gw++) {
    const counts = Object.keys(model.teams).map(t => model.gwFixtures(Number(t), gw).length);
    if (counts.some(c => c > 1)) dgw.push(gw); if (counts.some(c => c === 0)) bgw.push(gw);
  }

  render(view, html`
    <div class="pitch-card">
      <div class="pitch-head"><div><span class="eyebrow">GW${nextGW} projection</span><div class="big accent">${projected.toFixed(1)}</div></div><div class="rating"><b>${rating}</b><small>team rating</small></div></div>
      <div class="pitch">${rows.map(r => html`<div class="pitch-row">${r.map(pk => pitchPlayer(P(pk), pk))}</div>`)}</div>
      <div class="bench">${bench.map(pk => pitchPlayer(P(pk), pk))}</div>
      <div class="pitch-foot"><span>Bank ${money(entry.bank)}</span><span>Value ${money(entry.value)}</span><button class="btn small" type="button" id="shareBtn">Share card</button></div>
    </div>
    <div class="card" id="capCard"><div class="card-head"><h3>Captain</h3><span class="muted">GW${nextGW}</span></div><div class="sk"></div></div>
    <div class="card" id="trCard"><div class="card-head"><h3>Suggested transfers</h3><span class="muted">next 3 GWs</span></div><div class="sk"></div></div>
    <div class="card"><div class="card-head"><h3>Chip planner</h3></div>
      <div class="chips">${Object.entries(CHIPS).map(([k, v]) => html`<span class="chip ${used.has(k) ? '' : 'on'}">${v}${used.has(k) ? ' · used' : ''}</span>`)}</div>
      <p class="muted">${dgw.length ? `Double gameweeks ahead: GW${dgw.join(', GW')}. ` : 'No double gameweeks scheduled in the next 6. '}${bgw.length ? `Blanks: GW${bgw.join(', GW')}.` : ''}</p>
      <div id="planner"></div>
    </div>`);

  view.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => openPlayer(model, b.dataset.pid)));
  view.querySelector('#shareBtn').addEventListener('click', () => share(model, entry, xi.map(pk => P(pk))));

  const capCard = view.querySelector('#capCard'), trCard = view.querySelector('#trCard'), planner = view.querySelector('#planner');
  const transferLink = html`<a class="btn primary block" href="${FPL_TRANSFERS}" target="_blank" rel="noopener">Open official FPL transfers ↗</a>`;
  if (me.plus) {
    const [cap, tr, pl] = await Promise.all(['captain', 'transfers', 'planner'].map(r => api(`/api/plus?route=${r}&entry=${settings.entryId}`)));
    render(capCard, html`<div class="card-head"><h3>Captain</h3><span class="muted">confidence</span></div><div class="list">${(cap.data.picks || []).slice(0, 4).map((c, i) => html`<div class="cap-row ${i === 0 ? 'top' : ''}"><strong>${c.name}</strong><span class="muted">${c.team}</span><span>${c.captainXp} pts</span><span class="conf"><i style="width:${c.confidence}%"></i></span><b>${c.confidence}%</b></div>`)}</div>`);
    render(trCard, html`<div class="card-head"><h3>Transfer projections</h3><span class="muted">bank ${money(tr.data.bank || 0)}</span></div>${(tr.data.moves || []).length ? html`<div class="list">${tr.data.moves.map(m => html`<div class="move"><span class="out">${m.out.name} <small>${money(m.out.price)}</small></span><span>→</span><span class="in">${m.in.name} <small>${money(m.in.price)}</small></span><b class="accent">+${m.gain}</b></div>`)}</div>` : html`<p class="muted">Your squad is already well set for the next 3 gameweeks.</p>`}${transferLink}`);
    if (pl.ok) render(planner, html`<div class="scroll-x"><table class="table"><thead><tr><th>Player</th>${pl.data.gws.map(g => html`<th>GW${g}</th>`)}</tr></thead><tbody>${pl.data.rows.map((r, i) => html`<tr class="${i === 11 ? 'bench-start' : ''}"><td>${r.name}</td>${r.gws.map(g => html`<td><span class="fdr fdr-${g.fixtures[0]?.fdr || 3}">${g.fixtures.map(f => f.opp).join('+') || '—'}</span> ${g.xp}</td>`)}</tr>`)}</tbody></table></div>${pl.data.chipHints.filter(c => c.hint).map(c => html`<p class="accent">GW${c.gw}: ${c.hint}</p>`)}`);
  } else {
    const c = captainPicks(model, xi.map(pk => pk.element))[0];
    render(capCard, html`<div class="card-head"><h3>Captain</h3><span class="muted">GW${nextGW}</span></div>${c ? html`<div class="cap-row top"><strong>${c.name}</strong><span class="muted">${c.team}</span><span>${c.captainXp} pts</span></div>` : ''}<p class="muted">Plus adds a confidence score and the best alternatives.</p><button class="btn small" type="button" data-plus>See confidence</button>`);
    render(trCard, html`<div class="card-head"><h3>Suggested transfers</h3><span class="muted">next 3 GWs</span></div>${freeMove ? html`<div class="move"><span class="out">${freeMove.out.name}</span><span>→</span><span class="in">${freeMove.in.name}</span><b class="accent">+${freeMove.gain}</b></div>` : html`<p class="muted">No clear upgrade within your bank.</p>`}${transferLink}${lockedCard('Full transfer projections', 'Every worthwhile move ranked by projected gain, plus a 5-gameweek planner.')}`);
    render(planner, lockedCard('5-gameweek planner', 'Projected points per player per gameweek, with chip windows flagged.'));
    bindPlus(view, 'Plus unlocks captain confidence, projections and the planner.');
  }
}

function share(model, entry, xiPlayers) {
  const last = entry.history?.current?.slice(-1)[0];
  const q = new URLSearchParams({ t: entry.entry.name, m: `${entry.entry.player_first_name} ${entry.entry.player_last_name}`, gw: String(last?.event ?? model.currentGW), pts: String(last?.points ?? ''), rank: String(entry.entry.summary_overall_rank || ''), xi: xiPlayers.map(p => `${p.web_name.replace(/[:,]/g, '')}:${p.pos}:${p.teamShort}:${p.event_points}`).join(',') });
  const pageUrl = `${location.origin}/api/og?${q}&format=html`, img = `/api/og?${q}`;
  const text = `${entry.entry.name}: ${last?.points ?? '—'} pts in GW${last?.event ?? ''} 📊`;
  openSheet({
    title: 'Share your team',
    body: html`${settings.dataSaver ? html`<p class="muted">Image preview hidden in data saver.</p>` : html`<img class="share-img" src="${img}" alt="Team card preview" loading="lazy">`}
      <div class="share-btns"><a class="btn primary" target="_blank" rel="noopener" href="${'https://wa.me/?text=' + encodeURIComponent(text + ' ' + pageUrl)}">WhatsApp</a><a class="btn" target="_blank" rel="noopener" href="${'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(pageUrl)}">Post on X</a><button class="btn" type="button" id="copyLink">Copy link</button></div>`,
    onMount(s) {
      s.querySelector('#copyLink').addEventListener('click', async () => { try { if (navigator.share) await navigator.share({ title: 'FPL Cortex', text, url: pageUrl }); else { await navigator.clipboard.writeText(pageUrl); toast('Link copied'); } } catch { /* cancelled */ } });
    },
  });
}
