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
  if (rank === 0) { S.captainId  = playerId; localStorage.setItem('fpl_captain',  playerId); }
  if (rank === 1) { S.vcaptainId = playerId; localStorage.setItem('fpl_vcaptain', playerId); }
  const mp = S.players.filter(p => S.myTeam.includes(p.id));
  renderCaptainSuggestions(mp);
  renderMyTeam();
  renderDashboard();
}

function autoPickCaptain() {
  const mp = S.players.filter(p => S.myTeam.includes(p.id));
  if (!mp.length) return;
  const r = [...mp].sort((a,b) => captainScore(b)-captainScore(a));
  S.captainId  = r[0]?.id || null;
  S.vcaptainId = r[1]?.id || null;
  saveTeam();
  renderCaptainSuggestions(mp);
  renderMyTeam();
  renderDashboard();
}

/* ─────────────────────────────────────────────────────────────
   RISK
   ──────────────────────────────────────────────────────────── */
function getRisk(p) {
  const risks = [];
  const avgMins = p.minutes / Math.max(1, S.currentGW||1);
  if (p.chance_of_playing_next_round !== null && p.chance_of_playing_next_round < 75)
    risks.push({ level:'high',   reason:`${p.chance_of_playing_next_round}% chance — ${p.news||'fitness doubt'}` });
  else if (p.chance_of_playing_next_round !== null && p.chance_of_playing_next_round < 100)
    risks.push({ level:'medium', reason:`Slight doubt — ${p.news||'monitor fitness'}` });
  if (p.formVal === 0 && p.total_points > 0)
    risks.push({ level:'high',   reason:'Zero form — not scoring recently' });
  else if (p.formVal < 2 && p.total_points > 0)
    risks.push({ level:'medium', reason:`Poor form: ${p.form} pts/game last 5 GWs` });
  if (p.avgFDR >= 4.5)
    risks.push({ level:'high',   reason:`Brutal fixtures — avg FDR ${p.avgFDR.toFixed(1)}` });
  else if (p.avgFDR >= 3.8)
    risks.push({ level:'medium', reason:`Tough fixtures — avg FDR ${p.avgFDR.toFixed(1)}` });
  if (avgMins < 45)
    risks.push({ level:'medium', reason:`Rotation risk — avg ${Math.round(avgMins)} mins/GW` });
  return risks;
}

function renderRiskAnalysis(mp) {
  if (!mp.length) { setHTML('riskArea', `<div class="card">${emptyState('🛡','NO SQUAD DATA','Build your team to see risk flags.')}</div>`); return; }
  const flagged = mp.map(p=>({p,r:getRisk(p)})).filter(x=>x.r.length)
    .sort((a,b) => (b.r[0].level==='high'?2:1)-(a.r[0].level==='high'?2:1));
  if (!flagged.length) { setHTML('riskArea', `<div class="card">${emptyState('✅','ALL CLEAR','No risk flags. Clean picks.')}</div>`); return; }
  setHTML('riskArea', `<div class="card">${flagged.map(({p,r}) => `
    <div class="risk-item">
      <div class="risk-indicator risk-${r[0].level}"></div>
      <div>
        <div class="risk-player">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div>
        ${r.map(x=>`<div class="risk-reason">⚠ ${x.reason}</div>`).join('')}
      </div>
      <div style="margin-left:auto;text-align:right;">
        <div class="stat-label" style="font-size:0.58rem;">FORM</div>
        <div style="font-family:var(--font-data);font-size:0.9rem;color:${r[0].level==='high'?'var(--red)':'var(--amber)'};">${p.form}</div>
      </div>
    </div>`).join('')}</div>`);
}

/* ─────────────────────────────────────────────────────────────
   PLAYER TABLE  — uses data-pid attributes, no inline onclick
   ──────────────────────────────────────────────────────────── */
function filterPlayers() { S.page = 1; renderPlayerTable(); }

