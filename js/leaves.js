// Botanical leaf drawings per genus, in a 100×100 box with the stalk at the
// bottom. Each leaf is generated from its real morphology: blade outline
// (ovate, deltoid, cordate, lobed, palmate, compound), margin teeth
// (serrate, double serrate, crenate, bristle-tipped), venation and stalk.
// leafSvg(genus, fill) returns the drawing filled with the leaf's current
// colour; margin and veins are drawn in a darker shade of that colour.
//
// Reference species (the commonest of each genus in N France / Belgium):
// Quercus robur, Fagus sylvatica, Carpinus betulus, Acer pseudoplatanus,
// Platanus × hispanica, Liquidambar styraciflua, Betula pendula,
// Populus × canadensis, Tilia cordata, Alnus glutinosa, Castanea sativa,
// Salix alba, Prunus avium, Ulmus minor, Fraxinus excelsior,
// Sorbus aucuparia, Robinia pseudoacacia, Aesculus hippocastanum,
// Larix decidua, Pinus sylvestris, Picea abies, Abies alba,
// Pseudotsuga menziesii.

import { mixHex } from './color.js';

const f1 = (v) => Math.round(v * 10) / 10;
const pt = ([x, y]) => `${f1(x)},${f1(y)}`;
const poly = (pts, close = true) => 'M' + pts.map(pt).join('L') + (close ? 'Z' : '');
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
const frac = (v) => v - Math.floor(v);
const rad = (deg) => (deg * Math.PI) / 180;

// ------------------------------------------------------------ margins
// Tooth profiles over u (in teeth, increasing towards the apex), 0..1.
// `peak` is where in a tooth its point sits, used to end veins on teeth.
const TEETH = {
  // long basal flank, short apical one: the teeth point forwards
  serrate: { peak: 0.78, f: (u) => { const x = frac(u); return x < 0.78 ? (x / 0.78) ** 1.7 : (1 - x) / 0.22; } },
  double: { peak: 0.78, f: (u) => 0.68 * TEETH.serrate.f(u) + 0.32 * TEETH.serrate.f(u * 3) },
  crenate: { peak: 0.5, f: (u) => Math.sin(Math.PI * frac(u)) ** 0.55 },
  sinuate: { peak: 0.5, f: (u) => 0.5 - 0.5 * Math.cos(2 * Math.PI * u) },
  // chestnut: a shallow wave ending in a bristle at each vein end
  bristle: { peak: 0.86, f: (u) => { const x = frac(u); return 0.3 * Math.sin(Math.PI * x) ** 0.8 + Math.max(0, 1 - Math.abs(x - 0.86) / 0.06); } },
  // symmetric coarse teeth for lobed leaves (whose margin turns both ways)
  coarse: { peak: 0.5, f: (u) => (1 - Math.abs(2 * frac(u) - 1)) ** 1.4 },
};

// Offset a polyline along its normal by a tooth profile. `side` flips the
// normal so it points outwards; `env(s)` scales the teeth along the arc.
function toothed(pts, side, { type, n, amp, phase = 0 }, env = () => 1) {
  if (!type) return { pts, at: () => null };
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const S = s.at(-1);
  const f = TEETH[type].f;
  const out = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    const k = amp * env(s[i] / S) * f((s[i] / S) * n + phase);
    return [p[0] - (ty / l) * k * side, p[1] + (tx / l) * k * side];
  });
  // point of tooth j (for vein ends)
  const at = (j) => {
    const target = ((j + TEETH[type].peak - phase) / n) * S;
    let i = s.findIndex((v) => v >= target);
    if (i < 0) i = s.length - 1;
    return { p: out[i], arc: s[i] / S };
  };
  return { pts: out, at };
}

