import { html, render, esc, raw, $ } from '../lib/dom.js';
import { settings, getMe } from '../lib/store.js';
import { api } from '../lib/api.js';
import { openPlus } from '../ui/plus.js';

const msgs = [];
let remaining = null;
const SUGGEST = [
  { q: 'Who should I captain this gameweek?' },
  { q: 'Best midfielder under £7.0m for the next 3 gameweeks?' },
  { q: 'Compare Haaland and Isak over the next 5 gameweeks.' },
  { q: 'Write my weekly recap.', mode: 'recap' },
];
const fmt = t => raw(esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'));

function draw(view, me) {
  render($('#thread', view), html`${msgs.length ? msgs.map(m => html`<div class="bubble ${m.role}">${fmt(m.content)}</div>`) : html`<div class="card"><span class="eyebrow">Ask Cortex</span><p class="muted">Answers use live FPL data: players, fixtures and your squad${settings.entryId ? '' : ' (add your Team ID on Home for squad answers)'}.</p></div>`}`);
  render($('#quota', view), me.plus ? html`<span class="tag">Plus · unlimited</span>` : html`<span class="muted small">${remaining == null ? '3 free questions per gameweek' : `${remaining} free question${remaining === 1 ? '' : 's'} left this gameweek`}</span>`);
  $('#thread', view).lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

async function send(view, me, text, mode = 'chat') {
  if (!text.trim()) return;
  msgs.push({ role: 'user', content: text.trim() });
  msgs.push({ role: 'assistant', content: 'Thinking…', pending: true });
  draw(view, me);
  const r = await api('/api/ai', { method: 'POST', body: { messages: msgs.filter(m => !m.pending).slice(-8), entryId: settings.entryId, mode } });
  msgs.pop();
  if (r.status === 402) { remaining = 0; msgs.push({ role: 'assistant', content: r.data.message || 'Free questions used for this gameweek.' }); draw(view, me); openPlus('You have used this gameweek\'s free questions. Plus makes Ask unlimited.'); return; }
  msgs.push({ role: 'assistant', content: r.ok ? r.data.reply : (r.data.error || 'Something went wrong. Try again.') });
  if (r.ok && r.data.remaining != null) remaining = r.data.remaining;
  draw(view, me);
}

export async function mount(view) {
  const me = await getMe();
  render(view, html`
    <div id="thread" class="thread"></div>
    <div class="chips" id="sugg">${SUGGEST.map((s, i) => html`<button class="chip" type="button" data-s="${i}">${s.q}</button>`)}</div>
    <form class="inline-form ask-form" id="askForm"><input id="askInput" placeholder="Ask about players, fixtures or your team" autocomplete="off" maxlength="600" aria-label="Your question"><button class="btn primary" type="submit">Ask</button></form>
    <div id="quota"></div>
    <p class="foot-note">AI answers can be wrong. Unofficial · not affiliated with the Premier League or FPL</p>`);
  draw(view, me);
  view.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { const s = SUGGEST[b.dataset.s]; send(view, me, s.q, s.mode); }));
  $('#askForm', view).addEventListener('submit', e => { e.preventDefault(); const i = $('#askInput', view); const v = i.value; i.value = ''; send(view, me, v); });
}
