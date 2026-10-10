/**
 * /api/fpl — public FPL proxy (Vercel Edge Function).
 * Read-only, whitelisted public endpoints, CDN-cached. No credentials, no sessions.
 * Optional FPL_UPSTREAM_BASE env lets this forward to a Cloudflare Worker (see /worker)
 * if FPL ever blocks Vercel's edge network too.
 */
export const config = { runtime: 'edge' };
import { fetchFpl } from './_lib/fpl.js';

const DRAFT = 'https://draft.premierleague.com/api';

// [regex, s-maxage seconds]
const ALLOW = [
  [/^bootstrap-static\/$/, 300],
  [/^fixtures\/(\?event=\d+)?$/, 120],
  [/^event\/\d+\/live\/$/, 30],
  [/^event-status\/$/, 60],
  [/^dream-team\/\d+\/$/, 600],
  [/^element-summary\/\d+\/$/, 600],
  [/^entry\/\d+\/$/, 60],
  [/^entry\/\d+\/history\/$/, 120],
  [/^entry\/\d+\/transfers\/$/, 120],
  [/^entry\/\d+\/event\/\d+\/picks\/$/, 60],
  [/^leagues-classic\/\d+\/standings\/(\?[a-z_=&0-9]*)?$/, 120],
  [/^leagues-h2h-matches\/league\/\d+\/(\?[a-z_=&0-9]*)?$/, 120],
];
const LEGACY = { bootstrap: 'bootstrap-static/', players: 'bootstrap-static/', gameweeks: 'bootstrap-static/', fixtures: 'fixtures/' };
const DRAFT_ROUTES = {
  'draft-bootstrap': () => '/bootstrap-static', 'draft-game': () => '/game', 'draft-event-status': () => '/pl/event-status',
  'draft-live': q => (q.get('event') || '').replace(/\D/g, '') && `/event/${q.get('event').replace(/\D/g, '')}/live`,
  'draft-league-details': q => (q.get('leagueId') || '').replace(/\D/g, '') && `/league/${q.get('leagueId').replace(/\D/g, '')}/details`,
  'draft-entry-public': q => (q.get('entryId') || '').replace(/\D/g, '') && `/entry/${q.get('entryId').replace(/\D/g, '')}/public`,
};

const json = (body, status = 200, ttl = 0) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': ttl ? `public, max-age=${Math.min(ttl, 60)}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}` : 'no-store',
    'X-Cortex-Proxy': 'edge',
  },
});

function errCode(s) {
  return s === 403 ? 'FPL_FORBIDDEN' : s === 404 ? 'FPL_TEAM_NOT_FOUND' : s === 429 ? 'FPL_RATE_LIMITED' : s >= 500 || !s ? 'FPL_UNAVAILABLE' : 'FPL_REQUEST_FAILED';
}