function renderPlayerTable() {
  if (!S.players.length) return;

  const search  = (document.getElementById('playerSearch')?.value||'').toLowerCase();
  const posF    =  document.getElementById('posFilter')?.value   ||'';
  const teamF   =  document.getElementById('teamFilter')?.value  ||'';
  const sortKey =  document.getElementById('sortSelect')?.value  ||'total_points';

  // Populate team filter once
  const tf = document.getElementById('teamFilter');
  if (tf && tf.options.length === 1) {
    Object.values(S.teams).sort((a,b)=>a.name.localeCompare(b.name)).forEach(t => {
      const o = document.createElement('option');
      o.value = t.name; o.textContent = t.name; tf.appendChild(o);
    });
  }

  let list = S.players.filter(p => {
    const name = `${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase();
    return (!search || name.includes(search) || p.teamName.toLowerCase().includes(search))
        && (!posF  || p.posShort === posF)
        && (!teamF || p.teamName === teamF);
  }).sort((a,b) => (parseFloat(b[sortKey])||0)-(parseFloat(a[sortKey])||0));

  S.filteredPlayers = list;
  const total = list.length;
  const pages = Math.ceil(total / S.pageSize);
  const slice = list.slice((S.page-1)*S.pageSize, S.page*S.pageSize);

  const tbody = document.getElementById('playerTableBody');
  if (!tbody) return;

  tbody.innerHTML = !slice.length
    ? `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-sub);">No players match filters.</td></tr>`
    : slice.map(p => {
        const inTeam   = S.myTeam.includes(p.id);
        const formCls  = p.formVal>=6?'form-hi':p.formVal>=3?'form-mid':'form-lo';
        const risks    = getRisk(p);
        const riskFlag = risks.length ? `<span class="risk-flag" title="${risks[0].reason}">${risks[0].level==='high'?'🔴':'🟡'}</span>` : '';
        const avail    = (p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<100)
          ? `<div class="news-banner">⚠ ${p.news||p.chance_of_playing_next_round+'% chance'}</div>` : '';
        const disabled = !inTeam && S.myTeam.length >= 15 ? 'disabled' : '';
        return `
          <tr>
            <td>
              <div class="player-name">${p.web_name}${riskFlag}</div>
              <div class="player-team-pos">${p.teamShort}</div>${avail}
            </td>
            <td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td>
            <td style="color:var(--text-sub);font-size:0.78rem;">${p.teamShort}</td>
            <td><span class="price-val">£${p.price.toFixed(1)}m</span></td>
            <td><span class="form-val ${formCls}">${p.form}</span></td>
            <td><span class="pts-val">${p.total_points}</span></td>
            <td><span class="ep-val">${p.ep_next||'—'}</span></td>
            <td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td>
            <td>
              <button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${disabled}>
                ${inTeam?'✓ Added':'+ Add'}
              </button>
            </td>
          </tr>`;
      }).join('');

  // Pagination
  const pag = document.getElementById('playerPagination');
  if (!pag) return;
  if (pages <= 1) { pag.innerHTML=''; return; }
  let ph = '';
  if (S.page>1) ph += `<button class="page-btn" data-p="${S.page-1}">‹ Prev</button>`;
  for (let i=Math.max(1,S.page-2);i<=Math.min(pages,S.page+2);i++)
    ph += `<button class="page-btn ${i===S.page?'active':''}" data-p="${i}">${i}</button>`;
  if (S.page<pages) ph += `<button class="page-btn" data-p="${S.page+1}">Next ›</button>`;
  ph += `<span style="font-family:var(--font-data);font-size:0.65rem;color:var(--text-sub);margin-left:0.5rem;">${total} players</span>`;
  pag.innerHTML = ph;
  pag.querySelectorAll('.page-btn').forEach(b => {
    b.addEventListener('click', () => { S.page=parseInt(b.dataset.p); renderPlayerTable(); document.getElementById('playerTable')?.scrollIntoView({behavior:'smooth',block:'start'}); });
  });
}

/* ─────────────────────────────────────────────────────────────
   MY TEAM
   ──────────────────────────────────────────────────────────── */
function togglePlayer(playerId) {
  const idx = S.myTeam.indexOf(playerId);
  if (idx === -1) {
    if (S.myTeam.length >= 15) return;
    S.myTeam.push(playerId);
  } else {
    S.myTeam.splice(idx, 1);
    if (S.captainId  === playerId) S.captainId  = null;
    if (S.vcaptainId === playerId) S.vcaptainId = null;
  }
  saveTeam();
  renderPlayerTable();
  renderMyTeam();
  renderDashboard();
}

function removeFromTeam(playerId) {
  const idx = S.myTeam.indexOf(playerId);
  if (idx !== -1) {
    S.myTeam.splice(idx, 1);
    if (S.captainId  === playerId) S.captainId  = null;
    if (S.vcaptainId === playerId) S.vcaptainId = null;
    saveTeam();
    renderMyTeam(); renderPlayerTable(); renderDashboard();
  }
}

function clearTeam() {
  if (!confirm('Clear your entire squad?')) return;
  S.myTeam=[]; S.captainId=null; S.vcaptainId=null;
  ['fpl_myteam','fpl_captain','fpl_vcaptain'].forEach(k=>localStorage.removeItem(k));
  renderMyTeam(); renderDashboard(); renderPlayerTable();
}

function renderMyTeam() {
  const mp = S.players.filter(p => S.myTeam.includes(p.id));
  setText('squadCount',   mp.length);
  setText('squadValue',   `£${mp.reduce((s,p)=>s+p.price,0).toFixed(1)}m`);
  let proj = mp.reduce((s,p)=>s+p.projectedPts,0);
  const cap = mp.find(p=>p.id===S.captainId);
  if (cap) proj += cap.projectedPts;
  setText('squadProjPts', Math.round(proj*10)/10);

  // Show/hide import button
  const impBtn = document.getElementById('importFplTeamBtn');
  if (impBtn) impBtn.style.display = S.fplEntryId ? 'inline-flex' : 'none';

  // Group
  const byPos = {GKP:[],DEF:[],MID:[],FWD:[]};
  mp.forEach(p => { if (byPos[p.posShort]) byPos[p.posShort].push(p); });
  const starters = {
    GKP: byPos.GKP.slice(0,1),
    DEF: byPos.DEF.slice(0,Math.min(5,byPos.DEF.length)),
    MID: byPos.MID.slice(0,Math.min(5,byPos.MID.length)),
    FWD: byPos.FWD.slice(0,Math.min(3,byPos.FWD.length)),
  };
  const starterIds = Object.values(starters).flat().map(p=>p.id);
  const bench = mp.filter(p=>!starterIds.includes(p.id));

  const icons = {GKP:'🧤',DEF:'🛡',MID:'⚽',FWD:'🎯'};
  const card = p => {
    const isC=p.id===S.captainId, isV=p.id===S.vcaptainId;
    const live=S.liveData?.[p.id]?.stats; const pts=live?live.total_points:null;
    return `<div class="player-card-sm ${isC?'captain':isV?'vice-captain':''}" data-pid="${p.id}">
      ${isC?'<div class="captain-badge">C</div>':''}${isV?'<div class="vc-badge">V</div>':''}
      <div class="pos-icon">${icons[p.posShort]||'⚽'}</div>
      <div class="p-name">${p.web_name}</div>
      <div class="p-pts">${pts!==null?pts+'pts':p.projectedPts+'xP'}</div>
      <div class="p-price">£${p.price.toFixed(1)}m</div>
    </div>`;
  };
  [{id:'pitchGKP',pl:starters.GKP},{id:'pitchDEF',pl:starters.DEF},
   {id:'pitchMID',pl:starters.MID},{id:'pitchFWD',pl:starters.FWD},
   {id:'pitchBench',pl:bench}].forEach(({id,pl}) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = pl.length ? pl.map(card).join('') : `<div class="empty-slot">EMPTY</div>`;
  });

  if (!mp.length) {
    setHTML('teamListArea', `<div class="card">${emptyState('👕','SQUAD IS EMPTY','Go to Players and add up to 15 players, or log in to import your FPL squad.')}</div>`);
    return;
  }
  setHTML('teamListArea', mp.map(p => {
    const isC=p.id===S.captainId, isV=p.id===S.vcaptainId;
    const risks=getRisk(p); const fix=p.upcomingFixtures[0];
    const fxStr=fix?`${fix.home?'':'@'}${fix.opponent} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'—';
    return `<div class="transfer-item">
      <div style="flex:1;min-width:110px;">
        <div style="font-weight:700;">${p.web_name}
          ${isC?'<span class="card-badge badge-amber" style="margin-left:4px;">C</span>':''}
          ${isV?'<span class="card-badge badge-blue"  style="margin-left:4px;">V</span>':''}
        </div>
        <div style="font-size:0.72rem;color:var(--text-sub);">${p.teamShort} · <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div>
        ${risks.length?`<div class="news-banner" style="margin-top:3px;">⚠ ${risks[0].reason}</div>`:''}
      </div>
      <div style="text-align:center;font-family:var(--font-data);font-size:0.72rem;">
        <div style="color:var(--text-sub);font-size:0.58rem;letter-spacing:1px;">NEXT</div>${fxStr}
      </div>
      <div style="text-align:right;min-width:60px;">
        <div class="stat-label" style="font-size:0.58rem;">xPTS</div>
        <div style="font-family:var(--font-data);color:var(--green);font-size:1rem;font-weight:700;">${p.projectedPts}</div>
        <div style="font-family:var(--font-data);font-size:0.65rem;color:var(--text-sub);">£${p.price.toFixed(1)}m</div>
      </div>
      <button class="remove-btn" data-pid="${p.id}">✕</button>
    </div>`;
  }).join(''));
}

/* ─────────────────────────────────────────────────────────────
   TRANSFERS
   ──────────────────────────────────────────────────────────── */
function renderTransfers() {
  renderTransferSuggestions();
  renderTransferTrends();
}

function renderTransferSuggestions() {
  const mp = S.players.filter(p => S.myTeam.includes(p.id));
  if (!mp.length) { setHTML('transferArea', `<div>${emptyState('⇄','NO SQUAD TO ANALYSE','Build your team first.')}</div>`); return; }

  const sugg = [];
  mp.forEach(cur => {
    const best = S.players
      .filter(p=>p.element_type===cur.element_type&&p.id!==cur.id&&!S.myTeam.includes(p.id)&&p.price<=cur.price+0.5&&p.projectedPts>cur.projectedPts)
      .sort((a,b)=>b.projectedPts-a.projectedPts)[0];
    if (best) sugg.push({out:cur,in:best,gain:Math.round((best.projectedPts-cur.projectedPts)*10)/10});
  });
  sugg.sort((a,b)=>b.gain-a.gain);
  const top=sugg.slice(0,8);

  if (!top.length) { setHTML('transferArea', `<div>${emptyState('✅','OPTIMAL SQUAD','No clear improvement found within budget.')}</div>`); return; }

  const fx=f=>f?`${f.home?'':'@'}${f.opponent} <span class="fdr fdr-${f.difficulty}">${f.difficulty}</span>`:'';
  setHTML('transferArea', `
    <div class="card-header" style="margin-bottom:0.75rem;">
      <span class="card-title">AI SUGGESTIONS</span><span class="card-badge badge-green">TOP ${top.length}</span>
    </div>
    ${top.map(s=>`<div class="transfer-item">
      <div class="transfer-out">
        <div class="transfer-label">OUT</div>
        <div class="transfer-player" style="color:var(--red);">${s.out.web_name}</div>
        <div class="transfer-stats">Form ${s.out.form} · £${s.out.price.toFixed(1)}m · xP ${s.out.projectedPts} ${fx(s.out.upcomingFixtures[0])}</div>
      </div>
      <div class="transfer-arrow">→</div>
      <div class="transfer-in">
        <div class="transfer-label">IN</div>
        <div class="transfer-player" style="color:var(--green);">${s.in.web_name}</div>
        <div class="transfer-stats">Form ${s.in.form} · £${s.in.price.toFixed(1)}m · xP ${s.in.projectedPts} ${fx(s.in.upcomingFixtures[0])}</div>
      </div>
      <div class="transfer-gain">+${s.gain} xPts</div>
    </div>`).join('')}`);
}

function renderTransferTrends() {
  const active = S.players.filter(p=>p.transfers_in_event>0||p.transfers_out_event>0);
  const topIn  = [...active].sort((a,b)=>b.transfers_in_event -a.transfers_in_event).slice(0,8);
  const topOut = [...active].sort((a,b)=>b.transfers_out_event-a.transfers_out_event).slice(0,8);
  const noData = `<div style="padding:1rem;color:var(--text-sub);text-align:center;font-size:0.8rem;">No transfer data yet.</div>`;
  const row=(p,key,color)=>{
    const val=p[key], maxV=(key==='transfers_in_event'?(topIn[0]?.[key]||1):(topOut[0]?.[key]||1));
    return `<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-weight:700;font-size:0.85rem;">${p.web_name}</div>
          <div style="font-size:0.7rem;color:var(--text-sub);">${p.teamShort} · £${p.price.toFixed(1)}m · Form ${p.form}</div>
        </div>
        <div style="font-family:var(--font-data);font-size:0.7rem;color:${color};">${val.toLocaleString()}</div>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.round((val/maxV)*100)}%;background:${color};"></div></div>
    </div>`;
  };
  const inEl=document.getElementById('transfersInList');
  const outEl=document.getElementById('transfersOutList');
  if (inEl)  inEl.innerHTML  = topIn.length  ? topIn.map(p=>row(p,'transfers_in_event', 'var(--green)')).join('') : noData;
  if (outEl) outEl.innerHTML = topOut.length ? topOut.map(p=>row(p,'transfers_out_event','var(--red)')).join('')   : noData;
}

/* ─────────────────────────────────────────────────────────────
   FIXTURES
   ──────────────────────────────────────────────────────────── */
function renderFixtureGwSelect() {
  const sel = document.getElementById('fixtureGwSelect');
  if (!sel||!S.bootstrap) return;
  sel.innerHTML = S.bootstrap.events.filter(e=>e.id>=1)
    .map(e=>`<option value="${e.id}" ${e.is_current?'selected':''}>${e.name}</option>`).join('');
}

function renderFixtures() {
  const gwSel = parseInt(document.getElementById('fixtureGwSelect')?.value||S.currentGW||1);
  const list  = S.allFixtures.filter(f=>f.event===gwSel);
  if (!list.length) { setHTML('fixturesArea','<div style="padding:2rem;text-align:center;color:var(--text-sub);">No fixtures found.</div>'); return; }
  setHTML('fixturesArea', list.map(f=>{
    const home=S.teams[f.team_h], away=S.teams[f.team_a];
    const ko=f.kickoff_time?new Date(f.kickoff_time):null;
    const ts=ko?ko.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+' '+ko.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'TBC';
    let mid;
    if (f.finished||f.finished_provisional) mid=`<div class="fixture-score">${f.team_h_score??'?'} – ${f.team_a_score??'?'}</div>`;
    else if (f.started) mid=`<div class="fixture-score" style="color:var(--amber);">${f.team_h_score??'0'} – ${f.team_a_score??'0'}</div><div class="fixture-time">LIVE ${f.minutes}'</div>`;
    else mid=`<div class="fixture-vs">vs</div><div class="fixture-time">${ts}</div>`;
    return `<div class="fixture-item">
      <div class="fixture-team home"><span class="fdr fdr-${f.team_h_difficulty}">${f.team_h_difficulty}</span> ${home?.name||'?'}</div>
      <div>${mid}</div>
      <div class="fixture-team away">${away?.name||'?'} <span class="fdr fdr-${f.team_a_difficulty}">${f.team_a_difficulty}</span></div>
    </div>`;
  }).join(''));
}

