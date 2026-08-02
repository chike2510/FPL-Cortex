/**
 * /api/fixtures.js
 * Proxies the FPL fixtures endpoint.
 * Optional query param: ?event=GW_NUMBER to filter by gameweek.
 * Without ?event, returns ALL season fixtures.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Pull optional gameweek filter from query string
  const { event } = req.query;
  const url = event
    ? `https://fantasy.premierleague.com/api/fixtures/?event=${event}`
    : 'https://fantasy.premierleague.com/api/fixtures/';

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`FPL API responded with status: ${response.status}`);
    }

    const data = await response.json();

    // Map to lean fixture objects
    const fixtures = data.map((f) => ({
      id: f.id,
      event: f.event,                           // gameweek number
      team_h: f.team_h,                         // home team id
      team_a: f.team_a,                         // away team id
      team_h_difficulty: f.team_h_difficulty,   // FDR for home team
      team_a_difficulty: f.team_a_difficulty,   // FDR for away team
      team_h_score: f.team_h_score,
      team_a_score: f.team_a_score,
      kickoff_time: f.kickoff_time,
      started: f.started,
      finished: f.finished,
      finished_provisional: f.finished_provisional,
      minutes: f.minutes,
      stats: f.stats,                           // goals, assists, bonus etc.
    }));

    return res.status(200).json(fixtures);
  } catch (err) {
    console.error('[/api/fixtures] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch FPL fixtures', details: err.message });
  }
  }
      
