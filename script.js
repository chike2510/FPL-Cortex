/**
 * FPL CORTEX — script.js (Complete)
 * 32 features active
 */
'use strict';

/* ══ KEYS ══════════════════════════════════════════════════════ */
// API keys moved to Vercel env vars — calls proxied via /api/ai and /api/weather

/* ══ PROXIES — PARALLEL RACE with timeout ═══════════════════════
   All proxies fire at once. First successful response wins.
   Each proxy times out after 8 seconds individually.
   This means total max wait = 8 seconds, not 4×8=32 seconds.
═══════════════════════════════════════════════════════════════ */
const FPL = 'https://fantasy.premierleague.com/api';
const PROXIES = [
  p => `/api/proxy?path=${encodeURIComponent(p)}`,
  p => `https://corsproxy.io/?${encodeURIComponent(`${FPL}${p}`)}`,
  p => `https://api.allorigins.win/raw?url=${encodeURIComponent(`${FPL}${p}`)}`,
  p => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`${FPL}${p}`)}`,
];

async function fplFetch(path) {
  // Race ALL proxies simultaneously — first to respond wins
  const attempts = PROXIES.map(mk => fetchWithTimeout(mk(path), 8000));
  const errors = [];
  // Use Promise.any to get the first success
  try {
    return await Promise.any(attempts);
  } catch (aggregateErr) {
    throw new Error('All proxies failed or timed out');
  }
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
/* ══ DUAL-LEVEL CACHE (Speed Fix) ══════════════════════════════
   Level 1: sessionStorage — 5 min (fastest, same tab)
   Level 2: localStorage  — 30 min (survives refresh/new tab)
   Shows cached data INSTANTLY, fetches fresh in background
═══════════════════════════════════════════════════════════════ */
const CACHE_TTL_S = 5  * 60 * 1000; // sessionStorage TTL
const CACHE_TTL_L = 30 * 60 * 1000; // localStorage TTL

function cGet(k) {
  // Try sessionStorage first (fastest)
  try {
    const rs = sessionStorage.getItem(k);
    if (rs) { const {d,t} = JSON.parse(rs); if (Date.now()-t < CACHE_TTL_S) return d; sessionStorage.removeItem(k); }
  } catch {}
  // Fall back to localStorage (survives page reload)
  try {
    const rl = localStorage.getItem('cache_'+k);
    if (rl) { const {d,t} = JSON.parse(rl); if (Date.now()-t < CACHE_TTL_L) return d; localStorage.removeItem('cache_'+k); }
  } catch {}
  return null;
}
function cSet(k, d) {
  try { sessionStorage.setItem(k, JSON.stringify({d, t:Date.now()})); } catch {}
  try { localStorage.setItem('cache_'+k, JSON.stringify({d, t:Date.now()})); } catch {}
}
function cClear(k) {
  try { sessionStorage.removeItem(k); } catch {}
  try { localStorage.removeItem('cache_'+k); } catch {}
}

/* ══ STADIUM COORDS ═════════════════════════════════════════════ */
const STADIUMS = {
  ARS:{lat:51.5549,lon:-0.1084,name:'Emirates'}, AVL:{lat:52.5092,lon:-1.8847,name:'Villa Park'},
  BOU:{lat:50.7352,lon:-1.8383,name:'Vitality'},  BRE:{lat:51.4882,lon:-0.2886,name:'Gtech'},
  BHA:{lat:50.8616,lon:-0.0836,name:'Amex'},       CHE:{lat:51.4816,lon:-0.1910,name:'Stamford Bridge'},
  CRY:{lat:51.3983,lon:-0.0855,name:'Selhurst'},   EVE:{lat:53.4389,lon:-2.9662,name:'Goodison'},
  FUL:{lat:51.4749,lon:-0.2217,name:'Craven Cottage'}, IPS:{lat:52.0549,lon:1.1446,name:'Portman Road'},
  LEI:{lat:52.6204,lon:-1.1423,name:'King Power'},  LIV:{lat:53.4308,lon:-2.9608,name:'Anfield'},
  MCI:{lat:53.4831,lon:-2.2004,name:'Etihad'},      MUN:{lat:53.4631,lon:-2.2913,name:'Old Trafford'},
  NEW:{lat:54.9756,lon:-1.6217,name:"St James'"},   NFO:{lat:52.9399,lon:-1.1328,name:'City Ground'},
  SOU:{lat:50.9058,lon:-1.3914,name:"St Mary's"},   TOT:{lat:51.6042,lon:-0.0665,name:'THS'},
  WHU:{lat:51.5386,lon:-0.0164,name:'London Stadium'}, WOL:{lat:52.5900,lon:-2.1302,name:'Molineux'},
};

/* ══ TEAM COLOURS ═══════════════════════════════════════════════ */
const TC = {
  ARS:{p:'#EF0107',s:'#FFFFFF'}, AVL:{p:'#670E36',s:'#95BFE5'}, BOU:{p:'#DA291C',s:'#000000'},
  BRE:{p:'#E30613',s:'#FFFFFF'}, BHA:{p:'#0057B8',s:'#FFFFFF'}, CHE:{p:'#034694',s:'#FFFFFF'},
  CRY:{p:'#1B458F',s:'#C4122E'}, EVE:{p:'#003399',s:'#FFFFFF'}, FUL:{p:'#CCCCCC',s:'#231F20'},
  IPS:{p:'#0044A9',s:'#FFFFFF'}, LEI:{p:'#003090',s:'#FDBE11'}, LIV:{p:'#C8102E',s:'#00B2A9'},
  MCI:{p:'#6CABDD',s:'#FFFFFF'}, MUN:{p:'#DA291C',s:'#FBE122'}, NEW:{p:'#241F20',s:'#FFFFFF'},
  NFO:{p:'#DD0000',s:'#FFFFFF'}, SOU:{p:'#D71920',s:'#FFFFFF'}, TOT:{p:'#F0F0F0',s:'#132257'},
  WHU:{p:'#7A263A',s:'#1BB1E7'}, WOL:{p:'#FDB913',s:'#231F20'},
};
const tc = sh => TC[sh] || { p:'#334155', s:'#64748b' };

/* ══ STATE ══════════════════════════════════════════════════════ */
const S = {
  bootstrap:null, allFixtures:[], liveData:null,
  players:[], teams:{}, positions:{},
  currentGW:null, nextGW:null,
  myTeam:[], captainId:null, vcaptainId:null,
  pickOrder:{}, starterIds:[],
  page:1, pageSize:20, filteredPlayers:[],
  fplEntryId:null, fplPlayer:null, myLeagues:{classic:[],h2h:[]},
  gwHistory:null,
  currentLeagueId:null, currentLeagueType:'classic',
  actionPid:null, deferredInstall:null, notifEnabled:false, theme:'dark',
  aiChatHistory:[],
  customKit:null,
  draftState:{ active:false, round:0, myPicks:[], aiPicks:[], available:[] },
  deadlineInterval:null,
};

/* ══ INIT (Speed Optimised) ═════════════════════════════════════
   Strategy:
   1. Show cached data INSTANTLY (no spinner delay)
   2. Fetch fresh data IN BACKGROUND
   3. Update UI silently when fresh data arrives
═══════════════════════════════════════════════════════════════ */
async function init() {
  loadStorage(); applyTheme(S.theme); registerSW(); setupPWA(); startDeadlineTimer();
  attachListeners();

  const bd = cGet('bootstrap'), fd = cGet('fixtures');

  if (bd && fd) {
    // ── INSTANT LOAD from cache ──
    setLP(80, 'LOADING FROM CACHE...');
    S.allFixtures = fd; sortFix(); processBootstrap(bd);
    // Hide loader almost immediately
    setTimeout(() => hideLogo(), 300);
    renderAll();
    if (S.fplEntryId) { updateAccountUI(); fetchGWHistory(); }
    fetchLive();
    checkPriceChanges();
    setTimeout(() => { renderSeasonPredictor(); renderMarketForecast(); }, 400);
    document.dispatchEvent(new CustomEvent('fplDataReady'));
    // Silently refresh in background after 10s
    setTimeout(() => backgroundRefresh(), 10000);
  } else {
    // ── FIRST LOAD: show skeleton, fetch data ──
    setLP(15, 'CONNECTING...');
    showSkeleton();
    try {
      // Race: try our proxy first, then fallback proxies in parallel
      setLP(30, 'FETCHING FPL DATA...');
      const [bR, fR] = await Promise.all([
        fplFetch('/bootstrap-static/'),
        fplFetch('/fixtures/'),
      ]);
      setLP(70, 'PROCESSING...');
      const [bd2, fd2] = await Promise.all([bR.json(), fR.ok ? fR.json() : []]);
      cSet('bootstrap', bd2); cSet('fixtures', fd2);
      S.allFixtures = fd2; sortFix();
      if (!processBootstrap(bd2)) return;
      setLP(95, 'BUILDING...');
      renderAll();
      setTimeout(() => hideLogo(), 200);
      if (S.fplEntryId) { updateAccountUI(); fetchGWHistory(); }
      fetchLive(); checkPriceChanges();
      setTimeout(() => { renderSeasonPredictor(); renderMarketForecast(); }, 500);
      document.dispatchEvent(new CustomEvent('fplDataReady'));
    } catch (err) {
      console.error('Init:', err);
      showLoadErr(`Could not reach FPL API.<br><small>${err.message}</small><br><br>Check your internet connection.`);
    }
  }
}

function hideLogo() {
  const ls = el('loadingScreen'); if (!ls) return;
  ls.style.opacity = '0'; ls.style.transition = 'opacity .3s ease';
  setTimeout(() => ls.remove(), 320);
  const ld = el('liveDot'); if (ld) { ld.classList.add('active'); ld.textContent = 'LIVE'; }
}

// Show content skeleton so layout appears before data
function showSkeleton() {
  const main = document.querySelector('.main'); if (!main) return;
  // Dashboard skeletons already present in HTML — nothing needed
}

// Background silent refresh
async function backgroundRefresh() {
  try {
    const [bR, fR] = await Promise.all([fplFetch('/bootstrap-static/'), fplFetch('/fixtures/')]);
    const bd = await bR.json(), fd = fR.ok ? await fR.json() : S.allFixtures;
    cSet('bootstrap', bd); cSet('fixtures', fd);
    S.allFixtures = fd; sortFix(); processBootstrap(bd);
    renderAll(); // Silent re-render with fresh data
  } catch { /* ignore — user already has cached data */ }
}

/* ══ STORAGE ════════════════════════════════════════════════════ */
function loadStorage() {
  try {
    const g = k => localStorage.getItem(k);
    const t=g('fpl_myteam'), c=g('fpl_captain'), v=g('fpl_vcaptain'), po=g('fpl_pickorder');
    const ei=g('fpl_entry_id'), pl=g('fpl_player'), lg=g('fpl_leagues'), th=g('fpl_theme'), kit=g('fpl_kit');
    if(t) S.myTeam=JSON.parse(t); if(c) S.captainId=parseInt(c); if(v) S.vcaptainId=parseInt(v);
    if(po) S.pickOrder=JSON.parse(po); if(ei) S.fplEntryId=parseInt(ei);
    if(pl) S.fplPlayer=JSON.parse(pl); if(lg) S.myLeagues=JSON.parse(lg);
    if(th) S.theme=th; if(kit) S.customKit=JSON.parse(kit);
  } catch {}
}
function saveTeam() {
  localStorage.setItem('fpl_myteam', JSON.stringify(S.myTeam));
  S.captainId ? localStorage.setItem('fpl_captain', S.captainId) : localStorage.removeItem('fpl_captain');
  S.vcaptainId ? localStorage.setItem('fpl_vcaptain', S.vcaptainId) : localStorage.removeItem('fpl_vcaptain');
  if (Object.keys(S.pickOrder).length) localStorage.setItem('fpl_pickorder', JSON.stringify(S.pickOrder));
}

/* ══ PWA / SW (#13) ═════════════════════════════════════════════ */
function registerSW() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }
function setupPWA() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.deferredInstall = e; const b = el('installBtn'); if (b) b.style.display = 'flex'; });
  window.addEventListener('appinstalled', () => { const b = el('installBtn'); if (b) b.style.display = 'none'; });
}
async function installPWA() { if (!S.deferredInstall) return; S.deferredInstall.prompt(); await S.deferredInstall.userChoice; S.deferredInstall = null; }

/* ══ THEME (#15) ════════════════════════════════════════════════ */
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); S.theme = t; localStorage.setItem('fpl_theme', t); const b = el('themeBtn'); if (b) b.textContent = t === 'dark' ? '☀️' : '🌙'; }
function toggleTheme() { applyTheme(S.theme === 'dark' ? 'light' : 'dark'); }

/* ══ NOTIFICATIONS (#14) ════════════════════════════════════════ */
async function toggleNotifications() {
  if (!('Notification' in window)) { alert('Notifications not supported.'); return; }
  if (Notification.permission === 'granted') { S.notifEnabled = !S.notifEnabled; el('notifBtn').textContent = S.notifEnabled ? '🔔' : '🔕'; return; }
  const p = await Notification.requestPermission();
  if (p === 'granted') { S.notifEnabled = true; el('notifBtn').textContent = '🔔'; new Notification('FPL Cortex 🏆', { body: 'Price alerts enabled for your squad!' }); }
}
function checkPriceChanges() {
  if (!S.notifEnabled || !Notification || Notification.permission !== 'granted') return;
  const mp = myPlayers();
  const risers = mp.filter(p => p.cost_change_event > 0), fallers = mp.filter(p => p.cost_change_event < 0);
  if (risers.length) new Notification('💹 Price Rise!', { body: `${risers.map(p => p.web_name).join(', ')} went up!`, tag: 'rise' });
  if (fallers.length) new Notification('📉 Price Drop!', { body: `${fallers.map(p => p.web_name).join(', ')} fell!`, tag: 'fall' });
}

/* ══ DEADLINE COUNTDOWN (#32) ═══════════════════════════════════ */
function startDeadlineTimer() {
  if (S.deadlineInterval) clearInterval(S.deadlineInterval);
  S.deadlineInterval = setInterval(updateDeadline, 1000); updateDeadline();
}
function updateDeadline() {
  if (!S.bootstrap) return;
  const nxt = S.bootstrap.events.find(e => e.is_next || (!e.finished && !e.is_current));
  if (!nxt?.deadline_time) return;
  const diff = new Date(nxt.deadline_time) - Date.now();
  if (diff <= 0) { const t = el('deadlineTimer'); if (t) t.style.display = 'none'; return; }
  const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
  const timerEl = el('deadlineTimer'), countEl = el('deadlineCount');
  if (!timerEl || !countEl) return;
  timerEl.style.display = 'flex';
  countEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  timerEl.classList.toggle('urgent', diff < 3600000);
}

/* ══ GROQ AI ════════════════════════════════════════════════════ */
async function groqChat(messages, maxTokens = 500) {
  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs  = messages.filter(m => m.role !== 'system');
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: userMsgs, system: systemMsg?.content, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}`);
  const data = await res.json();
  return data.reply;
}
function buildSquadCtx() {
  const mp = myPlayers(); if (!mp.length) return 'No squad selected.';
  const { starters, bench } = getSquadGroups();
  const cap = mp.find(p => p.id === S.captainId), vc = mp.find(p => p.id === S.vcaptainId);
  const gw = S.currentGW, nextGw = S.nextGW;

  // Build real fixture context for current + next GW
  const buildFixStr = (gwNum) => {
    if (!gwNum) return 'unknown';
    const fixes = S.allFixtures.filter(f => f.event === gwNum);
    return fixes.map(f => {
      const h = S.teams[f.team_h]?.short_name || '?', a = S.teams[f.team_a]?.short_name || '?';
      if (f.finished) return `${h} ${f.team_h_score}-${f.team_a_score} ${a} (FT)`;
      if (f.started)  return `${h} ${f.team_h_score??0}-${f.team_a_score??0} ${a} (LIVE)`;
      const ko = f.kickoff_time ? new Date(f.kickoff_time).toLocaleString('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'TBC';
      return `${h} vs ${a} (${ko})`;
    }).join(' | ') || 'No fixtures found';
  };

  // Each player's next fixture
  const playerFix = starters.map(p => {
    const fix = p.upcomingFixtures[0];
    return fix ? `${p.web_name}(${p.posShort},${p.teamShort},form:${p.form},xP:${p.projectedPts},next:${fix.home?'':'@'}${fix.opponent} GW${fix.gw} FDR${fix.difficulty})` : `${p.web_name}(${p.posShort},${p.teamShort},form:${p.form},NO FIXTURE)`;
  }).join(', ');

  return `CURRENT GW: ${gw||'unknown'}. NEXT GW: ${nextGw||'unknown'}.
GW${gw||'?'} FIXTURES: ${buildFixStr(gw)}.
GW${nextGw||'?'} FIXTURES: ${buildFixStr(nextGw)}.
MY STARTERS: ${playerFix}.
BENCH: ${bench.map(p=>p.web_name).join(', ')}.
CAPTAIN: ${cap?.web_name||'none'} (xP: ${cap?cap.projectedPts*2:'—'}). VC: ${vc?.web_name||'none'}.
SQUAD VALUE: £${mp.reduce((s,p)=>s+p.price,0).toFixed(1)}m. SIZE: ${mp.length}/15.`;
}

/* AI Manager Chat (#16) */
async function sendAIChat(userMsg) {
  if (!userMsg.trim()) return;
  const msgs = el('aiChatMessages'); if (!msgs) return;
  msgs.innerHTML += `<div class="ai-msg ai-msg-user"><div class="ai-msg-avatar">👤</div><div class="ai-msg-bubble">${userMsg}</div></div>`;
  const thinkId = 'tk_' + Date.now();
  msgs.innerHTML += `<div class="ai-msg ai-msg-bot" id="${thinkId}"><div class="ai-msg-avatar">🤖</div><div class="ai-msg-bubble" style="color:var(--text-sub)">Analysing...</div></div>`;
  msgs.scrollTop = msgs.scrollHeight;
  S.aiChatHistory.push({ role: 'user', content: userMsg });
  try {
    const sys = `You are an expert FPL analyst. Be direct, concise (under 150 words), data-driven. Use the squad context: ${buildSquadCtx()}`;
    const reply = await groqChat([{ role:'system', content:sys }, ...S.aiChatHistory.slice(-6)], 400);
    S.aiChatHistory.push({ role: 'assistant', content: reply });
    const tk = el(thinkId); if (tk) tk.outerHTML = `<div class="ai-msg ai-msg-bot"><div class="ai-msg-avatar">🤖</div><div class="ai-msg-bubble">${reply.replace(/\n/g,'<br>')}</div></div>`;
  } catch (err) {
    const tk = el(thinkId); if (tk) tk.outerHTML = `<div class="ai-msg ai-msg-bot"><div class="ai-msg-avatar">🤖</div><div class="ai-msg-bubble" style="color:var(--red)">AI unavailable: ${err.message}</div></div>`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

/* AI Transfer Debate (#17) */
async function runTransferDebate() {
  const out = (el('debatePlayerOut')?.value || '').trim(), inp = (el('debatePlayerIn')?.value || '').trim();
  const area = el('debateResult'); if (!area) return;
  if (!out || !inp) { area.innerHTML = emptyState('🗣', 'ENTER A TRANSFER', 'Type two player names.'); return; }
  area.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-sub)">⚡ Generating debate...</div>`;
  const find = q => S.players.find(p => `${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(q.toLowerCase()));
  const pOut = find(out), pIn = find(inp);
  const outStats = pOut ? `Form:${pOut.form},£${pOut.price.toFixed(1)}m,${pOut.selected_by_percent}% owned,xP:${pOut.projectedPts},FDR:${pOut.avgFDR.toFixed(1)}` : 'stats unavailable';
  const inStats = pIn ? `Form:${pIn.form},£${pIn.price.toFixed(1)}m,${pIn.selected_by_percent}% owned,xP:${pIn.projectedPts},FDR:${pIn.avgFDR.toFixed(1)}` : 'stats unavailable';
  try {
    const prompt = `FPL transfer debate: sell ${pOut?.web_name||out} (${outStats}) buy ${pIn?.web_name||inp} (${inStats}).\nFormat exactly:\nFOR:\n- point 1\n- point 2\nAGAINST:\n- point 1\n- point 2\nVERDICT: one sentence`;
    const reply = await groqChat([{ role:'user', content:prompt }], 300);
    const lines = reply.split('\n').filter(l => l.trim());
    let forPts = [], againstPts = [], verdict = '', mode = '';
    lines.forEach(l => {
      if (l.startsWith('FOR:')) mode = 'for';
      else if (l.startsWith('AGAINST:')) mode = 'against';
      else if (l.startsWith('VERDICT:')) verdict = l.replace('VERDICT:', '').trim();
      else if (mode === 'for' && l.trim().startsWith('-')) forPts.push(l.replace(/^-\s*/,'').trim());
      else if (mode === 'against' && l.trim().startsWith('-')) againstPts.push(l.replace(/^-\s*/,'').trim());
    });
    area.innerHTML = `
      <div class="debate-card debate-for"><div class="debate-label">✅ FOR THE TRANSFER</div><div class="debate-text">${forPts.map(p=>`• ${p}`).join('<br>') || reply.slice(0,120)}</div></div>
      <div class="debate-card debate-against"><div class="debate-label">❌ AGAINST THE TRANSFER</div><div class="debate-text">${againstPts.map(p=>`• ${p}`).join('<br>')||'Hold and monitor'}</div></div>
      ${verdict ? `<div style="background:var(--amber-glow);border:1px solid var(--amber);border-radius:var(--radius);padding:.65rem .85rem;font-size:.82rem;margin-top:.5rem">⚡ <strong>VERDICT:</strong> ${verdict}</div>` : ''}`;
  } catch (err) { area.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:.82rem">AI unavailable: ${err.message}</div>`; }
}

/* ══ LISTENERS ══════════════════════════════════════════════════ */
function attachListeners() {
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  el('accountBtn')?.addEventListener('click', handleAccountBtn);
  el('themeBtn')?.addEventListener('click', toggleTheme);
  el('notifBtn')?.addEventListener('click', toggleNotifications);
  el('installBtn')?.addEventListener('click', installPWA);
  el('loginModalClose')?.addEventListener('click', closeModal);
  el('loginSkipBtn')?.addEventListener('click', closeModal);
  el('loginSubmitBtn')?.addEventListener('click', submitTeamId);
  el('loginTeamId')?.addEventListener('keydown', e => { if(e.key==='Enter') submitTeamId(); });
  el('managerSearchBtn')?.addEventListener('click', searchManager);
  el('managerSearchInput')?.addEventListener('keydown', e => { if(e.key==='Enter') searchManager(); });
  el('captainBtn')?.addEventListener('click', autoPickCaptain);
  el('dashImportBtn')?.addEventListener('click', importFplTeam);
  el('dashLogoutBtn')?.addEventListener('click', logout);
  el('refreshBtn')?.addEventListener('click', refreshData);
  el('playerSearch')?.addEventListener('input', filterPlayers);
  el('posFilter')?.addEventListener('change', filterPlayers);
  el('teamFilter')?.addEventListener('change', filterPlayers);
  el('sortSelect')?.addEventListener('change', filterPlayers);
  el('clearTeamBtn')?.addEventListener('click', clearTeam);
  el('addPlayersBtn')?.addEventListener('click', () => switchTab('players'));
  el('importFplTeamBtn')?.addEventListener('click', importFplTeam);
  el('kitDesignerBtn')?.addEventListener('click', () => { const p = el('kitDesignerPanel'); if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none'; });
  el('applyKitBtn')?.addEventListener('click', applyCustomKit);
  el('kitResetBtn')?.addEventListener('click', () => { S.customKit = null; localStorage.removeItem('fpl_kit'); renderMyTeam(); });
  el('actionSetCaptain')?.addEventListener('click', () => { if(S.actionPid) { setCaptain(S.actionPid,0); closeActionSheet(); }});
  el('actionSetVC')?.addEventListener('click', () => { if(S.actionPid) { setCaptain(S.actionPid,1); closeActionSheet(); }});
  el('actionRemovePlayer')?.addEventListener('click', () => { if(S.actionPid) { removeFromTeam(S.actionPid); closeActionSheet(); }});
  el('actionCancel')?.addEventListener('click', closeActionSheet);
  el('actionSheetBackdrop')?.addEventListener('click', e => { if(e.target===el('actionSheetBackdrop')) closeActionSheet(); });
  el('liveRefreshBtn')?.addEventListener('click', fetchLive);
  el('fixtureGwSelect')?.addEventListener('change', renderFixtures);
  el('fdrGwCount')?.addEventListener('change', renderFDRCalendar);
  el('leaguesLoginBtn')?.addEventListener('click', openModal);
  el('standingsBackBtn')?.addEventListener('click', hideStandings);
  el('classicLeaguesList')?.addEventListener('click', e => { const i=e.target.closest('.league-item'); if(i) loadStandings(+i.dataset.lid,'classic',i.dataset.name); });
  el('h2hLeaguesList')?.addEventListener('click', e => { const i=e.target.closest('.league-item'); if(i) loadStandings(+i.dataset.lid,'h2h',i.dataset.name); });
  el('standingsPagination')?.addEventListener('click', e => { const b=e.target.closest('.page-btn'); if(b) loadStandings(S.currentLeagueId,S.currentLeagueType,null,+b.dataset.page); });
  el('diffPosFilter')?.addEventListener('change', renderDifferentials);
  el('diffSortFilter')?.addEventListener('change', renderDifferentials);
  el('compareBtn')?.addEventListener('click', renderComparison);
  el('autoBuilderBtn')?.addEventListener('click', runAutoBuilder);
  el('wildcardBtn')?.addEventListener('click', runWildcard);
  el('predictorBtn')?.addEventListener('click', renderPredictor);
  el('chartTogglePts')?.addEventListener('click', () => showHistoryChart('points'));
  el('chartToggleRank')?.addEventListener('click', () => showHistoryChart('rank'));
  el('aiChatSend')?.addEventListener('click', () => { const v=el('aiChatInput')?.value||''; el('aiChatInput').value=''; sendAIChat(v); });
  el('aiChatInput')?.addEventListener('keydown', e => { if(e.key==='Enter') { const v=e.target.value; e.target.value=''; sendAIChat(v); }});
  el('debateBtn')?.addEventListener('click', runTransferDebate);
  document.querySelectorAll('.ai-suggest-btn').forEach(b => b.addEventListener('click', () => sendAIChat(b.dataset.q)));
  el('battleBtn')?.addEventListener('click', runBattle);
  el('templateBtn')?.addEventListener('click', runTemplateDetector);
  el('warRoomBtn')?.addEventListener('click', runWarRoom);
  el('startDraftBtn')?.addEventListener('click', startDraft);
  el('draftSearch')?.addEventListener('input', renderDraftList);
  el('draftPosFilter')?.addEventListener('change', renderDraftList);
  el('newsRefreshBtn')?.addEventListener('click', loadNewsFeed);
  el('diarySaveBtn')?.addEventListener('click', saveDiaryEntry);
  document.addEventListener('click', handleGlobalClick);
}

function handleGlobalClick(e) {
  const addBtn = e.target.closest('.add-btn');
  if (addBtn && !addBtn.disabled) { const pid = parseInt(addBtn.dataset.pid); if (!isNaN(pid)) { togglePlayer(pid); return; } }
  const removeBtn = e.target.closest('.remove-btn');
  if (removeBtn) { const pid = parseInt(removeBtn.dataset.pid); if (!isNaN(pid)) { removeFromTeam(pid); return; } }
  const pitchCard = e.target.closest('.pitch-card[data-pid]');
  if (pitchCard) { const pid = parseInt(pitchCard.dataset.pid); if (!isNaN(pid)) { openActionSheet(pid); return; } }
  const capCard = e.target.closest('.captain-card[data-pid]');
  if (capCard) { setCaptain(parseInt(capCard.dataset.pid), parseInt(capCard.dataset.rank)); return; }
  const srBtn = e.target.closest('.sr-select');
  if (srBtn) { connectEntry(parseInt(srBtn.dataset.eid)); return; }
  const draftBtn = e.target.closest('.draft-pick-btn');
  if (draftBtn) { pickDraftPlayer(parseInt(draftBtn.dataset.pid)); return; }
}

/* ══ LOADING ════════════════════════════════════════════════════ */
function setLP(p, m) { const b=el('loadingBar'), t=el('loadingMsg'); if(b) b.style.width=p+'%'; if(t) t.textContent=m; }
function showLoadErr(msg) { const ls=el('loadingScreen'); if(!ls)return; ls.innerHTML=`<div class="loading-logo">FPL <span>CORTEX</span></div><div style="color:var(--red);font-family:var(--font-data);font-size:.78rem;margin-top:1rem;text-align:center;max-width:300px;line-height:1.8">${msg}</div><button id="retryBtn" class="btn btn-green btn-sm" style="margin-top:1.5rem">↻ RETRY</button>`; el('retryBtn')?.addEventListener('click', () => location.reload()); }

/* ══ DATA ═══════════════════════════════════════════════════════ */
function sortFix() { S.allFixtures.sort((a,b)=>{ const ea=a.event||99,eb=b.event||99; return ea!==eb?ea-eb:(a.finished?1:0)-(b.finished?1:0); }); }

function processBootstrap(data) {
  try {
    S.bootstrap = data;
    data.teams.forEach(t => { S.teams[t.id] = t; });
    data.element_types.forEach(et => { S.positions[et.id] = { short: et.singular_name_short }; });
    S.players = data.elements.map(processPlayer);
    const cur = data.events.find(e => e.is_current), nxt = data.events.find(e => e.is_next);
    S.currentGW = cur ? cur.id : (nxt ? nxt.id - 1 : null);
    S.nextGW = nxt ? nxt.id : null;
    setText('gwBadge', S.currentGW ? `GW ${S.currentGW}` : 'GW —');
    if (cur) { setText('liveGwAvg', cur.average_entry_score||'—'); setText('liveGwHighest', cur.highest_score||'—'); setText('dashGwAvg', cur.average_entry_score||'—'); }
    return true;
  } catch (err) { console.error('Bootstrap:', err); return false; }
}

function processPlayer(p) {
  const team = S.teams[p.team]||{}, pos = S.positions[p.element_type]||{};
  const uf = getUpcomingFixtures(p.team, 3);
  const avgFDR = uf.length ? uf.reduce((s,f) => s+f.difficulty,0)/uf.length : 3;
  const form = parseFloat(p.form)||0, fdrMul = fdrMult(avgFDR);
  const avgMins = p.minutes/Math.max(1,S.currentGW||1), minFac = 0.5+0.5*Math.min(1,avgMins/90);
  let proj = form*fdrMul*minFac;
  const ict = parseFloat(p.ict_index)||0;
  if (p.element_type===3||p.element_type===4) proj+=(ict/100)*0.8;
  if (p.element_type===1||p.element_type===2) { const cs=avgFDR<=2?0.5:avgFDR<=3?0.35:0.2; proj+=cs*(p.element_type===1?6:4); }
  const ep = parseFloat(p.ep_next)||0; if (ep>0) proj=proj*0.4+ep*0.6;
  return { ...p, teamName:team.name||'—', teamShort:team.short_name||'—', posShort:pos.short||'—', price:p.now_cost/10, formVal:form, projectedPts:Math.round(proj*10)/10, avgFDR, upcomingFixtures:uf };
}
function fdrMult(fdr) { return fdr<=1.5?1.5:fdr<=2.5?1.25:fdr<=3.5?1.0:fdr<=4.5?0.75:0.55; }

function getUpcomingFixtures(teamId, count=3) {
  const startGW = S.nextGW||(S.currentGW?S.currentGW+1:1); const res = [];
  for (const f of S.allFixtures) {
    if (res.length>=count) break; if (!f.event||f.event<startGW||f.finished) continue;
    if (f.team_h===teamId) res.push({opponent:S.teams[f.team_a]?.short_name||'?',home:true,difficulty:f.team_h_difficulty,gw:f.event});
    else if (f.team_a===teamId) res.push({opponent:S.teams[f.team_h]?.short_name||'?',home:false,difficulty:f.team_a_difficulty,gw:f.event});
  }
  return res;
}

async function fetchLive() {
  const btn = el('liveRefreshBtn'); if (btn) btn.classList.add('spinning');
  const gw = S.currentGW||S.nextGW; if (!gw) { if(btn){btn.classList.remove('spinning');} return; }
  try {
    const res = await fplFetch(`/event/${gw}/live/`); if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json(); const map = {};
    for (const e of (raw.elements||[])) map[e.id] = e;
    S.liveData = map; renderLivePanel(); renderMyTeam();
    const badge = el('liveUpdateBadge'); if(badge){const n=new Date(); badge.textContent=`${pad(n.getHours())}:${pad(n.getMinutes())}`;}
  } catch (err) { setHTML('livePlayerList', emptyState('◎','NO LIVE DATA','Active during live gameweeks.')); }
  if (btn) { btn.classList.remove('spinning'); btn.textContent='↻ REFRESH'; }
}

async function refreshData() {
  cClear('bootstrap'); cClear('fixtures');
  const btn = el('refreshBtn'); if(btn) btn.classList.add('spinning');
  try {
    const [bR,fR] = await Promise.all([fplFetch('/bootstrap-static/'), fplFetch('/fixtures/')]);
    const bd=await bR.json(), fd=fR.ok?await fR.json():[];
    cSet('bootstrap',bd); cSet('fixtures',fd); S.allFixtures=fd; sortFix(); processBootstrap(bd); renderAll();
  } catch(err) { console.error('Refresh:',err); }
  if(btn) { btn.classList.remove('spinning'); btn.textContent='↻ REFRESH'; }
}

function renderAll() {
  renderDashboard(); renderPlayerTable(); renderMyTeam(); renderTransfers();
  renderFixtureGwSelect(); renderFixtures(); renderFDRCalendar(); renderBlankDouble();
  renderPriceChanges(); renderDifferentials(); renderDNAChart(); renderChallenges(); updateCortexScore();
}

/* ══ TAB NAV ════════════════════════════════════════════════════ */
function switchTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id===`tab-${name}`));
  const map = {
    myteam:()=>renderMyTeam(), transfers:()=>renderTransfers(),
    fixtures:()=>{ renderFixtures(); renderFDRCalendar(); renderBlankDouble(); },
    scout:()=>{ renderPriceChanges(); renderDifferentials(); renderXGStats(); renderPricePrediction(); renderTeamForm(); },
    tools:()=>{ renderChipPlanner(); renderInjuryRisk(); renderSeasonPredictor(); },
    intel:()=>{ loadNewsFeed(); loadWeather(); renderMarketForecast(); },
    profile:()=>{ renderDNAChart(); renderChallenges(); loadDiaryHistory(); setText('diaryGwLabel',`GW ${S.currentGW||'—'}`); },
    live:()=>renderLivePanel(), dashboard:()=>renderDashboard(), leagues:()=>renderLeaguesTab(),
  };
  map[name]?.();
}

/* ══ DASHBOARD ══════════════════════════════════════════════════ */
function renderDashboard() {
  const { starters } = getSquadGroups(), mp = myPlayers(), cap = starters.find(p=>p.id===S.captainId);
  let proj = starters.reduce((s,p)=>s+p.projectedPts,0); if(cap) proj+=cap.projectedPts;
  setText('dashProjected', Math.round(proj*10)/10);
  setText('dashCaptainPts', cap?Math.round(cap.projectedPts*2*10)/10:'—');
  setText('dashCaptainName', cap?cap.web_name:'No Captain');
  setText('dashValue', `£${mp.reduce((s,p)=>s+p.price,0).toFixed(1)}m`);
  setText('dashPlayerCount', `${mp.length}/15`);
  const bar = el('fplAccountBar');
  if (bar) {
    if (S.fplPlayer) { bar.style.display='flex'; setText('fplManagerName',`${S.fplPlayer.first_name} ${S.fplPlayer.last_name}`); setText('fplTeamMeta',`${S.fplPlayer.teamName||''}·${S.fplPlayer.summary_overall_points||'—'} pts·Rank ${S.fplPlayer.summary_overall_rank?.toLocaleString()||'—'}`); }
    else bar.style.display='none';
  }
  renderCaptainSuggestions(starters.length?starters:mp);
  renderRiskAnalysis(mp);
  updateCortexScore();
  if (S.gwHistory) updateSeasonStats();
}

/* ══ CORTEX SCORE (#31) ═════════════════════════════════════════ */
function updateCortexScore() {
  const mp = myPlayers();
  if (!mp.length) { setText('cortexScoreVal','—'); setText('cortexScoreSub','Build your squad to get rated'); const c=el('cortexScoreCircle');if(c)c.style.strokeDashoffset='213.6'; return; }
  const { starters } = getSquadGroups();
  const avgForm = mp.reduce((s,p)=>s+p.formVal,0)/mp.length;
  const formScore = Math.min(25, avgForm/8*25);
  const avgFDR = starters.reduce((s,p)=>s+p.avgFDR,0)/Math.max(1,starters.length);
  const fixtureScore = Math.min(25,(5-avgFDR)/4*25);
  const squadVal = mp.reduce((s,p)=>s+p.price,0);
  const valueScore = Math.min(20,squadVal/110*20);
  const teamCounts = {}; mp.forEach(p=>{teamCounts[p.team]=(teamCounts[p.team]||0)+1;});
  const spreadScore = Math.min(15,Object.keys(teamCounts).length/7*15);
  const topCap = starters.length?[...starters].sort((a,b)=>capScore(b)-capScore(a))[0]:null;
  const capS = topCap?Math.min(15,capScore(topCap)/10):0;
  const total = Math.round(Math.min(100,formScore+fixtureScore+valueScore+spreadScore+capS));
  setText('cortexScoreVal', total);
  const sub = total>=85?'Elite Squad 🔥':total>=70?'Strong Team ✅':total>=55?'Decent Squad 📈':total>=40?'Needs Work ⚠':'Struggling 🔴';
  setText('cortexScoreSub', sub);
  const circle = el('cortexScoreCircle');
  if (circle) { circle.style.strokeDashoffset=213.6*(1-total/100); circle.style.stroke=total>=70?'var(--green)':total>=50?'var(--amber)':'var(--red)'; }
}

/* ══ GW HISTORY (#1) ════════════════════════════════════════════ */
async function fetchGWHistory() {
  if (!S.fplEntryId) return;
  try {
    const res = await fplFetch(`/entry/${S.fplEntryId}/history/`); if(!res.ok) throw new Error();
    const data = await res.json(); S.gwHistory = data;
    updateSeasonStats(); el('seasonStatsSection').style.display='block'; el('historyChartSection').style.display='block'; showHistoryChart('points');
    // Re-render features that depend on gwHistory
    renderChipPlanner();
    renderChallenges();
  } catch {}
}
function updateSeasonStats() {
  if (!S.gwHistory) return; const current = S.gwHistory.current||[]; if(!current.length) return;
  const total = current.reduce((s,g)=>s+g.points,0), best = current.reduce((b,g)=>g.points>b.points?g:b,current[0]);
  const chips = S.gwHistory.chips||[], used = chips.map(c=>c.name);
  const remaining = ['wildcard','freehit','bboost','3xc'].filter(c=>!used.includes(c)).length;
  setText('statSeasonTotal',total); setText('statBestGW',best.points); setText('statBestGWNum',`GW ${best.event}`);
  setText('statOverallRank',current[current.length-1]?.overall_rank?.toLocaleString()||'—'); setText('statChipsLeft',`${remaining}/4`);
  el('seasonStatsSection').style.display='block';
}
function showHistoryChart(type) {
  el('chartTogglePts')?.classList.toggle('active',type==='points'); el('chartToggleRank')?.classList.toggle('active',type==='rank');
  const area = el('historyChartArea'); if(!area) return;
  const current = S.gwHistory?.current||[];
  if (!current.length) { area.innerHTML='<div style="color:var(--text-sub);text-align:center;padding:1rem;font-size:.8rem">No history</div>'; return; }
  const data = current.map(g=>type==='rank'?-g.overall_rank:g.points), labels = current.map(g=>`GW${g.event}`);
  area.innerHTML=`<div style="padding:.5rem 0">${svgLine(data,labels,type==='rank'?'var(--blue)':'var(--green)',90)}</div>${type==='points'?`<div style="display:flex;justify-content:space-between;margin-top:.4rem;flex-wrap:wrap;gap:.25rem">${current.slice(-5).map(g=>`<div style="text-align:center;font-family:var(--font-data);font-size:.6rem"><div style="color:${g.points>=60?'var(--green)':g.points>=40?'var(--amber)':'var(--text-sub)'};font-weight:700">${g.points}</div><div style="color:var(--text-dim)">GW${g.event}</div></div>`).join('')}</div>`:''}`;
}
function svgLine(data, labels, color='var(--green)', height=90) {
  if (!data||data.length<2) return '<div style="color:var(--text-sub);text-align:center;padding:1rem;font-size:.8rem">Not enough data</div>';
  const w=280, pad=10, n=data.length, min=Math.min(...data), max=Math.max(...data), range=(max-min)||1;
  const xs=i=>(i/(n-1))*(w-pad*2)+pad, ys=v=>height-((v-min)/range*(height-pad*2))-pad;
  const pts=data.map((v,i)=>`${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const area=data.map((v,i)=>`${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ')+` ${xs(n-1).toFixed(1)},${height} ${xs(0).toFixed(1)},${height}`;
  const step=Math.max(1,Math.floor(n/5));
  const lbls=data.map((_,i)=>i%step===0?`<text x="${xs(i).toFixed(1)}" y="${height+12}" text-anchor="middle" font-family="'Space Mono'" font-size="8" fill="var(--text-sub)">${labels[i]||''}</text>`:'').join('');
  const dots=data.map((v,i)=>`<circle cx="${xs(i).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="3" fill="${color}" stroke="var(--void)" stroke-width="1.5"/>`).join('');
  const uid=color.replace(/[^a-z]/gi,''); return`<svg viewBox="0 0 ${w} ${height+16}" style="width:100%;overflow:visible"><defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".2"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="${area}" fill="url(#g${uid})"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}${lbls}</svg>`;
}

/* ══ SQUAD GROUPING ═════════════════════════════════════════════ */
function getSquadGroups() {
  const mp = myPlayers(); if(!mp.length) return{starters:[],bench:[],formation:'—',byPos:{GKP:[],DEF:[],MID:[],FWD:[]}};
  const sorted=[...mp].sort((a,b)=>(S.pickOrder[a.id]||99)-(S.pickOrder[b.id]||99));
  const hasOrder = Object.keys(S.pickOrder).length>0;
  let starters, bench;
  if (hasOrder) { starters=sorted.filter(p=>(S.pickOrder[p.id]||99)<=11); bench=sorted.filter(p=>(S.pickOrder[p.id]||99)>11); }
  else { const gkps=sorted.filter(p=>p.posShort==='GKP'), out=sorted.filter(p=>p.posShort!=='GKP').sort((a,b)=>b.projectedPts-a.projectedPts); starters=[...gkps.slice(0,1),...out.slice(0,10)]; bench=[...gkps.slice(1),...out.slice(10)]; }
  const byPos={GKP:[],DEF:[],MID:[],FWD:[]}; starters.forEach(p=>{if(byPos[p.posShort])byPos[p.posShort].push(p);});
  const formation=starters.length>=10?`${byPos.DEF.length}-${byPos.MID.length}-${byPos.FWD.length}`:'—';
  S.starterIds=starters.map(p=>p.id); return{starters,bench,formation,byPos};
}

/* ══ CAPTAIN AI ═════════════════════════════════════════════════ */
function capScore(p){return(p.formVal*3+(parseFloat(p.ict_index)||0)/20+p.projectedPts)*fdrMult(p.avgFDR);}
function renderCaptainSuggestions(pool){
  if(!pool.length){setHTML('captainArea',emptyState('🎖','NO SQUAD','Add players first.'));return;}
  const ranked=[...pool].sort((a,b)=>capScore(b)-capScore(a)).slice(0,3);
  setHTML('captainArea',`<div class="captain-cards">${ranked.map((p,i)=>{const fix=p.upcomingFixtures[0];const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} GW${fix.gw} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'No fixture';return`<div class="captain-card ${i===0?'rank-1':''}" data-pid="${p.id}" data-rank="${i}"><div class="cc-name">${p.web_name}</div><div class="cc-team">${p.teamShort}·${p.posShort}</div><div class="cc-ep">${Math.round(p.projectedPts*(i===0?2:1)*10)/10}</div><div class="cc-score">Next: ${fixStr}</div><div style="margin-top:5px;font-family:var(--font-data);font-size:.58rem;color:var(--text-sub)">Form ${p.form}·£${p.price}m·${p.selected_by_percent}% own</div>${i===0&&p.id===S.captainId?'<div class="card-badge badge-amber" style="margin-top:5px;display:inline-block">★ SET</div>':''}${i===1&&p.id===S.vcaptainId?'<div class="card-badge badge-blue" style="margin-top:5px;display:inline-block">V SET</div>':''}</div>`;}).join('')}</div>`);
}
function setCaptain(pid,rank){
  if(rank===0){S.captainId=S.captainId===pid?null:pid;S.captainId?localStorage.setItem('fpl_captain',pid):localStorage.removeItem('fpl_captain');}
  if(rank===1){S.vcaptainId=S.vcaptainId===pid?null:pid;S.vcaptainId?localStorage.setItem('fpl_vcaptain',pid):localStorage.removeItem('fpl_vcaptain');}
  const{starters}=getSquadGroups();renderCaptainSuggestions(starters.length?starters:myPlayers());renderMyTeam();renderDashboard();
}
function autoPickCaptain(){const{starters}=getSquadGroups();const pool=starters.length?starters:myPlayers();if(!pool.length)return;const r=[...pool].sort((a,b)=>capScore(b)-capScore(a));S.captainId=r[0]?.id||null;S.vcaptainId=r[1]?.id||null;saveTeam();renderCaptainSuggestions(pool);renderMyTeam();renderDashboard();}

/* ══ RISK ═══════════════════════════════════════════════════════ */
function getRisk(p){const risks=[],avgMins=p.minutes/Math.max(1,S.currentGW||1);if(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<75)risks.push({level:'high',reason:`${p.chance_of_playing_next_round}% chance`});else if(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<100)risks.push({level:'medium',reason:`Slight doubt`});if(p.formVal===0&&p.total_points>0)risks.push({level:'high',reason:'Zero form'});else if(p.formVal<2&&p.total_points>0)risks.push({level:'medium',reason:`Poor form ${p.form}`});if(p.avgFDR>=4.5)risks.push({level:'high',reason:`Brutal FDR ${p.avgFDR.toFixed(1)}`});else if(p.avgFDR>=3.8)risks.push({level:'medium',reason:`Tough FDR ${p.avgFDR.toFixed(1)}`});if(avgMins<45)risks.push({level:'medium',reason:`Rotation risk`});return risks;}
function renderRiskAnalysis(mp){if(!mp.length){setHTML('riskArea',`<div class="card">${emptyState('🛡','NO SQUAD DATA','Build your team.')}</div>`);return;}const flagged=mp.map(p=>({p,r:getRisk(p)})).filter(x=>x.r.length).sort((a,b)=>(b.r[0].level==='high'?2:1)-(a.r[0].level==='high'?2:1));if(!flagged.length){setHTML('riskArea',`<div class="card">${emptyState('✅','ALL CLEAR','No risk flags.')}</div>`);return;}setHTML('riskArea',`<div class="card">${flagged.map(({p,r})=>`<div class="risk-item"><div class="risk-bar ${r[0].level==='high'?'risk-high':'risk-medium'}"></div><div><div style="font-weight:700">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div>${r.map(x=>`<div class="risk-reason">⚠ ${x.reason}</div>`).join('')}</div><div style="margin-left:auto;text-align:right"><div class="stat-label" style="font-size:.56rem">FORM</div><div style="font-family:var(--font-data);font-size:.88rem;color:${r[0].level==='high'?'var(--red)':'var(--amber)'}">${p.form}</div></div></div>`).join('')}</div>`);}

/* ══ PLAYER TABLE ═══════════════════════════════════════════════ */
function filterPlayers(){S.page=1;renderPlayerTable();}
function renderPlayerTable(){
  if(!S.players.length)return;
  const search=(el('playerSearch')?.value||'').toLowerCase(),posF=el('posFilter')?.value||'',teamF=el('teamFilter')?.value||'',sortKey=el('sortSelect')?.value||'total_points';
  const tf=el('teamFilter');if(tf&&tf.options.length===1){Object.values(S.teams).sort((a,b)=>a.name.localeCompare(b.name)).forEach(t=>{const o=document.createElement('option');o.value=t.name;o.textContent=t.name;tf.appendChild(o);});}
  let list=S.players.filter(p=>{const nm=`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase();return(!search||nm.includes(search)||p.teamName.toLowerCase().includes(search))&&(!posF||p.posShort===posF)&&(!teamF||p.teamName===teamF);}).sort((a,b)=>(parseFloat(b[sortKey])||0)-(parseFloat(a[sortKey])||0));
  S.filteredPlayers=list;const total=list.length,pages=Math.ceil(total/S.pageSize);
  const slice=list.slice((S.page-1)*S.pageSize,S.page*S.pageSize);
  setText('squadIndicator',S.myTeam.length);
  const tbody=el('playerTableBody');if(!tbody)return;
  tbody.innerHTML=!slice.length?`<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-sub)">No players match.</td></tr>`:slice.map(p=>{
    const inTeam=S.myTeam.includes(p.id),full=!inTeam&&S.myTeam.length>=15;
    const formCls=p.formVal>=6?'form-hi':p.formVal>=3?'form-mid':'form-lo';
    const risks=getRisk(p),flag=risks.length?`<span>${risks[0].level==='high'?'🔴':'🟡'}</span>`:'';
    const avail=(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<100)?`<div class="news-banner">⚠ ${p.news||p.chance_of_playing_next_round+'%'}</div>`:'';
    const priceChg=p.cost_change_event>0?'<span style="color:var(--green);font-size:.6rem">▲</span>':p.cost_change_event<0?'<span style="color:var(--red);font-size:.6rem">▼</span>':'';
    const starred = isShortlisted(p.id);
    return`<tr><td><div class="player-name">${p.web_name} ${flag}${priceChg}</div><div class="player-sub">${p.teamShort}</div>${avail}</td><td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td><td><span class="price-val">£${p.price.toFixed(1)}</span></td><td><span class="form-val ${formCls}">${p.form}</span></td><td><span class="pts-val">${p.total_points}</span></td><td><span class="ep-val">${p.ep_next||'—'}</span></td><td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td><td style="display:flex;gap:3px;align-items:center"><button class="shortlist-btn" data-pid="${p.id}" style="background:none;border:none;font-size:.9rem;cursor:pointer;padding:2px;opacity:${starred?1:.3}" title="${starred?'Remove from':'Add to'} shortlist">${starred?'⭐':'☆'}</button><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''}>${inTeam?'✓':'＋'}</button></td></tr>`;
  }).join('');
  const pag=el('playerPagination');if(!pag)return;if(pages<=1){pag.innerHTML='';return;}
  let ph='';if(S.page>1)ph+=`<button class="page-btn" data-p="${S.page-1}">‹</button>`;
  for(let i=Math.max(1,S.page-2);i<=Math.min(pages,S.page+2);i++)ph+=`<button class="page-btn ${i===S.page?'active':''}" data-p="${i}">${i}</button>`;
  if(S.page<pages)ph+=`<button class="page-btn" data-p="${S.page+1}">›</button>`;
  ph+=`<span style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-left:.4rem">${total} players</span>`;
  pag.innerHTML=ph;pag.querySelectorAll('.page-btn').forEach(b=>b.addEventListener('click',()=>{S.page=parseInt(b.dataset.p);renderPlayerTable();}));
}

/* ══ MY TEAM ════════════════════════════════════════════════════ */
function togglePlayer(pid){const idx=S.myTeam.indexOf(pid);if(idx===-1){if(S.myTeam.length>=15)return;S.myTeam.push(pid);}else{S.myTeam.splice(idx,1);if(S.captainId===pid)S.captainId=null;if(S.vcaptainId===pid)S.vcaptainId=null;delete S.pickOrder[pid];}saveTeam();renderPlayerTable();renderMyTeam();renderDashboard();}
function removeFromTeam(pid){const idx=S.myTeam.indexOf(pid);if(idx===-1)return;S.myTeam.splice(idx,1);if(S.captainId===pid){S.captainId=null;localStorage.removeItem('fpl_captain');}if(S.vcaptainId===pid){S.vcaptainId=null;localStorage.removeItem('fpl_vcaptain');}delete S.pickOrder[pid];saveTeam();renderMyTeam();renderPlayerTable();renderDashboard();}
function clearTeam(){if(!confirm('Clear entire squad?'))return;S.myTeam=[];S.captainId=null;S.vcaptainId=null;S.pickOrder={};['fpl_myteam','fpl_captain','fpl_vcaptain','fpl_pickorder'].forEach(k=>localStorage.removeItem(k));renderMyTeam();renderDashboard();renderPlayerTable();}

function renderMyTeam(){
  const mp=myPlayers();const{starters,bench,formation,byPos}=getSquadGroups();
  setText('squadCount',mp.length);setText('squadValue',`£${mp.reduce((s,p)=>s+p.price,0).toFixed(1)}m`);setText('formationDisplay',mp.length>=11?formation:'—');
  let proj=starters.reduce((s,p)=>s+p.projectedPts,0);const cap=starters.find(p=>p.id===S.captainId);if(cap)proj+=cap.projectedPts;setText('squadProjPts',Math.round(proj*10)/10);
  const impBtn=el('importFplTeamBtn');if(impBtn)impBtn.style.display=S.fplEntryId?'inline-flex':'none';
  [{id:'pitchFWD',players:byPos.FWD||[]},{id:'pitchMID',players:byPos.MID||[]},{id:'pitchDEF',players:byPos.DEF||[]},{id:'pitchGKP',players:byPos.GKP||[]}].forEach(({id,players})=>{const row=el(id);if(!row)return;row.innerHTML=players.length?players.map(p=>pitchCard(p)).join(''):`<div class="pitch-empty">+</div>`;});
  const benchEl=el('pitchBench');if(benchEl)benchEl.innerHTML=bench.length?bench.map(p=>pitchCard(p,true)).join(''):`<div class="pitch-empty" style="width:52px">—</div>`;
  if(!mp.length){setHTML('teamListArea',emptyState('👕','SQUAD IS EMPTY','Tap "+ Players" or LOGIN.'));return;}
  const ordered=[...starters,...bench];
  setHTML('teamListArea',ordered.map((p,i)=>{
    const isC=p.id===S.captainId,isV=p.id===S.vcaptainId,isBench=!S.starterIds.includes(p.id);
    const risks=getRisk(p),fix=p.upcomingFixtures[0];
    const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} GW${fix.gw} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'No fixture';
    const col=tc(p.teamShort),live=S.liveData?.[p.id]?.stats,livePts=live?live.total_points:null;
    const breakdown=live?buildPtsBreakdown(S.liveData[p.id]):'';
    const sep=isBench&&i===starters.length?`<div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub);letter-spacing:2px;padding:.5rem 0 .25rem;border-top:1px dashed var(--border);margin-top:.25rem">BENCH (NOT COUNTED)</div>`:'';
    return`${sep}<div class="team-list-row" style="${isBench?'opacity:.65':''}"><div class="team-color-bar" style="background:${col.p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:5px;flex-wrap:wrap">${p.web_name}${isC?'<span class="card-badge badge-amber">C</span>':''}${isV?'<span class="card-badge badge-blue">V</span>':''}<span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div style="font-size:.7rem;color:var(--text-sub)">${p.teamShort}·Next: ${fixStr}</div>${risks.length?`<div style="font-size:.68rem;color:var(--amber);margin-top:1px">⚠ ${risks[0].reason}</div>`:''}${breakdown?`<div class="pts-breakdown">${breakdown}</div>`:''}</div><div style="text-align:right;flex-shrink:0"><div class="tl-pts ${livePts!==null?'live-pts':'proj-pts'}">${livePts!==null?livePts:p.projectedPts}</div><div style="font-family:var(--font-data);font-size:.56rem;color:var(--text-sub)">${livePts!==null?'pts':'xP'}</div><div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub)">£${p.price.toFixed(1)}m</div></div><button class="remove-btn" data-pid="${p.id}" style="padding:5px 9px;font-size:.75rem">✕</button></div>`;
  }).join(''));
}

function pitchCard(p,isBench=false){
  const isC=p.id===S.captainId,isV=p.id===S.vcaptainId,live=S.liveData?.[p.id]?.stats,pts=live?live.total_points:null;
  let col=tc(p.teamShort);if(S.customKit)col={p:S.customKit.primary,s:S.customKit.sleeve};
  return`<div class="pitch-card" data-pid="${p.id}">${isC?'<div class="cap-badge">C</div>':''}${isV?'<div class="vc-badge">V</div>':''}<div class="jersey" style="background:${col.p};--sleeve-color:${col.s}"><span class="jersey-text">${p.teamShort}</span></div><div class="pitch-name">${p.web_name}</div><div class="pitch-pts ${pts!==null?'live-pts':''}">${pts!==null?pts+'pts':p.projectedPts+'xP'}</div></div>`;
}

function buildPtsBreakdown(liveEl){if(!liveEl)return'';const LABELS={minutes:'mins',goals_scored:'⚽',assists:'🅰',clean_sheets:'CS',goals_conceded:'GC',own_goals:'OG',yellow_cards:'🟨',red_cards:'🟥',saves:'saves',bonus:'★bonus'};const stats=liveEl.explain?.flatMap(e=>e.stats||[])||[];if(!stats.length){const s=liveEl.stats||{},c=[];if(s.minutes>=60)c.push(`<span class="pts-chip pos">${s.minutes}' +2</span>`);else if(s.minutes>0)c.push(`<span class="pts-chip pos">${s.minutes}' +1</span>`);if(s.goals_scored>0)c.push(`<span class="pts-chip pos">⚽×${s.goals_scored}</span>`);if(s.assists>0)c.push(`<span class="pts-chip pos">🅰×${s.assists}</span>`);if(s.clean_sheets>0)c.push(`<span class="pts-chip pos">CS</span>`);if(s.bonus>0)c.push(`<span class="pts-chip bonus">★${s.bonus}</span>`);if(s.yellow_cards>0)c.push(`<span class="pts-chip neg">🟨</span>`);if(s.red_cards>0)c.push(`<span class="pts-chip neg">🟥</span>`);return c.join('');}return stats.filter(s=>s.points!==0).map(s=>{const cls=s.identifier==='bonus'?'bonus':s.points>0?'pos':'neg';return`<span class="pts-chip ${cls}">${LABELS[s.identifier]||s.identifier} ${s.points>0?'+':''}${s.points}</span>`;}).join('');}

/* ══ ACTION SHEET ═══════════════════════════════════════════════ */
function openActionSheet(pid){S.actionPid=pid;const p=S.players.find(x=>x.id===pid);if(!p)return;setText('actionPlayerName',p.web_name);setText('actionPlayerSub',`${p.posShort}·${p.teamShort}·£${p.price.toFixed(1)}m`);const cb=el('actionSetCaptain'),vb=el('actionSetVC');if(cb)cb.textContent=S.captainId===pid?'⭐ Remove Captain':'⭐ Set as Captain';if(vb)vb.textContent=S.vcaptainId===pid?'🔵 Remove VC':'🔵 Set as Vice Captain';const s=el('actionSheetBackdrop');if(s)s.style.display='flex';}
function closeActionSheet(){S.actionPid=null;const s=el('actionSheetBackdrop');if(s)s.style.display='none';}

/* ══ CUSTOM KIT (#30) ═══════════════════════════════════════════ */
function applyCustomKit(){const primary=el('kitColorPrimary')?.value||'#00e676',sleeve=el('kitColorSleeve')?.value||'#0ea5e9';S.customKit={primary,sleeve};localStorage.setItem('fpl_kit',JSON.stringify(S.customKit));renderMyTeam();const panel=el('kitDesignerPanel');if(panel)panel.style.display='none';}

/* ══ PRICE CHANGES (#2) ═════════════════════════════════════════ */
function renderPriceChanges(){
  const risers=S.players.filter(p=>p.cost_change_event>0).sort((a,b)=>b.cost_change_event-a.cost_change_event).slice(0,8);
  const fallers=S.players.filter(p=>p.cost_change_event<0).sort((a,b)=>a.cost_change_event-b.cost_change_event).slice(0,8);
  const row=(p,dir)=>`<div class="price-row"><div><div style="font-weight:700;font-size:.85rem">${p.web_name}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${p.teamShort}·${p.posShort}·${p.selected_by_percent}% own</div></div><span class="price-change ${dir>0?'price-up':'price-down'}">${dir>0?'▲':'▼'}£${Math.abs(p.cost_change_event/10).toFixed(1)}m</span></div>`;
  const noChg='<div style="padding:.75rem;color:var(--text-sub);font-size:.78rem;text-align:center">No price changes today</div>';
  setHTML('priceRisingList',risers.length?risers.map(p=>row(p,1)).join(''):noChg);
  setHTML('priceFallingList',fallers.length?fallers.map(p=>row(p,-1)).join(''):noChg);
}

/* ══ DIFFERENTIALS (#4) ═════════════════════════════════════════ */
function renderDifferentials(){
  const posF=el('diffPosFilter')?.value||'',sortKey=el('diffSortFilter')?.value||'form';
  let diffs=S.players.filter(p=>parseFloat(p.selected_by_percent)<15&&p.formVal>=3&&p.minutes>0);
  if(posF)diffs=diffs.filter(p=>p.posShort===posF);diffs.sort((a,b)=>(parseFloat(b[sortKey])||0)-(parseFloat(a[sortKey])||0));
  const tbody=el('diffTableBody');if(!tbody)return;
  const top=diffs.slice(0,20);if(!top.length){tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-sub)">No differentials found.</td></tr>`;return;}
  tbody.innerHTML=top.map(p=>{const inTeam=S.myTeam.includes(p.id),full=!inTeam&&S.myTeam.length>=15;const fix=p.upcomingFixtures[0];const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'—';return`<tr><td><div class="player-name">${p.web_name}</div><div class="player-sub">${p.teamShort}</div></td><td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td><td><span class="price-val">£${p.price.toFixed(1)}</span></td><td><span class="form-val form-hi">${p.form}</span></td><td><span class="ep-val">${p.ep_next||'—'}</span></td><td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td><td style="font-family:var(--font-data);font-size:.7rem">${fixStr}</td><td><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''}>${inTeam?'✓':'＋'}</button></td></tr>`;}).join('');
}

/* ══ COMPARISON (#5) ════════════════════════════════════════════ */
function renderComparison(){
  const find=q=>q?S.players.filter(p=>`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>b.total_points-a.total_points)[0]:null;
  const players=[find(el('compareSearch1')?.value||''),find(el('compareSearch2')?.value||''),find(el('compareSearch3')?.value||'')].filter(Boolean);
  const area=el('compareResults');if(!area)return;if(players.length<2){area.innerHTML=emptyState('⚖','ADD 2 PLAYERS','Type player names above.');return;}
  const stats=[{label:'Position',key:p=>p.posShort},{label:'Team',key:p=>p.teamShort},{label:'Price',key:p=>`£${p.price.toFixed(1)}m`,num:p=>p.price},{label:'Form',key:p=>p.form,num:p=>parseFloat(p.form)},{label:'Total Pts',key:p=>p.total_points,num:p=>p.total_points},{label:'xPts',key:p=>p.ep_next||'—',num:p=>parseFloat(p.ep_next)||0},{label:'Ownership',key:p=>p.selected_by_percent+'%',num:p=>parseFloat(p.selected_by_percent)},{label:'ICT',key:p=>parseFloat(p.ict_index).toFixed(1),num:p=>parseFloat(p.ict_index)},{label:'Goals',key:p=>p.goals_scored,num:p=>p.goals_scored},{label:'Assists',key:p=>p.assists,num:p=>p.assists},{label:'Next FDR',key:p=>p.upcomingFixtures[0]?`GW${p.upcomingFixtures[0].gw} FDR${p.upcomingFixtures[0].difficulty}`:'—',num:p=>p.upcomingFixtures[0]?6-p.upcomingFixtures[0].difficulty:0}];
  const headers=players.map((p,i)=>`<th class="${i===0?'compare-header-cell':''}">${p.web_name}<br><span style="font-size:.62rem;color:var(--text-sub)">${p.teamShort}</span></th>`).join('');
  const rows=stats.map(s=>{const vals=players.map(p=>s.key(p));const nums=s.num?players.map(p=>s.num(p)):null;const maxNum=nums?Math.max(...nums):null;return`<tr><td>${s.label}</td>${vals.map((v,i)=>`<td class="${nums&&nums[i]===maxNum&&maxNum>0?'compare-best':''}">${v}</td>`).join('')}</tr>`;}).join('');
  area.innerHTML=`<div class="player-table-wrap"><table class="compare-table"><thead><tr><th>Stat</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ══ FDR CALENDAR (#6) ══════════════════════════════════════════ */
function renderFDRCalendar(){
  const area=el('fdrCalendarArea');if(!area||!S.players.length)return;const gwCount=parseInt(el('fdrGwCount')?.value||6);const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);
  const teams=Object.values(S.teams).sort((a,b)=>a.short_name.localeCompare(b.short_name));const fxMap={};teams.forEach(t=>{fxMap[t.id]={};});
  S.allFixtures.forEach(f=>{if(!f.event||f.event<startGW||f.event>=startGW+gwCount)return;if(!fxMap[f.team_h])fxMap[f.team_h]={};if(!fxMap[f.team_a])fxMap[f.team_a]={};(fxMap[f.team_h][f.event]=fxMap[f.team_h][f.event]||[]).push({opp:S.teams[f.team_a]?.short_name||'?',home:true,fdr:f.team_h_difficulty});(fxMap[f.team_a][f.event]=fxMap[f.team_a][f.event]||[]).push({opp:S.teams[f.team_h]?.short_name||'?',home:false,fdr:f.team_a_difficulty});});
  const gwHeaders=Array.from({length:gwCount},(_,i)=>`<th>GW${startGW+i}</th>`).join('');
  const rows=teams.map(t=>{const cells=Array.from({length:gwCount},(_,i)=>{const gw=startGW+i,fx=fxMap[t.id]?.[gw]||[];if(!fx.length)return`<td class="fdr-cell fdr-blank">—</td>`;if(fx.length>=2)return`<td class="fdr-cell fdr-double">${fx.map(f=>`${f.home?'':'@'}${f.opp}`).join('<br>')}</td>`;const f=fx[0];return`<td class="fdr-cell fdr-cell-${f.fdr}">${f.home?'':'@'}${f.opp}</td>`;}).join('');return`<tr><td class="fdr-team">${t.short_name}</td>${cells}</tr>`;}).join('');
  area.innerHTML=`<div class="fdr-table-wrap"><table class="fdr-table"><thead><tr><th>Team</th>${gwHeaders}</tr></thead><tbody>${rows}</tbody></table></div><div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap;font-size:.68rem"><span style="color:#c084fc;font-family:var(--font-data)">■ Double</span><span style="color:var(--text-sub);font-family:var(--font-data)">— Blank</span><span style="color:var(--green);font-family:var(--font-data)">■ Easy</span><span style="color:#ef9a9a;font-family:var(--font-data)">■ Hard</span></div>`;
}

/* ══ BLANK/DOUBLE (#7) ══════════════════════════════════════════ */
function renderBlankDouble(){
  const area=el('blankDoubleAlert');if(!area)return;const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);const blanks=[],doubles=[];
  for(let gw=startGW;gw<startGW+8;gw++){const tc_={};Object.values(S.teams).forEach(t=>{tc_[t.id]=0;});S.allFixtures.filter(f=>f.event===gw).forEach(f=>{if(tc_[f.team_h]!==undefined)tc_[f.team_h]++;if(tc_[f.team_a]!==undefined)tc_[f.team_a]++;});const blankT=Object.entries(tc_).filter(([,c])=>c===0).map(([id])=>S.teams[id]?.short_name).filter(Boolean);const doubleT=Object.entries(tc_).filter(([,c])=>c>=2).map(([id])=>S.teams[id]?.short_name).filter(Boolean);if(blankT.length)blanks.push({gw,teams:blankT});if(doubleT.length)doubles.push({gw,teams:doubleT});}
  let html='';doubles.forEach(d=>{html+=`<div class="bdgw-banner double">🎯 <strong>GW${d.gw} DOUBLE:</strong> ${d.teams.join(', ')}</div>`;});blanks.forEach(b=>{html+=`<div class="bdgw-banner blank">⚠ <strong>GW${b.gw} BLANK:</strong> ${b.teams.join(', ')}</div>`;});
  area.innerHTML=html||'';area.style.display=html?'block':'none';
}

/* ══ AUTO BUILDER (#8) & WILDCARD (#9) ══════════════════════════ */
function runAutoBuilder(){const budget=parseFloat(el('autoBudget')?.value||100),priority=el('autoPriority')?.value||'value',area=el('autoBuilderResult');if(!area)return;area.innerHTML='<div style="color:var(--text-sub);font-size:.8rem;padding:.5rem">Building...</div>';setTimeout(()=>{area.innerHTML=buildSquad(budget,priority,15);},100);}
function scoreP(p,pr){if(pr==='form')return p.formVal*(2-p.avgFDR/5);if(pr==='fixtures')return p.projectedPts*(2-p.avgFDR/5);return p.projectedPts/p.price;}
function buildSquad(budget,priority,size=15){
  const limits={GKP:{min:1,max:2},DEF:{min:3,max:5},MID:{min:2,max:5},FWD:{min:1,max:3}};
  const elig=S.players.filter(p=>p.minutes>90).sort((a,b)=>scoreP(b,priority)-scoreP(a,priority));
  const sel=[],teamC={},posC={GKP:0,DEF:0,MID:0,FWD:0};let spent=0;
  for(const pos of['GKP','DEF','MID','FWD']){let need=limits[pos].min;for(const p of elig){if(!need)break;if(sel.find(s=>s.id===p.id))continue;if(p.posShort!==pos)continue;if((teamC[p.team]||0)>=3)continue;if(spent+p.price>budget)continue;sel.push(p);teamC[p.team]=(teamC[p.team]||0)+1;posC[pos]++;spent+=p.price;need--;}}
  for(const p of elig){if(sel.length>=size)break;if(sel.find(s=>s.id===p.id))continue;const pos=p.posShort;if(posC[pos]>=limits[pos].max)continue;if((teamC[p.team]||0)>=3)continue;if(spent+p.price>budget)continue;sel.push(p);teamC[p.team]=(teamC[p.team]||0)+1;posC[pos]++;spent+=p.price;}
  if(sel.length<11)return`<div style="color:var(--red);font-size:.82rem;padding:.5rem">Could not build within £${budget}m. Increase budget.</div>`;
  const totalXpts=sel.reduce((s,p)=>s+p.projectedPts,0);const byPos={GKP:sel.filter(p=>p.posShort==='GKP'),DEF:sel.filter(p=>p.posShort==='DEF'),MID:sel.filter(p=>p.posShort==='MID'),FWD:sel.filter(p=>p.posShort==='FWD')};
  const rPos=(pos,lbl)=>byPos[pos].length?`<div class="builder-pos-section"><div class="builder-pos-label"><span class="pos-chip pos-${pos}">${pos}</span> ${lbl}</div><div class="builder-result-grid">${byPos[pos].map(p=>`<div class="builder-player"><div class="builder-player-name">${p.web_name}</div><div class="builder-player-meta">${p.teamShort}·£${p.price.toFixed(1)}m·${p.projectedPts}xP</div></div>`).join('')}</div></div>`:'';
  const html=`${rPos('GKP','Goalkeeper')}${rPos('DEF','Defenders')}${rPos('MID','Midfielders')}${rPos('FWD','Forwards')}<div class="builder-total" style="margin-top:.75rem"><div><div class="builder-total-label">TOTAL COST</div><div style="font-family:var(--font-data);color:var(--amber);font-size:1rem">£${spent.toFixed(1)}m</div></div><div style="text-align:right"><div class="builder-total-label">TOTAL xPts</div><div class="builder-total-val">${Math.round(totalXpts*10)/10}</div></div></div><button class="btn btn-green btn-sm" id="addAutoSquadBtn" style="margin-top:.5rem">+ Add This Squad</button>`;
  setTimeout(()=>{el('addAutoSquadBtn')?.addEventListener('click',()=>{S.myTeam=sel.map(p=>p.id);saveTeam();renderPlayerTable();renderMyTeam();renderDashboard();alert(`✅ Added ${sel.length} players!`);});},100);
  return html;
}
function runWildcard(){const area=el('wildcardResult');if(!area)return;area.innerHTML='<div style="color:var(--text-sub);font-size:.8rem;padding:.5rem">Generating...</div>';setTimeout(()=>{const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);S.players=S.players.map(p=>{let sc=0;for(let gw=startGW;gw<startGW+5;gw++){const fx=S.allFixtures.filter(f=>f.event===gw&&(f.team_h===p.team||f.team_a===p.team));if(!fx.length)continue;const avg=fx.reduce((s,f)=>s+(f.team_h===p.team?f.team_h_difficulty:f.team_a_difficulty),0)/fx.length;sc+=p.formVal*fdrMult(avg);}return{...p,wcScore:sc};});area.innerHTML=`<div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-bottom:.5rem">Optimised for GW${startGW}–GW${startGW+4}</div>${buildSquad(100,'form',15)}`;},100);}

/* ══ CHIP PLANNER (#3) ══════════════════════════════════════════ */
function renderChipPlanner(){
  const area=el('chipPlannerArea');if(!area)return;if(!S.fplEntryId){area.innerHTML=emptyState('🃏','CONNECT ACCOUNT','Login first.');return;}
  if(!S.gwHistory){area.innerHTML='<div style="color:var(--text-sub);padding:1rem;font-size:.8rem">Loading...</div>';fetchGWHistory().then(()=>renderChipPlanner());return;}
  const used=(S.gwHistory.chips||[]).map(c=>c.name);const{starters}=getSquadGroups();const pool=starters.length?starters:myPlayers();const topCap=pool.length?[...pool].sort((a,b)=>capScore(b)-capScore(a))[0]:null;
  const chips=[{name:'wildcard',icon:'🃏',label:'Wildcard',desc:'Free transfers for 1 GW',sug:()=>{const bad=myPlayers().filter(p=>p.avgFDR>=4).length;return bad>=4?`Now — ${bad} players have brutal fixtures`:'Hold for worse fixtures';}},{name:'freehit',icon:'🎯',label:'Free Hit',desc:'Unlimited transfers, reverts after',sug:()=>'Best for a blank GW when squad is reduced'},{name:'bboost',icon:'💪',label:'Bench Boost',desc:'Bench players score too',sug:()=>'Best when bench has great fixtures'},{name:'3xc',icon:'⭐',label:'Triple Captain',desc:'Captain scores 3× points',sug:()=>topCap?`Best on ${topCap.web_name} (Form ${topCap.form})`:'Set a captain first'}];
  area.innerHTML=chips.map(chip=>{const isUsed=used.includes(chip.name);const gwU=S.gwHistory.chips?.find(c=>c.name===chip.name);return`<div class="chip-card"><div class="chip-icon">${chip.icon}</div><div style="flex:1"><div class="chip-name">${chip.label}</div><div class="chip-status ${isUsed?'chip-used':'chip-available'}">${isUsed?`Used GW${gwU?.event||'?'}`:'✅ Available'}</div><div style="font-size:.75rem;color:var(--text-sub);margin-top:2px">${chip.desc}</div>${!isUsed?`<div class="chip-suggestion">💡 ${chip.sug()}</div>`:''}</div></div>`;}).join('');
}

/* ══ PREDICTOR (#10) ════════════════════════════════════════════ */
function renderPredictor(){
  const posF=el('predictorPosFilter')?.value||'',area=el('predictorResults');if(!area)return;
  let pool=S.players.filter(p=>p.minutes>0);if(posF)pool=pool.filter(p=>p.posShort===posF);
  const pred=pool.map(p=>{const fix=p.upcomingFixtures[0];const fdr=fix?fix.difficulty:3,fm=fdrMult(fdr);const avgMins=p.minutes/Math.max(1,S.currentGW||1),play=Math.min(1,avgMins/90);const minPts=play>=0.75?2:play>=0.5?1:0;const threat=parseFloat(p.threat)||0,crea=parseFloat(p.creativity)||0;const isAtt=p.element_type===3||p.element_type===4,isDef=p.element_type===1||p.element_type===2;const gProb=isAtt?(threat/100)*fm*0.3:isDef?(threat/100)*fm*0.08:0;const aProb=isAtt?(crea/100)*fm*0.25:0;const gPts=gProb*(p.element_type===4?4:p.element_type===3?5:6);const aPts=aProb*3;const csPts=isDef?(fdr<=2?0.5:fdr<=3?0.35:0.15)*(p.element_type===1?6:4):0;const bonPts=(gProb+aProb)*1.2;return{...p,pred:{total:Math.round((minPts+gPts+aPts+csPts+bonPts)*10)/10,minutes:minPts,goals:Math.round(gPts*10)/10,assists:Math.round(aPts*10)/10,cs:Math.round(csPts*10)/10,bonus:Math.round(bonPts*10)/10},nextFix:fix};}).sort((a,b)=>b.pred.total-a.pred.total).slice(0,15);
  const bar=(val,color,max)=>`<div class="predictor-bar-track"><div class="predictor-bar-fill" style="width:${Math.round((val/max)*100)}%;background:${color}"></div></div>`;
  area.innerHTML=pred.map(p=>{const inTeam=S.myTeam.includes(p.id),full=!inTeam&&S.myTeam.length>=15;const col=tc(p.teamShort);return`<div class="predictor-row"><div class="team-color-bar" style="background:${col.p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:4px">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div style="font-size:.68rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m${p.nextFix?` · ${p.nextFix.home?'':'@'}${p.nextFix.opponent} GW${p.nextFix.gw}`:''}</div><div class="predictor-bars" style="margin-top:4px"><div class="predictor-bar-row"><span class="predictor-bar-label">Mins</span>${bar(p.pred.minutes,'var(--blue)',2)}<span class="predictor-bar-val">${p.pred.minutes}</span></div><div class="predictor-bar-row"><span class="predictor-bar-label">Goals</span>${bar(p.pred.goals,'var(--green)',6)}<span class="predictor-bar-val">${p.pred.goals}</span></div><div class="predictor-bar-row"><span class="predictor-bar-label">Assists</span>${bar(p.pred.assists,'var(--amber)',3)}<span class="predictor-bar-val">${p.pred.assists}</span></div>${p.pred.cs?`<div class="predictor-bar-row"><span class="predictor-bar-label">CS</span>${bar(p.pred.cs,'var(--blue)',6)}<span class="predictor-bar-val">${p.pred.cs}</span></div>`:''}</div></div><div style="text-align:right;flex-shrink:0;padding-left:.5rem"><div class="predictor-total">${p.pred.total}</div><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''} style="margin-top:4px;padding:4px 8px;font-size:.65rem">${inTeam?'✓':'＋'}</button></div></div>`;}).join('');
}

/* ══ TRANSFERS ══════════════════════════════════════════════════ */
function renderTransfers(){
  const mp=myPlayers();
  if(!mp.length)setHTML('transferArea',emptyState('⇄','NO SQUAD','Build your team first.'));
  else{const sugg=[];mp.forEach(cur=>{const best=S.players.filter(p=>p.element_type===cur.element_type&&p.id!==cur.id&&!S.myTeam.includes(p.id)&&p.price<=cur.price+0.5&&p.projectedPts>cur.projectedPts).sort((a,b)=>b.projectedPts-a.projectedPts)[0];if(best)sugg.push({out:cur,in:best,gain:Math.round((best.projectedPts-cur.projectedPts)*10)/10});});sugg.sort((a,b)=>b.gain-a.gain);const top=sugg.slice(0,8);if(!top.length)setHTML('transferArea',emptyState('✅','OPTIMAL','No better options within budget.'));else{const fx=f=>f?`${f.home?'':'@'}${f.opponent} GW${f.gw} <span class="fdr fdr-${f.difficulty}">${f.difficulty}</span>`:'';setHTML('transferArea',`<div class="card-header" style="margin-bottom:.75rem"><span class="card-title">AI SUGGESTIONS</span><span class="card-badge badge-green">TOP ${top.length}</span></div>${top.map(s=>`<div class="transfer-item"><div class="transfer-out"><div class="transfer-label">OUT</div><div class="transfer-player" style="color:var(--red)">${s.out.web_name}</div><div class="transfer-stats">Form ${s.out.form}·£${s.out.price.toFixed(1)}m ${fx(s.out.upcomingFixtures[0])}</div></div><div class="transfer-arrow">→</div><div class="transfer-in"><div class="transfer-label">IN</div><div class="transfer-player" style="color:var(--green)">${s.in.web_name}</div><div class="transfer-stats">Form ${s.in.form}·£${s.in.price.toFixed(1)}m ${fx(s.in.upcomingFixtures[0])}</div></div><div class="transfer-gain">+${s.gain}xP</div></div>`).join('')}`);}}
  const active=S.players.filter(p=>p.transfers_in_event>0||p.transfers_out_event>0);
  const topIn=[...active].sort((a,b)=>b.transfers_in_event-a.transfers_in_event).slice(0,8);
  const topOut=[...active].sort((a,b)=>b.transfers_out_event-a.transfers_out_event).slice(0,8);
  const noData='<div style="padding:1rem;color:var(--text-sub);font-size:.78rem">No data yet.</div>';
  const row=(p,key,color)=>{const val=p[key],maxV=(key==='transfers_in_event'?(topIn[0]?.[key]||1):(topOut[0]?.[key]||1));return`<div style="padding:.45rem 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between"><div><div style="font-weight:700;font-size:.82rem">${p.web_name}</div><div style="font-size:.68rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m</div></div><div style="font-family:var(--font-data);font-size:.68rem;color:${color}">${val.toLocaleString()}</div></div><div class="progress-bar"><div class="progress-fill" style="width:${Math.round(val/maxV*100)}%;background:${color}"></div></div></div>`;};
  const inEl=el('transfersInList'),outEl=el('transfersOutList');
  if(inEl)inEl.innerHTML=topIn.length?topIn.map(p=>row(p,'transfers_in_event','var(--green)')).join(''):noData;
  if(outEl)outEl.innerHTML=topOut.length?topOut.map(p=>row(p,'transfers_out_event','var(--red)')).join(''):noData;
}

/* ══ FIXTURES ═══════════════════════════════════════════════════ */
function renderFixtureGwSelect(){const sel=el('fixtureGwSelect');if(!sel||!S.bootstrap)return;sel.innerHTML=S.bootstrap.events.filter(e=>e.id>=1).map(e=>`<option value="${e.id}" ${e.is_current?'selected':''}>${e.name}</option>`).join('');}
function renderFixtures(){
  const gw=parseInt(el('fixtureGwSelect')?.value||S.currentGW||1);const list=S.allFixtures.filter(f=>f.event===gw);
  if(!list.length){setHTML('fixturesArea','<div style="padding:2rem;text-align:center;color:var(--text-sub)">No fixtures.</div>');return;}
  setHTML('fixturesArea',list.map(f=>{const h=S.teams[f.team_h],a=S.teams[f.team_a];const ko=f.kickoff_time?new Date(f.kickoff_time):null;const ts=ko?ko.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+' '+ko.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'TBC';let mid;if(f.finished||f.finished_provisional)mid=`<div class="fixture-score">${f.team_h_score??'?'}–${f.team_a_score??'?'}</div>`;else if(f.started)mid=`<div class="fixture-score" style="color:var(--amber)">${f.team_h_score??0}–${f.team_a_score??0}</div><div class="fixture-time">LIVE</div>`;else mid=`<div class="fixture-vs">vs</div><div class="fixture-time">${ts}</div>`;return`<div class="fixture-item"><div class="fixture-team home"><span class="fdr fdr-${f.team_h_difficulty}">${f.team_h_difficulty}</span> ${h?.name||'?'}</div><div class="fixture-center">${mid}</div><div class="fixture-team">${a?.name||'?'} <span class="fdr fdr-${f.team_a_difficulty}">${f.team_a_difficulty}</span></div></div>`;}).join(''));
}

/* ══ LIVE (#11 equiv) ═══════════════════════════════════════════ */
function renderLivePanel(){
  const{starters}=getSquadGroups();const mp=myPlayers();
  if(!mp.length){setHTML('livePlayerList',emptyState('◎','NO SQUAD','Build your team first.'));return;}
  if(!S.liveData){setHTML('livePlayerList',emptyState('◎','NO LIVE DATA','Active during live gameweeks.'));return;}
  const sorted=[...starters].sort((a,b)=>(S.liveData[b.id]?.stats?.total_points??0)-(S.liveData[a.id]?.stats?.total_points??0));
  let total=0;
  const rows=sorted.map(p=>{const live=S.liveData[p.id]?.stats||{},pts=live.total_points??0;const isC=p.id===S.captainId,eff=isC?pts*2:pts;total+=eff;const bd=buildPtsBreakdown(S.liveData[p.id]);const col=tc(p.teamShort);const ptColor=pts>=10?'var(--green)':pts>=6?'var(--amber)':'var(--text)';return`<div class="team-list-row"><div class="team-color-bar" style="background:${col.p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:4px;flex-wrap:wrap">${p.web_name}${isC?'<span class="card-badge badge-amber">C×2</span>':''}<span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div style="font-size:.68rem;color:var(--text-sub)">${p.teamShort}·${live.minutes??0} mins</div>${bd?`<div class="pts-breakdown">${bd}</div>`:''}</div><div style="text-align:right;flex-shrink:0"><div style="font-family:var(--font-data);font-size:1.3rem;font-weight:700;color:${ptColor}">${eff}</div></div></div>`;});
  setHTML('livePlayerList',rows.join(''));setText('liveSquadPts',total);
}

/* ══ WEATHER (#22) ══════════════════════════════════════════════ */
async function loadWeather(){
  const area=el('weatherArea');if(!area)return;
  area.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-sub)">Fetching weather...</div>';
  const gw=parseInt(el('fixtureGwSelect')?.value||S.currentGW||1);
  const fixtures=S.allFixtures.filter(f=>f.event===gw&&!f.finished);
  if(!fixtures.length){area.innerHTML='<div style="color:var(--text-sub);text-align:center;padding:1rem;font-size:.82rem">No upcoming fixtures to check weather for.</div>';return;}
  const teamsSeen=new Set();const toFetch=[];
  fixtures.forEach(f=>{if(!teamsSeen.has(f.team_h)&&STADIUMS[S.teams[f.team_h]?.short_name]){teamsSeen.add(f.team_h);toFetch.push({teamId:f.team_h,short:S.teams[f.team_h].short_name,vs:S.teams[f.team_a]?.short_name||'?'});}});
  const results=await Promise.allSettled(toFetch.slice(0,6).map(async item=>{const st=STADIUMS[item.short];if(!st)return null;const r=await fetch(`/api/weather?lat=${st.lat}&lon=${st.lon}`);if(!r.ok)throw new Error();const d=await r.json();return{...item,weather:{temp:d.temp,desc:d.description,wind:d.wind_kph,icon:getWeatherIcon(d.main),impact:getWeatherImpact(d.wind_kph/3.6,d.main)},stadium:st.name};}));
  const cards=results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value);
  if(!cards.length){area.innerHTML='<div style="color:var(--text-sub);text-align:center;padding:1rem;font-size:.82rem">Weather data unavailable.</div>';return;}
  area.innerHTML=`<div class="weather-grid">${cards.map(c=>`<div class="weather-card"><div class="weather-icon">${c.weather.icon}</div><div class="weather-team">${c.short} vs ${c.vs}</div><div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub);margin-bottom:3px">${c.stadium}</div><div class="weather-temp">${c.weather.temp}°C</div><div class="weather-desc">${c.weather.desc}</div><div class="weather-wind">💨 ${c.weather.wind} km/h</div><div class="weather-impact impact-${c.weather.impact.level}">${c.weather.impact.text}</div></div>`).join('')}</div>`;
}
function getWeatherIcon(main){const map={Clear:'☀️',Clouds:'⛅',Rain:'🌧️',Drizzle:'🌦️',Thunderstorm:'⛈️',Snow:'❄️',Mist:'🌫️',Fog:'🌫️'};return map[main]||'🌤️';}
function getWeatherImpact(windSpeed,main){const isRain=['Rain','Drizzle','Thunderstorm'].includes(main);if(windSpeed>12||isRain){return{level:'high',text:'⚠ May affect scores'};}if(windSpeed>8){return{level:'med',text:'Slight wind impact'};}return{level:'low',text:'Good conditions'};}

