/**
 * script.js — FPL CORTEX
 *
 * FIXES:
 * 1. Proxy URLs properly encoded — no more "Failed to fetch"
 * 2. Pitch tap → action sheet (set C / set VC / remove) — not instant remove
 * 3. Upcoming fixtures properly filtered by current/next GW
 * 4. Bench points NOT counted in squad total (only 11 starters count)
 * 5. Pitch layout: simple jersey (no clip-path) that works on all Android browsers
 * 6. Speed: parallel fetch + 5min sessionStorage cache
 */
'use strict';

/* ══════════════════════════════════════════════════════════════
   PROXIES  — properly encoded URLs
══════════════════════════════════════════════════════════════ */
const FPL = 'https://fantasy.premierleague.com/api';

const PROXIES = [
  // 1. Our own Vercel edge proxy (needs api/proxy.js deployed)
  p => `/api/proxy?path=${encodeURIComponent(p)}`,
  // 2. corsproxy.io — full URL must be encoded
  p => `https://corsproxy.io/?${encodeURIComponent(`${FPL}${p}`)}`,
  // 3. allorigins — URL must be encoded
  p => `https://api.allorigins.win/raw?url=${encodeURIComponent(`${FPL}${p}`)}`,
  // 4. codetabs — different format
  p => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`${FPL}${p}`)}`,
];

async function fplFetch(path) {
  let lastErr;
  for (const make of PROXIES) {
    try {
      const res = await fetch(make(path));
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All proxies failed');
}

/* sessionStorage cache with 5-min TTL */
const CACHE_TTL = 5 * 60 * 1000;
function cGet(k) {
  try {
    const r = sessionStorage.getItem(k);
    if (!r) return null;
    const { d, t } = JSON.parse(r);
    if (Date.now() - t > CACHE_TTL) { sessionStorage.removeItem(k); return null; }
    return d;
  } catch { return null; }
}
function cSet(k, d) {
  try { sessionStorage.setItem(k, JSON.stringify({ d, t: Date.now() })); } catch {}
}

/* ══════════════════════════════════════════════════════════════
   TEAM COLOURS — PL 2024-25
══════════════════════════════════════════════════════════════ */
const TC = {
  ARS:{ p:'#EF0107', s:'#FFFFFF' }, AVL:{ p:'#670E36', s:'#95BFE5' },
  BOU:{ p:'#DA291C', s:'#000000' }, BRE:{ p:'#E30613', s:'#FFFFFF' },
  BHA:{ p:'#0057B8', s:'#FFFFFF' }, CHE:{ p:'#034694', s:'#FFFFFF' },
  CRY:{ p:'#1B458F', s:'#C4122E' }, EVE:{ p:'#003399', s:'#FFFFFF' },
  FUL:{ p:'#CCCCCC', s:'#231F20' }, IPS:{ p:'#0044A9', s:'#FFFFFF' },
  LEI:{ p:'#003090', s:'#FDBE11' }, LIV:{ p:'#C8102E', s:'#00B2A9' },
  MCI:{ p:'#6CABDD', s:'#FFFFFF' }, MUN:{ p:'#DA291C', s:'#FBE122' },
  NEW:{ p:'#241F20', s:'#FFFFFF' }, NFO:{ p:'#DD0000', s:'#FFFFFF' },
  SOU:{ p:'#D71920', s:'#FFFFFF' }, TOT:{ p:'#F0F0F0', s:'#132257' },
  WHU:{ p:'#7A263A', s:'#1BB1E7' }, WOL:{ p:'#FDB913', s:'#231F20' },
};
function teamColor(short) { return TC[short] || { p:'#334155', s:'#64748b' }; }

/* ══════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════ */
const S = {
  bootstrap:null, allFixtures:[], liveData:null,
  players:[], teams:{}, positions:{},
  currentGW:null, nextGW:null,
  myTeam:[], captainId:null, vcaptainId:null,
  pickOrder:{},      // { playerId: position 1-15 }
  starterIds:[],     // first 11 by pick order (for points calc)
  page:1, pageSize:20, filteredPlayers:[],
  fplEntryId:null, fplPlayer:null, myLeagues:{ classic:[], h2h:[] },
  currentLeagueId:null, currentLeagueType:'classic',
  actionPid:null,    // player ID shown in action sheet
};

/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */
async function init() {
  loadStorage();
  attachListeners();
  setLoadingProgress(10, 'FETCHING DATA...');

  let bd = cGet('bootstrap');
  let fd = cGet('fixtures');

  if (bd && fd) {
    setLoadingProgress(55, 'LOADING FROM CACHE...');
    S.allFixtures = fd;
    sortFixtures();
    processBootstrap(bd);
  } else {
    try {
      setLoadingProgress(20, 'FETCHING DATA...');
      const [bRes, fRes] = await Promise.all([
        fplFetch('/bootstrap-static/'),
        fplFetch('/fixtures/'),
      ]);
      setLoadingProgress(60, 'PROCESSING...');
      bd = await bRes.json();
      fd = fRes.ok ? await fRes.json() : [];
      cSet('bootstrap', bd);
      cSet('fixtures', fd);
      S.allFixtures = fd;
      sortFixtures();
      if (!processBootstrap(bd)) return;
    } catch (err) {
      console.error('Init fetch failed:', err);
      setLoadingProgress(100, 'ERROR');
      setTimeout(() => showLoadingError(
        `Could not reach FPL API.<br>Check your internet and retry.<br>
         <small style="color:var(--text-sub)">${err.message}</small>`), 300);
      return;
    }
  }

  setLoadingProgress(88, 'BUILDING...');
  renderAll();
  setLoadingProgress(100, 'READY');

  const ld = document.getElementById('liveDot');
  if (ld) { ld.classList.add('active'); ld.textContent = 'LIVE'; }

  setTimeout(() => {
    const ls = document.getElementById('loadingScreen');
    if (!ls) return;
    ls.style.opacity = '0'; ls.style.transition = 'opacity 0.35s ease';
    setTimeout(() => ls.remove(), 360);
  }, 180);

  if (S.fplEntryId) updateAccountUI();
  fetchLive(); // non-blocking background
}

/* ══════════════════════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════════════════════ */
function loadStorage() {
  try {
    const get = k => localStorage.getItem(k);
    const t=get('fpl_myteam'), c=get('fpl_captain'), v=get('fpl_vcaptain');
    const po=get('fpl_pickorder'), ei=get('fpl_entry_id');
    const pl=get('fpl_player'),    lg=get('fpl_leagues');
    if (t)  S.myTeam    = JSON.parse(t);
    if (c)  S.captainId  = parseInt(c);
    if (v)  S.vcaptainId = parseInt(v);
    if (po) S.pickOrder  = JSON.parse(po);
    if (ei) S.fplEntryId = parseInt(ei);
    if (pl) S.fplPlayer  = JSON.parse(pl);
    if (lg) S.myLeagues  = JSON.parse(lg);
  } catch {}
}

function saveTeam() {
  localStorage.setItem('fpl_myteam', JSON.stringify(S.myTeam));
  if (S.captainId)  localStorage.setItem('fpl_captain',    S.captainId);
  else              localStorage.removeItem('fpl_captain');
  if (S.vcaptainId) localStorage.setItem('fpl_vcaptain',   S.vcaptainId);
  else              localStorage.removeItem('fpl_vcaptain');
  if (Object.keys(S.pickOrder).length)
    localStorage.setItem('fpl_pickorder', JSON.stringify(S.pickOrder));
}

/* ══════════════════════════════════════════════════════════════
   LISTENERS
══════════════════════════════════════════════════════════════ */
function attachListeners() {
  // Nav
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Header
  document.getElementById('accountBtn')?.addEventListener('click', handleAccountBtn);

  // Modal
  el('loginModalClose')?.addEventListener('click', closeModal);
  el('loginSkipBtn')?.addEventListener('click', closeModal);
  el('loginSubmitBtn')?.addEventListener('click', submitTeamId);
  el('loginTeamId')?.addEventListener('keydown', e => { if(e.key==='Enter') submitTeamId(); });
  el('managerSearchBtn')?.addEventListener('click', searchManager);
  el('managerSearchInput')?.addEventListener('keydown', e => { if(e.key==='Enter') searchManager(); });

  // Dashboard
  el('captainBtn')?.addEventListener('click', autoPickCaptain);
  el('dashImportBtn')?.addEventListener('click', importFplTeam);
  el('dashLogoutBtn')?.addEventListener('click', logout);

  // Players
  el('refreshBtn')?.addEventListener('click', refreshData);
  el('playerSearch')?.addEventListener('input', filterPlayers);
  el('posFilter')?.addEventListener('change', filterPlayers);
  el('teamFilter')?.addEventListener('change', filterPlayers);
  el('sortSelect')?.addEventListener('change', filterPlayers);

  // My Team
  el('clearTeamBtn')?.addEventListener('click', clearTeam);
  el('addPlayersBtn')?.addEventListener('click', () => switchTab('players'));
  el('importFplTeamBtn')?.addEventListener('click', importFplTeam);

  // Action sheet
  el('actionSetCaptain')?.addEventListener('click', () => {
    if (S.actionPid) { setCaptain(S.actionPid, 0); closeActionSheet(); }
  });
  el('actionSetVC')?.addEventListener('click', () => {
    if (S.actionPid) { setCaptain(S.actionPid, 1); closeActionSheet(); }
  });
  el('actionRemovePlayer')?.addEventListener('click', () => {
    if (S.actionPid) { removeFromTeam(S.actionPid); closeActionSheet(); }
  });
  el('actionCancel')?.addEventListener('click', closeActionSheet);
  el('actionSheetBackdrop')?.addEventListener('click', e => {
    if (e.target === el('actionSheetBackdrop')) closeActionSheet();
  });

  // Live
  el('liveRefreshBtn')?.addEventListener('click', fetchLive);

  // Fixtures
  el('fixtureGwSelect')?.addEventListener('change', renderFixtures);

  // Leagues
  el('leaguesLoginBtn')?.addEventListener('click', openModal);
  el('standingsBackBtn')?.addEventListener('click', hideStandings);
  el('classicLeaguesList')?.addEventListener('click', e => {
    const item = e.target.closest('.league-item');
    if (item) loadStandings(+item.dataset.lid, 'classic', item.dataset.name);
  });
  el('h2hLeaguesList')?.addEventListener('click', e => {
    const item = e.target.closest('.league-item');
    if (item) loadStandings(+item.dataset.lid, 'h2h', item.dataset.name);
  });
  el('standingsPagination')?.addEventListener('click', e => {
    const b = e.target.closest('.page-btn');
    if (b) loadStandings(S.currentLeagueId, S.currentLeagueType, null, +b.dataset.page);
  });

  // Global delegation — add buttons, pitch cards, search results
  document.addEventListener('click', handleGlobalClick);
}

function handleGlobalClick(e) {
  // Add-to-squad button in player table
  const addBtn = e.target.closest('.add-btn');
  if (addBtn && !addBtn.disabled) {
    const pid = parseInt(addBtn.dataset.pid);
    if (!isNaN(pid)) { togglePlayer(pid); return; }
  }

  // Remove button in team list
  const removeBtn = e.target.closest('.remove-btn');
  if (removeBtn) {
    const pid = parseInt(removeBtn.dataset.pid);
    if (!isNaN(pid)) { removeFromTeam(pid); return; }
  }

  // Pitch card → open action sheet (NOT immediate remove)
  const pitchCard = e.target.closest('.pitch-card[data-pid]');
  if (pitchCard) {
    const pid = parseInt(pitchCard.dataset.pid);
    if (!isNaN(pid)) { openActionSheet(pid); return; }
  }

  // Captain card
  const capCard = e.target.closest('.captain-card[data-pid]');
  if (capCard) {
    setCaptain(parseInt(capCard.dataset.pid), parseInt(capCard.dataset.rank));
    return;
  }

  // Manager search result
  const srBtn = e.target.closest('.sr-select');
  if (srBtn) {
    connectEntry(parseInt(srBtn.dataset.eid));
    return;
  }
}

/* ══════════════════════════════════════════════════════════════
   ACTION SHEET  (pitch card tap menu)
══════════════════════════════════════════════════════════════ */
function openActionSheet(pid) {
  S.actionPid = pid;
  const p = S.players.find(x => x.id === pid);
  if (!p) return;

  setText('actionPlayerName', p.web_name);
  setText('actionPlayerSub', `${p.posShort} · ${p.teamShort} · £${p.price.toFixed(1)}m`);

  // Update button labels based on current state
  const capBtn = el('actionSetCaptain');
  const vcBtn  = el('actionSetVC');
  if (capBtn) capBtn.textContent = S.captainId === pid ? '⭐ Remove Captain' : '⭐ Set as Captain';
  if (vcBtn)  vcBtn.textContent  = S.vcaptainId === pid ? '🔵 Remove Vice Captain' : '🔵 Set as Vice Captain';

  const sheet = el('actionSheetBackdrop');
  if (sheet) sheet.style.display = 'flex';
}

function closeActionSheet() {
  S.actionPid = null;
  const sheet = el('actionSheetBackdrop');
  if (sheet) sheet.style.display = 'none';
}

/* ══════════════════════════════════════════════════════════════
   LOADING HELPERS
══════════════════════════════════════════════════════════════ */
function setLoadingProgress(pct, msg) {
  const bar = el('loadingBar'), txt = el('loadingMsg');
  if (bar) bar.style.width = pct + '%';
  if (txt) txt.textContent = msg;
}

function showLoadingError(msg) {
  const ls = el('loadingScreen');
  if (!ls) return;
  ls.innerHTML = `
    <div class="loading-logo">FPL <span>CORTEX</span></div>
    <div style="color:var(--red);font-family:var(--font-data);font-size:0.78rem;
      margin-top:1rem;text-align:center;max-width:300px;line-height:1.8;">${msg}</div>
    <button id="retryBtn" class="btn btn-green btn-sm" style="margin-top:1.5rem;">↻ RETRY</button>`;
  el('retryBtn')?.addEventListener('click', () => location.reload());
}

/* ══════════════════════════════════════════════════════════════
   DATA PROCESSING
══════════════════════════════════════════════════════════════ */
function sortFixtures() {
  S.allFixtures.sort((a, b) => {
    const ea = a.event || 99, eb = b.event || 99;
    if (ea !== eb) return ea - eb;
    // within same GW, unfinished first
    return (a.finished ? 1 : 0) - (b.finished ? 1 : 0);
  });
}

function processBootstrap(data) {
  try {
    S.bootstrap = data;
    data.teams.forEach(t => { S.teams[t.id] = t; });
    data.element_types.forEach(et => {
      S.positions[et.id] = { short: et.singular_name_short, full: et.singular_name };
    });
    S.players = data.elements.map(processPlayer);

    const cur = data.events.find(e => e.is_current);
    const nxt = data.events.find(e => e.is_next);
    S.currentGW = cur ? cur.id : (nxt ? nxt.id - 1 : null);
    S.nextGW    = nxt ? nxt.id : null;

    setText('gwBadge', S.currentGW ? `GW ${S.currentGW}` : 'GW —');
    if (cur) {
      setText('liveGwAvg',     cur.average_entry_score || '—');
      setText('liveGwHighest', cur.highest_score       || '—');
      setText('dashGwAvg',     cur.average_entry_score || '—');
    }
    return true;
  } catch (err) { console.error('processBootstrap:', err); return false; }
}

function processPlayer(p) {
  const team = S.teams[p.team] || {}, pos = S.positions[p.element_type] || {};
  const upcomingFixtures = getUpcomingFixtures(p.team, 3);
  const avgFDR = upcomingFixtures.length
    ? upcomingFixtures.reduce((s, f) => s + f.difficulty, 0) / upcomingFixtures.length : 3;

  const form = parseFloat(p.form) || 0, fdrMul = fdrMult(avgFDR);
  const avgMins = p.minutes / Math.max(1, S.currentGW || 1);
  const minFac  = 0.5 + 0.5 * Math.min(1, avgMins / 90);
  let proj = form * fdrMul * minFac;
  const ict = parseFloat(p.ict_index) || 0;
  if (p.element_type === 3 || p.element_type === 4) proj += (ict / 100) * 0.8;
  if (p.element_type === 1 || p.element_type === 2) {
    const cs = avgFDR <= 2 ? 0.5 : avgFDR <= 3 ? 0.35 : 0.2;
    proj += cs * (p.element_type === 1 ? 6 : 4);
  }
  const ep = parseFloat(p.ep_next) || 0;
  if (ep > 0) proj = proj * 0.4 + ep * 0.6;

  return {
    ...p,
    teamName:  team.name || '—', teamShort: team.short_name || '—',
    posShort:  pos.short || '—', price: p.now_cost / 10,
    formVal: form, projectedPts: Math.round(proj * 10) / 10,
    avgFDR, upcomingFixtures,
  };
}

function fdrMult(fdr) {
  return fdr <= 1.5 ? 1.5 : fdr <= 2.5 ? 1.25 : fdr <= 3.5 ? 1.0 : fdr <= 4.5 ? 0.75 : 0.55;
}

/* ── FIX: upcoming fixtures — only future/unplayed GWs ─────── */
function getUpcomingFixtures(teamId, count = 3) {
  // Use next GW as the starting point (GW31 if we're about to enter GW31)
  // If current GW has unfinished games, include those too
  const startGW = S.nextGW || (S.currentGW ? S.currentGW + 1 : 1);
  const results = [];

  for (const f of S.allFixtures) {
    if (results.length >= count) break;
    if (!f.event) continue;
    // Only include fixtures from startGW onwards
    if (f.event < startGW) continue;
    if (f.finished) continue; // skip already played

    if (f.team_h === teamId) {
      results.push({ opponent: S.teams[f.team_a]?.short_name || '?', home: true,  difficulty: f.team_h_difficulty, gw: f.event });
    } else if (f.team_a === teamId) {
      results.push({ opponent: S.teams[f.team_h]?.short_name || '?', home: false, difficulty: f.team_a_difficulty, gw: f.event });
    }
  }
  return results;
}

async function fetchLive() {
  const btn = el('liveRefreshBtn');
  if (btn) btn.classList.add('spinning');
  const gw = S.currentGW || S.nextGW;
  if (!gw) { if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ REFRESH'; } return; }

  try {
    const res = await fplFetch(`/event/${gw}/live/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const map = {};
    for (const e of (raw.elements || [])) map[e.id] = e;
    S.liveData = map;
    renderLivePanel();
    renderMyTeam();
    const badge = el('liveUpdateBadge');
    if (badge) { const n = new Date(); badge.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}`; }
  } catch (err) {
    console.warn('Live:', err.message);
    setHTML('livePlayerList', emptyState('◎', 'NO LIVE DATA', 'Active during live gameweeks.'));
  }
  if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ REFRESH'; }
}

async function refreshData() {
  cSet('bootstrap', null); cSet('fixtures', null);
  sessionStorage.removeItem('bootstrap'); sessionStorage.removeItem('fixtures');
  const btn = el('refreshBtn');
  if (btn) btn.classList.add('spinning');
  try {
    const [bRes, fRes] = await Promise.all([fplFetch('/bootstrap-static/'), fplFetch('/fixtures/')]);
    const bd = await bRes.json(), fd = fRes.ok ? await fRes.json() : [];
    cSet('bootstrap', bd); cSet('fixtures', fd);
    S.allFixtures = fd; sortFixtures();
    processBootstrap(bd); renderAll();
  } catch (err) { console.error('Refresh:', err); }
  if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ REFRESH'; }
}

function renderAll() {
  renderDashboard(); renderPlayerTable(); renderMyTeam();
  renderTransfers(); renderFixtureGwSelect(); renderFixtures();
}

/* ══════════════════════════════════════════════════════════════
   TAB NAVIGATION
══════════════════════════════════════════════════════════════ */
function switchTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'myteam')    renderMyTeam();
  if (name === 'transfers') renderTransfers();
  if (name === 'fixtures')  renderFixtures();
  if (name === 'live')      renderLivePanel();
  if (name === 'dashboard') renderDashboard();
  if (name === 'leagues')   renderLeaguesTab();
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════════ */
function renderDashboard() {
  const { starters } = getSquadGroups();
  const mp  = myPlayers();
  const cap = starters.find(p => p.id === S.captainId);

  // ── FIX: only count starters' projected points ──
  let proj = starters.reduce((s, p) => s + p.projectedPts, 0);
  if (cap) proj += cap.projectedPts; // captain doubled

  setText('dashProjected',  Math.round(proj * 10) / 10);
  setText('dashCaptainPts', cap ? Math.round(cap.projectedPts * 2 * 10) / 10 : '—');
  setText('dashCaptainName', cap ? cap.web_name : 'No Captain');
  setText('dashValue', `£${mp.reduce((s, p) => s + p.price, 0).toFixed(1)}m`);
  setText('dashPlayerCount', `${mp.length} / 15`);

  const bar = el('fplAccountBar');
  if (bar) {
    if (S.fplPlayer) {
      bar.style.display = 'flex';
      setText('fplManagerName', `${S.fplPlayer.first_name} ${S.fplPlayer.last_name}`);
      setText('fplTeamMeta',
        `${S.fplPlayer.teamName || ''} · ${S.fplPlayer.summary_overall_points || '—'} pts · Rank ${S.fplPlayer.summary_overall_rank?.toLocaleString() || '—'}`);
    } else { bar.style.display = 'none'; }
  }

  renderCaptainSuggestions(starters.length ? starters : mp);
  renderRiskAnalysis(mp);
}

/* ══════════════════════════════════════════════════════════════
   SQUAD GROUPING — starters vs bench, formation
══════════════════════════════════════════════════════════════ */
function getSquadGroups() {
  const mp = myPlayers();
  if (!mp.length) return { starters: [], bench: [], formation: '—', byPos: {} };

  // Sort by pick order (from FPL import) or by position priority
  const sorted = [...mp].sort((a, b) => {
    const pa = S.pickOrder[a.id] || 99;
    const pb = S.pickOrder[b.id] || 99;
    return pa - pb;
  });

  // Starters = picks 1-11, bench = picks 12-15
  // If no pick order, use positional logic
  let starters, bench;
  const hasOrder = Object.keys(S.pickOrder).length > 0;

  if (hasOrder) {
    starters = sorted.filter(p => (S.pickOrder[p.id] || 99) <= 11);
    bench    = sorted.filter(p => (S.pickOrder[p.id] || 99) > 11);
  } else {
    // Auto: 1 GKP + best 10 outfield by projectedPts
    const gkps    = sorted.filter(p => p.posShort === 'GKP');
    const outfield = sorted.filter(p => p.posShort !== 'GKP').sort((a,b)=>b.projectedPts-a.projectedPts);
    starters = [...gkps.slice(0,1), ...outfield.slice(0,10)];
    bench    = [...gkps.slice(1),   ...outfield.slice(10)];
  }

  // Group starters by position for pitch display
  const byPos = { GKP:[], DEF:[], MID:[], FWD:[] };
  starters.forEach(p => { if (byPos[p.posShort]) byPos[p.posShort].push(p); });

  const formation = starters.length >= 10
    ? `${byPos.DEF.length}-${byPos.MID.length}-${byPos.FWD.length}`
    : '—';

  S.starterIds = starters.map(p => p.id);

  return { starters, bench, formation, byPos };
}

/* ══════════════════════════════════════════════════════════════
   CAPTAIN AI
══════════════════════════════════════════════════════════════ */
function capScore(p) {
  return (p.formVal * 3 + (parseFloat(p.ict_index) || 0) / 20 + p.projectedPts) * fdrMult(p.avgFDR);
}

function renderCaptainSuggestions(pool) {
  if (!pool.length) { setHTML('captainArea', emptyState('🎖', 'NO SQUAD', 'Import or add players first.')); return; }

  const ranked = [...pool].sort((a, b) => capScore(b) - capScore(a)).slice(0, 3);

  setHTML('captainArea', `<div class="captain-cards">${ranked.map((p, i) => {
    const fix = p.upcomingFixtures[0];
    const fixStr = fix
      ? `${fix.home ? '' : '@'}${fix.opponent} GW${fix.gw} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`
      : 'No upcoming fixture';
    return `<div class="captain-card ${i===0?'rank-1':''}" data-pid="${p.id}" data-rank="${i}">
      <div class="cc-name">${p.web_name}</div>
      <div class="cc-team">${p.teamShort} · ${p.posShort}</div>
      <div class="cc-ep">${Math.round(p.projectedPts*(i===0?2:1)*10)/10}</div>
      <div class="cc-score">Next: ${fixStr}</div>
      <div style="margin-top:5px;font-family:var(--font-data);font-size:0.58rem;color:var(--text-sub);">
        Form ${p.form} · £${p.price}m · ${p.selected_by_percent}% own</div>
      ${i===0&&p.id===S.captainId   ? '<div class="card-badge badge-amber" style="margin-top:5px;display:inline-block">★ SET</div>' : ''}
      ${i===1&&p.id===S.vcaptainId  ? '<div class="card-badge badge-blue"  style="margin-top:5px;display:inline-block">V SET</div>'  : ''}
    </div>`;
  }).join('')}</div>`);
}

function setCaptain(pid, rank) {
  if (rank === 0) {
    S.captainId  = S.captainId === pid ? null : pid; // toggle off if already set
    S.captainId !== null
      ? localStorage.setItem('fpl_captain', pid)
      : localStorage.removeItem('fpl_captain');
  }
  if (rank === 1) {
    S.vcaptainId = S.vcaptainId === pid ? null : pid;
    S.vcaptainId !== null
      ? localStorage.setItem('fpl_vcaptain', pid)
      : localStorage.removeItem('fpl_vcaptain');
  }
  const { starters } = getSquadGroups();
  renderCaptainSuggestions(starters.length ? starters : myPlayers());
  renderMyTeam();
  renderDashboard();
}

function autoPickCaptain() {
  const { starters } = getSquadGroups();
  const pool = starters.length ? starters : myPlayers();
  if (!pool.length) return;
  const r = [...pool].sort((a, b) => capScore(b) - capScore(a));
  S.captainId  = r[0]?.id || null;
  S.vcaptainId = r[1]?.id || null;
  saveTeam();
  renderCaptainSuggestions(pool);
  renderMyTeam();
  renderDashboard();
}

/* ══════════════════════════════════════════════════════════════
   RISK
══════════════════════════════════════════════════════════════ */
function getRisk(p) {
  const risks = [], avgMins = p.minutes / Math.max(1, S.currentGW || 1);
  if (p.chance_of_playing_next_round !== null && p.chance_of_playing_next_round < 75)
    risks.push({ level:'high',   reason:`${p.chance_of_playing_next_round}% chance — ${p.news || 'injury doubt'}` });
  else if (p.chance_of_playing_next_round !== null && p.chance_of_playing_next_round < 100)
    risks.push({ level:'medium', reason:`Slight doubt — ${p.news || 'monitor fitness'}` });
  if (p.formVal === 0 && p.total_points > 0)
    risks.push({ level:'high',   reason:'Zero form — not scoring recently' });
  else if (p.formVal < 2 && p.total_points > 0)
    risks.push({ level:'medium', reason:`Poor form: ${p.form} pts/gm` });
  if (p.avgFDR >= 4.5) risks.push({ level:'high',   reason:`Brutal fixtures — FDR ${p.avgFDR.toFixed(1)}` });
  else if (p.avgFDR >= 3.8) risks.push({ level:'medium', reason:`Tough fixtures — FDR ${p.avgFDR.toFixed(1)}` });
  if (avgMins < 45) risks.push({ level:'medium', reason:`Rotation risk — avg ${Math.round(avgMins)} mins/GW` });
  return risks;
}

function renderRiskAnalysis(mp) {
  if (!mp.length) { setHTML('riskArea', `<div class="card">${emptyState('🛡','NO SQUAD DATA','Build your team to see risk flags.')}</div>`); return; }
  const flagged = mp.map(p=>({p,r:getRisk(p)})).filter(x=>x.r.length)
    .sort((a,b)=>(b.r[0].level==='high'?2:1)-(a.r[0].level==='high'?2:1));
  if (!flagged.length) { setHTML('riskArea',`<div class="card">${emptyState('✅','ALL CLEAR','No risk flags. Clean picks.')}</div>`); return; }
  setHTML('riskArea',`<div class="card">${flagged.map(({p,r})=>`
    <div class="risk-item">
      <div class="risk-bar ${r[0].level==='high'?'risk-high':'risk-medium'}"></div>
      <div>
        <div style="font-weight:700">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div>
        ${r.map(x=>`<div class="risk-reason">⚠ ${x.reason}</div>`).join('')}
      </div>
      <div style="margin-left:auto;text-align:right;">
        <div class="stat-label" style="font-size:0.56rem">FORM</div>
        <div style="font-family:var(--font-data);font-size:0.88rem;color:${r[0].level==='high'?'var(--red)':'var(--amber)'};">${p.form}</div>
      </div>
    </div>`).join('')}</div>`);
}

/* ══════════════════════════════════════════════════════════════
   PLAYER TABLE
══════════════════════════════════════════════════════════════ */
function filterPlayers() { S.page = 1; renderPlayerTable(); }

function renderPlayerTable() {
  if (!S.players.length) return;

  const search  = (el('playerSearch')?.value || '').toLowerCase();
  const posF    =  el('posFilter')?.value    || '';
  const teamF   =  el('teamFilter')?.value   || '';
  const sortKey =  el('sortSelect')?.value   || 'total_points';

  const tf = el('teamFilter');
  if (tf && tf.options.length === 1) {
    Object.values(S.teams).sort((a,b)=>a.name.localeCompare(b.name)).forEach(t => {
      const o = document.createElement('option');
      o.value = t.name; o.textContent = t.name; tf.appendChild(o);
    });
  }

  let list = S.players.filter(p => {
    const nm = `${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase();
    return (!search || nm.includes(search) || p.teamName.toLowerCase().includes(search))
        && (!posF || p.posShort === posF) && (!teamF || p.teamName === teamF);
  }).sort((a,b) => (parseFloat(b[sortKey]) || 0) - (parseFloat(a[sortKey]) || 0));

  S.filteredPlayers = list;
  const total = list.length, pages = Math.ceil(total / S.pageSize);
  const slice = list.slice((S.page-1)*S.pageSize, S.page*S.pageSize);

  setText('squadIndicator', S.myTeam.length);

  const tbody = el('playerTableBody');
  if (!tbody) return;

  tbody.innerHTML = !slice.length
    ? `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-sub)">No players match.</td></tr>`
    : slice.map(p => {
        const inTeam  = S.myTeam.includes(p.id);
        const full    = !inTeam && S.myTeam.length >= 15;
        const formCls = p.formVal >= 6 ? 'form-hi' : p.formVal >= 3 ? 'form-mid' : 'form-lo';
        const risks   = getRisk(p);
        const flag    = risks.length ? `<span title="${risks[0].reason}" style="cursor:help">${risks[0].level==='high'?'🔴':'🟡'}</span>` : '';
        const avail   = (p.chance_of_playing_next_round !== null && p.chance_of_playing_next_round < 100)
          ? `<div class="news-banner">⚠ ${p.news || p.chance_of_playing_next_round + '%'}</div>` : '';
        return `<tr>
          <td>
            <div class="player-name">${p.web_name} ${flag}</div>
            <div class="player-sub">${p.teamShort}</div>${avail}
          </td>
          <td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td>
          <td><span class="price-val">£${p.price.toFixed(1)}</span></td>
          <td><span class="form-val ${formCls}">${p.form}</span></td>
          <td><span class="pts-val">${p.total_points}</span></td>
          <td><span class="ep-val">${p.ep_next || '—'}</span></td>
          <td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td>
          <td><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''}>${inTeam?'✓':'＋'}</button></td>
        </tr>`;
      }).join('');

  const pag = el('playerPagination');
  if (!pag) return;
  if (pages <= 1) { pag.innerHTML = ''; return; }
  let ph = '';
  if (S.page > 1) ph += `<button class="page-btn" data-p="${S.page-1}">‹</button>`;
  for (let i=Math.max(1,S.page-2); i<=Math.min(pages,S.page+2); i++)
    ph += `<button class="page-btn ${i===S.page?'active':''}" data-p="${i}">${i}</button>`;
  if (S.page < pages) ph += `<button class="page-btn" data-p="${S.page+1}">›</button>`;
  ph += `<span style="font-family:var(--font-data);font-size:0.62rem;color:var(--text-sub);margin-left:0.4rem">${total} players</span>`;
  pag.innerHTML = ph;
  pag.querySelectorAll('.page-btn').forEach(b => b.addEventListener('click', () => {
    S.page = parseInt(b.dataset.p); renderPlayerTable();
    el('playerTable')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }));
}