function normalise(p) { return String(p || '').trim().replace(/^\/+/, '').replace(/^api\//, ''); }

// ---- Team-name search ----------------------------------------------------
// The official FPL API has no name search. Source (a): fplbot.app's public entry index
// (GET https://www.fplbot.app/api/search/entries?query=&page=, the endpoint fplbot.app's own
// search page calls). Results are re-ranked here, then enriched with live FPL data
// (current team name + overall rank). (b): a pasted FPL URL or a numeric Team ID resolves directly.
const FPLBOT = 'https://www.fplbot.app/api/search/entries';
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function idFrom(query) {
  const m = query.match(/entry\/(\d{1,9})/i) || query.match(/^\s*#?(\d{1,9})\s*$/);
  return m ? m[1] : null;
}
function score(h, q) {
  const t = fold(h.teamName), n = fold(h.realName), words = q.split(' ');
  let s = 0;
  if (t === q) s += 100; else if (t.startsWith(q)) s += 60; else if (t.includes(q)) s += 40;
  if (n === q) s += 90; else if (n.startsWith(q)) s += 50; else if (n.includes(q)) s += 30;
  s += words.filter(w => t.includes(w) || n.includes(w)).length * 8;
  return s;
}
async function enrich(id) {
  const e = await fetchFpl(`entry/${id}/`).catch(() => ({ ok: false }));
  if (!e.ok || !e.data) return null;
  const d = e.data;
  return { id: d.id, teamName: d.name, realName: `${d.player_first_name} ${d.player_last_name}`.trim(), country: d.player_region_name || '', overallRank: d.summary_overall_rank ?? null, points: d.summary_overall_points ?? null };
}
async function teamSearch(q) {
  const query = String(q.get('query') || '').trim().slice(0, 120);
  const id = idFrom(query);
  if (id) {
    const r = await enrich(id);
    return json({ ok: true, source: 'fpl-id', results: r ? [r] : [] }, 200, r ? 120 : 30);
  }
  const fq = fold(query);
  if (fq.length < 3) return json({ ok: false, error: 'FPL_REQUEST_FAILED', message: 'Search needs at least 3 characters.' }, 400);
  let hits = [];
  try {
    const pages = await Promise.all([0, 1].map(p => fetch(`${FPLBOT}?${new URLSearchParams({ query, page: String(p) })}`, { headers: { Accept: 'application/json', 'User-Agent': 'FPL-Cortex/2.0 (+https://fpl-cortex.vercel.app)' }, signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : null).catch(() => null)));
    if (pages.every(p => !p)) throw new Error('down');
    const seen = new Set();
    for (const p of pages) for (const h of (p?.hits?.exposedHits || [])) if (h?.id && !seen.has(h.id)) { seen.add(h.id); hits.push(h); }
  } catch {
    return json({ ok: false, error: 'FPL_SEARCH_UNAVAILABLE', message: 'Team-name search is unavailable right now. Paste your FPL link or Team ID instead.', results: [] }, 200, 30);
  }
  const ranked = hits.map(h => ({ h, s: score(h, fq) })).sort((a, b) => b.s - a.s).slice(0, 8);
  const live = await Promise.all(ranked.map(({ h }) => enrich(h.id)));
  const results = ranked.map(({ h }, i) => live[i] || { id: Number(h.id), teamName: String(h.teamName || ''), realName: String(h.realName || ''), country: String(h.country || ''), overallRank: null, points: null })
    .map(r => ({ ...r, s: score(r, fq) })).sort((a, b) => b.s - a.s || (a.overallRank || 9e9) - (b.overallRank || 9e9)).map(({ s, ...r }) => r);
  return json({ ok: true, source: 'fplbot', results }, 200, 600);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Read-only proxy.' }, 405);
  const url = new URL(req.url);
  const q = url.searchParams;
  const route = q.get('route') || (url.pathname.split('/api/fpl/')[1] || '');

  try {
    if (route === 'team-search') return teamSearch(q);
    if (DRAFT_ROUTES[route]) {
      const p = DRAFT_ROUTES[route](q);
      if (!p) return json({ ok: false, error: 'FPL_REQUEST_FAILED', message: 'Missing id.' }, 400);
      const r = await fetchFpl(p.replace(/^\//, ''), DRAFT);
      if (!r.ok) return json({ ok: false, error: errCode(r.status), message: `Draft request failed (${r.status})` }, r.status || 502);
      return json({ ok: true, data: r.data }, 200, route === 'draft-live' ? 30 : 120);
    }
    if (LEGACY[route]) {
      const r = await fetchFpl(LEGACY[route]);
      if (!r.ok) return json({ ok: false, error: errCode(r.status), message: `FPL request failed (${r.status})` }, r.status || 502);
      const ttl = route === 'fixtures' ? 120 : 300;
      if (route === 'players') return json({ ok: true, players: r.data.elements || [], teams: r.data.teams || [], element_types: r.data.element_types || [] }, 200, ttl);
      if (route === 'gameweeks') return json({ ok: true, gameweeks: r.data.events || [] }, 200, ttl);
      return json({ ok: true, data: r.data }, 200, ttl);
    }
    const path = normalise(q.get('path'));
    if (!path) return json({ ok: false, error: 'FPL_REQUEST_FAILED', message: 'A public FPL path is required.' }, 400);
    const rule = ALLOW.find(([re]) => re.test(path));
    if (!rule) return json({ ok: false, error: 'FPL_PATH_NOT_ALLOWED', message: 'That FPL path is not available through Cortex.' }, 400);
    const r = await fetchFpl(path);
    if (!r.ok) return json({ ok: false, error: errCode(r.status), message: `FPL request failed (${r.status})` }, r.status || 502);
    return json(r.data, 200, rule[1]);
  } catch (e) {
    return json({ ok: false, error: 'FPL_UNAVAILABLE', message: e.name === 'TimeoutError' ? 'FPL timed out' : 'FPL unavailable' }, 502);
  }
}