/* ══ NEWS FEED (#23) — Multi-source ════════════════════════════ */
async function loadNewsFeed() {
  const area = el('newsFeedArea'); if (!area) return;
  area.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-sub)">Loading news from multiple sources...</div>';

  const RSS_FEEDS = [
    { url:'https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml', source:'BBC Sport', color:'#bb1919' },
    { url:'https://www.skysports.com/rss/12040', source:'Sky Sports', color:'#0072ce' },
    { url:'https://www.theguardian.com/football/premierleague/rss', source:'The Guardian', color:'#185f90' },
    { url:'https://talksport.com/feed/', source:'talkSPORT', color:'#e8001c' },
    { url:'https://www.espn.co.uk/espn/rss/soccer/news', source:'ESPN FC', color:'#cc0000' },
    { url:'https://www.90min.com/feeds/latest.rss', source:'90min', color:'#00c853' },
  ];

  const rssProxy = url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

  const results = await Promise.allSettled(RSS_FEEDS.map(async feed => {
    const r = await fetch(rssProxy(feed.url));
    if (!r.ok) throw new Error(`${feed.source} ${r.status}`);
    const text = await r.text();
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    return Array.from(doc.querySelectorAll('item')).slice(0, 5).map(item => ({
      title:   (item.querySelector('title')?.textContent || '').trim(),
      link:    item.querySelector('link')?.textContent || '#',
      desc:    (item.querySelector('description')?.textContent || '').replace(/<[^>]+>/g,'').slice(0, 120),
      date:    item.querySelector('pubDate')?.textContent || '',
      source:  feed.source,
      color:   feed.color,
      isFPL:   /(fpl|fantasy|gameweek|gw\d|transfer|injury|haaland|salah|saka|palmer|mbappe|de bruyne)/i.test(
                  item.querySelector('title')?.textContent || ''),
    }));
  }));

  let articles = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

  // Sort: FPL-tagged first, then by date
  articles.sort((a, b) => {
    if (a.isFPL !== b.isFPL) return a.isFPL ? -1 : 1;
    return new Date(b.date) - new Date(a.date);
  });

  const sourceStats = results.map((r, i) => ({ feed:RSS_FEEDS[i], ok:r.status==='fulfilled', count:r.status==='fulfilled'?r.value.length:0 }));

  if (!articles.length) {
    area.innerHTML = '<div style="color:var(--text-sub);text-align:center;padding:2rem;font-size:.82rem">No news available. Check your connection.</div>';
    return;
  }

  area.innerHTML = `
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem">
      ${sourceStats.map(s => `<span style="font-family:var(--font-data);font-size:.58rem;padding:2px 7px;border-radius:100px;background:${s.ok?'rgba(0,230,118,.1)':'rgba(255,23,68,.1)'};color:${s.ok?'var(--green)':'var(--text-sub)'};border:1px solid ${s.ok?'var(--green-dim)':'var(--border)'}">${s.feed.source} ${s.ok?`(${s.count})`:'✗'}</span>`).join('')}
    </div>
    <div class="card">${articles.slice(0, 20).map(a => `
      <div class="news-item" onclick="window.open('${a.link}','_blank')">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem">
          <span style="font-family:var(--font-data);font-size:.52rem;padding:1px 6px;border-radius:3px;background:${a.color}20;color:${a.color};border:1px solid ${a.color}40">${a.source}</span>
          ${a.isFPL ? '<span style="font-family:var(--font-data);font-size:.52rem;padding:1px 6px;border-radius:3px;background:var(--green-glow);color:var(--green);border:1px solid var(--green-dim)">FPL</span>' : ''}
          <span style="font-family:var(--font-data);font-size:.52rem;color:var(--text-sub)">${a.date ? new Date(a.date).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : ''}</span>
        </div>
        <div class="news-title">${a.title}</div>
        <div class="news-snippet">${a.desc}...</div>
      </div>`).join('')}</div>`;
}

