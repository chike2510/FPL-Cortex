// Interactive pitch: tap a player to select, tap a highlighted player to swap (starter <-> bench),
// or use the action bar for captain / vice / details / transfer out. Shared by Team > Pitch and Team > Transfers.
import { html, render, toast } from '../lib/dom.js';
import { kit, glow } from './card.js';
import { canSwap, swap, setArmband, saveSquad, metrics, formation, hits } from '../lib/squad.js';
import { openPlayer } from './playerSheet.js';

let sel = null;

const pp = (p, st, cls) => html`<button class="pp ${cls}" type="button" data-sid="${p.id}" aria-label="${p.web_name}, ${p.pos}, ${p.xp.toFixed(1)} projected"><span class="pp-kit">${kit(p, 44)}</span>${st.captain === p.id ? html`<span class="cap">${st.chip === '3xc' ? '3x' : 'C'}</span>` : st.vice === p.id ? html`<span class="cap v">V</span>` : ''}<span class="pp-name">${p.web_name}</span><span class="pp-xp">${p.xp.toFixed(1)}</span></button>`;

export function pitchHTML(st, model, { compact = false } = {}) {
  const m = metrics(st, model);
  const cls = p => sel == null ? '' : p.id === sel ? 'sel' : canSwap(st, model, sel, p.id) ? 'can' : 'dim';
  const rows = [1, 2, 3, 4].map(t => m.xi.filter(p => p.element_type === t));
  const s = sel && model.byId.get(sel);
  return html`
    ${compact ? '' : html`<section class="hero-rating" aria-label="Team rating ${m.rating} out of 100"><div class="cd">${glow(m.rating)}</div><span class="eyebrow">Team rating / 100</span><span class="faint small">Projection ${m.projected.toFixed(1)} pts · ${formation(st, model)}${hits(st) ? ` · −${hits(st)} hit` : ''}</span></section>`}
    <div class="pitch-card">
      <div class="pitch ${sel ? 'subbing' : ''}"><i class="pitch-lines" aria-hidden="true"></i>${rows.map(r => html`<div class="pitch-row">${r.map(p => pp(p, st, cls(p)))}</div>`)}</div>
      <div class="sub-bar" role="status">${s ? html`<span><b>${s.web_name}</b> <span class="muted">· tap a glowing player to swap</span></span><div class="sub-acts"><button class="btn pill small" data-act="cap" type="button">Captain</button><button class="btn pill small" data-act="vice" type="button">Vice</button><button class="btn pill small" data-act="info" type="button">Details</button>${compact ? html`<button class="btn pill small" data-act="out" type="button">Transfer out</button>` : ''}<button class="btn pill small" data-act="x" type="button">✕</button></div>` : html`<span class="muted">Tap a player, then tap who to swap with. Bench order sets auto-subs.</span>`}</div>
      <div class="bench" aria-label="Bench">${m.bench.map((p, i) => html`<div class="bench-slot"><small>${i === 0 ? 'GK' : i}</small>${pp(p, st, cls(p))}</div>`)}</div>
      ${compact ? html`<p class="faint small center">Projection ${m.projected.toFixed(1)} pts · rating ${m.rating} · ${formation(st, model)}${hits(st) ? ` · −${hits(st)} hit` : ''}</p>` : ''}
    </div>`;
}

/** Mount the pitch into el. ctx: { model, st, compact, onChange(st), onOut(id) } */
export function mountPitch(el, ctx) {
  const { model, st } = ctx;
  const redraw = () => { render(el, pitchHTML(st, model, ctx)); bind(); };
  const changed = msg => { saveSquad(st); sel = null; if (msg) toast(msg); ctx.onChange ? ctx.onChange(st) : redraw(); };
  function bind() {
    el.querySelectorAll('[data-sid]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.sid);
      if (sel == null || sel === id) { sel = sel === id ? null : id; redraw(); if (sel != null) el.querySelector(st.order.indexOf(sel) < 11 ? '.bench' : '.sub-bar')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (canSwap(st, model, sel, id)) { const a = model.byId.get(sel).web_name, c = model.byId.get(id).web_name; swap(st, model, sel, id); return changed(`${a} ⇄ ${c}`); }
      if (st.order.indexOf(sel) >= 11 !== st.order.indexOf(id) >= 11) toast('That swap breaks formation rules (1 GK, 3+ DEF, 2+ MID, 1+ FWD)');
      sel = id; redraw();
    }));
    el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act, id = sel;
      if (a === 'x') { sel = null; return redraw(); }
      if (a === 'info') { return openPlayer(model, id); }
      if (a === 'out') { sel = null; redraw(); return ctx.onOut?.(id); }
      if (!setArmband(st, model, id, a === 'vice' ? 'vice' : 'cap')) return toast('Only starters can wear the armband');
      changed(a === 'vice' ? 'Vice-captain set' : 'Captain set');
    }));
  }
  sel = null; redraw();
  return { redraw };
}
