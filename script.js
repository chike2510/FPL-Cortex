/**
 * script.js — FPL COMMAND
 *
 * KEY FIXES vs previous version:
 *  - All dynamic button clicks use EVENT DELEGATION (no more inline onclick
 *    in innerHTML — those are blocked by Android WebView CSP).
 *  - FPL Account login, team auto-import, and live leagues added.
 *
 * Data strategy:
 *  - Public FPL endpoints (players, fixtures, live) are ALWAYS fetched
 *    directly from the browser via corsproxy.io — this avoids Vercel's
 *    server IPs being blocked by FPL's API.
 *  - Auth-dependent calls (login, myteam, leagues) use /api/ serverless
 *    functions which handle cookies securely on the backend.
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   ENVIRONMENT
   ──────────────────────────────────────────────────────────── */

// True when running on a deployed HTTPS domain (Vercel etc.)
// Used only to decide whether /api/ auth routes are available.
const IS_VERCEL = (
  window.location.protocol === 'https:' &&
  !['localhost', '127.0.0.1'].includes(window.location.hostname)
);

const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const FPL = 'https://fantasy.premierleague.com/api';

// Try each proxy in order until one works
async function fplFetch(fplPath) {
  const target = `${FPL}${fplPath}`;
  let lastErr;
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(target), { signal: AbortSignal.timeout(12000) });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All proxies failed');
}

// Keep fplURL for any remaining direct calls
function fplURL(fplPath) {
  return PROXIES[0](`${FPL}${fplPath}`);
}

/* ─────────────────────────────────────────────────────────────
   STATE
   ──────────────────────────────────────────────────────────── */
const S = {
  bootstrap:    null,
  allFixtures:  [],
  liveData:     null,
  players:      [],
  teams:        {},
  positions:    {},
  currentGW:    null,
  nextGW:       null,

  // Squad
  myTeam:    [],   // player IDs
  captainId:  null,
  vcaptainId: null,

  // Player table pagination
  page:             1,
  pageSize:         20,
  filteredPlayers:  [],

  // FPL account
  fplCookie:  null,
  fplEntryId: null,
  fplPlayer:  null,   // { first_name, last_name, ... }

  // Leagues
  myLeagues:       { classic: [], h2h: [] },
  currentLeagueId: null,
  currentLeagueType: 'classic',
  standingsPage:   1,
};

/* ─────────────────────────────────────────────────────────────
   INIT
   ──────────────────────────────────────────────────────────── */
async function init() {
  loadFromStorage();
  attachAllListeners();  // ← replaces all inline onclicks

  setLoadingProgress(10, 'FETCHING PLAYER DATA...');
  const ok = await fetchBootstrap();
  if (!ok) return;

  setLoadingProgress(55, 'FETCHING FIXTURES...');
  await fetchFixtures();

  setLoadingProgress(85, 'BUILDING DASHBOARD...');
  renderAll();

  setLoadingProgress(100, 'READY');
  document.getElementById('liveDot').classList.add('active');
  document.getElementById('liveDot').textContent = 'LIVE';

  setTimeout(() => {
    const ls = document.getElementById('loadingScreen');
    if (!ls) return;
    ls.style.opacity = '0'; ls.style.transition = 'opacity 0.4s ease';
    setTimeout(() => ls.remove(), 400);
  }, 300);

  fetchLive();

  // Restore FPL session if saved
  if (S.fplCookie && S.fplEntryId) updateAccountUI();
}

/* ─────────────────────────────────────────────────────────────
   STORAGE
   ──────────────────────────────────────────────────────────── */
function loadFromStorage() {
  try {
    const t = localStorage.getItem('fpl_myteam');
    const c = localStorage.getItem('fpl_captain');
    const v = localStorage.getItem('fpl_vcaptain');
    const ck = localStorage.getItem('fpl_cookie');
    const eid = localStorage.getItem('fpl_entry_id');
    const pl = localStorage.getItem('fpl_player');
    if (t)  S.myTeam    = JSON.parse(t);
    if (c)  S.captainId  = parseInt(c);
    if (v)  S.vcaptainId = parseInt(v);
    if (ck)  S.fplCookie  = ck;
    if (eid) S.fplEntryId = parseInt(eid);
    if (pl)  S.fplPlayer  = JSON.parse(pl);
  } catch {}
}