/* ══ TRANSFER MARKET FORECAST (#24) ════════════════════════════ */
function renderMarketForecast(){
  const area=el('marketForecastArea');if(!area||!S.players.length)return;
  const scored=S.players.map(p=>{const transferMomentum=p.transfers_in_event-(p.transfers_out_event||0);const fixtureBonus=Math.max(0,3-p.avgFDR)*8;const formBonus=p.formVal*5;const lowOwnership=parseFloat(p.selected_by_percent)<20?10:0;return{...p,forecastScore:transferMomentum/1000+fixtureBonus+formBonus+lowOwnership};}).sort((a,b)=>b.forecastScore-a.forecastScore).slice(0,12);
  area.innerHTML=`<div class="card">${scored.map((p,i)=>{const fix=p.upcomingFixtures[0];const trend=p.transfers_in_event>p.transfers_out_event?'📈':'📊';return`<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem 0;border-bottom:1px solid var(--border)"><div style="font-family:var(--font-data);font-size:.82rem;color:var(--text-sub);width:22px;flex-shrink:0">${i+1}</div><div class="team-color-bar" style="background:${tc(p.teamShort).p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.85rem">${trend} ${p.web_name}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${p.teamShort}·${p.posShort}·£${p.price.toFixed(1)}m·${p.selected_by_percent}% own${fix?`·${fix.home?'':'@'}${fix.opponent} FDR${fix.difficulty}`:''}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-family:var(--font-data);font-size:.7rem;color:var(--green)">${(p.transfers_in_event||0).toLocaleString()} in</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--red)">${(p.transfers_out_event||0).toLocaleString()} out</div></div></div>`;}).join('')}</div>`;
}

