/**
 * FPL CORTEX — script.js (Complete)
 * 32 features active
 */
'use strict';

const TEAM_COLORS={1:'#EF0107',2:'#95BFE5',3:'#D71920',4:'#E30613',5:'#0057B8',
  6:'#034694',7:'#1B458F',8:'#274488',9:'#F5A12D',10:'#003090',11:'#00A650',
  12:'#C8102E',13:'#6CABDD',14:'#DA291C',15:'#241F20',16:'#D00027',17:'#D71920',
  18:'#132257',19:'#7A263A',20:'#FDB913'};
function teamColor(tid){return TEAM_COLORS[tid]||'#1e2a3d';}
function playerPhotoUrl(photo){
  if(!photo)return'';
  const code=photo.replace('.jpg','');
  return`https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`;
}


/* ══ KEYS ══════════════════════════════════════════════════════ */
// API keys moved to Vercel env vars — calls proxied via /api/ai and /api/weather

/* ══ PROXIES — PARALLEL RACE with timeout ═══════════════════════
   All proxies fire at once. First successful response wins.
   Each proxy times out after 8 seconds individually.
   This means total max wait = 8 seconds, not 4x8=32 seconds.
═══════════════════════════════════════════════════════════════ */
// ── FPL SERVICE LAYER ─────────────────────────────────────────
// All FPL requests go through /api/fpl — single source of truth
// Upstream FPL auth is held by the server-side HttpOnly Cortex session.
// Keep this legacy variable empty so older callers cannot accidentally persist credentials.
let _fplCookie = '';
function setFplCookie() { _fplCookie = ''; try { localStorage.removeItem('fpl_cookie'); } catch {} }
function loadFplCookie() { _fplCookie = ''; try { localStorage.removeItem('fpl_cookie'); } catch {} }
loadFplCookie();

async function fplFetch(path, requireAuth = false) {
  const url = `/api/fpl?path=${encodeURIComponent(path)}${requireAuth ? '&auth=1' : ''}`;
  const headers = { 'Content-Type': 'application/json' };
  if (requireAuth && _fplCookie) headers['x-fpl-cookie'] = _fplCookie;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(14000) });
    return res;
  } catch (err) {
    // Return a fake response object on network error
    return { ok: false, status: 0, json: async () => ({ error: err.message }) };
  }
}

async function fplPost(action, body = {}) {
  try {
    const res = await fetch('/api/fpl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(14000),
    });
    return res;
  } catch (err) {
    return { ok: false, status: 0, json: async () => ({ error: err.message }) };
  }
}

async function cortexApi(route, options = {}) {
  const response = await fetch(`/api/fpl?route=${encodeURIComponent(route.replace(/^\/+/, ''))}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = null;
  try { data = await response.json(); } catch { data = {}; }
  return { response, data, ok: response.ok && data?.ok !== false };
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
  fplEntryId:null, previewEntryId:null, previewPlayer:null, readOnlyPreview:false, fplPlayer:null, myLeagues:{classic:[],h2h:[]},
  gwHistory:null,
  currentLeagueId:null, currentLeagueType:'classic',
  actionPid:null, substitutionMode:false, swapPid:null, deferredInstall:null, notifEnabled:false, livePollInterval:null, liveSnapshot:null, liveNotifications:[], liveLastUpdated:null, theme:'dark',
  aiChatHistory:[],
  customKit:null,
  draftState:{ active:false, round:0, pickNumber:0, myPicks:[], aiPicks:[], available:[], watchlist:[], leagueSize:8, scoring:'classic' },
  deadlineInterval:null,
};
// Expose S globally so script-additions.js can access it
window.S = S;

/* ══ INIT (Speed Optimised) ═════════════════════════════════════
   Strategy:
   1. Show cached data INSTANTLY (no spinner delay)
   2. Fetch fresh data IN BACKGROUND
   3. Update UI silently when fresh data arrives
═══════════════════════════════════════════════════════════════ */
async function init() {
  // Always hide loading after 6s no matter what
  const _safety = setTimeout(hideLogo, 6000);
  try {
    loadStorage();
    void restoreFplConnection();
    applyTheme(S.theme);
    registerSW();
    setupPWA();
    startDeadlineTimer();
    try { attachListeners(); } catch(e) { console.warn('listeners:', e); }

    const bd = cGet('bootstrap'), fd = cGet('fixtures');

    if (bd && fd) {
      setLP(80, 'LOADING FROM CACHE...');
      S.allFixtures = fd; sortFix(); processBootstrap(bd);
        renderAll();
        if (S.previewEntryId) void restorePreviewEntry();
        setTimeout(hideLogo, 300);
      if (S.fplEntryId) { updateAccountUI(); fetchGWHistory(); }
        fetchLive(); startLivePolling(); checkPriceChanges();
      setTimeout(() => { try { renderSeasonPredictor(); renderMarketForecast(); } catch(e){} }, 400);
      document.dispatchEvent(new CustomEvent('fplDataReady'));
  // Render players if on that tab
  if (typeof currentTab !== 'undefined' && currentTab === 'players') {
    if (typeof renderPlayerTable === 'function') renderPlayerTable();
  }
  // Always populate player table data so it's ready
  if (typeof renderPlayerTable === 'function') setTimeout(renderPlayerTable, 100);
      setTimeout(() => { try { backgroundRefresh(); } catch(e){} }, 10000);
    } else {
      setLP(15, 'CONNECTING...');
      showSkeleton();
      try {
        setLP(30, 'FETCHING FPL DATA...');
        const [bR, fR] = await Promise.all([
          fplFetch('/bootstrap-static/'),
          fplFetch('/fixtures/'),
        ]);
        setLP(70, 'PROCESSING...');
        const [bd2, fd2] = await Promise.all([bR.json(), fR.ok ? fR.json() : []]);
        cSet('bootstrap', bd2); cSet('fixtures', fd2);
        S.allFixtures = fd2; sortFix();
        if (!processBootstrap(bd2)) { hideLogo(); return; }
        setLP(95, 'BUILDING...');
        renderAll();
        if (S.previewEntryId) void restorePreviewEntry();
        setTimeout(hideLogo, 200);
        if (S.fplEntryId) { updateAccountUI(); fetchGWHistory(); }
        fetchLive(); startLivePolling(); checkPriceChanges();
        setTimeout(() => { try { renderSeasonPredictor(); renderMarketForecast(); } catch(e){} }, 500);
        document.dispatchEvent(new CustomEvent('fplDataReady'));
      } catch(err) {
        console.error('Init fetch:', err);
        showLoadErr('Could not reach FPL API.<br><small>' + err.message + '</small><br><br>Check your internet connection.');
      }
    }
  } catch(err) {
    console.error('Init:', err);
    hideLogo();
  } finally {
    clearTimeout(_safety);
  }
}

function hideLogo() {
  try {
    const ls = el('loadingScreen'); if (!ls) return;
    ls.style.opacity = '0'; ls.style.transition = 'opacity .3s ease';
    setTimeout(() => { try { ls.remove(); } catch(e){} }, 320);
  } catch(e) { console.warn('hideLogo:', e); }
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
    const ei=g('fpl_entry_id'), pi=g('fpl_preview_entry_id'), pp=g('fpl_preview_player'), pl=g('fpl_player'), lg=g('fpl_leagues'), th=g('fpl_theme'), kit=g('fpl_kit');
    if(t) S.myTeam=JSON.parse(t); if(c) S.captainId=parseInt(c); if(v) S.vcaptainId=parseInt(v);
    if(po) S.pickOrder=JSON.parse(po); if(ei) S.fplEntryId=parseInt(ei); if(pi) { S.previewEntryId=parseInt(pi); S.readOnlyPreview=true; } if(pp) S.previewPlayer=JSON.parse(pp);
    if(pl) S.fplPlayer=JSON.parse(pl); if(lg) S.myLeagues=JSON.parse(lg);
    if(th) S.theme=th; if(kit) S.customKit=JSON.parse(kit);
    // A Cortex session is represented by the server's HttpOnly cookie, not localStorage.
    localStorage.removeItem('fpl_cookie');
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
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); S.theme = t; localStorage.setItem('fpl_theme', t); const b = el('themeBtn'); if (b) b.textContent = t === 'dark' ? '' : ''; }
function toggleTheme() { applyTheme(S.theme === 'dark' ? 'light' : 'dark'); }

/* ══ NOTIFICATIONS (#14) ════════════════════════════════════════ */
function openNotificationPanel(){const panel=el('notificationPanel');if(!panel)return;panel.classList.remove('hidden');panel.style.display='block';renderNotifications();}
function closeNotificationPanel(){const panel=el('notificationPanel');if(!panel)return;panel.classList.add('hidden');panel.style.display='none';}
function setNotificationState(){const state=el('notificationPermissionState'),button=el('notificationEnableBtn');const supported='Notification' in window;const granted=supported&&Notification.permission==='granted';if(state)state.textContent=granted&&S.notifEnabled?'Browser alerts on':supported?'Browser alerts off':'In-app alerts only';if(button){button.textContent=granted&&S.notifEnabled?'Mute alerts':supported?'Enable alerts':'In-app alerts';button.disabled=!supported&&S.notifEnabled;}}
async function requestBrowserNotifications(){if(!('Notification' in window)){setNotificationState();return;}if(Notification.permission==='granted'){S.notifEnabled=!S.notifEnabled;setNotificationState();return;}const permission=await Notification.requestPermission();S.notifEnabled=permission==='granted';setNotificationState();if(S.notifEnabled)sendBrowserNotification('FPL Cortex','Live FPL alerts are enabled.');}
function toggleNotifications(){const panel=el('notificationPanel');if(panel&&!panel.classList.contains('hidden'))closeNotificationPanel();else{openNotificationPanel();setNotificationState();}}
function sendBrowserNotification(title,body,key='live'){if(!S.notifEnabled||!('Notification' in window)||Notification.permission!=='granted')return;try{new Notification(title,{body,tag:key});}catch{}}
function pushLiveNotification(message,type='live',key=''){const item={message,type,key:key||`${Date.now()}-${message}`,time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})};if(S.liveNotifications.some(n=>n.key===item.key))return;S.liveNotifications=[item,...S.liveNotifications].slice(0,30);renderNotifications();sendBrowserNotification('FPL Cortex',message,item.key);const pip=el('notifPip');if(pip)pip.classList.add('show');}
function renderNotifications(){const list=el('notificationList');if(!list)return;if(!S.liveNotifications.length){list.innerHTML='<div class="notification-empty">Live points and bonus changes will appear here.</div>';return;}list.innerHTML=S.liveNotifications.map(n=>`<div class="notification-item notification-${n.type}"><span class="notification-item-time">${escapeHTML(n.time)}</span><strong>${escapeHTML(n.message)}</strong></div>`).join('');}
function processLiveNotifications(previous,current){const squad=myPlayers();if(!squad.length)return;for(const p of squad){const before=previous?.[p.id]?.stats||{},after=current?.[p.id]?.stats||{};const points=Number(after.total_points||0),oldPoints=Number(before.total_points||0),bonus=Number(after.bonus||0),oldBonus=Number(before.bonus||0);if(points>oldPoints)pushLiveNotification(`${p.web_name} is now on ${points} live points.`,'points',`points-${S.currentGW}-${p.id}-${points}`);if(bonus>oldBonus)pushLiveNotification(`${p.web_name} has ${bonus} provisional bonus point${bonus===1?'':'s'}.`,'bonus',`bonus-${S.currentGW}-${p.id}-${bonus}`);if(Number(after.minutes||0)>Number(before.minutes||0)&&Number(after.minutes||0)>=60&&Number(before.minutes||0)<60)pushLiveNotification(`${p.web_name} has reached 60 minutes for the extra appearance point.`,'milestone',`mins-${S.currentGW}-${p.id}-60`);}}
function checkPriceChanges(){const mp=myPlayers();const risers=mp.filter(p=>p.cost_change_event>0),fallers=mp.filter(p=>p.cost_change_event<0);if(risers.length)pushLiveNotification(`${risers.map(p=>p.web_name).join(', ')} rose in price.`,'market',`rise-${S.currentGW}-${risers.map(p=>p.id).join('-')}`);if(fallers.length)pushLiveNotification(`${fallers.map(p=>p.web_name).join(', ')} fell in price.`,'market',`fall-${S.currentGW}-${fallers.map(p=>p.id).join('-')}`);}

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
  msgs.innerHTML += `<div class="ai-msg ai-msg-user"><div class="ai-msg-avatar"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg></div><div class="ai-msg-bubble">${userMsg}</div></div>`;
  const thinkId = 'tk_' + Date.now();
  msgs.innerHTML += `<div class="ai-msg ai-msg-bot" id="${thinkId}"><div class="ai-msg-avatar"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg></div><div class="ai-msg-bubble" style="color:var(--text-sub)">Analysing...</div></div>`;
  msgs.scrollTop = msgs.scrollHeight;
  S.aiChatHistory.push({ role: 'user', content: userMsg });
  try {
    const sys = `You are an expert FPL analyst. Be direct, concise (under 150 words), data-driven. Use the squad context: ${buildSquadCtx()}`;
    const reply = await groqChat([{ role:'system', content:sys }, ...S.aiChatHistory.slice(-6)], 400);
    S.aiChatHistory.push({ role: 'assistant', content: reply });
    const tk = el(thinkId); if (tk) tk.outerHTML = `<div class="ai-msg ai-msg-bot"><div class="ai-msg-avatar"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg></div><div class="ai-msg-bubble">${reply.replace(/\n/g,'<br>')}</div></div>`;
  } catch (err) {
    const tk = el(thinkId); if (tk) tk.outerHTML = `<div class="ai-msg ai-msg-bot"><div class="ai-msg-avatar"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg></div><div class="ai-msg-bubble" style="color:var(--red)">AI unavailable: ${err.message}</div></div>`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

/* AI Transfer Debate (#17) */
async function runTransferDebate() {
  const out = (el('debatePlayerOut')?.value || '').trim(), inp = (el('debatePlayerIn')?.value || '').trim();
  const area = el('debateArea'); if (!area) return;
  if (!out || !inp) { area.innerHTML = emptyState('', 'ENTER A TRANSFER', 'Type two player names.'); return; }
  area.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-sub)">Generating debate...</div>`;
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
      <div class="debate-card debate-for"><div class="debate-label">FOR THE TRANSFER</div><div class="debate-text">${forPts.map(p=>`• ${p}`).join('<br>') || reply.slice(0,120)}</div></div>
      <div class="debate-card debate-against"><div class="debate-label">AGAINST THE TRANSFER</div><div class="debate-text">${againstPts.map(p=>`• ${p}`).join('<br>')||'Hold and monitor'}</div></div>
      ${verdict ? `<div style="background:var(--amber-glow);border:1px solid var(--amber);border-radius:var(--radius);padding:.65rem .85rem;font-size:.82rem;margin-top:.5rem"><strong>VERDICT:</strong> ${verdict}</div>` : ''}`;
  } catch (err) { area.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:.82rem">AI unavailable: ${err.message}</div>`; }
}

/* ══ LISTENERS ══════════════════════════════════════════════════ */
function attachListeners() {
  const safe = (fn) => { try { fn(); } catch(e) { console.warn('listener err:', e); } };
  const on = (id, ev, fn) => { try { el(id)?.addEventListener(ev, fn); } catch(e) {} };
  // nav-btn handled by goTab() in index.html
  
  el('themeBtn')?.addEventListener('click', toggleTheme); el('notifBtn')?.addEventListener('click', toggleNotifications); el('notificationClose')?.addEventListener('click', closeNotificationPanel); el('notificationEnableBtn')?.addEventListener('click', requestBrowserNotifications); setNotificationState();
  // installBtn handled in index.html inline script
  el('loginModalClose')?.addEventListener('click', closeModal);
  
  el('companionConnectBtn')?.addEventListener('click', startCompanionConnection);
  el('companionConfirmBtn')?.addEventListener('click', confirmCompanionConnection);
  window.addEventListener('message', handleCompanionMessage);
  el('fplChallengeBtn')?.addEventListener('click', verifyFplChallenge);
  el('fplPasscodeInput')?.addEventListener('keydown', e => { if(e.key==='Enter') verifyFplChallenge(); });
  el('teamIdConnectBtn')?.addEventListener('click', connectTeamIdPreview);
  el('teamIdInput')?.addEventListener('keydown', e => { if(e.key==='Enter') connectTeamIdPreview(); });
  el('loginModeCompanion')?.addEventListener('click', () => toggleLoginMode('companion'));
  el('loginModeTeam')?.addEventListener('click', () => toggleLoginMode('team'));
  el('teamBackBtn')?.addEventListener('click', () => toggleLoginMode('companion'));
  el('managerSearchBtn')?.addEventListener('click', searchManager);
  el('managerSearch')?.addEventListener('keydown', e => { if(e.key==='Enter') searchManager(); });
  el('squadDraftSearch')?.addEventListener('input', renderDraftBuilder);
  el('squadDraftPosition')?.addEventListener('change', renderDraftBuilder);
  el('validateSquadBtn')?.addEventListener('click', () => renderSquadValidation(true));
  el('saveDraftBtn')?.addEventListener('click', saveDraftSquad);
  el('analyseSquadBtn')?.addEventListener('click', analyseDraftSquad);
  el('syncSquadBtn')?.addEventListener('click', submitDraftToFpl);
  el('captainBtn')?.addEventListener('click', autoPickCaptain);
  el('dashImportBtn')?.addEventListener('click', importFplTeam);
  el('dashLogoutBtn')?.addEventListener('click', logout);
  el('playersRefreshBtn')?.addEventListener('click', refreshData); el('fixturesRefreshBtn')?.addEventListener('click', renderFixtures); el('transfersRefreshBtn')?.addEventListener('click', renderTransfers); el('intelRefreshBtn')?.addEventListener('click', loadNewsFeed); el('leaguesRefreshBtn')?.addEventListener('click', renderLeaguesTab);
  el('playerSearch')?.addEventListener('input', filterPlayers);
  el('posFilter')?.addEventListener('change', filterPlayers);
  el('teamFilter')?.addEventListener('change', filterPlayers);
  el('sortBy')?.addEventListener('change', filterPlayers);
  el('clearTeamBtn')?.addEventListener('click', clearTeam);
  el('addPlayersBtn')?.addEventListener('click', () => window.goTab?.('players'));
  el('autoPickSquadBtn')?.addEventListener('click', autoPickSquad);
  el('importFplTeamBtn')?.addEventListener('click', importFplTeam);
  el('kitDesignerBtn')?.addEventListener('click', () => { const p = el('kitDesignerSection'); if (p) p.style.display = p.style.display === 'none' ? '' : 'none'; });
  el('applyKitBtn')?.addEventListener('click', applyCustomKit);
  el('kitResetBtn')?.addEventListener('click', () => { S.customKit = null; localStorage.removeItem('fpl_kit'); renderMyTeam(); });
  el('substituteModeBtn')?.addEventListener('click', toggleSubstitutionMode);
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
  el('leagueListArea')?.addEventListener('click', e => { const i=e.target.closest('.league-item'); if(i) loadStandings(+i.dataset.lid,'classic',i.dataset.name); });
  el('leagueListArea')?.addEventListener('click', e => { const i=e.target.closest('.league-item'); if(i) loadStandings(+i.dataset.lid,'h2h',i.dataset.name); });
  el('standingsPagination')?.addEventListener('click', e => { const b=e.target.closest('.page-btn'); if(b) loadStandings(S.currentLeagueId,S.currentLeagueType,null,+b.dataset.page); });
  el('diffPosFilter')?.addEventListener('change', renderDifferentials);
  el('diffSortFilter')?.addEventListener('change', renderDifferentials);
  el('compareBtn')?.addEventListener('click', renderComparison);
  el('autoBuilderBtn')?.addEventListener('click', runAutoBuilder);
  el('wildcardBtn')?.addEventListener('click', runWildcard);
  el('predictorBtn')?.addEventListener('click', renderPredictor);
  el('chartTogglePts')?.addEventListener('click', () => showHistoryChart('points'));
  el('chartToggleRank')?.addEventListener('click', () => showHistoryChart('rank'));
  el('aiSendBtn')?.addEventListener('click', () => { const v=el('aiMsgInput')?.value||''; if(el('aiMsgInput'))el('aiMsgInput').value=''; sendAIChat(v); });
  el('aiMsgInput')?.addEventListener('keydown', e => { if(e.key==='Enter'&&e.target.value.trim()) { const v=e.target.value; e.target.value=''; sendAIChat(v); }});
  el('debateBtn')?.addEventListener('click', runTransferDebate);
  document.querySelectorAll('.ai-suggest-btn').forEach(b => b.addEventListener('click', () => sendAIChat(b.dataset.q)));
  el('loadRivalBtn')?.addEventListener('click', runBattle);
  el('loadTemplateBtn')?.addEventListener('click', runTemplateDetector);
  el('warRoomBtn')?.addEventListener('click', runWarRoom);
  el('startDraftBtn')?.addEventListener('click', startDraft);
  el('draftResetBtn')?.addEventListener('click', resetDraft);
  el('draftSearch')?.addEventListener('input', renderDraftList);
  el('draftPosFilter')?.addEventListener('change', renderDraftList);
  el('draftScoring')?.addEventListener('change', () => { if(!S.draftState.active) renderDraftArea(); });
  el('draftLeagueSize')?.addEventListener('change', () => { if(!S.draftState.active) renderDraftArea(); });
  el('newsRefreshBtn')?.addEventListener('click', loadNewsFeed);
  el('diarySaveBtn')?.addEventListener('click', saveDiaryEntry);
  document.addEventListener('click', handleGlobalClick);
  // Wire up new feature buttons (GW Preview, Post-GW Review, Rival Mode, etc.)
  initNewFeatures();
}

function handleGlobalClick(e) {
  const addBtn = e.target.closest('.add-btn');
  if (addBtn && !addBtn.disabled) { const pid = parseInt(addBtn.dataset.pid); if (!isNaN(pid)) { togglePlayer(pid); return; } }
  const removeBtn = e.target.closest('.remove-btn');
  if (removeBtn) { const pid = parseInt(removeBtn.dataset.pid); if (!isNaN(pid)) { removeFromTeam(pid); return; } }
  const pitchCard = e.target.closest('.pitch-card[data-pid]');
  if (pitchCard) { const pid = parseInt(pitchCard.dataset.pid); if (!isNaN(pid)) { if (S.substitutionMode) { if (S.swapPid === pid) { S.swapPid = null; updateSubstitutionUI(); } else if (S.swapPid) { swapSquadPlayers(S.swapPid, pid); } else { S.swapPid = pid; updateSubstitutionUI(); } } else { openActionSheet(pid); } return; } }
  const capCard = e.target.closest('.captain-card[data-pid]');
  if (capCard) { setCaptain(parseInt(capCard.dataset.pid), parseInt(capCard.dataset.rank)); return; }
  const draftWatchBtn = e.target.closest('.draft-watch-btn');
  if (draftWatchBtn) { toggleDraftWatchlist(parseInt(draftWatchBtn.dataset.pid)); return; }
  const draftRoomBtn = e.target.closest('.draft-pick-btn');
  if (draftRoomBtn) { pickDraftPlayer(parseInt(draftRoomBtn.dataset.pid)); return; }
  const timelineBtn = e.target.closest('.timeline-btn');
  if (timelineBtn) { showPlayerTimeline(parseInt(timelineBtn.dataset.pid)); return; }
  const cardGenBtn = e.target.closest('.card-gen-btn');
  if (cardGenBtn) { generatePlayerCard(parseInt(cardGenBtn.dataset.pid)); return; }
  const shortlistBtn = e.target.closest('.shortlist-btn');
  if (shortlistBtn) { toggleShortlist(parseInt(shortlistBtn.dataset.pid)); renderPlayerTable(); return; }
}

/* ══ LOADING ════════════════════════════════════════════════════ */
function setLP(p, m) { const b=el('loadingBar'), t=el('loadingMsg'); if(b) b.style.width=p+'%'; if(t&&m) t.textContent=m; }
function showLoadErr(msg) { const ls=el('loadingScreen'); if(!ls)return; ls.innerHTML=`<div class="loading-logo">FPL <span>CORTEX</span></div><div style="color:var(--red);font-family:var(--font-data);font-size:.78rem;margin-top:1rem;text-align:center;max-width:300px;line-height:1.8">${msg}</div><button id="retryBtn" class="btn btn-green btn-sm" style="margin-top:1.5rem">Refresh RETRY</button>`; el('retryBtn')?.addEventListener('click', () => location.reload()); }

