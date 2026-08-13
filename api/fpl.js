/**
 * FPL Cortex server-side adapter.
 *
 * Public data is available without authentication. Protected FPL requests are
 * made only from this serverless function. Premier League OIDC and DaVinci
 * state, access tokens, upstream cookies, and transient challenge state are
 * stored only in encrypted HttpOnly cookies and are never returned to browser
 * JavaScript.
 */
import crypto from 'node:crypto';

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const ACCOUNT_BASE = 'https://account.premierleague.com';
const CLIENT_ID = process.env.FPL_CLIENT_ID || 'bfcbaf69-aade-4c1b-8f00-c1cb8a193030';
const REDIRECT_URI = process.env.FPL_REDIRECT_URI || 'https://fantasy.premierleague.com/';
const AUTH_CONFIG_URL = process.env.FPL_AUTH_CONFIG_URL || 'https://ffm-config.pages.dev/config.json';
const OFFICIAL_FPL_LOGIN_URL = `${ACCOUNT_BASE}/as/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('openid profile email offline_access')}&code_challenge_method=S256`;
const SESSION_COOKIE = 'fpl_cortex_session';
const CHALLENGE_COOKIE = 'fpl_cortex_challenge';
const SESSION_MAX_AGE = 60 * 60 * 24 * 14;
const CHALLENGE_MAX_AGE = 60 * 10;
const CACHE = new Map();
const AUTH_CONFIG_CACHE = { value: null, expiresAt: 0 };
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

const DEFAULT_FPL_FLOW = {
  client_id: CLIENT_ID,
  flow: [
    'authorize',
    'start',
    { id: 'tavl3e1h2q', eventName: 'continue', parameters: { eventType: 'polling' }, pollProps: { status: 'continue', delayInMs: 10, retriesAllowed: 1, pollChallengeStatus: false } },
    { id: 'cq77vwelou', nextEvent: { constructType: 'skEvent', eventName: 'continue', params: [], eventType: 'post', postProcess: {} }, parameters: { buttonType: 'form-submit', buttonValue: 'SIGNON', username: '', password: '' }, eventName: 'continue' },
    { id: 'p0mteph8fp', nextEvent: { constructType: 'skEvent', eventName: 'continue', params: [], eventType: 'post', postProcess: {} }, parameters: { buttonType: 'form-submit', buttonValue: 'NEXT', passcode: '' }, eventName: 'continue' },
    { id: 'xnzrifyvmk', nextEvent: { constructType: 'skEvent', eventName: 'continue', params: [], eventType: 'post', postProcess: {} }, parameters: { buttonType: 'form-submit', buttonValue: 'VERIFY', passcode: '' }, eventName: 'continue' },
    { id: 'mfts2z73w0', eventName: 'continue', nextEvent: { constructType: 'skEvent', eventName: 'continue', params: [], eventType: 'post', postProcess: {} }, parameters: { buttonType: 'form-submit', buttonValue: 'CONTINUE', 'preferred-language': 'en', 'terms-accepted': true } },
    { id: 'lnpmqnoz1e', nextEvent: { constructType: 'skEvent', eventName: 'continue', params: [], eventType: 'post', postProcess: {} }, parameters: { buttonType: 'form-submit', buttonValue: 'CONTINUE', 'preferred-language': 'en', 'terms-accepted': true }, eventName: 'continue' },
    { id: 'v8kmoppppm', nextEvent: { constructType: 'skEvent', eventName: 'continue', params: [], eventType: 'post', postProcess: {} }, parameters: { buttonType: 'form-submit', buttonValue: 'SIGNON' }, eventName: 'continue' },
    'resume',
    'token',
  ],
};

function sessionKey() {
  const secret = process.env.FPL_SESSION_SECRET || process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('FPL_SESSION_SECRET is required in production');
  }
  return crypto.createHash('sha256').update(secret || 'local-development-only').digest();
}

function encryptValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(part => part.toString('base64url')).join('.');
}