/* ══════════════════════════════════════════════════════════════
   MY TEAM
══════════════════════════════════════════════════════════════ */
function togglePlayer(pid) {
  const idx = S.myTeam.indexOf(pid);
  if (idx === -1) {
    if (S.myTeam.length >= 15) return;
    S.myTeam.push(pid);
  } else {
    S.myTeam.splice(idx, 1);
    if (S.captainId  === pid) S.captainId  = null;
    if (S.vcaptainId === pid) S.vcaptainId = null;
    delete S.pickOrder[pid];
  }
  saveTeam();
  renderPlayerTable(); renderMyTeam(); renderDashboard();
}

function removeFromTeam(pid) {
  const idx = S.myTeam.indexOf(pid);
  if (idx !== -1) {
    S.myTeam.splice(idx, 1);
    if (S.captainId  === pid) { S.captainId  = null; localStorage.removeItem('fpl_captain'); }
    if (S.vcaptainId === pid) { S.vcaptainId = null; localStorage.removeItem('fpl_vcaptain'); }
    delete S.pickOrder[pid];
    saveTeam();
    renderMyTeam(); renderPlayerTable(); renderDashboard();
  }
}

function clearTeam() {
  if (!confirm('Clear entire squad?')) return;
  S.myTeam=[]; S.captainId=null; S.vcaptainId=null; S.pickOrder={};
  ['fpl_myteam','fpl_captain','fpl_vcaptain','fpl_pickorder'].forEach(k=>localStorage.removeItem(k));
  renderMyTeam(); renderDashboard(); renderPlayerTable();
}

