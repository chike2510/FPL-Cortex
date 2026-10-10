/**
 * /api/plus?route=captain|transfers|planner|league-recap&entry=ID[&league=ID] (Edge)
 * Plus features computed server-side with the shared xP model. Entitlement is checked here
 * from the verified Supabase JWT; the browser never decides who is Plus.
 * league-recap is unlocked by Plus OR an active league pack for that league (bought by the league admin).
 */
export const config = { runtime: 'edge' };
import { json, sameOrigin, clientIp } from './_lib/http.js';
import { entitlement, rest } from './_lib/supa.js';
import { rateLimit } from './_lib/ratelimit.js';
import { getModel, getSquad, fetchFpl } from './_lib/fpl.js';
import { captainPicks, suggestTransfers } from '../shared/xp.js';

async function leaguePackActive(leagueId) {
  try { const r = await rest(`league_packs?league_id=eq.${leagueId}&status=eq.active&select=period_end&limit=1`); return !!r?.length && (!r[0].period_end || Date.parse(r[0].period_end) > Date.now()); } catch { return false; }
}

async function leagueRecap(model, leagueId) {
  const st = await fetchFpl(`leagues-classic/${leagueId}/standings/`);
  if (!st.ok) return { error: 'League not found' };
  const gw = model.currentGW;
  const rows = (st.data.standings?.results || []).slice(0, 20);
  const squads = await Promise.all(rows.map(r => getSquad(r.entry, gw).catch(() => null)));
  const managers = rows.map((r, i) => {
    const s = squads[i]; const cap = s?.picks.find(p => p.is_captain); const capP = cap && model.byId.get(cap.element);
    const bench = s ? s.picks.filter(p => p.position > 11).reduce((t, p) => t + (model.byId.get(p.element)?.event_points || 0), 0) : 0;
    return { entry: r.entry, manager: r.player_name, team: r.entry_name, gw_points: r.event_total, total: r.total, rank: r.rank, last_rank: r.last_rank, captain: capP?.web_name || '—', captain_points: (capP?.event_points || 0) * (cap?.multiplier || 2), bench_points: bench, chip: s?.chip || null };
  });
  const by = (k, dir = -1) => [...managers].sort((a, b) => dir * (a[k] - b[k]))[0];
  const climber = [...managers].filter(m => m.last_rank).sort((a, b) => (b.last_rank - b.rank) - (a.last_rank - a.rank))[0];
  return {
    league: st.data.league?.name || `League ${leagueId}`, gw,
    awards: [
      { key: 'manager_of_week', title: 'Manager of the Week', winner: by('gw_points'), stat: by('gw_points')?.gw_points + ' pts' },
      { key: 'wooden_spoon', title: 'Wooden Spoon', winner: by('gw_points', 1), stat: by('gw_points', 1)?.gw_points + ' pts' },
      { key: 'captain_fantastic', title: 'Captain Fantastic', winner: by('captain_points'), stat: by('captain_points')?.captain + ' · ' + by('captain_points')?.captain_points + ' pts' },
      { key: 'bench_disaster', title: 'Bench Disaster', winner: by('bench_points'), stat: by('bench_points')?.bench_points + ' pts benched' },
      ...(climber ? [{ key: 'climber', title: 'Biggest Climber', winner: climber, stat: `▲ ${climber.last_rank - climber.rank} places` }] : []),
    ],
    managers,
  };
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403);
  if (!(await rateLimit(`plus:${clientIp(req)}`, 30, 60))) return json({ error: 'Slow down' }, 429);
  const url = new URL(req.url);
  const route = url.searchParams.get('route');
  const entry = (url.searchParams.get('entry') || '').replace(/\D/g, '');
  const league = (url.searchParams.get('league') || '').replace(/\D/g, '');
  const { user, plus } = await entitlement(req);

  if (route === 'league-recap') {
    if (!league) return json({ error: 'league required' }, 400);
    if (!plus && !(await leaguePackActive(league))) return json({ error: 'PLUS_REQUIRED', message: 'League recaps unlock with a League Pack (bought by your league admin) or Cortex Plus.' }, 402);
    return json(await leagueRecap(await getModel(), league));
  }
  if (!plus) return json({ error: user ? 'PLUS_REQUIRED' : 'SIGN_IN_REQUIRED', message: 'This is a Cortex Plus feature.' }, user ? 402 : 401);
  if (!entry) return json({ error: 'entry required' }, 400);
  const model = await getModel();
  const squad = await getSquad(entry, model.currentGW || model.startGW);
  if (!squad) return json({ error: 'Squad not found' }, 404);
  const ids = squad.picks.map(p => p.element);

  if (route === 'captain') return json({ gw: model.startGW, picks: captainPicks(model, ids.slice(0, 11)) });
  if (route === 'transfers') return json({ bank: squad.bank, horizon: 3, moves: suggestTransfers(model, ids, squad.bank, 3, 6) });
  if (route === 'planner') {
    const rows = ids.map(id => model.byId.get(id)).filter(Boolean).map(p => ({ id: p.id, name: p.web_name, team: p.teamShort, pos: p.pos, price: p.price, gws: model.horizon(p, 5) }));
    const gws = rows[0]?.gws.map(g => g.gw) || [];
    const chipHints = gws.map((gw, i) => {
      const doubles = rows.filter(r => r.gws[i].fixtures.length > 1).length, blanks = rows.filter(r => !r.gws[i].fixtures.length).length;
      const benchXp = rows.slice(11).reduce((s, r) => s + r.gws[i].xp, 0);
      return { gw, doubles, blanks, benchXp: Math.round(benchXp * 10) / 10, hint: doubles >= 4 ? 'Bench Boost / Triple Captain window' : blanks >= 4 ? 'Free Hit window' : '' };
    });
    return json({ gws, rows, chipHints, bank: squad.bank });
  }
  return json({ error: 'Unknown route' }, 404);
}