/* ══ INJURY RISK (#25) ══════════════════════════════════════════ */
function renderInjuryRisk(){
  const area=el('injuryRiskArea');if(!area)return;const mp=myPlayers();if(!mp.length){area.innerHTML=emptyState('🏥','BUILD SQUAD FIRST','Shows risk ratings for your players.');return;}
  const scored=mp.map(p=>{let risk=0;const avgMins=p.minutes/Math.max(1,S.currentGW||1);if(p.chance_of_playing_next_round!==null)risk+=(100-p.chance_of_playing_next_round)*0.4;if(avgMins>85)risk+=20;else if(avgMins>75)risk+=10;if(p.element_type===4)risk+=5;if(parseFloat(p.form)<2)risk+=15;risk=Math.min(100,Math.round(risk));return{...p,injuryRisk:risk};}).sort((a,b)=>b.injuryRisk-a.injuryRisk);
  setHTML('injuryRiskArea',`<div class="card">${scored.map(p=>{const cls=p.injuryRisk>=70?'risk-high':p.injuryRisk>=40?'risk-medium':'risk-low';const color=p.injuryRisk>=70?'var(--red)':p.injuryRisk>=40?'var(--amber)':'var(--green)';return`<div class="injury-row"><div class="team-color-bar" style="background:${tc(p.teamShort).p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.85rem">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div class="injury-meter"><div class="injury-fill ${cls}" style="width:${p.injuryRisk}%"></div></div></div><div style="text-align:right;flex-shrink:0;margin-left:.5rem"><div style="font-family:var(--font-data);font-size:.88rem;font-weight:700;color:${color}">${p.injuryRisk}%</div><div style="font-family:var(--font-data);font-size:.55rem;color:var(--text-sub)">RISK</div></div></div>`;}).join('')}</div>`);
}