function renderMyTeam() {
  const mp = myPlayers();
  const { starters, bench, formation, byPos } = getSquadGroups();

  setText('squadCount',   mp.length);
  setText('squadValue',   `£${mp.reduce((s,p)=>s+p.price,0).toFixed(1)}m`);
  setText('formationDisplay', mp.length >= 11 ? formation : '—');

  // Projected pts = starters only + captain bonus
  let proj = starters.reduce((s,p) => s+p.projectedPts, 0);
  const cap = starters.find(p => p.id === S.captainId);
  if (cap) proj += cap.projectedPts;
  setText('squadProjPts', Math.round(proj*10)/10);

  const impBtn = el('importFplTeamBtn');
  if (impBtn) impBtn.style.display = S.fplEntryId ? 'inline-flex' : 'none';

  // Render pitch rows: FWD on top, GKP at bottom
  [
    { id:'pitchFWD', players:byPos.FWD || [] },
    { id:'pitchMID', players:byPos.MID || [] },
    { id:'pitchDEF', players:byPos.DEF || [] },
    { id:'pitchGKP', players:byPos.GKP || [] },
  ].forEach(({ id, players }) => {
    const row = el(id);
    if (!row) return;
    if (!players.length) { row.innerHTML = `<div class="pitch-empty">+</div>`; return; }
    row.innerHTML = players.map(p => pitchCardHTML(p)).join('');
  });

  // Bench — shown but NOT counted in points
  const benchEl = el('pitchBench');
  if (benchEl) {
    benchEl.innerHTML = bench.length
      ? bench.map(p => pitchCardHTML(p, true)).join('')
      : `<div class="pitch-empty" style="width:52px">—</div>`;
  }

  // Detailed list below pitch
  if (!mp.length) {
    setHTML('teamListArea', emptyState('👕','SQUAD IS EMPTY','Tap "+ Players" or LOGIN to import your FPL squad.'));
    return;
  }

  // Show starters first, then bench
  const ordered = [...starters, ...bench];
  setHTML('teamListArea', ordered.map((p, i) => {
    const isC=p.id===S.captainId, isV=p.id===S.vcaptainId;
    const isBenchPlayer = !S.starterIds.includes(p.id);
    const risks=getRisk(p);
    const fix=p.upcomingFixtures[0];
    const fixStr=fix?`${fix.home?'':' @'}${fix.opponent} GW${fix.gw} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'No fixture';
    const tc=teamColor(p.teamShort);
    const live=S.liveData?.[p.id]?.stats;
    const livePts=live?live.total_points:null;
    const breakdown=live?buildPtsBreakdown(S.liveData[p.id]):'';

    // Bench label separator
    const benchSep = isBenchPlayer && i === starters.length
      ? `<div style="font-family:var(--font-data);font-size:0.58rem;color:var(--text-sub);letter-spacing:2px;padding:0.5rem 0 0.25rem;border-top:1px dashed var(--border);margin-top:0.25rem;">BENCH (NOT COUNTED)</div>` : '';

    return `${benchSep}<div class="team-list-row" style="${isBenchPlayer?'opacity:0.65':''}">
      <div class="team-color-bar" style="background:${tc.p}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          ${p.web_name}
          ${isC?'<span class="card-badge badge-amber">C</span>':''}
          ${isV?'<span class="card-badge badge-blue">V</span>':''}
          <span class="pos-chip pos-${p.posShort}">${p.posShort}</span>
        </div>
        <div style="font-size:0.7rem;color:var(--text-sub)">${p.teamShort} · Next: ${fixStr}</div>
        ${risks.length?`<div style="font-size:0.68rem;color:var(--amber);margin-top:1px">⚠ ${risks[0].reason}</div>`:''}
        ${breakdown?`<div class="pts-breakdown">${breakdown}</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="tl-pts ${livePts!==null?'live-pts':'proj-pts'}">${livePts!==null?livePts:p.projectedPts}</div>
        <div style="font-family:var(--font-data);font-size:0.56rem;color:var(--text-sub)">${livePts!==null?'pts':'xP'}</div>
        <div style="font-family:var(--font-data);font-size:0.58rem;color:var(--text-sub)">£${p.price.toFixed(1)}m</div>
      </div>
      <button class="remove-btn" data-pid="${p.id}" style="padding:5px 9px;font-size:0.75rem">✕</button>
    </div>`;
  }).join(''));
}

/* Pitch card — simple jersey, no clip-path, works on all Android */
function pitchCardHTML(p, isBench=false) {
  const isC=p.id===S.captainId, isV=p.id===S.vcaptainId;
  const live=S.liveData?.[p.id]?.stats;
  const pts=live?live.total_points:null;
  const ptsDisplay=pts!==null?pts+'pts':p.projectedPts+'xP';
  const ptsClass=pts!==null?'live-pts':'';
  const tc=teamColor(p.teamShort);

  return `<div class="pitch-card" data-pid="${p.id}">
    ${isC?'<div class="cap-badge">C</div>':''}
    ${isV?'<div class="vc-badge">V</div>':''}
    <div class="jersey" style="background:${tc.p};--sleeve-color:${tc.s}">
      <span class="jersey-text">${p.teamShort}</span>
    </div>
    <div class="pitch-name">${p.web_name}</div>
    <div class="pitch-pts ${ptsClass}">${ptsDisplay}</div>
  </div>`;
}

/* Points breakdown chips */
function buildPtsBreakdown(liveEl) {
  if (!liveEl) return '';
  const LABELS = {
    minutes:'mins', goals_scored:'⚽', assists:'🅰', clean_sheets:'CS',
    goals_conceded:'GC', own_goals:'OG', penalties_saved:'pen sav',
    penalties_missed:'pen miss', yellow_cards:'🟨', red_cards:'🟥',
    saves:'saves', bonus:'★bonus',
  };
  const stats = liveEl.explain?.flatMap(e=>e.stats||[])||[];
  if (!stats.length) {
    const s=liveEl.stats||{}, chips=[];
    if(s.minutes>=60) chips.push(`<span class="pts-chip pos">${s.minutes}' +2</span>`);
    else if(s.minutes>0) chips.push(`<span class="pts-chip pos">${s.minutes}' +1</span>`);
    if(s.goals_scored>0) chips.push(`<span class="pts-chip pos">⚽×${s.goals_scored}</span>`);
    if(s.assists>0)      chips.push(`<span class="pts-chip pos">🅰×${s.assists}</span>`);
    if(s.clean_sheets>0) chips.push(`<span class="pts-chip pos">CS +4</span>`);
    if(s.bonus>0)        chips.push(`<span class="pts-chip bonus">★${s.bonus}</span>`);
    if(s.yellow_cards>0) chips.push(`<span class="pts-chip neg">🟨 -1</span>`);
    if(s.red_cards>0)    chips.push(`<span class="pts-chip neg">🟥 -3</span>`);
    if(s.own_goals>0)    chips.push(`<span class="pts-chip neg">OG -2</span>`);
    return chips.join('');
  }
  return stats.filter(s=>s.points!==0).map(s=>{
    const cls=s.identifier==='bonus'?'bonus':s.points>0?'pos':'neg';
    const lbl=LABELS[s.identifier]||s.identifier.replace(/_/g,' ');
    return `<span class="pts-chip ${cls}">${lbl} ${s.points>0?'+':''}${s.points}</span>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   TRANSFERS
══════════════════════════════════════════════════════════════ */
function renderTransfers() {
  const mp=myPlayers();
  if (!mp.length) { setHTML('transferArea',emptyState('⇄','NO SQUAD','Build your team first.')); }
  else {
    const sugg=[];
    mp.forEach(cur=>{
      const best=S.players.filter(p=>p.element_type===cur.element_type&&p.id!==cur.id&&!S.myTeam.includes(p.id)&&p.price<=cur.price+0.5&&p.projectedPts>cur.projectedPts)
        .sort((a,b)=>b.projectedPts-a.projectedPts)[0];
      if(best) sugg.push({out:cur,in:best,gain:Math.round((best.projectedPts-cur.projectedPts)*10)/10});
    });
    sugg.sort((a,b)=>b.gain-a.gain);
    const top=sugg.slice(0,8);
    if (!top.length) setHTML('transferArea',emptyState('✅','OPTIMAL','No better options within budget.'));
    else {
      const fx=f=>f?`${f.home?'':'@'}${f.opponent} GW${f.gw} <span class="fdr fdr-${f.difficulty}">${f.difficulty}</span>`:'';
      setHTML('transferArea',`
        <div class="card-header" style="margin-bottom:0.75rem">
          <span class="card-title">AI SUGGESTIONS</span><span class="card-badge badge-green">TOP ${top.length}</span></div>
        ${top.map(s=>`<div class="transfer-item">
          <div class="transfer-out"><div class="transfer-label">OUT</div>
            <div class="transfer-player" style="color:var(--red)">${s.out.web_name}</div>
            <div class="transfer-stats">Form ${s.out.form}·£${s.out.price.toFixed(1)}m ${fx(s.out.upcomingFixtures[0])}</div></div>
          <div class="transfer-arrow">→</div>
          <div class="transfer-in"><div class="transfer-label">IN</div>
            <div class="transfer-player" style="color:var(--green)">${s.in.web_name}</div>
            <div class="transfer-stats">Form ${s.in.form}·£${s.in.price.toFixed(1)}m ${fx(s.in.upcomingFixtures[0])}</div></div>
          <div class="transfer-gain">+${s.gain}xP</div>
        </div>`).join('')}`);
    }
  }

  const active=S.players.filter(p=>p.transfers_in_event>0||p.transfers_out_event>0);
  const topIn  =[...active].sort((a,b)=>b.transfers_in_event -a.transfers_in_event).slice(0,8);
  const topOut =[...active].sort((a,b)=>b.transfers_out_event-a.transfers_out_event).slice(0,8);
  const noData='<div style="padding:1rem;color:var(--text-sub);font-size:0.78rem">No data yet.</div>';
  const row=(p,key,color)=>{
    const val=p[key],maxV=(key==='transfers_in_event'?(topIn[0]?.[key]||1):(topOut[0]?.[key]||1));
    return `<div style="padding:0.45rem 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between">
        <div><div style="font-weight:700;font-size:0.82rem">${p.web_name}</div>
          <div style="font-size:0.68rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m·${p.form}</div></div>
        <div style="font-family:var(--font-data);font-size:0.68rem;color:${color}">${val.toLocaleString()}</div>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(val/maxV*100)}%;background:${color}"></div></div>
    </div>`;
  };
  const inEl=el('transfersInList'), outEl=el('transfersOutList');
  if(inEl)  inEl.innerHTML  =topIn.length  ?topIn.map(p=>row(p,'transfers_in_event', 'var(--green)')).join(''):noData;
  if(outEl) outEl.innerHTML =topOut.length ?topOut.map(p=>row(p,'transfers_out_event','var(--red)')).join('')  :noData;
}

/* ══════════════════════════════════════════════════════════════
   FIXTURES
══════════════════════════════════════════════════════════════ */
function renderFixtureGwSelect() {
  const sel=el('fixtureGwSelect');
  if(!sel||!S.bootstrap) return;
  sel.innerHTML=S.bootstrap.events.filter(e=>e.id>=1)
    .map(e=>`<option value="${e.id}" ${e.is_current?'selected':''}>${e.name}</option>`).join('');
}

function renderFixtures() {
  const gw=parseInt(el('fixtureGwSelect')?.value||S.currentGW||1);
  const list=S.allFixtures.filter(f=>f.event===gw);
  if(!list.length){setHTML('fixturesArea','<div style="padding:2rem;text-align:center;color:var(--text-sub)">No fixtures found.</div>');return;}
  setHTML('fixturesArea',list.map(f=>{
    const h=S.teams[f.team_h],a=S.teams[f.team_a];
    const ko=f.kickoff_time?new Date(f.kickoff_time):null;
    const ts=ko?ko.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+' '+ko.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'TBC';
    let mid;
    if(f.finished||f.finished_provisional) mid=`<div class="fixture-score">${f.team_h_score??'?'}–${f.team_a_score??'?'}</div>`;
    else if(f.started) mid=`<div class="fixture-score" style="color:var(--amber)">${f.team_h_score??0}–${f.team_a_score??0}</div><div class="fixture-time">LIVE ${f.minutes}'</div>`;
    else mid=`<div class="fixture-vs">vs</div><div class="fixture-time">${ts}</div>`;
    return `<div class="fixture-item">
      <div class="fixture-team home"><span class="fdr fdr-${f.team_h_difficulty}">${f.team_h_difficulty}</span> ${h?.name||'?'}</div>
      <div class="fixture-center">${mid}</div>
      <div class="fixture-team">${a?.name||'?'} <span class="fdr fdr-${f.team_a_difficulty}">${f.team_a_difficulty}</span></div>
    </div>`;
  }).join(''));
}