function saveTeam() {
  localStorage.setItem('fpl_myteam',  JSON.stringify(S.myTeam));
  if (S.captainId)  localStorage.setItem('fpl_captain',  S.captainId);
  else              localStorage.removeItem('fpl_captain');
  if (S.vcaptainId) localStorage.setItem('fpl_vcaptain', S.vcaptainId);
  else              localStorage.removeItem('fpl_vcaptain');
}

/* ─────────────────────────────────────────────────────────────
   EVENT DELEGATION  (replaces ALL inline onclick in innerHTML)
   This is the key fix for Android WebView / Acode.
   ──────────────────────────────────────────────────────────── */
function attachAllListeners() {
  /* ── Nav buttons ── */
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* ── Header account button ── */
  document.getElementById('accountBtn')
    ?.addEventListener('click', handleAccountBtn);

  /* ── Login modal ── */
  document.getElementById('loginModalClose')
    ?.addEventListener('click', closeLoginModal);
  document.getElementById('loginSkipBtn')
    ?.addEventListener('click', closeLoginModal);
  document.getElementById('loginSubmitBtn')
    ?.addEventListener('click', submitTeamId);
  document.getElementById('loginTeamId')
    ?.addEventListener('keydown', e => { if (e.key === 'Enter') submitTeamId(); });

  /* ── Dashboard buttons ── */
  document.getElementById('captainBtn')
    ?.addEventListener('click', autoPickCaptain);

  /* ── Players tab ── */
  document.getElementById('refreshBtn')
    ?.addEventListener('click', refreshData);
  document.getElementById('playerSearch')
    ?.addEventListener('input', filterPlayers);
  document.getElementById('posFilter')
    ?.addEventListener('change', filterPlayers);
  document.getElementById('teamFilter')
    ?.addEventListener('change', filterPlayers);
  document.getElementById('sortSelect')
    ?.addEventListener('change', filterPlayers);

  /* ── Player table body — delegation for Add buttons ── */
  document.getElementById('playerTableBody')
    ?.addEventListener('click', e => {
      const btn = e.target.closest('.add-btn');
      if (!btn) return;
      const id = parseInt(btn.dataset.pid);
      if (!isNaN(id)) togglePlayer(id);
    });

  /* ── My Team tab ── */
  document.getElementById('clearTeamBtn')
    ?.addEventListener('click', clearTeam);
  document.getElementById('addPlayersBtn')
    ?.addEventListener('click', () => switchTab('players'));
  document.getElementById('importFplTeamBtn')
    ?.addEventListener('click', importFplTeam);

  /* ── Pitch cards — delegation for remove ── */
  document.getElementById('teamPitchArea')
    ?.addEventListener('click', e => {
      const card = e.target.closest('.player-card-sm');
      if (!card) return;
      const id = parseInt(card.dataset.pid);
      if (!isNaN(id)) removeFromTeam(id);
    });

  /* ── Team list — delegation for remove buttons ── */
  document.getElementById('teamListArea')
    ?.addEventListener('click', e => {
      const btn = e.target.closest('.remove-btn');
      if (btn) { const id = parseInt(btn.dataset.pid); if (!isNaN(id)) removeFromTeam(id); return; }
      // captain card click in list
      const capBtn = e.target.closest('[data-set-captain]');
      if (capBtn) { const id = parseInt(capBtn.dataset.pid); setCaptain(id, 0); return; }
      const vcBtn = e.target.closest('[data-set-vc]');
      if (vcBtn) { const id = parseInt(vcBtn.dataset.pid); setCaptain(id, 1); }
    });

  /* ── Captain cards delegation ── */
  document.getElementById('captainArea')
    ?.addEventListener('click', e => {
      const card = e.target.closest('.captain-card');
      if (!card) return;
      const pid  = parseInt(card.dataset.pid);
      const rank = parseInt(card.dataset.rank);
      if (!isNaN(pid)) setCaptain(pid, rank);
    });

  /* ── Live GW refresh ── */
  document.getElementById('liveRefreshBtn')
    ?.addEventListener('click', fetchLive);

  /* ── Fixture GW select ── */
  document.getElementById('fixtureGwSelect')
    ?.addEventListener('change', renderFixtures);

  /* ── Leagues ── */
  document.getElementById('leaguesLoginBtn')
    ?.addEventListener('click', openLoginModal);
  document.getElementById('standingsBackBtn')
    ?.addEventListener('click', hideStandingsPanel);

  document.getElementById('classicLeaguesList')
    ?.addEventListener('click', e => {
      const item = e.target.closest('.league-item');
      if (item) loadStandings(parseInt(item.dataset.lid), 'classic', item.dataset.name);
    });
  document.getElementById('h2hLeaguesList')
    ?.addEventListener('click', e => {
      const item = e.target.closest('.league-item');
      if (item) loadStandings(parseInt(item.dataset.lid), 'h2h', item.dataset.name);
    });
  document.getElementById('standingsPagination')
    ?.addEventListener('click', e => {
      const btn = e.target.closest('.page-btn');
      if (btn) loadStandings(S.currentLeagueId, S.currentLeagueType, null, parseInt(btn.dataset.page));
    });

  /* ── Dashboard account bar buttons ── */
  document.getElementById('fplAccountBar')
    ?.addEventListener('click', e => {
      if (e.target.closest('[data-action="import"]')) importFplTeam();
      if (e.target.closest('[data-action="logout"]')) logout();
    });
}

