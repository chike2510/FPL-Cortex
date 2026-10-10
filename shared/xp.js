/**
 * Cortex component xP model (ported from the v1 script.js `processPlayer`), framework-free.
 * Used by the browser app and by edge API routes (/api/plus, /api/ai) so both agree.
 */
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
const clampNum = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

function poissonTailAtLeast(mean, threshold) {
  const mu = Math.max(0, Number(mean) || 0), k = Math.max(1, Math.floor(Number(threshold) || 1));
  let cum = Math.exp(-mu), term = cum;
  for (let i = 1; i < k; i++) { term *= mu / i; cum += term; }
  return clamp01(1 - cum);
}

export function availability(p) {
  const status = String(p.status || 'a').toLowerCase();
  const statusApp = { a: 1, d: .78, u: .58, i: .18, n: .35, s: .05 }[status] ?? .82;
  const chance = p.chance_of_playing_next_round == null ? 1 : clampNum(Number(p.chance_of_playing_next_round) / 100, 0, 1);
  const minutes = Number(p.minutes) || 0, starts = Number(p.starts) || 0;
  let startShare = minutes > 0 ? clampNum(starts / Math.max(1, minutes / 90), .12, .98) : .56;
  if (minutes < 450) startShare *= .84;
  const startProb = clamp01(Math.min(statusApp, chance, startShare));
  const appearanceProb = clamp01(Math.min(statusApp, chance, Math.max(startProb, .45 * statusApp)));
  const expectedMinutes = clampNum(startProb * 90 + Math.max(0, appearanceProb - startProb) * 24, 0, 90);
  return { startProb, appearanceProb, expectedMinutes };
}

const atk = t => (Number(t?.strength_attack_home || 1100) + Number(t?.strength_attack_away || 1100)) / 2;
const dfn = t => (Number(t?.strength_defence_home || 1100) + Number(t?.strength_defence_away || 1100)) / 2;

/** Projection for one player over a list of fixtures [{difficulty, opponentId, home}] treated as one GW window. */
export function projectFixtures(p, team, teams, uf, { useOfficial = true } = {}) {
  if (!uf.length) return 0;
  const avgFDR = uf.reduce((s, f) => s + f.difficulty, 0) / uf.length;
  const fixtureEase = clampNum(1.08 + (3 - avgFDR) * .075, .78, 1.22);
  const oppAtk = uf.reduce((s, f) => s + atk(teams[f.opponentId]), 0) / uf.length;
  const oppDef = uf.reduce((s, f) => s + dfn(teams[f.opponentId]), 0) / uf.length;
  const attackFactor = clampNum(.9 + atk(team) / Math.max(1, oppDef) * .18 + (3 - avgFDR) * .035, .72, 1.28);
  const defenceFactor = clampNum(.9 + dfn(team) / Math.max(1, oppAtk) * .16, .72, 1.22);
  const av = availability(p);
  const share = av.expectedMinutes / 90;
  const form = parseFloat(p.form) || 0, ppg = clampNum(parseFloat(p.points_per_game) || 0, 0, 8), ict = parseFloat(p.ict_index) || 0;
  const mins = Number(p.minutes) || 0;
  const xg90 = Math.max(0, parseFloat(p.expected_goals_per_90) || (mins ? (p.goals_scored || 0) / mins * 90 : 0));
  const xa90 = Math.max(0, parseFloat(p.expected_assists_per_90) || (mins ? (p.assists || 0) / mins * 90 : 0));
  const goalPts = { 1: 10, 2: 6, 3: 5, 4: 4 }[p.element_type] || 4;
  const xG = xg90 * share * attackFactor, xA = xa90 * share * attackFactor;
  const pen = ({ 1: .22, 2: .08 }[Number(p.penalties_order)] || 0) * share * attackFactor * goalPts;
  const appear = av.appearanceProb + av.startProb * (av.expectedMinutes >= 60 ? 1 : .25);
  const csBase = p.element_type <= 2 ? .34 : p.element_type === 3 ? .12 : 0;
  const cs = csBase * defenceFactor * fixtureEase * av.appearanceProb * (av.expectedMinutes >= 60 ? 1 : .35);
  const dcRate = Math.max(0, parseFloat(p.defensive_contribution_per_90) || 0);
  const dcThr = p.element_type === 2 ? 10 : p.element_type === 3 ? 12 : 999;
  const dc = dcThr < 999 ? 2 * poissonTailAtLeast(dcRate * share * clampNum(1 + (avgFDR - 3) * .08, .82, 1.22), dcThr) : 0;
  const bonusRate = mins ? (p.bonus || 0) / Math.max(1, mins / 90) : 0;
  const bonus = clampNum(bonusRate * share * attackFactor * (form > 0 ? 1.05 : 1), 0, 1.15);
  const component = appear + xG * goalPts + xA * 3 + pen + cs + dc + bonus + ppg * .12 + Math.max(0, form) * .06 + Math.min(.35, ict / 350 * .35);
  const ep = parseFloat(p.ep_next);
  const out = useOfficial && ep > 0 ? Math.max(ep, component * .82 + ep * .18) : component;
  return Math.round(clampNum(out, 0, 15) * 10) / 10;
}