function decryptValue(value) {
  if (!value) return null;
  try {
    const [ivRaw, tagRaw, ciphertextRaw] = value.split('.');
    if (!ivRaw || !tagRaw || !ciphertextRaw) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(), Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    const result = Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(result.toString('utf8'));
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function cookieOptions(maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=Lax`;
}

function appendSetCookie(res, value) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, value]);
}

function setEncryptedCookie(res, name, value, maxAge) {
  appendSetCookie(res, `${name}=${encodeURIComponent(encryptValue(value))}; ${cookieOptions(maxAge)}`);
}

function clearCookie(res, name) {
  appendSetCookie(res, `${name}=; ${cookieOptions(0)}`);
}

function getSession(req) {
  const session = decryptValue(readCookie(req, SESSION_COOKIE));
  if (!session?.expiresAt || session.expiresAt < Date.now()) return null;
  return session;
}

function getChallenge(req) {
  const challenge = decryptValue(readCookie(req, CHALLENGE_COOKIE));
  if (!challenge?.expiresAt || challenge.expiresAt < Date.now()) return null;
  return challenge;
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
  // The official FPL data client uses the raw OIDC access token in this header.
  if (session?.upstream?.bearer) headers['X-API-Authorization'] = session.upstream.bearer;
  if (csrfToken) headers['X-CSRFToken'] = csrfToken;
  return headers;
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie().map(value => value.split(';')[0]).filter(Boolean);
  const combined = headers.get('set-cookie') || '';
  if (!combined) return [];
  return combined.split(/,(?=[^;=]+=[^;]+)/).map(value => value.trim().split(';')[0]).filter(Boolean);
}

function mergeCookies(existing = '', headers) {
  const jar = new Map();
  for (const part of String(existing).split(';')) {
    const trimmed = part.trim();
    const index = trimmed.indexOf('=');
    if (index > 0) jar.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  for (const part of extractSetCookies(headers)) {
    const index = part.indexOf('=');
    if (index > 0) jar.set(part.slice(0, index), part.slice(index + 1));
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function cookieValue(cookieString, name) {
  const match = String(cookieString).split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
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
      return { ok: false, status: response.status, data, error: data?.detail || data?.error || `FPL request failed (${response.status})`, headers: response.headers };
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

function extractJsonAssignment(html, variableName) {
  const marker = `var ${variableName}`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('{', markerIndex);
  if (start < 0) return null;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function hiddenInput(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<input[^>]+(?:id=["']${escaped}["'][^>]*|name=["']${escaped}["'][^>]*)value=["']([^"']*)["']`, 'i'));
  return match?.[1] || '';
}

function challengeType(text = '') {
  const value = String(text).toLowerCase();
  if (/two-factor|totp|authenticator|one-time password|security code/.test(value)) return '2fa';
  if (/passcode|verification code|verify/.test(value)) return 'verify';
  if (/change password|password reset/.test(value)) return 'change_password';
  return '';
}

function safeAuthMessage(kind = '') {
  if (kind === 'verify') return 'Premier League sent a verification code. Enter it to continue.';
  if (kind === '2fa') return 'Enter the two-factor code from your authenticator to continue.';
  if (kind === 'change_password') return 'Premier League requires a password update before this account can connect.';
  return 'Premier League could not complete the sign-in.';
}

async function authFetch(url, options = {}, authState) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; FPL-Cortex/1.0)',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-GB,en;q=0.9',
    Origin: ACCOUNT_BASE,
    Referer: `${ACCOUNT_BASE}/`,
    ...(options.headers || {}),
  };
  if (authState.cookies) headers.Cookie = authState.cookies;
  const response = await fetch(url, {
    ...options,
    headers,
    redirect: options.redirect || 'manual',
    signal: options.signal || AbortSignal.timeout(options.timeout || 20000),
  });
  authState.cookies = mergeCookies(authState.cookies, response.headers);
  return response;
}

async function loadAuthFlow() {
  if (AUTH_CONFIG_CACHE.value && AUTH_CONFIG_CACHE.expiresAt > Date.now()) return AUTH_CONFIG_CACHE.value;
  try {
    const response = await fetch(AUTH_CONFIG_URL, { headers: { Accept: 'application/json', 'User-Agent': 'FPL-Cortex/1.0' }, signal: AbortSignal.timeout(6000) });
    if (response.ok) {
      const data = await response.json();
      const raw = typeof data.fplFlow === 'string' ? JSON.parse(data.fplFlow) : data.fplFlow;
      if (raw?.flow?.length) {
        const flow = { ...raw, client_id: raw.client_id || CLIENT_ID };
        AUTH_CONFIG_CACHE.value = flow;
        AUTH_CONFIG_CACHE.expiresAt = Date.now() + 10 * 60 * 1000;
        return flow;
      }
    }
  } catch {
    // The captured flow below is intentionally kept as a safe fallback when
    // the public config endpoint is unavailable or changes shape.
  }
  AUTH_CONFIG_CACHE.value = DEFAULT_FPL_FLOW;
  AUTH_CONFIG_CACHE.expiresAt = Date.now() + 60 * 1000;
  return DEFAULT_FPL_FLOW;
}