/* ─────────────────────────────────────────────────────────────
   LOADING HELPERS
   ──────────────────────────────────────────────────────────── */
function setLoadingProgress(pct, msg) {
  const bar = document.getElementById('loadingBar');
  const txt = document.getElementById('loadingMsg');
  if (bar) bar.style.width = pct + '%';
  if (txt) txt.textContent = msg;
}

function showLoadingError(msg) {
  const ls = document.getElementById('loadingScreen');
  if (!ls) return;
  ls.innerHTML = `
    <div class="loading-logo">FPL <span>COMMAND</span></div>
    <div style="color:var(--red);font-family:var(--font-data);font-size:0.8rem;
      margin-top:1rem;text-align:center;max-width:300px;line-height:1.8;">${msg}</div>
    <button class="btn btn-green btn-sm" style="margin-top:1.5rem;" id="retryBtn">↻ RETRY</button>`;
  document.getElementById('retryBtn')?.addEventListener('click', () => location.reload());
}

/* ─────────────────────────────────────────────────────────────
   RENDER ALL
   ──────────────────────────────────────────────────────────── */
function renderAll() {
  renderDashboard();
  renderPlayerTable();
  renderMyTeam();
  renderTransfers();
  renderFixtureGwSelect();
  renderFixtures();
}

/* ─────────────────────────────────────────────────────────────
   DATA FETCHING
   ──────────────────────────────────────────────────────────── */
async function fetchBootstrap() {
  try {
    const res = await fplFetch('/bootstrap-static/');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    S.bootstrap = data;

    data.teams.forEach(t  => { S.teams[t.id]     = t; });
    data.element_types.forEach(et => {
      S.positions[et.id] = { short: et.singular_name_short, full: et.singular_name };
    });

    S.players = data.elements.map(processPlayer);

    const cur  = data.events.find(e => e.is_current);
    const nxt  = data.events.find(e => e.is_next);
    S.currentGW = cur ? cur.id : (nxt ? nxt.id - 1 : null);
    S.nextGW    = nxt ? nxt.id : null;

    setText('gwBadge', S.currentGW ? `GW ${S.currentGW}` : 'GW —');

    if (cur) {
      setText('liveGwAvg',     cur.average_entry_score || '—');
      setText('liveGwHighest', cur.highest_score       || '—');
      setText('dashGwAvg',     cur.average_entry_score || '—');
    }
    return true;
  } catch (err) {
    console.error('Bootstrap failed:', err);
    setLoadingProgress(100, 'ERROR');
    setTimeout(() => showLoadingError(
      `Could not connect to FPL API.<br>Check your internet and retry.<br>
       <small style="color:var(--text-sub)">${err.message}</small>`), 300);
    return false;
  }
}

