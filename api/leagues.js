/**
 * /api/leagues.js
 * Fetches league standings for a given classic or H2H league.
 * GET /api/leagues?type=classic&id=LEAGUE_ID  → classic standings
 * GET /api/leagues?type=h2h&id=LEAGUE_ID      → H2H standings
 * GET /api/leagues?entry=ENTRY_ID             → list of user's leagues
 * Header: x-fpl-cookie: <session cookie>
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fpl-cookie');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, id, entry, page } = req.query;
  const cookie = req.headers['x-fpl-cookie'] || '';
  const pageNum = parseInt(page || '1');

  try {
    // — List a user's leagues via their entry profile
    if (entry && !id) {
      const entryRes = await fetch(
        `https://fantasy.premierleague.com/api/entry/${entry}/`,
        {
          headers: {
            'Cookie':     cookie,
            'User-Agent': 'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
          },
        }
      );
      if (!entryRes.ok) throw new Error(`Entry fetch failed: ${entryRes.status}`);
      const entryData = await entryRes.json();

      return res.status(200).json({
        classic: entryData?.leagues?.classic || [],
        h2h:     entryData?.leagues?.h2h     || [],
        cup:     entryData?.leagues?.cup      || [],
      });
    }

    // — Fetch standings for a specific league
    if (!id) return res.status(400).json({ error: 'Missing ?id= parameter' });

    const leagueType = type === 'h2h' ? 'leagues-h2h' : 'leagues-classic';
    const url = `https://fantasy.premierleague.com/api/${leagueType}/${id}/standings/?page_standings=${pageNum}`;

    const standRes = await fetch(url, {
      headers: {
        'Cookie':     cookie,
        'User-Agent': 'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
        'Accept':     'application/json',
      },
    });

    if (!standRes.ok) throw new Error(`Standings fetch failed: ${standRes.status}`);
    const data = await standRes.json();

    return res.status(200).json({
      league:   data.league   || null,
      standings: type === 'h2h'
        ? data.standings?.results || []
        : data.standings?.results || [],
      has_next: data.standings?.has_next || false,
      page:     pageNum,
    });

  } catch (err) {
    console.error('[/api/leagues] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch leagues', details: err.message });
  }
          }
      
