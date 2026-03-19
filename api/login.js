/**
 * /api/login.js
 * Proxies FPL login so credentials never leave the backend.
 * Returns session cookies + user entry_id on success.
 * POST body: { email, password }
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required' });

  try {
    // Step 1 — Authenticate with Premier League identity service
    const loginRes = await fetch('https://users.premierleague.com/accounts/login/', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'User-Agent':    'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
        'Origin':        'https://fantasy.premierleague.com',
        'Referer':       'https://fantasy.premierleague.com/',
      },
      body: new URLSearchParams({
        login:        email,
        password:     password,
        app:          'plfpl-web',
        redirect_uri: 'https://fantasy.premierleague.com/a/identify/user',
      }).toString(),
      redirect: 'manual', // don't follow — we need the cookies from this response
    });

    // Collect all Set-Cookie headers
    const rawCookies = loginRes.headers.getSetCookie?.() || [];
    if (rawCookies.length === 0)
      return res.status(401).json({ error: 'Login failed — check your email and password' });

    // Build a single cookie string for future requests
    const cookieStr = rawCookies
      .map(c => c.split(';')[0]) // keep only name=value, strip path/expires etc.
      .join('; ');

    // Step 2 — Fetch /api/me/ to get the entry (team) ID
    const meRes = await fetch('https://fantasy.premierleague.com/api/me/', {
      headers: {
        'Cookie':     cookieStr,
        'User-Agent': 'Mozilla/5.0 (compatible; FPL-Helper/1.0)',
      },
    });

    if (!meRes.ok)
      return res.status(401).json({ error: 'Authenticated but could not fetch user profile' });

    const me = await meRes.json();
    const entryId = me?.player?.entry;

    if (!entryId)
      return res.status(200).json({
        cookie:  cookieStr,
        entryId: null,
        player:  me?.player || null,
        warning: 'No FPL team found for this account — you may not have registered a team yet',
      });

    return res.status(200).json({
      cookie:  cookieStr,
      entryId,
      player:  me?.player || null,
    });

  } catch (err) {
    console.error('[/api/login] Error:', err.message);
    return res.status(500).json({ error: 'Login request failed', details: err.message });
  }
          }
        