/* ─────────────────────────────────────────────────────────────
   LIVE GW
   ──────────────────────────────────────────────────────────── */
function renderLivePanel() {
  const mp = S.players.filter(p=>S.myTeam.includes(p.id));
  if (!mp.length) { setHTML('livePlayerList', emptyState('◎','NO SQUAD','Build your team first.')); return; }
  if (!S.liveData) { setHTML('livePlayerList', emptyState('◎','NO LIVE DATA','GW may not be active yet. Refresh during a live gameweek.')); return; }

  const sorted = [...mp].sort((a,b)=>(S.liveData[b.id]?.stats?.total_points??0)-(S.liveData[a.id]?.stats?.total_points??0));
  let total=0;
  const rows=sorted.map(p=>{
    const live=S.liveData[p.id]?.stats||{};
    const pts=live.total_points??0;
    const isC=p.id===S.captainId, isV=p.id===S.vcaptainId;
    const eff=isC?pts*2:pts; total+=eff;
    const bd=(S.liveData[p.id]?.explain||[]).flatMap(e=>e.stats||[]).filter(s=>s.points!==0)
      .map(s=>`${s.identifier.replace(/_/g,' ')}: ${s.value>0?'+':''}${s.points}`).join(' · ');
    const col=pts>=10?'var(--green)':pts>=6?'var(--amber)':'var(--text)';
    return `<div class="transfer-item">
      <div style="flex:1;">
        <div style="font-weight:700;">${p.web_name}
          ${isC?'<span class="card-badge badge-amber" style="margin-left:4px;">C ×2</span>':''}
          ${isV?'<span class="card-badge badge-blue"  style="margin-left:4px;">V/C</span>' :''}
        </div>
        <div style="font-size:0.7rem;color:var(--text-sub);">${p.teamShort} · ${p.posShort}</div>
        ${bd?`<div style="font-family:var(--font-data);font-size:0.62rem;color:var(--text-sub);margin-top:3px;">${bd}</div>`:''}
      </div>
      <div style="text-align:right;min-width:70px;">
        <div style="font-family:var(--font-data);font-size:1.4rem;font-weight:700;color:${col};">${eff}</div>
        <div style="font-family:var(--font-data);font-size:0.6rem;color:var(--text-sub);">${live.minutes??0} mins</div>
      </div>
    </div>`;
  });
  setHTML('livePlayerList', rows.join(''));
  setText('liveSquadPts', total);
}