/* ══ DATA ═══════════════════════════════════════════════════════ */
function sortFix() { S.allFixtures.sort((a,b)=>{ const ea=a.event||99,eb=b.event||99; return ea!==eb?ea-eb:(a.finished?1:0)-(b.finished?1:0); }); }

function processBootstrap(data) {
  try {
    if (!data || !Array.isArray(data.teams) || !Array.isArray(data.elements) || !Array.isArray(data.events)) {
      throw new Error('FPL_SCHEMA_CHANGED');
    }
    S.bootstrap = data;
    S.teams = {};
    S.positions = {};
    data.teams.forEach(t => { S.teams[t.id] = t; });
    (data.element_types || []).forEach(et => { S.positions[et.id] = { short: et.singular_name_short }; });
    // `elements` is the season-wide public player source and must never depend on auth.
    S.players = data.elements.map(processPlayer);
    const cur = data.events.find(e => e.is_current), nxt = data.events.find(e => e.is_next);
    S.currentGW = cur ? cur.id : (nxt ? Math.max(0, nxt.id - 1) : 0);
    S.nextGW = nxt ? nxt.id : data.events.find(e => !e.finished)?.id || null;
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

async function fetchLive({silent=false}={}) {
  const btn = el('liveRefreshBtn'); if (btn&&!silent) btn.classList.add('spinning');
  const gw = S.currentGW||S.nextGW; if (!gw) { if(btn&&!silent)btn.classList.remove('spinning'); return; }
  try {
    const res = await fplFetch(`/event/${gw}/live/`); if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json(); const map = {};
    for (const e of (raw.elements||[])) map[e.id] = e;
    processLiveNotifications(S.liveData,map); S.liveData = map; S.liveLastUpdated = Date.now(); renderLivePanel(); renderMyTeam();
    const badge = el('liveUpdateBadge'); if(badge){const n=new Date(); badge.textContent=`Updated ${pad(n.getHours())}:${pad(n.getMinutes())}`;}
    setText('liveStatusLabel', 'Live data · updates every 45s');
  } catch (err) { if(!S.liveData)setHTML('livePlayerList', emptyState('◎','NO LIVE DATA','Live player points appear during active gameweeks.')); setText('liveStatusLabel','Live data unavailable'); }
  if (btn&&!silent) { btn.classList.remove('spinning'); btn.textContent='Refresh live'; }
}
function startLivePolling(){if(S.livePollInterval)clearInterval(S.livePollInterval);S.livePollInterval=setInterval(()=>{if(document.visibilityState!=='hidden')fetchLive({silent:true});},45000);}
function stopLivePolling(){if(S.livePollInterval){clearInterval(S.livePollInterval);S.livePollInterval=null;}}

async function refreshData() {
  cClear('bootstrap'); cClear('fixtures');
  const btn = el('refreshBtn'); if(btn) btn.classList.add('spinning');
  try {
    const [bR,fR] = await Promise.all([fplFetch('/bootstrap-static/'), fplFetch('/fixtures/')]);
    const bd=await bR.json(), fd=fR.ok?await fR.json():[];
    cSet('bootstrap',bd); cSet('fixtures',fd); S.allFixtures=fd; sortFix(); processBootstrap(bd); renderAll();
  } catch(err) { console.error('Refresh:',err); }
  if(btn) { btn.classList.remove('spinning'); btn.textContent='Refresh REFRESH'; }
}

function renderAll() {
  try {
    renderDashboard(); 
    try { renderPlayerTable(); } catch(e) {}
    try { renderMyTeam(); } catch(e) {}
    try { renderTransfers(); } catch(e) {}
    try { renderTransferTargets(); } catch(e) {}
    try { renderFixtureGwSelect(); } catch(e) {}
    try { renderFixtures(); } catch(e) {}
    try { renderFDRCalendar(); } catch(e) {}
    try { renderBlankDouble(); } catch(e) {}
    try { renderPriceChanges(); } catch(e) {}
    try { renderDifferentials(); } catch(e) {}
    try { renderDNAChart(); } catch(e) {}
    try { renderChallenges(); } catch(e) {}
    try { updateCortexScore(); } catch(e) {}
  } catch(e) { console.warn('renderAll:', e); }
}

/* ══ TAB NAV ════════════════════════════════════════════════════ */
function switchTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id===`tab-${name}`));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Sync bottom nav
  if (window.upgrades?.syncBottomNavExternal) window.upgrades.syncBottomNavExternal(name);
  const map = {
    myteam:    () => renderMyTeam(),
    transfers: () => renderTransfers(),
    fixtures:  () => { renderFixtures(); renderFDRCalendar(); renderBlankDouble(); },
    scout:     () => { renderPriceChanges(); renderDifferentials(); renderXGStats(); renderPricePrediction(); renderTeamForm(); },
    draft:     () => { renderDraftArea(); renderDraftList(); },
    tools:     () => { renderChipPlanner(); renderInjuryRisk(); renderSeasonPredictor(); renderTransferPlanner(); renderTransferTargets();
                       setTimeout(() => window.upgrades?.renderGWPlanner?.(), 50); },
    intel:     () => { loadNewsFeed(); loadWeather(); renderMarketForecast();
                       setTimeout(() => window.upgrades?.renderAlerts?.(), 50); },
    profile:   () => { renderDNAChart(); renderChallenges(); loadDiaryHistory();
                       setText('diaryGwLabel',`GW ${S.currentGW||'—'}`);
                       setTimeout(() => window.upgrades?.renderCaptainHistory?.(), 50); },
    live:      () => { renderLivePanel();
                       setTimeout(() => window.upgrades?.renderSimulator?.(), 50); },
    leagues:   () => { renderLeaguesTab();
                       setTimeout(() => window.upgrades?.renderLeagueSeasonGraphs?.(), 200); },
    dashboard: () => renderDashboard(),
  };
  map[name]?.();
}
// Expose switchTab globally so script-additions.js uses the same one
window.switchTab = switchTab;
window.goTab = window.goTab || switchTab;

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
  renderPublicPulse();
}

function renderPublicPulse() {
  const events = Array.isArray(S.bootstrap?.events) ? S.bootstrap.events : [];
  const next = events.find(e => e.is_next) || events.find(e => !e.finished);
  const current = events.find(e => e.is_current);
  const topForm = [...(S.players || [])].filter(p => Number(p.formVal) > 0).sort((a,b) => Number(b.formVal) - Number(a.formVal))[0];
  const nextFixture = (S.allFixtures || []).find(f => Number(f.event) === Number(next?.id) && !f.finished);
  const fixtureText = nextFixture ? `${S.teams[nextFixture.team_h]?.short_name || '?'} v ${S.teams[nextFixture.team_a]?.short_name || '?'}` : 'Fixtures loading';
  const fixtureDifficulty = nextFixture ? Math.max(Number(nextFixture.team_h_difficulty || 0), Number(nextFixture.team_a_difficulty || 0)) : 0;
  const deadline = next?.deadline_time ? new Date(next.deadline_time) : null;
  const deadlineText = deadline && !Number.isNaN(deadline.getTime()) ? deadline.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '—';
  const deadlineMeta = deadline && !Number.isNaN(deadline.getTime()) ? deadline.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : 'Schedule unavailable';
  setText('publicDeadline', deadlineText);
  setText('publicDeadlineMeta', deadlineMeta);
  setText('publicGWAverage', current?.average_entry_score ?? '—');
  setText('publicGWAverageMeta', current ? `GW ${current.id} average` : 'Current gameweek');
  setText('publicTopForm', topForm?.web_name || '—');
  setText('publicTopFormMeta', topForm ? `${topForm.formVal.toFixed(1)} form · ${topForm.teamShort}` : 'Public player data');
  setText('publicFixtureWatch', fixtureText);
  setText('publicFixtureMeta', nextFixture ? `GW ${nextFixture.event} · difficulty ${fixtureDifficulty || '—'}` : 'Next gameweek');
  setText('publicPulseStatus', next ? 'Live data' : 'Waiting for data');
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
  const sub = total>=85?'Elite Squad ':total>=70?'Strong Team ':total>=55?'Decent Squad ':total>=40?'Needs Work ':'Struggling ';
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
  if(!pool.length){setHTML('captainArea',emptyState('','NO SQUAD','Add players first.'));return;}
  const ranked=[...pool].sort((a,b)=>capScore(b)-capScore(a)).slice(0,3);
  setHTML('captainArea',`<div class="captain-cards">${ranked.map((p,i)=>{const fix=p.upcomingFixtures[0];const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} GW${fix.gw} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'No fixture';return`<div class="captain-card ${i===0?'rank-1':''}" data-pid="${p.id}" data-rank="${i}"><div class="cc-name">${p.web_name}</div><div class="cc-team">${p.teamShort}·${p.posShort}</div><div class="cc-ep">${Math.round(p.projectedPts*(i===0?2:1)*10)/10}</div><div class="cc-score">Next: ${fixStr}</div><div style="margin-top:5px;font-family:var(--font-data);font-size:.58rem;color:var(--text-sub)">Form ${p.form}·£${p.price}m·${p.selected_by_percent}% own</div>${i===0&&p.id===S.captainId?'<div class="card-badge badge-amber" style="margin-top:5px;display:inline-block"> SET</div>':''}${i===1&&p.id===S.vcaptainId?'<div class="card-badge badge-blue" style="margin-top:5px;display:inline-block">V SET</div>':''}</div>`;}).join('')}</div>`);
}
function setCaptain(pid,rank){
  if(rank===0){S.captainId=S.captainId===pid?null:pid;S.captainId?localStorage.setItem('fpl_captain',pid):localStorage.removeItem('fpl_captain');}
  if(rank===1){S.vcaptainId=S.vcaptainId===pid?null:pid;S.vcaptainId?localStorage.setItem('fpl_vcaptain',pid):localStorage.removeItem('fpl_vcaptain');}
  const{starters}=getSquadGroups();renderCaptainSuggestions(starters.length?starters:myPlayers());renderMyTeam();renderDashboard();
}
function autoPickCaptain(){const{starters}=getSquadGroups();const pool=starters.length?starters:myPlayers();if(!pool.length)return;const r=[...pool].sort((a,b)=>capScore(b)-capScore(a));S.captainId=r[0]?.id||null;S.vcaptainId=r[1]?.id||null;saveTeam();renderCaptainSuggestions(pool);renderMyTeam();renderDashboard();}

function autoPickSquad(){
  const rules=squadRules();
  if(!S.players.length){setText('squadDraftNotice','Player data is still loading. Try Auto Pick again in a moment.');return;}
  const required={GKP:2,DEF:5,MID:5,FWD:3};
  const score=p=>Number(p.projectedPts||0)*2.6+Number(p.formVal||0)*1.2+Math.max(0,5-Number(p.avgFDR||3))*1.5+(Number(p.total_points||0)/250)+Math.max(0,2.5-Number(p.price||0))*0.35;
  const candidates=S.players.filter(p=>p.status==='a'&&required[p.posShort]&&p.price>0);
  const build=(ranking)=>{
    const selected=[],clubs={};
    const add=(p)=>{
      if(!p||selected.some(x=>x.id===p.id)||selected.length>=rules.squadSize)return false;
      if((clubs[p.team]||0)>=rules.maxPerClub)return false;
      const spent=selected.reduce((sum,x)=>sum+x.price,0);
      if(spent+p.price>rules.budget)return false;
      selected.push(p);clubs[p.team]=(clubs[p.team]||0)+1;return true;
    };
    for(const pos of Object.keys(required)){
      const pool=candidates.filter(p=>p.posShort===pos).sort(ranking);
      for(const p of pool){if(selected.filter(x=>x.posShort===pos).length>=required[pos])break;add(p);}
    }
    return selected;
  };
  let selected=build((a,b)=>(score(b)/Math.max(.1,b.price))-(score(a)/Math.max(.1,a.price)));
  if(selected.length<rules.squadSize)selected=build((a,b)=>(a.price-b.price)||((score(b))-(score(a))));
  if(selected.length<rules.squadSize){setText('squadDraftNotice',`Auto Pick found ${selected.length}/15 players within the current constraints. Try again after the next data refresh.`);return;}
  const byPos={GKP:selected.filter(p=>p.posShort==='GKP'),DEF:selected.filter(p=>p.posShort==='DEF'),MID:selected.filter(p=>p.posShort==='MID'),FWD:selected.filter(p=>p.posShort==='FWD')};
  const starters=[...byPos.GKP.slice(0,1),...byPos.DEF.slice(0,4),...byPos.MID.slice(0,4),...byPos.FWD.slice(0,2)];
  const ordered=[...starters,...selected.filter(p=>!starters.includes(p))];
  S.myTeam=selected.map(p=>p.id);S.pickOrder={};ordered.forEach((p,i)=>{S.pickOrder[p.id]=i+1;});
  const ranked=[...starters].sort((a,b)=>capScore(b)-capScore(a));S.captainId=ranked[0]?.id||null;S.vcaptainId=ranked[1]?.id||null;
  saveTeam();renderAll();setText('squadDraftNotice',`Auto Pick built a balanced 15 with a 4-4-2 starting shape. Review the XI before saving.`);window.goTab?.('myteam');
}

/* ══ RISK ═══════════════════════════════════════════════════════ */
function getRisk(p){const risks=[],avgMins=p.minutes/Math.max(1,S.currentGW||1);if(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<75)risks.push({level:'high',reason:`${p.chance_of_playing_next_round}% chance`});else if(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<100)risks.push({level:'medium',reason:`Slight doubt`});if(p.formVal===0&&p.total_points>0)risks.push({level:'high',reason:'Zero form'});else if(p.formVal<2&&p.total_points>0)risks.push({level:'medium',reason:`Poor form ${p.form}`});if(p.avgFDR>=4.5)risks.push({level:'high',reason:`Brutal FDR ${p.avgFDR.toFixed(1)}`});else if(p.avgFDR>=3.8)risks.push({level:'medium',reason:`Tough FDR ${p.avgFDR.toFixed(1)}`});if(avgMins<45)risks.push({level:'medium',reason:`Rotation risk`});return risks;}
function renderRiskAnalysis(mp){if(!mp.length){setHTML('riskArea',`<div class="card">${emptyState('','NO SQUAD DATA','Build your team.')}</div>`);return;}const flagged=mp.map(p=>({p,r:getRisk(p)})).filter(x=>x.r.length).sort((a,b)=>(b.r[0].level==='high'?2:1)-(a.r[0].level==='high'?2:1));if(!flagged.length){setHTML('riskArea',`<div class="card">${emptyState('','ALL CLEAR','No risk flags.')}</div>`);return;}setHTML('riskArea',`<div class="card">${flagged.map(({p,r})=>`<div class="risk-item"><div class="risk-bar ${r[0].level==='high'?'risk-high':'risk-medium'}"></div><div><div style="font-weight:700">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div>${r.map(x=>`<div class="risk-reason">${x.reason}</div>`).join('')}</div><div style="margin-left:auto;text-align:right"><div class="stat-label" style="font-size:.56rem">FORM</div><div style="font-family:var(--font-data);font-size:.88rem;color:${r[0].level==='high'?'var(--red)':'var(--amber)'}">${p.form}</div></div></div>`).join('')}</div>`);}

/* ══ PLAYER TABLE ═══════════════════════════════════════════════ */
function filterPlayers(){S.page=1;renderPlayerTable();}
function renderPlayerTable(){
  const _ptbody=el('playerTableBody');
  if(!_ptbody)return;
  if(!S.players||!S.players.length){
    _ptbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--t-mid);font-size:.82rem">Loading players...</td></tr>';
    return;
  }
  if(!S.players.length)return;
  const search=(el('playerSearch')?.value||'').toLowerCase(),posF=el('posFilter')?.value||'',teamF=el('teamFilter')?.value||'',sortKey=el('sortBy')?.value||'total_points';
  const tf=el('teamFilter');if(tf&&tf.options.length===1){Object.values(S.teams).sort((a,b)=>a.name.localeCompare(b.name)).forEach(t=>{const o=document.createElement('option');o.value=t.name;o.textContent=t.name;tf.appendChild(o);});}
  let list=S.players.filter(p=>{const nm=`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase();return(!search||nm.includes(search)||p.teamName.toLowerCase().includes(search))&&(!posF||p.posShort===posF)&&(!teamF||p.teamName===teamF);}).sort((a,b)=>(parseFloat(b[sortKey])||0)-(parseFloat(a[sortKey])||0));
  S.filteredPlayers=list;const total=list.length,pages=Math.ceil(total/S.pageSize);
  const slice=list.slice((S.page-1)*S.pageSize,S.page*S.pageSize);
  setText('squadIndicator',S.myTeam.length);
  const tbody=el('playerTableBody');if(!tbody)return;
  tbody.innerHTML=!slice.length?`<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-sub)">No players match.</td></tr>`:slice.map(p=>{
    const inTeam=S.myTeam.includes(p.id),full=!inTeam&&S.myTeam.length>=15;
    const formCls=p.formVal>=6?'form-hi':p.formVal>=3?'form-mid':'form-lo';
    const risks=getRisk(p),flag=risks.length?`<span>${risks[0].level==='high'?'':''}</span>`:'';
    const avail=(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<100)?`<div class="news-banner">${p.news||p.chance_of_playing_next_round+'%'}</div>`:'';
    const priceChg=p.cost_change_event>0?'<span style="color:var(--green);font-size:.6rem">▲</span>':p.cost_change_event<0?'<span style="color:var(--red);font-size:.6rem">▼</span>':'';
    const starred = isShortlisted(p.id);
    return`<tr><td><div class="player-name">${p.web_name} ${flag}${priceChg}</div><div class="player-sub">${p.teamShort}</div>${avail}</td><td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td><td><span class="price-val">£${p.price.toFixed(1)}</span></td><td><span class="form-val ${formCls}">${p.form}</span></td><td><span class="pts-val">${p.total_points}</span></td><td><span class="ep-val">${p.ep_next||'—'}</span></td><td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td><td style="display:flex;gap:3px;align-items:center"><button class="shortlist-btn" data-pid="${p.id}" style="background:none;border:none;font-size:.9rem;cursor:pointer;padding:2px;opacity:${starred?1:.3}" title="${starred?'Remove from':'Add to'} shortlist">${starred?'':''}</button><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''}>${inTeam?'':'＋'}</button></td></tr>`;
  }).join('');
  const pag=el('playerPagination');if(!pag)return;if(pages<=1){pag.innerHTML='';return;}
  let ph='';if(S.page>1)ph+=`<button class="page-btn" data-p="${S.page-1}">‹</button>`;
  for(let i=Math.max(1,S.page-2);i<=Math.min(pages,S.page+2);i++)ph+=`<button class="page-btn ${i===S.page?'active':''}" data-p="${i}">${i}</button>`;
  if(S.page<pages)ph+=`<button class="page-btn" data-p="${S.page+1}">›</button>`;
  ph+=`<span style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-left:.4rem">${total} players</span>`;
  pag.innerHTML=ph;pag.querySelectorAll('.page-btn').forEach(b=>b.addEventListener('click',()=>{S.page=parseInt(b.dataset.p);renderPlayerTable();}));
}

