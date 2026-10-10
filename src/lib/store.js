// App state: settings (local), FPL model (shared xP model), the user's entry.
import { fpl, api } from './api.js';
import { buildModel } from '../../shared/xp.js';
const SKEY = 'cortex_v2_settings';
const defaults = { entryId: null, dataSaver: false, view: 'cards', rivals: [] };
export const settings = { ...defaults, ...(JSON.parse(localStorage.getItem(SKEY) || '{}')) };
export function saveSettings(patch) { Object.assign(settings, patch); localStorage.setItem(SKEY, JSON.stringify(settings)); document.dispatchEvent(new CustomEvent('cortex:settings')); }

let modelP = null;
export function getModel(force = false) {
  if (!modelP || force) modelP = Promise.all([fpl('bootstrap-static/', 300), fpl('fixtures/', 120)]).then(([b, f]) => buildModel(b, f)).catch(e => { modelP = null; throw e; });
  return modelP;
}

const entryCache = new Map();
export async function getEntry(entryId = settings.entryId) {
  if (!entryId) return null;
  const model = await getModel();
  const key = `${entryId}:${model.currentGW}`;
  if (entryCache.has(key)) return entryCache.get(key);
  const p = (async () => {
    const [entry, history] = await Promise.all([fpl(`entry/${entryId}/`, 60), fpl(`entry/${entryId}/history/`, 120)]);
    let picks = null;
    for (const gw of [model.currentGW, model.currentGW - 1]) { if (gw < 1) continue; try { picks = await fpl(`entry/${entryId}/event/${gw}/picks/`, 60); picks.gw = gw; break; } catch { /* pre-deadline */ } }
    const ids = picks?.picks?.map(p => p.element) || [];
    return { entry, history, picks, ids, bank: (picks?.entry_history?.bank ?? entry.last_deadline_bank ?? 0) / 10, value: (picks?.entry_history?.value ?? entry.last_deadline_value ?? 1000) / 10 };
  })().catch(e => { entryCache.delete(key); throw e; });
  entryCache.set(key, p);
  return p;
}

let meP = null;
export function getMe(force = false) { if (!meP || force) meP = api('/api/account?route=me').then(r => r.data || {}).catch(() => ({})); return meP; }
