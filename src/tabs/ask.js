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
  { q: 'Preview my next gameweek: captain, risks and one move.' },
  { q: 'Review my last gameweek.', mode: 'recap' },
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
    <div class="card"><div class="card-head"><h3>Compare a move</h3><span class="muted">debate</span></div><form class="inline-form" id="dbForm"><input id="db1" placeholder="Player A" aria-label="Player A"><input id="db2" placeholder="Player B" aria-label="Player B"><button class="btn small" type="submit">Debate</button></form></div>
    <form class="inline-form ask-form" id="askForm"><input id="askInput" placeholder="Ask about players, fixtures or your team" autocomplete="off" maxlength="600" aria-label="Your question">${('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? html`<button class="icon-btn" type="button" id="micBtn" aria-label="Speak your question">🎙</button>` : ''}<button class="btn primary" type="submit">Ask</button></form>
    <div id="quota"></div>
    <p class="foot-note">AI answers can be wrong. Unofficial · not affiliated with the Premier League or FPL</p>`);
  draw(view, me);
  view.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { const s = SUGGEST[b.dataset.s]; send(view, me, s.q, s.mode); }));
  $('#dbForm', view).addEventListener('submit', e => { e.preventDefault(); const a = $('#db1', view).value.trim(), b = $('#db2', view).value.trim(); if (!a || !b) return; send(view, me, `Debate: ${a} or ${b} for my team over the next 5 gameweeks? Give the case for each, then a verdict.`); });
  $('#micBtn', view)?.addEventListener('click', e => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const r = new SR(); r.lang = 'en-GB'; r.interimResults = false;
    e.currentTarget.classList.add('on'); r.onresult = ev => { const t = ev.results[0][0].transcript; $('#askInput', view).value = t; send(view, me, t); $('#askInput', view).value = ''; };
    r.onend = () => $('#micBtn', view)?.classList.remove('on'); r.onerror = () => $('#micBtn', view)?.classList.remove('on'); r.start();
  });
  const pre = sessionStorage.getItem('cortex_ask_prefill'); if (pre) { sessionStorage.removeItem('cortex_ask_prefill'); send(view, me, pre); }
  $('#askForm', view).addEventListener('submit', e => { e.preventDefault(); const i = $('#askInput', view); const v = i.value; i.value = ''; send(view, me, v); });
}
