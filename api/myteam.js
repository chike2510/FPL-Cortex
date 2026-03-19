/**
 * /api/myteam.js
 * Fetches the authenticated user's current GW team picks.
 * Requires query params: ?entry=ENTRY_ID&gw=GW_NUMBER
 * Requires header: x-fpl-cookie: <cookie string from /api/login>
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fpl-cookie');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { entry, gw } = req.query;
  const cookie = req.headers['x-fpl-cookie'] || '';

  if (!entry) return res.status(400).json({ error: 'Missing ?entry= parameter' });

  try {
    // Fetch the team picks for a specific GW (or current picks from my-team endpoint)
    const url = gw
      ? `https://fantasy.premierleague.com/api/entry/${entry}/event/${gw}/picks/`
      : `https://fantasy.premierleague.com/api/my-team/${entry}/`;

    const teamRes = await fetch(url, {
      headers: {
        'Cookie':     cookie,
        'User-Agent': 'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
        'Accept':     'application/json',
      },
    });

    if (!teamRes.ok) throw new Error(`FPL API ${teamRes.status}`);
    const data = await teamRes.json();

    // Also fetch entry info (team name, overall rank, etc.)
    const entryRes = await fetch(`https://fantasy.premierleague.com/api/entry/${entry}/`, {
      headers: {
        'Cookie':     cookie,
        'User-Agent': 'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
      },
    });
    const entryData = entryRes.ok ? await entryRes.json() : null;

    return res.status(200).json({
      picks:   data.picks  || [],
      chips:   data.active_chip || null,
      entry:   entryData,
    });

  } catch (err) {
    console.error('[/api/myteam] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch team', details: err.message });
  }
      }
        