/** Build the enriched model from bootstrap-static + fixtures. */
export function buildModel(bootstrap, fixtures) {
  const teams = {}; bootstrap.teams.forEach(t => { teams[t.id] = t; });
  const events = bootstrap.events || [];
  const cur = events.find(e => e.is_current), nxt = events.find(e => e.is_next);
  const currentGW = cur ? cur.id : nxt ? nxt.id - 1 : 0;
  const nextGW = nxt ? nxt.id : (events.find(e => !e.finished)?.id || null);
  const byTeamGW = {}; // teamId -> gw -> [fixture views]
  for (const f of fixtures || []) {
    if (!f.event) continue;
    (byTeamGW[f.team_h] ||= {})[f.event] ||= [];
    (byTeamGW[f.team_a] ||= {})[f.event] ||= [];
    byTeamGW[f.team_h][f.event].push({ gw: f.event, opponentId: f.team_a, opponent: teams[f.team_a]?.short_name || '?', home: true, difficulty: f.team_h_difficulty, finished: f.finished });
    byTeamGW[f.team_a][f.event].push({ gw: f.event, opponentId: f.team_h, opponent: teams[f.team_h]?.short_name || '?', home: false, difficulty: f.team_a_difficulty, finished: f.finished });
  }
  const start = nextGW || currentGW + 1;
  const upcoming = (teamId, n) => { const out = []; for (let gw = start; gw < start + 12 && out.length < n; gw++) for (const f of byTeamGW[teamId]?.[gw] || []) if (out.length < n) out.push(f); return out; };
  const gwFixtures = (teamId, gw) => byTeamGW[teamId]?.[gw] || [];

  const players = bootstrap.elements.filter(p => !p.removed).map(p => {
    const team = teams[p.team] || {};
    const uf = upcoming(p.team, 3);
    const avgFDR = uf.length ? uf.reduce((s, f) => s + f.difficulty, 0) / uf.length : 3;
    const next = gwFixtures(p.team, start);
    const xp = next.length ? projectFixtures(p, team, teams, [next[0]]) * next.length : 0;
    return {
      id: p.id, web_name: p.web_name, first_name: p.first_name, second_name: p.second_name,
      team: p.team, teamShort: team.short_name || '?', teamName: team.name || '?',
      pos: POS[p.element_type], element_type: p.element_type,
      price: p.now_cost / 10, form: parseFloat(p.form) || 0, total_points: p.total_points, event_points: p.event_points,
      selected: parseFloat(p.selected_by_percent) || 0, status: p.status, news: p.news || '',
      chance: p.chance_of_playing_next_round, ict: parseFloat(p.ict_index) || 0, minutes: p.minutes,
      xg90: parseFloat(p.expected_goals_per_90) || 0, xa90: parseFloat(p.expected_assists_per_90) || 0,
      transfers_in_event: p.transfers_in_event || 0, transfers_out_event: p.transfers_out_event || 0,
      cost_change_event: p.cost_change_event || 0,
      price_change_percent: p.price_change_percent != null ? parseFloat(p.price_change_percent) : null,
      xp: Math.round(xp * 10) / 10, avgFDR, upcoming: uf, raw: p,
    };
  });
  const byId = new Map(players.map(p => [p.id, p]));
  /** Per-GW projection for the next n gameweeks (handles blanks = 0 and doubles = sum). */
  const horizon = (pl, n = 5) => {
    const out = [];
    for (let gw = start; gw < start + n; gw++) {
      const fx = gwFixtures(pl.team, gw);
      const pts = fx.reduce((s, f) => s + projectFixtures(pl.raw, teams[pl.team], teams, [f], { useOfficial: gw === start }), 0);
      out.push({ gw, xp: Math.round(pts * 10) / 10, fixtures: fx.map(f => ({ opp: f.opponent, home: f.home, fdr: f.difficulty })) });
    }
    return out;
  };
  return { teams, players, byId, events, currentGW, nextGW, startGW: start, horizon, gwFixtures, deadline: nxt?.deadline_time || null };
}

