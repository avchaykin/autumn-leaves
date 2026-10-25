// Leaf silhouettes per genus, drawn as SVG in a 40×40 box (stem at the
// bottom). leafSvg(genus, fill) returns markup filled with the leaf's
// current colour; veins are drawn in a darker shade of the same colour.

import { mixHex } from './color.js';

const r = (v) => Math.round(v * 10) / 10;

// Simple leaf blade: an ellipse-like outline from base (x, y) pointing at
// angle `a` (degrees, 0 = up), length L, half-width W, tip sharpness.
function blade(x, y, a, L, W, { tip = 0.5, base = 0.5 } = {}) {
  const rad = (a * Math.PI) / 180;
  const ux = Math.sin(rad), uy = -Math.cos(rad);  // along the leaf
  const px = -uy, py = ux;                         // perpendicular
  const P = (t, s) => `${r(x + ux * L * t + px * s)},${r(y + uy * L * t + py * s)}`;
  return `M${P(0, 0)}C${P(base * 0.3, W)} ${P(1 - tip * 0.6, W)} ${P(1, 0)}C${P(1 - tip * 0.6, -W)} ${P(base * 0.3, -W)} ${P(0, 0)}Z`;
}

// Pinnate compound leaf: leaflets in pairs along a rachis + terminal leaflet.
function pinnate(pairs, L, W, opts) {
  const parts = [];
  const top = 4, bottom = 37;
  for (let i = 0; i < pairs; i++) {
    const y = bottom - 6 - (i * (bottom - 6 - top - L * 0.8)) / Math.max(1, pairs - 1);
    parts.push(blade(20, y, -62, L, W, opts), blade(20, y, 62, L, W, opts));
  }
  parts.push(blade(20, top + L, 0, L, W, opts));
  return { d: parts.join(''), veins: `M20,${bottom}L20,${top + L * 0.4}` };
}

// Palmate compound leaf: leaflets radiating from one point.
function palmate(n, L, W, spread, opts) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(blade(20, 27, -spread / 2 + (spread * i) / (n - 1), L * (1 - Math.abs(i - (n - 1) / 2) * 0.12), W, opts));
  return { d: parts.join(''), veins: 'M20,38L20,27' };
}

// Bundle of needles.
function needles(n, L, spread, { y = 32, cluster = false } = {}) {
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = ((-spread / 2 + (spread * i) / Math.max(1, n - 1)) * Math.PI) / 180;
    const x0 = cluster ? 20 : 20, y0 = cluster ? y : y - (i % 2) * 2;
    lines.push(`M${x0},${y0}L${r(x0 + Math.sin(a) * L)},${r(y0 - Math.cos(a) * L)}`);
  }
  return { needles: lines.join(''), veins: `M20,38L20,${y}` };
}

// Spruce / fir style shoot: twig with short needles along it.
function shoot(len, density, angle) {
  const lines = ['M20,38L20,' + (38 - len)];
  for (let i = 0; i < density; i++) {
    const y = 36 - (i * len) / density;
    const l = 5;
    lines.push(`M20,${r(y)}l${r(-Math.sin(angle) * l)},${r(-Math.cos(angle) * l)}`, `M20,${r(y)}l${r(Math.sin(angle) * l)},${r(-Math.cos(angle) * l)}`);
  }
  return { needles: lines.join(''), veins: '' };
}

