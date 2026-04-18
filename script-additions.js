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
    { icon: '🔭', label: 'Scout',           sub: 'Differentials · Price Changes',     tab: 'scout'     },
    { icon: '🛠', label: 'Tools',           sub: 'GW Planner · Squad Builder',        tab: 'tools'     },
    { icon: '🤖', label: 'AI Hub',          sub: 'Manager Chat · Transfer Debate',    tab: 'ai'        },
    { icon: '⚔️', label: 'Arena',          sub: 'Rival Mode · Draft Room',           tab: 'arena'     },
    { icon: '📰', label: 'Intel',           sub: 'News · Weather · Alerts',           tab: 'intel'     },
    { icon: '🎯', label: 'Profile',         sub: 'Captain History · DNA · Diary',     tab: 'profile'   },
    { icon: '◎', label: 'Live',            sub: 'Live GW · Score Simulator',         tab: 'live'      },
    { icon: '🏆', label: 'Leagues',         sub: 'Standings · Season Graph',          tab: 'leagues'   },
    { icon: '🔄', label: 'Refresh Data',    sub: 'Pull latest FPL data',             action: 'refresh' },
    { icon: '🌙', label: 'Toggle Theme',    sub: 'Switch dark / light',              action: 'theme'   },
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
        if (tab) { switchTab(tab); closeCmd(); }
        else if (act === 'refresh') { closeCmd(); location.reload(); }
        else if (act === 'theme') { gel('themeBtn')?.click(); closeCmd(); }
      });
    });
  }

  function switchTab(id) {
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
        switchTab(t);
        syncBottomNav(t);
      });
    });

    // More drawer
    const bd = gel('moreBackdrop');
    if (bd) bd.addEventListener('click', e => { if (e.target === bd || e.target.closest('.more-backdrop:not(.more-drawer)')) closeMoreDrawer(); });
    qall('.more-item').forEach(item => {
      item.addEventListener('click', () => {
        const t = item.dataset.tab;
        if (t) { switchTab(t); syncBottomNav(t); closeMoreDrawer(); }
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
    const bs = S.bootstrap;
    if (!bs) { area.innerHTML = `<div class="empty-state"><div class="icon">📅</div><h3>LOADING DATA</h3><p>FPL data not ready yet.</p></div>`; return; }

    const events = bs.events || [];
    const currIdx = events.findIndex(e => e.is_current);
    const nextIdx = events.findIndex(e => e.is_next);
    const startIdx = nextIdx >= 0 ? nextIdx : (currIdx >= 0 ? currIdx : 0);
    const gws = events.slice(startIdx, startIdx + 5);
    if (!gws.length) { area.innerHTML = `<div class="empty-state"><div class="icon">📅</div><h3>SEASON COMPLETE</h3><p>No upcoming gameweeks.</p></div>`; return; }

    const players = bs.elements || [];
    const teams   = bs.teams   || [];

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
          ${isChip ? `<div class="planner-gw-chip-tag">🃏 CHIP</div>` : ''}
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
          <span class="planner-arr">→</span>
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
      if (!p) { area.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>NOT FOUND</h3><p>Try a different name.</p></div>`; return; }
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
      hold:  `${p.web_name} is in excellent form (${form}) with strong projected points (${xPts}) next GW. High ownership (${ownership}%) means selling is a risk — a blanked captaincy could cost you serious rank. Hold unless you have a like-for-like upgrade.`,
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
      area.innerHTML = `<div class="empty-state"><div class="icon">🎖</div><h3>NO HISTORY</h3><p>Connect your FPL account to see captain history.</p></div>`;
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
        if (capPts >= 12)      { chipClass = 'hit';  chipText = `★ ${capPts} pts`; }
        else if (capPts <= 4)  { chipClass = 'miss'; chipText = `✗ ${capPts} pts`; }
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
      area.innerHTML = `<div class="empty-state"><div class="icon">🎮</div><h3>NO SQUAD</h3><p>Build your team to use the simulator.</p></div>`;
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
              <div class="sim-player-name">${p.web_name}${isCap ? '<span class="sim-is-captain">©</span>' : ''}</div>
              <div class="sim-btns">
                <button class="sim-btn${ev.goal?'.on':''}" data-pid="${p.element}" data-ev="goal" title="Goal">⚽</button>
                <button class="sim-btn${ev.assist?'.on':''}" data-pid="${p.element}" data-ev="assist" title="Assist">🅰</button>
                ${['GKP','DEF'].includes(p.posShort) ? `<button class="sim-btn${ev.clean?'.on':''}" data-pid="${p.element}" data-ev="clean" title="Clean Sheet">🧤</button>` : ''}
                <button class="sim-btn neg-btn${ev.yellow?'.on':''}" data-pid="${p.element}" data-ev="yellow" title="Yellow Card">🟨</button>
                <button class="sim-btn neg-btn${ev.red?'.on':''}" data-pid="${p.element}" data-ev="red" title="Red Card">🟥</button>
              </div>
              <div class="sim-player-pts${displayPts < 0 ? ' neg' : ''}">${displayPts}</div>
            </div>`;
        });
      });

      area.innerHTML = html;

      // Fix class typos from template literals with dot
      area.querySelectorAll('.sim-btn\\.on').forEach(b => { b.classList.remove('sim-btn.on'); b.classList.add('sim-btn','on'); });

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
      area.innerHTML = `<div class="empty-state"><div class="icon">📊</div><h3>CONNECT ACCOUNT</h3><p>Login to see your league season graphs.</p></div>`;
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
            <button class="alert-remove" data-pid="${p.id}">✕</button>
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
        else btn.textContent = '✓';
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

    // Render on tab switch
    const tabBtns = qall('[data-tab]');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tab;
        if (t === 'tools')    setTimeout(renderGWPlanner, 50);
        if (t === 'live')     setTimeout(renderSimulator, 50);
        if (t === 'profile')  setTimeout(() => { renderCaptainHistory(); }, 50);
        if (t === 'leagues')  setTimeout(renderLeagueSeasonGraphs, 200);
        if (t === 'intel')    setTimeout(renderAlerts, 50);
        if (t === 'players')  setTimeout(() => { if (cardViewActive) renderCardGrid(); }, 50);
        updateStatsStrip();
      });
    });

    // Initial renders
    setTimeout(() => {
      renderGWPlanner();
      renderCaptainHistory();
      renderAlerts();
    }, 2000);

    // Listen for data ready
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
  window.upgrades = { renderGWPlanner, renderSimulator, renderCaptainHistory, renderLeagueSeasonGraphs, renderAlerts, renderCardGrid, updateStatsStrip, setNavDot, openCmd, closeCmd };

})();