/* ══════════════════════════════════════════════════════════════
   LIVE GW
══════════════════════════════════════════════════════════════ */
function renderLivePanel() {
  const { starters, bench } = getSquadGroups();
  const mp=myPlayers();
  if(!mp.length){setHTML('livePlayerList',emptyState('◎','NO SQUAD','Build your team first.'));return;}
  if(!S.liveData){setHTML('livePlayerList',emptyState('◎','NO LIVE DATA','Active during live gameweeks.'));return;}

  // Starters sorted by live points desc
  const sorted=[...starters].sort((a,b)=>
    (S.liveData[b.id]?.stats?.total_points??0)-(S.liveData[a.id]?.stats?.total_points??0));

  // ── FIX: only starters count (unless bench boost) ──
  let total=0;
  const rows=sorted.map(p=>{
    const live=S.liveData[p.id]?.stats||{},pts=live.total_points??0;
    const isC=p.id===S.captainId,isV=p.id===S.vcaptainId,eff=isC?pts*2:pts;
    total+=eff;
    const breakdown=buildPtsBreakdown(S.liveData[p.id]);
    const col=pts>=10?'var(--green)':pts>=6?'var(--amber)':'var(--text)';
    const tc=teamColor(p.teamShort);
    return `<div class="team-list-row">
      <div class="team-color-bar" style="background:${tc.p}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          ${p.web_name}
          ${isC?'<span class="card-badge badge-amber">C×2</span>':''}
          ${isV?'<span class="card-badge badge-blue">V/C</span>':''}
          <span class="pos-chip pos-${p.posShort}">${p.posShort}</span>
        </div>
        <div style="font-size:0.68rem;color:var(--text-sub)">${p.teamShort}·${live.minutes??0} mins</div>
        ${breakdown?`<div class="pts-breakdown">${breakdown}</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:var(--font-data);font-size:1.3rem;font-weight:700;color:${col}">${eff}</div>
        <div style="font-family:var(--font-data);font-size:0.56rem;color:var(--text-sub)">pts</div>
      </div>
    </div>`;
  });
  setHTML('livePlayerList',rows.join(''));
  setText('liveSquadPts',total);
}

/* ══════════════════════════════════════════════════════════════
   FPL ACCOUNT
══════════════════════════════════════════════════════════════ */
function openModal() {
  const m=el('loginModal');if(m)m.style.display='flex';
  const inp=el('loginTeamId');if(inp)inp.value='';
  clearLoginErr();
}
function closeModal() { const m=el('loginModal');if(m)m.style.display='none'; clearLoginErr(); }
function clearLoginErr() { const e=el('loginError');if(e){e.style.display='none';e.textContent='';} }
function setLoginErr(msg) { const e=el('loginError');if(e){e.style.display='block';e.textContent=msg;} }

function handleAccountBtn() {
  if (S.fplEntryId) switchTab('leagues'); else openModal();
}

async function submitTeamId() {
  const inp=el('loginTeamId'), btn=el('loginSubmitBtn');
  const id=parseInt(inp?.value?.trim());
  if(!id||isNaN(id)){setLoginErr('Enter a valid Team ID (numbers only).');return;}
  clearLoginErr();
  if(btn){btn.textContent='CONNECTING...';btn.disabled=true;}
  try { await connectEntry(id); }
  catch(err) { setLoginErr(`Failed: ${err.message}`); }
  finally { if(btn){btn.textContent='CONNECT TEAM';btn.disabled=false;} }
}

async function connectEntry(entryId) {
  const res=await fplFetch(`/entry/${entryId}/`);
  if(!res.ok){setLoginErr(`No FPL team found with ID ${entryId}.`);return;}
  const raw=await res.json();
  S.fplEntryId=entryId;
  S.fplPlayer={ first_name:raw.player_first_name||'', last_name:raw.player_last_name||'', teamName:raw.name||'', summary_overall_points:raw.summary_overall_points, summary_overall_rank:raw.summary_overall_rank, summary_event_points:raw.summary_event_points, entry:entryId };
  S.myLeagues=raw.leagues||{classic:[],h2h:[]};
  localStorage.setItem('fpl_entry_id',entryId);
  localStorage.setItem('fpl_player',JSON.stringify(S.fplPlayer));
  localStorage.setItem('fpl_leagues',JSON.stringify(S.myLeagues));
  closeModal(); updateAccountUI(); renderDashboard();
  await importFplTeam();
}

async function searchManager() {
  const inp=el('managerSearchInput'),res=el('managerSearchResults');
  const q=inp?.value?.trim();if(!q||!res)return;
  res.style.display='block';
  res.innerHTML='<div style="color:var(--text-sub);font-size:0.78rem;padding:0.5rem">Searching...</div>';
  try {
    const r=await fplFetch(`/search/?q=${encodeURIComponent(q)}&page_size=8`);
    if(!r.ok) throw new Error('No results');
    const data=await r.json();
    const entries=data.results||[];
    if(!entries.length){res.innerHTML=`<div style="color:var(--text-sub);font-size:0.78rem;padding:0.5rem">No managers found for "${q}"</div>`;return;}
    res.innerHTML=entries.map(e=>`
      <div class="search-result-item">
        <div>
          <div style="font-weight:700;font-size:0.82rem">${e.player_name}</div>
          <div style="font-family:var(--font-data);font-size:0.62rem;color:var(--text-sub)">${e.entry_name}·ID ${e.entry}·Rank ${e.entry_rank?.toLocaleString()||'—'}</div>
        </div>
        <button class="btn btn-green btn-sm sr-select" data-eid="${e.entry}">Select</button>
      </div>`).join('');
  } catch {
    res.innerHTML='<div style="color:var(--text-sub);font-size:0.78rem;padding:0.5rem">Search unavailable. Enter Team ID directly.</div>';
  }
}

function updateAccountUI() {
  const btn=el('accountBtn'),lbl=el('accountBtnLabel');if(!btn)return;
  if(S.fplPlayer){btn.classList.add('logged-in');if(lbl)lbl.textContent=S.fplPlayer.first_name||'ACCOUNT';}
  else{btn.classList.remove('logged-in');if(lbl)lbl.textContent='LOGIN';}
}

function logout() {
  S.fplEntryId=null;S.fplPlayer=null;S.myLeagues={classic:[],h2h:[]};
  ['fpl_entry_id','fpl_player','fpl_leagues'].forEach(k=>localStorage.removeItem(k));
  updateAccountUI();renderDashboard();renderLeaguesTab();
}

async function importFplTeam() {
  if(!S.fplEntryId)return;
  const gw=S.currentGW||S.nextGW;if(!gw)return;
  try {
    const res=await fplFetch(`/entry/${S.fplEntryId}/event/${gw}/picks/`);
    if(!res.ok)return;
    const data=await res.json();
    const picks=data.picks||[];if(!picks.length)return;
    const newTeam=picks.map(pk=>pk.element).filter(id=>S.players.find(p=>p.id===id));
    if(!newTeam.length)return;
    S.myTeam=newTeam;
    S.pickOrder={};
    picks.forEach(pk=>{S.pickOrder[pk.element]=pk.position;});
    const capPick=picks.find(pk=>pk.is_captain),vcPick=picks.find(pk=>pk.is_vice_captain);
    if(capPick)S.captainId=capPick.element;
    if(vcPick) S.vcaptainId=vcPick.element;
    saveTeam();renderAll();
  } catch(err){console.warn('Import:',err.message);}
}

/* ══════════════════════════════════════════════════════════════
   LEAGUES
══════════════════════════════════════════════════════════════ */
function renderLeaguesTab() {
  const prompt=el('leaguesLoginPrompt'),content=el('leaguesContent');
  if(!S.fplEntryId){if(prompt)prompt.style.display='block';if(content)content.style.display='none';return;}
  if(prompt)prompt.style.display='none';if(content)content.style.display='block';
  renderEntryCard();loadLeaguesList();
}

function renderEntryCard() {
  const e=el('fplEntryCard');if(!e||!S.fplPlayer)return;
  const p=S.fplPlayer;
  e.innerHTML=`<div class="entry-card-name">${p.first_name} ${p.last_name}</div>
    <div style="font-family:var(--font-data);font-size:0.62rem;color:var(--text-sub)">${p.teamName||''}·Entry #${S.fplEntryId}</div>
    <div class="entry-card-grid">
      <div class="entry-stat"><div class="entry-stat-val">${p.summary_overall_points||'—'}</div><div class="entry-stat-lbl">Total Pts</div></div>
      <div class="entry-stat"><div class="entry-stat-val">${p.summary_overall_rank?.toLocaleString()||'—'}</div><div class="entry-stat-lbl">Overall Rank</div></div>
      <div class="entry-stat"><div class="entry-stat-val">${p.summary_event_points||'—'}</div><div class="entry-stat-lbl">GW Pts</div></div>
    </div>`;
}

async function loadLeaguesList() {
  if(S.myLeagues?.classic?.length||S.myLeagues?.h2h?.length){renderLeagueLists(S.myLeagues);return;}
  setHTML('classicLeaguesList','<div style="color:var(--text-sub);padding:0.5rem;font-size:0.78rem">Loading...</div>');
  try {
    const res=await fplFetch(`/entry/${S.fplEntryId}/`);
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    S.myLeagues=data.leagues||{classic:[],h2h:[]};
    localStorage.setItem('fpl_leagues',JSON.stringify(S.myLeagues));
    renderLeagueLists(S.myLeagues);
  } catch(err){setHTML('classicLeaguesList',`<div style="color:var(--red);font-size:0.78rem;padding:0.5rem">Failed: ${err.message}</div>`);}
}

function renderLeagueLists(leagues) {
  const render=(list,id)=>{
    const e=el(id);if(!e)return;
    if(!list?.length){e.innerHTML='<div style="color:var(--text-sub);font-size:0.78rem;padding:0.5rem 0">No leagues.</div>';return;}
    e.innerHTML=list.map(l=>`
      <div class="league-item" data-lid="${l.id}" data-name="${l.name||l.league_name||'League'}">
        <div><div class="league-name">${l.name||l.league_name||'—'}</div>
          <div class="league-meta">ID: ${l.id}·Rank: ${l.entry_rank?.toLocaleString()||'—'}</div></div>
        <span style="color:var(--text-sub)">›</span>
      </div>`).join('');
  };
  render(leagues.classic||[],'classicLeaguesList');
  render(leagues.h2h    ||[],'h2hLeaguesList');
}

async function loadStandings(lid,type,name,page=1) {
  S.currentLeagueId=lid;S.currentLeagueType=type;
  const panel=el('standingsPanel'),title=el('standingsTitle'),table=el('standingsTable');
  if(!panel)return;
  panel.style.display='block';
  if(title&&name)title.textContent=name.toUpperCase();
  if(table)table.innerHTML='<div style="padding:1rem;color:var(--text-sub)">Loading...</div>';
  try {
    const ep=type==='h2h'?`/leagues-h2h/${lid}/standings/?page_standings=${page}`:`/leagues-classic/${lid}/standings/?page_standings=${page}`;
    const res=await fplFetch(ep);if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();const rows=data.standings?.results||[];
    if(!rows.length){if(table)table.innerHTML='<div style="padding:1rem;color:var(--text-sub)">No data.</div>';return;}
    if(table)table.innerHTML=`
      <div class="standings-row header"><div>#</div><div>Manager</div><div>GW</div><div>Total</div><div>±</div></div>
      ${rows.map(r=>{
        const isMine=r.entry===S.fplEntryId,top3=r.rank<=3;
        const mv=(r.last_rank||r.rank)-r.rank;
        const mCls=mv>0?'move-up':mv<0?'move-down':'move-same';
        const mStr=mv>0?`▲${mv}`:mv<0?`▼${Math.abs(mv)}`:'–';
        return `<div class="standings-row ${isMine?'my-entry':''}">
          <div class="s-rank ${top3?'top3':''}">${r.rank}</div>
          <div><div style="font-weight:700;font-size:0.82rem">${r.player_name}</div>
            <div style="font-size:0.68rem;color:var(--text-sub)">${r.entry_name}</div></div>
          <div style="text-align:right;font-family:var(--font-data);font-size:0.78rem">${r.event_total}</div>
          <div class="s-pts">${r.total}</div>
          <div class="s-move ${mCls}">${mStr}</div>
        </div>`;
      }).join('')}`;
    const pag=el('standingsPagination');
    if(pag){let ph='';
      if(page>1)ph+=`<button class="page-btn" data-page="${page-1}">‹ Prev</button>`;
      ph+=`<span style="font-family:var(--font-data);font-size:0.62rem;color:var(--text-sub)">Page ${page}</span>`;
      if(data.standings?.has_next)ph+=`<button class="page-btn" data-page="${page+1}">Next ›</button>`;
      pag.innerHTML=ph;}
  } catch(err){if(table)table.innerHTML=`<div style="padding:1rem;color:var(--red)">Failed: ${err.message}</div>`;}
}

function hideStandings(){const p=el('standingsPanel');if(p)p.style.display='none';}

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
const el   = id => document.getElementById(id);
function myPlayers() { return S.players.filter(p => S.myTeam.includes(p.id)); }
function setText(id,v){const e=el(id);if(e)e.textContent=v;}
function setHTML(id,v){const e=el(id);if(e)e.innerHTML=v;}
function pad(n){return String(n).padStart(2,'0');}
function emptyState(icon,h,p){return `<div class="empty-state"><div class="icon">${icon}</div><h3>${h}</h3><p>${p}</p></div>`;}

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', init);