/* ─────────────────────────────────────────────────────────────
   FPL ACCOUNT — TEAM ID + MANAGER SEARCH
   No password needed. All entry data is public on FPL API.
   ──────────────────────────────────────────────────────────── */
function openLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'flex';
  // Clear previous state
  const inp = document.getElementById('loginTeamId');
  if (inp) inp.value = '';
  clearLoginError();
}

function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'none';
  clearLoginError();
}

function clearLoginError() {
  const err = document.getElementById('loginError');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
}

function setLoginError(msg) {
  const err = document.getElementById('loginError');
  if (err) { err.style.display = 'block'; err.textContent = msg; }
}

function handleAccountBtn() {
  if (S.fplEntryId) switchTab('leagues');
  else openLoginModal();
}

// ── Submit Team ID directly ──────────────────────────────────
async function submitTeamId() {
  const idEl  = document.getElementById('loginTeamId');
  const btn   = document.getElementById('loginSubmitBtn');
  const rawId = idEl?.value.trim();

  if (!rawId || isNaN(parseInt(rawId))) {
    setLoginError('Please enter a valid Team ID — numbers only.');
    return;
  }

  clearLoginError();
  if (btn) { btn.textContent = 'CONNECTING...'; btn.disabled = true; }

  try {
    await connectEntry(parseInt(rawId));
  } catch (err) {
    setLoginError(`Could not connect: ${err.message}`);
  } finally {
    if (btn) { btn.textContent = 'CONNECT TEAM'; btn.disabled = false; }
  }
}