const SHAPES = {
  Quercus: {
    // lobed oak leaf
    d: 'M20,37C19,34 19,33 18,31C14,32 13,30 15,28C11,28 10,25 14,24C10,22 11,19 15,19C12,16 14,13 17,15C16,11 18,8 20,4C22,8 24,11 23,15C26,13 28,16 25,19C29,19 30,22 26,24C30,25 29,28 25,28C27,30 26,32 22,31C21,33 21,34 20,37Z',
    veins: 'M20,36L20,7M20,29L16,26M20,25L15,21M20,20L17,16M20,29L24,26M20,25L25,21M20,20L23,16',
    sx: 1.35,
  },
  Fagus: {
    d: blade(20, 37, 0, 31, 9.5, { tip: 0.45, base: 0.6 }),
    veins: 'M20,37L20,8M20,31L14,27M20,26L13.5,22M20,21L14.5,17M20,16L16,13M20,31L26,27M20,26L26.5,22M20,21L25.5,17M20,16L24,13',
  },
  Carpinus: {
    d: 'M20,37C19,35 18,34 18,33C13,31 11,26 12,21C12,15 16,10 20,5C24,10 28,15 28,21C29,26 27,31 22,33C22,34 21,35 20,37Z',
    veins: 'M20,36L20,7M20,30L14,27M20,26L13,23M20,22L13.5,19M20,18L15,15M20,30L26,27M20,26L27,23M20,22L26.5,19M20,18L25,15',
    serrate: true,
  },
  Acer: {
    // five-lobed maple
    d: 'M20,37L20,30C17,31 15,32 11,31L13,28C9,27 6,25 5,22C8,22 10,21 11,19C9,17 8,14 8,11C11,13 14,14 16,15C16,11 18,7 20,4C22,7 24,11 24,15C26,14 29,13 32,11C32,14 31,17 29,19C30,21 32,22 35,22C34,25 31,27 27,28L29,31C25,32 23,31 20,30Z',
    veins: 'M20,36L20,7M20,29L9,13M20,29L31,13M20,29L7,22M20,29L33,22',
  },
  Platanus: {
    d: 'M20,37L20,31C16,32 13,32 9,30L11,27C7,25 5,22 5,19C8,20 11,20 13,19C11,16 11,13 12,9C15,11 17,13 18,15C18,11 19,8 20,5C21,8 22,11 22,15C23,13 25,11 28,9C29,13 29,16 27,19C29,20 32,20 35,19C35,22 33,25 29,27L31,30C27,32 24,32 20,31Z',
    veins: 'M20,36L20,8M20,30L12,11M20,30L28,11M20,30L7,20M20,30L33,20',
  },
  Liquidambar: {
    d: 'M20,37L20,30L12,32L13,27L5,24L12,21L8,13L16,16L20,5L24,16L32,13L28,21L35,24L27,27L28,32L20,30Z',
    veins: 'M20,36L20,8M20,29L10,15M20,29L30,15M20,29L7,24M20,29L33,24',
  },
  Betula: {
    // triangular, serrated, pointed
    d: 'M20,37L20,32C15,32 10,31 10,28C11,22 16,13 20,6C24,13 29,22 30,28C30,31 25,32 20,32Z',
    veins: 'M20,36L20,8M20,29L13,27M20,25L14,22M20,21L16,17M20,29L27,27M20,25L26,22M20,21L24,17',
    serrate: true,
  },
  Populus: {
    d: 'M20,37L20,31C14,32 8,29 8,24C8,17 15,11 20,6C25,11 32,17 32,24C32,29 26,32 20,31Z',
    veins: 'M20,36L20,8M20,29L11,25M20,24L12,19M20,19L15,14M20,29L29,25M20,24L28,19M20,19L25,14',
  },
  Tilia: {
    // heart-shaped, slightly asymmetric
    d: 'M20,37L20,31C18,33 14,33 11,31C7,28 7,22 10,17C13,12 17,8 21,5C24,10 31,14 32,21C33,27 29,32 24,32C22,32 21,31 20,31Z',
    veins: 'M20,36L21,8M20,30L12,27M20,25L11,20M20,20L14,15M20,30L28,27M20,25L29,20M20,20L26,15',
    serrate: true,
  },
  Alnus: {
    // rounded with notched tip
    d: 'M20,37L20,33C14,33 9,29 9,22C9,15 14,9 18,9C19,9 19.5,10 20,11C20.5,10 21,9 22,9C26,9 31,15 31,22C31,29 26,33 20,33Z',
    veins: 'M20,36L20,11M20,30L12,27M20,25L10.5,21M20,20L11.5,15M20,30L28,27M20,25L29.5,21M20,20L28.5,15',
  },
  Castanea: {
    d: blade(20, 38, 0, 34, 7.5, { tip: 0.7, base: 0.5 }),
    veins: 'M20,38L20,6M20,32L15,29M20,27L14.5,24M20,22L14.5,19M20,17L15.5,14M20,12L17,10M20,32L25,29M20,27L25.5,24M20,22L25.5,19M20,17L24.5,14M20,12L23,10',
    serrate: true,
  },
  Salix: { d: blade(20, 38, 0, 34, 3.6, { tip: 0.8, base: 0.4 }), veins: 'M20,38L20,6' },
  Prunus: { d: blade(20, 38, 0, 32, 9.5, { tip: 0.7, base: 0.5 }), veins: 'M20,38L20,8M20,31L15,28M20,25L14.5,22M20,19L15.5,16M20,31L25,28M20,25L25.5,22M20,19L24.5,16', serrate: true },
  Ulmus: {
    // asymmetric base, double serrate
    d: 'M20,37L20,33C14,33 10,28 10,22C10,15 15,9 20,5C25,10 30,15 30,22C30,28 26,31 22,31C21,31 20.5,32 20,33Z',
    veins: 'M20,36L20,7M20,30L12,27M20,26L11,22M20,21L11.5,17M20,16L14,12M20,29L28,26M20,25L29,21M20,20L28.5,16M20,15L26,12',
    serrate: true,
  },
  Fraxinus: pinnate(4, 9, 2.6, { tip: 0.7 }),
  Sorbus: { ...pinnate(6, 7, 2, { tip: 0.6 }), serrate: true },
  Robinia: pinnate(5, 6, 2.6, { tip: 0.2, base: 0.6 }),
  Aesculus: { ...palmate(7, 16, 3.6, 200, { tip: 0.6, base: 0.2 }), serrate: true },
  Larix: needles(13, 13, 110, { y: 30, cluster: true }),
  Pinus: needles(2, 26, 22, { y: 36 }),
  Picea: shoot(30, 12, 0.85),
  Abies: shoot(30, 12, 1.25),
  Pseudotsuga: shoot(30, 10, 1.05),
};

export function leafSvg(genus, fill, { size = 20, title } = {}) {
  const s = SHAPES[genus];
  if (!s) return '';
  const dark = mixHex(fill, '#1e140c', 0.5);
  const label = title ? `<title>${title}</title>` : '';
  const aria = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"';
  let body;
  if (s.needles) {
    body = `${s.veins ? `<path d="${s.veins}" stroke="${dark}" stroke-width="1.6" stroke-linecap="round"/>` : ''}` +
      `<path d="${s.needles}" stroke="${fill}" stroke-width="${size < 26 ? 2.4 : 1.6}" stroke-linecap="round" fill="none"/>`;
  } else {
    body = `<path d="${s.d}" fill="${fill}" stroke="${dark}" stroke-width="${s.serrate ? 1.1 : 0.9}" stroke-linejoin="round"${s.serrate ? ' stroke-dasharray="1.6 0.9"' : ''}/>` +
      `<path d="${s.veins}" stroke="${dark}" stroke-width="0.8" stroke-linecap="round" fill="none" opacity="0.75"/>`;
  }
  // horizontal stretch about the midrib for shapes drawn too narrow
  if (s.sx) body = `<g transform="translate(20 0) scale(${s.sx} 1) translate(-20 0)">${body}</g>`;
  return `<svg class="leaf" viewBox="0 0 40 40" width="${size}" height="${size}" ${aria}>${label}${body}</svg>`;
}
