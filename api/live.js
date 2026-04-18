/**
 * /api/live.js
 * Proxies the FPL live event endpoint for a specific gameweek.
 * Required query param: ?gw=GAMEWEEK_NUMBER
 * Returns live player points and stats for that gameweek.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { gw } = req.query;

  if (!gw || isNaN(parseInt(gw))) {
    return res.status(400).json({ error: 'Missing or invalid ?gw= query parameter' });
  }

  const gwNum = parseInt(gw);
  if (gwNum < 1 || gwNum > 38) {
    return res.status(400).json({ error: 'Gameweek must be between 1 and 38' });
  }

  try {
    const response = await fetch(
      `https://fantasy.premierleague.com/api/event/${gwNum}/live/`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`FPL API responded with status: ${response.status}`);
    }

    const data = await response.json();

    /**
     * Live data structure from FPL:
     * { elements: [ { id, stats: { minutes, goals_scored, assists, clean_sheets,
     *   goals_conceded, own_goals, penalties_saved, penalties_missed,
     *   yellow_cards, red_cards, saves, bonus, bps, total_points }, explain: [] } ] }
     */
    const liveMap = {};
    for (const element of data.elements) {
      liveMap[element.id] = {
        id: element.id,
        stats: element.stats,
        explain: element.explain, // breakdown of how points were earned
      };
    }

    return res.status(200).json({ gw: gwNum, elements: liveMap });
  } catch (err) {
    console.error('[/api/live] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch live GW data', details: err.message });
  }
  }
  
