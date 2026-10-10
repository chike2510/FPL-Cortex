// Generic kit colours by club short name (our own simple shirt drawings, not club/PL artwork).
export const KIT = {
  ARS: ['#EF0107', '#FFFFFF', 'sleeves'], AVL: ['#670E36', '#95BFE5', 'sleeves'], BOU: ['#DA291C', '#000000', 'stripes'],
  BRE: ['#E30613', '#FFFFFF', 'stripes'], BHA: ['#0057B8', '#FFFFFF', 'stripes'], CHE: ['#034694', '#FFFFFF', 'plain'],
  COV: ['#87CEEB', '#FFFFFF', 'plain'], CRY: ['#1B458F', '#C4122E', 'stripes'], EVE: ['#003399', '#FFFFFF', 'plain'],
  FUL: ['#FFFFFF', '#000000', 'plain'], HUL: ['#F5A12D', '#000000', 'stripes'], IPS: ['#0044A9', '#FFFFFF', 'plain'],
  LEE: ['#FFFFFF', '#1D428A', 'plain'], LIV: ['#C8102E', '#F6EB61', 'plain'], MCI: ['#6CABDD', '#FFFFFF', 'plain'],
  MUN: ['#DA291C', '#FBE122', 'plain'], NEW: ['#241F20', '#FFFFFF', 'stripes'], NFO: ['#DD0000', '#FFFFFF', 'plain'],
  TOT: ['#FFFFFF', '#132257', 'plain'], SUN: ['#EB172B', '#FFFFFF', 'stripes'], WOL: ['#FDB913', '#231F20', 'plain'],
  WHU: ['#7A263A', '#1BB1E7', 'sleeves'], BUR: ['#6C1D45', '#99D6EA', 'sleeves'], LEI: ['#003090', '#FDBE11', 'plain'], SOU: ['#D71920', '#FFFFFF', 'stripes'],
};
export const GK = ['#2DD4BF', '#0F172A', 'plain'];

function hashColour(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 60% 45%)`; }

/** Returns an SVG string of a generic shirt. Colours only; safe to inline. */
export function kitSvg(short, isGk = false, size = 64) {
  const [p, s, style] = isGk ? GK : (KIT[short] || [hashColour(short), '#FFFFFF', 'plain']);
  const id = `k${short}${isGk ? 'g' : ''}`;
  const body = 'M18 6 L26 2 Q32 7 38 2 L46 6 L60 16 L53 28 L46 24 L46 60 L18 60 L18 24 L11 28 L4 16 Z';
  const stripes = style === 'stripes' ? `<g clip-path="url(#${id})">${[22, 30, 38].map(x => `<rect x="${x}" y="0" width="4" height="64" fill="${s}"/>`).join('')}</g>` : '';
  const sleeves = style === 'sleeves' ? `<path d="M4 16 L18 6 L18 24 L11 28 Z M60 16 L46 6 L46 24 L53 28 Z" fill="${s}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs><path d="${body}" fill="${p}" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>${stripes}${sleeves}<path d="M26 2 Q32 9 38 2" fill="none" stroke="${s}" stroke-width="2"/></svg>`;
}
export const kitColour = short => (KIT[short] || [hashColour(short)])[0];
