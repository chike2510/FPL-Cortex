/** /api/news — server-side RSS aggregation (replaces the public allorigins proxy). Returns plain text only. */
export const config = { runtime: 'edge' };
const FEEDS = [
  { url: 'https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml', source: 'BBC Sport' },
  { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports' },
  { url: 'https://www.theguardian.com/football/premierleague/rss', source: 'The Guardian' },
  { url: 'https://www.espn.co.uk/espn/rss/soccer/news', source: 'ESPN' },
  { url: 'https://www.90min.com/feeds/latest.rss', source: '90min' },
];
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };

export default async function handler() {
  const results = await Promise.allSettled(FEEDS.map(async f => {
    const r = await fetch(f.url, { headers: { 'User-Agent': 'FPL-Cortex/2.0 RSS reader' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(String(r.status));
    const xml = await r.text();
    return (xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []).slice(0, 12).map(it => {
      const link = tag(it, 'link');
      return { title: tag(it, 'title').slice(0, 200), summary: tag(it, 'description').slice(0, 280), link: /^https:\/\//.test(link) ? link : '', date: tag(it, 'pubDate'), source: f.source };
    }).filter(i => i.title);
  }));
  const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, 40);
  return new Response(JSON.stringify({ ok: true, items, sources: FEEDS.map((f, i) => ({ source: f.source, ok: results[i].status === 'fulfilled' })) }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800' },
  });
}