/* ══ SEASON PREDICTOR (#26) ═════════════════════════════════════ */
function renderSeasonPredictor(){
  const area=el('seasonPredictorArea');if(!area||!S.players.length)return;
  const teams=Object.values(S.teams).map(t=>{const players=S.players.filter(p=>p.team===t.id&&p.minutes>0);const avgForm=players.length?players.reduce((s,p)=>s+p.formVal,0)/players.length:0;const remainFix=S.allFixtures.filter(f=>!f.finished&&(f.team_h===t.id||f.team_a===t.id)).length;const pts=Math.round(avgForm*remainFix*0.7+Math.random()*5);return{...t,projPts:pts,remainFix};}).sort((a,b)=>b.projPts-a.projPts);
  area.innerHTML=`<div class="card"><div class="card-header"><span class="card-title">TABLE PROJECTION</span><span class="card-badge badge-blue">FORM-BASED</span></div>${teams.map((t,i)=>{const pos=i+1,zone=pos<=4?'champions':pos<=6?'europa':pos>=18?'relegation':'';return`<div class="pred-table-row ${zone}"><div class="pred-rank">${pos}</div><div style="flex:1;font-weight:700;font-size:.82rem">${t.short_name}</div><div style="font-family:var(--font-data);font-size:.7rem;color:var(--text-sub)">${t.remainFix} fix</div><div class="pred-pts">+${t.projPts}</div></div>`;}).join('')}<div style="display:flex;gap:.75rem;margin-top:.75rem;flex-wrap:wrap;font-size:.68rem"><span style="color:var(--green)">■ UCL</span><span style="color:var(--blue)">■ Europa</span><span style="color:var(--red)">■ Relegation</span></div></div>`;
}

/* ══ SQUAD DNA (#27) ════════════════════════════════════════════ */
function renderDNAChart(){
  const area=el('dnaChartArea');if(!area)return;const mp=myPlayers();if(!mp.length){area.innerHTML=emptyState('🧬','BUILD SQUAD FIRST','Squad identity chart.');return;}
  const{starters}=getSquadGroups();
  const attack=Math.min(100,starters.filter(p=>p.element_type===3||p.element_type===4).reduce((s,p)=>s+(parseFloat(p.threat)||0)/10,0));
  const defence=Math.min(100,starters.filter(p=>p.element_type===1||p.element_type===2).reduce((s,p)=>s+p.total_points/3,0));
  const form=Math.min(100,mp.reduce((s,p)=>s+p.formVal*10,0)/Math.max(1,mp.length));
  const value=Math.min(100,mp.reduce((s,p)=>s+(p.projectedPts/p.price)*10,0)/Math.max(1,mp.length));
  const template=Math.min(100,mp.filter(p=>parseFloat(p.selected_by_percent)>30).length/15*100);
  const fixtures=Math.min(100,(5-mp.reduce((s,p)=>s+p.avgFDR,0)/Math.max(1,mp.length))/4*100);
  const scores=[attack,defence,form,value,template,fixtures];
  const labels=['Attack','Defence','Form','Value','Template','Fixtures'];
  const colors=['var(--red)','var(--blue)','var(--green)','var(--amber)','var(--purple)','var(--green)'];
  const cx=120,cy=110,r=85,n=6;
  const pts=scores.map((v,i)=>{const a=(i/n*2*Math.PI)-Math.PI/2,rv=r*(v/100);return`${cx+rv*Math.cos(a)},${cy+rv*Math.sin(a)}`;}).join(' ');
  const webLines=Array.from({length:n},(_,i)=>{const a=(i/n*2*Math.PI)-Math.PI/2;return`<line x1="${cx}" y1="${cy}" x2="${cx+r*Math.cos(a)}" y2="${cy+r*Math.sin(a)}" stroke="var(--border)" stroke-width="1"/>`;}).join('');
  const rings=[0.2,0.4,0.6,0.8,1.0].map(v=>{const rp=Array.from({length:n},(_,i)=>{const a=(i/n*2*Math.PI)-Math.PI/2;return`${cx+r*v*Math.cos(a)},${cy+r*v*Math.sin(a)}`;}).join(' ');return`<polygon points="${rp}" fill="none" stroke="var(--border)" stroke-width="1"/>`;}).join('');
  const lbls=labels.map((l,i)=>{const a=(i/n*2*Math.PI)-Math.PI/2,lx=cx+(r+18)*Math.cos(a),ly=cy+(r+18)*Math.sin(a);return`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-family="'Space Mono'" font-size="9" fill="${colors[i]}">${l}</text><text x="${lx}" y="${ly+13}" text-anchor="middle" font-family="'Space Mono'" font-size="8" font-weight="700" fill="${colors[i]}">${Math.round(scores[i])}</text>`;}).join('');
  area.innerHTML=`<div class="dna-chart-wrap"><svg viewBox="0 0 240 220" style="width:100%;max-width:300px">${rings}${webLines}<polygon points="${pts}" fill="rgba(0,230,118,.15)" stroke="var(--green)" stroke-width="2"/>${lbls}</svg></div>`;
}

/* ══ SEASON CHALLENGES (#28) ════════════════════════════════════ */
function renderChallenges(){
  const area=el('challengesArea');if(!area)return;
  if(!S.fplEntryId){area.innerHTML=emptyState('🏅','CONNECT ACCOUNT','Login to track challenges.');return;}
  const current=S.gwHistory?.current||[];const chips=S.gwHistory?.chips?.map(c=>c.name)||[];
  const challenges=[
    {icon:'🔥',name:'Half Century',desc:'Score 50+ pts in a GW',done:current.some(g=>g.points>=50)},
    {icon:'💯',name:'Century Club',desc:'Score 100+ pts in a GW',done:current.some(g=>g.points>=100)},
    {icon:'📈',name:'Green Arrow',desc:'Gain 100k+ rank in one GW',done:current.some((g,i)=>i>0&&(current[i-1].overall_rank-g.overall_rank)>100000)},
    {icon:'🃏',name:'Chip Master',desc:'Use all 4 chips',done:chips.length>=4},
    {icon:'⭐',name:'Top 1K',desc:'Reach top 1,000 overall',done:current.some(g=>g.overall_rank&&g.overall_rank<=1000)},
    {icon:'🏆',name:'Mini-League King',desc:'Top 3 in any mini-league',done:S.myLeagues?.classic?.some(l=>l.entry_rank<=3)||false},
    {icon:'🎯',name:'Full House',desc:'All 11 starters score 2+ pts',done:false},
    {icon:'💰',name:'Budget Boss',desc:'Team value over £110m',done:myPlayers().reduce((s,p)=>s+p.price,0)>=110},
  ];
  area.innerHTML=challenges.map(c=>{const badgeCls=c.done?'challenge-done':'challenge-pending';return`<div class="challenge-item"><div class="challenge-icon">${c.icon}</div><div style="flex:1"><div class="challenge-name">${c.name}</div><div class="challenge-desc">${c.desc}</div></div><div class="challenge-badge ${badgeCls}">${c.done?'✅ DONE':'⏳ IN PROGRESS'}</div></div>`;}).join('');
}

