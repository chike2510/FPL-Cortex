// Bottom sheet that slides over the current results (never a new page).
import { html, render, $ } from '../lib/dom.js';
let current = null;
export function openSheet({ title, body, footer = '', onMount, onClose }) {
  closeSheet();
  const root = $('#sheetRoot');
  render(root, html`<div class="sheet-backdrop" data-close></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><header class="sheet-head"><span class="grabber"></span><h2>${title}</h2><button class="icon-btn" type="button" data-close aria-label="Close">✕</button></header><div class="sheet-body">${body}</div>${footer ? html`<footer class="sheet-foot">${footer}</footer>` : ''}</section>`);
  const sheet = root.querySelector('.sheet');
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
  const onKey = e => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => root.classList.add('open'));
  current = { onClose, onKey };
  onMount?.(sheet);
  return sheet;
}
export function closeSheet() {
  if (!current) return;
  const root = $('#sheetRoot');
  document.removeEventListener('keydown', current.onKey);
  current.onClose?.();
  current = null;
  root.classList.remove('open');
  render(root, '');
}