async function initializeAuth(flow) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomUUID();
  const authState = {
    verifier,
    state,
    clientId: flow.client_id || CLIENT_ID,
    cookies: '',
    interactionId: '',
    interactionToken: '',
    connectionId: '',
    dvResponse: '',
    policyId: '',
    companyId: '',
    davinciAccessToken: '',
    code: '',
    accessToken: '',
    refreshToken: '',
  };
  const params = new URLSearchParams({
    client_id: authState.clientId,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email offline_access',
  });
  const response = await authFetch(`${ACCOUNT_BASE}/as/authorize?${params.toString()}`, {
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  }, authState);
  const html = await response.text();
  if (!response.ok) throw new Error(`authorize returned ${response.status}`);
  const props = extractJsonAssignment(html, 'skProps');
  const returnedState = hiddenInput(html, 'state');
  if (returnedState && returnedState !== state) throw new Error('Premier League returned an invalid authorization state.');
  authState.state = returnedState || state;
  authState.davinciAccessToken = props?.accessToken || props?.interactionToken || '';
  authState.policyId = props?.policyId || '';
  authState.companyId = props?.companyId || '';
  if (!authState.davinciAccessToken || !authState.policyId) throw new Error('Premier League did not return a DaVinci bootstrap transaction.');
  return authState;
}

async function startDaVinci(authState) {
  const response = await authFetch(`${ACCOUNT_BASE}/davinci/policy/${encodeURIComponent(authState.policyId)}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authState.davinciAccessToken}` },
  }, authState);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || `DaVinci start returned ${response.status}`);
  authState.interactionId = data.interactionId || data.interaction_id || cookieValue(authState.cookies, 'interactionId');
  authState.interactionToken = data.interactionToken || data.interaction_token || data.token || authState.interactionToken;
  authState.connectionId = data.connectionId || data.connection_id || authState.connectionId;
  authState.companyId = data.companyId || authState.companyId;
  authState.currentId = data.id || '';
  return data;
}

function stepMatches(step, currentId) {
  if (!currentId) return true;
  return step?.id === currentId;
}

function stepPayload(step, email = '', password = '', passcode = '') {
  const payload = JSON.parse(JSON.stringify(step || {}));
  const parameters = payload.parameters || (payload.parameters = {});
  if (Object.prototype.hasOwnProperty.call(parameters, 'username')) parameters.username = email;
  if (Object.prototype.hasOwnProperty.call(parameters, 'email')) parameters.email = email;
  if (Object.prototype.hasOwnProperty.call(parameters, 'password')) parameters.password = password;
  if (Object.prototype.hasOwnProperty.call(parameters, 'passcode')) parameters.passcode = passcode;
  return payload;
}

async function postDaVinciStep(authState, payload) {
  if (!authState.connectionId || !authState.interactionId) throw new Error('Premier League returned an incomplete authentication transaction.');
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    connectionId: authState.connectionId,
    interactionId: authState.interactionId,
  };
  if (authState.interactionToken) headers.interactionToken = authState.interactionToken;
  const response = await authFetch(`${ACCOUNT_BASE}/davinci/connections/${encodeURIComponent(authState.connectionId)}/capabilities/customHTMLTemplate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }, authState);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 1000) }; }
  if (!response.ok) {
    const upstreamMessage = data?.message || data?.error || '';
    const error = new Error(upstreamMessage || `DaVinci step returned ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  authState.dvResponse = data.dvResponse || '';
  authState.interactionId = data.interactionId || authState.interactionId;
  authState.interactionToken = data.interactionToken || data.interaction_token || data.token || authState.interactionToken;
  authState.connectionId = data.connectionId || authState.connectionId;
  authState.currentId = data.id || data.nextEvent?.id || authState.currentId;
  return data;
}

