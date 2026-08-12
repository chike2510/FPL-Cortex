/**
 * FPL Cortex server-side adapter.
 *
 * Public data is available without authentication. Protected FPL requests are
 * made only from this serverless function. Upstream cookies/tokens, when a
 * supported login flow provides them, are stored only inside an encrypted,
 * HttpOnly Cortex session cookie and are never returned to browser JavaScript.
 */
import crypto from 'node:crypto';

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const LEGACY_LOGIN_URL = 'https://users.premierleague.com/accounts/login/';
const SESSION_COOKIE = 'fpl_cortex_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 14;
const CACHE = new Map();
const TTL = {
  'bootstrap-static/': 5 * 60 * 1000,
  'fixtures/': 2 * 60 * 1000,
  default: 30 * 1000,
};

const PUBLIC_HEADERS = {
  'User-Agent': 'FPL-Cortex/1.0',
  Accept: 'application/json',
  'Accept-Language': 'en-GB,en;q=0.9',
  Referer: 'https://fantasy.premierleague.com/',
  Origin: 'https://fantasy.premierleague.com',
};

function sessionKey() {
  const secret = process.env.FPL_SESSION_SECRET || process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('FPL_SESSION_SECRET is required in production');
  }
  return crypto.createHash('sha256').update(secret || 'local-development-only').digest();
}

function encryptSession(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(part => part.toString('base64url')).join('.');
}