async function fetchFixtures() {
  try {
    const res = await fplFetch('/fixtures/');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    S.allFixtures = await res.json();
  } catch (err) {
    console.error('Fixtures failed:', err);
    S.allFixtures = [];
  }
}

async function fetchLive() {
  const btn = document.getElementById('liveRefreshBtn');
  if (btn) btn.classList.add('spinning');

  const gw = S.currentGW || S.nextGW;
  if (!gw) { if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ REFRESH'; } return; }

  try {
    // Always fetch live data directly via corsproxy — same as other public endpoints
    const res = await fplFetch(`/event/${gw}/live/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();

    // FPL returns { elements: [ { id, stats, explain } ] }
    const map = {};
    for (const el of (raw.elements || [])) map[el.id] = el;
    S.liveData = map;

    renderLivePanel();
    renderDashboard();
    const badge = document.getElementById('liveUpdateBadge');
    if (badge) {
      const now = new Date();
      badge.textContent = `UPDATED ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
  } catch (err) {
    console.error('Live failed:', err);
    setHTML('livePlayerList', `<div class="empty-state"><div class="icon">◎</div><h3>NO LIVE DATA</h3><p>GW may not be active yet.</p></div>`);
  }
  if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ REFRESH'; }
}

async function refreshData() {
  const btn = document.getElementById('refreshBtn');
  if (btn) btn.classList.add('spinning');
  await fetchBootstrap();
  await fetchFixtures();
  renderPlayerTable();
  renderDashboard();
  if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ REFRESH'; }
}

/* ─────────────────────────────────────────────────────────────
   PLAYER PROCESSING
   ──────────────────────────────────────────────────────────── */
function processPlayer(p) {
  const team = S.teams[p.team]          || {};
  const pos  = S.positions[p.element_type] || {};
  const upcomingFixtures = getUpcomingFixtures(p.team, 3);
  const avgFDR = upcomingFixtures.length
    ? upcomingFixtures.reduce((s,f) => s+f.difficulty, 0) / upcomingFixtures.length
    : 3;

  const form   = parseFloat(p.form) || 0;
  const fdrMul = fdrMult(avgFDR);
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
    teamName:  team.name       || '—',
    teamShort: team.short_name || '—',
    posShort:  pos.short       || '—',
    price:     p.now_cost / 10,
    formVal:   form,
    projectedPts: Math.round(proj * 10) / 10,
    avgFDR,
    upcomingFixtures,
  };
}

function fdrMult(fdr) {
  if (fdr <= 1.5) return 1.5;
  if (fdr <= 2.5) return 1.25;
  if (fdr <= 3.5) return 1.0;
  if (fdr <= 4.5) return 0.75;
  return 0.55;
}

function getUpcomingFixtures(teamId, count = 3) {
  const gw = S.currentGW || S.nextGW || 1;
  const res = [];
  for (const f of S.allFixtures) {
    if (res.length >= count) break;
    if (f.event && f.event >= gw && !f.finished) {
      if (f.team_h === teamId) res.push({ opponent: S.teams[f.team_a]?.short_name||'?', home:true,  difficulty:f.team_h_difficulty, gw:f.event });
      else if (f.team_a===teamId) res.push({ opponent: S.teams[f.team_h]?.short_name||'?', home:false, difficulty:f.team_a_difficulty, gw:f.event });
    }
  }
  return res;
}

/* ─────────────────────────────────────────────────────────────
   TAB NAVIGATION
   ──────────────────────────────────────────────────────────── */
function switchTab(tabName) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabName}`));
  if (tabName === 'myteam')    renderMyTeam();
  if (tabName === 'transfers') renderTransfers();
  if (tabName === 'fixtures')  renderFixtures();
  if (tabName === 'live')      renderLivePanel();
  if (tabName === 'dashboard') renderDashboard();
  if (tabName === 'leagues')   renderLeaguesTab();
}

/* ─────────────────────────────────────────────────────────────
   DASHBOARD
   ──────────────────────────────────────────────────────────── */
function renderDashboard() {
  const mp  = S.players.filter(p => S.myTeam.includes(p.id));
  const cap = mp.find(p => p.id === S.captainId);
  let proj  = mp.reduce((s,p) => s + p.projectedPts, 0);
  if (cap) proj += cap.projectedPts;

  setText('dashProjected',   Math.round(proj*10)/10);
  setText('dashCaptainPts',  cap ? Math.round(cap.projectedPts*2*10)/10 : '—');
  setText('dashCaptainName', cap ? cap.web_name : 'No Captain Set');
  setText('dashValue',       `£${mp.reduce((s,p)=>s+p.price,0).toFixed(1)}m`);
  setText('dashPlayerCount', `${mp.length} players selected`);

  renderCaptainSuggestions(mp);
  renderRiskAnalysis(mp);
  updateAccountBar();
}

function updateAccountBar() {
  const bar = document.getElementById('fplAccountBar');
  if (!bar) return;
  if (S.fplPlayer) {
    bar.style.display = 'flex';
    setText('fplManagerName', `${S.fplPlayer.first_name} ${S.fplPlayer.last_name}`);
    setText('fplTeamMeta',    `Entry #${S.fplEntryId} · Season total: ${S.fplPlayer.summary_overall_points || '—'} pts · Rank: ${S.fplPlayer.summary_overall_rank?.toLocaleString() || '—'}`);
  } else {
    bar.style.display = 'none';
  }
}