/* ══ MY TEAM / PRE-SEASON BUILDER ═══════════════════════════════ */
function squadRules() {
  const source = S.bootstrap?.game_config?.rules || S.bootstrap?.game_settings || {};
  const findNumber = (keys, fallback) => {
    for (const key of keys) {
      const value = Number(source?.[key] ?? source?.squad?.[key] ?? source?.squad_rules?.[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return fallback;
  };
  return {
    budget: findNumber(['budget', 'squad_budget'], 100),
    squadSize: findNumber(['squad_size', 'squadSize'], 15),
    maxPerClub: findNumber(['squad_team_limit', 'max_players_per_team'], 3),
    positions: { GKP: 2, DEF: 5, MID: 5, FWD: 3 },
  };
}

function validateSquad() {
  const rules = squadRules();
  const selected = S.myTeam.map(id => S.players.find(player => player.id === id)).filter(Boolean);
  const errors = [], warnings = [];
  const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const clubs = {};
  selected.forEach(player => { counts[player.posShort] = (counts[player.posShort] || 0) + 1; clubs[player.team] = (clubs[player.team] || 0) + 1; });
  if (selected.length !== rules.squadSize) errors.push(`${selected.length} players selected; ${rules.squadSize} required`);
  Object.entries(rules.positions).forEach(([position, required]) => { if (counts[position] !== required) errors.push(`${position}: ${counts[position] || 0}/${required} selected`); });
  Object.entries(clubs).filter(([, count]) => count > rules.maxPerClub).forEach(([club, count]) => errors.push(`Maximum club allocation exceeded (${club}: ${count}/${rules.maxPerClub})`));
  const spent = selected.reduce((sum, player) => sum + player.price, 0);
  if (spent > rules.budget + 0.001) errors.push(`Budget exceeded by £${(spent - rules.budget).toFixed(1)}m`);
  const { starters } = getSquadGroups();
  if (selected.length >= rules.squadSize && starters.length !== 11) errors.push(`${starters.length} starters selected; 11 required`);
  if (selected.length >= rules.squadSize && (!S.captainId || !starters.some(player => player.id === S.captainId))) errors.push('Captain must be selected from the starting XI');
  if (selected.length >= rules.squadSize && (!S.vcaptainId || !starters.some(player => player.id === S.vcaptainId))) errors.push('Vice captain must be selected from the starting XI');
  if (S.captainId && S.captainId === S.vcaptainId) errors.push('Captain and vice captain must be different players');
  selected.filter(player => player.news || (player.chance_of_playing_next_round !== null && player.chance_of_playing_next_round < 100)).forEach(player => warnings.push(`${player.web_name} has an availability note`));
  return { valid: errors.length === 0, budget: { spent: Number(spent.toFixed(1)), remaining: Number((rules.budget - spent).toFixed(1)), limit: rules.budget }, errors, warnings, counts, selected, starters };
}

function renderSquadValidation(force = false) {
  const area = el('squadValidation');
  if (!area) return;
  const result = validateSquad();
  if (!force && !S.myTeam.length) { area.innerHTML = '<span class="draft-muted">Select players to validate the squad.</span>'; return result; }
  area.innerHTML = `<div class="draft-validation ${result.valid ? 'is-valid' : 'has-errors'}"><strong>${result.valid ? 'VALID SQUAD' : 'NEEDS ATTENTION'}</strong><span>£${result.budget.spent.toFixed(1)}m / £${result.budget.limit.toFixed(1)}m</span><span>${result.selected.length}/${squadRules().squadSize} players</span></div>${result.errors.length ? `<div class="draft-errors">${result.errors.map(error => `<div>• ${error}</div>`).join('')}</div>` : ''}${result.warnings.length ? `<div class="draft-warnings">${result.warnings.slice(0, 3).map(warning => `<div>• ${warning}</div>`).join('')}</div>` : ''}`;
  return result;
}

function renderDraftBuilder() {
  const area = el('draftPickerList');
  if (!area || !S.players.length) return;
  const query = (el('squadDraftSearch')?.value || '').trim().toLowerCase();
  const position = el('squadDraftPosition')?.value || '';
  const players = S.players.filter(player => {
    const text = `${player.web_name} ${player.first_name} ${player.second_name} ${player.teamName}`.toLowerCase();
    return (!query || text.includes(query)) && (!position || player.posShort === position);
  }).sort((a, b) => b.projectedPts - a.projectedPts).slice(0, 32);
  area.innerHTML = players.length ? players.map(player => {
    const selected = S.myTeam.includes(player.id);
    const disabled = !selected && S.myTeam.length >= squadRules().squadSize;
    return `<button type="button" class="draft-player-row ${selected ? 'is-selected' : ''} draft-add-btn" data-pid="${player.id}" ${disabled ? 'disabled' : ''}><span><strong>${player.web_name}</strong><small>${player.teamShort} · ${player.posShort} · £${player.price.toFixed(1)}m</small></span><span class="draft-player-metrics">${player.form || '0'} form · ${player.ep_next || '—'} xP</span><span class="draft-player-action">${selected ? '' : '+'}</span></button>`;
  }).join('') : '<div class="draft-muted">No players match the current filters.</div>';
  area.querySelectorAll('.draft-add-btn').forEach(button => button.addEventListener('click', () => togglePlayer(parseInt(button.dataset.pid))));
  renderSquadValidation();
}

function saveDraftSquad() {
  const result = validateSquad();
  const draft = { season: S.bootstrap?.season || 'current', status: result.valid ? 'DRAFT_VALID' : 'DRAFT_INCOMPLETE', playerIds: [...S.myTeam], captainId: S.captainId, viceCaptainId: S.vcaptainId, pickOrder: { ...S.pickOrder }, updatedAt: new Date().toISOString() };
  localStorage.setItem('fpl_cortex_draft', JSON.stringify(draft));
  const area = el('squadDraftNotice');
  if (area) area.textContent = result.valid ? 'Draft saved locally and ready for analysis.' : 'Draft saved locally. Finish the highlighted validation items before syncing.';
  renderSquadValidation(true);
}

async function analyseDraftSquad() {
  const result = validateSquad();
  const area = el('squadAnalysis');
  if (!area) return;
  if (!result.selected.length) { area.textContent = 'Select players before analysing the draft.'; return; }
  const projected = result.starters.reduce((sum, player) => sum + player.projectedPts, 0) + (result.starters.find(player => player.id === S.captainId)?.projectedPts || 0);
  const averageFdr = result.starters.length ? result.starters.reduce((sum, player) => sum + player.avgFDR, 0) / result.starters.length : 0;
  area.innerHTML = `<div class="draft-readout"><div class="draft-readout-head"><strong>Draft readout</strong><span>${result.selected.length}/15 selected</span></div><p><b>£${result.budget.remaining.toFixed(1)}m</b> remaining · XI projects <b>${projected.toFixed(1)} points</b> · average FDR <b>${averageFdr.toFixed(1)}</b>.</p><small>Constraints checked. Use the analyst for explanation, not replacement.</small></div>`;
}

async function submitDraftToFpl() {
  const result = renderSquadValidation(true);
  if (!result?.valid) return;
  if (!S.fplEntryId) { setLoginErr('Connect your FPL account before synchronizing a squad.'); openModal(); return; }
  if (!confirm('Review your draft and confirm synchronization with FPL. This can change the official team.')) return;
  const picks = [...result.selected].sort((a, b) => (S.pickOrder[a.id] || 99) - (S.pickOrder[b.id] || 99)).map((player, index) => ({ element: player.id, position: S.pickOrder[player.id] || index + 1, is_captain: player.id === S.captainId, is_vice_captain: player.id === S.vcaptainId }));
  const notice = el('squadDraftNotice'); if (notice) notice.textContent = 'Sending the reviewed squad to the server…';
  const { data } = await cortexApi('team/submit', { method: 'POST', body: JSON.stringify({ payload: { entry: S.fplEntryId, picks, preSeason: !S.currentGW || S.currentGW < 1 } }) });
  if (!data.ok) { if (notice) notice.textContent = data.message || 'FPL synchronization is unavailable.'; return; }
  if (notice) notice.textContent = data.verified ? 'FPL returned the same squad; synchronization verified.' : 'FPL returned an unverified response.';
  applyFplTeam(data.team);
}

function applyFplTeam(team) {
  const picks = team?.picks || [];
  if (!picks.length) return false;
  S.myTeam = picks.map(pick => pick.element).filter(id => S.players.some(player => player.id === id));
  S.pickOrder = {}; picks.forEach(pick => { S.pickOrder[pick.element] = pick.position; });
  const captain = picks.find(pick => pick.is_captain), viceCaptain = picks.find(pick => pick.is_vice_captain);
  S.captainId = captain?.element || S.captainId; S.vcaptainId = viceCaptain?.element || S.vcaptainId;
  saveTeam(); renderAll(); return true;
}

function togglePlayer(pid){const idx=S.myTeam.indexOf(pid);if(idx===-1){if(S.myTeam.length>=15)return;S.myTeam.push(pid);}else{S.myTeam.splice(idx,1);if(S.captainId===pid)S.captainId=null;if(S.vcaptainId===pid)S.vcaptainId=null;delete S.pickOrder[pid];}saveTeam();renderPlayerTable();renderMyTeam();renderDashboard();}
function removeFromTeam(pid){const idx=S.myTeam.indexOf(pid);if(idx===-1)return;S.myTeam.splice(idx,1);if(S.captainId===pid){S.captainId=null;localStorage.removeItem('fpl_captain');}if(S.vcaptainId===pid){S.vcaptainId=null;localStorage.removeItem('fpl_vcaptain');}delete S.pickOrder[pid];saveTeam();renderMyTeam();renderPlayerTable();renderDashboard();}
function clearTeam(){if(!confirm('Clear entire squad?'))return;S.myTeam=[];S.captainId=null;S.vcaptainId=null;S.pickOrder={};['fpl_myteam','fpl_captain','fpl_vcaptain','fpl_pickorder'].forEach(k=>localStorage.removeItem(k));renderMyTeam();renderDashboard();renderPlayerTable();}

function renderMyTeam(){
  const mp=myPlayers();const{starters,bench,formation,byPos}=getSquadGroups();
  const spent=mp.reduce((s,p)=>s+p.price,0);const cap=starters.find(p=>p.id===S.captainId);
  setText('squadCount',mp.length);setText('squadValue',`£${spent.toFixed(1)}m`);setText('formationDisplay',mp.length>=11?formation:'—');
  const proj=starters.reduce((s,p)=>s+p.projectedPts,0)+(cap?cap.projectedPts:0);
  setText('squadProjPts',Math.round(proj*10)/10);setText('squadInfoCount',`${mp.length}/15`);setText('squadInfoValue',`£${spent.toFixed(1)}m`);setText('squadInfoXpts',starters.length?(proj.toFixed(1)):'—');
  setText('lineupStatus',`${starters.length}/11 starters · ${bench.length} bench`);
  const draftBudget=el('draftBudgetLabel');if(draftBudget)draftBudget.textContent=`£${spent.toFixed(1)}m / £${squadRules().budget.toFixed(1)}m`;
  const impBtn=el('importFplTeamBtn');if(impBtn)impBtn.style.display=S.fplEntryId?'inline-flex':'none';
  const hint=S.substitutionMode?(S.swapPid?'Choose the player to bring on.':'Choose one starter, then one bench player.'):'Tap Swap players to reorder the XI and bench.';setText('lineupHint',hint);updateSubstitutionUI();
  renderDraftBuilder();
  [{id:'pitchFWD',players:byPos.FWD||[]},{id:'pitchMID',players:byPos.MID||[]},{id:'pitchDEF',players:byPos.DEF||[]},{id:'pitchGKP',players:byPos.GKP||[]}].forEach(({id,players})=>{const row=el(id);if(!row)return;row.innerHTML=players.length?players.map(p=>pitchCard(p,false)).join(''):'<div class="pitch-empty"><span>—</span></div>';});
  const benchEl=el('pitchBench');if(benchEl)benchEl.innerHTML=bench.length?bench.map(p=>pitchCard(p,true)).join(''):'<div class="pitch-empty bench-empty"><span>No bench players</span></div>';
  if(!mp.length){setHTML('teamListArea',emptyState('','SQUAD IS EMPTY','Use the picker to build your 15.'));return;}
  const ordered=[...starters,...bench];
  setHTML('teamListArea',ordered.map((p,i)=>{
    const isC=p.id===S.captainId,isV=p.id===S.vcaptainId,isBench=!S.starterIds.includes(p.id),risks=getRisk(p),fix=p.upcomingFixtures[0];
    const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} GW${fix.gw}`:'No fixture';const col=tc(p.teamShort),live=S.liveData?.[p.id]?.stats,livePts=live?live.total_points:null,breakdown=live?buildPtsBreakdown(S.liveData[p.id]):'';
    const sep=isBench&&i===starters.length?'<div class="squad-list-divider"><span>Bench</span><span>Not counted in XI</span></div>':'';
    return`${sep}<div class="team-list-row ${isBench?'is-bench':''}"><div class="team-color-bar" style="background:${col.p}"></div><div class="team-list-main"><div class="team-list-title">${p.web_name}${isC?'<span class="card-badge badge-amber">C</span>':''}${isV?'<span class="card-badge badge-blue">V</span>':''}<span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div class="team-list-meta">${p.teamShort} · Next ${fixStr}</div>${risks.length?`<div class="team-list-risk">${risks[0].reason}</div>`:''}${breakdown?`<div class="pts-breakdown">${breakdown}</div>`:''}</div><div class="team-list-score"><strong>${livePts!==null?livePts:p.projectedPts}</strong><small>${livePts!==null?'pts':'xP'} · £${p.price.toFixed(1)}m</small></div><button class="remove-btn" data-pid="${p.id}" type="button" aria-label="Remove ${p.web_name}">Remove</button></div>`;
  }).join(''));
}

function initialsForPlayer(p){return`${(p.first_name||p.web_name||'').slice(0,1)}${(p.second_name||p.web_name||'').slice(0,1)}`.toUpperCase();}
function pitchCard(p,isBench=false){
  const isC=p.id===S.captainId,isV=p.id===S.vcaptainId,live=S.liveData?.[p.id]?.stats,pts=live?live.total_points:null,col=tc(p.teamShort),selected=S.swapPid===p.id;
  const fixture=p.upcomingFixtures?.[0];
  const fixtureText=fixture?`${fixture.home?'':'@'}${fixture.opponent}`:'—';
  const price=`£${Number(p.price||0).toFixed(1)}m`;
  const role=isBench?'bench':'starter';
  return`<button type="button" class="pitch-card ${isBench?'is-bench':''} ${selected?'is-swap-selected':''}" data-pid="${p.id}" data-role="${role}" aria-label="${p.web_name}, ${role}"><span class="shirt-tile" style="--club:${col.p};--sleeve:${col.s}"><span class="shirt-collar"></span><span class="shirt-number">${initialsForPlayer(p).slice(0,2)}</span></span><span class="pitch-label"><strong>${p.web_name}</strong><small>${price}</small><em>${p.teamShort} ${fixtureText}</em></span>${isC?'<span class="cap-badge">C</span>':''}${isV?'<span class="vc-badge">V</span>':''}${pts!==null?`<span class="pitch-points">${pts} pts</span>`:''}</button>`;
}

function ensurePickOrder(){
  const{starters,bench}=getSquadGroups();
  const used=new Set(Object.values(S.pickOrder).map(Number).filter(Number.isFinite));
  let next=Math.max(0,...used)+1;
  [...starters,...bench].forEach(p=>{if(!Number.isFinite(Number(S.pickOrder[p.id]))){while(used.has(next))next+=1;S.pickOrder[p.id]=next;used.add(next);next+=1;}});
}
function toggleSubstitutionMode(){S.substitutionMode=!S.substitutionMode;S.swapPid=null;updateSubstitutionUI();}
function updateSubstitutionUI(){const btn=el('substituteModeBtn');if(btn){btn.classList.toggle('is-active',S.substitutionMode);btn.textContent=S.substitutionMode?'Exit swap mode':'Swap players';}const area=el('pitchArea');if(area)area.classList.toggle('swap-mode',S.substitutionMode);const hint=el('lineupHint');if(hint)hint.textContent=S.substitutionMode?(S.swapPid?'Choose the player to bring on.':'Choose one starter, then one bench player.'):'Tap Swap players to reorder the XI and bench.';}
function swapSquadPlayers(first,second){
  if(first===second)return;
  const firstPlayer=S.players.find(p=>p.id===first),secondPlayer=S.players.find(p=>p.id===second);if(!firstPlayer||!secondPlayer)return;
  ensurePickOrder();const firstOrder=Number(S.pickOrder[first]),secondOrder=Number(S.pickOrder[second]);
  if((firstOrder<=11)===(secondOrder<=11)){S.swapPid=null;updateSubstitutionUI();if(el('lineupHint'))el('lineupHint').textContent='Choose one starter and one bench player.';return;}
  if((firstPlayer.posShort==='GKP')!==(secondPlayer.posShort==='GKP')){S.swapPid=null;updateSubstitutionUI();if(el('lineupHint'))el('lineupHint').textContent='Goalkeepers can only replace goalkeepers.';return;}
  const nextOrders={...S.pickOrder,[first]:secondOrder,[second]:firstOrder};
  const nextStarters=S.myTeam.map(id=>S.players.find(p=>p.id===id)).filter(Boolean).filter(p=>Number(nextOrders[p.id])<=11);
  const counts=nextStarters.reduce((acc,p)=>{acc[p.posShort]=(acc[p.posShort]||0)+1;return acc;},{GKP:0,DEF:0,MID:0,FWD:0});
  if(counts.GKP!==1||counts.DEF<3||counts.MID<2||counts.FWD<1){S.swapPid=null;updateSubstitutionUI();if(el('lineupHint'))el('lineupHint').textContent='That substitution would create an illegal formation.';return;}
  S.pickOrder[first]=secondOrder;S.pickOrder[second]=firstOrder;S.swapPid=null;saveTeam();renderMyTeam();renderDashboard();
}

function buildPtsBreakdown(liveEl){if(!liveEl)return'';const LABELS={minutes:'mins',goals_scored:'',assists:'',clean_sheets:'CS',goals_conceded:'GC',own_goals:'OG',yellow_cards:'',red_cards:'',saves:'saves',bonus:'bonus'};const stats=liveEl.explain?.flatMap(e=>e.stats||[])||[];if(!stats.length){const s=liveEl.stats||{},c=[];if(s.minutes>=60)c.push(`<span class="pts-chip pos">${s.minutes}' +2</span>`);else if(s.minutes>0)c.push(`<span class="pts-chip pos">${s.minutes}' +1</span>`);if(s.goals_scored>0)c.push(`<span class="pts-chip pos">x${s.goals_scored}</span>`);if(s.assists>0)c.push(`<span class="pts-chip pos">x${s.assists}</span>`);if(s.clean_sheets>0)c.push(`<span class="pts-chip pos">CS</span>`);if(s.bonus>0)c.push(`<span class="pts-chip bonus">${s.bonus}</span>`);if(s.yellow_cards>0)c.push(`<span class="pts-chip neg"></span>`);if(s.red_cards>0)c.push(`<span class="pts-chip neg"></span>`);return c.join('');}return stats.filter(s=>s.points!==0).map(s=>{const cls=s.identifier==='bonus'?'bonus':s.points>0?'pos':'neg';return`<span class="pts-chip ${cls}">${LABELS[s.identifier]||s.identifier} ${s.points>0?'+':''}${s.points}</span>`;}).join('');}

/* ══ ACTION SHEET ═══════════════════════════════════════════════ */
function openActionSheet(pid){S.actionPid=pid;const p=S.players.find(x=>x.id===pid);if(!p)return;setText('actionPlayerName',p.web_name);setText('actionPlayerSub',`${p.posShort}·${p.teamShort}·£${p.price.toFixed(1)}m`);const cb=el('actionSetCaptain'),vb=el('actionSetVC');if(cb)cb.textContent=S.captainId===pid?'Remove Captain':'Set as Captain';if(vb)vb.textContent=S.vcaptainId===pid?'Remove VC':'Set as Vice Captain';const s=el('actionSheetBackdrop');if(s)s.style.display='flex';}
function closeActionSheet(){S.actionPid=null;const s=el('actionSheetBackdrop');if(s)s.style.display='none';}

/* ══ CUSTOM KIT (#30) ═══════════════════════════════════════════ */
function applyCustomKit(){const primary=el('kitColorPrimary')?.value||'#00e676',sleeve=el('kitColorSleeve')?.value||'#0ea5e9';S.customKit={primary,sleeve};localStorage.setItem('fpl_kit',JSON.stringify(S.customKit));renderMyTeam();const panel=el('kitDesignerPanel');if(panel)panel.style.display='none';}

/* ══ PRICE CHANGES (#2) ═════════════════════════════════════════ */
function renderPriceChanges(){
  const risers=S.players.filter(p=>p.cost_change_event>0).sort((a,b)=>b.cost_change_event-a.cost_change_event).slice(0,8),fallers=S.players.filter(p=>p.cost_change_event<0).sort((a,b)=>a.cost_change_event-b.cost_change_event).slice(0,8);
  const row=(p,dir)=>`<div class="price-row"><div><strong>${p.web_name}</strong><small>${p.teamShort} · ${p.posShort} · ${p.selected_by_percent}% owned</small></div><span class="price-change ${dir>0?'price-up':'price-down'}">${dir>0?'▲':'▼'} £${Math.abs(p.cost_change_event/10).toFixed(1)}m</span></div>`;
  const noChg=(label)=>`<div class="market-empty compact"><span class="market-empty-label">${label}</span><strong>No changes today</strong><p>Price movement will appear after the next update.</p></div>`;
  setHTML('priceRisingList',risers.length?risers.map(p=>row(p,1)).join(''):noChg('Risers'));setHTML('priceFallingList',fallers.length?fallers.map(p=>row(p,-1)).join(''):noChg('Fallers'));
}

/* ══ DIFFERENTIALS (#4) ═════════════════════════════════════════ */
function renderDifferentials(){
  const posF=el('diffPosFilter')?.value||'',sortKey=el('diffSortFilter')?.value||'form';
  let diffs=S.players.filter(p=>parseFloat(p.selected_by_percent)<15&&p.formVal>=3&&p.minutes>0);
  if(posF)diffs=diffs.filter(p=>p.posShort===posF);diffs.sort((a,b)=>(parseFloat(b[sortKey])||0)-(parseFloat(a[sortKey])||0));
  const tbody=el('diffTableBody');if(!tbody)return;
  const top=diffs.slice(0,20);if(!top.length){tbody.innerHTML=`<tr><td colspan="8"><div class="table-empty-state"><strong>No differentials found</strong><span>Try another position or sort.</span></div></td></tr>`;return;}
  tbody.innerHTML=top.map(p=>{const inTeam=S.myTeam.includes(p.id),full=!inTeam&&S.myTeam.length>=15;const fix=p.upcomingFixtures[0];const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'—';return`<tr><td><div class="player-name">${p.web_name}</div><div class="player-sub">${p.teamShort}</div></td><td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td><td><span class="price-val">£${p.price.toFixed(1)}</span></td><td><span class="form-val form-hi">${p.form}</span></td><td><span class="ep-val">${p.ep_next||'—'}</span></td><td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td><td style="font-family:var(--font-data);font-size:.7rem">${fixStr}</td><td><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''}>${inTeam?'':'＋'}</button></td></tr>`;}).join('');
}

/* ══ COMPARISON (#5) ════════════════════════════════════════════ */
function renderComparison(){
  const find=q=>q?S.players.filter(p=>`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>b.total_points-a.total_points)[0]:null;
  const players=[find(el('compareSearch1')?.value||''),find(el('compareSearch2')?.value||''),find(el('compareSearch3')?.value||'')].filter(Boolean);
  const area=el('compareResults');if(!area)return;if(players.length<2){area.innerHTML=emptyState('','ADD 2 PLAYERS','Type player names above.');return;}
  const stats=[{label:'Position',key:p=>p.posShort},{label:'Team',key:p=>p.teamShort},{label:'Price',key:p=>`£${p.price.toFixed(1)}m`,num:p=>p.price},{label:'Form',key:p=>p.form,num:p=>parseFloat(p.form)},{label:'Total Pts',key:p=>p.total_points,num:p=>p.total_points},{label:'xPts',key:p=>p.ep_next||'—',num:p=>parseFloat(p.ep_next)||0},{label:'Ownership',key:p=>p.selected_by_percent+'%',num:p=>parseFloat(p.selected_by_percent)},{label:'ICT',key:p=>parseFloat(p.ict_index).toFixed(1),num:p=>parseFloat(p.ict_index)},{label:'Goals',key:p=>p.goals_scored,num:p=>p.goals_scored},{label:'Assists',key:p=>p.assists,num:p=>p.assists},{label:'Next FDR',key:p=>p.upcomingFixtures[0]?`GW${p.upcomingFixtures[0].gw} FDR${p.upcomingFixtures[0].difficulty}`:'—',num:p=>p.upcomingFixtures[0]?6-p.upcomingFixtures[0].difficulty:0}];
  const headers=players.map((p,i)=>`<th class="${i===0?'compare-header-cell':''}">${p.web_name}<br><span style="font-size:.62rem;color:var(--text-sub)">${p.teamShort}</span></th>`).join('');
  const rows=stats.map(s=>{const vals=players.map(p=>s.key(p));const nums=s.num?players.map(p=>s.num(p)):null;const maxNum=nums?Math.max(...nums):null;return`<tr><td>${s.label}</td>${vals.map((v,i)=>`<td class="${nums&&nums[i]===maxNum&&maxNum>0?'compare-best':''}">${v}</td>`).join('')}</tr>`;}).join('');
  area.innerHTML=`<div class="player-table-wrap"><table class="compare-table"><thead><tr><th>Stat</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ══ FDR CALENDAR (#6) ══════════════════════════════════════════ */
function renderFDRCalendar(){
  const area=el('fdrCalendarArea');if(!area)return;
  if(!S.players.length||!S.allFixtures.length){area.innerHTML='<div class="fdr-empty">Fixture difficulty will appear when the live fixture pool is ready.</div>';return;}
  const gwCount=Math.max(1,Math.min(8,parseInt(el('fdrGwCount')?.value||5,10)));
  const upcoming=[...new Set(S.allFixtures.filter(f=>Number.isFinite(Number(f.event))&&Number(f.event)>0).map(f=>Number(f.event)))].sort((a,b)=>a-b);
  const startGW=parseInt(el('fixtureGwSelect')?.value||S.nextGW||upcoming[0]||S.currentGW||1,10);
  const teams=Object.values(S.teams).sort((a,b)=>a.short_name.localeCompare(b.short_name));const fxMap={};teams.forEach(t=>{fxMap[t.id]={};});
  S.allFixtures.forEach(f=>{if(!f.event||f.event<startGW||f.event>=startGW+gwCount)return;if(!fxMap[f.team_h])fxMap[f.team_h]={};if(!fxMap[f.team_a])fxMap[f.team_a]={};(fxMap[f.team_h][f.event]=fxMap[f.team_h][f.event]||[]).push({opp:S.teams[f.team_a]?.short_name||'?',home:true,fdr:f.team_h_difficulty});(fxMap[f.team_a][f.event]=fxMap[f.team_a][f.event]||[]).push({opp:S.teams[f.team_h]?.short_name||'?',home:false,fdr:f.team_a_difficulty});});
  const gwHeaders=Array.from({length:gwCount},(_,i)=>`<th>GW${startGW+i}</th>`).join('');
  const rows=teams.map(t=>{const cells=Array.from({length:gwCount},(_,i)=>{const gw=startGW+i,fx=fxMap[t.id]?.[gw]||[];if(!fx.length)return`<td class="fdr-cell fdr-blank">—</td>`;if(fx.length>=2)return`<td class="fdr-cell fdr-double">${fx.map(f=>`${f.home?'':'@'}${f.opp}`).join('<br>')}</td>`;const f=fx[0];return`<td class="fdr-cell fdr-cell-${f.fdr}">${f.home?'':'@'}${f.opp}</td>`;}).join('');return`<tr><td class="fdr-team">${t.short_name}</td>${cells}</tr>`;}).join('');
  area.innerHTML=`<div class="fdr-toolbar"><span>GW${startGW}–GW${startGW+gwCount-1}</span><span>${teams.length} clubs · tap a row to scan the run</span></div><div class="fdr-table-wrap"><table class="fdr-table"><thead><tr><th>Team</th>${gwHeaders}</tr></thead><tbody>${rows}</tbody></table></div><div class="fdr-legend"><span class="fdr-legend-double">■ Double</span><span class="fdr-legend-blank">— Blank</span><span class="fdr-legend-easy">■ Easy</span><span class="fdr-legend-hard">■ Hard</span></div>`;
}

/* ══ BLANK/DOUBLE (#7) ══════════════════════════════════════════ */
function renderBlankDouble(){
  const area=el('blankDoubleAlert');if(!area)return;const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);const blanks=[],doubles=[];
  for(let gw=startGW;gw<startGW+8;gw++){const tc_={};Object.values(S.teams).forEach(t=>{tc_[t.id]=0;});S.allFixtures.filter(f=>f.event===gw).forEach(f=>{if(tc_[f.team_h]!==undefined)tc_[f.team_h]++;if(tc_[f.team_a]!==undefined)tc_[f.team_a]++;});const blankT=Object.entries(tc_).filter(([,c])=>c===0).map(([id])=>S.teams[id]?.short_name).filter(Boolean);const doubleT=Object.entries(tc_).filter(([,c])=>c>=2).map(([id])=>S.teams[id]?.short_name).filter(Boolean);if(blankT.length)blanks.push({gw,teams:blankT});if(doubleT.length)doubles.push({gw,teams:doubleT});}
  let html='';doubles.forEach(d=>{html+=`<div class="bdgw-banner double"> <strong>GW${d.gw} DOUBLE:</strong> ${d.teams.join(', ')}</div>`;});blanks.forEach(b=>{html+=`<div class="bdgw-banner blank"> <strong>GW${b.gw} BLANK:</strong> ${b.teams.join(', ')}</div>`;});
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
  if(sel.length<11)return`<div class="builder-error">Could not build a full squad within £${budget}m. Try a little more budget.</div>`;
  const totalXpts=sel.reduce((s,p)=>s+p.projectedPts,0);const byPos={GKP:sel.filter(p=>p.posShort==='GKP'),DEF:sel.filter(p=>p.posShort==='DEF'),MID:sel.filter(p=>p.posShort==='MID'),FWD:sel.filter(p=>p.posShort==='FWD')};
  const rPos=(pos,lbl)=>byPos[pos].length?`<div class="builder-pos-section"><div class="builder-pos-label"><span class="pos-chip pos-${pos}">${pos}</span> ${lbl}</div><div class="builder-result-grid">${byPos[pos].map(p=>`<div class="builder-player"><div class="builder-player-name">${p.web_name}</div><div class="builder-player-meta">${p.teamShort}·£${p.price.toFixed(1)}m·${p.projectedPts}xP</div></div>`).join('')}</div></div>`:'';
  const html=`<div class="builder-summary"><span>Best available mix within your budget</span><strong>${sel.length} players</strong></div>${rPos('GKP','Goalkeepers')}${rPos('DEF','Defenders')}${rPos('MID','Midfielders')}${rPos('FWD','Forwards')}<div class="builder-total"><div><div class="builder-total-label">TOTAL COST</div><strong class="builder-cost">£${spent.toFixed(1)}m</strong></div><div><div class="builder-total-label">TOTAL xPts</div><strong class="builder-total-val">${Math.round(totalXpts*10)/10}</strong></div></div><button class="button button-primary button-small" id="addAutoSquadBtn" type="button">Add this squad</button>`;
  setTimeout(()=>{el('addAutoSquadBtn')?.addEventListener('click',()=>{S.myTeam=sel.map(p=>p.id);saveTeam();renderPlayerTable();renderMyTeam();renderDashboard();alert(`Added ${sel.length} players!`);});},100);
  return html;
}
function runWildcard(){const area=el('wildcardResult');if(!area)return;area.innerHTML='<div style="color:var(--text-sub);font-size:.8rem;padding:.5rem">Generating...</div>';setTimeout(()=>{const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);S.players=S.players.map(p=>{let sc=0;for(let gw=startGW;gw<startGW+5;gw++){const fx=S.allFixtures.filter(f=>f.event===gw&&(f.team_h===p.team||f.team_a===p.team));if(!fx.length)continue;const avg=fx.reduce((s,f)=>s+(f.team_h===p.team?f.team_h_difficulty:f.team_a_difficulty),0)/fx.length;sc+=p.formVal*fdrMult(avg);}return{...p,wcScore:sc};});area.innerHTML=`<div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-bottom:.5rem">Optimised for GW${startGW}–GW${startGW+4}</div>${buildSquad(100,'form',15)}`;},100);}

/* ══ CHIP PLANNER (#3) ══════════════════════════════════════════ */
function renderChipPlanner(){
  const area=el('chipPlannerArea');if(!area)return;if(!S.fplEntryId){area.innerHTML=emptyState('','CONNECT ACCOUNT','Login first.');return;}
  if(!S.gwHistory){area.innerHTML='<div style="color:var(--text-sub);padding:1rem;font-size:.8rem">Loading...</div>';fetchGWHistory().then(()=>renderChipPlanner());return;}
  const used=(S.gwHistory.chips||[]).map(c=>c.name);const{starters}=getSquadGroups();const pool=starters.length?starters:myPlayers();const topCap=pool.length?[...pool].sort((a,b)=>capScore(b)-capScore(a))[0]:null;
  const chips=[{name:'wildcard',icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5\'/></svg>',label:'Wildcard',desc:'Free transfers for 1 GW',sug:()=>{const bad=myPlayers().filter(p=>p.avgFDR>=4).length;return bad>=4?`Now — ${bad} players have brutal fixtures`:'Hold for worse fixtures';}},{name:'freehit',icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><circle cx=\'12\' cy=\'12\' r=\'9\'/><circle cx=\'12\' cy=\'12\' r=\'3\'/></svg>',label:'Free Hit',desc:'Unlimited transfers, reverts after',sug:()=>'Best for a blank GW when squad is reduced'},{name:'bboost',icon:'<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"/></svg>',label:'Bench Boost',desc:'Bench players score too',sug:()=>'Best when bench has great fixtures'},{name:'3xc',icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z\'/></svg>',label:'Triple Captain',desc:'Captain scores 3x points',sug:()=>topCap?`Best on ${topCap.web_name} (Form ${topCap.form})`:'Set a captain first'}];
  area.innerHTML=chips.map(chip=>{const isUsed=used.includes(chip.name);const gwU=S.gwHistory.chips?.find(c=>c.name===chip.name);return`<div class="chip-card"><div class="chip-icon">${chip.icon}</div><div style="flex:1"><div class="chip-name">${chip.label}</div><div class="chip-status ${isUsed?'chip-used':'chip-available'}">${isUsed?`Used GW${gwU?.event||'?'}`:'Available'}</div><div style="font-size:.75rem;color:var(--text-sub);margin-top:2px">${chip.desc}</div>${!isUsed?`<div class="chip-suggestion">${chip.sug()}</div>`:''}</div></div>`;}).join('');
}

/* ══ PREDICTOR (#10) ════════════════════════════════════════════ */
function renderPredictor(){
  const posF=el('predictorPosFilter')?.value||'',area=el('predictorResults');if(!area)return;
  let pool=S.players.filter(p=>p.minutes>0);if(posF)pool=pool.filter(p=>p.posShort===posF);
  const pred=pool.map(p=>{const fix=p.upcomingFixtures[0];const fdr=fix?fix.difficulty:3,fm=fdrMult(fdr);const avgMins=p.minutes/Math.max(1,S.currentGW||1),play=Math.min(1,avgMins/90);const minPts=play>=0.75?2:play>=0.5?1:0;const threat=parseFloat(p.threat)||0,crea=parseFloat(p.creativity)||0;const isAtt=p.element_type===3||p.element_type===4,isDef=p.element_type===1||p.element_type===2;const gProb=isAtt?(threat/100)*fm*0.3:isDef?(threat/100)*fm*0.08:0;const aProb=isAtt?(crea/100)*fm*0.25:0;const gPts=gProb*(p.element_type===4?4:p.element_type===3?5:6);const aPts=aProb*3;const csPts=isDef?(fdr<=2?0.5:fdr<=3?0.35:0.15)*(p.element_type===1?6:4):0;const bonPts=(gProb+aProb)*1.2;return{...p,pred:{total:Math.round((minPts+gPts+aPts+csPts+bonPts)*10)/10,minutes:minPts,goals:Math.round(gPts*10)/10,assists:Math.round(aPts*10)/10,cs:Math.round(csPts*10)/10,bonus:Math.round(bonPts*10)/10},nextFix:fix};}).sort((a,b)=>b.pred.total-a.pred.total).slice(0,15);
  const bar=(val,color,max)=>`<div class="predictor-bar-track"><div class="predictor-bar-fill" style="width:${Math.round((val/max)*100)}%;background:${color}"></div></div>`;
  area.innerHTML=pred.map(p=>{const inTeam=S.myTeam.includes(p.id),full=!inTeam&&S.myTeam.length>=15;const col=tc(p.teamShort);return`<div class="predictor-row"><div class="team-color-bar" style="background:${col.p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:4px">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div style="font-size:.68rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m${p.nextFix?` · ${p.nextFix.home?'':'@'}${p.nextFix.opponent} GW${p.nextFix.gw}`:''}</div><div class="predictor-bars" style="margin-top:4px"><div class="predictor-bar-row"><span class="predictor-bar-label">Mins</span>${bar(p.pred.minutes,'var(--blue)',2)}<span class="predictor-bar-val">${p.pred.minutes}</span></div><div class="predictor-bar-row"><span class="predictor-bar-label">Goals</span>${bar(p.pred.goals,'var(--green)',6)}<span class="predictor-bar-val">${p.pred.goals}</span></div><div class="predictor-bar-row"><span class="predictor-bar-label">Assists</span>${bar(p.pred.assists,'var(--amber)',3)}<span class="predictor-bar-val">${p.pred.assists}</span></div>${p.pred.cs?`<div class="predictor-bar-row"><span class="predictor-bar-label">CS</span>${bar(p.pred.cs,'var(--blue)',6)}<span class="predictor-bar-val">${p.pred.cs}</span></div>`:''}</div></div><div style="text-align:right;flex-shrink:0;padding-left:.5rem"><div class="predictor-total">${p.pred.total}</div><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''} style="margin-top:4px;padding:4px 8px;font-size:.65rem">${inTeam?'':'＋'}</button></div></div>`;}).join('');
}

/* ══ TRANSFERS ══════════════════════════════════════════════════ */
function renderTransfers(){
  const mp=myPlayers();
  const emptyMarket=(label,copy)=>`<div class="market-empty"><span class="market-empty-label">${label}</span><strong>No data yet</strong><p>${copy}</p></div>`;
  if(!mp.length){setHTML('transferArea',emptyState('','NO SQUAD','Build your team to compare realistic moves.'));}
  else{
    const suggestions=[];mp.forEach(cur=>{const best=S.players.filter(p=>p.element_type===cur.element_type&&p.id!==cur.id&&!S.myTeam.includes(p.id)&&p.price<=cur.price+0.5&&p.projectedPts>cur.projectedPts).sort((a,b)=>b.projectedPts-a.projectedPts)[0];if(best)suggestions.push({out:cur,in:best,gain:Math.round((best.projectedPts-cur.projectedPts)*10)/10});});
    suggestions.sort((a,b)=>b.gain-a.gain);const top=suggestions.slice(0,8);const fx=f=>f?`${f.home?'':'@'}${f.opponent} · GW${f.gw}`:'';
    if(!top.length)setHTML('transferArea',emptyState('','SQUAD LOOKS SOLID','No better options within the current budget.'));
    else setHTML('transferArea',`<div class="transfer-panel-heading"><div><span class="eyebrow">Move ideas</span><h2>Suggested moves</h2></div><span class="panel-meta">${top.length} options</span></div><div class="transfer-suggestion-list">${top.map(s=>`<div class="transfer-item"><div class="transfer-side transfer-out"><span class="transfer-label">Sell</span><strong>${s.out.web_name}</strong><small>${s.out.teamShort} · £${s.out.price.toFixed(1)}m · ${fx(s.out.upcomingFixtures[0])}</small></div><div class="transfer-arrow" aria-hidden="true">→</div><div class="transfer-side transfer-in"><span class="transfer-label">Buy</span><strong>${s.in.web_name}</strong><small>${s.in.teamShort} · £${s.in.price.toFixed(1)}m · ${fx(s.in.upcomingFixtures[0])}</small></div><span class="transfer-gain">+${s.gain} xP</span></div>`).join('')}</div>`);
  }
  const active=S.players.filter(p=>p.transfers_in_event>0||p.transfers_out_event>0),topIn=[...active].sort((a,b)=>b.transfers_in_event-a.transfers_in_event).slice(0,8),topOut=[...active].sort((a,b)=>b.transfers_out_event-a.transfers_out_event).slice(0,8);
  const row=(p,key,color)=>{const val=p[key]||0,maxV=(key==='transfers_in_event'?(topIn[0]?.[key]||1):(topOut[0]?.[key]||1));return`<div class="market-row"><div class="market-row-main"><strong>${p.web_name}</strong><small>${p.teamShort} · £${p.price.toFixed(1)}m</small></div><strong class="market-value" style="color:${color}">${val.toLocaleString()}</strong><div class="market-bar"><span style="width:${Math.round(val/maxV*100)}%;background:${color}"></span></div></div>`;};
  const inEl=el('transfersInList'),outEl=el('transfersOutList');if(inEl)inEl.innerHTML=topIn.length?`<div class="market-list">${topIn.map(p=>row(p,'transfers_in_event','var(--green)')).join('')}</div>`:emptyMarket('No confirmed moves','Transfer data is quiet for this gameweek.');if(outEl)outEl.innerHTML=topOut.length?`<div class="market-list">${topOut.map(p=>row(p,'transfers_out_event','var(--red)')).join('')}</div>`:emptyMarket('No confirmed moves','Transfer data is quiet for this gameweek.');
}

function renderTransferTargets(){
  const area=el('transferTargetsArea');if(!area)return;
  if(!S.players.length||!S.allFixtures.length){area.innerHTML='<div class="tool-empty">Waiting for live player and fixture data.</div>';return;}
  const start=Number(S.nextGW||S.currentGW||1), horizon=5;
  const fixturesFor=p=>S.allFixtures.filter(f=>Number(f.event)>=start&&Number(f.event)<start+horizon&&(f.team_h===p.team||f.team_a===p.team));
  const candidates=S.players.filter(p=>p.status==='a'&&p.minutes>0).map(p=>{
    const fx=fixturesFor(p), avg=fx.length?fx.reduce((sum,f)=>sum+(f.team_h===p.team?Number(f.team_h_difficulty||3):Number(f.team_a_difficulty||3)),0)/fx.length:3;
    const fdrScore=Math.max(0,5-avg), value=p.price?Number(p.projectedPts||0)/p.price:0;
    return{p,fx,avg,fdrScore,value,score:Number(p.projectedPts||0)*2+Number(p.formVal||0)+fdrScore*1.4+value*2};
  }).filter(x=>!S.myTeam.includes(x.p.id)).sort((a,b)=>b.score-a.score).slice(0,6);
  setText('transferTargetMeta',`GW${start}–GW${start+horizon-1}`);
  if(!candidates.length){area.innerHTML='<div class="tool-empty">No target signal is available for the current fixture window.</div>';return;}
  area.innerHTML=`<div class="target-list">${candidates.map((x,i)=>{const p=x.p,fix=x.fx[0],fixture=fix?`${fix.home?'':'@'}${fix.home?S.teams[fix.team_a]?.short_name:S.teams[fix.team_h]?.short_name} · FDR ${fix.team_h===p.team?fix.team_h_difficulty:fix.team_a_difficulty}`:'No fixture';return`<div class="target-row"><span class="target-rank">${String(i+1).padStart(2,'0')}</span><div class="target-player"><strong>${p.web_name}</strong><small>${p.teamShort} · ${p.posShort} · £${p.price.toFixed(1)}m · ${parseFloat(p.selected_by_percent).toFixed(1)}% owned</small></div><div class="target-fixture"><strong>${Number(p.projectedPts||0).toFixed(1)} xP</strong><small>${fixture}</small></div><span class="target-fdr fdr-${Math.round(x.avg)}">${x.avg.toFixed(1)}</span></div>`;}).join('')}</div>`;
}

/* ══ FIXTURES ═══════════════════════════════════════════════════ */
function renderFixtureGwSelect(){const sel=el('fixtureGwSelect');if(!sel||!S.bootstrap)return;sel.innerHTML=S.bootstrap.events.filter(e=>e.id>=1).map(e=>`<option value="${e.id}" ${e.is_current?'selected':''}>${e.name}</option>`).join('');}
function renderFixtures(){
  const gw=parseInt(el('fixtureGwSelect')?.value||S.currentGW||1),list=S.allFixtures.filter(f=>f.event===gw),area=el('fixturesArea');if(!area)return;
  if(!list.length){area.innerHTML=emptyState('','NO FIXTURES','There are no fixtures listed for this gameweek.');return;}
  area.innerHTML=`<div class="fixture-panel-heading"><div><span class="eyebrow">Gameweek ${gw}</span><h2>Match schedule</h2></div><span class="panel-meta">${list.length} matches</span></div><div class="fixture-list">${list.map(f=>{const h=S.teams[f.team_h],a=S.teams[f.team_a],ko=f.kickoff_time?new Date(f.kickoff_time):null,ts=ko?ko.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+' · '+ko.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'Kick-off TBC';let mid;if(f.finished||f.finished_provisional)mid=`<strong class="fixture-score">${f.team_h_score??'?'}–${f.team_a_score??'?'}</strong><small>Full time</small>`;else if(f.started)mid=`<strong class="fixture-score is-live">${f.team_h_score??0}–${f.team_a_score??0}</strong><small class="fixture-live">Live</small>`;else mid=`<strong class="fixture-vs">vs</strong><small>${ts}</small>`;return`<div class="fixture-item"><div class="fixture-team fixture-home"><span class="club-mark" style="--club:${teamColor(f.team_h)}">${h?.short_name||'?'}</span><div><strong>${h?.name||'Home'}</strong><small>Home · FDR ${f.team_h_difficulty}</small></div></div><div class="fixture-center">${mid}</div><div class="fixture-team fixture-away"><div><strong>${a?.name||'Away'}</strong><small>FDR ${f.team_a_difficulty} · Away</small></div><span class="club-mark" style="--club:${teamColor(f.team_a)}">${a?.short_name||'?'}</span></div></div>`;}).join('')}</div>`;
}

/* ══ LIVE (#11 equiv) ═══════════════════════════════════════════ */
function renderLivePanel(){
  const area=el('livePlayerList')||el('liveSquadArea'),summary=el('liveStatsGrid');const{starters}=getSquadGroups();const mp=myPlayers();
  if(!area)return;
  if(!mp.length){setHTML(area.id,emptyState('◎','NO SQUAD','Build your team first.'));return;}
  if(!S.liveData){setHTML(area.id,emptyState('◎','NO LIVE DATA','Live player points appear during active gameweeks.'));return;}
  const sorted=[...starters].sort((a,b)=>(S.liveData[b.id]?.stats?.total_points??0)-(S.liveData[a.id]?.stats?.total_points??0));
  let total=0,bonusTotal=0;
  const rows=sorted.map(p=>{const live=S.liveData[p.id]?.stats||{},pts=Number(live.total_points||0),bonus=Number(live.bonus||0),isC=p.id===S.captainId,eff=isC?pts*2:pts;total+=eff;bonusTotal+=bonus;const bd=buildPtsBreakdown(S.liveData[p.id]);const col=tc(p.teamShort);const ptColor=pts>=10?'var(--green)':pts>=6?'var(--amber)':'var(--text)';return`<div class="team-list-row live-player-row"><div class="team-color-bar" style="background:${col.p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:4px;flex-wrap:wrap">${p.web_name}${isC?'<span class="card-badge badge-amber">Cx2</span>':''}<span class="pos-chip pos-${p.posShort}">${p.posShort}</span>${bonus?`<span class="live-bonus-chip">${bonus} bonus</span>`:''}</div><div style="font-size:.68rem;color:var(--text-sub)">${p.teamShort} · ${live.minutes??0} mins · BPS ${live.bps??0}</div>${bd?`<div class="pts-breakdown">${bd}</div>`:''}</div><div style="text-align:right;flex-shrink:0"><div style="font-family:var(--font-data);font-size:1.3rem;font-weight:700;color:${ptColor}">${eff}</div><small class="live-points-label">${isC?'captain pts':'live pts'}</small></div></div>`;});
  setHTML(area.id,`<div class="live-panel-head"><div><span class="eyebrow">Current squad</span><h2>Live points</h2></div><span class="panel-meta">Provisional while matches are live</span></div>${rows.length?rows.join(''):'<div class="notification-empty">No starters selected.</div>'}`);setText('liveSquadPts',total);if(summary)summary.innerHTML=`<div><small>Squad total</small><strong>${total}</strong><span>captain included</span></div><div><small>Provisional bonus</small><strong>${bonusTotal}</strong><span>current squad</span></div><div><small>Updated</small><strong>${S.liveLastUpdated?new Date(S.liveLastUpdated).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'—'}</strong><span>official live feed</span></div>`;
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
  area.innerHTML=`<div class="weather-grid">${cards.map(c=>`<div class="weather-card"><div class="weather-icon">${c.weather.icon}</div><div class="weather-team">${c.short} vs ${c.vs}</div><div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub);margin-bottom:3px">${c.stadium}</div><div class="weather-temp">${c.weather.temp}°C</div><div class="weather-desc">${c.weather.desc}</div><div class="weather-wind">Wind ${c.weather.wind} km/h</div><div class="weather-impact impact-${c.weather.impact.level}">${c.weather.impact.text}</div></div>`).join('')}</div>`;
}
function getWeatherIcon(main){
  const sun='<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="#F59E0B"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"/></svg>';
  const cloud='<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="#94A3B8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/></svg>';
  const rain='<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="#38BDF8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15zM12 18.75l-1.5 2.25M16 18.75l-1.5 2.25M8 18.75L6.5 21"/></svg>';
  const snow='<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="#BAE6FD"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18M5.636 5.636l12.728 12.728M3 12h18M5.636 18.364L18.364 5.636"/></svg>';
  const fog='<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="#64748B"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18M3 6h18M3 18h18"/></svg>';
  const map={Clear:sun,Clouds:cloud,Rain:rain,Drizzle:rain,Thunderstorm:rain,Snow:snow,Mist:fog,Fog:fog};
  return map[main]||sun;
}
function getWeatherImpact(windSpeed,main){const isRain=['Rain','Drizzle','Thunderstorm'].includes(main);if(windSpeed>12||isRain){return{level:'high',text:'May affect scores'};}if(windSpeed>8){return{level:'med',text:'Slight wind impact'};}return{level:'low',text:'Good conditions'};}

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
      ${sourceStats.map(s => `<span style="font-family:var(--font-data);font-size:.58rem;padding:2px 7px;border-radius:100px;background:${s.ok?'rgba(0,230,118,.1)':'rgba(255,23,68,.1)'};color:${s.ok?'var(--green)':'var(--text-sub)'};border:1px solid ${s.ok?'var(--green-dim)':'var(--border)'}">${s.feed.source} ${s.ok?`(${s.count})`:''}</span>`).join('')}
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
  area.innerHTML=`<div class="card">${scored.map((p,i)=>{const fix=p.upcomingFixtures[0];const trend=p.transfers_in_event>p.transfers_out_event?'▲':'▼';return`<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem 0;border-bottom:1px solid var(--border)"><div style="font-family:var(--font-data);font-size:.82rem;color:var(--text-sub);width:22px;flex-shrink:0">${i+1}</div><div class="team-color-bar" style="background:${tc(p.teamShort).p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.85rem">${trend} ${p.web_name}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${p.teamShort}·${p.posShort}·£${p.price.toFixed(1)}m·${p.selected_by_percent}% own${fix?`·${fix.home?'':'@'}${fix.opponent} FDR${fix.difficulty}`:''}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-family:var(--font-data);font-size:.7rem;color:var(--green)">${(p.transfers_in_event||0).toLocaleString()} in</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--red)">${(p.transfers_out_event||0).toLocaleString()} out</div></div></div>`;}).join('')}</div>`;
}

/* ══ INJURY RISK (#25) ══════════════════════════════════════════ */
function renderInjuryRisk(){
  const area=el('injuryRiskArea');if(!area)return;const mp=myPlayers();if(!mp.length){area.innerHTML=emptyState('','BUILD SQUAD FIRST','Shows risk ratings for your players.');return;}
  const scored=mp.map(p=>{let risk=0;const avgMins=p.minutes/Math.max(1,S.currentGW||1);if(p.chance_of_playing_next_round!==null)risk+=(100-p.chance_of_playing_next_round)*0.4;if(avgMins>85)risk+=20;else if(avgMins>75)risk+=10;if(p.element_type===4)risk+=5;if(parseFloat(p.form)<2)risk+=15;risk=Math.min(100,Math.round(risk));return{...p,injuryRisk:risk};}).sort((a,b)=>b.injuryRisk-a.injuryRisk);
  setHTML('injuryRiskArea',`<div class="card">${scored.map(p=>{const cls=p.injuryRisk>=70?'risk-high':p.injuryRisk>=40?'risk-medium':'risk-low';const color=p.injuryRisk>=70?'var(--red)':p.injuryRisk>=40?'var(--amber)':'var(--green)';return`<div class="injury-row"><div class="team-color-bar" style="background:${tc(p.teamShort).p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.85rem">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div class="injury-meter"><div class="injury-fill ${cls}" style="width:${p.injuryRisk}%"></div></div></div><div style="text-align:right;flex-shrink:0;margin-left:.5rem"><div style="font-family:var(--font-data);font-size:.88rem;font-weight:700;color:${color}">${p.injuryRisk}%</div><div style="font-family:var(--font-data);font-size:.55rem;color:var(--text-sub)">RISK</div></div></div>`;}).join('')}</div>`);
}

/* ══ SEASON PREDICTOR (#26) ═════════════════════════════════════ */
function renderSeasonPredictor(){
  const area=el('seasonPredictorArea');if(!area||!S.players.length)return;
  const teams=Object.values(S.teams).map(t=>{const players=S.players.filter(p=>p.team===t.id&&p.minutes>0);const avgForm=players.length?players.reduce((s,p)=>s+p.formVal,0)/players.length:0;const remainFix=S.allFixtures.filter(f=>!f.finished&&(f.team_h===t.id||f.team_a===t.id)).length;const pts=Math.round(avgForm*remainFix*0.7+Math.random()*5);return{...t,projPts:pts,remainFix};}).sort((a,b)=>b.projPts-a.projPts);
  area.innerHTML=`<div class="projection-card"><div class="projection-card-head"><div><span class="eyebrow">Table projection</span><h3>Form-based outlook</h3></div><span class="projection-badge">38 GW model</span></div><div class="projection-table" role="table" aria-label="Form-based table projection"><div class="projection-table-head"><span>Pos</span><span>Club</span><span>Fixtures</span><span>Signal</span></div>${teams.map((t,i)=>{const pos=i+1,zone=pos<=4?'champions':pos<=6?'europa':pos>=18?'relegation':'';return`<div class="projection-row ${zone}" role="row"><span class="projection-rank">${String(pos).padStart(2,'0')}</span><span class="projection-club"><strong>${t.short_name}</strong><small>${zone==='champions'?'UCL place':zone==='europa'?'Europa place':zone==='relegation'?'Relegation zone':'Form model'}</small></span><span class="projection-fixtures"><strong>${t.remainFix}</strong><small>fixtures</small></span><span class="projection-signal">+${t.projPts}</span></div>`;}).join('')}</div><div class="projection-legend"><span class="legend-ucl">● UCL</span><span class="legend-europa">● Europa</span><span class="legend-relegation">● Relegation</span></div></div>`;
}

/* ══ SQUAD DNA (#27) ════════════════════════════════════════════ */
function renderDNAChart(){
  const area=el('dnaChartArea');if(!area)return;const mp=myPlayers();if(!mp.length){area.innerHTML=emptyState('','BUILD SQUAD FIRST','Squad identity chart.');return;}
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
  if(!S.fplEntryId){area.innerHTML=emptyState('','CONNECT ACCOUNT','Login to track challenges.');return;}
  const current=S.gwHistory?.current||[];const chips=S.gwHistory?.chips?.map(c=>c.name)||[];
  const challenges=[
    {icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z\'/><path stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z\'/></svg>',name:'Half Century',desc:'Score 50+ pts in a GW',done:current.some(g=>g.points>=50)},
    {icon:'',name:'Century Club',desc:'Score 100+ pts in a GW',done:current.some(g=>g.points>=100)},
    {icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941\'/></svg>',name:'Green Arrow',desc:'Gain 100k+ rank in one GW',done:current.some((g,i)=>i>0&&(current[i-1].overall_rank-g.overall_rank)>100000)},
    {icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5\'/></svg>',name:'Chip Master',desc:'Use all 4 chips',done:chips.length>=4},
    {icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z\'/></svg>',name:'Top 1K',desc:'Reach top 1,000 overall',done:current.some(g=>g.overall_rank&&g.overall_rank<=1000)},
    {icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497\'/></svg>',name:'Mini-League King',desc:'Top 3 in any mini-league',done:S.myLeagues?.classic?.some(l=>l.entry_rank<=3)||false},
    {icon:'<svg width=\'16\' height=\'16\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2\' stroke=\'currentColor\'><circle cx=\'12\' cy=\'12\' r=\'9\'/><circle cx=\'12\' cy=\'12\' r=\'3\'/></svg>',name:'Full House',desc:'All 11 starters score 2+ pts',done:false},
    {icon:'',name:'Budget Boss',desc:'Team value over £110m',done:myPlayers().reduce((s,p)=>s+p.price,0)>=110},
  ];
  area.innerHTML=challenges.map(c=>{const badgeCls=c.done?'challenge-done':'challenge-pending';return`<div class="challenge-item"><div class="challenge-icon">${c.icon}</div><div style="flex:1"><div class="challenge-name">${c.name}</div><div class="challenge-desc">${c.desc}</div></div><div class="challenge-badge ${badgeCls}">${c.done?'DONE':'IN PROGRESS'}</div></div>`;}).join('');
}

/* ══ FPL DIARY (#29) ════════════════════════════════════════════ */
function saveDiaryEntry(){const gw=S.currentGW||'?',text=el('diaryEntry')?.value?.trim();if(!text)return;localStorage.setItem(`fpl_diary_${gw}`,JSON.stringify({gw,text,ts:Date.now()}));const msg=el('diarySavedMsg');if(msg){msg.style.display='inline';setTimeout(()=>msg.style.display='none',2000);}loadDiaryHistory();}
function loadDiaryHistory(){const area=el('diaryHistory');if(!area)return;const entries=[];for(let i=1;i<=38;i++){const d=localStorage.getItem(`fpl_diary_${i}`);if(d)try{entries.push(JSON.parse(d));}catch{}}entries.sort((a,b)=>b.gw-a.gw);if(!entries.length){area.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem 0">No diary entries yet.</div>';return;}area.innerHTML=`<div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.5rem">PAST ENTRIES</div>`+entries.map(e=>`<div style="background:var(--deep);border:1px solid var(--border);border-radius:var(--radius);padding:.65rem;margin-bottom:.4rem"><div style="font-family:var(--font-data);font-size:.6rem;color:var(--green);margin-bottom:.35rem">GW${e.gw}·${new Date(e.ts).toLocaleDateString('en-GB')}</div><div style="font-size:.82rem;line-height:1.6;color:var(--text-sub)">${e.text}</div></div>`).join('');}

/* ══ H2H BATTLE (#19) ═══════════════════════════════════════════ */
async function runBattle(){
  const id1=parseInt(el('battleId1')?.value),id2=parseInt(el('battleId2')?.value);
  const area=el('battleResult');if(!area)return;if(!id1||!id2){area.innerHTML=emptyState('','ENTER TWO TEAM IDs','Fill both fields.');return;}
  area.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-sub)">Loading squads...</div>';
  try{
    const gw=S.currentGW||S.nextGW;
    const[r1,r2,e1,e2]=await Promise.all([fplFetch(`/entry/${id1}/event/${gw}/picks/`),fplFetch(`/entry/${id2}/event/${gw}/picks/`),fplFetch(`/entry/${id1}/`),fplFetch(`/entry/${id2}/`)]);
    const[p1,p2,ent1,ent2]=await Promise.all([r1.json(),r2.json(),e1.json(),e2.json()]);
    const getTeam=picks=>picks.map(pk=>{const p=S.players.find(x=>x.id===pk.element);if(!p)return null;const live=S.liveData?.[pk.element]?.stats;const pts=live?live.total_points:p.projectedPts;return{...p,pts,eff:pk.is_captain?pts*2:pts,isCap:pk.is_captain};}).filter(Boolean);
    const team1=getTeam(p1.picks||[]),team2=getTeam(p2.picks||[]);
    const total1=team1.slice(0,11).reduce((s,p)=>s+p.eff,0),total2=team2.slice(0,11).reduce((s,p)=>s+p.eff,0);
    const renderTeam=(players,name,total,win)=>`<div class="battle-team ${win?'battle-winner':''}"><div class="battle-team-name">${name}</div><div class="battle-pts">${Math.round(total*10)/10}<span style="font-family:var(--font-data);font-size:.65rem;color:var(--text-sub)"> pts</span></div>${players.slice(0,11).map(p=>`<div class="battle-player-row"><span>${p.web_name}${p.isCap?' C':''}</span><span class="battle-player-pts">${p.eff}</span></div>`).join('')}</div>`;
    area.innerHTML=`<div class="battle-grid">${renderTeam(team1,ent1.name||`Team ${id1}`,total1,total1>total2)}<div class="battle-vs">VS</div>${renderTeam(team2,ent2.name||`Team ${id2}`,total2,total2>total1)}</div>${total1!==total2?`<div style="text-align:center;font-family:var(--font-display);font-size:1.3rem;color:var(--green);margin-top:.75rem"><strong>${total1>total2?ent1.name||'Team 1':ent2.name||'Team 2'} LEADS</strong></div>`:'<div style="text-align:center;color:var(--amber);margin-top:.75rem;font-family:var(--font-data)">ALL SQUARE</div>'}`;
  }catch(err){area.innerHTML=`<div style="color:var(--red);padding:1rem;font-size:.82rem">Failed: ${err.message}</div>`;}
}

/* ══ TEMPLATE DETECTOR (#18) ════════════════════════════════════ */
async function runTemplateDetector(){
  const id=parseInt(el('templateId')?.value),area=el('templateResult');if(!area)return;if(!id){area.innerHTML=emptyState('','ENTER A TEAM ID','Paste a top manager\'s ID.');return;}
  area.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-sub)">Comparing squads...</div>';
  try{
    const gw=S.currentGW||S.nextGW;const[r,e]=await Promise.all([fplFetch(`/entry/${id}/event/${gw}/picks/`),fplFetch(`/entry/${id}/`)]);const[data,ent]=await Promise.all([r.json(),e.json()]);
    const templateIds=data.picks?.map(pk=>pk.element)||[];const myIds=new Set(S.myTeam);
    const same=templateIds.filter(id=>myIds.has(id)),diff=templateIds.filter(id=>!myIds.has(id));
    const score=Math.round(same.length/Math.max(1,templateIds.length)*100);
    const pName=pid=>{const p=S.players.find(x=>x.id===pid);return p?`${p.web_name} (${p.teamShort})`:`#${pid}`;};
    area.innerHTML=`<div class="cortex-score-card" style="margin-bottom:.75rem"><div><div class="stat-label">TEMPLATE SCORE</div><div class="cortex-score-val">${score}</div><div class="cortex-score-sub">vs ${ent.name||`Entry ${id}`}</div></div><div style="font-family:var(--font-data);font-size:.65rem;text-align:right"><div style="color:var(--green)">${same.length} same</div><div style="color:var(--red)">${diff.length} different</div></div></div><div class="card"><div style="font-family:var(--font-data);font-size:.58rem;color:var(--green);letter-spacing:1.5px;margin-bottom:.4rem">IN COMMON (${same.length})</div><div style="font-size:.82rem;line-height:1.9">${same.map(pName).join(' · ')||'None'}</div><div style="font-family:var(--font-data);font-size:.58rem;color:var(--red);letter-spacing:1.5px;margin-top:.75rem;margin-bottom:.4rem">YOU'RE MISSING (${diff.length})</div><div style="font-size:.82rem;line-height:1.9">${diff.map(pName).join(' · ')||'None'}</div></div>`;
  }catch(err){area.innerHTML=`<div style="color:var(--red);padding:1rem;font-size:.82rem">Failed: ${err.message}</div>`;}
}

/* ══ LEAGUE WAR ROOM (#20) ══════════════════════════════════════ */
async function runWarRoom(){
  const lid=parseInt(el('warRoomLeagueId')?.value),area=el('warRoomResult');if(!area)return;if(!lid){area.innerHTML=emptyState('','ENTER LEAGUE ID','Find it in your FPL leagues page.');return;}
  area.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-sub)">Loading war room...</div>';
  try{
    const res=await fplFetch(`/leagues-classic/${lid}/standings/`);if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();const entries=(data.standings?.results||[]).slice(0,10);
    const gw=S.currentGW||S.nextGW;
    const picksData=await Promise.allSettled(entries.map(e=>fplFetch(`/entry/${e.entry}/event/${gw}/picks/`).then(r=>r.json())));
    const rows=entries.map((entry,i)=>{
      let capName='—',projPts='—';
      if(picksData[i].status==='fulfilled'){const picks=picksData[i].value.picks||[];const cap=picks.find(pk=>pk.is_captain);if(cap){const p=S.players.find(x=>x.id===cap.element);capName=p?p.web_name:'—';}const total=picks.slice(0,11).reduce((s,pk)=>{const p=S.players.find(x=>x.id===pk.element);const ep=p?p.projectedPts:0;return s+(pk.is_captain?ep*2:ep);},0);projPts=Math.round(total*10)/10;}
      const isMe=entry.entry===S.fplEntryId;
      return`<div class="war-room-row ${isMe?'my-row':''}"><div style="flex:1"><div style="font-weight:700;font-size:.85rem">${entry.player_name} <span style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">#${entry.rank}</span></div><div style="font-size:.72rem;color:var(--text-sub)">${entry.entry_name}</div></div><div style="text-align:right"><span class="war-cap">C ${capName}</span><div style="font-family:var(--font-data);font-size:.82rem;color:var(--green);margin-top:2px">${projPts} xP</div></div></div>`;
    });
    area.innerHTML=`<div class="card"><div class="card-header"><span class="card-title">${data.league?.name||'LEAGUE'}</span><span class="card-badge badge-amber">WAR ROOM</span></div>${rows.join('')}</div>`;
  }catch(err){area.innerHTML=`<div style="color:var(--red);padding:1rem;font-size:.82rem">Failed: ${err.message}</div>`;}
}

/* ══ DRAFT ROOM (#21) ═══════════════════════════════════════════ */
function draftQuota(){return{GKP:2,DEF:5,MID:5,FWD:3};}
function draftCounts(list){return list.reduce((a,p)=>{a[p.posShort]=(a[p.posShort]||0)+1;return a;},{GKP:0,DEF:0,MID:0,FWD:0});}
function draftNeeds(list,pos){const q=draftQuota(),c=draftCounts(list);return (c[pos]||0)<q[pos];}
function draftScore(p){return (p.projectedPts||0)*10+(p.formVal||0)*3+(p.total_points||0)*.02-(p.avgFDR||3)*.4;}
function draftRosterValid(list){const c=draftCounts(list),q=draftQuota();return list.length===15&&Object.keys(q).every(k=>c[k]===q[k]);}
function resetDraft(){S.draftState={active:false,round:0,pickNumber:0,myPicks:[],aiPicks:[],available:[],watchlist:[],leagueSize:parseInt(el('draftLeagueSize')?.value||8,10),scoring:el('draftScoring')?.value||'classic'};renderDraftArea();renderDraftList();}
function startDraft(){
  const leagueSize=parseInt(el('draftLeagueSize')?.value||8,10),scoring=el('draftScoring')?.value||'classic';
  const watchlist=S.draftState.watchlist||[];
  const ranked=[...S.players].sort((a,b)=>draftScore(b)-draftScore(a));
  S.draftState={active:true,round:1,pickNumber:1,myPicks:[],aiPicks:[],available:ranked,watchlist,leagueSize,scoring};
  renderDraftArea();renderDraftList();
}
function renderDraftArea(){
  const area=el('draftRoomArea')||el('draftArea');if(!area)return;const d=S.draftState||{};const my=d.myPicks||[],ai=d.aiPicks||[];
  if(!d.active){area.innerHTML='<div class="empty-state"><span class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16v12H4z"/><path d="M8 6V4h8v2M8 10h8M8 14h5"/></svg></span><h3>Build a watchlist, then start</h3><p>Use the player pool to set priorities. Start a practice room when you are ready.</p></div>';setText('draftStatus','Cortex practice mode');return;}
  const myTurn=d.pickNumber%2===1,progress=Math.min(100,(my.length/15)*100),counts=draftCounts(my),complete=my.length>=15;
  const myRows=my.map((p,i)=>`<div class="draft-picked-row"><span class="draft-pick-order">${String(i+1).padStart(2,'0')}</span><span class="draft-picked-player"><strong>${p.web_name}</strong><small>${p.teamShort} · ${p.posShort}</small></span><span class="draft-pick-rank">${i%2?'':'YOU'}</span></div>`).join('');
  const aiRows=ai.map((p,i)=>`<div class="draft-picked-row ai"><span class="draft-pick-order">${String(i+1).padStart(2,'0')}</span><span class="draft-picked-player"><strong>${p.web_name}</strong><small>${p.teamShort} · ${p.posShort}</small></span><span class="draft-pick-rank">AI</span></div>`).join('');
  area.innerHTML=`<div class="draft-room-status"><div><span class="eyebrow">Round ${d.round} · Pick ${Math.min(d.pickNumber,30)}</span><strong>${complete?'Draft complete':myTurn?'Your pick':'AI pick'}</strong></div><div class="draft-progress"><span style="width:${progress}%"></span></div><small>${my.length}/15 players · ${d.scoring==='h2h'?'Head-to-Head':'Classic'} · ${d.leagueSize} teams</small></div><div class="draft-roster-grid"><div class="draft-roster-column"><div class="draft-column-head"><span>Your squad</span><small>${counts.GKP} GKP · ${counts.DEF} DEF · ${counts.MID} MID · ${counts.FWD} FWD</small></div>${myRows||'<div class="draft-empty-line">No picks yet.</div>'}</div><div class="draft-roster-column ai-column"><div class="draft-column-head"><span>Auto managers</span><small>${ai.length} drafted</small></div>${aiRows||'<div class="draft-empty-line">Waiting for the first pick.</div>'}</div></div>${complete?'<div class="draft-complete"><strong>15-player Draft squad complete.</strong><span>No captaincy or budget applies in Draft mode.</span><button class="button button-primary button-small" id="applyDraftBtn" type="button">Use this squad in My Team</button></div>':''}`;
  el('applyDraftBtn')?.addEventListener('click',()=>{S.myTeam=my.map(p=>p.id);S.captainId=null;S.vcaptainId=null;ensurePickOrder();saveTeam();renderPlayerTable();renderMyTeam();renderDashboard();window.goTab?.('myteam');});
  setText('draftStatus',complete?'Practice complete':myTurn?'Your pick':'AI picking…');setText('draftRoomTitle',complete?'Draft squad ready':`Round ${d.round} · ${myTurn?'Your pick':'AI pick'}`);
}
function toggleDraftWatchlist(pid){const d=S.draftState||{};const ids=new Set(d.watchlist||[]);ids.has(pid)?ids.delete(pid):ids.add(pid);S.draftState.watchlist=[...ids];renderDraftList();}
function renderDraftList(){
  const area=el('draftPlayerList');if(!area)return;const d=S.draftState||{};const search=(el('draftSearch')?.value||'').trim().toLowerCase(),posF=el('draftPosFilter')?.value||'';const picked=new Set([...(d.myPicks||[]),...(d.aiPicks||[])].map(p=>p.id));
  let available=(d.active?d.available:S.players).filter(p=>!picked.has(p.id));if(search)available=available.filter(p=>`${p.web_name} ${p.teamShort} ${p.teamName}`.toLowerCase().includes(search));if(posF)available=available.filter(p=>p.posShort===posF);available=available.slice(0,40);const myTurn=!d.active||d.pickNumber%2===1;
  area.innerHTML=available.length?available.map(p=>{const watched=(d.watchlist||[]).includes(p.id),needed=d.active?draftNeeds(d.myPicks,p.posShort):true;return`<div class="draft-pool-row ${watched?'is-watched':''}"><div class="draft-pool-player"><strong>${p.web_name}</strong><small>${p.teamShort} · ${p.posShort} · ${p.formVal.toFixed(1)} form · ${p.projectedPts.toFixed(1)} xP</small></div><span class="draft-pool-signal">${needed?'NEEDS':'FULL'}</span><button class="button button-quiet button-small draft-watch-btn" data-pid="${p.id}" type="button">${watched?'Watched':'Watch'}</button>${d.active&&myTurn&&needed?`<button class="button button-primary button-small draft-pick-btn" data-pid="${p.id}" type="button">Pick</button>`:''}</div>`;}).join(''):'<div class="tool-empty">No available players match these filters.</div>';
  setText('draftPoolMeta',d.active?`${available.length} available · ${d.watchlist?.length||0} watched`:`${S.players.length} players · build your watchlist`);
}
function pickDraftPlayer(pid){
  const d=S.draftState;if(!d.active||d.pickNumber%2!==1)return;const p=d.available.find(x=>x.id===pid);if(!p||!draftNeeds(d.myPicks,p.posShort))return;
  d.myPicks.push(p);d.pickNumber++;d.round=Math.ceil(d.pickNumber/2);
  if(d.myPicks.length<15){const picked=new Set([...d.myPicks,...d.aiPicks].map(x=>x.id));const watch=(d.watchlist||[]).map(id=>d.available.find(x=>x.id===id)).filter(Boolean).find(x=>!picked.has(x.id)&&draftNeeds(d.aiPicks,x.posShort));const ai=d.available.filter(x=>!picked.has(x.id)&&draftNeeds(d.aiPicks,x.posShort)).sort((a,b)=>draftScore(b)-draftScore(a))[0];const choice=watch||ai;if(choice){d.aiPicks.push(choice);d.pickNumber++;d.round=Math.ceil(d.pickNumber/2);}}
  renderDraftArea();renderDraftList();
}

/* ══ FPL ACCOUNT ════════════════════════════════════════════════ */
function openModal(){const m=el('loginModal');if(m){m.classList.remove('hidden');m.style.display='flex';}if(el('fplPasscodeInput'))el('fplPasscodeInput').value='';setChallengeMode(false);toggleLoginMode('companion');resetCompanionUI();clearLoginErr();}
function closeModal(){const m=el('loginModal');if(m){m.classList.add('hidden');m.style.display='none';}clearLoginErr();}
function clearLoginErr(){['loginError','teamLoginError'].forEach(id=>{const e=el(id);if(e){e.style.display='none';e.textContent='';e.classList.remove('show');}})}
function toggleLoginMode(mode){const c=el('companionLoginPanel'),t=el('teamLoginPanel'),title=el('loginTitle');const isCompanion=mode==='companion',isTeam=mode==='team';if(c)c.style.display=isCompanion?'':'none';if(t)t.style.display=isTeam?'':'none';if(title)title.textContent=isTeam?'Connect with Team ID':'Connect your team';if(!isCompanion)setChallengeMode(false);}
function setLoginErr(msg){const e=el('loginError');if(e){e.style.display=msg?'block':'none';e.textContent=msg||'';e.classList.toggle('show',Boolean(msg));}}
function setChallengeMode(enabled,message=''){const panel=el('fplChallengePanel'),form=el('fplConnectForm'),input=el('fplPasscodeInput');if(panel)panel.hidden=!enabled;if(form)form.hidden=enabled;if(enabled&&message)setLoginErr(message);if(!enabled&&input)input.value='';if(enabled)window.setTimeout(()=>input?.focus(),40);}
function resetCompanionUI(){const status=el('companionStatus'),card=el('companionUserCard'),confirm=el('companionConfirmBtn'),btn=el('companionConnectBtn');if(status)status.textContent='Opens in a new tab.';if(card){card.hidden=true;card.innerHTML='';}if(confirm){confirm.hidden=true;confirm.disabled=false;}if(btn){btn.disabled=false;btn.textContent='CONTINUE TO FPL';}S.companionUser=null;}
function startCompanionConnection(){const btn=el('companionConnectBtn'),status=el('companionStatus');if(btn){btn.disabled=true;btn.textContent='OPENING…';}if(status)status.textContent='Complete sign-in in the official tab, then return here.';window.postMessage({type:'CORTEX_START_OFFICIAL_AUTH'},location.origin);window.setTimeout(()=>{if(status&&status.textContent==='Complete sign-in in the official tab, then return here.')status.textContent='Still waiting. Try again or use Team ID instead.';if(btn){btn.disabled=false;btn.textContent='TRY AGAIN';}},90000);}
function handleCompanionMessage(event){if(event.origin!==location.origin)return;if(event.data?.type==='FPLCORTEX_COMPANION_ERROR'){setLoginErr(event.data.message);const status=el('companionStatus');if(status)status.textContent='Sign-in could not be completed.';return;}if(event.data?.type==='FPLCORTEX_COMPANION_STATUS'){const status=el('companionStatus');if(status)status.textContent=event.data.message||'Official FPL session found.';return;}if(event.data?.type!=='FPLCORTEX_SESSION_FOUND'||!event.data.user?.entry)return;const user=event.data.user;S.companionUser=user;const card=el('companionUserCard'),status=el('companionStatus'),confirm=el('companionConfirmBtn');if(status)status.textContent='Official FPL session found. Confirm this team to continue.';if(card){card.hidden=false;card.innerHTML=`<strong>${escapeHTML(`${user.first_name||''} ${user.last_name||''}`.trim()||'FPL manager')}</strong><span>${escapeHTML(user.team_name||'Official FPL team')} · Entry #${Number(user.entry)}</span><small>${Number(user.summary_overall_points||0).toLocaleString()} points · Rank ${Number(user.summary_overall_rank||0).toLocaleString()}</small>`;}if(confirm)confirm.hidden=false;}
function confirmCompanionConnection(){if(!S.companionUser)return;finishFplConnection({user:S.companionUser,companion:true});const status=el('companionStatus');if(status)status.textContent='Connected through the official FPL browser session.';}
function escapeHTML(value){return String(value).replace(/[&<>'"`=\/]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;',"\"":'&quot;','`':'&#96;','=':'&#61;','/':'&#47;'}[char]||char));}
function handleAccountBtn(){if(S.fplEntryId) window.goTab?.('myteam'); else openModal();}