async function runConfiguredFlow(authState, flow, email = '', password = '', passcode = '') {
  let awaitingChallenge = '';
  for (const step of flow.flow || []) {
    if (typeof step === 'string') {
      if (step === 'authorize') continue;
      if (step === 'start') {
        await startDaVinci(authState);
        continue;
      }
      if (step === 'resume') {
        if (!authState.dvResponse) continue;
        const body = new URLSearchParams({ dvResponse: authState.dvResponse, state: authState.state });
        const response = await authFetch(`${ACCOUNT_BASE}/as/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html,application/xhtml+xml,application/json' },
          body: body.toString(),
        }, authState);
        const location = response.headers.get('location') || '';
        if (location) {
          const callbackUrl = new URL(location, ACCOUNT_BASE);
          const returnedState = callbackUrl.searchParams.get('state');
          if (returnedState && returnedState !== authState.state) throw new Error('Premier League returned an invalid authentication state.');
          authState.code = callbackUrl.searchParams.get('code') || '';
        } else {
          const text = await response.text();
          const codeMatch = text.match(/[?&]code=([^&"' ]+)/);
          const stateMatch = text.match(/[?&]state=([^&"' ]+)/);
          if (stateMatch && decodeURIComponent(stateMatch[1]) !== authState.state) throw new Error('Premier League returned an invalid authentication state.');
          authState.code = codeMatch ? decodeURIComponent(codeMatch[1]) : '';
        }
        if (!authState.code) throw new Error('Premier League did not return an authorization code.');
        continue;
      }
      if (step === 'token') {
        if (!authState.code) continue;
        const tokenBody = new URLSearchParams({
          grant_type: 'authorization_code',
          code: authState.code,
          redirect_uri: REDIRECT_URI,
          client_id: authState.clientId,
          code_verifier: authState.verifier,
        });
        const response = await authFetch(`${ACCOUNT_BASE}/as/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Referer: 'https://www.premierleague.com/' },
          body: tokenBody.toString(),
        }, authState);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.access_token) throw new Error(data?.error_description || data?.error || `Token exchange returned ${response.status}`);
        authState.accessToken = data.access_token;
        authState.refreshToken = data.refresh_token || '';
        continue;
      }
      continue;
    }

    if (!step?.id || !stepMatches(step, authState.currentId)) continue;
    const rawText = JSON.stringify(step);
    const needsPasscode = Object.prototype.hasOwnProperty.call(step.parameters || {}, 'passcode');
    if (needsPasscode && !passcode) {
      awaitingChallenge = challengeType(rawText) || (step.parameters?.buttonValue === 'VERIFY' ? 'verify' : 'verify');
      break;
    }
    const payload = stepPayload(step, email, password, passcode);
    const data = await postDaVinciStep(authState, payload);
    const responseText = JSON.stringify(data);
    const detected = challengeType(responseText);
    if (!authState.dvResponse && detected && !passcode) {
      awaitingChallenge = detected;
      break;
    }
    if (!authState.dvResponse && /userlookup/.test(responseText.toLowerCase())) {
      const error = new Error('Premier League could not find an account for that email.');
      error.code = 'FPL_ACCOUNT_NOT_FOUND';
      throw error;
    }
    passcode = '';
  }
  if (awaitingChallenge) return { challenge: awaitingChallenge };
  if (!authState.accessToken && !authState.dvResponse) throw new Error('Premier League did not complete the authentication flow.');
  return { challenge: '' };
}

async function fetchAccountIdentity(authState) {
  const response = await authFetch(`${ACCOUNT_BASE}/as/userinfo`, {
    headers: { Authorization: `Bearer ${authState.accessToken}`, Accept: 'application/json' },
  }, authState);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data) throw new Error('Premier League returned no account identity.');
  return data;
}

function authChallengePayload(authState, kind) {
  return {
    version: 1,
    expiresAt: Date.now() + CHALLENGE_MAX_AGE * 1000,
    kind,
    authState: {
      ...authState,
      // Credentials never enter the transient cookie.
      password: undefined,
      email: undefined,
    },
  };
}