// ── Core: fetch entry by ID and save session ─────────────────
async function connectEntry(entryId) {
  // FPL entry endpoint is fully public — fetch via corsproxy
  const res = await fplFetch(`/entry/${entryId}/`);
  if (!res.ok) {
    setLoginError(`No FPL team found with ID ${entryId}. Double-check the number.`);
    return;
  }
  const raw = await res.json();

  S.fplEntryId = entryId;
  S.fplPlayer  = {
    first_name:             raw.player_first_name  || '',
    last_name:              raw.player_last_name   || '',
    teamName:               raw.name               || '',
    summary_overall_points: raw.summary_overall_points,
    summary_overall_rank:   raw.summary_overall_rank,
    summary_event_points:   raw.summary_event_points,
    entry:                  entryId,
  };
  S.myLeagues = raw.leagues || { classic: [], h2h: [] };

  localStorage.setItem('fpl_entry_id', S.fplEntryId);
  localStorage.setItem('fpl_player',   JSON.stringify(S.fplPlayer));
  localStorage.setItem('fpl_leagues',  JSON.stringify(S.myLeagues));

  closeLoginModal();
  updateAccountUI();
  renderDashboard();
  await importFplTeam();
}

// ── Manager name search using FPL search endpoint ────────────
async function searchManager() {
  const input   = document.getElementById('managerSearchInput');
  const results = document.getElementById('managerSearchResults');
  const query   = input?.value.trim();
  if (!query || !results) return;

  results.style.display = 'block';
  results.innerHTML = `<div style="color:var(--text-sub);font-size:0.78rem;padding:0.5rem;">Searching...</div>`;

  try {
    // FPL player/manager search endpoint
    const res = await fplFetch(`/search/?q=${encodeURIComponent(query)}&page_size=8`);
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    const entries = data.results || [];

    if (!entries.length) {
      results.innerHTML = `<div style="color:var(--text-sub);font-size:0.78rem;padding:0.5rem;">No managers found for "${query}"</div>`;
      return;
    }

    results.innerHTML = entries.map(e => `
      <div class="search-result-item" data-eid="${e.entry}">
        <div>
          <div style="font-weight:700;font-size:0.85rem;">${e.player_name}</div>
          <div style="font-family:var(--font-data);font-size:0.65rem;color:var(--text-sub);">
            ${e.entry_name} · ID: ${e.entry} · Rank: ${e.entry_rank?.toLocaleString()||'—'}
          </div>
        </div>
        <button class="btn btn-green btn-sm" style="flex-shrink:0;">Select</button>
      </div>`).join('');

    // Click delegation for search results
    results.querySelectorAll('.search-result-item').forEach(item => {
      item.querySelector('button').addEventListener('click', () => {
        connectEntry(parseInt(item.dataset.eid));
      });
    });

  } catch (err) {
    results.innerHTML = `<div style="color:var(--text-sub);font-size:0.78rem;padding:0.5rem;">Search unavailable — please enter your Team ID directly instead.</div>`;
  }
}