async function restorePreviewEntry(){
  if(!S.previewEntryId) return;
  try{
    const entryRes=await fplFetch(`/entry/${S.previewEntryId}/`);
    if(!entryRes.ok) throw new Error('The saved Team ID is no longer available.');
    const entry=await entryRes.json();
    S.readOnlyPreview=true;
    S.previewPlayer={first_name:entry.player_first_name||'',last_name:entry.player_last_name||'',teamName:entry.name||'',summary_overall_points:entry.summary_overall_points,summary_overall_rank:entry.summary_overall_rank,summary_event_points:entry.summary_event_points,entry:Number(S.previewEntryId),preview:true};
    S.fplPlayer=S.previewPlayer;
    localStorage.setItem('fpl_preview_player',JSON.stringify(S.previewPlayer));
    const gw=S.currentGW||S.nextGW||1, picksRes=await fplFetch(`/entry/${S.previewEntryId}/event/${gw}/picks/`);
    if(picksRes.ok){const picks=await picksRes.json();if(Array.isArray(picks.picks)&&picks.picks.length) applyFplTeam({picks:picks.picks});}
    updateAccountUI(); renderAll();
  }catch(error){console.warn('Preview restore:',error.message);}
}

async function restoreFplConnection(){
  try{
    const {data}=await cortexApi('connection');
    if(!data.connected){S.fplEntryId=null;S.fplPlayer=S.previewPlayer||null;updateAccountUI();return;}
    S.fplEntryId=data.entryId||S.fplEntryId;const user=data.user||{};if(user.entry||S.fplEntryId)S.fplPlayer={first_name:user.first_name||'',last_name:user.last_name||'',teamName:user.team_name||'',summary_overall_points:user.summary_overall_points,summary_overall_rank:user.summary_overall_rank,summary_event_points:user.summary_event_points,entry:S.fplEntryId};
    updateAccountUI();await importFplTeam();
  }catch(error){console.warn('Connection restore:',error.message);}
}

