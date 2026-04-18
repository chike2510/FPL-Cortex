/**
 * /api/proxy.js
 * First-party FPL API proxy — avoids CORS entirely since this runs server-side.
 * GET /api/proxy?path=/bootstrap-static/
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'path param required' });

  // Whitelist — only allow FPL API paths
  const safe = /^\/[\w\-\/\?=&%]+$/.test(path);
  if (!safe) return res.status(400).json({ error: 'Invalid path' });

  const FPL_BASE = 'https://fantasy.premierleague.com/api';
  const url = `${FPL_BASE}${path}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent':    'Mozilla/5.0 (compatible; FPL-Cortex/1.0)',
        'Accept':        'application/json',
        'Referer':       'https://fantasy.premierleague.com/',
        'Origin':        'https://fantasy.premierleague.com',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `FPL API ${upstream.status}` });
    }

    const data = await upstream.json();

    // Cache aggressively at the edge — FPL bootstrap rarely changes mid-GW
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json(data);

  } catch (err) {
    console.error('[/api/proxy] Error:', err.message);
    return res.status(502).json({ error: 'Upstream fetch failed', details: err.message });
  }
}
