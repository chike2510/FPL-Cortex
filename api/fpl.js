/**
 * /api/fpl — public FPL proxy (Vercel Edge Function).
 * Read-only, whitelisted public endpoints, CDN-cached. No credentials, no sessions.
 * Optional FPL_UPSTREAM_BASE env lets this forward to a Cloudflare Worker (see /worker)
 * if FPL ever blocks Vercel's edge network too.
 */
export const config = { runtime: 'edge' };

const FPL = 'https://fantasy.premierleague.com/api';
const DRAFT = 'https://draft.premierleague.com/api';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FPL-Cortex/2.0; +https://fpl-cortex.vercel.app)',
  Accept: 'application/json',
  'Accept-Language': 'en-GB,en;q=0.9',
};

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

export async function fetchFpl(path, base = (typeof process !== 'undefined' && process.env.FPL_UPSTREAM_BASE) || FPL) {
  const r = await fetch(`${base.replace(/\/$/, '')}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { data = null; }
  return { ok: r.ok && data !== null, status: r.status, data };
}

function normalise(p) { return String(p || '').trim().replace(/^\/+/, '').replace(/^api\//, ''); }

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Read-only proxy.' }, 405);
  const url = new URL(req.url);
  const q = url.searchParams;
  const route = q.get('route') || (url.pathname.split('/api/fpl/')[1] || '');

  try {
    if (route === 'team-search') {
      const query = String(q.get('query') || '').trim().slice(0, 80);
      if (query.length < 3) return json({ ok: false, error: 'FPL_REQUEST_FAILED', message: 'Search needs at least 3 characters.' }, 400);
      const r = await fetch(`https://api.fplbot.app/search/any?query=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) return json({ ok: false, error: 'FPL_SEARCH_UNAVAILABLE', message: 'Team search is unavailable.' }, 502);
      const payload = await r.json();
      const hits = Array.isArray(payload?.hits?.exposedHits) ? payload.hits.exposedHits : [];
      const results = hits.filter(h => h?.type === 'entry' && h?.source?.id).slice(0, 20).map(h => ({ id: Number(h.source.id), realName: String(h.source.realName || ''), teamName: String(h.source.teamName || ''), country: String(h.source.country || '') }));
      return json({ ok: true, results }, 200, 300);
    }
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