function decryptSession(value) {
  if (!value) return null;
  try {
    const [ivRaw, tagRaw, ciphertextRaw] = value.split('.');
    if (!ivRaw || !tagRaw || !ciphertextRaw) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      sessionKey(),
      Buffer.from(ivRaw, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    const result = Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
      decipher.final(),
    ]);
    const session = JSON.parse(result.toString('utf8'));
    if (!session.expiresAt || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function setSessionCookie(res, session) {
  const encoded = encodeURIComponent(encryptSession(session));
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encoded}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
}

function getSession(req) {
  return decryptSession(readCookie(req, SESSION_COOKIE));
}

function cacheGet(path) {
  const hit = CACHE.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (hit) CACHE.delete(path);
  return null;
}

function cacheSet(path, value) {
  const ttl = Object.entries(TTL).find(([key]) => path.includes(key))?.[1] || TTL.default;
  CACHE.set(path, { value, expiresAt: Date.now() + ttl });
}

function normalizePath(path) {
  if (!path) return '';
  const value = String(path).trim();
  if (!value.startsWith('/')) return `/${value}`;
  return value;
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function publicPlayer(player) {
  if (!player) return null;
  return {
    first_name: player.first_name || player.player_first_name || '',
    last_name: player.last_name || player.player_last_name || '',
    team_name: player.name || player.teamName || '',
    entry: player.entry || null,
    summary_overall_points: player.summary_overall_points ?? null,
    summary_overall_rank: player.summary_overall_rank ?? null,
    summary_event_points: player.summary_event_points ?? null,
  };
}

function errorCode(status, message = '') {
  if (status === 401) return 'FPL_SESSION_EXPIRED';
  if (status === 403) return 'FPL_FORBIDDEN';
  if (status === 404) return 'FPL_TEAM_NOT_FOUND';
  if (status === 429) return 'FPL_RATE_LIMITED';
  if (status >= 500 || /timeout|fetch failed|network/i.test(message)) return 'FPL_UNAVAILABLE';
  return 'FPL_REQUEST_FAILED';
}

function responseError(res, status, code, message, extra = {}) {
  return res.status(status).json({ ok: false, error: code, message, ...extra });
}

function upstreamHeaders(session, csrfToken = '') {
  const headers = { ...PUBLIC_HEADERS };
  if (session?.upstream?.cookies) headers.Cookie = session.upstream.cookies;
  if (session?.upstream?.bearer) headers['X-API-Authorization'] = `Bearer ${session.upstream.bearer}`;
  if (csrfToken) headers['X-CSRFToken'] = csrfToken;
  return headers;
}

function extractCookies(headers) {
  const values = headers.getSetCookie?.() || [];
  return values.map(value => value.split(';')[0]).filter(Boolean).join('; ');
}

function cookieValue(cookieString, name) {
  const match = cookieString.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : '';
}

async function upstreamRequest(path, options = {}, session = null) {
  const normalized = normalizePath(path);
  const isPublic = !session;
  if (isPublic && (!options.method || options.method === 'GET')) {
    const cached = cacheGet(normalized);
    if (cached) return { ok: true, status: 200, data: cached, headers: new Headers() };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const headers = { ...upstreamHeaders(session, options.csrfToken) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${FPL_BASE}${normalized}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: options.redirect || 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        error: data?.detail || data?.error || `FPL request failed (${response.status})`,
        headers: response.headers,
      };
    }
    if (isPublic && (!options.method || options.method === 'GET')) cacheSet(normalized, data);
    return { ok: true, status: response.status, data, headers: response.headers };
  } catch (error) {
    return { ok: false, status: 0, error: error.name === 'AbortError' ? 'FPL request timed out' : error.message, headers: new Headers() };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCurrentUser(session) {
  return upstreamRequest('/me/', {}, session);
}

async function fetchCurrentTeam(session, entryId) {
  return upstreamRequest(`/my-team/${encodeURIComponent(entryId)}/`, {}, session);
}

async function loginLegacy(email, password) {
  // The live redirect configuration is not exposed by the public client bundle. Keep the server-side historical transaction as the deployment fallback so the FPL email/password form is functional; disable it explicitly with FPL_ENABLE_LEGACY_LOGIN=false when an official redirect adapter is configured.
  if (String(process.env.FPL_ENABLE_LEGACY_LOGIN).toLowerCase() === 'false') {
    return {
      ok: false,
      status: 501,
      code: 'FPL_AUTH_UNSUPPORTED',
      message: 'The current official FPL login is redirect-based. Direct email/password login is disabled until the current callback contract is configured.',
      protocol: 'oauth_redirect_required',
    };
  }

  try {
    const response = await fetch(LEGACY_LOGIN_URL, {
      method: 'POST',
      headers: {
        ...PUBLIC_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      body: new URLSearchParams({
        login: email,
        password,
        app: 'plfpl-web',
        redirect_uri: 'https://fantasy.premierleague.com/a/identify/user',
      }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const cookies = extractCookies(response.headers);
    if (!cookies) {
      return { ok: false, status: 401, code: 'FPL_AUTH_FAILED', message: 'FPL rejected the supplied credentials.' };
    }
    const session = { upstream: { cookies }, createdAt: Date.now(), expiresAt: Date.now() + SESSION_MAX_AGE * 1000 };
    const me = await fetchCurrentUser(session);
    if (!me.ok || !me.data?.player?.entry) {
      return { ok: false, status: me.status || 401, code: errorCode(me.status, me.error), message: 'FPL login succeeded but the authenticated account could not be read.' };
    }
    session.entryId = me.data.player.entry;
    session.player = publicPlayer(me.data.player);
    return { ok: true, session, user: publicPlayer(me.data.player) };
  } catch {
    return { ok: false, status: 502, code: 'FPL_UNAVAILABLE', message: 'FPL is unavailable while authenticating.' };
  }
}

function requestRoute(req) {
  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const routeFromQuery = url.searchParams.get('route');
  const marker = '/api/fpl/';
  const routeFromPath = url.pathname.includes(marker) ? url.pathname.split(marker)[1] : '';
  return { url, route: routeFromQuery || routeFromPath || '' };
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    responseError(res, 401, 'FPL_SESSION_EXPIRED', 'Connect your FPL account before using this endpoint.');
    return null;
  }
  return session;
}

async function handlePublicRoute(req, res, path) {
  const routeMap = {
    bootstrap: '/bootstrap-static/',
    players: '/bootstrap-static/',
    fixtures: '/fixtures/',
  };
  if (routeMap[path]) {
    const result = await upstreamRequest(routeMap[path]);
    if (!result.ok) return responseError(res, result.status || 502, errorCode(result.status, result.error), result.error);
    if (path === 'players') return res.status(200).json({ ok: true, players: result.data?.elements || [], teams: result.data?.teams || [], element_types: result.data?.element_types || [] });
    return res.status(200).json({ ok: true, data: result.data });
  }
  if (path === 'gameweeks') {
    const result = await upstreamRequest('/bootstrap-static/');
    if (!result.ok) return responseError(res, result.status || 502, errorCode(result.status, result.error), result.error);
    return res.status(200).json({ ok: true, gameweeks: result.data?.events || [] });
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { url, route } = requestRoute(req);
  const body = parseBody(req);

  if (req.method === 'POST' && (route === 'connect' || body.action === 'connect' || body.action === 'login')) {
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!email || !password) return responseError(res, 400, 'FPL_AUTH_FAILED', 'FPL email and password are required.');
    const result = await loginLegacy(email, password);
    if (!result.ok) return responseError(res, result.status || 401, result.code, result.message, { protocol: result.protocol });
    setSessionCookie(res, result.session);
    const team = await fetchCurrentTeam(result.session, result.user.entry);
    return res.status(200).json({
      ok: true,
      user: result.user,
      team: team.ok ? team.data : null,
      teamStatus: team.ok ? 'loaded' : errorCode(team.status, team.error),
      preSeason: true,
    });
  }

  if (route === 'connection' && req.method === 'GET') {
    const session = getSession(req);
    return res.status(200).json({ ok: true, connected: Boolean(session), user: session?.player || null, entryId: session?.entryId || null });
  }

  if (route === 'connection' && req.method === 'DELETE') {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true, connected: false });
  }

  if (route === 'sync' && req.method === 'GET') {
    const session = requireSession(req, res);
    if (!session) return;
    const me = await fetchCurrentUser(session);
    const entryId = me.data?.player?.entry || session.entryId;
    if (!me.ok || !entryId) return responseError(res, me.status || 401, errorCode(me.status, me.error), 'The authenticated FPL account could not be read.');
    const team = await fetchCurrentTeam(session, entryId);
    if (!team.ok) return responseError(res, team.status || 502, errorCode(team.status, team.error), team.error || 'The current FPL team could not be loaded.', { entryId });
    return res.status(200).json({ ok: true, entryId, user: publicPlayer(me.data.player), team: team.data, preSeason: !team.data?.event || team.data?.event === 0 });
  }

  if ((route === 'me' || route === 'my-team' || route === 'team/refresh') && req.method === 'GET') {
    const session = requireSession(req, res);
    if (!session) return;
    const me = await fetchCurrentUser(session);
    if (route === 'me') {
      if (!me.ok) return responseError(res, me.status || 502, errorCode(me.status, me.error), me.error);
      return res.status(200).json({ ok: true, user: publicPlayer(me.data?.player), raw: { player: me.data?.player || null } });
    }
    const entryId = me.data?.player?.entry || session.entryId;
    if (!me.ok || !entryId) return responseError(res, me.status || 401, errorCode(me.status, me.error), 'The authenticated FPL entry could not be identified.');
    const team = await fetchCurrentTeam(session, entryId);
    if (!team.ok) return responseError(res, team.status || 502, errorCode(team.status, team.error), team.error || 'The current FPL team could not be loaded.', { entryId });
    return res.status(200).json({ ok: true, entryId, user: publicPlayer(me.data?.player), team: team.data, preSeason: !team.data?.event || team.data?.event === 0 });
  }

  if (route === 'team/submit' && req.method === 'POST') {
    const session = requireSession(req, res);
    if (!session) return;
    const payload = body.payload || body;
    const entryId = payload.entry || session.entryId;
    const picks = Array.isArray(payload.picks) ? payload.picks : [];
    if (!entryId || !picks.length) return responseError(res, 400, 'FPL_SUBMISSION_FAILED', 'A complete squad payload is required.');
    const preSeason = Boolean(payload.preSeason || payload.event === 0 || payload.event === null);
    if (preSeason && String(process.env.FPL_ENABLE_ENTRY_CREATE).toLowerCase() !== 'true') {
      return responseError(res, 501, 'FPL_SUBMISSION_UNSUPPORTED', 'The live pre-season entry-create payload requires official registration fields that are not configured in this deployment. The Cortex draft remains saved locally and can still be validated and analysed.');
    }
    const path = preSeason ? '/entry-create/' : `/my-team/${encodeURIComponent(entryId)}/`;
    const submitBody = preSeason ? { ...(payload.registration || {}), picks } : { chip: payload.chip || null, picks };
    const submitted = await upstreamRequest(path, { method: 'POST', body: submitBody, csrfToken: cookieValue(session.upstream?.cookies || '', 'csrftoken') }, session);
    if (!submitted.ok) return responseError(res, submitted.status || 502, 'FPL_SUBMISSION_FAILED', submitted.error || 'FPL rejected the team submission.');
    const refreshed = await fetchCurrentTeam(session, entryId);
    if (!refreshed.ok) return responseError(res, refreshed.status || 502, 'FPL_SUBMISSION_FAILED', 'FPL accepted the request but the returned team could not be verified.');
    const returnedIds = (refreshed.data?.picks || []).map(pick => pick.element).sort((a, b) => a - b);
    const requestedIds = picks.map(pick => typeof pick === 'number' ? pick : pick.element).filter(Boolean).sort((a, b) => a - b);
    const verified = returnedIds.length === requestedIds.length && returnedIds.every((id, index) => id === requestedIds[index]);
    if (!verified) return responseError(res, 502, 'FPL_SUBMISSION_FAILED', 'FPL returned a team state different from the requested squad.', { verified: false, team: refreshed.data });
    return res.status(200).json({ ok: true, verified: true, team: refreshed.data });
  }

  if (req.method === 'GET') {
    const publicResult = await handlePublicRoute(req, res, route);
    if (publicResult) return publicResult;
    const path = url.searchParams.get('path');
    if (!path) return responseError(res, 400, 'FPL_REQUEST_FAILED', 'A public FPL path is required.');
    const wantsAuth = url.searchParams.get('auth') === '1';
    const session = wantsAuth ? requireSession(req, res) : null;
    if (wantsAuth && !session) return;
    const result = await upstreamRequest(path, {}, session);
    if (!result.ok) return responseError(res, result.status || 502, errorCode(result.status, result.error), result.error);
    return res.status(200).json(result.data);
  }

  if (req.method === 'POST' && body.action === 'search') {
    const query = String(body.query || '').replace(/\D/g, '');
    if (!query) return responseError(res, 400, 'FPL_REQUEST_FAILED', 'An entry ID is required for public lookup.');
    const result = await upstreamRequest(`/entry/${query}/`);
    if (!result.ok) return res.status(200).json({ results: [] });
    return res.status(200).json({ results: [result.data] });
  }

  return responseError(res, 405, 'FPL_REQUEST_FAILED', 'Method not allowed.');
}