/** Rank captain options from a squad (ids) with a simple confidence score (0-100). */
export function captainPicks(model, ids) {
  const opts = ids.map(id => model.byId.get(id)).filter(Boolean).map(p => ({ p, score: p.xp })).sort((a, b) => b.score - a.score);
  if (!opts.length) return [];
  const top = opts[0].score, second = opts[1]?.score || 0;
  return opts.slice(0, 5).map((o, i) => {
    const gap = i === 0 ? top - second : o.score - top;
    const conf = i === 0 ? Math.round(clampNum(55 + gap * 12 + (o.p.status === 'a' ? 5 : -15), 30, 95)) : Math.round(clampNum(45 + gap * 10, 5, 60));
    return { id: o.p.id, name: o.p.web_name, team: o.p.teamShort, xp: o.score, captainXp: Math.round(o.score * 20) / 10, confidence: conf };
  });
}

/** Best single transfers for a squad within bank, by projected gain over n GWs. */
export function suggestTransfers(model, ids, bank = 0, n = 3, limit = 5) {
  const squad = ids.map(id => model.byId.get(id)).filter(Boolean);
  const clubCount = {}; squad.forEach(p => { clubCount[p.team] = (clubCount[p.team] || 0) + 1; });
  const sum = p => model.horizon(p, n).reduce((s, g) => s + g.xp, 0);
  const pool = model.players.filter(p => p.status === 'a' && p.minutes > 90 && !ids.includes(p.id));
  const poolScored = pool.map(p => ({ p, s: sum(p) })).sort((a, b) => b.s - a.s).slice(0, 120);
  const out = [];
  for (const o of squad) {
    const os = sum(o);
    const best = poolScored.find(c => c.p.element_type === o.element_type && c.p.price <= o.price + bank + 1e-9 && ((clubCount[c.p.team] || 0) - (c.p.team === o.team ? 1 : 0)) < 3);
    if (best && best.s - os > 0.5) out.push({ out: { id: o.id, name: o.web_name, team: o.teamShort, price: o.price }, in: { id: best.p.id, name: best.p.web_name, team: best.p.teamShort, price: best.p.price }, gain: Math.round((best.s - os) * 10) / 10, horizon: n });
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, limit);
}

/** Price-change outlook from FPL's own progress fields, falling back to net transfers. */
export function priceOutlook(p) {
  const pct = p.price_change_percent;
  if (pct != null && !Number.isNaN(pct)) {
    if (pct >= 100) return { dir: 'up', label: 'Rise tonight likely', pct };
    if (pct <= -100) return { dir: 'down', label: 'Fall tonight likely', pct };
    if (pct >= 70) return { dir: 'up', label: `Rising · ${Math.round(pct)}%`, pct };
    if (pct <= -70) return { dir: 'down', label: `Falling · ${Math.round(-pct)}%`, pct };
    return { dir: 'flat', label: 'Stable', pct };
  }
  const net = (p.transfers_in_event || 0) - (p.transfers_out_event || 0);
  const owned = Math.max(1, p.selected * 120000);
  const ratio = net / owned;
  return ratio > .08 ? { dir: 'up', label: 'Rise possible', pct: ratio * 100 } : ratio < -.08 ? { dir: 'down', label: 'Fall possible', pct: ratio * 100 } : { dir: 'flat', label: 'Stable', pct: 0 };
}