function finishFplConnection(data){const user=data.user||{};S.fplEntryId=user.entry||null;S.readOnlyPreview=false;S.previewEntryId=null;S.previewPlayer=null;S.fplPlayer={first_name:user.first_name||'',last_name:user.last_name||'',teamName:user.team_name||'',summary_overall_points:user.summary_overall_points,summary_overall_rank:user.summary_overall_rank,summary_event_points:user.summary_event_points,entry:S.fplEntryId};if(S.fplEntryId)localStorage.setItem('fpl_entry_id',String(S.fplEntryId));localStorage.setItem('fpl_player',JSON.stringify(S.fplPlayer));closeModal();updateAccountUI();if(data.team)applyFplTeam(data.team);else importFplTeam();window.goTab?.('myteam');}
async function connectFplAccount(event){event?.preventDefault?.();const email=el('fplEmailInput')?.value.trim(), password=el('fplPasswordInput')?.value||'', btn=el('connectFplBtn');if(!email||!password){setLoginErr('Enter your FPL email and password.');return;}clearLoginErr();if(btn){btn.textContent='CONNECTING…';btn.disabled=true;}try{const {data}=await cortexApi('connect',{method:'POST',body:JSON.stringify({email,password})});if(el('fplPasswordInput'))el('fplPasswordInput').value='';if(!data.ok){if(data.error==='FPL_CHALLENGE_REQUIRED'){setChallengeMode(true,data.message||'Enter the code Premier League sent you.');return;}const messages={FPL_AUTH_FAILED:'Premier League rejected the supplied credentials.',FPL_ACCOUNT_NOT_FOUND:'No Premier League account was found for that email.',FPL_FORBIDDEN:'Premier League refused the connection.',FPL_UNAVAILABLE:'Premier League is unavailable right now. Try again in a moment.',FPL_RATE_LIMITED:'Premier League is rate-limiting requests. Wait a little and try again.',FPL_TEAM_NOT_FOUND:'The account connected, but its FPL team could not be loaded.'};setLoginErr(messages[data.error]||data.message||'FPL authentication failed.');return;}finishFplConnection(data);}catch(error){setLoginErr('Premier League is unavailable right now. Please try again later.');}finally{if(btn){btn.textContent='CONNECT FPL ACCOUNT';btn.disabled=false;}}}
async function verifyFplChallenge(){const email=el('fplEmailInput')?.value.trim(),passcode=el('fplPasscodeInput')?.value.trim(),btn=el('fplChallengeBtn');if(!passcode){setLoginErr('Enter the verification code.');return;}clearLoginErr();if(btn){btn.textContent='VERIFYING…';btn.disabled=true;}try{const {data}=await cortexApi('challenge',{method:'POST',body:JSON.stringify({email,passcode})});if(!data.ok){setLoginErr(data.message||'That code could not be verified.');return;}if(el('fplPasscodeInput'))el('fplPasscodeInput').value='';finishFplConnection(data);}catch(error){setLoginErr('Premier League is unavailable right now. Please try again later.');}finally{if(btn){btn.textContent='VERIFY AND CONTINUE';btn.disabled=false;}}}

