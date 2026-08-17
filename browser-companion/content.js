const CORTEX_ORIGINS = new Set([
  'https://fpl-cortex.vercel.app',
  'http://localhost',
  'http://127.0.0.1'
]);

function isCortexOrigin(origin) {
  return CORTEX_ORIGINS.has(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
}

if (isCortexOrigin(location.origin)) {
  chrome.runtime.sendMessage({ type: 'CORTEX_REGISTER_TAB' }).catch(() => {});
}

window.addEventListener('message', event => {
  if (!isCortexOrigin(event.origin) || event.data?.type !== 'CORTEX_REQUEST_FPL_SESSION') return;
  chrome.runtime.sendMessage({ type: 'CORTEX_OPEN_FPL' }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      window.postMessage({ type: 'FPLCORTEX_COMPANION_ERROR', message: 'The companion could not open the official FPL site.' }, event.origin);
    }
  });
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'FPL_OFFICIAL_SESSION_FOUND') return;
  const user = message.user;
  if (!user?.entry) return;
  window.postMessage({
    type: 'FPLCORTEX_SESSION_FOUND',
    user: {
      entry: Number(user.entry),
      first_name: String(user.first_name || ''),
      last_name: String(user.last_name || ''),
      team_name: String(user.team_name || ''),
      summary_overall_points: Number(user.summary_overall_points || 0),
      summary_overall_rank: Number(user.summary_overall_rank || 0),
      summary_event_points: Number(user.summary_event_points || 0)
    }
  }, '*');
});
