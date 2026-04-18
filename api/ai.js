/**
 * /api/ai.js
 * Server-side Claude AI proxy — keeps API key off the client entirely.
 * POST body: { messages: [...], system?: string, max_tokens?: number }
 * Reads ANTHROPIC_API_KEY from Vercel environment variables.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI service not configured. Set ANTHROPIC_API_KEY in Vercel env vars.' });
  }

  const { messages, system, max_tokens = 600 } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Sanitise: only allow role/content keys, max 20 messages, content max 4000 chars each
  const safeMessages = messages.slice(-20).map(m => ({
    role:    m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000),
  }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',   // fast + cheap for chat
        max_tokens: Math.min(max_tokens, 1000),
        system:     system || 'You are an expert FPL (Fantasy Premier League) analyst. Be concise, data-driven, and actionable. Format responses for a mobile UI — short paragraphs, no markdown headers.',
        messages:   safeMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[/api/ai] Claude API error:', response.status, err);
      return res.status(502).json({ error: 'AI service error', details: err?.error?.message || response.statusText });
    }

    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '';

    return res.status(200).json({ reply: text, usage: data.usage });

  } catch (err) {
    console.error('[/api/ai] Error:', err.message);
    return res.status(500).json({ error: 'AI request failed', details: err.message });
  }
}