async function connectRefreshToken(){
  const tokenInput=el('fplRefreshTokenInput'),teamInput=el('tokenTeamIdInput'),error=el('tokenLoginError'),btn=el('tokenConnectBtn');
  const refreshToken=(tokenInput?.value||'').trim(),teamId=(teamInput?.value||'').trim();
  const show=(message)=>{if(error){error.textContent=message;error.classList.add('show');error.style.display='block';}};
  if(error){error.textContent='';error.classList.remove('show');error.style.display='none';}
  if(refreshToken.length<80){show('Paste a valid refresh token from your official FPL browser session.');return;}
  if(teamId&&!/^\d{1,12}$/.test(teamId)){show('Enter a valid numeric Team ID or leave it blank.');return;}
  if(btn){btn.disabled=true;btn.textContent='CONNECTING SESSION…';}
  try{
    const {data}=await cortexApi('token-connect',{method:'POST',body:JSON.stringify({refreshToken,teamId})});
    if(tokenInput)tokenInput.value='';
    if(!data.ok){show(data.message||'The FPL session could not be connected.');return;}
    finishFplConnection(data);
  }catch(errorValue){show(errorValue.message||'Premier League is unavailable right now.');}
  finally{if(btn){btn.disabled=false;btn.textContent='CONNECT EXISTING SESSION';}}
}
async function connectTeamIdPreview(){
  const input=el('teamIdInput'), id=(input?.value||'').trim(), error=el('teamLoginError'), btn=el('teamIdConnectBtn');
  const show=(message)=>{ if(error){error.textContent=message;error.classList.add('show');error.style.display='block';} };
  if(error){error.textContent='';error.classList.remove('show');error.style.display='none';}
  if(!/^\d{1,12}$/.test(id)){show('Enter a valid numeric FPL Team ID.');return;}
  if(btn){btn.disabled=true;btn.textContent='LOADING TEAM…';}
  try{
    const entryRes=await fplFetch(`/entry/${id}/`);
    if(!entryRes.ok) throw new Error('No FPL team was found for that ID.');
    const entry=await entryRes.json();
    S.fplEntryId=null; S.previewEntryId=Number(id); S.readOnlyPreview=true;
    S.previewPlayer={first_name:entry.player_first_name||'',last_name:entry.player_last_name||'',teamName:entry.name||'',summary_overall_points:entry.summary_overall_points,summary_overall_rank:entry.summary_overall_rank,summary_event_points:entry.summary_event_points,entry:Number(id),preview:true};
    S.fplPlayer=S.previewPlayer;
    localStorage.setItem('fpl_preview_entry_id',String(id));
    localStorage.setItem('fpl_preview_player',JSON.stringify(S.previewPlayer));
    const gw=S.currentGW||S.nextGW||1;
    const picksRes=await fplFetch(`/entry/${id}/event/${gw}/picks/`);
    if(picksRes.ok){const picks=await picksRes.json();if(Array.isArray(picks.picks)&&picks.picks.length)applyFplTeam({picks:picks.picks});}
    updateAccountUI();closeModal();renderAll();window.goTab?.('myteam');
  }catch(errorValue){show(errorValue.message||'The FPL team could not be loaded.');}
  finally{if(btn){btn.disabled=false;btn.textContent='LOAD TEAM';}}
}

async function searchManager(){ return connectTeamIdPreview(); }

function updateAccountUI(){
  const lbl=el('menuUserLabel');
  const strip=el('statsStrip');
  if(lbl) lbl.textContent = S.fplPlayer ? (S.fplPlayer.first_name||'') : '';
  if(strip) strip.style.display = S.fplPlayer ? 'flex' : 'none';
  const dn=el('ddName'),ds=el('ddSub'),da=el('ddAvatar'),dsb=el('ddSignBtn'),dso=el('ddSignOut');
  if(S.fplPlayer){
    if(dn) dn.textContent=S.fplPlayer.first_name+' '+S.fplPlayer.last_name;
    if(ds) ds.textContent = S.readOnlyPreview ? 'Team ID access · read-only' : 'FPL Entry: '+S.fplEntryId;
    if(da) da.classList.add('on');
    const sbName=el('sbName'),sbSub=el('sbSub'); if(sbName)sbName.textContent=S.fplPlayer.first_name+' '+S.fplPlayer.last_name; if(sbSub)sbSub.textContent=S.readOnlyPreview?'Team ID access':'FPL account connected';
    if(dsb) dsb.style.display='none';
    if(dso) dso.style.display='';
    // Show account bar
    const ab=el('fplAccountBar');
    if(ab){ab.style.display='flex';
      const mn=el('fplManagerName');if(mn)mn.textContent=S.fplPlayer.first_name+' '+S.fplPlayer.last_name;
      const mt=el('fplTeamMeta');if(mt)mt.textContent = S.readOnlyPreview ? 'Team ID access · Entry '+S.previewEntryId : 'FPL Entry: '+S.fplEntryId;
    }
    // Update AI hero
    if(window.updateAIHero) window.updateAIHero(S.entry||S.fplPlayer,null);
  } else {
    if(dn) dn.textContent='Not signed in';
    if(ds) ds.textContent='Connect your FPL account';
    if(da) da.classList.remove('on');
    if(dsb) dsb.style.display='';
    if(dso) dso.style.display='none';
    const ab=el('fplAccountBar');if(ab) ab.style.display='none';
  }
}
async function logout(){try{await cortexApi('connection',{method:'DELETE'});}catch{}S.fplEntryId=null;S.previewEntryId=null;S.previewPlayer=null;S.readOnlyPreview=false;S.fplPlayer=null;['fpl_preview_entry_id','fpl_preview_player'].forEach(k=>localStorage.removeItem(k));S.myLeagues={classic:[],h2h:[]};S.gwHistory=null;['fpl_entry_id','fpl_player','fpl_leagues'].forEach(k=>localStorage.removeItem(k));updateAccountUI();renderDashboard();renderLeaguesTab();el('seasonStatsSection')?.style&& (el('seasonStatsSection').style.display='none');el('historyChartSection')?.style&& (el('historyChartSection').style.display='none');}