/* ─────────────────────────────────────────────────────────────
   CAPTAIN AI
   ──────────────────────────────────────────────────────────── */
function captainScore(p) {
  const ict = parseFloat(p.ict_index) || 0;
  return (p.formVal * 3 + ict/20 + p.projectedPts) * fdrMult(p.avgFDR);
}

function renderCaptainSuggestions(mp) {
  const area = document.getElementById('captainArea');
  if (!area) return;
  if (!mp.length) { setHTML('captainArea', emptyState('🎖','NO SQUAD SELECTED','Add players in My Team, then use Auto Pick.')); return; }

  const ranked = [...mp].sort((a,b) => captainScore(b)-captainScore(a)).slice(0,3);
  setHTML('captainArea', `
    <div class="captain-cards">
      ${ranked.map((p,i) => {
        const fix = p.upcomingFixtures[0];
        const fixStr = fix ? `${fix.home?'':'@'}${fix.opponent} (FDR ${fix.difficulty})` : 'No fixture';
        return `
          <div class="captain-card ${i===0?'rank-1':''}" data-pid="${p.id}" data-rank="${i}">
            <div class="cc-name">${p.web_name}</div>
            <div class="cc-team">${p.teamShort} · ${p.posShort}</div>
            <div class="cc-ep">${Math.round(p.projectedPts*(i===0?2:1)*10)/10}</div>
            <div class="cc-score">xPts · Next: ${fixStr}</div>
            <div style="margin-top:0.5rem;font-family:var(--font-data);font-size:0.6rem;color:var(--text-sub);">
              Form ${p.form} · £${p.price}m · ${p.selected_by_percent}% owned
            </div>
            ${i===0&&p.id===S.captainId  ? '<div style="margin-top:4px;" class="card-badge badge-amber">★ CAPTAIN SET</div>' : ''}
            ${i===1&&p.id===S.vcaptainId ? '<div style="margin-top:4px;" class="card-badge badge-blue">V/C SET</div>'        : ''}
          </div>`;
      }).join('')}
    </div>`);
}

function setCaptain(playerId, rank) {
  if (rank === 
