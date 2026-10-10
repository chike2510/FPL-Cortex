/**
 * /api/og — shareable team card (Edge, @vercel/og).
 *   image: /api/og?t=Team&m=Manager&gw=7&pts=64&rank=120000&xi=Raya:GKP:ARS:6,Saka:MID:ARS:12,...
 *   share page (for WhatsApp/X previews): same params + &format=html
 *   award card: &type=award&title=Manager%20of%20the%20Week&winner=Name&stat=88%20pts&league=Office
 */
export const config = { runtime: 'edge' };
import { ImageResponse } from '@vercel/og';
import { kitColour } from '../shared/kits.js';

const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter(c => c !== null && c !== undefined && c !== false) } });
const clean = (s, n = 40) => String(s || '').replace(/[<>]/g, '').slice(0, n);
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function teamCard(q) {
  const xi = clean(q.get('xi'), 600).split(',').slice(0, 11).map(s => { const [name, pos, team, pts] = s.split(':'); return { name: clean(name, 14), pos: clean(pos, 3), team: clean(team, 3), pts: clean(pts, 3) }; }).filter(p => p.name);
  const rows = ['GKP', 'DEF', 'MID', 'FWD'].map(pos => xi.filter(p => p.pos === pos));
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: '#0B1220', color: '#F8FAFC', padding: 48, fontFamily: 'sans-serif' },
    h('div', { justifyContent: 'space-between', alignItems: 'flex-end' },
      h('div', { flexDirection: 'column' }, h('div', { fontSize: 26, color: '#94A3B8' }, `Gameweek ${clean(q.get('gw'), 3)} · ${clean(q.get('m'))}`), h('div', { fontSize: 52, fontWeight: 700 }, clean(q.get('t')) || 'My FPL team')),
      h('div', { flexDirection: 'column', alignItems: 'flex-end' }, h('div', { fontSize: 96, fontWeight: 800, color: '#A3E635', lineHeight: 1 }, clean(q.get('pts'), 4) || '—'), h('div', { fontSize: 24, color: '#94A3B8' }, q.get('rank') ? `Rank ${Number(q.get('rank')).toLocaleString('en-GB')}` : 'points'))),
    h('div', { flex: 1, flexDirection: 'column', justifyContent: 'space-around', marginTop: 24, background: '#0F2A1D', borderRadius: 16, padding: 16 },
      ...rows.map(r => h('div', { justifyContent: 'center', gap: 18 }, ...r.map(p => h('div', { flexDirection: 'column', alignItems: 'center', width: 150 },
        h('div', { width: 54, height: 54, borderRadius: 16, background: kitColour(p.team), border: '3px solid rgba(255,255,255,.7)' }),
        h('div', { fontSize: 22, marginTop: 6, background: '#0B1220', padding: '2px 10px', borderRadius: 16 }, p.name),
        h('div', { fontSize: 20, color: '#A3E635' }, p.pts ? `${p.pts} pts` : p.team)))))),
    h('div', { justifyContent: 'space-between', marginTop: 16, fontSize: 20, color: '#64748B' }, h('div', {}, 'FPL Cortex · fpl-cortex.vercel.app'), h('div', {}, 'Unofficial · not affiliated with the Premier League or FPL')));
}

function awardCard(q) {
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#0B1220', color: '#F8FAFC', fontFamily: 'sans-serif', padding: 60 },
    h('div', { fontSize: 28, color: '#94A3B8' }, `${clean(q.get('league'))} · GW ${clean(q.get('gw'), 3)}`),
    h('div', { fontSize: 64, fontWeight: 800, color: '#A3E635', marginTop: 12 }, clean(q.get('title'))),
    h('div', { fontSize: 56, fontWeight: 700, marginTop: 24 }, clean(q.get('winner'))),
    h('div', { fontSize: 36, color: '#CBD5E1', marginTop: 12 }, clean(q.get('stat'), 60)),
    h('div', { fontSize: 20, color: '#64748B', marginTop: 48 }, 'League recap by FPL Cortex · unofficial'));
}

export default async function handler(req) {
  const url = new URL(req.url);
  const q = url.searchParams;
  if (q.get('format') === 'html') {
    const img = new URL(url); img.searchParams.delete('format');
    const title = q.get('type') === 'award' ? `${clean(q.get('title'))}: ${clean(q.get('winner'))}` : `${clean(q.get('t')) || 'My FPL team'} scored ${clean(q.get('pts'), 4)} in GW${clean(q.get('gw'), 3)}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title><meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="Built with FPL Cortex, the unofficial FPL analyst."><meta property="og:image" content="${escHtml(img.toString())}"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=/"></head><body><a href="/">Open FPL Cortex</a></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=86400' } });
  }
  return new ImageResponse(q.get('type') === 'award' ? awardCard(q) : teamCard(q), { width: 1200, height: 630, headers: { 'Cache-Control': 'public, s-maxage=86400, immutable' } });
}
