/**
 * /api/players.js
 * Proxies the FPL bootstrap-static endpoint to avoid browser CORS issues.
 * Returns full player list, teams, element types, and current gameweek info.
 */

export default async function handler(req, res) {
  // Allow all origins (needed for browser fetch from any domain)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const response = await fetch(
      'https://fantasy.premierleague.com/api/bootstrap-static/',
      {
        headers: {
          // Mimic a browser request so FPL doesn't block us
          'User-Agent': 'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`FPL API responded with status: ${response.status}`);
    }

    const data = await response.json();

    // Only return the fields we need to keep payload small
    const payload = {
      elements: data.elements.map((p) => ({
        id: p.id,
        first_name: p.first_name,
        second_name: p.second_name,
        web_name: p.web_name,
        team: p.team,
        element_type: p.element_type,           // 1=GKP 2=DEF 3=MID 4=FWD
        now_cost: p.now_cost,                   // divide by 10 for £
        form: p.form,                           // rolling avg pts
        total_points: p.total_points,
        selected_by_percent: p.selected_by_percent,
        minutes: p.minutes,
        goals_scored: p.goals_scored,
        assists: p.assists,
        clean_sheets: p.clean_sheets,
        goals_conceded: p.goals_conceded,
        yellow_cards: p.yellow_cards,
        red_cards: p.red_cards,
        ep_next: p.ep_next,                     // expected pts next GW
        ep_this: p.ep_this,
        chance_of_playing_next_round: p.chance_of_playing_next_round,
        chance_of_playing_this_round: p.chance_of_playing_this_round,
        news: p.news,
        news_added: p.news_added,
        transfers_in_event: p.transfers_in_event,
        transfers_out_event: p.transfers_out_event,
        value_form: p.value_form,
        value_season: p.value_season,
        points_per_game: p.points_per_game,
        bonus: p.bonus,
        bps: p.bps,
        influence: p.influence,
        creativity: p.creativity,
        threat: p.threat,
        ict_index: p.ict_index,
      })),
      teams: data.teams.map((t) => ({
        id: t.id,
        name: t.name,
        short_name: t.short_name,
        strength: t.strength,
        strength_overall_home: t.strength_overall_home,
        strength_overall_away: t.strength_overall_away,
        strength_attack_home: t.strength_attack_home,
        strength_attack_away: t.strength_attack_away,
        strength_defence_home: t.strength_defence_home,
        strength_defence_away: t.strength_defence_away,
      })),
      element_types: data.element_types.map((et) => ({
        id: et.id,
        singular_name_short: et.singular_name_short, // GKP, DEF, MID, FWD
        singular_name: et.singular_name,
      })),
      events: data.events.map((e) => ({
        id: e.id,
        name: e.name,
        deadline_time: e.deadline_time,
        is_current: e.is_current,
        is_next: e.is_next,
        is_previous: e.is_previous,
        average_entry_score: e.average_entry_score,
        highest_score: e.highest_score,
        finished: e.finished,
        data_checked: e.data_checked,
      })),
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error('[/api/players] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch FPL player data', details: err.message });
  }
}
