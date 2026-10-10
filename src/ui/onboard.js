// Team ID / team-name onboarding. No FPL password, ever.
import { html, render, toast, esc } from '../lib/dom.js';
import { saveSettings } from '../lib/store.js';
import { teamSearch } from '../lib/api.js';

export const onboardCard = () => html`<div class="card onboard">
  <span class="eyebrow">Get started</span><h2>Add your FPL team</h2>
  <p class="muted">Enter your Team ID or search your team name. Cortex only reads public FPL data, so it never needs your FPL password.</p>
  <form class="inline-form" id="obForm"><input id="obInput" inputmode="search" placeholder="Team ID (e.g. 123456) or team name" aria-label="Team ID or team name" required><button class="btn primary" type="submit">Go</button></form>
  <div id="obResults" class="list"></div>
  <details class="muted"><summary>Where's my Team ID?</summary><p>On the official FPL site open <b>Points</b>; the number in the address bar after <code>/entry/</code> is your Team ID.</p></details>
</div>`;

export function bindOnboard(root, onDone) {
  const form = root.querySelector('#obForm'); if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const q = root.querySelector('#obInput').value.trim();
    if (/^\d{1,10}$/.test(q)) { saveSettings({ entryId: Number(q) }); toast('Team added'); onDone?.(); return; }
    const out = root.querySelector('#obResults');
    render(out, html`<p class="muted">Searching…</p>`);
    const r = await teamSearch(q);
    const results = r.results || [];
    render(out, results.length ? html`${results.slice(0, 8).map(t => html`<button class="row-card" type="button" data-id="${t.id}"><span class="row-kit">◫</span><span class="row-main"><strong>${t.teamName}</strong><small>${t.realName} ${t.country ? '· ' + t.country : ''}</small></span><span></span><span class="row-stat"><small>ID ${t.id}</small></span></button>`)}` : html`<p class="muted">No teams found${r.ok === false ? ' (search is unavailable right now, so use your Team ID)' : ''}.</p>`);
    out.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => { saveSettings({ entryId: Number(b.dataset.id) }); toast('Team added'); onDone?.(); }));
  });
}
