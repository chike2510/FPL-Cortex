const OFFICIAL_FPL = 'https://fantasy.premierleague.com/';
const cortexTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CORTEX_REGISTER_TAB' && sender.tab?.id) {
    cortexTabs.add(sender.tab.id);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type !== 'CORTEX_OPEN_FPL') return;
  if (sender.tab?.id) cortexTabs.add(sender.tab.id);
  chrome.tabs.create({ url: OFFICIAL_FPL }, tab => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    sendResponse({ ok: true, tabId: tab?.id ?? null });
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url?.startsWith(OFFICIAL_FPL)) return;
  chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        const response = await fetch('/api/me/', { credentials: 'include' });
        const me = response.ok ? await response.json() : null;
        const player = me?.player;
        if (!player?.entry) return;
        return {
          entry: Number(player.entry),
          first_name: String(player.first_name || ''),
          last_name: String(player.last_name || ''),
          team_name: String(player.name || ''),
          summary_overall_points: Number(player.summary_overall_points || 0),
          summary_overall_rank: Number(player.summary_overall_rank || 0),
          summary_event_points: Number(player.summary_event_points || 0)
        };
      } catch (_) {
        return null;
      }
    }
  }).then(results => {
    const user = results?.[0]?.result;
    if (!user?.entry) return;
    for (const cortexTabId of cortexTabs) {
      chrome.tabs.sendMessage(cortexTabId, { type: 'FPL_OFFICIAL_SESSION_FOUND', user }).catch(() => cortexTabs.delete(cortexTabId));
    }
  }).catch(() => {});
});
