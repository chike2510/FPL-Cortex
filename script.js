/**
 * script.js — FPL COMMAND
 * All app logic: data fetching, team builder, predictions,
 * captain AI, transfer suggestions, risk analysis, live GW.
 *
 * Architecture: Single global State object, pure functions per feature.
 * No frameworks, no build tools. Works on any browser.
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   STATE
   ──────────────────────────────────────────────────────────── */
const State = {
  bootstrap: null,        // full data from /api/players
  allFixtures: [],        // all season fixtures
  gwFixtures: [],         // fixtures for current GW
  liveData: null,         // live GW player stats
  players: [],            // processed player array
  teams: {},              // { teamId: teamObj }
  positions: {},          // { typeId: { short, full } }
  currentGW: null,        // current GW number
  nextGW: null,           // next GW number
  myTeam: [],             // array of player IDs (max 15)
  captainId: null,        // captain player ID
  vcaptainId: null,       // vice-captain player ID

  // Pagination state for player table
  page: 1,
  pageSize: 20,
  filteredPlayers: [],    // current filtered/sorted slice
};

/* ─────────────────────────────────────────────────────────────
   INIT
   ──────────────────────────────────────────────────────────── */
async function init() {
  // Load saved team from localStorage
  const saved = localStorage.getItem('fpl_myteam');
  if (saved) {
    try { State.myTeam = JSON.parse(saved); } catch {}
  }
  const savedCap = localStorage.getItem('fpl_captain');
  const savedVc  = localStorage.getItem('fpl_vcaptain');
  if (savedCap) State.captainId  = parseInt(savedCap);
  if (savedVc)  State.vcaptainId = parseInt(savedVc);

  // Fetch data sequentially with loading bar progress
  setLoadingProgress(10, 'FETCHING PLAYER DATA...');
  const ok = await fetchBootstrap();
  if (!ok) return;

  setLoadingProgress(55, 'FETCHING FIXTURES...');
  await fetchFixtures();

  setLoadingProgress(85, 'BUILDING DASHBOARD...');

  // Render all panels
  renderDashboard();
  renderPlayerTable();
  renderMyTeam();
  renderTransfers();
  renderFixtureGwSelect();
  renderFixtures();

  setLoadingProgress(100, 'READY');

  // Mark as live
  document.getElementById('liveDot').classList.add('active');
  document.getElementById('liveDot').textContent = 'LIVE';

  // Hide loading screen
  setTimeout(() => {
    const ls = document.getElementById('loadingScreen');
    ls.style.opacity = '0';
    ls.style.transition = 'opacity 0.4s ease';
    setTimeout(() => ls.remove(), 400);
  }, 300);

  // Auto-fetch live data
  fetchLive();
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

/* ─────────────────────────────────────────────────────────────
   DATA FETCHING
   ──────────────────────────────────────────────────────────── */
async function fetchBootstrap() {
  try {
    const res = await fetch('/api/players');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    State.bootstrap = data;

    // Build lookup maps
    data.teams.forEach(t  => { State.teams[t.id] = t; });
    data.element_types.forEach(et => {
      State.positions[et.id] = { short: et.singular_name_short, full: et.singular_name };
    });

    // Process players
    State.players = data.elements.map(p => processPlayer(p));

    // Find current & next GW
    const current = data.events.find(e => e.is_current);
    const next    = data.events.find(e => e.is_next);
    State.currentGW = current ? current.id : (next ? next.id - 1 : null);
    State.nextGW    = next    ? next.id    : null;

    // Update GW badge
    const gwBadge = document.getElementById('gwBadge');
    if (gwBadge && State.currentGW) gwBadge.textContent = `GW ${State.currentGW}`;

    // Update live GW stats
    const liveGwAvg     = document.getElementById('liveGwAvg');
    const liveGwHighest = document.getElementById('liveGwHighest');
    if (current) {
      if (liveGwAvg)     liveGwAvg.textContent     = current.average_entry_score || '—';
      if (liveGwHighest) liveGwHighest.textContent = current.highest_score || '—';
      const dashGwAvg = document.getElementById('dashGwAvg');
      if (dashGwAvg) dashGwAvg.textContent = current.average_entry_score || '—';
    }

    return true;
  } catch (err) {
    console.error('Bootstrap fetch failed:', err);
    setLoadingProgress(100, 'ERROR: Could not load FPL data. Try again.');
    setTimeout(() => {
      const ls = document.getElementById('loadingScreen');
      if (ls) {
        ls.innerHTML = `
          <div class="loading-logo">FPL <span>COMMAND</span></div>
          <div style="color:var(--red);font-family:var(--font-data);font-size:0.8rem;margin-top:1rem;text-align:center;max-width:300px;">
            Could not connect to FPL API.<br>This usually means the API is down or rate-limiting.<br><br>
            <button class="btn btn-green btn-sm" onclick="location.reload()">↻ RETRY</button>
          </div>`;
      }
    }, 500);
    return false;
  }
}

async function fetchFixtures() {
  try {
    const res = await fetch('/api/fixtures');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    State.allFixtures = data;

    // Filter fixtures for current GW (or next if not active)
    const targetGW = State.currentGW || State.nextGW;
    State.gwFixtures = data.filter(f => f.event === targetGW);
  } catch (err) {
    console.error('Fixtures fetch failed:', err);
  }
}

async function fetchLive() {
  const btn = document.getElementById('liveRefreshBtn');
  if (btn) { btn.classList.add('spinning'); btn.textContent = '↻'; }

  const gw = State.currentGW || State.nextGW;
  if (!gw) {
    if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ REFRESH'; }
    return;
  }

  try {
    const res = await fetch(`/api/live?gw=${gw}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    State.liveData = data.elements; // { playerId: { id, stats, explain } }

    renderLivePanel();
    renderDashboard(); // re-render dashboard with live pts
  } catch (err) {
    console.error('Live fetch failed:', err);
    const ll = document.getElementById('livePlayerList');
    if (ll) ll.innerHTML = `<div class="empty-state"><div class="icon">◎</div><h3>NO LIVE DATA</h3><p>Gameweek may not be active yet, or FPL API is down.</p></div>`;
  }

  // Update badge
  const badge = document.getElementById('liveUpdateBadge');
  if (badge) {
    const now = new Date();
    badge.textContent = `UPDATED ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  }

  if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ REFRESH'; }
}

async function refreshData() {
  const btn = document.getElementById('refreshBtn');
  if (btn) { btn.classList.add('spinning'); }
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
  const team = State.teams[p.team] || {};
  const pos  = State.positions[p.element_type] || {};

  // Get upcoming fixtures for this player's team
  const upcomingFixtures = getUpcomingFixtures(p.team, 3);

  // Calculate average FDR over next 3 fixtures
  const avgFDR = upcomingFixtures.length > 0
    ? upcomingFixtures.reduce((sum, f) => sum + f.difficulty, 0) / upcomingFixtures.length
    : 3;

  // Projected points formula:
  //   base = form (rolling avg pts) × fixture_multiplier × minutes_factor
  //   bonus = position-specific clean sheet / goal threat
  const form   = parseFloat(p.form) || 0;
  const fdrMul = fdrToMultiplier(avgFDR);
  const minFactor = Math.min(1, (p.minutes / Math.max(1, State.currentGW || 1)) / 90);
  const minFactor2 = 0.5 + 0.5 * minFactor; // 0.5–1.0 range so guaranteed starters aren't penalised too hard

  let projected = form * fdrMul * minFactor2;

  // Bonus for attacking returns based on ICT index
  const ict = parseFloat(p.ict_index) || 0;
  if (p.element_type === 3 || p.element_type === 4) {
    projected += (ict / 100) * 0.8;
  }
  // Bonus for clean sheet probability for GKP/DEF
  if (p.element_type === 1 || p.element_type === 2) {
    const csLikelihood = avgFDR <= 2 ? 0.5 : avgFDR <= 3 ? 0.35 : 0.2;
    projected += csLikelihood * (p.element_type === 1 ? 6 : 4);
  }

  // Fallback: use FPL's own ep_next if available
  const epNext = parseFloat(p.ep_next) || 0;
  if (epNext > 0) {
    // Blend our prediction with FPL's own
    projected = projected * 0.4 + epNext * 0.6;
  }

  return {
    ...p,
    teamName:  team.name || '—',
    teamShort: team.short_name || '—',
    posShort:  pos.short || '—',
    price:     p.now_cost / 10,
    formVal:   form,
    projectedPts: Math.round(projected * 10) / 10,
    avgFDR,
    upcomingFixtures,
  };
}

function fdrToMultiplier(fdr) {
  if (fdr <= 1.5) return 1.5;
  if (fdr <= 2.5) return 1.25;
  if (fdr <= 3.5) return 1.0;
  if (fdr <= 4.5) return 0.75;
  return 0.55;
}

function getUpcomingFixtures(teamId, count = 3) {
  const gw = State.currentGW || State.nextGW || 1;
  const results = [];
  for (const f of State.allFixtures) {
    if (results.length >= count) break;
    if (f.event && f.event >= gw && !f.finished) {
      if (f.team_h === teamId) {
        results.push({ opponent: State.teams[f.team_a]?.short_name || '?', home: true, difficulty: f.team_h_difficulty, gw: f.event });
      } else if (f.team_a === teamId) {
        results.push({ opponent: State.teams[f.team_h]?.short_name || '?', home: false, difficulty: f.team_a_difficulty, gw: f.event });
      }
    }
  }
  return results;
}

/* ─────────────────────────────────────────────────────────────
   TAB NAVIGATION
   ──────────────────────────────────────────────────────────── */
function switchTab(tabName) {
  // Update buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });

  // Lazy render on switch
  if (tabName === 'myteam')   renderMyTeam();
  if (tabName === 'transfers') renderTransfers();
  if (tabName === 'fixtures') renderFixtures();
  if (tabName === 'live')     renderLivePanel();
  if (tabName === 'dashboard') renderDashboard();
}

/* ─────────────────────────────────────────────────────────────
   DASHBOARD
   ──────────────────────────────────────────────────────────── */
function renderDashboard() {
  const myPlayers = State.players.filter(p => State.myTeam.includes(p.id));

  // Total projected pts
  let totalProj = myPlayers.reduce((s, p) => s + p.projectedPts, 0);

  // Captain bonus
  const captain = myPlayers.find(p => p.id === State.captainId);
  if (captain) totalProj += captain.projectedPts; // captain pts counted twice

  document.getElementById('dashProjected').textContent = Math.round(totalProj * 10) / 10;

  // Captain points display
  if (captain) {
    document.getElementById('dashCaptainPts').textContent = Math.round(captain.projectedPts * 2 * 10) / 10;
    document.getElementById('dashCaptainName').textContent = captain.web_name;
  } else {
    document.getElementById('dashCaptainPts').textContent = '—';
    document.getElementById('dashCaptainName').textContent = 'No Captain Set';
  }

  // Team value
  const value = myPlayers.reduce((s, p) => s + p.price, 0);
  document.getElementById('dashValue').textContent = `£${value.toFixed(1)}m`;
  document.getElementById('dashPlayerCount').textContent = `${myPlayers.length} players selected`;

  // Captain suggestion panel
  renderCaptainSuggestions(myPlayers);

  // Risk panel
  renderRiskAnalysis(myPlayers);
}

/* ─────────────────────────────────────────────────────────────
   CAPTAIN AI
   ──────────────────────────────────────────────────────────── */
function calcCaptainScore(player) {
  const form   = player.formVal;
  const fdrMul = fdrToMultiplier(player.avgFDR);
  const ict    = parseFloat(player.ict_index) || 0;
  // Weighted: form matters most, ICT secondary, fixture multiplier
  return (form * 3 + ict / 20 + player.projectedPts) * fdrMul;
}

function renderCaptainSuggestions(myPlayers) {
  const area = document.getElementById('captainArea');
  if (!area) return;

  if (myPlayers.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="icon">🎖</div><h3>NO SQUAD SELECTED</h3><p>Add players in My Team, then use Auto Pick.</p></div>`;
    return;
  }

  // Score and sort
  const ranked = [...myPlayers]
    .sort((a, b) => calcCaptainScore(b) - calcCaptainScore(a))
    .slice(0, 3);

  area.innerHTML = `
    <div class="captain-cards">
      ${ranked.map((p, i) => {
        const fix = p.upcomingFixtures[0];
        const fixStr = fix ? `${fix.home ? '' : '@'}${fix.opponent} (FDR ${fix.difficulty})` : 'No fixture';
        return `
          <div class="captain-card ${i === 0 ? 'rank-1' : ''}" onclick="setCaptain(${p.id}, ${i})">
            <div class="cc-name">${p.web_name}</div>
            <div class="cc-team">${p.teamShort} · ${p.posShort}</div>
            <div class="cc-ep">${p.projectedPts * (i === 0 ? 2 : 1)}</div>
            <div class="cc-score">xPts · Next: ${fixStr}</div>
            <div style="margin-top:0.5rem;font-family:var(--font-data);font-size:0.6rem;color:var(--text-sub);">
              Form ${p.form} · £${p.price}m · ${p.selected_by_percent}% own
            </div>
            ${i === 0 && p.id === State.captainId   ? '<div style="margin-top:4px;" class="card-badge badge-amber">★ CAPTAIN</div>'    : ''}
            ${i === 1 && p.id === State.vcaptainId  ? '<div style="margin-top:4px;" class="card-badge badge-blue">V/C</div>' : ''}
          </div>`;
      }).join('')}
    </div>`;
}

function setCaptain(playerId, rank) {
  if (rank === 0) {
    State.captainId = playerId;
    localStorage.setItem('fpl_captain', playerId);
  } else if (rank === 1) {
    State.vcaptainId = playerId;
    localStorage.setItem('fpl_vcaptain', playerId);
  }
  const myPlayers = State.players.filter(p => State.myTeam.includes(p.id));
  renderCaptainSuggestions(myPlayers);
  renderMyTeam();
  renderDashboard();
}

function autoPickCaptain() {
  const myPlayers = State.players.filter(p => State.myTeam.includes(p.id));
  if (myPlayers.length === 0) return;

  const ranked = [...myPlayers].sort((a, b) => calcCaptainScore(b) - calcCaptainScore(a));
  State.captainId  = ranked[0]?.id || null;
  State.vcaptainId = ranked[1]?.id || null;

  if (State.captainId)  localStorage.setItem('fpl_captain',   State.captainId);
  if (State.vcaptainId) localStorage.setItem('fpl_vcaptain',  State.vcaptainId);

  renderCaptainSuggestions(myPlayers);
  renderMyTeam();
  renderDashboard();
}

/* ─────────────────────────────────────────────────────────────
   RISK ANALYSIS
   ──────────────────────────────────────────────────────────── */
function getRisk(player) {
  const risks = [];

  // Injury/doubt flags
  if (player.chance_of_playing_next_round !== null && player.chance_of_playing_next_round < 75) {
    risks.push({ level: 'high', reason: `${player.chance_of_playing_next_round}% chance of playing — ${player.news || 'fitness doubt'}` });
  } else if (player.chance_of_playing_next_round !== null && player.chance_of_playing_next_round < 100) {
    risks.push({ level: 'medium', reason: `Slight doubt — ${player.news || 'monitor fitness'}` });
  }

  // Low form
  if (player.formVal < 2 && player.total_points > 0) {
    risks.push({ level: 'medium', reason: `Poor form: ${player.form} pts/game over last 5 GWs` });
  }
  if (player.formVal === 0) {
    risks.push({ level: 'high', reason: 'Zero form — not scoring or not playing' });
  }

  // Tough upcoming fixture
  if (player.avgFDR >= 4.5) {
    risks.push({ level: 'high', reason: `Brutal fixture run — avg FDR ${player.avgFDR.toFixed(1)} next 3 GWs` });
  } else if (player.avgFDR >= 3.5) {
    risks.push({ level: 'medium', reason: `Tough fixture run — FDR ${player.avgFDR.toFixed(1)} next 3 GWs` });
  }

  // Low minutes
  const avgMins = State.currentGW ? player.minutes / State.currentGW : 90;
  if (avgMins < 45) {
    risks.push({ level: 'medium', reason: `Low minutes — avg ${Math.round(avgMins)} mins/GW, rotation risk` });
  }

  return risks;
}

function renderRiskAnalysis(myPlayers) {
  const area = document.getElementById('riskArea');
  if (!area) return;
  if (myPlayers.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="icon">🛡</div><h3>NO SQUAD DATA</h3><p>Build your team to see risk flags.</p></div>`;
    return;
  }

  const playersWithRisks = myPlayers
    .map(p => ({ player: p, risks: getRisk(p) }))
    .filter(x => x.risks.length > 0)
    .sort((a, b) => {
      const lvl = r => r.level === 'high' ? 2 : r.level === 'medium' ? 1 : 0;
      return Math.max(...b.risks.map(lvl)) - Math.max(...a.risks.map(lvl));
    });

  if (playersWithRisks.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="icon">✅</div><h3>ALL CLEAR</h3><p>No risk flags on your squad. Nice work.</p></div>`;
    return;
  }

  area.innerHTML = playersWithRisks.map(({ player, risks }) => {
    const topRisk = risks[0];
    return `
      <div class="risk-item">
        <div class="risk-indicator risk-${topRisk.level}"></div>
        <div>
          <div class="risk-player">${player.web_name} <span class="pos-chip pos-${player.posShort}">${player.posShort}</span></div>
          ${risks.map(r => `<div class="risk-reason">⚠ ${r.reason}</div>`).join('')}
        </div>
        <div style="margin-left:auto;text-align:right;">
          <div class="stat-label" style="font-size:0.58rem;">FORM</div>
          <div style="font-family:var(--font-data);font-size:0.9rem;color:${topRisk.level==='high'?'var(--red)':'var(--amber)'};">${player.form}</div>
        </div>
      </div>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────────
   PLAYER TABLE
   ──────────────────────────────────────────────────────────── */
function filterPlayers() {
  State.page = 1;
  renderPlayerTable();
}

function renderPlayerTable() {
  const search  = (document.getElementById('playerSearch')?.value || '').toLowerCase();
  const pos     = document.getElementById('posFilter')?.value || '';
  const teamF   = document.getElementById('teamFilter')?.value || '';
  const sortKey = document.getElementById('sortSelect')?.value || 'total_points';

  // Populate team filter once
  const teamFilterEl = document.getElementById('teamFilter');
  if (teamFilterEl && teamFilterEl.options.length === 1) {
    const sorted = Object.values(State.teams).sort((a,b) => a.name.localeCompare(b.name));
    sorted.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name;
      teamFilterEl.appendChild(opt);
    });
  }

  let filtered = State.players.filter(p => {
    const name = `${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase();
    const matchSearch = !search || name.includes(search) || p.teamName.toLowerCase().includes(search);
    const matchPos  = !pos  || p.posShort === pos;
    const matchTeam = !teamF || p.teamName === teamF;
    return matchSearch && matchPos && matchTeam;
  });

  // Sort
  filtered.sort((a, b) => {
    const va = parseFloat(a[sortKey]) || 0;
    const vb = parseFloat(b[sortKey]) || 0;
    return vb - va;
  });

  State.filteredPlayers = filtered;

  // Pagination
  const total = filtered.length;
  const pages = Math.ceil(total / State.pageSize);
  const start = (State.page - 1) * State.pageSize;
  const slice = filtered.slice(start, start + State.pageSize);

  // Render table rows
  const tbody = document.getElementById('playerTableBody');
  if (!tbody) return;

  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-sub);">No players found.</td></tr>`;
  } else {
    tbody.innerHTML = slice.map(p => {
      const formClass = p.formVal >= 6 ? 'form-hi' : p.formVal >= 3 ? 'form-mid' : 'form-lo';
      const inTeam    = State.myTeam.includes(p.id);
      const risks     = getRisk(p);
      const hasRisk   = risks.length > 0;
      const riskFlag  = hasRisk ? `<span class="risk-flag" data-tip="${risks[0].reason}">${risks[0].level==='high'?'🔴':'🟡'}</span>` : '';
      const availability = p.chance_of_playing_next_round !== null && p.chance_of_playing_next_round < 100
        ? `<div class="news-banner">⚠ ${p.news || p.chance_of_playing_next_round + '% chance'}</div>` : '';

      return `
        <tr>
          <td>
            <div class="player-name">${p.web_name}${riskFlag}</div>
            <div class="player-team-pos">${p.teamShort}</div>
            ${availability}
          </td>
          <td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td>
          <td style="color:var(--text-sub);font-size:0.78rem;">${p.teamShort}</td>
          <td><span class="price-val">£${p.price.toFixed(1)}m</span></td>
          <td><span class="form-val ${formClass}">${p.form}</span></td>
          <td><span class="pts-val">${p.total_points}</span></td>
          <td><span class="ep-val">${p.ep_next || '—'}</span></td>
          <td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td>
          <td>
            <button
              class="add-btn ${inTeam ? 'in-team' : ''}"
              onclick="togglePlayer(${p.id})"
              ${inTeam ? '' : State.myTeam.length >= 15 ? 'disabled' : ''}
            >${inTeam ? '✓ Added' : '+ Add'}</button>
          </td>
        </tr>`;
    }).join('');
  }

  // Render pagination
  const pag = document.getElementById('playerPagination');
  if (pag) {
    if (pages <= 1) { pag.innerHTML = ''; return; }
    let html = '';
    if (State.page > 1) html += `<button class="page-btn" onclick="goPage(${State.page - 1})">‹ Prev</button>`;
    const from = Math.max(1, State.page - 2);
    const to   = Math.min(pages, State.page + 2);
    for (let i = from; i <= to; i++) {
      html += `<button class="page-btn ${i === State.page ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
    }
    if (State.page < pages) html += `<button class="page-btn" onclick="goPage(${State.page + 1})">Next ›</button>`;
    html += `<span style="font-family:var(--font-data);font-size:0.65rem;color:var(--text-sub);margin-left:0.5rem;">${total} players</span>`;
    pag.innerHTML = html;
  }
}

function goPage(n) {
  State.page = n;
  renderPlayerTable();
  // Scroll to top of table
  document.getElementById('playerTable')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ─────────────────────────────────────────────────────────────
   MY TEAM
   ──────────────────────────────────────────────────────────── */
function togglePlayer(playerId) {
  const idx = State.myTeam.indexOf(playerId);
  if (idx === -1) {
    if (State.myTeam.length >= 15) return; // max 15
    State.myTeam.push(playerId);
  } else {
    State.myTeam.splice(idx, 1);
    // If removing captain/vc, clear those
    if (State.captainId  === playerId) { State.captainId  = null; localStorage.removeItem('fpl_captain'); }
    if (State.vcaptainId === playerId) { State.vcaptainId = null; localStorage.removeItem('fpl_vcaptain'); }
  }
  localStorage.setItem('fpl_myteam', JSON.stringify(State.myTeam));
  renderPlayerTable();
  renderMyTeam();
  renderDashboard();
}

function clearTeam() {
  if (!confirm('Clear your entire squad?')) return;
  State.myTeam     = [];
  State.captainId  = null;
  State.vcaptainId = null;
  localStorage.removeItem('fpl_myteam');
  localStorage.removeItem('fpl_captain');
  localStorage.removeItem('fpl_vcaptain');
  renderMyTeam();
  renderDashboard();
  renderPlayerTable();
}

function renderMyTeam() {
  const myPlayers = State.players.filter(p => State.myTeam.includes(p.id));

  // Update summary
  const squadCount = document.getElementById('squadCount');
  const squadValue = document.getElementById('squadValue');
  const squadProjPts = document.getElementById('squadProjPts');
  if (squadCount) squadCount.textContent = myPlayers.length;
  if (squadValue) squadValue.textContent = `£${myPlayers.reduce((s,p)=>s+p.price,0).toFixed(1)}m`;
  if (squadProjPts) {
    let proj = myPlayers.reduce((s,p)=>s+p.projectedPts,0);
    const cap = myPlayers.find(p=>p.id===State.captainId);
    if (cap) proj += cap.projectedPts;
    squadProjPts.textContent = Math.round(proj*10)/10;
  }

  // Group by position
  const byPos = { GKP: [], DEF: [], MID: [], FWD: [] };
  myPlayers.forEach(p => {
    const pos = p.posShort;
    if (byPos[pos]) byPos[pos].push(p);
  });

  // Determine starters vs bench (simple: GKP=1, DEF=5, MID=5, FWD=4 ideal, but flexible)
  const starters = {
    GKP: byPos.GKP.slice(0, 1),
    DEF: byPos.DEF.slice(0, Math.min(5, byPos.DEF.length)),
    MID: byPos.MID.slice(0, Math.min(5, byPos.MID.length)),
    FWD: byPos.FWD.slice(0, Math.min(3, byPos.FWD.length)),
  };
  const benchPlayers = myPlayers.filter(p =>
    !Object.values(starters).flat().find(s => s.id === p.id)
  );

  function playerCardHTML(p) {
    const isCapt = p.id === State.captainId;
    const isVc   = p.id === State.vcaptainId;
    const liveStats = State.liveData?.[p.id]?.stats;
    const livePts   = liveStats ? liveStats.total_points : null;
    const posIcon = { GKP: '🧤', DEF: '🛡', MID: '⚽', FWD: '🎯' }[p.posShort] || '⚽';
    return `
      <div class="player-card-sm ${isCapt ? 'captain' : isVc ? 'vice-captain' : ''}" onclick="removeFromTeam(${p.id})" title="Click to remove ${p.web_name}">
        ${isCapt ? '<div class="captain-badge">C</div>' : ''}
        ${isVc   ? '<div class="vc-badge">V</div>'     : ''}
        <div class="pos-icon">${posIcon}</div>
        <div class="p-name">${p.web_name}</div>
        <div class="p-pts">${livePts !== null ? livePts + 'pts' : p.projectedPts + 'xP'}</div>
        <div class="p-price">£${p.price.toFixed(1)}m</div>
      </div>`;
  }

  // Render pitch rows
  const rows = [
    { id: 'pitchGKP',   players: starters.GKP },
    { id: 'pitchDEF',   players: starters.DEF },
    { id: 'pitchMID',   players: starters.MID },
    { id: 'pitchFWD',   players: starters.FWD },
    { id: 'pitchBench', players: benchPlayers  },
  ];

  rows.forEach(({ id, players }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (players.length === 0) {
      el.innerHTML = `<div class="empty-slot">EMPTY</div>`;
    } else {
      el.innerHTML = players.map(p => playerCardHTML(p)).join('');
    }
  });

  // Render list below pitch
  const listArea = document.getElementById('teamListArea');
  if (!listArea) return;
  if (myPlayers.length === 0) {
    listArea.innerHTML = `<div class="empty-state"><div class="icon">👕</div><h3>SQUAD IS EMPTY</h3><p>Go to Players and add up to 15 players.</p></div>`;
    return;
  }

  const rows2 = myPlayers.map(p => {
    const isCapt = p.id === State.captainId;
    const isVc   = p.id === State.vcaptainId;
    const risks  = getRisk(p);
    const fix    = p.upcomingFixtures[0];
    const fixStr = fix ? `${fix.home ? '' : '@'}${fix.opponent} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>` : '—';
    return `
      <div class="transfer-item">
        <div style="flex:1;min-width:110px;">
          <div style="font-weight:700;">${p.web_name}
            ${isCapt ? '<span class="card-badge badge-amber" style="margin-left:4px;">C</span>' : ''}
            ${isVc   ? '<span class="card-badge badge-blue"  style="margin-left:4px;">V</span>' : ''}
          </div>
          <div style="font-size:0.72rem;color:var(--text-sub);">${p.teamShort} · <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div>
          ${risks.length > 0 ? `<div class="news-banner" style="margin-top:3px;">⚠ ${risks[0].reason}</div>` : ''}
        </div>
        <div style="text-align:center;font-family:var(--font-data);font-size:0.72rem;">
          <div style="color:var(--text-sub);font-size:0.58rem;letter-spacing:1px;">NEXT</div>
          ${fixStr}
        </div>
        <div style="text-align:right;min-width:60px;">
          <div style="font-family:var(--font-data);font-size:0.6rem;color:var(--text-sub);letter-spacing:1px;">xPTS</div>
          <div style="font-family:var(--font-data);color:var(--green);font-size:1rem;font-weight:700;">${p.projectedPts}</div>
          <div style="font-family:var(--font-data);font-size:0.65rem;color:var(--text-sub);">£${p.price.toFixed(1)}m</div>
        </div>
        <button class="remove-btn" onclick="removeFromTeam(${p.id})">✕</button>
      </div>`;
  }).join('');

  listArea.innerHTML = rows2;
}

function removeFromTeam(playerId) {
  const idx = State.myTeam.indexOf(playerId);
  if (idx !== -1) {
    State.myTeam.splice(idx, 1);
    localStorage.setItem('fpl_myteam', JSON.stringify(State.myTeam));
    renderMyTeam();
    renderPlayerTable();
    renderDashboard();
  }
}

/* ─────────────────────────────────────────────────────────────
   TRANSFER SUGGESTIONS
   ──────────────────────────────────────────────────────────── */
function renderTransfers() {
  renderTransferSuggestions();
  renderTransferTrends();
}

function renderTransferSuggestions() {
  const area = document.getElementById('transferArea');
  if (!area) return;

  const myPlayers = State.players.filter(p => State.myTeam.includes(p.id));
  if (myPlayers.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="icon">⇄</div><h3>NO SQUAD TO ANALYSE</h3><p>Build your team first, then come back for AI transfer suggestions.</p></div>`;
    return;
  }

  // For each player in team, find the best replacement (same position, similar or lower price, better score)
  const suggestions = [];

  myPlayers.forEach(current => {
    const budget = current.price + 0.5; // allow £0.5m budget uplift
    const samePos = State.players
      .filter(p =>
        p.element_type === current.element_type &&
        p.id !== current.id &&
        !State.myTeam.includes(p.id) &&
        p.price <= budget &&
        p.projectedPts > current.projectedPts
      )
      .sort((a, b) => b.projectedPts - a.projectedPts);

    if (samePos.length > 0) {
      const best = samePos[0];
      suggestions.push({
        out: current,
        in: best,
        gain: Math.round((best.projectedPts - current.projectedPts) * 10) / 10,
      });
    }
  });

  // Sort by biggest projected gain
  suggestions.sort((a, b) => b.gain - a.gain);
  const top8 = suggestions.slice(0, 8);

  if (top8.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="icon">✅</div><h3>OPTIMAL SQUAD</h3><p>No clear improvement found within your budget. Nice picks!</p></div>`;
    return;
  }

  area.innerHTML = `
    <div class="card-header" style="margin-bottom:0.75rem;">
      <span class="card-title">AI SUGGESTIONS</span>
      <span class="card-badge badge-green">TOP ${top8.length}</span>
    </div>
    ${top8.map(s => {
      const outFix = s.out.upcomingFixtures[0];
      const inFix  = s.in.upcomingFixtures[0];
      return `
        <div class="transfer-item">
          <div class="transfer-out">
            <div class="transfer-label">OUT</div>
            <div class="transfer-player" style="color:var(--red);">${s.out.web_name}</div>
            <div class="transfer-stats">
              Form ${s.out.form} · £${s.out.price.toFixed(1)}m · xP ${s.out.projectedPts}
              ${outFix ? `· ${outFix.home?'':' @'}${outFix.opponent} <span class="fdr fdr-${outFix.difficulty}">${outFix.difficulty}</span>` : ''}
            </div>
          </div>
          <div class="transfer-arrow">→</div>
          <div class="transfer-in">
            <div class="transfer-label">IN</div>
            <div class="transfer-player" style="color:var(--green);">${s.in.web_name}</div>
            <div class="transfer-stats">
              Form ${s.in.form} · £${s.in.price.toFixed(1)}m · xP ${s.in.projectedPts}
              ${inFix ? `· ${inFix.home?'':' @'}${inFix.opponent} <span class="fdr fdr-${inFix.difficulty}">${inFix.difficulty}</span>` : ''}
            </div>
          </div>
          <div class="transfer-gain">+${s.gain} xPts</div>
        </div>`;
    }).join('')}`;
}

function renderTransferTrends() {
  // Most transferred in this GW
  const sorted = [...State.players].filter(p => p.transfers_in_event > 0 || p.transfers_out_event > 0);

  const topIn  = [...sorted].sort((a,b) => b.transfers_in_event  - a.transfers_in_event).slice(0, 8);
  const topOut = [...sorted].sort((a,b) => b.transfers_out_event - a.transfers_out_event).slice(0, 8);

  const inEl  = document.getElementById('transfersInList');
  const outEl = document.getElementById('transfersOutList');

  function trendRow(p, key, colorClass) {
    const val = p[key];
    const maxVal = key === 'transfers_in_event'
      ? topIn[0]?.transfers_in_event || 1
      : topOut[0]?.transfers_out_event || 1;
    const pct = Math.round((val / maxVal) * 100);
    return `
      <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;font-size:0.85rem;">${p.web_name}</div>
            <div style="font-size:0.7rem;color:var(--text-sub);">${p.teamShort} · £${p.price.toFixed(1)}m · Form ${p.form}</div>
          </div>
          <div style="font-family:var(--font-data);font-size:0.7rem;color:${colorClass};">
            ${val.toLocaleString()}
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${pct}%;background:${colorClass};"></div>
        </div>
      </div>`;
  }

  if (inEl) inEl.innerHTML  = topIn.length  ? topIn.map(p  => trendRow(p,  'transfers_in_event',  'var(--green)')).join('') : '<div style="padding:1rem;color:var(--text-sub);text-align:center;">No data yet</div>';
  if (outEl) outEl.innerHTML = topOut.length ? topOut.map(p => trendRow(p, 'transfers_out_event', 'var(--red)')).join('') : '<div style="padding:1rem;color:var(--text-sub);text-align:center;">No data yet</div>';
}

/* ─────────────────────────────────────────────────────────────
   FIXTURES
   ──────────────────────────────────────────────────────────── */
function renderFixtureGwSelect() {
  const select = document.getElementById('fixtureGwSelect');
  if (!select || !State.bootstrap) return;

  const events = State.bootstrap.events.filter(e => e.id >= 1);
  select.innerHTML = events.map(e =>
    `<option value="${e.id}" ${e.is_current ? 'selected' : ''}>${e.name}</option>`
  ).join('');
}

function renderFixtures() {
  const area = document.getElementById('fixturesArea');
  if (!area) return;

  const gwSel = parseInt(document.getElementById('fixtureGwSelect')?.value || State.currentGW || 1);
  const gwFixtures = State.allFixtures.filter(f => f.event === gwSel);

  if (gwFixtures.length === 0) {
    area.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-sub);">No fixtures found for this gameweek.</div>`;
    return;
  }

  area.innerHTML = gwFixtures.map(f => {
    const home  = State.teams[f.team_h];
    const away  = State.teams[f.team_a];
    const kickoff = f.kickoff_time ? new Date(f.kickoff_time) : null;
    const timeStr = kickoff
      ? kickoff.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })
        + ' ' + kickoff.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })
      : 'TBC';

    let middleContent;
    if (f.finished || f.finished_provisional) {
      middleContent = `<div class="fixture-score">${f.team_h_score ?? '?'} – ${f.team_a_score ?? '?'}</div>`;
    } else if (f.started) {
      middleContent = `<div class="fixture-score" style="color:var(--amber);">${f.team_h_score ?? '0'} – ${f.team_a_score ?? '0'}</div><div class="fixture-time">LIVE ${f.minutes}'</div>`;
    } else {
      middleContent = `<div class="fixture-vs">vs</div><div class="fixture-time">${timeStr}</div>`;
    }

    return `
      <div class="fixture-item">
        <div class="fixture-team home">
          <span class="fdr fdr-${f.team_h_difficulty}">${f.team_h_difficulty}</span>
          ${home?.name || '?'}
        </div>
        <div>${middleContent}</div>
        <div class="fixture-team away">
          ${away?.name || '?'}
          <span class="fdr fdr-${f.team_a_difficulty}">${f.team_a_difficulty}</span>
        </div>
      </div>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────────
   LIVE GW PANEL
   ──────────────────────────────────────────────────────────── */
function renderLivePanel() {
  const listEl = document.getElementById('livePlayerList');
  if (!listEl) return;

  const myPlayers = State.players.filter(p => State.myTeam.includes(p.id));
  if (myPlayers.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="icon">◎</div><h3>NO SQUAD</h3><p>Build your team in My Team tab first.</p></div>`;
    return;
  }

  if (!State.liveData) {
    listEl.innerHTML = `<div class="empty-state"><div class="icon">◎</div><h3>NO LIVE DATA</h3><p>GW may not be active yet. Try refreshing during a live gameweek.</p></div>`;
    return;
  }

  // Calculate live squad total
  let squadTotal = 0;
  const sorted = [...myPlayers].sort((a, b) => {
    const ptsA = State.liveData[a.id]?.stats?.total_points ?? 0;
    const ptsB = State.liveData[b.id]?.stats?.total_points ?? 0;
    return ptsB - ptsA;
  });

  const rows = sorted.map(p => {
    const live   = State.liveData[p.id]?.stats || {};
    const pts    = live.total_points ?? 0;
    const isCapt = p.id === State.captainId;
    const isVc   = p.id === State.vcaptainId;
    const effectivePts = isCapt ? pts * 2 : pts;
    squadTotal += effectivePts;

    const explain = State.liveData[p.id]?.explain || [];
    const breakdown = explain.flatMap(e => e.stats || [])
      .filter(s => s.points !== 0)
      .map(s => `${s.identifier.replace(/_/g,' ')}: ${s.value>0?'+':''}${s.points}`)
      .join(' · ');

    return `
      <div class="transfer-item ${pts > 6 ? 'has-live-pts' : ''}">
        <div style="flex:1;">
          <div style="font-weight:700;">${p.web_name}
            ${isCapt ? '<span class="card-badge badge-amber" style="margin-left:4px;">C ×2</span>' : ''}
            ${isVc   ? '<span class="card-badge badge-blue"  style="margin-left:4px;">V/C</span>'  : ''}
          </div>
          <div style="font-size:0.7rem;color:var(--text-sub);">${p.teamShort} · ${p.posShort}</div>
          ${breakdown ? `<div style="font-family:var(--font-data);font-size:0.62rem;color:var(--text-sub);margin-top:3px;">${breakdown}</div>` : ''}
        </div>
        <div style="text-align:right;min-width:70px;">
          <div style="font-family:var(--font-data);font-size:1.4rem;font-weight:700;color:${pts>=6?'var(--green)':pts>=3?'var(--amber)':'var(--text)'};">${effectivePts}</div>
          <div style="font-family:var(--font-data);font-size:0.6rem;color:var(--text-sub);">${live.minutes ?? 0} mins</div>
        </div>
      </div>`;
  });

  listEl.innerHTML = rows.join('');

  // Update live total
  const liveSquadEl = document.getElementById('liveSquadPts');
  if (liveSquadEl) liveSquadEl.textContent = squadTotal;
}

/* ─────────────────────────────────────────────────────────────
   BOOTSTRAP
   ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