// ------------------------------------------------------------ simple blades
// Blade along a midrib of length L from its base, local coords with the
// tip at (0, -L); placed at (x, y) and rotated by `angle` (deg, 0 = up).
//   W          max half-width; p, q shape it (t^p (1-t)^q: p<q ovate, p>q obovate)
//   acuminate  drawn-out tip; cord: lobes below the stalk (cordate base)
//   asym       one side's base starts higher up the midrib (elm, lime)
//   notch      notched tip (alder); lobes: oak-like sinuses
//   veins      { n pairs, angle, from, to, ends: 'teeth' | 'loop', basal }
function blade(o) {
  const { L, W, p = 1, q = 1, petiole = 0, x = 50, y = 90, angle = 0 } = o;
  const tm = p / (p + q), norm = 1 / (tm ** p * (1 - tm) ** q);
  const width = (t) => {
    let w = W * norm * t ** p * (1 - t) ** q;
    if (o.acuminate) w *= 1 - o.acuminate * smooth(0.5, 0.93, t);
    if (o.lobes) {
      const { n, from, to, depth, k = 2 } = o.lobes;
      if (t > from && t < to) {
        const phi = ((t - from) / (to - from)) * n;
        // rounded lobes, narrower sinuses between them
        w *= 1 - depth + depth * Math.sin(Math.PI * frac(phi)) ** (1 / k);
      }
    }
    if (o.auricle) w += W * o.auricle * Math.exp(-(((t - 0.05) / 0.04) ** 2));
    return w;
  };
  const N = o.samples || 260;
  const sides = {};
  for (const side of [-1, 1]) {
    const off = side === 1 ? o.asym || 0 : 0;
    const raw = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const tt = off + (1 - off) * t;
      let ly = -L * tt;
      if (o.cord) ly += o.cord * (side === 1 && o.asym ? 0.5 : 1) * W * Math.sin(Math.PI * Math.min(1, t / (o.cordT || 0.3)));
      if (o.auricle) ly += W * o.auricle * 0.6 * Math.exp(-(((t - 0.04) / 0.04) ** 2));
      if (o.notch) ly += o.notch * smooth(0.82, 1, t) ** 2;
      raw.push([side * width(t), ly]);
    }
    const teeth = o.teeth || {};
    const env = (s) => smooth(teeth.start ?? 0.1, (teeth.start ?? 0.1) + 0.15, s) * (1 - 0.75 * smooth(0.9, 1, s));
    sides[side] = toothed(raw, side, teeth, env);
    sides[side].raw = raw;
  }

  // veins
  const tip = -L + (o.notch || 0);
  const veins = [];
  const v = o.veins || {};
  if (v.n) {
    const a = rad(v.angle || 45);
    for (const side of [-1, 1]) {
      for (let i = 0; i < v.n; i++) {
        let E;
        if (v.ends === 'teeth') {
          const j = Math.round((v.first ?? 0) + i * (v.step ?? 1));
          const hit = sides[side].at(j);
          if (!hit || hit.arc > 0.93) continue;
          E = hit.p;
        } else {
          const t = (v.from ?? 0.12) + (i / Math.max(1, v.n - 1)) * ((v.to ?? 0.8) - (v.from ?? 0.12));
          const k = Math.min(N, Math.round(t * N));
          const m = sides[side].raw[k];
          E = [m[0] * (v.reach ?? 0.85), m[1] - (v.lift ?? 0.06) * L];
        }
        const dx = Math.abs(E[0]);
        const sy = Math.min(-0.02 * L, E[1] + dx / Math.tan(a));
        const S = [0, Math.max(sy, -L * 0.97)];
        const C = [side * dx * (v.bow ?? 0.5), S[1] - dx * (v.bow ?? 0.5) / Math.tan(a)];
        veins.push(`M${pt(S)}Q${pt(C)} ${pt([E[0] * 0.96, E[1]])}`);
      }
    }
    if (v.basal) for (const side of [-1, 1]) {
      const k = Math.round(v.basal * N);
      const m = sides[side].raw[k];
      veins.push(`M0,0Q${pt([m[0] * 0.5, m[1] * 0.3])} ${pt([m[0] * 0.85, m[1]])}`);
    }
  }

  const right = sides[1].pts, left = sides[-1].pts;
  const outline = [...right, ...left.slice().reverse()];
  const half = [...right, [0, tip]];
  const c = Math.cos(rad(angle)), s = Math.sin(rad(angle));
  const T = ([px, py]) => [x + px * c - py * s, y + px * s + py * c];
  const tr = (d) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, a1, b1) => pt(T([+a1, +b1])));
  return {
    d: poly(outline.map(T)),
    hi: poly(half.map(T)),
    veins: tr(`M0,0L0,${f1(tip + 1)}` + veins.join('')),
    stem: petiole ? `M${pt(T([0, petiole]))}L${pt(T([0, 0]))}` : '',
    base: T([0, 0]),
  };
}