async function importFplTeam(){
  if(S.readOnlyPreview){return connectTeamIdPreview();}
  if(!S.fplEntryId)return;
  try{
    const {data}=await cortexApi('my-team');
    if(!data.ok){if(data.error==='FPL_SESSION_EXPIRED')logout();return;}
    applyFplTeam(data.team);
  }catch(error){console.warn('Import:',error.message);}
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
async function loadLeaguesList(){if(S.myLeagues?.classic?.length||S.myLeagues?.h2h?.length){renderLeagueLists(S.myLeagues);return;}setHTML('classicLeaguesList','<div style="color:var(--text-sub);padding:.5rem;font-size:.78rem">Loading...</div>');try{const res=await fplFetch(`/entry/${S.fplEntryId}/`, true);if(!res.ok)throw new Error();const data=await res.json();S.myLeagues=data.leagues||{classic:[],h2h:[]};localStorage.setItem('fpl_leagues',JSON.stringify(S.myLeagues));renderLeagueLists(S.myLeagues);}catch{setHTML('classicLeaguesList','<div style="color:var(--red);font-size:.78rem;padding:.5rem">Failed to load leagues.</div>');}}
function renderLeagueLists(leagues){const render=(list,id)=>{const e=el(id);if(!e)return;if(!list?.length){e.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem 0">No leagues.</div>';return;}e.innerHTML=list.map(l=>`<div class="league-item" data-lid="${l.id}" data-name="${l.name||l.league_name||'League'}"><div><div class="league-name">${l.name||l.league_name||'—'}</div><div class="league-meta">ID: ${l.id}·Rank: ${l.entry_rank?.toLocaleString()||'—'}</div></div><span style="color:var(--text-sub)">›</span></div>`).join('');};render(leagues.classic||[],'classicLeaguesList');render(leagues.h2h||[],'h2hLeaguesList');}

async function loadStandings(lid,type,name,page=1){
  S.currentLeagueId=lid;S.currentLeagueType=type;const panel=el('standingsPanel'),title=el('standingsTitle'),table=el('standingsTable');if(!panel)return;panel.style.display='block';if(title&&name)title.textContent=name.toUpperCase();if(table)table.innerHTML='<div style="padding:1rem;color:var(--text-sub)">Loading...</div>';
  try{const ep=type==='h2h'?`/leagues-h2h/${lid}/standings/?page_standings=${page}`:`/leagues-classic/${lid}/standings/?page_standings=${page}`;const res=await fplFetch(ep);if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();const rows=data.standings?.results||[];if(!rows.length){if(table)table.innerHTML='<div style="padding:1rem;color:var(--text-sub)">No data.</div>';return;}if(table)table.innerHTML=`<div class="standings-row header"><div>#</div><div>Manager</div><div>GW</div><div>Total</div><div>±</div></div>${rows.map(r=>{const isMine=r.entry===S.fplEntryId,top3=r.rank<=3,mv=(r.last_rank||r.rank)-r.rank,mCls=mv>0?'move-up':mv<0?'move-down':'move-same',mStr=mv>0?`▲${mv}`:mv<0?`▼${Math.abs(mv)}`:'–';return`<div class="standings-row ${isMine?'my-entry':''}"><div class="s-rank ${top3?'top3':''}">${r.rank}</div><div><div style="font-weight:700;font-size:.82rem">${r.player_name}</div><div style="font-size:.68rem;color:var(--text-sub)">${r.entry_name}</div></div><div style="text-align:right;font-family:var(--font-data);font-size:.78rem">${r.event_total}</div><div class="s-pts">${r.total}</div><div class="s-move ${mCls}">${mStr}</div></div>`;}).join('')}`;if(type==='classic'&&S.fplEntryId)renderH2HTracker(rows);const pag=el('standingsPagination');if(pag){let ph='';if(page>1)ph+=`<button class="page-btn" data-page="${page-1}">‹ Prev</button>`;ph+=`<span style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">Page ${page}</span>`;if(data.standings?.has_next)ph+=`<button class="page-btn" data-page="${page+1}">Next ›</button>`;pag.innerHTML=ph;}}
  catch(err){if(table)table.innerHTML=`<div style="padding:1rem;color:var(--red)">Failed: ${err.message}</div>`;}
}
function renderH2HTracker(rows){const myIdx=rows.findIndex(r=>r.entry===S.fplEntryId);if(myIdx<0)return;const rivals=[];if(myIdx>0)rivals.push({...rows[myIdx-1],relation:'↑ Above you'});rivals.push({...rows[myIdx],relation:'You',isMe:true});if(myIdx<rows.length-1)rivals.push({...rows[myIdx+1],relation:'↓ Below you'});const section=el('h2hTrackerSection'),area=el('h2hTrackerArea');if(!section||!area)return;section.style.display='block';area.innerHTML=rivals.map(r=>`<div class="h2h-row ${r.isMe?'my-row':''}"><div><div class="h2h-manager">${r.player_name} <span style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">#${r.rank}</span></div><div class="h2h-meta">${r.entry_name}·${r.relation}</div></div><div class="h2h-pts" style="color:${r.isMe?'var(--green)':'var(--text)'}">${r.total}</div></div>`).join('');}
function hideStandings(){const p=el('standingsPanel');if(p)p.style.display='none';}

/* ══ HELPERS ════════════════════════════════════════════════════ */
const el = id => document.getElementById(id);
function myPlayers(){return S.players.filter(p=>S.myTeam.includes(p.id));}
function setText(id,v){const e=el(id);if(e)e.textContent=v;}
function setHTML(id,v){const e=el(id);if(e)e.innerHTML=v;}
function pad(n){return String(n).padStart(2,'0');}
function emptyState(icon,h,p){return`<div class="empty-state">${icon?`<div class="icon">${icon}</div>`:''}<h3>${h}</h3><p>${p}</p></div>`;}

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
      new Notification(' No Captain Set!', {
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
    <section class="planner-card" aria-label="Transfer planner">
      <div class="planner-card-head"><div><span class="eyebrow">Transfer planner</span><h3>Plan the next three GWs</h3></div><span class="planner-badge">NEXT 3 GWs</span></div>
      <div id="plannerRows" class="planner-rows">${saved.length ? saved.map((row,i) => plannerRowHTML(row, i)).join('') : '<div class="planner-empty">No planned transfers yet.</div>'}</div>
      <div class="planner-card-foot"><button class="button button-primary button-small" id="addPlanRowBtn" type="button">Add transfer</button><span class="planner-cost">Cost <strong id="plannerCostDisplay">${saved.reduce((s,r)=>s+(parseFloat(r.cost)||0),0).toFixed(1)}m</strong> net</span></div>
    </section>`;

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
  return `<div class="planner-row">
    <label class="planner-gw">GW<input class="planner-input" data-idx="${i}" data-field="gw" type="number" value="${row.gw}" aria-label="Gameweek" /></label>
    <label class="planner-field planner-out"><span>Sell</span><input class="planner-input" data-idx="${i}" data-field="out" type="text" value="${row.out}" placeholder="Player out" aria-label="Player to sell" /></label>
    <span class="planner-arrow" aria-hidden="true">to</span>
    <label class="planner-field planner-in"><span>Buy</span><input class="planner-input" data-idx="${i}" data-field="in" type="text" value="${row.in}" placeholder="Player in" aria-label="Player to buy" /></label>
    <label class="planner-cost-input">£<input class="planner-input" data-idx="${i}" data-field="cost" type="number" step=".1" value="${row.cost}" aria-label="Net cost" /></label>
    <button class="planner-delete" data-idx="${i}" type="button" aria-label="Remove transfer">×</button>
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
      <div class="h2h-meta">${r.entry_name}${isMe?' · You':''}</div></div>
      <div class="h2h-pts" style="color:${isMe?'var(--green)':'var(--text)'}">${r.total}${livePts}</div>
    </div>`;
  }).join('');
}

/* ══ 5. AI GW PREVIEW REPORT ════════════════════════════════════ */
async function generateGWPreview() {
  const area = el('aiPreviewArea'); if (!area) return;
  area.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-sub)"> Generating preview...</div>';

  // Always use the NEXT gameweek for preview — never a past one
  const targetGW = S.nextGW || (S.currentGW ? S.currentGW + 1 : null) || S.currentGW;
  const gwLabel = `GW${targetGW}`;

  // Build rich fixture context from live data
  const topPlayers = S.players
    .filter(p => p.projectedPts > 0 && parseFloat(p.form) > 4)
    .sort((a,b) => b.projectedPts - a.projectedPts)
    .slice(0, 20)
    .map(p => `${p.web_name}(${p.teamShort},${p.posShort},£${p.price}m,form:${p.form},proj:${p.projectedPts})`)
    .join('; ');

  const mySquad = buildSquadCtx();
  const hasSquad = S.myTeam.length > 0;

  try {
    const prompt = `You are an expert FPL analyst. Today's date context: this is a preview for ${gwLabel}.
${hasSquad ? `Manager's squad: ${mySquad}` : 'No squad connected — give general advice.'}
Top projected players this week: ${topPlayers}

Write a sharp, specific ${gwLabel} preview. Use ONLY players and fixtures relevant to ${gwLabel}. Do NOT reference past gameweeks as future ones.

Format exactly as:
**CAPTAIN PICK:** [best captain for ${gwLabel} with fixture + stat reason, 2 sentences]
**KEY TRANSFER:** [one transfer worth considering for ${gwLabel} with fixture context]  
**PLAYERS TO WATCH:** [3 players with good ${gwLabel} fixtures worth owning]
**AVOID THIS WEEK:** [2 players with tough ${gwLabel} fixtures or poor form]
**CHIP WINDOW:** [is ${gwLabel} worth using a chip, or hold — be specific]
**BOLD PREDICTION:** [one confident prediction for ${gwLabel}]

Keep each section to 2 sentences max. Be specific about opponents and form.`;

    const reply = await groqChat([{ role:'user', content:prompt }], 600);
    const formatted = reply
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--amber)">$1</strong>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    area.innerHTML = `
      <div class="card" style="line-height:1.85;font-size:.83rem">${formatted}</div>
      <button class="btn btn-outline btn-sm" style="margin-top:.75rem" id="sharePreviewBtn">
         SHARE REPORT
      </button>`;
    el('sharePreviewBtn')?.addEventListener('click', () => {
      const txt = area.innerText;
      if (navigator.share) navigator.share({ title: `My ${gwLabel} FPL Preview`, text: txt });
      else { navigator.clipboard?.writeText(txt); alert('Copied to clipboard!'); }
    });
  } catch (err) {
    area.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:.82rem">Could not generate preview: ${err.message}</div>`;
  }
}

/* ══ 6. AI POST-GW REVIEW ═══════════════════════════════════════ */
async function generatePostGWReview() {
  const area = el('aiReviewArea'); if (!area) return;

  if (!S.gwHistory) {
    area.innerHTML = '<div style="color:var(--text-sub);padding:1rem;font-size:.82rem;line-height:1.6">Connect your FPL account to get a personalised GW review with your actual scores and rank movement.</div>';
    return;
  }

  area.innerHTML = '<div class="empty-state"><div class="icon"><svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h12M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-12"/></svg></div><h3>REVIEWING GW...</h3></div>';

  const lastGW = S.gwHistory.current?.slice(-1)[0];
  if (!lastGW) {
    area.innerHTML = '<div style="color:var(--text-sub);padding:1rem;font-size:.82rem">No completed gameweek data found yet.</div>';
    return;
  }

  const pts = lastGW.points;
  const rank = lastGW.overall_rank?.toLocaleString() || '—';
  const rankChange = lastGW.rank_sort;
  const gwAvg = S.bootstrap?.events?.find(e => e.id === lastGW.event)?.average_entry_score || '—';
  const squadCtx = buildSquadCtx();

  // Tone guidance based on score vs average
  const scoredWell = gwAvg !== '—' && pts >= parseInt(gwAvg);

  try {
    const prompt = `You are a supportive, encouraging FPL coach reviewing GW${lastGW.event} for a manager.

Their result: ${pts} points (GW average was ${gwAvg}). Overall rank: ${rank}. ${rankChange > 0 ? `Rank improved.` : rankChange < 0 ? `Rank dropped.` : ''}
Squad context: ${squadCtx}

Write a warm, constructive post-GW review as their personal coach. Tone: positive and forward-looking${scoredWell ? ' — they did well, celebrate it' : ' — acknowledge it was tough but keep them motivated'}.

Structure (3 short paragraphs, under 160 words total):
1. Highlight something that went right or a player who delivered — find a positive even if the score was low
2. One thing to learn or improve — phrase it as an opportunity, not a failure
3. A clear, optimistic action point for the next gameweek — transfer target, captain option, or chip to consider

Never say things like "nothing went well" or "the lack of a squad was the main issue". Always find something constructive. Keep it under 160 words.`;

    const reply = await groqChat([{ role:'user', content:prompt }], 400);
    const rankDir = rankChange > 0 ? `<span style="color:var(--green)">▲ ${rankChange.toLocaleString()}</span>` :
                    rankChange < 0 ? `<span style="color:var(--red)">▼ ${Math.abs(rankChange).toLocaleString()}</span>` :
                    `<span style="color:var(--text-sub)">— no change</span>`;

    area.innerHTML = `
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;flex-wrap:wrap;gap:.4rem">
          <div style="font-family:var(--font-data);font-size:.62rem;color:var(--amber);letter-spacing:1px"> GW${lastGW.event} REVIEW</div>
          <div style="display:flex;gap:.75rem;font-family:var(--font-data);font-size:.65rem">
            <span><span style="color:var(--text-sub)">PTS </span><strong style="color:var(--green)">${pts}</strong></span>
            <span><span style="color:var(--text-sub)">AVG </span><strong>${gwAvg}</strong></span>
            <span><span style="color:var(--text-sub)">RANK </span>${rankDir}</span>
          </div>
        </div>
        <div style="font-size:.83rem;line-height:1.75;color:var(--text)">${reply.replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>')}</div>
      </div>`;
  } catch (err) {
    area.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:.82rem">Could not generate review: ${err.message}</div>`;
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
    el('voiceBtn').textContent = '';
  };
  voiceRecognition.onend = () => { const b = el('voiceBtn'); if (b) b.textContent = ''; };
  voiceRecognition.onerror = () => { const b = el('voiceBtn'); if (b) b.textContent = ''; };
}
function toggleVoice() {
  if (!voiceRecognition) { alert('Voice not supported on this browser.'); return; }
  const btn = el('voiceBtn');
  if (btn.textContent === '') { voiceRecognition.stop(); btn.textContent = ''; }
  else { voiceRecognition.start(); btn.textContent = ''; }
}

/* ══ 8. AI CORTEX SCORE EXPLAINER ══════════════════════════════ */
async function explainCortexScore() {
  const area = el('cortexExplainArea'); if (!area) return;
  area.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-sub)"> Analysing your squad...</div>';
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
    <div class="modal-header"><div class="modal-title">${p.web_name} — SEASON POINTS</div><button class="modal-close" onclick="el('timelineModal').style.display='none'"></button></div>
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
  area.innerHTML = `<div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub);margin-bottom:.5rem;padding:.25rem 0"> FPL API no longer exposes xG — using Threat & Creativity indices as proxies</div>
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
    <div class="card"><div class="card-header"><span class="card-title">PREDICTED RISERS</span></div>${rising.map(p=>card(p,1)).join('')||'<div style="color:var(--text-sub);font-size:.78rem">No strong signals</div>'}</div>
    <div class="card"><div class="card-header"><span class="card-title">PREDICTED FALLERS</span></div>${falling.map(p=>card(p,-1)).join('')||'<div style="color:var(--text-sub);font-size:.78rem">No strong signals</div>'}</div>
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
    <div class="modal-header"><div class="modal-title">PLAYER CARD</div><button class="modal-close" onclick="el('cardGenModal').style.display='none'"></button></div>
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
      <button class="btn btn-green" style="width:100%;justify-content:center;margin-top:.75rem" onclick="sharePlayerCard('${p.web_name}',${pid})"> Share Card</button>
    </div>
  </div>`;
}
function sharePlayerCard(name, pid) {
  const p = S.players.find(x => x.id === pid); if (!p) return;
  const text = `${p.web_name} | ${p.teamShort} · ${p.posShort}\nForm: ${p.form} | £${p.price.toFixed(1)}m | xPts: ${p.projectedPts}\n\nvia FPL Cortex — fpl-cortex.vercel.app`;
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
    <div style="font-size:.78rem;color:var(--text-sub);padding:.5rem 0;text-align:center"> Global leaderboard connects FPL Cortex users worldwide.<br>Your score: <strong style="color:var(--green)">${myScore||'—'} pts</strong> · Rank: <strong style="color:var(--amber)">${myRank?.toLocaleString()||'—'}</strong></div>
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
    area.innerHTML = `<div class="card" style="margin-bottom:.75rem"><div class="card-header"><span class="card-title"> ${ent.name||'Rival'}</span><span class="card-badge badge-red">RIVAL</span></div>
      <div class="grid-3" style="margin-bottom:.75rem">
        <div class="entry-stat"><div class="entry-stat-val">${rivalTotal}</div><div class="entry-stat-lbl">Season Pts</div></div>
        <div class="entry-stat"><div class="entry-stat-val">${rivalRank?.toLocaleString()||'—'}</div><div class="entry-stat-lbl">Overall Rank</div></div>
        <div class="entry-stat"><div class="entry-stat-val">${shared}/15</div><div class="entry-stat-lbl">Shared Players</div></div>
      </div>
      <div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-bottom:.5rem">GW${gw} CAPTAIN: <strong style="color:var(--amber)">${capPlayer?.web_name||'Unknown'}</strong></div>
      <div style="font-size:.78rem;color:${myTotal>rivalTotal?'var(--green)':'var(--red)'};font-weight:700">${myTotal>rivalTotal?` You're ahead by ${myTotal-rivalTotal} pts`:` Behind by ${rivalTotal-myTotal} pts — catch up!`}</div>
    </div>
    <div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-bottom:.4rem">RIVAL'S GW${gw} SQUAD</div>
    <div class="card">${rivalPicks.slice(0,11).map(pk => {
      const p = S.players.find(x => x.id === pk.element);
      const inMine = S.myTeam.includes(pk.element);
      return p ? `<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)"><div class="team-color-bar" style="background:${tc(p.teamShort).p};height:28px"></div><div style="flex:1;font-size:.82rem;font-weight:700">${p.web_name}${pk.is_captain?' C':pk.is_vice_captain?' V':''}</div><span class="pos-chip pos-${p.posShort}">${p.posShort}</span>${inMine?'<span style="font-family:var(--font-data);font-size:.52rem;color:var(--green)"> SAME</span>':'<span style="font-family:var(--font-data);font-size:.52rem;color:var(--amber)">≠ DIFF</span>'}</div>` : '';
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
    if (dx < 0 && idx < tabs.length - 1) window.goTab?.(tabs[idx + 1]);
    if (dx > 0 && idx > 0)              window.goTab?.(tabs[idx - 1]);
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


// ── AI HERO CARD ──────────────────────────────
function updateAIHeroCard(entry, captainPick) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const greetEl = document.getElementById('heroGreeting');
  if (greetEl) greetEl.textContent = greeting + (entry ? ', ' + entry.player_first_name : ', Manager') + ' ';
  if (entry) {
    const insightEl = document.getElementById('heroInsight');
    if (insightEl) {
      const rank = entry.summary_overall_rank;
      const pct = rank ? Math.round((1 - rank / 12000000) * 100) : null;
      insightEl.innerHTML = pct
        ? 'Your projected score is above<br><strong>' + pct + '%</strong> of managers this week.'
        : 'Your team is connected. Check your AI analysis below.';
    }
  }
  if (captainPick) {
    const row = document.getElementById('heroCaptainRow');
    if (row) row.style.display = 'flex';
    const nameEl = document.getElementById('heroCaptainName');
    const ptsEl  = document.getElementById('heroCaptainPts');
    const confEl = document.getElementById('heroCaptainConf');
    if (nameEl) nameEl.textContent = captainPick.name || '—';
    if (ptsEl)  ptsEl.textContent  = (captainPick.ep_next || '—') + ' xPts';
    if (confEl) confEl.textContent  = (captainPick.conf || '93') + '%';
  }
}


// Global safety net
window.addEventListener('unhandledrejection', function(e) {
  console.warn('Unhandled promise rejection:', e.reason);
  const ls = el('loadingScreen');
  if (ls && ls.style.opacity !== '0') {
    ls.style.opacity = '0';
    setTimeout(() => { try { ls.remove(); } catch(ex){} }, 300);
  }
});

function buildJersey(p,isCap,isVC){
  if(!p)return'<div class="pitch-empty">+</div>';
  const color=teamColor(p.teamId);
  const code=p.code||p.id;
  const photoUrl=`https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`;
  const capBadge=isCap?'<span class="cap-badge">C</span>':isVC?'<span class="vc-badge">V</span>':'';
  const pts=p.total_points||0;
  return`<div class="pitch-card" onclick="showActionSheet(${p.id})">
    <div class="pitch-photo-wrap" style="border-color:${color}40">${capBadge}
      <img class="pitch-photo" src="${photoUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="${p.web_name}" loading="lazy"/>
      <div class="pitch-photo-fallback" style="background:${color}22;display:none">
        <svg viewBox="0 0 40 40" width="28" height="28" fill="none"><path d="M8 12 C8 6 14 4 20 4 C26 4 32 6 32 12 L32 18 C32 18 29 16 26 17 L24 14 L24 28 L16 28 L16 14 L14 17 C11 16 8 18 8 18 Z" fill="${color}" opacity="0.9"/></svg>
      </div>
    </div>
    <div class="pitch-name">${p.web_name}</div>
    <div class="pitch-pts">${pts}pts</div>
  </div>`;
}

/* ── MERGED ANALYSIS MODULES ───────────────────────────────────── */
/* ═══════════════════════════════════════════════
   FPL CORTEX — Premium Feature Upgrades
   script-additions.js — All 13 new features
   Load AFTER script.js
═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── HELPERS ───────────────────────────────
  const gel = id => document.getElementById(id);
  const qsel = s => document.querySelector(s);
  const qall = s => document.querySelectorAll(s);
  const setInner = (id, h) => { const e = gel(id); if (e) e.innerHTML = h; };

  // FDR colour
  const fdrColor = v => ['','#00e676','#80e27e','#ffab00','#ff5252','#b71c1c'][v] || '#64748b';

  // Position chip
  const posChip = p => {
    const c = { GKP:'var(--amber)', DEF:'var(--blue)', MID:'var(--green)', FWD:'var(--red)' };
    return `<span class="pos-chip pos-${p}" style="background:${c[p]||'var(--text-sub)'};color:#060a12">${p}</span>`;
  };

  // Form badge colour
  const formColor = f => {
    const n = parseFloat(f) || 0;
    if (n >= 7) return { bg: 'var(--green-glow)', color: 'var(--green)', border: 'var(--green-dim)' };
    if (n >= 4) return { bg: 'var(--amber-glow)', color: 'var(--amber)', border: 'var(--amber)' };
    return { bg: 'var(--red-glow)', color: 'var(--red)', border: 'var(--red)' };
  };

  // Mini SVG spark-line
  function sparkLine(vals, color = 'var(--green)', h = 32) {
    if (!vals.length) return '';
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const w = 80;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / range) * h * 0.85 - h * 0.075;
      return `${x},${y}`;
    }).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" style="display:block">
      <polyline points="${pts}" stroke="${color}" stroke-width="1.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  // ─── COMMAND PALETTE ──────────────────────
  const CMD_ITEMS = [
    { icon: '⬡', label: 'Dashboard',        sub: 'GW History · Captain AI · Risk',    tab: 'dashboard' },
    { icon: '◈', label: 'Players',          sub: 'Browse & add players',              tab: 'players'   },
    { icon: '◉', label: 'My Team',          sub: 'Squad view · Live points',          tab: 'myteam'    },
    { icon: '⇄', label: 'Transfers',        sub: 'Transfer Intel · GW Trends',        tab: 'transfers' },
    { icon: '◷', label: 'Fixtures',         sub: 'FDR Calendar · Blank/DGW',          tab: 'fixtures'  },
    { icon: '', label: 'Scout',           sub: 'Differentials · Price Changes',     tab: 'scout'     },
    { icon: '', label: 'Tools',           sub: 'GW Planner · Squad Builder',        tab: 'tools'     },
    { icon: '', label: 'AI Hub',          sub: 'Manager Chat · Transfer Debate',    tab: 'ai'        },
    { icon: '', label: 'Arena',          sub: 'Rival Mode · Draft Room',           tab: 'arena'     },
    { icon: '', label: 'Intel',           sub: 'News · Weather · Alerts',           tab: 'intel'     },
    { icon: '', label: 'Profile',         sub: 'Captain History · DNA · Diary',     tab: 'profile'   },
    { icon: '◎', label: 'Live',            sub: 'Live GW · Score Simulator',         tab: 'live'      },
    { icon: '', label: 'Leagues',         sub: 'Standings · Season Graph',          tab: 'leagues'   },
    { icon: '', label: 'Refresh Data',    sub: 'Pull latest FPL data',             action: 'refresh' },
    { icon: '', label: 'Toggle Theme',    sub: 'Switch dark / light',              action: 'theme'   },
  ];

  let cmdOpen = false, cmdFocus = -1;

  function openCmd() {
    const bd = gel('cmdBackdrop');
    if (!bd) return;
    bd.classList.remove('hidden');
    cmdOpen = true;
    cmdFocus = -1;
    const inp = gel('cmdInput');
    if (inp) { inp.value = ''; renderCmdItems(''); setTimeout(() => inp.focus(), 60); }
  }

  function closeCmd() {
    const bd = gel('cmdBackdrop');
    if (!bd) return;
    bd.classList.add('hidden');
    cmdOpen = false;
  }

  function renderCmdItems(q) {
    const list = gel('cmdResultList');
    if (!list) return;
    const filtered = q
      ? CMD_ITEMS.filter(i => i.label.toLowerCase().includes(q.toLowerCase()) || i.sub.toLowerCase().includes(q.toLowerCase()))
      : CMD_ITEMS;
    if (!filtered.length) { list.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:.82rem;color:var(--text-sub)">No results for "<strong>${q}</strong>"</div>`; return; }
    const tabs = filtered.filter(i => i.tab);
    const actions = filtered.filter(i => i.action);
    let html = '';
    if (tabs.length) {
      html += `<div class="cmd-section-label">Navigation</div>`;
      html += tabs.map((item, i) => `
        <div class="cmd-item" data-tab="${item.tab||''}" data-action="${item.action||''}" data-idx="${i}" tabindex="0">
          <div class="cmd-item-icon">${item.icon}</div>
          <div class="cmd-item-body">
            <div class="cmd-item-label">${item.label}</div>
            <div class="cmd-item-sub">${item.sub}</div>
          </div>
        </div>`).join('');
    }
    if (actions.length) {
      html += `<div class="cmd-section-label">Actions</div>`;
      html += actions.map((item, i) => `
        <div class="cmd-item" data-action="${item.action}" data-idx="${tabs.length + i}" tabindex="0">
          <div class="cmd-item-icon">${item.icon}</div>
          <div class="cmd-item-body">
            <div class="cmd-item-label">${item.label}</div>
            <div class="cmd-item-sub">${item.sub}</div>
          </div>
        </div>`).join('');
    }
    list.innerHTML = html;
    list.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => {
        const tab = el.dataset.tab, act = el.dataset.action;
        if (tab) { window.goTab && window.goTab(tab); closeCmd(); }
        else if (act === 'refresh') { closeCmd(); location.reload(); }
        else if (act === 'theme') { gel('themeBtn')?.click(); closeCmd(); }
      });
    });
  }

  function gotoTab(id) {
    // Delegate to the master switchTab in script.js which handles all renders
    if (window.goTab && window.goTab !== switchTab) {
      window.goTab(id);
      return;
    }
    // Fallback (should not normally reach here)
    qall('.tab-panel').forEach(p => p.classList.remove('active'));
    qall('.nav-btn').forEach(b => b.classList.remove('active'));
    const panel = gel('tab-' + id);
    const btn = qsel(`[data-tab="${id}"]`);
    if (panel) panel.classList.add('active');
    if (btn) btn.classList.add('active');
    syncBottomNav(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function initCmdPalette() {
    // Keyboard shortcut
    document.addEventListener('keydown', e => {
      if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault(); openCmd();
      }
      if (e.key === 'Escape' && cmdOpen) closeCmd();
    });

    const inp = gel('cmdInput');
    if (inp) inp.addEventListener('input', () => { cmdFocus = -1; renderCmdItems(inp.value); });

    const bd = gel('cmdBackdrop');
    if (bd) bd.addEventListener('click', e => { if (e.target === bd) closeCmd(); });

    qall('.cmd-trigger-btn').forEach(b => b.addEventListener('click', openCmd));
    renderCmdItems('');
  }

  // ─── QUICK STATS STRIP ────────────────────
  function updateStatsStrip() {
    const S = window.S || {};
    const strip = gel('statsStrip');
    if (!strip) return;

    const totalPts = S.fplPlayer?.summary_overall_points;
    const gwPts    = S.fplPlayer?.summary_event_points;
    const rank     = S.fplPlayer?.summary_overall_rank;
    const captain  = S.myPicks?.find?.(p => p.is_captain);
    const capName  = captain ? (S.bootstrap?.elements?.find?.(e => e.id === captain.element)?.web_name || '—') : '—';

    // Deadline from strip-deadline span
    const deadlineEl = qsel('.strip-deadline');
    if (deadlineEl) {
      const gw = S.bootstrap?.events?.find?.(e => e.is_next);
      if (gw?.deadline_time) {
        const diff = new Date(gw.deadline_time) - Date.now();
        if (diff > 0) {
          const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
          deadlineEl.textContent = h > 24 ? `${Math.floor(h/24)}d ${h%24}h` : `${h}h ${m}m`;
          deadlineEl.className = `strip-value${h < 2 ? ' s-red' : h < 24 ? ' s-gold' : ''}`;
        }
      }
    }

    const rankEl = gel('stripRank'), ptsEl = gel('stripPts'), gwEl = gel('stripGWPts'), capEl = gel('stripCap');
    if (rankEl) { rankEl.textContent = rank ? rank.toLocaleString() : '—'; rankEl.className = 'strip-value'; }
    if (ptsEl)  { ptsEl.textContent  = totalPts || '—'; ptsEl.className = 'strip-value s-green'; }
    if (gwEl)   { gwEl.textContent   = gwPts    || '—'; gwEl.className  = 'strip-value s-blue'; }
    if (capEl)  { capEl.textContent  = capName; capEl.className = 'strip-value s-gold'; }
  }

  // ─── BOTTOM NAV ───────────────────────────
  const BNAV_TABS = ['dashboard','live','ai','players','more'];

  function syncBottomNav(activeTab) {
    qall('.bnav-item').forEach(item => {
      const t = item.dataset.bnav;
      item.classList.toggle('active', t === activeTab);
    });
  }

  function initBottomNav() {
    qall('.bnav-item').forEach(item => {
      item.addEventListener('click', () => {
        const t = item.dataset.bnav;
        if (t === 'more') { openMoreDrawer(); return; }
        window.goTab && window.goTab(t);
        syncBottomNav(t);
      });
    });

    // More drawer
    const bd = gel('moreBackdrop');
    if (bd) bd.addEventListener('click', e => { if (e.target === bd || e.target.closest('.more-backdrop:not(.more-drawer)')) closeMoreDrawer(); });
    qall('.more-item').forEach(item => {
      item.addEventListener('click', () => {
        const t = item.dataset.tab;
        if (t) { window.goTab && window.goTab(t); syncBottomNav(t); closeMoreDrawer(); }
      });
    });

    // Sync with existing nav
    qall('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => syncBottomNav(btn.dataset.tab));
    });
  }

  function openMoreDrawer()  { gel('moreBackdrop')?.classList.remove('hidden'); }
  function closeMoreDrawer() { gel('moreBackdrop')?.classList.add('hidden'); }

  // ─── NOTIFICATION DOTS ────────────────────
  function setNavDot(tab, show) {
    const btn = qsel(`.nav-btn[data-tab="${tab}"]`);
    if (!btn) return;
    let dot = btn.querySelector('.nav-notif-dot');
    if (!dot) { dot = document.createElement('span'); dot.className = 'nav-notif-dot'; btn.appendChild(dot); }
    dot.classList.toggle('show', show);
    // also sync bnav
    const bitem = qsel(`.bnav-item[data-bnav="${tab}"]`);
    if (bitem) { const bd = bitem.querySelector('.bnav-notif'); if (bd) bd.classList.toggle('show', show); }
  }

  function checkNotifDots() {
    const S = window.S || {};
    // Price changes dot — if priceRisingList has content
    const hasPrice = gel('priceRisingList')?.textContent?.trim()?.length > 5;
    setNavDot('scout', hasPrice);
    // News dot
    const hasNews = gel('newsFeedArea')?.querySelectorAll('.news-item,.injury-item').length > 0;
    setNavDot('intel', hasNews);
    // Live dot
    const isLive = qsel('.live-dot.active');
    setNavDot('live', !!isLive);
  }

  // ─── SKELETON SCREEN HELPERS ──────────────
  function showSkeletonInCard(containerId, rows = 4) {
    const el = gel(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="skel-card">
        <div class="skel-grid4">
          <div class="skel skel-tile"></div>
          <div class="skel skel-tile"></div>
          <div class="skel skel-tile"></div>
          <div class="skel skel-tile"></div>
        </div>
        ${Array.from({ length: rows }, () => `<div class="skel skel-row"></div>`).join('')}
      </div>`;
  }

  // ─── GW 5-WEEK PLANNER ───────────────────
  function renderGWPlanner() {
    const area = gel('gwPlannerArea');
    if (!area) return;
    const S = window.S || {};

    // Bootstrap not ready yet — show loading and retry up to 10 times
    if (!S.bootstrap || !S.players?.length) {
      area.innerHTML = `<div class="empty-state"><div class="icon"></div><h3>LOADING DATA</h3><p>Connecting to FPL API...</p></div>`;
      let attempts = 0;
      const retry = setInterval(() => {
        attempts++;
        const Snow = window.S || {};
        if (Snow.bootstrap && Snow.players?.length) {
          clearInterval(retry);
          renderGWPlanner();
        } else if (attempts >= 10) {
          clearInterval(retry);
          area.innerHTML = `<div class="empty-state"><div class="icon"></div><h3>UNAVAILABLE</h3><p>FPL data failed to load. Refresh the page.</p></div>`;
        }
      }, 1000);
      return;
    }

    const events = S.bootstrap.events || [];
    const currIdx = events.findIndex(e => e.is_current);
    const nextIdx = events.findIndex(e => e.is_next);
    const startIdx = nextIdx >= 0 ? nextIdx : (currIdx >= 0 ? currIdx : 0);
    const gws = events.slice(startIdx, startIdx + 5);
    if (!gws.length) { area.innerHTML = `<div class="empty-state"><div class="icon"></div><h3>SEASON COMPLETE</h3><p>No upcoming gameweeks.</p></div>`; return; }

    const players = S.players.length ? S.players : (S.bootstrap.elements || []);
    const teams   = S.bootstrap.teams   || [];

    // Build top form players
    const topByForm = [...players]
      .filter(p => p.status === 'a' && parseFloat(p.form) > 0)
      .sort((a, b) => parseFloat(b.form) - parseFloat(a.form));

    const teamMap = {};
    teams.forEach(t => { teamMap[t.id] = t; });

    const allFixtures = S.allFixtures || [];

    // FDR for each GW — aggregate across all teams
    const avgFDR = gw => {
      const f = allFixtures.filter(fix => fix.event === gw.id);
      if (!f?.length) return 3;
      const vals = f.flatMap(fix => [fix.team_h_difficulty, fix.team_a_difficulty]).filter(Boolean);
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 3;
    };

    // Captains — pick best form player per GW (simplified)
    const captains = gws.map(gw => {
      const best = topByForm.find(p => {
        const hasFixture = allFixtures.some(f =>
          f.event === gw.id && (f.team_h === p.team || f.team_a === p.team)
        );
        return hasFixture;
      });
      return best ? best.web_name : (topByForm[0]?.web_name || '—');
    });

    // Chip recommendations
    const chipGW = gws.reduce((best, gw, i) => {
      const fdr = parseFloat(avgFDR(gw));
      return (!best || fdr < parseFloat(avgFDR(gws[best.i]))) ? { i, gw, fdr } : best;
    }, null);

    // Transfer suggestions
    const transfers = topByForm.slice(0, 3).map((p, i) => {
      const victims = players.filter(v => v.element_type === p.element_type && v.id !== p.id && parseFloat(v.form) < parseFloat(p.form));
      const out = victims[i] || victims[0];
      return out ? { out: out.web_name, in: p.web_name, reason: `Form ↑ ${p.form}` } : null;
    }).filter(Boolean).slice(0, 3);

    // Build GW cards
    const gwCards = gws.map((gw, i) => {
      const isChip = chipGW?.i === i;
      const fdr = avgFDR(gw);
      const fdrNum = parseFloat(fdr);
      const pips = [1,2,3,4,5].map(v =>
        `<div class="planner-pip" style="background:${fdrColor(Math.round(fdrNum))};opacity:${v <= Math.round(fdrNum) ? 1 : 0.2}"></div>`
      ).join('');
      return `
        <div class="planner-gw-card${isChip ? ' chip-gw' : ''}">
          ${isChip ? `<div class="planner-gw-chip-tag"> CHIP</div>` : ''}
          <div class="planner-gw-num">GW${gw.id}</div>
          <div class="planner-captain">${captains[i]}</div>
          <div class="planner-fdr-pips">${pips}</div>
          <div class="planner-note">FDR avg ${fdr}</div>
        </div>`;
    }).join('');

    const xferHtml = transfers.length
      ? transfers.map(t => `
        <div class="planner-xfer-row">
          <span class="planner-out">${t.out}</span>
          <span class="planner-arr">to</span>
          <span class="planner-in">${t.in}</span>
          <span class="planner-xfer-reason">${t.reason}</span>
        </div>`).join('')
      : `<div style="color:var(--text-sub);font-size:.8rem;padding:.5rem">No transfers recommended — squad looks solid.</div>`;

    const totXPts = topByForm.slice(0,11).reduce((s,p) => s + (parseFloat(p.ep_next)||0), 0).toFixed(1);
    const chipName = gws[chipGW?.i]?.name || '—';

    area.innerHTML = `
      <div class="planner-gw-row">${gwCards}</div>
      <div class="section-header" style="margin-bottom:.65rem">
        <span class="section-title" style="font-size:.85rem">TRANSFER TARGETS</span>
        <div class="section-line"></div>
      </div>
      <div class="planner-transfer-list">${xferHtml}</div>
      <div class="planner-summary-bar">
        <div class="planner-summary-stat"><div class="planner-summary-val">${totXPts}</div><div class="planner-summary-lbl">Squad xPts</div></div>
        <div style="width:1px;background:var(--border);align-self:stretch"></div>
        <div class="planner-summary-stat"><div class="planner-summary-val">${chipName}</div><div class="planner-summary-lbl">Chip Window</div></div>
        <div style="width:1px;background:var(--border);align-self:stretch"></div>
        <div class="planner-summary-stat"><div class="planner-summary-val">${gws.length}</div><div class="planner-summary-lbl">GWs Planned</div></div>
      </div>`;
  }

  // ─── SELL OR HOLD ─────────────────────────
  let sohPlayer = null;
  function initSellOrHold() {
    const inp = gel('sohInput'), btn = gel('sohBtn'), area = gel('sohArea');
    if (!inp || !btn || !area) return;

    btn.addEventListener('click', () => {
      const q = inp.value.trim().toLowerCase();
      if (!q) return;
      const S = window.S || {};
      const players = S.players?.length ? S.players : (S.bootstrap?.elements || []);
      const p = players.find(pl =>
        pl.web_name?.toLowerCase().includes(q) ||
        ((pl.first_name || pl.second_name) && (pl.first_name + ' ' + pl.second_name).toLowerCase().includes(q))
      );
      if (!p) { area.innerHTML = `<div class="empty-state"><div class="icon"></div><h3>NOT FOUND</h3><p>Try a different name.</p></div>`; return; }
      sohPlayer = p;
      renderSellOrHold(p, S);
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
  }

  function renderSellOrHold(p, S) {
    const area = gel('sohArea');
    if (!area) return;

    const form = parseFloat(p.form) || 0;
    const ownership = parseFloat(p.selected_by_percent) || 0;
    const priceTrend = p.cost_change_event || 0;
    const xPts = parseFloat(p.ep_next) || 0;

    // Metrics out of 10
    const formScore     = Math.min(10, form * 1.4);
    const ownerScore    = Math.min(10, ownership / 5);
    const priceScore    = 5 + Math.min(5, priceTrend * 2);
    const xPtsScore     = Math.min(10, xPts * 1.2);
    const overall       = ((formScore + (10 - ownerScore * 0.5) + priceScore + xPtsScore) / 3.5);
    const clampedScore  = Math.min(10, Math.max(0, overall));

    let verdict, cls;
    if (clampedScore >= 7)      { verdict = 'HOLD'; cls = 'hold'; }
    else if (clampedScore <= 4) { verdict = 'SELL'; cls = 'sell'; }
    else                        { verdict = 'WATCH'; cls = 'watch'; }

    const barColor = cls === 'hold' ? 'var(--green)' : cls === 'sell' ? 'var(--red)' : 'var(--gold)';

    const reasoning = {
      hold:  `${p.web_name} is in excellent form (${form}) with strong projected points (${xPts}) next GW. High ownership (${ownership}%) means selling is a risk — a blanked captaincy could cost you rank position. Hold unless you have a like-for-like upgrade.`,
      sell:  `${p.web_name}'s form has been poor (${form}) with limited projected returns (${xPts}). With ${ownership}% ownership, the rest of the world may be ahead of you. Consider a move before the deadline.`,
      watch: `${p.web_name} is in a grey zone. Decent form (${form}) but unclear if they can sustain it. Monitor for team news before your deadline — don't panic sell but don't hold blindly either.`,
    };

    const metrics = [
      { label: 'FORM RATING',    val: formScore,  display: form,       color: formScore > 6 ? 'var(--green)' : formScore > 3 ? 'var(--gold)' : 'var(--red)' },
      { label: 'NEXT GW xPTS',  val: xPtsScore,  display: xPts + ' pts', color: 'var(--blue)' },
      { label: 'PRICE TREND',   val: priceScore, display: (priceTrend > 0 ? '+' : '') + priceTrend * 0.1 + 'm', color: priceTrend >= 0 ? 'var(--green)' : 'var(--red)' },
      { label: 'OWNERSHIP RISK',val: ownerScore, display: ownership + '%', color: ownership > 30 ? 'var(--red)' : 'var(--green)' },
    ];

    area.innerHTML = `
      <div class="soh-result-card">
        <div class="soh-verdict-banner ${cls}">
          <div>
            <div class="soh-verdict-label">${verdict}</div>
            <div style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub);letter-spacing:1px;margin-top:2px">${p.web_name} · ${posChip(p.posShort||'MID')}</div>
          </div>
          <div class="soh-verdict-score">${clampedScore.toFixed(1)}</div>
        </div>
        <div class="soh-metrics">
          ${metrics.map(m => `
            <div class="soh-metric-row">
              <span class="soh-metric-label">${m.label}</span>
              <div class="soh-bar-wrap">
                <div class="soh-bar-fill" style="width:${m.val*10}%;background:${m.color}"></div>
              </div>
              <span class="soh-metric-val" style="color:${m.color}">${m.display}</span>
            </div>`).join('')}
        </div>
        <div class="soh-reasoning">${reasoning[cls]}</div>
      </div>`;
  }

  // ─── CAPTAIN HISTORY ─────────────────────
  function renderCaptainHistory() {
    const area = gel('capHistArea');
    if (!area) return;
    const S = window.S || {};
    const history = S.gwHistory?.current || S.gwHistory?.past || [];
    if (!history.length) {
      area.innerHTML = `<div class="empty-state"><div class="icon"></div><h3>NO HISTORY</h3><p>Connect your FPL account to see captain history.</p></div>`;
      return;
    }

    const picks = S.gwHistory?.picks || {};
    const bs    = S.bootstrap?.elements || [];

    // Build captain rows from history
    const rows = history.slice().reverse().map(gw => {
      const gwPicks = picks[gw.event];
      const capEl   = gwPicks ? bs.find(e => e.id === gwPicks.captain) : null;
      const capName = capEl?.web_name || '—';
      const capPts  = gwPicks?.captainPts ?? null;
      const rank    = gw.overall_rank;
      const gwPtsVal = gw.points || 0;
      let chipClass = 'ok', chipText = gwPtsVal + ' pts';
      if (capPts !== null) {
        if (capPts >= 12)      { chipClass = 'hit';  chipText = ` ${capPts} pts`; }
        else if (capPts <= 4)  { chipClass = 'miss'; chipText = ` ${capPts} pts`; }
        else                   { chipClass = 'ok';   chipText = `${capPts} pts`; }
      }
      return { gw: gw.event, capName, chipClass, chipText, gwPtsVal, rank };
    });

    const hits   = rows.filter(r => r.chipClass === 'hit').length;
    const misses = rows.filter(r => r.chipClass === 'miss').length;
    const hitRate = rows.length ? Math.round((hits / rows.length) * 100) : 0;
    const bestGW  = rows.reduce((b, r) => r.gwPtsVal > (b?.gwPtsVal || 0) ? r : b, null);

    area.innerHTML = `
      <div class="cap-hist-stats">
        <div class="cap-hist-stat">
          <div class="cap-hist-val green">${hitRate}%</div>
          <div class="cap-hist-lbl">Hit Rate</div>
        </div>
        <div class="cap-hist-stat">
          <div class="cap-hist-val gold">${hits}</div>
          <div class="cap-hist-lbl">Good Caps</div>
        </div>
        <div class="cap-hist-stat">
          <div class="cap-hist-val sub">${misses}</div>
          <div class="cap-hist-lbl">Blanked</div>
        </div>
      </div>
      <div class="cap-hist-timeline">
        ${rows.slice(0, 15).map(r => `
          <div class="cap-hist-row">
            <span class="cap-hist-gw">GW${r.gw}</span>
            <span class="cap-hist-player">${r.capName}</span>
            <span class="cap-chip ${r.chipClass}">${r.chipText}</span>
          </div>`).join('')}
        ${rows.length > 15 ? `<div style="text-align:center;font-size:.75rem;color:var(--text-sub);padding:.5rem">+ ${rows.length - 15} earlier GWs</div>` : ''}
      </div>`;
  }

  // ─── SCORE SIMULATOR ─────────────────────
  const simState = {};

  const EVENT_PTS = {
    goal_GKP:6, goal_DEF:6, goal_MID:5, goal_FWD:4,
    assist:3, clean_GKP:6, clean_DEF:6, clean_MID:1,
    yellow:-1, red:-3, og:-2,
  };

  function getSimPts(player, events) {
    let pts = events.mins >= 60 ? 2 : (events.mins > 0 ? 1 : 0);
    if (events.goal)   pts += (EVENT_PTS['goal_'+player.posShort] || 4);
    if (events.assist) pts += EVENT_PTS.assist;
    if (events.clean && ['GKP','DEF'].includes(player.posShort)) pts += EVENT_PTS['clean_' + player.posShort];
    if (events.yellow) pts += EVENT_PTS.yellow;
    if (events.red)    pts += EVENT_PTS.red;
    if (events.og)     pts += EVENT_PTS.og;
    return pts;
  }

  function renderSimulator() {
    const area = gel('simArea');
    if (!area) return;
    const S = window.S || {};

    // Prefer authenticated picks; fall back to manually built squad
    let starters = [];
    const myPicks = S.myPicks || [];
    const players = (S.bootstrap?.elements || S.players || []);

    if (myPicks.length) {
      starters = myPicks.filter(p => !p.isBench).slice(0, 11);
    } else if (S.myTeam?.length) {
      // Build mock picks from myTeam IDs — treat first 11 as starters
      const posOrder = { 1: 0, 2: 1, 3: 2, 4: 3 };
      const sorted = [...S.myTeam]
        .map(id => players.find(p => p.id === id))
        .filter(Boolean)
        .sort((a, b) => posOrder[a.element_type] - posOrder[b.element_type]);
      starters = sorted.slice(0, 11).map((p, i) => ({
        element: p.id,
        is_captain: i === 0,
        isBench: false,
        event_points: 2,
      }));
    }
    if (!starters.length) {
      area.innerHTML = `<div class="empty-state"><div class="icon"></div><h3>NO SQUAD</h3><p>Build your team to use the simulator.</p></div>`;
      return;
    }

    // Enrich with position
    const enriched = starters.map(p => {
      const base = players.find(e => e.id === p.element) || {};
      const posMap = { 1:'GKP', 2:'DEF', 3:'MID', 4:'FWD' };
      return { ...p, ...base, posShort: posMap[base.element_type] || 'MID', web_name: base.web_name || 'Player' };
    });

    // Init state
    enriched.forEach(p => {
      if (!simState[p.element]) {
        simState[p.element] = { mins: 90, goal: false, assist: false, clean: false, yellow: false, red: false, og: false };
      }
    });

    const calcTotal = () => enriched.reduce((sum, p) => {
      const pts = getSimPts(p, simState[p.element] || {});
      return sum + pts * (p.is_captain ? 2 : 1);
    }, 0);

    const basePts = enriched.reduce((s, p) => s + ((p.event_points || 2) * (p.is_captain ? 2 : 1)), 0);

    function build() {
      const total = calcTotal();
      const delta = total - basePts;
      const posByGroup = { GKP: [], DEF: [], MID: [], FWD: [] };
      enriched.forEach(p => (posByGroup[p.posShort] || posByGroup.FWD).push(p));

      let html = `
        <div class="sim-total-bar">
          <div>
            <div class="sim-total-label">SIMULATED TOTAL</div>
            <div class="sim-base-label">Base: ${basePts} pts</div>
          </div>
          <div style="display:flex;align-items:center;gap:.5rem">
            <div class="sim-total-pts" id="simTotalDisplay">${total}</div>
            <div class="sim-delta${delta < 0 ? ' neg' : ''}">${delta >= 0 ? '+' : ''}${delta}</div>
          </div>
        </div>`;

      ['GKP','DEF','MID','FWD'].forEach(pos => {
        const group = posByGroup[pos];
        if (!group.length) return;
        html += `<div class="sim-pos-divider">${pos}</div>`;
        group.forEach(p => {
          const ev = simState[p.element] || {};
          const pts = getSimPts(p, ev);
          const isCap = p.is_captain;
          const displayPts = pts * (isCap ? 2 : 1);
          html += `
            <div class="sim-player-row">
              <div class="sim-player-name">${p.web_name}${isCap ? '<span class="sim-is-captain">C</span>' : ''}</div>
              <div class="sim-btns">
                <button class="sim-btn ${ev.goal ? 'on' : ''}" data-pid="${p.element}" data-ev="goal" title="Goal"></button>
                <button class="sim-btn ${ev.assist ? 'on' : ''}" data-pid="${p.element}" data-ev="assist" title="Assist"></button>
                ${['GKP','DEF'].includes(p.posShort) ? `<button class="sim-btn ${ev.clean ? 'on' : ''}" data-pid="${p.element}" data-ev="clean" title="Clean Sheet"></button>` : ''}
                <button class="sim-btn neg-btn ${ev.yellow ? 'on' : ''}" data-pid="${p.element}" data-ev="yellow" title="Yellow Card"></button>
                <button class="sim-btn neg-btn ${ev.red ? 'on' : ''}" data-pid="${p.element}" data-ev="red" title="Red Card"></button>
              </div>
              <div class="sim-player-pts${displayPts < 0 ? ' neg' : ''}">${displayPts}</div>
            </div>`;
        });
      });

      area.innerHTML = html;

      // Event listeners
      area.querySelectorAll('.sim-btn[data-pid]').forEach(btn => {
        const pid = parseInt(btn.dataset.pid);
        const ev  = btn.dataset.ev;
        if (!simState[pid]) simState[pid] = {};
        if (simState[pid][ev]) btn.classList.add('on');
        btn.addEventListener('click', () => {
          simState[pid][ev] = !simState[pid][ev];
          build();
        });
      });
    }

    build();

    // Reset button
    const resetBtn = gel('simResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      enriched.forEach(p => { simState[p.element] = { mins:90,goal:false,assist:false,clean:false,yellow:false,red:false,og:false }; });
      build();
    });
  }

  // ─── MINI-LEAGUE SEASON GRAPH ─────────────
  function renderLeagueSeasonGraphs() {
    const area = gel('leagueGraphArea');
    if (!area) return;
    const S = window.S || {};
    const leagues = S.myLeagues?.classic || [];
    const history = S.gwHistory?.current || [];

    if (!leagues.length || !history.length) {
      area.innerHTML = `<div class="empty-state"><div class="icon"><svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg></div><h3>CONNECT ACCOUNT</h3><p>Login to see your league season graphs.</p></div>`;
      return;
    }

    // Show rank movement chart per league (using overall rank as proxy)
    const ranks = history.map(g => g.overall_rank);
    const labels = history.map(g => `GW${g.event}`);
    const inverted = ranks.map(r => -r); // invert so up = better

    area.innerHTML = leagues.slice(0, 4).map((league, idx) => {
      const color = ['var(--green)','var(--blue)','var(--gold)','var(--purple)'][idx % 4];
      const lastRank = league.entry_rank?.toLocaleString() || '—';
      return `
        <div class="league-graph-card">
          <div class="league-graph-header">
            <span class="league-graph-name">${league.name || league.league_name || 'League'}</span>
            <span class="league-graph-rank">Rank #${lastRank}</span>
          </div>
          <div style="overflow:hidden;border-radius:var(--radius)">${buildLeagueSVG(inverted, labels, color)}</div>
        </div>`;
    }).join('');
  }

  function buildLeagueSVG(vals, labels, color) {
    if (!vals.length) return '';
    const W = 400, H = 80;
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      const y = H - ((v - min) / range) * (H * 0.85) - H * 0.075;
      return `${x},${y}`;
    });
    const lastX = parseFloat(pts[pts.length-1].split(',')[0]);
    const lastY = parseFloat(pts[pts.length-1].split(',')[1]);

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" fill="none">
      <defs>
        <linearGradient id="lg${color.replace(/[^a-z0-9]/gi,'')}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity=".18"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${pts.join(' ')} ${W},${H} 0,${H}" fill="url(#lg${color.replace(/[^a-z0-9]/gi,'')})" />
      <polyline points="${pts.join(' ')}" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastX}" cy="${lastY}" r="3" fill="${color}" opacity=".8"/>
    </svg>`;
  }

  // ─── PLAYER ALERTS ────────────────────────
  const ALERT_KEY = 'fpl_alerts_v1';
  let alertPlayers = [];

  function loadAlerts() {
    try { alertPlayers = JSON.parse(localStorage.getItem(ALERT_KEY) || '[]'); } catch { alertPlayers = []; }
  }

  function saveAlerts() {
    localStorage.setItem(ALERT_KEY, JSON.stringify(alertPlayers));
  }

  function renderAlerts() {
    const area = gel('alertsArea');
    if (!area) return;
    loadAlerts();
    const S = window.S || {};
    const allPlayers = S.bootstrap?.elements || [];

    if (!alertPlayers.length) {
      area.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-sub);font-size:.82rem">No players tracked. Add from the Players tab or search below.</div>`;
      return;
    }

    const enriched = alertPlayers.map(id => allPlayers.find(p => p.id === id)).filter(Boolean);
    const statusDot = p => {
      const m = {a:'fit',d:'doubt',i:'out',s:'out',u:'unknown',n:'unknown'};
      return m[p.status] || 'unknown';
    };
    const newsHtml = enriched.filter(p => p.news).map(p => `
      <div class="alert-news-item">
        <span class="alert-news-name">${p.web_name}</span>${p.news}
        <span class="alert-news-ts">${p.chance_of_playing_next_round !== null ? p.chance_of_playing_next_round + '% chance' : 'Status unknown'}</span>
      </div>`).join('');

    area.innerHTML = `
      <div class="alert-list">
        ${enriched.map(p => `
          <div class="alert-player-row">
            <div class="alert-status-dot ${statusDot(p)}"></div>
            <span class="alert-player-name">${p.web_name}</span>
            <span class="alert-player-news">${p.news || 'No news'}</span>
            <button class="alert-remove" data-pid="${p.id}"></button>
          </div>`).join('')}
      </div>
      ${newsHtml ? `<div class="section-header" style="margin-bottom:.5rem"><span class="section-title" style="font-size:.82rem">LATEST ALERTS</span><div class="section-line"></div></div><div class="alert-news-feed">${newsHtml}</div>` : ''}`;

    area.querySelectorAll('.alert-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        alertPlayers = alertPlayers.filter(id => id !== parseInt(btn.dataset.pid));
        saveAlerts();
        renderAlerts();
      });
    });
  }

  function initAlerts() {
    const inp = gel('alertInput'), btn = gel('alertAddBtn');
    if (!inp || !btn) return;
    btn.addEventListener('click', () => {
      const q = inp.value.trim().toLowerCase();
      if (!q) return;
      const S = window.S || {};
      const p = (S.bootstrap?.elements||[]).find(pl =>
        pl.web_name.toLowerCase().includes(q) ||
        (pl.first_name + ' ' + pl.second_name).toLowerCase().includes(q)
      );
      if (!p) { inp.style.borderColor='var(--red)'; setTimeout(()=>inp.style.borderColor='',1200); return; }
      if (!alertPlayers.includes(p.id)) { alertPlayers.push(p.id); saveAlerts(); }
      inp.value = '';
      renderAlerts();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
  }

  // ─── PLAYER CARD VIEW ─────────────────────
  let cardViewActive = false;
  const PAGE_SIZE_CARDS = 24;
  let cardPage = 0;

  function initCardView() {
    const listBtn = gel('viewToggleList'), cardBtn = gel('viewToggleCard');
    if (!listBtn || !cardBtn) return;
    listBtn.addEventListener('click', () => { cardViewActive = false; listBtn.classList.add('active'); cardBtn.classList.remove('active'); toggleViews(); });
    cardBtn.addEventListener('click', () => { cardViewActive = true; cardBtn.classList.add('active'); listBtn.classList.remove('active'); toggleViews(); renderCardGrid(); });
  }

  function toggleViews() {
    const tableWrap = qsel('.player-table-wrap');
    const cardWrap  = gel('playerCardGrid');
    if (tableWrap) tableWrap.style.display = cardViewActive ? 'none' : '';
    if (cardWrap)  cardWrap.style.display  = cardViewActive ? '' : 'none';
  }

  function renderCardGrid() {
    const grid = gel('playerCardGrid');
    if (!grid) return;
    const S = window.S || {};
    const players = S.filteredPlayers || S.bootstrap?.elements || [];
    const posMap = {1:'GKP',2:'DEF',3:'MID',4:'FWD'};
    const page = players.slice(cardPage * PAGE_SIZE_CARDS, (cardPage + 1) * PAGE_SIZE_CARDS);
    if (!page.length) { grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-sub)">No players found</div>`; return; }

    grid.innerHTML = page.map(p => {
      const pos  = posMap[p.element_type] || 'MID';
      const fc   = formColor(p.form);
      const init = (p.web_name || 'P').slice(0, 2).toUpperCase();
      const posColors = { GKP:'var(--amber)', DEF:'var(--blue)', MID:'var(--green)', FWD:'var(--red)' };
      return `
        <div class="pcg-item" data-pid="${p.id}">
          <div class="pcg-avatar" style="border-color:${posColors[pos]};color:${posColors[pos]}">${init}</div>
          <div class="pcg-name">${p.web_name}</div>
          <div class="pcg-price">£${(p.now_cost/10).toFixed(1)}m</div>
          <div class="pcg-form" style="background:${fc.bg};color:${fc.color};border:1px solid ${fc.border}">Form ${p.form}</div>
          <button class="pcg-add-btn" data-pid="${p.id}" title="Add to squad">+</button>
        </div>`;
    }).join('');

    grid.querySelectorAll('.pcg-add-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pid = parseInt(btn.dataset.pid);
        const p = players.find(pl => pl.id === pid);
        if (p && window.addPlayerToSquad) window.addPlayerToSquad(p);
        else btn.textContent = '';
      });
    });
  }

  // ─── INIT ─────────────────────────────────
  function initUpgrades() {
    initCmdPalette();
    initBottomNav();
    initSellOrHold();
    initAlerts();
    initCardView();

    // Sync strip on load and every 30s
    updateStatsStrip();
    setInterval(updateStatsStrip, 30000);

    // Notification dots check every 10s
    checkNotifDots();
    setInterval(checkNotifDots, 10000);

    // Expose syncBottomNav externally for switchTab in script.js
    window.upgrades = window.upgrades || {};
    window.upgrades.syncBottomNavExternal = syncBottomNav;

    // Render on tab switch (handled by script.js switchTab now, but keep for safety)
    const tabBtns = qall('[data-tab]');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        updateStatsStrip();
      });
    });

    // Initial renders — run immediately if data is already loaded (cache hit scenario)
    function doInitialRenders() {
      renderGWPlanner();
      renderCaptainHistory();
      renderAlerts();
      updateStatsStrip();
      checkNotifDots();
    }

    const S = window.S || {};
    if (S.bootstrap && S.players?.length) {
      // Data already ready (cache hit — fplDataReady already fired before we loaded)
      doInitialRenders();
    } else {
      // Data not ready yet — wait for event
      setTimeout(doInitialRenders, 2000);
    }

    // Listen for data ready (covers fresh loads and background refreshes)
    document.addEventListener('fplDataReady', () => {
      updateStatsStrip();
      checkNotifDots();
      renderGWPlanner();
      renderCaptainHistory();
      renderLeagueSeasonGraphs();
      renderAlerts();
      if (cardViewActive) renderCardGrid();
    });
  }

  // Wait for DOM + existing script
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initUpgrades, 800));
  } else {
    setTimeout(initUpgrades, 800);
  }

  // Expose for external use
  window.upgrades = { renderGWPlanner, renderSimulator, renderCaptainHistory, renderLeagueSeasonGraphs, renderAlerts, renderCardGrid, updateStatsStrip, setNavDot, openCmd, closeCmd, syncBottomNavExternal: syncBottomNav };

})();
