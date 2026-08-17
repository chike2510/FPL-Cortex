const ACCOUNT_BASE = 'https://account.premierleague.com';
const OFFICIAL_FPL = 'https://fantasy.premierleague.com/';
const FPL_API = 'https://fantasy.premierleague.com/api/me/';
const CLIENT_ID = 'bfcbaf69-aade-4c1b-8f00-c1cb8a193030';
const REDIRECT_URI = OFFICIAL_FPL;
const cortexTabs = new Set();
const pendingAuth = new Map();

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function sendToCortex(tabId, message) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => cortexTabs.delete(tabId));
}

async function beginAuthorization(cortexTabId) {
  const state = randomString(24);
  const verifier = randomString(48);
  const challenge = await pkceChallenge(verifier);
  pendingAuth.set(state, { verifier, cortexTabId, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email offline_access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    language: 'en'
  });
  const authUrl = `${ACCOUNT_BASE}/as/authorize?${params.toString()}`;
  return new Promise(resolve => {
    chrome.tabs.create({ url: authUrl }, tab => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve({ ok: true, tabId: tab?.id ?? null });
    });
  });
}

async function exchangeCode(code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code,
    code_verifier: verifier
  });
  const response = await fetch(`${ACCOUNT_BASE}/as/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `Token exchange failed (${response.status})`);
  return data.access_token;
}

async function readOfficialAccount(accessToken) {
  const response = await fetch(FPL_API, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
  });
  const data = response.ok ? await response.json().catch(() => null) : null;
  const player = data?.player;
  if (!player?.entry) throw new Error('The official session did not return an FPL team.');
  return {
    entry: Number(player.entry),
    first_name: String(player.first_name || ''),
    last_name: String(player.last_name || ''),
    team_name: String(player.name || ''),
    summary_overall_points: Number(player.summary_overall_points || 0),
    summary_overall_rank: Number(player.summary_overall_rank || 0),
    summary_event_points: Number(player.summary_event_points || 0)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CORTEX_REGISTER_TAB' && sender.tab?.id) {
    cortexTabs.add(sender.tab.id);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type !== 'CORTEX_START_OFFICIAL_AUTH') return;
  if (sender.tab?.id) cortexTabs.add(sender.tab.id);
  beginAuthorization(sender.tab?.id).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => cortexTabs.delete(tabId));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url?.startsWith(OFFICIAL_FPL)) return;
  const callback = new URL(tab.url);
  const code = callback.searchParams.get('code');
  const state = callback.searchParams.get('state');
  const authError = callback.searchParams.get('error_description') || callback.searchParams.get('error');
  if (!code && !authError) return;
  const pending = state ? pendingAuth.get(state) : null;
  if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) return;
  pendingAuth.delete(state);
  try {
    if (authError) throw new Error(authError);
    const accessToken = await exchangeCode(code, pending.verifier);
    const user = await readOfficialAccount(accessToken);
    sendToCortex(pending.cortexTabId, { type: 'FPL_OFFICIAL_SESSION_FOUND', user });
    sendToCortex(pending.cortexTabId, { type: 'FPLCORTEX_COMPANION_STATUS', message: 'Official FPL session found.' });
  } catch (error) {
    sendToCortex(pending.cortexTabId, { type: 'FPLCORTEX_COMPANION_ERROR', message: error.message || 'Official FPL sign-in could not be completed.' });
  }
});