function updateAccountUI() {
  const btn = document.getElementById('accountBtn');
  const lbl = document.getElementById('accountBtnLabel');
  if (!btn) return;
  if (S.fplPlayer) {
    btn.classList.add('logged-in');
    if (lbl) lbl.textContent = S.fplPlayer.first_name || 'ACCOUNT';
  } else {
    btn.classList.remove('logged-in');
    if (lbl) lbl.textContent = 'LOGIN';
  }
}

function logout() {
  S.fplCookie=null; S.fplEntryId=null; S.fplPlayer=null;
  ['fpl_cookie','fpl_entry_id','fpl_player'].forEach(k=>localStorage.removeItem(k));
  updateAccountUI();
  setHTML('leaguesContent',      '');
  setHTML('leaguesLoginPrompt',  '');
  document.getElementById('leaguesLoginPrompt').style.display='block';
  document.getElementById('leaguesContent').style.display='none';
  renderDashboard();
}

/* ─────────────────────────────────────────────────────────────
   FPL TEAM IMPORT  — public picks endpoint, no auth needed
   ──────────────────────────────────────────────────────────── */
async function importFplTeam() {
  if (!S.fplEntryId) { alert('Please connect your FPL account first.'); return; }
  const gw = S.currentGW || S.nextGW;
  if (!gw) return;

  try {
    const res = await fplFetch(`/entry/${S.fplEntryId}/event/${gw}/picks/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data  = await res.json();
    const picks = data.picks || [];
    if (!picks.length) return;

    const newTeam = picks.map(pk => pk.element).filter(id => S.players.find(p => p.id === id));
    if (!newTeam.length) return;

    S.myTeam = newTeam;
    const capPick = picks.find(pk => pk.is_captain);
    const vcPick  = picks.find(pk => pk.is_vice_captain);
    if (capPick) S.captainId  = capPick.element;
    if (vcPick)  S.vcaptainId = vcPick.element;

    saveTeam();
    renderAll();
  } catch (err) {
    console.warn('Team import:', err.message);
  }
}

/* ─────────────────────────────────────────────────────────────
   LEAGUES TAB
   ──────────────────────────────────────────────────────────── */
function renderLeaguesTab() {
  const prompt  = document.getElementById('leaguesLoginPrompt');
  const content = document.getElementById('leaguesContent');

  if (!S.fplEntryId) {
    if (prompt)  prompt.style.display  = 'block';
    if (content) content.style.display = 'none';
    return;
  }

  if (prompt)  prompt.style.display  = 'none';
  if (content) content.style.display = 'block';

  renderEntryCard();
  loadLeaguesList();
}

function renderEntryCard() {
  const el = document.getElementById('fplEntryCard');
  if (!el || !S.fplPlayer) return;
  const p = S.fplPlayer;
  el.innerHTML = `
    <div class="entry-card-name">${p.first_name} ${p.last_name}</div>
    <div style="font-family:var(--font-data);font-size:0.65rem;color:var(--text-sub);">Entry #${S.fplEntryId}</div>
    <div class="entry-card-grid">
      <div class="entry-stat">
        <div class="entry-stat-val">${p.summary_overall_points||'—'}</div>
        <div class="entry-stat-lbl">Total Pts</div>
      </div>
      <div class="entry-stat">
        <div class="entry-stat-val">${p.summary_overall_rank?.toLocaleString()||'—'}</div>
        <div class="entry-stat-lbl">Overall Rank</div>
      </div>
      <div class="entry-stat">
        <div class="entry-stat-val">${p.summary_event_points||'—'}</div>
        <div class="entry-stat-lbl">GW Pts</div>
      </div>
    </div>`;
}

async function loadLeaguesList() {
  // Use leagues already fetched during connectEntry if available
  if (S.myLeagues?.classic?.length || S.myLeagues?.h2h?.length) {
    renderLeagueLists(S.myLeagues);
    return;
  }

  setHTML('classicLeaguesList', '<div style="color:var(--text-sub);font-size:0.8rem;padding:0.5rem;">Loading...</div>');

  try {
    const res = await fplFetch(`/entry/${S.fplEntryId}/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    S.myLeagues = data.leagues || { classic: [], h2h: [] };
    localStorage.setItem('fpl_leagues', JSON.stringify(S.myLeagues));
    renderLeagueLists(S.myLeagues);
  } catch (err) {
    setHTML('classicLeaguesList', `<div style="color:var(--red);font-size:0.8rem;padding:0.5rem;">Failed: ${err.message}</div>`);
  }
}

function renderLeagueLists(leagues) {
  const renderList = (list, elId) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!list?.length) { el.innerHTML = '<div style="color:var(--text-sub);font-size:0.8rem;padding:0.5rem 0;">No leagues found.</div>'; return; }
    el.innerHTML = list.map(l => `
      <div class="league-item" data-lid="${l.id}" data-name="${l.name||l.league_name||'League'}">
        <div>
          <div class="league-name">${l.name||l.league_name||'—'}</div>
          <div class="league-meta">ID: ${l.id} · Your rank: ${l.entry_rank?.toLocaleString()||'—'}</div>
        </div>
        <span class="league-arrow">›</span>
      </div>`).join('');
  };
  renderList(leagues.classic || [], 'classicLeaguesList');
  renderList(leagues.h2h     || [], 'h2hLeaguesList');
}