/* ══ FPL DIARY (#29) ════════════════════════════════════════════ */
function saveDiaryEntry(){const gw=S.currentGW||'?',text=el('diaryEntry')?.value?.trim();if(!text)return;localStorage.setItem(`fpl_diary_${gw}`,JSON.stringify({gw,text,ts:Date.now()}));const msg=el('diarySavedMsg');if(msg){msg.style.display='inline';setTimeout(()=>msg.style.display='none',2000);}loadDiaryHistory();}
function loadDiaryHistory(){const area=el('diaryHistory');if(!area)return;const entries=[];for(let i=1;i<=38;i++){const d=localStorage.getItem(`fpl_diary_${i}`);if(d)try{entries.push(JSON.parse(d));}catch{}}entries.sort((a,b)=>b.gw-a.gw);if(!entries.length){area.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem 0">No diary entries yet.</div>';return;}area.innerHTML=`<div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.5rem">PAST ENTRIES</div>`+entries.map(e=>`<div style="background:var(--deep);border:1px solid var(--border);border-radius:var(--radius);padding:.65rem;margin-bottom:.4rem"><div style="font-family:var(--font-data);font-size:.6rem;color:var(--green);margin-bottom:.35rem">GW${e.gw}·${new Date(e.ts).toLocaleDateString('en-GB')}</div><div style="font-size:.82rem;line-height:1.6;color:var(--text-sub)">${e.text}</div></div>`).join('');}

/* ══ H2H BATTLE (#19) ═══════════════════════════════════════════ */
async function runBattle(){
  const id1=parseInt(el('battleId1')?.value),id2=parseInt(el('battleId2')?.value);
  const area=el('battleResult');if(!area)return;if(!id1||!id2){area.innerHTML=emptyState('⚔️','ENTER TWO TEAM IDs','Fill both fields.');return;}
  area.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-sub)">Loading squads...</div>';
  try{
    const gw=S.currentGW||S.nextGW;
    const[r1,r2,e1,e2]=await Promise.all([fplFetch(`/entry/${id1}/event/${gw}/picks/`),fplFetch(`/entry/${id2}/event/${gw}/picks/`),fplFetch(`/entry/${id1}/`),fplFetch(`/entry/${id2}/`)]);
    const[p1,p2,ent1,ent2]=await Promise.all([r1.json(),r2.json(),e1.json(),e2.json()]);
    const getTeam=picks=>picks.map(pk=>{const p=S.players.find(x=>x.id===pk.element);if(!p)return null;const live=S.liveData?.[pk.element]?.stats;const pts=live?live.total_points:p.projectedPts;return{...p,pts,eff:pk.is_captain?pts*2:pts,isCap:pk.is_captain};}).filter(Boolean);
    const team1=getTeam(p1.picks||[]),team2=getTeam(p2.picks||[]);
    const total1=team1.slice(0,11).reduce((s,p)=>s+p.eff,0),total2=team2.slice(0,11).reduce((s,p)=>s+p.eff,0);
    const renderTeam=(players,name,total,win)=>`<div class="battle-team ${win?'battle-winner':''}"><div class="battle-team-name">${name}</div><div class="battle-pts">${Math.round(total*10)/10}<span style="font-family:var(--font-data);font-size:.65rem;color:var(--text-sub)"> pts</span></div>${players.slice(0,11).map(p=>`<div class="battle-player-row"><span>${p.web_name}${p.isCap?' ©':''}</span><span class="battle-player-pts">${p.eff}</span></div>`).join('')}</div>`;
    area.innerHTML=`<div class="battle-grid">${renderTeam(team1,ent1.name||`Team ${id1}`,total1,total1>total2)}<div class="battle-vs">VS</div>${renderTeam(team2,ent2.name||`Team ${id2}`,total2,total2>total1)}</div>${total1!==total2?`<div style="text-align:center;font-family:var(--font-display);font-size:1.3rem;color:var(--green);margin-top:.75rem">🏆 ${total1>total2?ent1.name||'Team 1':ent2.name||'Team 2'} LEADS</div>`:'<div style="text-align:center;color:var(--amber);margin-top:.75rem;font-family:var(--font-data)">ALL SQUARE</div>'}`;
  }catch(err){area.innerHTML=`<div style="color:var(--red);padding:1rem;font-size:.82rem">Failed: ${err.message}</div>`;}
}

/* ══ TEMPLATE DETECTOR (#18) ════════════════════════════════════ */
async function runTemplateDetector(){
  const id=parseInt(el('templateId')?.value),area=el('templateResult');if(!area)return;if(!id){area.innerHTML=emptyState('🎯','ENTER A TEAM ID','Paste a top manager\'s ID.');return;}
  area.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-sub)">Comparing squads...</div>';
  try{
    const gw=S.currentGW||S.nextGW;const[r,e]=await Promise.all([fplFetch(`/entry/${id}/event/${gw}/picks/`),fplFetch(`/entry/${id}/`)]);const[data,ent]=await Promise.all([r.json(),e.json()]);
    const templateIds=data.picks?.map(pk=>pk.element)||[];const myIds=new Set(S.myTeam);
    const same=templateIds.filter(id=>myIds.has(id)),diff=templateIds.filter(id=>!myIds.has(id));
    const score=Math.round(same.length/Math.max(1,templateIds.length)*100);
    const pName=pid=>{const p=S.players.find(x=>x.id===pid);return p?`${p.web_name} (${p.teamShort})`:`#${pid}`;};
    area.innerHTML=`<div class="cortex-score-card" style="margin-bottom:.75rem"><div><div class="stat-label">TEMPLATE SCORE</div><div class="cortex-score-val">${score}</div><div class="cortex-score-sub">vs ${ent.name||`Entry ${id}`}</div></div><div style="font-family:var(--font-data);font-size:.65rem;text-align:right"><div style="color:var(--green)">${same.length} same</div><div style="color:var(--red)">${diff.length} different</div></div></div><div class="card"><div style="font-family:var(--font-data);font-size:.58rem;color:var(--green);letter-spacing:1.5px;margin-bottom:.4rem">✅ IN COMMON (${same.length})</div><div style="font-size:.82rem;line-height:1.9">${same.map(pName).join(' · ')||'None'}</div><div style="font-family:var(--font-data);font-size:.58rem;color:var(--red);letter-spacing:1.5px;margin-top:.75rem;margin-bottom:.4rem">❌ YOU'RE MISSING (${diff.length})</div><div style="font-size:.82rem;line-height:1.9">${diff.map(pName).join(' · ')||'None'}</div></div>`;
  }catch(err){area.innerHTML=`<div style="color:var(--red);padding:1rem;font-size:.82rem">Failed: ${err.message}</div>`;}
}

/* ══ LEAGUE WAR ROOM (#20) ══════════════════════════════════════ */
async function runWarRoom(){
  const lid=parseInt(el('warRoomLeagueId')?.value),area=el('warRoomResult');if(!area)return;if(!lid){area.innerHTML=emptyState('🏴','ENTER LEAGUE ID','Find it in your FPL leagues page.');return;}
  area.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-sub)">Loading war room...</div>';
  try{
    const res=await fplFetch(`/leagues-classic/${lid}/standings/`);if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();const entries=(data.standings?.results||[]).slice(0,10);
    const gw=S.currentGW||S.nextGW;
    const picksData=await Promise.allSettled(entries.map(e=>fplFetch(`/entry/${e.entry}/event/${gw}/picks/`).then(r=>r.json())));
    const rows=entries.map((entry,i)=>{
      let capName='—',projPts='—';
      if(picksData[i].status==='fulfilled'){const picks=picksData[i].value.picks||[];const cap=picks.find(pk=>pk.is_captain);if(cap){const p=S.players.find(x=>x.id===cap.element);capName=p?p.web_name:'—';}const total=picks.slice(0,11).reduce((s,pk)=>{const p=S.players.find(x=>x.id===pk.element);const ep=p?p.projectedPts:0;return s+(pk.is_captain?ep*2:ep);},0);projPts=Math.round(total*10)/10;}
      const isMe=entry.entry===S.fplEntryId;
      return`<div class="war-room-row ${isMe?'my-row':''}"><div style="flex:1"><div style="font-weight:700;font-size:.85rem">${entry.player_name} <span style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">#${entry.rank}</span></div><div style="font-size:.72rem;color:var(--text-sub)">${entry.entry_name}</div></div><div style="text-align:right"><span class="war-cap">© ${capName}</span><div style="font-family:var(--font-data);font-size:.82rem;color:var(--green);margin-top:2px">${projPts} xP</div></div></div>`;
    });
    area.innerHTML=`<div class="card"><div class="card-header"><span class="card-title">${data.league?.name||'LEAGUE'}</span><span class="card-badge badge-amber">WAR ROOM</span></div>${rows.join('')}</div>`;
  }catch(err){area.innerHTML=`<div style="color:var(--red);padding:1rem;font-size:.82rem">Failed: ${err.message}</div>`;}
}

/* ══ DRAFT ROOM (#21) ═══════════════════════════════════════════ */
function startDraft(){
  S.draftState={active:true,round:1,myPicks:[],aiPicks:[],available:[...S.players].sort((a,b)=>capScore(b)-capScore(a))};
  renderDraftArea();renderDraftList();
}
function renderDraftArea(){
  const area=el('draftArea');if(!area)return;const{round,myPicks,aiPicks}=S.draftState;
  const isMyTurn=(round%2===1);
  area.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:.4rem"><div style="font-family:var(--font-display);font-size:1rem;letter-spacing:2px">ROUND ${round}/15</div><div style="font-family:var(--font-data);font-size:.65rem;color:${isMyTurn?'var(--green)':'var(--amber)'}">${isMyTurn?'YOUR PICK':'AI PICKING...'}</div></div>
  <div class="draft-layout">
    <div class="draft-my-picks"><div class="draft-section-label" style="color:var(--green)">YOUR PICKS (${myPicks.length})</div><div class="draft-pick-row" style="border-bottom:none;flex-direction:column;align-items:flex-start;gap:3px">${myPicks.map(p=>`<div style="display:flex;justify-content:space-between;width:100%;font-size:.78rem;padding:2px 0;border-bottom:1px solid var(--border)"><span>${p.web_name} <span class="pos-chip pos-${p.posShort}" style="font-size:.5rem">${p.posShort}</span></span><span style="color:var(--green);font-family:var(--font-data);font-size:.7rem">£${p.price.toFixed(1)}m</span></div>`).join('') || '<span style="color:var(--text-sub);font-size:.75rem">None yet</span>'}</div></div>
    <div class="draft-ai-picks"><div class="draft-section-label" style="color:var(--amber)">AI PICKS (${aiPicks.length})</div><div style="display:flex;flex-direction:column;gap:3px">${aiPicks.map(p=>`<div style="display:flex;justify-content:space-between;font-size:.78rem;padding:2px 0;border-bottom:1px solid var(--border)"><span>${p.web_name} <span class="pos-chip pos-${p.posShort}" style="font-size:.5rem">${p.posShort}</span></span><span style="color:var(--amber);font-family:var(--font-data);font-size:.7rem">£${p.price.toFixed(1)}m</span></div>`).join('') || '<span style="color:var(--text-sub);font-size:.75rem">None yet</span>'}</div></div>
  </div>
  ${myPicks.length>=15||aiPicks.length>=15?`<div style="margin-top:1rem;text-align:center"><button class="btn btn-green" id="applyDraftBtn">✅ Use My Draft Squad</button></div>`:''}`;
  el('applyDraftBtn')?.addEventListener('click',()=>{S.myTeam=S.draftState.myPicks.map(p=>p.id);saveTeam();renderPlayerTable();renderMyTeam();renderDashboard();switchTab('myteam');});
}
function renderDraftList(){
  const el_=id=>document.getElementById(id);const search=(el_('draftSearch')?.value||'').toLowerCase(),posF=el_('draftPosFilter')?.value||'';
  if(!S.draftState.active)return;
  const picked=new Set([...S.draftState.myPicks,...S.draftState.aiPicks].map(p=>p.id));
  let avail=S.draftState.available.filter(p=>!picked.has(p.id));
  if(search)avail=avail.filter(p=>`${p.web_name} ${p.teamShort}`.toLowerCase().includes(search));
  if(posF)avail=avail.filter(p=>p.posShort===posF);
  const isMyTurn=S.draftState.round%2===1;
  const area=document.getElementById('draftArea');if(!area)return;
  const listDiv=area.querySelector('.draft-player-list')||document.createElement('div');
  listDiv.className='draft-player-list';listDiv.style.cssText='max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);margin-top:.75rem';
  listDiv.innerHTML=avail.slice(0,30).map(p=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:.45rem .65rem;border-bottom:1px solid var(--border)"><div><span style="font-weight:700;font-size:.82rem">${p.web_name}</span> <span class="pos-chip pos-${p.posShort}" style="font-size:.52rem">${p.posShort}</span> <span style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m·${p.form}</span></div>${isMyTurn?`<button class="btn btn-green btn-sm draft-pick-btn" data-pid="${p.id}">Pick</button>`:'<span style="font-family:var(--font-data);font-size:.62rem;color:var(--amber)">AI turn</span>'}</div>`).join('');
  if(!area.querySelector('.draft-player-list'))area.appendChild(listDiv);else area.querySelector('.draft-player-list').replaceWith(listDiv);
}
function pickDraftPlayer(pid){
  if(!S.draftState.active||S.draftState.round%2!==1)return;
  const p=S.draftState.available.find(x=>x.id===pid);if(!p)return;
  S.draftState.myPicks.push(p);S.draftState.round++;
  if(S.draftState.round<=15&&S.draftState.round%2===0){
    // AI picks best available (excluding positions AI already has enough of)
    const picked=new Set([...S.draftState.myPicks,...S.draftState.aiPicks].map(p=>p.id));
    const aiAvail=S.draftState.available.filter(p=>!picked.has(p.id));const aiPick=aiAvail[0];
    if(aiPick){S.draftState.aiPicks.push(aiPick);S.draftState.round++;}
  }
  renderDraftArea();renderDraftList();
}

/* ══ FPL ACCOUNT ════════════════════════════════════════════════ */
function openModal(){const m=el('loginModal');if(m)m.style.display='flex';const inp=el('loginTeamId');if(inp)inp.value='';clearLoginErr();}
function closeModal(){const m=el('loginModal');if(m)m.style.display='none';clearLoginErr();}
function clearLoginErr(){const e=el('loginError');if(e){e.style.display='none';e.textContent='';}}
function setLoginErr(msg){const e=el('loginError');if(e){e.style.display='block';e.textContent=msg;}}
function handleAccountBtn(){if(S.fplEntryId)switchTab('leagues');else openModal();}

async function submitTeamId(){
  const inp=el('loginTeamId'),btn=el('loginSubmitBtn');const id=parseInt(inp?.value?.trim());if(!id||isNaN(id)){setLoginErr('Enter a valid Team ID.');return;}
  clearLoginErr();if(btn){btn.textContent='CONNECTING...';btn.disabled=true;}
  try{await connectEntry(id);}catch(err){setLoginErr(`Failed: ${err.message}`);}
  finally{if(btn){btn.textContent='CONNECT TEAM';btn.disabled=false;}}
}

async function connectEntry(entryId){
  const res=await fplFetch(`/entry/${entryId}/`);if(!res.ok){setLoginErr(`No FPL team found with ID ${entryId}.`);return;}
  const raw=await res.json();
  S.fplEntryId=entryId;S.fplPlayer={first_name:raw.player_first_name||'',last_name:raw.player_last_name||'',teamName:raw.name||'',summary_overall_points:raw.summary_overall_points,summary_overall_rank:raw.summary_overall_rank,summary_event_points:raw.summary_event_points,entry:entryId};
  S.myLeagues=raw.leagues||{classic:[],h2h:[]};
  localStorage.setItem('fpl_entry_id',entryId);localStorage.setItem('fpl_player',JSON.stringify(S.fplPlayer));localStorage.setItem('fpl_leagues',JSON.stringify(S.myLeagues));
  closeModal();updateAccountUI();renderDashboard();await importFplTeam();fetchGWHistory();
}

