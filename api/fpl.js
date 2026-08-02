/**
 * /api/fpl.js — Unified FPL Service Layer
 *
 * Single entry point for ALL FPL API requests.
 * Handles: auth cookies · retries · caching · error formatting
 *
 * Usage:
 *   GET /api/fpl?path=/bootstrap-static/
 *   GET /api/fpl?path=/entry/123/&auth=1       (sends session cookie)
 *   GET /api/fpl?path=/event/38/live/
 *   GET /api/fpl?path=/my-team/123/&auth=1     (requires cookie)
 *   POST /api/fpl { action: "login", email, password }
 *   POST /api/fpl { action: "search", query }
 */

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const PL_LOGIN = 'https://users.premierleague.com/accounts/login/';

const BASE_HEADERS = {
  'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept':      'application/json, text/plain, */*',
  'Referer':     'https://fantasy.premierleague.com/',
  'Origin':      'https://fantasy.premierleague.com',
};

// Simple in-memory cache (resets each cold start — good enough for Vercel edge)
const CACHE = new Map();
const CACHE_TTL = {
  '/bootstrap-static/': 120_000,   // 2 min
  '/fixtures/':          120_000,
  default:                30_000,   // 30s for everything else
};

function cacheKey(path) { return path; }
function getCache(path) {
  const e = CACHE.get(cacheKey(path));
  return e && Date.now() < e.expires ? e.data : null;
}
function setCache(path, data) {
  const ttl = Object.entries(CACHE_TTL).find(([k]) => path.includes(k))?.[1] ?? CACHE_TTL.default;
  CACHE.set(cacheKey(path), { data, expires: Date.now() + ttl });
}

// Fetch with retry
async function fplGet(path, cookie = '', retries = 2) {
  const cached = !cookie && getCache(path);
  if (cached) return { ok: true, data: cached, fromCache: true };

  const headers = { ...BASE_HEADERS };
  if (cookie) headers['Cookie'] = cookie;

  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`${FPL_BASE}${path}`, {
        headers,
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) return { ok: false, status: r.status, error: `FPL returned ${r.status}` };
      const data = await r.json();
      if (!cookie) setCache(path, data);
      return { ok: true, data };
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise(res => setTimeout(res, 600 * (i + 1)));
    }
  }
  return { ok: false, error: lastErr?.message || 'Network error' };
}

// FPL login flow
async function fplLogin(email, password) {
  const loginRes = await fetch(PL_LOGIN, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      login:        email,
      password,
      app:          'plfpl-web',
      redirect_uri: 'https://fantasy.premierleague.com/a/identify/user',
    }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });

  const cookies = loginRes.headers.getSetCookie?.() ?? [];
  if (!cookies.length) return { ok: false, error: 'Invalid email or password' };

  const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

  // Get player profile
  const meRes = await fetch(`${FPL_BASE}/me/`, {
    headers: { ...BASE_HEADERS, Cookie: cookieStr },
  });
  if (!meRes.ok) return { ok: false, error: 'Login succeeded but profile fetch failed' };

  const me = await meRes.json();
  return {
    ok:      true,
    cookie:  cookieStr,
    entryId: me?.player?.entry ?? null,
    player:  me?.player ?? null,
  };
}

// Manager search — FPL doesn't have a public search API
// We use the entry endpoint with a known ID pattern
async function searchManagers(query) {
  // FPL search endpoint (requires no auth for public data)
  const r = await fetch(
    `${FPL_BASE}/search/?q=${encodeURIComponent(query)}&page_size=10`,
    { headers: BASE_HEADERS, signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) return { ok: false, error: 'Search unavailable' };
  const data = await r.json();
  return { ok: true, results: data.results ?? [] };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fpl-cookie');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST: login or search ──────────────────────────────────────
  if (req.method === 'POST') {
    const { action, email, password, query } = req.body ?? {};

    if (action === 'login') {
      if (!email || !password)
        return res.status(400).json({ error: 'email and password required' });
      const result = await fplLogin(email, password);
      return result.ok
        ? res.status(200).json(result)
        : res.status(401).json({ error: result.error });
    }

    if (action === 'search') {
      if (!query) return res.status(400).json({ error: 'query required' });
      const result = await searchManagers(query);
      return result.ok
        ? res.status(200).json(result)
        : res.status(502).json({ error: result.error });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── GET: proxy any FPL path ────────────────────────────────────
  if (req.method === 'GET') {
    const { path, auth } = req.query;
    if (!path) return res.status(400).json({ error: 'path param required' });

    // Security: only allow FPL API paths
    if (!/^\/[\w\-\/\?\=\&\%\.]+$/.test(path))
      return res.status(400).json({ error: 'Invalid path' });

    const cookie = auth ? (req.headers['x-fpl-cookie'] ?? '') : '';
    const result = await fplGet(path, cookie);

    if (!result.ok)
      return res.status(result.status ?? 502).json({ error: result.error });

    if (!auth) res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(result.data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
