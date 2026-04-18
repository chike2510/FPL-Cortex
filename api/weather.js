/**
 * /api/weather.js
 * Server-side weather proxy — keeps WEATHER_KEY off the client.
 * GET /api/weather?lat=51.5&lon=-0.1
 * Reads WEATHER_API_KEY from Vercel environment variables.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Weather service not configured. Set WEATHER_API_KEY in Vercel env vars.' });
  }

  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon query params required' });
  }

  // Validate coords are numbers
  if (isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
    return res.status(400).json({ error: 'lat and lon must be numeric' });
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'FPL-Cortex/1.0' },
    });

    if (!response.ok) {
      throw new Error(`OpenWeatherMap responded with ${response.status}`);
    }

    const data = await response.json();

    // Return only what we need — no full payload passthrough
    return res.status(200).json({
      temp:        Math.round(data.main?.temp ?? 0),
      description: data.weather?.[0]?.description || '',
      main:        data.weather?.[0]?.main || 'Clear',
      wind_kph:    Math.round((data.wind?.speed ?? 0) * 3.6),
      humidity:    data.main?.humidity ?? 0,
    });

  } catch (err) {
    console.error('[/api/weather] Error:', err.message);
    return res.status(500).json({ error: 'Weather fetch failed', details: err.message });
  }
}