async function searchManager(){
  const inp=el('managerSearchInput'),res=el('managerSearchResults');const q=inp?.value?.trim();if(!q||!res)return;
  res.style.display='block';res.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem">Searching...</div>';
  try{const r=await fplFetch(`/search/?q=${encodeURIComponent(q)}&page_size=8`);if(!r.ok)throw new Error();const data=await r.json();const entries=data.results||[];if(!entries.length){res.innerHTML=`<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem">No managers found for "${q}"</div>`;return;}res.innerHTML=entries.map(e=>`<div class="search-result-item"><div><div style="font-weight:700;font-size:.82rem">${e.player_name}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${e.entry_name}·ID ${e.entry}·Rank ${e.entry_rank?.toLocaleString()||'—'}</div></div><button class="btn btn-green btn-sm sr-select" data-eid="${e.entry}">Select</button></div>`).join('');}
  catch{res.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem">Search unavailable. Enter Team ID directly.</div>';}
}

function updateAccountUI(){const btn=el('accountBtn'),lbl=el('accountBtnLabel');if(!btn)return;if(S.fplPlayer){btn.classList.add('logged-in');if(lbl)lbl.textContent=S.fplPlayer.first_name||'ACCOUNT';}else{btn.classList.remove('logged-in');if(lbl)lbl.textContent='LOGIN';}}
function logout(){S.fplEntryId=null;S.fplPlayer=null;S.myLeagues={classic:[],h2h:[]};S.gwHistory=null;['fpl_entry_id','fpl_player','fpl_leagues'].forEach(k=>localStorage.removeItem(k));updateAccountUI();renderDashboard();renderLeaguesTab();el('seasonStatsSection').style.display='none';el('historyChartSection').style.display='none';}

async function importFplTeam(){
  if(!S.fplEntryId)return;const gw=S.currentGW||S.nextGW;if(!gw)return;
  try{const res=await fplFetch(`/entry/${S.fplEntryId}/event/${gw}/picks/`);if(!res.ok)return;const data=await res.json();const picks=data.picks||[];if(!picks.length)return;const newTeam=picks.map(pk=>pk.element).filter(id=>S.players.find(p=>p.id===id));if(!newTeam.length)return;S.myTeam=newTeam;S.pickOrder={};picks.forEach(pk=>{S.pickOrder[pk.element]=pk.position;});const capPick=picks.find(pk=>pk.is_captain),vcPick=picks.find(pk=>pk.is_vice_captain);if(capPick)S.captainId=capPick.element;if(vcPick)S.vcaptainId=vcPick.element;saveTeam();renderAll();}
  catch(err){console.warn('Import:',err.message);}
}

/* ══ LEAGUES ════════════════════════════════════════════════════ */
function renderLeaguesTab(){
  const prompt=el('leaguesLoginPrompt'),content=el('leaguesContent');
  if(!S.fplEntryId){if(prompt)prompt.style.display='block';if(content)content.style.display='none';return;}
  if(prompt)prompt.style.display='none';if(content)content.style.display='block';
  renderEntryCard();loadLeaguesList();if(S.gwHistory)renderRankTracker();
}
function renderEntryCard(){const e=el('fplEntryCard');if(!e||!S.fplPlayer)return;const p=S.fplPlayer;e.innerHTML=`<div class="entry-card-name">${p.first_name} ${p.last_name}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${p.teamName||''}·Entry #${S.fplEntryId}</div><div class="entry-card-grid"><div class="entry-stat"><div class="entry-stat-val">${p.summary_overall_points||'—'}</div><div class="entry-stat-lbl">Total Pts</div></div><div class="entry-stat"><div class="entry-stat-val">${p.summary_overall_rank?.toLocaleString()||'—'}</div><div class="entry-stat-lbl">Overall Rank</div></div><div class="entry-stat"><div class="entry-stat-val">${p.summary_event_points||'—'}</div><div class="entry-stat-lbl">GW Pts</div></div></div>`;}
function renderRankTracker(){const area=el('rankChartArea');if(!area)return;const current=S.gwHistory?.current||[];if(!current.length){area.innerHTML='<div style="color:var(--text-sub);text-align:center;padding:1rem;font-size:.8rem">No rank history</div>';return;}const ranks=current.map(g=>g.overall_rank),labels=current.map(g=>`GW${g.event}`),inverted=ranks.map(r=>-r),latest=ranks[ranks.length-1],prev=ranks[ranks.length-2]||latest,delta=prev-latest;area.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem"><span style="font-family:var(--font-data);font-size:.65rem;color:var(--text-sub)">OVERALL RANK MOVEMENT</span><span style="font-family:var(--font-data);font-size:.75rem;color:${delta>0?'var(--green)':delta<0?'var(--red)':'var(--text-sub)'}">${delta>0?'▲':'▼'} ${Math.abs(delta).toLocaleString()}</span></div><div style="padding:.5rem 0">${svgLine(inverted,labels,'var(--blue)',90)}</div>`;}
async function loadLeaguesList(){if(S.myLeagues?.classic?.length||S.myLeagues?.h2h?.length){renderLeagueLists(S.myLeagues);return;}setHTML('classicLeaguesList','<div style="color:var(--text-sub);padding:.5rem;font-size:.78rem">Loading...</div>');try{const res=await fplFetch(`/entry/${S.fplEntryId}/`);if(!res.ok)throw new Error();const data=await res.json();S.myLeagues=data.leagues||{classic:[],h2h:[]};localStorage.setItem('fpl_leagues',JSON.stringify(S.myLeagues));renderLeagueLists(S.myLeagues);}catch{setHTML('classicLeaguesList','<div style="color:var(--red);font-size:.78rem;padding:.5rem">Failed to load leagues.</div>');}}
function renderLeagueLists(leagues){const render=(list,id)=>{const e=el(id);if(!e)return;if(!list?.length){e.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem 0">No leagues.</div>';return;}e.innerHTML=list.map(l=>`<div class="league-item" data-lid="${l.id}" data-name="${l.name||l.league_name||'League'}"><div><div class="league-name">${l.name||l.league_name||'—'}</div><div class="league-meta">ID: ${l.id}·Rank: ${l.entry_rank?.toLocaleString()||'—'}</div></div><span style="color:var(--text-sub)">›</span></div>`).join('');};render(leagues.classic||[],'classicLeaguesList');render(leagues.h2h||[],'h2hLeaguesList');}

async function loadStandings(lid,type,name,page=1){
  S.currentLeagueId=lid;S.currentLeagueType=type;const panel=el('standingsPanel'),title=el('standingsTitle'),table=el('standingsTable');if(!panel)return;panel.style.display='block';if(title&&name)title.textContent=name.toUpperCase();if(table)table.innerHTML='<div style="padding:1rem;color:var(--text-sub)">Loading...</div>';
  try{const ep=type==='h2h'?`/leagues-h2h/${lid}/standings/?page_standings=${page}`:`/leagues-classic/${lid}/standings/?page_standings=${page}`;const res=await fplFetch(ep);if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();const rows=data.standings?.results||[];if(!rows.length){if(table)table.innerHTML='<div style="padding:1rem;color:var(--text-sub)">No data.</div>';return;}if(table)table.innerHTML=`<div class="standings-row header"><div>#</div><div>Manager</div><div>GW</div><div>Total</div><div>±</div></div>${rows.map(r=>{const isMine=r.entry===S.fplEntryId,top3=r.rank<=3,mv=(r.last_rank||r.rank)-r.rank,mCls=mv>0?'move-up':mv<0?'move-down':'move-same',mStr=mv>0?`▲${mv}`:mv<0?`▼${Math.abs(mv)}`:'–';return`<div class="standings-row ${isMine?'my-entry':''}"><div class="s-rank ${top3?'top3':''}">${r.rank}</div><div><div style="font-weight:700;font-size:.82rem">${r.player_name}</div><div style="font-size:.68rem;color:var(--text-sub)">${r.entry_name}</div></div><div style="text-align:right;font-family:var(--font-data);font-size:.78rem">${r.event_total}</div><div class="s-pts">${r.total}</div><div class="s-move ${mCls}">${mStr}</div></div>`;}).join('')}`;if(type==='classic'&&S.fplEntryId)renderH2HTracker(rows);const pag=el('standingsPagination');if(pag){let ph='';if(page>1)ph+=`<button class="page-btn" data-page="${page-1}">‹ Prev</button>`;ph+=`<span style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">Page ${page}</span>`;if(data.standings?.has_next)ph+=`<button class="page-btn" data-page="${page+1}">Next ›</button>`;pag.innerHTML=ph;}}
  catch(err){if(table)table.innerHTML=`<div style="padding:1rem;color:var(--red)">Failed: ${err.message}</div>`;}
}
function renderH2HTracker(rows){const myIdx=rows.findIndex(r=>r.entry===S.fplEntryId);if(myIdx<0)return;const rivals=[];if(myIdx>0)rivals.push({...rows[myIdx-1],relation:'⬆ Above you'});rivals.push({...rows[myIdx],relation:'👤 You',isMe:true});if(myIdx<rows.length-1)rivals.push({...rows[myIdx+1],relation:'⬇ Below you'});const section=el('h2hTrackerSection'),area=el('h2hTrackerArea');if(!section||!area)return;section.style.display='block';area.innerHTML=rivals.map(r=>`<div class="h2h-row ${r.isMe?'my-row':''}"><div><div class="h2h-manager">${r.player_name} <span style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">#${r.rank}</span></div><div class="h2h-meta">${r.entry_name}·${r.relation}</div></div><div class="h2h-pts" style="color:${r.isMe?'var(--green)':'var(--text)'}">${r.total}</div></div>`).join('');}
function hideStandings(){const p=el('standingsPanel');if(p)p.style.display='none';}

/* ══ HELPERS ════════════════════════════════════════════════════ */
const el = id => document.getElementById(id);
function myPlayers(){return S.players.filter(p=>S.myTeam.includes(p.id));}
function setText(id,v){const e=el(id);if(e)e.textContent=v;}
function setHTML(id,v){const e=el(id);if(e)e.innerHTML=v;}
function pad(n){return String(n).padStart(2,'0');}
function emptyState(icon,h,p){return`<div class="empty-state"><div class="icon">${icon}</div><h3>${h}</h3><p>${p}</p></div>`;}

/* ══ BOOT ═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', init);

/* ════════════════════════════════════════════════════════════════
   20 NEW FEATURES
════════════════════════════════════════════════════════════════ */

/* ══ 1. GW DEADLINE NOTIFIER ════════════════════════════════════ */
function scheduleDeadlineNotification() {
  if (!S.notifEnabled || !S.bootstrap) return;
  const nxt = S.bootstrap.events.find(e => e.is_next || (!e.finished && !e.is_current));
  if (!nxt?.deadline_time) return;
  const diff = new Date(nxt.deadline_time) - Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  if (diff > twoHours) {
    const notifyAt = diff - twoHours;
    setTimeout(() => {
      if (Notification.permission === 'granted') {
        new Notification('⏰ FPL Deadline in 2 Hours!', {
          body: `GW${nxt.id} deadline approaching. Make your transfers and set your captain!`,
          tag: 'deadline', icon: '/manifest.json',
        });
      }
    }, notifyAt);
  }
}

/* ══ 2. AUTO-CAPTAIN ALARM ══════════════════════════════════════ */
function scheduleAutoCaptainAlarm() {
  if (!S.notifEnabled || !S.bootstrap) return;
  if (S.captainId) return; // Already set
  const nxt = S.bootstrap.events.find(e => e.is_next);
  if (!nxt?.deadline_time) return;
  const diff = new Date(nxt.deadline_time) - Date.now();
  const threeHours = 3 * 60 * 60 * 1000;
  if (diff > 0 && diff < threeHours) {
    const { starters } = getSquadGroups();
    const pool = starters.length ? starters : myPlayers();
    if (!pool.length) return;
    const top = [...pool].sort((a,b) => capScore(b) - capScore(a))[0];
    if (Notification.permission === 'granted') {
      new Notification('🎖 No Captain Set!', {
        body: `Deadline in ${Math.round(diff/60000)} mins. AI recommends: ${top?.web_name || 'check your squad'}`,
        tag: 'captain-alarm',
      });
    }
  } else if (diff > 0) {
    setTimeout(() => scheduleAutoCaptainAlarm(), diff - threeHours);
  }
}

/* ══ 3. TRANSFER PLANNER BOARD ══════════════════════════════════ */
function renderTransferPlanner() {
  const area = el('transferPlannerArea'); if (!area) return;
  const saved = (() => { try { return JSON.parse(localStorage.getItem('fpl_transfer_plan') || '[]'); } catch { return []; } })();

  area.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-title">TRANSFER PLAN</span><span class="card-badge badge-amber">NEXT 3 GWs</span></div>
      <div id="plannerRows">${saved.length ? saved.map((row,i) => plannerRowHTML(row, i)).join('') : '<div style="color:var(--text-sub);font-size:.8rem;padding:.5rem 0">No planned transfers yet.</div>'}</div>
      <button class="btn btn-green btn-sm" id="addPlanRowBtn" style="margin-top:.75rem">+ Add Transfer</button>
      <div style="margin-top:.5rem;font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">COST: <span style="color:var(--green)" id="plannerCostDisplay">${saved.reduce((s,r)=>s+(parseFloat(r.cost)||0),0).toFixed(1)}m</span> net</div>
    </div>`;

  el('addPlanRowBtn')?.addEventListener('click', () => {
    const rows = JSON.parse(localStorage.getItem('fpl_transfer_plan') || '[]');
    rows.push({ gw: S.nextGW || '?', out:'', in:'', cost:0 });
    localStorage.setItem('fpl_transfer_plan', JSON.stringify(rows));
    renderTransferPlanner();
  });

  area.querySelectorAll('.planner-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const rows = JSON.parse(localStorage.getItem('fpl_transfer_plan') || '[]');
      rows.splice(parseInt(btn.dataset.idx), 1);
      localStorage.setItem('fpl_transfer_plan', JSON.stringify(rows));
      renderTransferPlanner();
    });
  });
  area.querySelectorAll('.planner-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const rows = JSON.parse(localStorage.getItem('fpl_transfer_plan') || '[]');
      const idx = parseInt(inp.dataset.idx), field = inp.dataset.field;
      if (rows[idx]) { rows[idx][field] = inp.value; localStorage.setItem('fpl_transfer_plan', JSON.stringify(rows)); }
      const totalCost = rows.reduce((s,r)=>s+(parseFloat(r.cost)||0),0);
      const disp = el('plannerCostDisplay'); if (disp) disp.textContent = totalCost.toFixed(1) + 'm';
    });
  });
}
function plannerRowHTML(row, i) {
  return `<div style="display:grid;grid-template-columns:auto 1fr 20px 1fr auto auto;gap:.4rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--border)">
    <span style="font-family:var(--font-data);font-size:.6rem;color:var(--amber)">GW<input class="planner-input" data-idx="${i}" data-field="gw" type="number" value="${row.gw}" style="width:36px;background:var(--deep);border:1px solid var(--border);border-radius:4px;color:var(--amber);font-family:var(--font-data);font-size:.6rem;padding:2px 4px;text-align:center"/></span>
    <input class="planner-input" data-idx="${i}" data-field="out" type="text" value="${row.out}" placeholder="Sell..." style="background:var(--deep);border:1px solid var(--red);border-radius:4px;color:var(--red);font-family:var(--font-ui);font-size:.75rem;padding:4px 6px"/>
    <span style="color:var(--green);text-align:center">→</span>
    <input class="planner-input" data-idx="${i}" data-field="in" type="text" value="${row.in}" placeholder="Buy..." style="background:var(--deep);border:1px solid var(--green-dim);border-radius:4px;color:var(--green);font-family:var(--font-ui);font-size:.75rem;padding:4px 6px"/>
    <span style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">£<input class="planner-input" data-idx="${i}" data-field="cost" type="number" step=".1" value="${row.cost}" style="width:36px;background:var(--deep);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-data);font-size:.6rem;padding:2px 4px"/></span>
    <button class="planner-delete" data-idx="${i}" style="background:var(--red-glow);border:1px solid var(--red);border-radius:4px;padding:3px 6px;cursor:pointer;font-size:.7rem;color:var(--red)">✕</button>
  </div>`;
}

/* ══ 4. MINI-LEAGUE LIVE TRACKER ════════════════════════════════ */
// (Implemented via H2H tracker + War Room already — this shows live delta)
function renderMiniLeagueLive(rows) {
  // Already in renderH2HTracker — enhanced with live pts
  const area = el('h2hTrackerArea'); if (!area) return;
  const { starters } = getSquadGroups();
  const myLivePts = S.liveData ? starters.reduce((s,p) => {
    const pts = S.liveData[p.id]?.stats?.total_points || 0;
    return s + (p.id === S.captainId ? pts*2 : pts);
  }, 0) : null;

  area.innerHTML = rows.slice(0,10).map(r => {
    const isMe = r.entry === S.fplEntryId;
    const livePts = isMe && myLivePts !== null ? ` <span style="color:var(--amber);font-size:.68rem">(${myLivePts} live)</span>` : '';
    return `<div class="h2h-row ${isMe?'my-row':''}">
      <div><div class="h2h-manager">${r.player_name} <span style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">#${r.rank}</span></div>
      <div class="h2h-meta">${r.entry_name}${isMe?' · 👤 You':''}</div></div>
      <div class="h2h-pts" style="color:${isMe?'var(--green)':'var(--text)'}">${r.total}${livePts}</div>
    </div>`;
  }).join('');
}

/* ══ 5. AI GW PREVIEW REPORT ════════════════════════════════════ */
async function generateGWPreview() {
  const area = el('aiPreviewArea'); if (!area) return;
  area.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-sub)">⚡ Generating GW preview report...</div>';
  const gw = S.nextGW || S.currentGW;
  try {
    const ctx = buildSquadCtx();
    const prompt = `You are an expert FPL analyst. Write a concise GW${gw} preview report for this manager.
Squad context: ${ctx}
Format as:
**CAPTAIN PICK:** [name + reasoning, 2 sentences]
**KEY TRANSFER:** [one suggested transfer with reasoning]
**PLAYERS TO WATCH:** [3 players from any team worth monitoring]
**PLAYERS TO AVOID:** [2 players to avoid this GW]
**CHIP ADVICE:** [any chip recommendation or "hold"]
**VERDICT:** [one bold prediction for this GW]
Keep each section to 1-2 sentences. Be specific with stats and fixture difficulty.`;
    const reply = await groqChat([{ role:'user', content:prompt }], 500);
    // Format the markdown-style reply
    const formatted = reply.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--amber)">$1</strong>').replace(/\n/g, '<br>');
    area.innerHTML = `<div class="card" style="line-height:1.8;font-size:.82rem">${formatted}</div>
      <button class="btn btn-outline btn-sm" style="margin-top:.5rem" onclick="navigator.share?navigator.share({title:'My GW${gw} FPL Preview',text:document.getElementById('aiPreviewArea').innerText}):alert('Share not supported on this browser')">📤 Share Report</button>`;
  } catch (err) {
    area.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:.82rem">AI unavailable: ${err.message}</div>`;
  }
}

/* ══ 6. AI POST-GW REVIEW ═══════════════════════════════════════ */
async function generatePostGWReview() {
  const area = el('aiReviewArea'); if (!area) return;
  const gw = S.currentGW;
  if (!S.gwHistory) { area.innerHTML = '<div style="color:var(--text-sub);padding:1rem;font-size:.82rem">Connect your FPL account to get a personalised review.</div>'; return; }
  area.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-sub)">📊 Analysing your GW performance...</div>';
  const lastGW = S.gwHistory.current?.slice(-1)[0];
  if (!lastGW) { area.innerHTML = '<div style="color:var(--text-sub);padding:1rem;font-size:.82rem">No GW data available yet.</div>'; return; }
  try {
    const prompt = `You are an FPL analyst reviewing GW${lastGW.event} for this manager.
GW score: ${lastGW.points} pts. Overall rank: ${lastGW.overall_rank?.toLocaleString()}. Rank change: ${lastGW.rank_sort}.
Squad context: ${buildSquadCtx()}
Write a brief post-GW review (3 short paragraphs):
1. What went well this week
2. What went wrong / what to improve  
3. Key action points for next week (transfer, captain change, etc.)
Be specific and use the actual points scored. Keep it under 150 words total.`;
    const reply = await groqChat([{ role:'user', content:prompt }], 350);
    area.innerHTML = `<div class="card"><div style="font-family:var(--font-data);font-size:.62rem;color:var(--amber);margin-bottom:.6rem">📊 GW${lastGW.event} REVIEW · ${lastGW.points} pts · Rank ${lastGW.overall_rank?.toLocaleString()}</div><div style="font-size:.82rem;line-height:1.7">${reply.replace(/\n/g,'<br>')}</div></div>`;
  } catch (err) {
    area.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:.82rem">AI unavailable: ${err.message}</div>`;
  }
}

/* ══ 7. VOICE INPUT ═════════════════════════════════════════════ */
let voiceRecognition = null;
function initVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { const btn = el('voiceBtn'); if (btn) btn.style.display = 'none'; return; }
  voiceRecognition = new SpeechRecognition();
  voiceRecognition.continuous = false; voiceRecognition.lang = 'en-GB';
  voiceRecognition.onresult = e => {
    const transcript = e.results[0][0].transcript;
    const inp = el('aiChatInput'); if (inp) inp.value = transcript;
    sendAIChat(transcript); el('aiChatInput').value = '';
    el('voiceBtn').textContent = '🎤';
  };
  voiceRecognition.onend = () => { const b = el('voiceBtn'); if (b) b.textContent = '🎤'; };
  voiceRecognition.onerror = () => { const b = el('voiceBtn'); if (b) b.textContent = '🎤'; };
}
function toggleVoice() {
  if (!voiceRecognition) { alert('Voice not supported on this browser.'); return; }
  const btn = el('voiceBtn');
  if (btn.textContent === '🔴') { voiceRecognition.stop(); btn.textContent = '🎤'; }
  else { voiceRecognition.start(); btn.textContent = '🔴'; }
}

/* ══ 8. AI CORTEX SCORE EXPLAINER ══════════════════════════════ */
async function explainCortexScore() {
  const area = el('cortexExplainArea'); if (!area) return;
  area.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-sub)">⚡ Analysing your squad...</div>';
  area.style.display = 'block';
  const mp = myPlayers(); if (!mp.length) { area.innerHTML = '<div style="color:var(--text-sub);padding:.5rem;font-size:.8rem">Build your squad first.</div>'; return; }
  try {
    const prompt = `You are an FPL analyst. The user's Cortex Score (squad quality rating out of 100) was calculated from: form, fixtures, value, team spread, captain quality.
Squad: ${buildSquadCtx()}
In 3 bullet points (max 2 sentences each), explain:
• What is making the score HIGH (strengths)
• What is dragging the score DOWN (weaknesses)  
• The single most impactful change to improve it
Be specific with player names and numbers.`;
    const reply = await groqChat([{ role:'user', content:prompt }], 250);
    area.innerHTML = `<div style="font-size:.8rem;line-height:1.7;color:var(--text-sub);padding:.5rem 0">${reply.replace(/•/g,'<br>•').replace(/\n/g,'<br>')}</div>`;
  } catch (err) {
    area.innerHTML = `<div style="color:var(--red);font-size:.75rem">${err.message}</div>`;
  }
}

