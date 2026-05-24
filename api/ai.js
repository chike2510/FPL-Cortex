/**
 * /api/ai.js
 * Groq AI proxy — fast, free tier, OpenAI-compatible API
 * POST body: { messages: [...], system?: string, max_tokens?: number }
 * Reads GROQ_API_KEY from Vercel environment variables.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI service not configured. Set GROQ_API_KEY in Vercel env vars.' });
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

  // Build messages array with system message prepended (Groq supports system role)
  const fullMessages = system
    ? [{ role: 'system', content: system }, ...safeMessages]
    : safeMessages;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:      'llama-3.3-70b-versatile',  // Best free-tier model on Groq
        max_tokens: Math.min(max_tokens, 1000),
        messages:   fullMessages,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[/api/ai] Groq API error:', response.status, err);
      return res.status(502).json({ error: 'AI service error', details: err?.error?.message || response.statusText });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    return res.status(200).json({ reply: text, usage: data.usage });

  } catch (err) {
    console.error('[/api/ai] Error:', err.message);
    return res.status(500).json({ error: 'AI request failed', details: err.message });
  }
}