// ------------------------------------------------------------ palmately lobed
// Outline in polar form around the stalk junction: r(θ) is a soft maximum
// of one bump per lobe ({a: direction deg, L: length, h: half-width deg,
// p: tip sharpness}), so sinuses come out rounded.
function lobed(o) {
  const { cx = 50, cy = 60, lobes, rmin = 3, k = 5, petiole = 0, teeth = {} } = o;
  const N = 900;
  const raw = [];
  for (let i = 0; i <= N; i++) {
    const th = -175 + (350 * i) / N;
    let sum = rmin ** k;
    for (const l of lobes) {
      const x = Math.abs(th - l.a) / l.h;
      if (x < 1) sum += (l.L * (1 - x ** (l.e ?? 1.6)) ** (l.p ?? 1)) ** k;
    }
    const r = sum ** (1 / k);
    raw.push([cx + r * Math.sin(rad(th)), cy - r * Math.cos(rad(th))]);
  }
  raw.unshift([cx, cy]); raw.push([cx, cy]);
  const { pts } = toothed(raw, -1, teeth, (s) => smooth(0.03, 0.1, s) * (1 - smooth(0.9, 0.97, s)));
  const veins = [];
  for (const l of lobes) {
    if (l.vein === false) continue;
    const r = l.L * 0.93;
    const E = [cx + r * Math.sin(rad(l.a)), cy - r * Math.cos(rad(l.a))];
    veins.push(`M${cx},${cy}L${pt(E)}`);
    // a pair of secondary veins off each main one
    for (const side of [-1, 1]) for (const f of [0.38, 0.62]) {
      const S = [cx + r * f * Math.sin(rad(l.a)), cy - r * f * Math.cos(rad(l.a))];
      const a2 = l.a + side * 42;
      const len = (r * (0.75 - f) * 0.9 + 4) * Math.min(1, l.h / 46);
      veins.push(`M${pt(S)}L${pt([S[0] + len * Math.sin(rad(a2)), S[1] - len * Math.cos(rad(a2))])}`);
    }
  }
  const top = pts.slice(0, Math.round(pts.length / 2));
  return {
    d: poly(pts), hi: poly([...top, [cx, cy]]), veins: veins.join(''),
    stem: petiole ? `M${cx},${cy}Q${cx + 2},${cy + petiole * 0.6} ${cx + 3},${cy + petiole}` : '',
  };
}

// ------------------------------------------------------------ compound
// Odd-pinnate: opposite leaflet pairs along a rachis, plus a terminal one.
function pinnate({ pairs, top = 8, bottom = 96, first = 70, leaf, angle = 58, stalk = 0 }) {
  const parts = [];
  const span = first - (top + leaf.L * 0.95);
  for (let i = 0; i < pairs; i++) {
    const y = first - (i * span) / Math.max(1, pairs - 1);
    const shrink = 1 - 0.1 * (i / pairs);
    for (const side of [-1, 1]) {
      const ax = 50 + side * stalk * Math.sin(rad(angle)), ay = y - stalk * Math.cos(rad(angle));
      parts.push(blade({ ...leaf, L: leaf.L * shrink, x: ax, y: ay, angle: side * angle, petiole: 0 }));
    }
  }
  parts.push(blade({ ...leaf, x: 50, y: top + leaf.L + stalk, angle: 0, petiole: 0 }));
  return { parts, stem: `M50,${bottom}L50,${f1(top + leaf.L * 0.6)}` + (stalk ? parts.map((b) => `M50,${f1(b.base[1] + stalk * 0.5)}L${pt(b.base)}`).join('') : '') };
}

