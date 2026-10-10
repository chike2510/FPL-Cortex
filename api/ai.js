/**
 * /api/ai — Cortex AI analyst (Edge). Groq llama-3.3-70b with tool calling over live FPL data.
 * Locked down: same-origin only, per-IP rate limit, free tier = 3 questions per gameweek,
 * Plus (verified server-side via Supabase JWT + subscriptions table) = unlimited (fair-use rate limit).
 * POST { messages:[{role,content}], entryId?: number, mode?: 'chat'|'recap' }
 */
export const config = { runtime: 'edge' };
import { json, env, clientIp, sameOrigin } from './_lib/http.js';
import { entitlement } from './_lib/supa.js';
import { rateLimit, quotaUsed, quotaConsume } from './_lib/ratelimit.js';
import { getModel, getSquad, findPlayer, fetchFpl } from './_lib/fpl.js';
import { captainPicks, suggestTransfers } from '../shared/xp.js';

const FREE_PER_GW = 3;
const PREFERRED = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-20b'];
let modelId = null;
async function pickModel(force = false) {
  if (modelId && !force) return modelId;
  if (env('GROQ_MODEL') && !force) return (modelId = env('GROQ_MODEL'));
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${env('GROQ_API_KEY')}` } });
    const ids = ((await r.json()).data || []).map(m => m.id);
    modelId = PREFERRED.find(m => ids.includes(m)) || ids.find(i => !/whisper|guard|tts|playai/i.test(i)) || PREFERRED[0];
  } catch { modelId = PREFERRED[0]; }
  return modelId;
}

const TOOLS = [
  { type: 'function', function: { name: 'get_player', description: 'Live FPL stats, price, form, ownership, injury news, projected points (xP) and next 5 fixtures for one player.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Player web name, e.g. "Salah"' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'get_fixtures', description: 'Upcoming fixtures with difficulty (FDR 1-5) for a Premier League team.', parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team short name (ARS) or name' }, gameweeks: { type: 'integer', description: 'How many gameweeks ahead (1-8)' } }, required: ['team'] } } },
  { type: 'function', function: { name: 'get_my_squad', description: "The user's current FPL squad (15 players with xP), bank, captain options and suggested transfers. Only works if the user linked a Team ID.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'compare_players', description: 'Side-by-side comparison of 2-4 players over the next 5 gameweeks.', parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } } },
];

const brief = (m, p) => p && ({ name: p.web_name, team: p.teamShort, pos: p.pos, price: p.price, form: p.form, total_points: p.total_points, owned_pct: p.selected, status: p.status, news: p.news || undefined, xp_next: p.xp, next5: m.horizon(p, 5).map(g => ({ gw: g.gw, xp: g.xp, vs: g.fixtures.map(f => `${f.home ? '' : '@'}${f.opp}(${f.fdr})`).join('+') || 'BLANK' })) });

async function runTool(name, args, ctx) {
  const m = await getModel();
  if (name === 'get_player') { const p = findPlayer(m, args.name); return p ? brief(m, p) : { error: `No player matching "${args.name}"` }; }
  if (name === 'compare_players') return (args.names || []).slice(0, 4).map(n => brief(m, findPlayer(m, n)) || { error: `No player "${n}"` });
  if (name === 'get_fixtures') {
    const q = String(args.team || '').toLowerCase();
    const t = Object.values(m.teams).find(t => t.short_name.toLowerCase() === q || t.name.toLowerCase().includes(q));
    if (!t) return { error: `Unknown team "${args.team}"` };
    const n = Math.max(1, Math.min(8, Number(args.gameweeks) || 5)); const out = [];
    for (let gw = m.startGW; gw < m.startGW + n; gw++) out.push({ gw, fixtures: m.gwFixtures(t.id, gw).map(f => ({ opp: f.opponent, home: f.home, fdr: f.difficulty })) });
    return { team: t.name, fixtures: out };
  }
  if (name === 'get_my_squad') {
    if (!ctx.entryId) return { error: 'User has not linked an FPL Team ID in Cortex.' };
    const s = await getSquad(ctx.entryId, m.currentGW || m.startGW);
    if (!s) return { error: 'Could not load that squad.' };
    const ids = s.picks.map(p => p.element);
    return { bank: s.bank, gw_points: s.points, overall_rank: s.rank, squad: s.picks.map(pk => ({ ...brief(m, m.byId.get(pk.element)), next5: undefined, captain: pk.is_captain || undefined, bench: pk.position > 11 || undefined })), captain_options: captainPicks(m, ids.slice(0, 11)).slice(0, 3), transfer_ideas: suggestTransfers(m, ids, s.bank, 3, 3) };
  }
  return { error: 'Unknown tool' };
}

async function groq(messages, maxTokens, tools = true, retry = true) {
  const model = await pickModel();
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('GROQ_API_KEY')}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.4, ...(tools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }),
    signal: AbortSignal.timeout(25000),
  });
  if ((r.status === 404 || r.status === 400) && retry) { await pickModel(true); return groq(messages, maxTokens, tools, false); }
  if (!r.ok) throw new Error(`GROQ_${r.status}`);
  return r.json();
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403);
  if (!env('GROQ_API_KEY')) return json({ error: 'AI not configured (GROQ_API_KEY).' }, 503);
  const ip = clientIp(req);
  if (!(await rateLimit(`ai:${ip}`, 8, 60))) return json({ error: 'Too many requests. Try again in a minute.' }, 429);

  let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const msgs = Array.isArray(body?.messages) ? body.messages.slice(-10).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 1500) })) : [];
  if (!msgs.length) return json({ error: 'messages required' }, 400);

  const { user, plus } = await entitlement(req);
  let gw = 0; try { gw = (await getModel()).startGW; } catch { gw = Math.floor(Date.now() / 6048e5); }
  const who = user ? `u:${user.id}` : `ip:${ip}`;
  if (!plus) {
    const used = await quotaUsed(who, gw);
    if (used >= FREE_PER_GW) return json({ error: 'FREE_LIMIT', message: `Free plan includes ${FREE_PER_GW} questions per gameweek. Cortex Plus makes Ask unlimited.`, remaining: 0, plus: false }, 402);
  } else if (!(await rateLimit(`aiplus:${user.id}`, 60, 3600))) return json({ error: 'Fair-use limit reached for this hour.' }, 429);

  const ctx = { entryId: String(body.entryId || '').replace(/\D/g, '').slice(0, 10) };
  const system = `You are Cortex, a concise Fantasy Premier League analyst. Today is ${new Date().toISOString().slice(0, 10)}; the next deadline is gameweek ${gw}. Always ground claims in tool results; call tools for any player, fixture or squad fact instead of guessing. Give a clear recommendation first, then 2-4 short reasons with numbers (xP, FDR, form, price). ${body.mode === 'recap' ? 'Write a punchy weekly recap of the manager\'s gameweek: score, best and worst picks, captain verdict, one move for next week. Under 120 words.' : 'Keep answers under 160 words.'} Cortex is unofficial and not affiliated with the Premier League or FPL.`;
  const maxTokens = plus ? 700 : 450;
  const convo = [{ role: 'system', content: system }, ...msgs];

  try {
    let out;
    for (let round = 0; round < 3; round++) {
      out = await groq(convo, maxTokens, true);
      const msg = out.choices?.[0]?.message;
      if (!msg?.tool_calls?.length) break;
      convo.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls.slice(0, 4)) {
        let args = {}; try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* */ }
        let result; try { result = await runTool(call.function.name, args, ctx); } catch (e) { result = { error: 'Data temporarily unavailable' }; }
        convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      }
      if (round === 2) out = await groq(convo, maxTokens, false);
    }
    const reply = out?.choices?.[0]?.message?.content || 'No answer this time.';
    let remaining = null;
    if (!plus) remaining = Math.max(0, FREE_PER_GW - (await quotaConsume(who, gw)));
    return json({ reply, remaining, plus });
  } catch (e) {
    return json({ error: 'AI request failed', details: String(e.message).slice(0, 80) }, 502);
  }
}