async function loadStandings(leagueId, type, name, page=1) {
  S.currentLeagueId   = leagueId;
  S.currentLeagueType = type;
  S.standingsPage     = page;

  const panel = document.getElementById('standingsPanel');
  const title = document.getElementById('standingsTitle');
  const table = document.getElementById('standingsTable');
  if (!panel) return;

  panel.style.display = 'block';
  if (title && name) title.textContent = name.toUpperCase();
  if (table) table.innerHTML = '<div style="padding:1rem;color:var(--text-sub);">Loading standings...</div>';

  try {
    const endpoint = type === 'h2h'
      ? `/leagues-h2h/${leagueId}/standings/?page_standings=${page}`
      : `/leagues-classic/${leagueId}/standings/?page_standings=${page}`;

    const res = await fplFetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const rows = data.standings?.results || [];
    if (!rows.length) { if (table) table.innerHTML = '<div style="padding:1rem;color:var(--text-sub);">No standings data available.</div>'; return; }

    if (table) table.innerHTML = `
      <div class="standings-row header">
        <div>#</div><div>Manager</div><div>GW Pts</div><div>Total</div><div>± Move</div>
      </div>
      ${rows.map(r => {
        const isMine   = r.entry === S.fplEntryId;
        const rankCls  = r.rank <= 3 ? 'top3' : '';
        const move     = (r.last_rank||r.rank) - r.rank;
        const moveCls  = move>0?'move-up':move<0?'move-down':'move-same';
        const moveStr  = move>0?`▲${move}`:move<0?`▼${Math.abs(move)}`:'–';
        return `
          <div class="standings-row ${isMine?'my-entry':''}">
            <div class="standings-rank ${rankCls}">${r.rank}</div>
            <div>
              <div style="font-weight:700;">${r.player_name}</div>
              <div style="font-size:0.7rem;color:var(--text-sub);">${r.entry_name}</div>
            </div>
            <div style="text-align:right;font-family:var(--font-data);">${r.event_total}</div>
            <div class="standings-pts">${r.total}</div>
            <div class="standings-move ${moveCls}">${moveStr}</div>
          </div>`;
      }).join('')}`;

    // Pagination
    const pag = document.getElementById('standingsPagination');
    if (pag) {
      let ph = '';
      if (page > 1)                  ph += `<button class="page-btn" data-page="${page-1}">‹ Prev</button>`;
      ph += `<span style="font-family:var(--font-data);font-size:0.65rem;color:var(--text-sub);">Page ${page}</span>`;
      if (data.standings?.has_next)  ph += `<button class="page-btn" data-page="${page+1}">Next ›</button>`;
      pag.innerHTML = ph;
    }

  } catch (err) {
    if (table) table.innerHTML = `<div style="padding:1rem;color:var(--red);">Failed to load standings: ${err.message}</div>`;
  }
}

function hideStandingsPanel() {
  const panel = document.getElementById('standingsPanel');
  if (panel) panel.style.display = 'none';
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────────── */
function setText(id, val) { const e=document.getElementById(id); if(e) e.textContent=val; }
function setHTML(id, val) { const e=document.getElementById(id); if(e) e.innerHTML=val; }
function pad(n) { return String(n).padStart(2,'0'); }
function emptyState(icon,h,p) {
  return `<div class="empty-state"><div class="icon">${icon}</div><h3>${h}</h3><p>${p}</p></div>`;
}

/* ─────────────────────────────────────────────────────────────
   BOOTSTRAP
   ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