// Digitate (horse chestnut): leaflets radiating from the top of the stalk.
function digitate({ cx = 50, cy = 64, leaflets, leaf, petiole }) {
  const parts = leaflets.map(([a, L]) => {
    const g = 3;
    return blade({ ...leaf, L, x: cx + g * Math.sin(rad(a)), y: cy - g * Math.cos(rad(a)), angle: a, petiole: 0 });
  });
  return { parts, stem: `M${cx},${cy + petiole}Q${cx - 1},${cy + petiole * 0.5} ${cx},${cy}` };
}

// ------------------------------------------------------------ conifers
// A needle as a thin filled shape from base (x, y) at `angle` (0 = up).
function needle(x, y, angle, len, w, { blunt = false, bend = 0 } = {}) {
  const n = 10, L = [], R = [];
  const c = Math.cos(rad(angle)), s = Math.sin(rad(angle));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const hw = (w / 2) * (blunt ? Math.sqrt(1 - t ** 6) : 1 - t ** 2.2) * (0.55 + 0.45 * Math.min(1, t * 5));
    const off = bend * Math.sin(Math.PI * t) * len;
    const along = -t * len;
    for (const [arr, sd] of [[L, -1], [R, 1]]) {
      const px = off + sd * hw, py = along;
      arr.push([x + px * c - py * s, y + px * s + py * c]);
    }
  }
  return poly([...L, ...R.reverse()]);
}

// Shoot with needles along it: `arrange(i, side)` -> needle params or null.
function shoot({ from = [50, 96], to = [50, 8], count, arrange, bud }) {
  const needles = [];
  for (let i = 0; i < count; i++) {
    const t = 0.04 + (0.94 * i) / count;
    const x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t;
    for (const side of [-1, 1]) {
      const nd = arrange(t, side, i);
      if (nd) needles.push(needle(x, y, nd.angle, nd.len, nd.w, nd));
    }
  }
  return { needles, stem: `M${pt(from)}L${pt(to)}`, bud };
}