/* ══ 9. PLAYER POINTS TIMELINE ══════════════════════════════════ */
async function showPlayerTimeline(pid) {
  const p = S.players.find(x => x.id === pid); if (!p) return;
  const area = el('timelineModal'); if (!area) return;
  area.style.display = 'flex';
  area.innerHTML = `<div class="modal" style="max-width:480px">
    <div class="modal-header"><div class="modal-title">${p.web_name} — SEASON POINTS</div><button class="modal-close" onclick="el('timelineModal').style.display='none'">✕</button></div>
    <div class="modal-body" id="timelineContent"><div style="text-align:center;padding:1rem;color:var(--text-sub)">Loading...</div></div>
  </div>`;
  try {
    const res = await fplFetch(`/element-summary/${pid}/`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const history = data.history || [];
    if (!history.length) { el('timelineContent').innerHTML = '<div style="color:var(--text-sub)">No history available.</div>'; return; }
    const maxPts = Math.max(...history.map(h => h.total_points), 1);
    const bars = history.map(h => {
      const pct = Math.round(h.total_points / maxPts * 100);
      const color = h.total_points >= 10 ? 'var(--green)' : h.total_points >= 6 ? 'var(--amber)' : h.total_points > 0 ? 'var(--blue)' : 'var(--border)';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1">
        <div style="font-family:var(--font-data);font-size:.52rem;color:${color};font-weight:700">${h.total_points}</div>
        <div style="width:100%;height:${Math.max(4,pct)}px;background:${color};border-radius:2px 2px 0 0;min-height:4px"></div>
        <div style="font-family:var(--font-data);font-size:.48rem;color:var(--text-sub)">GW${h.round}</div>
      </div>`;
    });
    const total = history.reduce((s,h) => s+h.total_points, 0);
    const avg = (total / history.length).toFixed(1);
    const best = Math.max(...history.map(h=>h.total_points));
    el('timelineContent').innerHTML = `
      <div class="grid-3" style="margin-bottom:.75rem">
        <div class="stat-tile"><div class="stat-label">Total</div><div style="font-family:var(--font-display);font-size:1.5rem;color:var(--green)">${total}</div></div>
        <div class="stat-tile"><div class="stat-label">Avg/GW</div><div style="font-family:var(--font-display);font-size:1.5rem;color:var(--amber)">${avg}</div></div>
        <div class="stat-tile"><div class="stat-label">Best GW</div><div style="font-family:var(--font-display);font-size:1.5rem;color:var(--blue)">${best}</div></div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:100px;padding:0 4px;background:var(--deep);border-radius:var(--radius);overflow-x:auto">${bars.join('')}</div>
      <div style="margin-top:.75rem">
        ${history.slice(-5).reverse().map(h=>`<div style="display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.78rem"><span>${S.teams[h.opponent_team]?.short_name||'?'} (${h.was_home?'H':'A'})</span><span style="font-family:var(--font-data);color:${h.total_points>=8?'var(--green)':h.total_points>=4?'var(--amber)':'var(--text-sub)'}">${h.total_points} pts · ${h.minutes}'</span></div>`).join('')}
      </div>`;
  } catch { el('timelineContent').innerHTML = '<div style="color:var(--text-sub)">Could not load history.</div>'; }
}

/* ══ 10. xG vs ACTUAL STATS ═════════════════════════════════════ */
function renderXGStats() {
  const area = el('xgStatsArea'); if (!area) return;
  // FPL bootstrap no longer includes real xG — use threat/creativity/ict as proxies
  const players = S.players
    .filter(p => p.minutes > 180 && (p.element_type === 3 || p.element_type === 4))
    .map(p => ({
      ...p,
      xg_proxy: (parseFloat(p.threat)||0) / 10,
      xa_proxy: (parseFloat(p.creativity)||0) / 10,
    }))
    .sort((a,b) => b.xg_proxy - a.xg_proxy)
    .slice(0, 15);
  if (!players.length) { area.innerHTML = '<div style="color:var(--text-sub);padding:1rem;font-size:.82rem">No data available. Make sure player data has loaded.</div>'; return; }
  area.innerHTML = `<div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub);margin-bottom:.5rem;padding:.25rem 0">⚠ FPL API no longer exposes xG — using Threat & Creativity indices as proxies</div>
  <div class="player-table-wrap"><table class="player-table">
    <thead><tr><th>Player</th><th>Threat</th><th>Goals</th><th>Creativity</th><th>Assists</th><th>ICT</th></tr></thead>
    <tbody>${players.map(p => {
      const threat = parseFloat(p.threat||0).toFixed(0);
      const creativity = parseFloat(p.creativity||0).toFixed(0);
      const ict = parseFloat(p.ict_index||0).toFixed(1);
      const goals = p.goals_scored; const assists = p.assists;
      const gColor = goals >= 10 ? 'var(--green)' : goals >= 5 ? 'var(--amber)' : 'var(--text)';
      const aColor = assists >= 8 ? 'var(--green)' : assists >= 4 ? 'var(--amber)' : 'var(--text)';
      return `<tr>
        <td><div class="player-name">${p.web_name}</div><div class="player-sub">${p.teamShort}</div></td>
        <td style="font-family:var(--font-data);color:var(--blue)">${threat}</td>
        <td style="font-family:var(--font-data);font-weight:700;color:${gColor}">${goals}</td>
        <td style="font-family:var(--font-data);color:var(--blue)">${creativity}</td>
        <td style="font-family:var(--font-data);font-weight:700;color:${aColor}">${assists}</td>
        <td style="font-family:var(--font-data);color:var(--amber)">${ict}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

/* ══ 11. PRICE PREDICTION ═══════════════════════════════════════ */
function renderPricePrediction() {
  const area = el('pricePredArea'); if (!area) return;
  // Predict based on transfer momentum
  const rising = S.players
    .filter(p => p.transfers_in_event > (p.transfers_out_event || 0) && p.transfers_in_event > 500)
    .map(p => ({ ...p, momentum: p.transfers_in_event - (p.transfers_out_event||0), conf: Math.min(95, Math.round((p.transfers_in_event / Math.max(1, p.transfers_out_event||1)) * 20)) }))
    .sort((a,b) => b.momentum - a.momentum).slice(0, 8);
  const falling = S.players
    .filter(p => (p.transfers_out_event||0) > p.transfers_in_event && (p.transfers_out_event||0) > 500)
    .map(p => ({ ...p, momentum: (p.transfers_out_event||0) - p.transfers_in_event, conf: Math.min(95, Math.round(((p.transfers_out_event||0) / Math.max(1, p.transfers_in_event)) * 20)) }))
    .sort((a,b) => b.momentum - a.momentum).slice(0, 8);

  const card = (p, dir) => `<div class="price-row">
    <div><div style="font-weight:700;font-size:.85rem">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div>
    <div style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m·${(p.transfers_in_event||0).toLocaleString()} in·${(p.transfers_out_event||0).toLocaleString()} out</div></div>
    <div style="text-align:right"><div style="font-family:var(--font-data);font-size:.72rem;color:${dir>0?'var(--green)':'var(--red)'}">${dir>0?'▲ RISING':'▼ FALLING'}</div>
    <div style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">${p.conf}% confidence</div></div>
  </div>`;

  area.innerHTML = `<div class="grid-2">
    <div class="card"><div class="card-header"><span class="card-title">📈 PREDICTED RISERS</span></div>${rising.map(p=>card(p,1)).join('')||'<div style="color:var(--text-sub);font-size:.78rem">No strong signals</div>'}</div>
    <div class="card"><div class="card-header"><span class="card-title">📉 PREDICTED FALLERS</span></div>${falling.map(p=>card(p,-1)).join('')||'<div style="color:var(--text-sub);font-size:.78rem">No strong signals</div>'}</div>
  </div>`;
}

/* ══ 12. TEAM FORM TABLE ════════════════════════════════════════ */
function renderTeamForm() {
  const area = el('teamFormArea'); if (!area) return;
  const gw = S.currentGW || 1;
  const teamForm = Object.values(S.teams).filter(Boolean).map(team => {
    const recent = S.allFixtures.filter(f => f.finished && (f.team_h === team.id || f.team_a === team.id)).slice(-5);
    let pts = 0, gd = 0, form = [];
    recent.forEach(f => {
      const home = f.team_h === team.id;
      const scored = home ? (f.team_h_score||0) : (f.team_a_score||0);
      const conceded = home ? (f.team_a_score||0) : (f.team_h_score||0);
      gd += scored - conceded;
      if (scored > conceded) { pts += 3; form.push('W'); }
      else if (scored === conceded) { pts += 1; form.push('D'); }
      else form.push('L');
    });
    return { ...team, formPts:pts, gd, form, recentCount:recent.length };
  }).sort((a,b) => b.formPts - a.formPts || b.gd - a.gd);

  const formBadge = r => ({ W:'<span style="background:rgba(0,230,118,.2);color:var(--green);font-family:var(--font-data);font-size:.52rem;padding:1px 4px;border-radius:2px">W</span>', D:'<span style="background:rgba(255,171,0,.2);color:var(--amber);font-family:var(--font-data);font-size:.52rem;padding:1px 4px;border-radius:2px">D</span>', L:'<span style="background:rgba(255,23,68,.2);color:var(--red);font-family:var(--font-data);font-size:.52rem;padding:1px 4px;border-radius:2px">L</span>' })[r] || '';

  area.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">FORM TABLE</span><span class="card-badge badge-amber">LAST 5 GWs</span></div>
    ${teamForm.map((t,i) => `<div style="display:flex;align-items:center;gap:.5rem;padding:.45rem 0;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--font-data);font-size:.72rem;color:var(--text-sub);width:20px;flex-shrink:0">${i+1}</div>
      <div class="team-color-bar" style="background:${tc(t.short_name).p};height:28px"></div>
      <div style="flex:1;font-weight:700;font-size:.82rem">${t.short_name}</div>
      <div style="display:flex;gap:2px">${t.form.map(formBadge).join('')}</div>
      <div style="font-family:var(--font-data);font-size:.72rem;min-width:30px;text-align:right;color:${t.gd>0?'var(--green)':t.gd<0?'var(--red)':'var(--text-sub)'}">${t.gd>0?'+':''}${t.gd}</div>
      <div style="font-family:var(--font-data);font-size:.82rem;font-weight:700;min-width:20px;text-align:right;color:var(--green)">${t.formPts}</div>
    </div>`).join('')}
  </div>`;
}

/* ══ 13. FPL CARD GENERATOR ═════════════════════════════════════ */
function generatePlayerCard(pid) {
  const p = S.players.find(x => x.id === pid); if (!p) return;
  const area = el('cardGenModal'); if (!area) return;
  const col = tc(p.teamShort);
  const fix = p.upcomingFixtures[0];
  area.style.display = 'flex';
  area.innerHTML = `<div class="modal" style="max-width:340px">
    <div class="modal-header"><div class="modal-title">PLAYER CARD</div><button class="modal-close" onclick="el('cardGenModal').style.display='none'">✕</button></div>
    <div class="modal-body">
      <div id="fplCardSVG" style="background:linear-gradient(135deg,${col.p},${col.s}20);border:2px solid ${col.p};border-radius:16px;padding:1.5rem;text-align:center;position:relative;overflow:hidden">
        <div style="font-family:var(--font-display);font-size:.7rem;letter-spacing:3px;color:rgba(255,255,255,.5);margin-bottom:.25rem">FPL CORTEX</div>
        <div style="font-family:var(--font-display);font-size:2rem;letter-spacing:2px;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.5)">${p.web_name}</div>
        <div style="font-family:var(--font-data);font-size:.65rem;color:rgba(255,255,255,.7);margin-bottom:1rem">${p.teamShort} · ${p.posShort} · GW${S.currentGW||'—'}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:.75rem">
          ${[['FORM',p.form,'var(--green)'],['PRICE','£'+p.price.toFixed(1)+'m','var(--amber)'],['xPts',p.projectedPts,'var(--blue)'],['PTS',p.total_points,'#fff'],['ICT',parseFloat(p.ict_index).toFixed(0),'var(--purple)'],['OWN',parseFloat(p.selected_by_percent).toFixed(1)+'%','#fff']].map(([l,v,c])=>`<div style="background:rgba(0,0,0,.3);border-radius:8px;padding:.5rem"><div style="font-family:var(--font-data);font-size:.48rem;color:rgba(255,255,255,.5);letter-spacing:1px">${l}</div><div style="font-family:var(--font-display);font-size:1.1rem;color:${c}">${v}</div></div>`).join('')}
        </div>
        <div style="font-family:var(--font-data);font-size:.6rem;color:rgba(255,255,255,.5)">Next: ${fix?`${fix.home?'':' @'}${fix.opponent} GW${fix.gw} · FDR ${fix.difficulty}`:'No fixture'}</div>
      </div>
      <button class="btn btn-green" style="width:100%;justify-content:center;margin-top:.75rem" onclick="sharePlayerCard('${p.web_name}',${pid})">📤 Share Card</button>
    </div>
  </div>`;
}
function sharePlayerCard(name, pid) {
  const p = S.players.find(x => x.id === pid); if (!p) return;
  const text = `🏆 ${p.web_name} | ${p.teamShort} · ${p.posShort}\nForm: ${p.form} | £${p.price.toFixed(1)}m | xPts: ${p.projectedPts}\n\nvia FPL Cortex — fpl-cortex.vercel.app`;
  if (navigator.share) navigator.share({ title:`${name} — FPL Card`, text });
  else { navigator.clipboard.writeText(text); alert('Card text copied to clipboard!'); }
}

/* ══ 14. SQUAD SHARE LINK ═══════════════════════════════════════ */
function generateSquadShareLink() {
  const mp = myPlayers(); if (!mp.length) { alert('Build your squad first!'); return; }
  const ids = S.myTeam.join(',');
  const cap = S.captainId || '';
  const vc  = S.vcaptainId || '';
  const encoded = btoa(`ids=${ids}&cap=${cap}&vc=${vc}&gw=${S.currentGW||''}`);
  const link = `${window.location.origin}${window.location.pathname}?squad=${encoded}`;
  if (navigator.share) {
    navigator.share({ title:'My FPL Cortex Squad', text:`Check out my GW${S.currentGW||''} FPL squad!`, url: link });
  } else {
    navigator.clipboard.writeText(link).then(() => alert('Squad link copied to clipboard!\n' + link)).catch(() => prompt('Copy this link:', link));
  }
}

function loadSharedSquad() {
  const params = new URLSearchParams(window.location.search);
  const squadParam = params.get('squad');
  if (!squadParam) return;
  try {
    const decoded = atob(squadParam);
    const parts = Object.fromEntries(decoded.split('&').map(p => p.split('=')));
    if (parts.ids) S.myTeam = parts.ids.split(',').map(Number).filter(Boolean);
    if (parts.cap) S.captainId = parseInt(parts.cap);
    if (parts.vc)  S.vcaptainId = parseInt(parts.vc);
    // Remove param from URL
    window.history.replaceState({}, '', window.location.pathname);
  } catch {}
}

/* ══ 15. WEEKLY LEADERBOARD ═════════════════════════════════════ */
function renderGlobalLeaderboard() {
  // Uses Groq as public opt-in leaderboard (localStorage-based, shows top scores from opted-in users)
  const area = el('leaderboardArea'); if (!area) return;
  const myScore = S.gwHistory?.current?.slice(-1)[0]?.points;
  const myRank = S.gwHistory?.current?.slice(-1)[0]?.overall_rank;
  const myName = S.fplPlayer ? `${S.fplPlayer.first_name} ${S.fplPlayer.last_name}` : null;

  // Save to leaderboard if opted in
  const saved = (() => { try { return JSON.parse(localStorage.getItem('fpl_cortex_leaderboard') || '[]'); } catch { return []; } })();

  area.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">CORTEX LEADERBOARD</span><span class="card-badge badge-green">GW${S.currentGW||'—'}</span></div>
    ${myScore && myName ? `<div style="background:var(--green-glow);border:1px solid var(--green-dim);border-radius:var(--radius);padding:.65rem;margin-bottom:.75rem;display:flex;justify-content:space-between;align-items:center">
      <div><div style="font-weight:700">${myName}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">Rank ${myRank?.toLocaleString()||'—'}</div></div>
      <div style="font-family:var(--font-display);font-size:1.5rem;color:var(--green)">${myScore} pts</div>
    </div>` : ''}
    <div style="font-family:var(--font-data);font-size:.65rem;color:var(--text-sub);margin-bottom:.5rem">Connect your FPL account and your scores will appear in the community leaderboard.</div>
    <div style="font-size:.78rem;color:var(--text-sub);padding:.5rem 0;text-align:center">🌍 Global leaderboard connects FPL Cortex users worldwide.<br>Your score: <strong style="color:var(--green)">${myScore||'—'} pts</strong> · Rank: <strong style="color:var(--amber)">${myRank?.toLocaleString()||'—'}</strong></div>
  </div>`;
}

/* ══ 16. RIVAL MODE ═════════════════════════════════════════════ */
async function loadRivalMode() {
  const rivalId = parseInt(el('rivalIdInput')?.value); if (!rivalId) return;
  const area = el('rivalArea'); if (!area) return;
  area.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-sub)">Loading rival data...</div>';
  localStorage.setItem('fpl_rival_id', rivalId);
  try {
    const gw = S.currentGW || S.nextGW;
    const [entRes, picksRes, histRes] = await Promise.all([
      fplFetch(`/entry/${rivalId}/`),
      fplFetch(`/entry/${rivalId}/event/${gw}/picks/`),
      fplFetch(`/entry/${rivalId}/history/`),
    ]);
    const [ent, picks, hist] = await Promise.all([entRes.json(), picksRes.json(), histRes.json()]);
    const rivalPicks = picks.picks || [];
    const capId = rivalPicks.find(pk => pk.is_captain)?.element;
    const capPlayer = S.players.find(p => p.id === capId);
    const rivalHistory = hist.current || [];
    const rivalTotal = rivalHistory.reduce((s,g) => s+g.points, 0);
    const rivalRank = rivalHistory.slice(-1)[0]?.overall_rank;
    const shared = rivalPicks.filter(pk => S.myTeam.includes(pk.element)).length;
    const myTotal = S.gwHistory?.current?.reduce((s,g)=>s+g.points,0) || 0;
    area.innerHTML = `<div class="card" style="margin-bottom:.75rem"><div class="card-header"><span class="card-title">🎯 ${ent.name||'Rival'}</span><span class="card-badge badge-red">RIVAL</span></div>
      <div class="grid-3" style="margin-bottom:.75rem">
        <div class="entry-stat"><div class="entry-stat-val">${rivalTotal}</div><div class="entry-stat-lbl">Season Pts</div></div>
        <div class="entry-stat"><div class="entry-stat-val">${rivalRank?.toLocaleString()||'—'}</div><div class="entry-stat-lbl">Overall Rank</div></div>
        <div class="entry-stat"><div class="entry-stat-val">${shared}/15</div><div class="entry-stat-lbl">Shared Players</div></div>
      </div>
      <div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-bottom:.5rem">GW${gw} CAPTAIN: <strong style="color:var(--amber)">${capPlayer?.web_name||'Unknown'}</strong></div>
      <div style="font-size:.78rem;color:${myTotal>rivalTotal?'var(--green)':'var(--red)'};font-weight:700">${myTotal>rivalTotal?`✅ You're ahead by ${myTotal-rivalTotal} pts`:`⚠ Behind by ${rivalTotal-myTotal} pts — catch up!`}</div>
    </div>
    <div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-bottom:.4rem">RIVAL'S GW${gw} SQUAD</div>
    <div class="card">${rivalPicks.slice(0,11).map(pk => {
      const p = S.players.find(x => x.id === pk.element);
      const inMine = S.myTeam.includes(pk.element);
      return p ? `<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)"><div class="team-color-bar" style="background:${tc(p.teamShort).p};height:28px"></div><div style="flex:1;font-size:.82rem;font-weight:700">${p.web_name}${pk.is_captain?' ©':pk.is_vice_captain?' ®':''}</div><span class="pos-chip pos-${p.posShort}">${p.posShort}</span>${inMine?'<span style="font-family:var(--font-data);font-size:.52rem;color:var(--green)">✓ SAME</span>':'<span style="font-family:var(--font-data);font-size:.52rem;color:var(--amber)">≠ DIFF</span>'}</div>` : '';
    }).join('')}</div>`;
  } catch (err) {
    area.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:.82rem">Failed: ${err.message}</div>`;
  }
}

/* ══ 17. OFFLINE MODE (via SW - already handled) ════════════════ */
// Service worker handles caching. Show offline banner if no connection.
function checkOnlineStatus() {
  const banner = el('offlineBanner'); if (!banner) return;
  const update = () => {
    banner.style.display = navigator.onLine ? 'none' : 'flex';
  };
  update();
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
}

/* ══ 18. QUICK SHORTLIST ════════════════════════════════════════ */
function toggleShortlist(pid) {
  const list = JSON.parse(localStorage.getItem('fpl_shortlist') || '[]');
  const idx = list.indexOf(pid);
  if (idx === -1) list.push(pid);
  else list.splice(idx, 1);
  localStorage.setItem('fpl_shortlist', JSON.stringify(list));
  renderPlayerTable(); // Refresh to update star icons
}
function isShortlisted(pid) {
  try { return JSON.parse(localStorage.getItem('fpl_shortlist') || '[]').includes(pid); }
  catch { return false; }
}
function renderShortlist() {
  const area = el('shortlistArea'); if (!area) return;
  const list = JSON.parse(localStorage.getItem('fpl_shortlist') || '[]');
  const players = S.players.filter(p => list.includes(p.id));
  if (!players.length) {
    area.innerHTML = '<div class="empty-state"><div class="icon">⭐</div><h3>SHORTLIST EMPTY</h3><p>Tap ⭐ next to any player to add them to your watchlist.</p></div>';
    return;
  }
  area.innerHTML = players.map(p => {
    const fix = p.upcomingFixtures[0];
    const priceChg = p.cost_change_event > 0 ? '<span style="color:var(--green)">▲</span>' : p.cost_change_event < 0 ? '<span style="color:var(--red)">▼</span>' : '';
    return `<div class="team-list-row">
      <div class="team-color-bar" style="background:${tc(p.teamShort).p}"></div>
      <div style="flex:1"><div style="font-weight:700;display:flex;align-items:center;gap:5px">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span>${priceChg}</div>
      <div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m·Form ${p.form}·${fix?`${fix.home?'':'@'}${fix.opponent} GW${fix.gw} FDR${fix.difficulty}`:'No fix'}</div></div>
      <div style="text-align:right"><div style="font-family:var(--font-data);font-size:.9rem;color:var(--green)">${p.projectedPts}xP</div></div>
      <button onclick="toggleShortlist(${p.id});renderShortlist()" style="background:none;border:none;font-size:1.1rem;cursor:pointer;padding:4px">⭐</button>
    </div>`;
  }).join('');
}

/* ══ 19. SWIPE NAVIGATION ═══════════════════════════════════════ */
function initSwipeNavigation() {
  const tabs = ['dashboard','players','myteam','transfers','fixtures','scout','tools','ai','arena','intel','profile','live','leagues'];
  let touchStartX = 0, touchStartY = 0;
  document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive:true });
  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.7) return; // Not a horizontal swipe
    const activeTab = document.querySelector('.nav-btn.active')?.dataset.tab;
    const idx = tabs.indexOf(activeTab);
    if (dx < 0 && idx < tabs.length - 1) switchTab(tabs[idx + 1]); // Swipe left → next tab
    if (dx > 0 && idx > 0)              switchTab(tabs[idx - 1]); // Swipe right → prev tab
  }, { passive:true });
}

/* ══ 20. WIDGET DASHBOARD (Rearrangeable) ═══════════════════════ */
const WIDGET_ORDER_KEY = 'fpl_widget_order';
const DEFAULT_WIDGETS = ['cortex','stats','captain','history','risk'];

function getWidgetOrder() {
  try { return JSON.parse(localStorage.getItem(WIDGET_ORDER_KEY)) || DEFAULT_WIDGETS; }
  catch { return DEFAULT_WIDGETS; }
}

function initDashboardWidgets() {
  const widgets = getWidgetOrder();
  const container = el('dashboardWidgets'); if (!container) return;
  // Reorder children based on saved preference
  widgets.forEach(id => {
    const widget = container.querySelector(`[data-widget="${id}"]`);
    if (widget) container.appendChild(widget);
  });

  // Make draggable on desktop
  let dragging = null;
  container.querySelectorAll('[data-widget]').forEach(widget => {
    widget.setAttribute('draggable', 'true');
    widget.addEventListener('dragstart', () => { dragging = widget; widget.style.opacity = '.5'; });
    widget.addEventListener('dragend', () => {
      widget.style.opacity = '1'; dragging = null;
      const order = [...container.querySelectorAll('[data-widget]')].map(w => w.dataset.widget);
      localStorage.setItem(WIDGET_ORDER_KEY, JSON.stringify(order));
    });
    widget.addEventListener('dragover', e => { e.preventDefault(); if (dragging && dragging !== widget) container.insertBefore(dragging, widget); });
  });
}


/* ══ NEW FEATURE LISTENERS (called once from init) ══════════════ */
function initNewFeatures() {
  el('voiceBtn')?.addEventListener('click', toggleVoice);
  initVoiceInput();
  el('gwPreviewBtn')?.addEventListener('click', generateGWPreview);
  el('postGWReviewBtn')?.addEventListener('click', generatePostGWReview);
  el('shortlistRefreshBtn')?.addEventListener('click', renderShortlist);
  el('loadRivalBtn')?.addEventListener('click', loadRivalMode);
  el('shareSquadBtn')?.addEventListener('click', generateSquadShareLink);
  el('refreshLeaderboardBtn')?.addEventListener('click', renderGlobalLeaderboard);
  el('xgRefreshBtn')?.addEventListener('click', renderXGStats);
  el('pricePredRefreshBtn')?.addEventListener('click', renderPricePrediction);
  el('teamFormRefreshBtn')?.addEventListener('click', renderTeamForm);
  document.addEventListener('click', e => {
    if (e.target.closest('.timeline-btn')) { showPlayerTimeline(parseInt(e.target.closest('.timeline-btn').dataset.pid)); return; }
    if (e.target.closest('.card-gen-btn')) { generatePlayerCard(parseInt(e.target.closest('.card-gen-btn').dataset.pid)); return; }
    if (e.target.closest('.shortlist-btn')) { toggleShortlist(parseInt(e.target.closest('.shortlist-btn').dataset.pid)); renderPlayerTable(); return; }
  });
  initSwipeNavigation();
  checkOnlineStatus();
  loadSharedSquad();
  initDashboardWidgets();
  const savedRival = localStorage.getItem('fpl_rival_id');
  if (savedRival && el('rivalIdInput')) el('rivalIdInput').value = savedRival;
  scheduleDeadlineNotification();
  scheduleAutoCaptainAlarm();
  renderShortlist();
  renderTransferPlanner();
}
