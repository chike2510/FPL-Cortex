/**
 * /api/fpl.js — Unified FPL Service
 * Single entry point for all FPL API requests.
 */

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const PL_LOGIN = 'https://users.premierleague.com/accounts/login/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Referer': 'https://fantasy.premierleague.com/',
  'Origin': 'https://fantasy.premierleague.com',
};

const CACHE = new Map();
const TTL = { '/bootstrap-static/': 120000, '/fixtures/': 120000, default: 30000 };

function cached(path) {
  const e = CACHE.get(path);
  return e && Date.now() < e.exp ? e.data : null;
}
function cache(path, data) {
  const ttl = Object.entries(TTL).find(([k]) => path.includes(k))?.[1] ?? TTL.default;
  CACHE.set(path, { data, exp: Date.now() + ttl });
}

async function fplGet(path, cookie = '') {
  if (!cookie) { const c = cached(path); if (c) return { ok: true, data: c }; }
  const headers = { ...HEADERS };
  if (cookie) headers['Cookie'] = cookie;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${FPL_BASE}${path}`, { headers, signal: AbortSignal.timeout(12000) });
      if (!r.ok) return { ok: false, status: r.status, error: `FPL API: ${r.status}` };
      const data = await r.json();
      if (!cookie) cache(path, data);
      return { ok: true, data };
    } catch (e) {
      if (i === 2) return { ok: false, error: e.message };
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function doLogin(email, password) {
  try {
    const res = await fetch(PL_LOGIN, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      body: new URLSearchParams({
        login: email,
        password: password,
        app: 'plfpl-web',
        redirect_uri: 'https://fantasy.premierleague.com/a/identify/user',
      }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });

    const rawCookies = res.headers.getSetCookie?.() ?? [];
    if (!rawCookies.length) {
      return { ok: false, error: 'Invalid email or password' };
    }

    const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

    // Get player info
    const meRes = await fetch(`${FPL_BASE}/me/`, {
      headers: { ...HEADERS, Cookie: cookieStr },
      signal: AbortSignal.timeout(10000),
    });

    if (!meRes.ok) return { ok: false, error: 'Login ok but profile fetch failed' };
    const me = await meRes.json();

    return {
      ok: true,
      cookie: cookieStr,
      entryId: me?.player?.entry ?? null,
      player: me?.player ?? null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fpl-cookie');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const body = req.body ?? {};
    if (body.action === 'login') {
      if (!body.email || !body.password)
        return res.status(400).json({ error: 'email and password required' });
      const result = await doLogin(body.email, body.password);
      return result.ok
        ? res.status(200).json(result)
        : res.status(401).json({ error: result.error });
    }
    if (body.action === 'search') {
      const q = body.query;
      if (!q) return res.status(400).json({ error: 'query required' });
      const r = await fplGet(`/entry/${parseInt(q)}/`);
      return r.ok
        ? res.status(200).json({ results: [r.data] })
        : res.status(200).json({ results: [] });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }

  if (req.method === 'GET') {
    const { path, auth } = req.query;
    if (!path) return res.status(400).json({ error: 'path required' });
    const cookie = auth ? (req.headers['x-fpl-cookie'] ?? '') : '';
    const result = await fplGet(path, cookie);
    if (!result.ok) return res.status(result.status ?? 502).json({ error: result.error });
    if (!auth) res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(result.data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