const SHAPES = {
  // pedunculate oak: obovate, 4–6 pairs of rounded lobes, ear-like basal
  // lobes (auricles) and an almost sessile blade
  Quercus: { parts: [blade({ L: 80, W: 28, p: 1.2, q: 0.5, y: 92, petiole: 4, samples: 400,
    lobes: { n: 4.5, from: 0.13, to: 1.03, depth: 0.6, k: 2.2 }, auricle: 0.3,
    veins: { n: 4, from: 0.24, to: 0.84, angle: 52, reach: 0.9, lift: 0.02, bow: 0.4 } })] },
  // beech: ovate-elliptic, entire wavy margin, 6–8 straight parallel vein pairs
  Fagus: { parts: [blade({ L: 66, W: 21, p: 0.85, q: 0.75, y: 86, petiole: 8, acuminate: 0.25,
    teeth: { type: 'sinuate', n: 7, amp: 1.2, start: 0.12, phase: 0.3 },
    veins: { n: 7, ends: 'teeth', angle: 42, first: 0, step: 1, bow: 0.3 } })] },
  // hornbeam: ovate-oblong, sharply double serrate, 10–15 pleated vein pairs
  Carpinus: { parts: [blade({ L: 66, W: 19, p: 0.6, q: 0.85, y: 86, petiole: 9, acuminate: 0.6, cord: 0.08, cordT: 0.12,
    teeth: { type: 'double', n: 13, amp: 2.4, start: 0.08 },
    veins: { n: 12, ends: 'teeth', angle: 38, first: 0.5, step: 1, bow: 0.25 } })] },
  // sycamore: five lobes with shallow sinuses, coarse blunt teeth, long stalk
  Acer: { parts: [lobed({ cx: 50, cy: 64, rmin: 9, k: 4, petiole: 30,
    lobes: [{ a: 0, L: 52, h: 46 }, { a: -58, L: 47, h: 44 }, { a: 58, L: 47, h: 44 }, { a: -122, L: 26, h: 38 }, { a: 122, L: 26, h: 38 }],
    teeth: { type: 'coarse', n: 34, amp: 2.6 } })] },
  // plane: 3–5 triangular lobes with sharp tips, few large teeth, truncate base
  Platanus: { parts: [lobed({ cx: 50, cy: 66, rmin: 6, k: 3.2, petiole: 26,
    lobes: [{ a: 0, L: 54, h: 40, p: 1.2 }, { a: -60, L: 50, h: 40, p: 1.2 }, { a: 60, L: 50, h: 40, p: 1.2 }, { a: -112, L: 26, h: 30, p: 1.2 }, { a: 112, L: 26, h: 30, p: 1.2 }],
    teeth: { type: 'coarse', n: 16, amp: 3 } })] },
  // sweetgum: deeply five-lobed star with pointed lobes, finely serrate
  Liquidambar: { parts: [lobed({ cx: 50, cy: 58, rmin: 7, k: 3, petiole: 34,
    lobes: [{ a: 0, L: 50, h: 38, p: 1.2, e: 1.5 }, { a: -70, L: 47, h: 38, p: 1.2, e: 1.5 }, { a: 70, L: 47, h: 38, p: 1.2, e: 1.5 }, { a: -138, L: 38, h: 34, p: 1.2, e: 1.5 }, { a: 138, L: 38, h: 34, p: 1.2, e: 1.5 }],
    teeth: { type: 'coarse', n: 70, amp: 1.1 } })] },
  // silver birch: rhombic-triangular, long-pointed, double serrate, long stalk
  Betula: { parts: [blade({ L: 56, W: 21, p: 0.75, q: 1.35, y: 76, petiole: 20, acuminate: 0.5,
    teeth: { type: 'double', n: 10, amp: 2.2, start: 0.12 },
    veins: { n: 6, ends: 'teeth', angle: 45, first: 0.4, step: 1.2, bow: 0.3 } })] },
  // hybrid black poplar: deltoid with a truncate base, crenate-serrate margin,
  // long flattened stalk
  Populus: { parts: [blade({ L: 54, W: 27, p: 0.3, q: 1.15, y: 74, petiole: 24, acuminate: 0.35,
    teeth: { type: 'crenate', n: 16, amp: 1.6, start: 0.06 },
    veins: { n: 5, from: 0.16, to: 0.62, angle: 52, reach: 0.82, bow: 0.55, basal: 0.06 } })] },
  // small-leaved lime: heart-shaped with an oblique base, abrupt point, finely serrate
  Tilia: { parts: [blade({ L: 52, W: 26, p: 0.55, q: 0.75, y: 72, petiole: 22, acuminate: 0.55, cord: 0.32, cordT: 0.2, asym: 0.06,
    teeth: { type: 'serrate', n: 24, amp: 1.3, start: 0.04 },
    veins: { n: 5, from: 0.2, to: 0.7, angle: 46, reach: 0.85, bow: 0.5 } })] },
  // black alder: obovate-round with a notched tip, wavy double-toothed margin
  Alnus: { parts: [blade({ L: 56, W: 24, p: 0.9, q: 0.55, y: 78, petiole: 16, notch: 3,
    teeth: { type: 'double', n: 8, amp: 1.8, start: 0.1 },
    veins: { n: 6, ends: 'teeth', angle: 44, first: 0.2, step: 1.1, bow: 0.35 } })] },
  // sweet chestnut: long oblong-lanceolate, 15–20 straight vein pairs each
  // ending in a bristle tooth
  Castanea: { parts: [blade({ L: 82, W: 14.5, p: 0.75, q: 0.85, y: 92, petiole: 6, acuminate: 0.3,
    teeth: { type: 'bristle', n: 16, amp: 2.4, start: 0.06 },
    veins: { n: 16, ends: 'teeth', angle: 40, first: 0, step: 1, bow: 0.2 } })] },
  // white willow: narrow lanceolate, finely serrulate
  Salix: { parts: [blade({ L: 84, W: 7.5, p: 0.8, q: 0.9, y: 92, petiole: 6, acuminate: 0.35,
    teeth: { type: 'serrate', n: 34, amp: 0.7, start: 0.05 },
    veins: { n: 10, from: 0.1, to: 0.85, angle: 62, reach: 0.85, bow: 0.5 } })] },
  // wild cherry: obovate-oblong, abruptly pointed, blunt forward teeth, two
  // red glands on the stalk under the blade
  Prunus: { parts: [blade({ L: 66, W: 19, p: 1.05, q: 0.7, y: 78, petiole: 18, acuminate: 0.65,
    teeth: { type: 'double', n: 20, amp: 1.5, start: 0.08 },
    veins: { n: 8, from: 0.12, to: 0.82, angle: 50, reach: 0.86, lift: 0.08, bow: 0.55 } })],
    glands: [[48.6, 82.5], [51.4, 81]] },
  // field elm: strongly unequal base, double serrate, 10–14 straight vein pairs
  Ulmus: { parts: [blade({ L: 66, W: 20, p: 0.9, q: 0.8, y: 86, petiole: 5, acuminate: 0.35, asym: 0.13, cord: 0.14, cordT: 0.16,
    teeth: { type: 'double', n: 12, amp: 2.2, start: 0.06 },
    veins: { n: 10, ends: 'teeth', angle: 40, first: 1, step: 1, bow: 0.25 } })] },
  // ash: 9–13 sessile, lanceolate, serrate leaflets
  Fraxinus: pinnate({ pairs: 4, top: 3, first: 86, angle: 52, leaf: { L: 24, W: 4.6, p: 0.7, q: 0.9, acuminate: 0.4,
    teeth: { type: 'serrate', n: 9, amp: 0.9 }, veins: { n: 5, from: 0.15, to: 0.8, angle: 55, reach: 0.8, bow: 0.5 } } }),
  // rowan: 11–15 oblong leaflets, serrate in the upper part
  Sorbus: pinnate({ pairs: 6, top: 4, first: 88, angle: 68, leaf: { L: 17, W: 3.7, p: 0.9, q: 0.7,
    teeth: { type: 'serrate', n: 8, amp: 0.9, start: 0.35 }, veins: { n: 4, from: 0.2, to: 0.8, angle: 55, reach: 0.8, bow: 0.5 } } }),
  // black locust: 7–19 elliptic, entire leaflets on short stalks, rounded tips
  Robinia: pinnate({ pairs: 5, top: 4, first: 86, angle: 68, stalk: 2, leaf: { L: 15, W: 4.6, p: 1, q: 0.6, notch: 0.6,
    veins: { n: 4, from: 0.2, to: 0.75, angle: 55, reach: 0.8, bow: 0.5 } } }),
  // horse chestnut: 5–7 obovate leaflets, abruptly pointed, double serrate
  Aesculus: digitate({ cx: 50, cy: 66, petiole: 30,
    leaflets: [[0, 50], [-38, 44], [38, 44], [-78, 33], [78, 33], [-112, 22], [112, 22]],
    leaf: { W: 7, p: 1.5, q: 0.55, acuminate: 0.5, teeth: { type: 'double', n: 12, amp: 1, start: 0.25 },
      veins: { n: 9, from: 0.12, to: 0.85, angle: 50, reach: 0.85, bow: 0.4 } } }),

  // larch: soft needles in tufts of 20–40 on short spur shoots
  Larix: (() => {
    const needles = [];
    const spurs = [[38, 70, -30], [60, 42, 25], [44, 20, -10]];
    for (const [sx, sy, dir] of spurs) {
      for (let i = 0; i < 15; i++) {
        const a = dir - 62 + (124 * i) / 14;
        needles.push(needle(sx, sy, a, 19 + 6 * Math.sin(i * 1.7) ** 2, 2.6, { blunt: true, bend: 0.03 * Math.sign(a - dir) }));
      }
    }
    return { needles, stem: 'M30,98Q40,70 52,52T56,6M38,70L41,72M60,42L56,44M44,20L48,22', spurs };
  })(),
  // Scots pine: needles in twisted pairs from a short sheath
  Pinus: (() => {
    const needles = [];
    const pairs = [[50, 58, 0, 50], [50, 72, -36, 44], [50, 72, 36, 44], [50, 86, -64, 38], [50, 86, 64, 38]];
    for (const [x, y, a, l] of pairs) {
      // the two needles of a pair diverge and twist slightly
      needles.push(needle(x, y, a - 8, l, 2.4, { bend: 0.06 }), needle(x, y, a + 8, l, 2.4, { bend: -0.06 }));
    }
    return { needles, stem: 'M50,98L50,58', sheaths: pairs.map(([x, y, a]) => [x, y, a]) };
  })(),
  // Norway spruce: stiff, sharp, four-angled needles all round the twig
  Picea: shoot({ count: 13, arrange: (t, side, i) => ({ angle: side * (52 - 10 * t) + (i % 2 ? 6 : -6), len: 14 - 3 * t, w: 2.6 }),
    bud: [50, 8] }),
  // silver fir: flat needles with notched tips, spread in two flat ranks
  Abies: shoot({ count: 14, arrange: (t, side) => ({ angle: side * (82 - 25 * t), len: 19 - 4 * t, w: 3.4, blunt: true }), bud: [50, 8] }),
  // Douglas fir: soft, blunt needles spreading all round, long pointed buds
  Pseudotsuga: shoot({ count: 12, arrange: (t, side, i) => ({ angle: side * (64 - 12 * t) + (i % 2 ? 8 : -8), len: 21 - 4 * t, w: 2.8, blunt: true }),
    bud: [50, 8], longBud: true }),
};