async function loginOfficial(email, password, passcode = '', previousChallenge = null) {
  const flow = await loadAuthFlow();
  const authState = previousChallenge?.authState || await initializeAuth(flow);
  if (!authState.clientId) authState.clientId = flow.client_id || CLIENT_ID;
  const result = await runConfiguredFlow(authState, flow, email, password, passcode);
  if (result.challenge) return { ok: false, challenge: result.challenge, challengeState: authChallengePayload(authState, result.challenge) };
  if (!authState.accessToken) {
    const identity = await fetchAccountIdentity(authState);
    authState.account = { id: identity.id || identity.sub || '', email: identity.email || email };
  } else {
    const identity = await fetchAccountIdentity(authState);
    authState.account = { id: identity.id || identity.sub || '', email: identity.email || email };
  }
  const session = {
    upstream: { bearer: authState.accessToken, cookies: authState.cookies },
    account: authState.account,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  };
  const me = await fetchCurrentUser(session);
  if (!me.ok || !me.data?.player?.entry) {
    const error = new Error('Premier League authenticated the account, but its FPL team could not be read.');
    error.status = me.status || 401;
    error.code = me.status === 403 ? 'FPL_FORBIDDEN' : 'FPL_TEAM_NOT_FOUND';
    throw error;
  }
  session.entryId = me.data.player.entry;
  session.player = publicPlayer(me.data.player);
  return { ok: true, session, user: session.player, account: authState.account };
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
  const routeMap = { bootstrap: '/bootstrap-static/', players: '/bootstrap-static/', fixtures: '/fixtures/' };
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
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return responseError(res, 400, 'FPL_AUTH_FAILED', 'FPL email and password are required.');
    try {
      const result = await loginOfficial(email, password);
      if (result.challenge) {
        setEncryptedCookie(res, CHALLENGE_COOKIE, result.challengeState, CHALLENGE_MAX_AGE);
        return responseError(res, 409, 'FPL_CHALLENGE_REQUIRED', safeAuthMessage(result.challenge), { challenge: result.challenge });
      }
      setEncryptedCookie(res, SESSION_COOKIE, result.session, SESSION_MAX_AGE);
      clearCookie(res, CHALLENGE_COOKIE);
      const team = await fetchCurrentTeam(result.session, result.user.entry);
      return res.status(200).json({ ok: true, user: result.user, team: team.ok ? team.data : null, teamStatus: team.ok ? 'loaded' : errorCode(team.status, team.error), preSeason: true });
    } catch (error) {
      const code = error.code || (error.message?.includes('account') ? 'FPL_AUTH_FAILED' : error.status === 403 ? 'FPL_FORBIDDEN' : 'FPL_AUTH_FAILED');
      return responseError(res, error.status || 401, code, code === 'FPL_AUTH_FAILED' ? 'Premier League rejected the supplied credentials or could not complete the sign-in.' : error.message);
    }
  }

  if (req.method === 'POST' && (route === 'challenge' || route === 'verify')) {
    const passcode = String(body.passcode || '').trim();
    const challenge = getChallenge(req);
    if (!challenge || !passcode) return responseError(res, 400, 'FPL_CHALLENGE_FAILED', 'A valid verification code is required.');
    try {
      const email = String(body.email || '').trim().toLowerCase();
      const result = await loginOfficial(email, '', passcode, challenge);
      if (result.challenge) {
        setEncryptedCookie(res, CHALLENGE_COOKIE, result.challengeState, CHALLENGE_MAX_AGE);
        return responseError(res, 409, 'FPL_CHALLENGE_REQUIRED', safeAuthMessage(result.challenge), { challenge: result.challenge });
      }
      setEncryptedCookie(res, SESSION_COOKIE, result.session, SESSION_MAX_AGE);
      clearCookie(res, CHALLENGE_COOKIE);
      const team = await fetchCurrentTeam(result.session, result.user.entry);
      return res.status(200).json({ ok: true, user: result.user, team: team.ok ? team.data : null, teamStatus: team.ok ? 'loaded' : errorCode(team.status, team.error), preSeason: true });
    } catch (error) {
      return responseError(res, error.status || 401, 'FPL_CHALLENGE_FAILED', 'Premier League could not verify that code. Try again.');
    }
  }

  if (route === 'official-login' && req.method === 'GET') {
    res.setHeader('Location', OFFICIAL_FPL_LOGIN_URL);
    return res.status(302).end();
  }

  if (route === 'connection' && req.method === 'GET') {
    const session = getSession(req);
    return res.status(200).json({ ok: true, connected: Boolean(session), user: session?.player || null, entryId: session?.entryId || null });
  }

  if (route === 'connection' && req.method === 'DELETE') {
    clearCookie(res, SESSION_COOKIE);
    clearCookie(res, CHALLENGE_COOKIE);
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
