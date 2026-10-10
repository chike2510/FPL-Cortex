// Tiny safe templating: every interpolated value is escaped unless wrapped in raw()/html``.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => MAP[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s));
const fmt = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : (v === false || v == null) ? '' : esc(v);
export function html(strings, ...vals) { let out = ''; strings.forEach((s, i) => { out += s + (i < vals.length ? fmt(vals[i]) : ''); }); return new Raw(out); }
export function render(el, tpl) { if (el) el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); }
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let toastTimer;
export function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
export const fmtNum = n => (n == null || Number.isNaN(+n)) ? '—' : Number(n).toLocaleString('en-GB');
export const money = n => `£${Number(n).toFixed(1)}m`;
export const skeleton = (n = 3) => html`<div class="skeleton-stack">${Array.from({ length: n }, (_, i) => raw(`<div class="sk ${i === 0 ? 'sk-hero' : ''}"></div>`))}</div>`;