// Markup is generated once per genus; only colours change per call.
const cache = new Map();
function geometry(genus) {
  if (!cache.has(genus)) cache.set(genus, SHAPES[genus] || null);
  return cache.get(genus);
}

export function leafSvg(genus, fill, { size = 20, title } = {}) {
  const s = geometry(genus);
  if (!s) return '';
  const dark = mixHex(fill, '#1e140c', 0.5);
  const stemColor = s.needles ? mixHex('#7a5234', fill, 0.25) : dark;
  // strokes in px stay readable at any size
  const k = 100 / size;
  const sw = (px, min) => f1(Math.max(min, px * k));
  const label = title ? `<title>${title}</title>` : '';
  const aria = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"';
  let body = '';
  if (s.stem) body += `<path d="${s.stem}" stroke="${stemColor}" stroke-width="${sw(s.needles ? 1.4 : 1.1, s.needles ? 2.4 : 2)}" stroke-linecap="round" fill="none"/>`;
  for (const p of s.parts || []) {
    if (p.stem) body += `<path d="${p.stem}" stroke="${dark}" stroke-width="${sw(1.1, 2)}" stroke-linecap="round" fill="none"/>`;
    body += `<path d="${p.d}" fill="${fill}" stroke="${dark}" stroke-width="${sw(0.6, 0.9)}" stroke-linejoin="round"/>` +
      `<path d="${p.hi}" fill="#1e140c" opacity="0.1"/>` +
      `<path d="${p.veins}" stroke="${dark}" stroke-width="${sw(0.4, 0.6)}" stroke-linecap="round" fill="none" opacity="0.7"/>`;
  }
  if (s.glands) body += s.glands.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7" fill="${mixHex('#a02a2a', fill, 0.3)}"/>`).join('');
  // needles get a fill-coloured stroke at small sizes so they don't vanish
  if (s.needles) body += `<path d="${s.needles.join('')}" fill="${fill}" stroke="${size < 60 ? fill : dark}" stroke-width="${size < 60 ? sw(0.9, 0) : sw(0.3, 0.5)}" stroke-linejoin="round"/>`;
  if (s.sheaths) body += s.sheaths.map(([x, y, a]) => `<path d="M${x},${y + 0.5}l0,-3.5" stroke="${stemColor}" stroke-width="2.6" stroke-linecap="round" transform="rotate(${a} ${x} ${y})"/>`).join('');
  if (s.spurs) body += s.spurs.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${stemColor}"/>`).join('');
  if (s.bud) {
    const [x, y] = s.bud;
    body += s.longBud
      ? `<path d="M${x - 2.4},${y + 4}Q${x},${y - 12} ${x + 2.4},${y + 4}Z" fill="${stemColor}"/>`
      : `<ellipse cx="${x}" cy="${y}" rx="3" ry="4" fill="${stemColor}"/>`;
  }
  return `<svg class="leaf" viewBox="0 0 100 100" width="${size}" height="${size}" ${aria}>${label}${body}</svg>`;
}

export const LEAF_GENERA = Object.keys(SHAPES);
