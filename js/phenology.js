// Autumn leaf senescence model.
//
// Based on the photoperiod × cold-degree-day family of models
// (Delpierre et al. 2009, "Modelling interannual and spatial variability of
// leaf senescence for three deciduous tree species in France").
// Senescence units accumulate from the day the photoperiod drops below
// P_START:
//   rate = max(0, TB - Tmean) + K_PHOTO * (P_START - P) + frost
// The photoperiod term guarantees that a warm autumn still progresses
// (only slower), the temperature term makes cold spells accelerate colouring,
// and hard frost (Tmin < FROST_T) speeds up browning and leaf fall.

import { SPECIES, SUMMER_GREEN, BARE } from './species.js';
import { mixHex } from './color.js';

export const TB = 17;          // °C base temperature
export const P_START = 13.5;   // h, day length that starts senescence
export const K_PHOTO = 2;      // units per hour of day length below P_START
export const FROST_T = -2;     // °C
export const K_FROST = 10;     // units per °C of Tmin below FROST_T

// Day length in hours (CBM model, Forsythe et al. 1995).
export function dayLength(lat, doy) {
  const theta = 0.2163108 + 2 * Math.atan(0.9671396 * Math.tan(0.0086 * (doy - 186)));
  const phi = Math.asin(0.39795 * Math.cos(theta));
  const p = 0.8333;
  const rad = Math.PI / 180;
  const v = (Math.sin(p * rad) + Math.sin(lat * rad) * Math.sin(phi)) / (Math.cos(lat * rad) * Math.cos(phi));
  return 24 - (24 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, v)));
}

export function dayOfYear(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
}

export function dailyRate(lat, day) {
  const P = dayLength(lat, dayOfYear(day.date));
  if (P >= P_START || day.tmean == null) return 0;
  let r = Math.max(0, TB - day.tmean) + K_PHOTO * (P_START - P);
  if (day.tmin != null && day.tmin < FROST_T) r += K_FROST * (FROST_T - day.tmin);
  return r;
}

// days: [{date:'YYYY-MM-DD', tmean, tmin}] in order, starting before senescence.
// Returns [{date, S}] cumulative senescence units at the end of each day.
export function accumulate(lat, days) {
  let S = 0;
  return days.map((day) => {
    S += dailyRate(lat, day);
    return { date: day.date, S };
  });
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => x * x * (3 - 2 * x);

// State of one genus given cumulative units S.
//  coloured: share of foliage that has turned (0..1)
//  leaves:   share of leaves still on the tree (0..1)
export function genusState(genus, S) {
  const sp = SPECIES[genus];
  if (!sp || sp.evergreen) return { coloured: 0, leaves: 1, color: sp ? sp.green : SUMMER_GREEN, stage: 'evergreen' };
  const c = clamp01((S - sp.onset) / (sp.peak - sp.onset));
  const f = clamp01((S - sp.peak) / (sp.bare - sp.peak));
  const leaves = 1 - smooth(f);
  // green -> early tint -> peak colour, then fading to brown as leaves drop
  const [early, peak, late] = sp.colors;
  let color = c < 0.5 ? mixHex(SUMMER_GREEN, early, smooth(c * 2)) : mixHex(early, peak, smooth((c - 0.5) * 2));
  color = mixHex(color, late, smooth(f));
  let stage;
  if (c === 0) stage = 'green';
  else if (c < 0.35) stage = 'turning';
  else if (c < 1 || f < 0.25) stage = 'peak';
  else if (leaves > 0.1) stage = 'falling';
  else stage = 'bare';
  return { coloured: c, leaves, color, stage };
}

// Visible canopy colour for a composition {genus: share}.
// Bare trees show the branch colour; weights follow the remaining foliage so a
// half-bare beech stand looks mostly bare.
export function canopy(composition, S) {
  let r = 0, g = 0, b = 0, w = 0, foliage = 0, coloured = 0, decid = 0;
  const parts = [];
  for (const [genus, share] of Object.entries(composition)) {
    const st = genusState(genus, S);
    parts.push({ genus, share, ...st });
    const col = mixHex(BARE, st.color, st.leaves);
    const [cr, cg, cb] = hexToRgb(col);
    r += cr * share; g += cg * share; b += cb * share; w += share;
    foliage += st.leaves * share;
    if (st.stage !== 'evergreen') { decid += share; coloured += st.coloured * st.leaves * share; }
  }
  if (!w) return null;
  return {
    color: rgbToHex(r / w, g / w, b / w),
    foliage: foliage / w,
    // share of the deciduous canopy currently showing autumn colour
    intensity: decid ? coloured / decid : 0,
    parts: parts.sort((a, b) => b.share - a.share),
  };
}

// First date at which a genus reaches a threshold of S, or null.
export function crossingDate(series, threshold) {
  const hit = series.find((d) => d.S >= threshold);
  return hit ? hit.date : null;
}

export function milestones(genus, series) {
  const sp = SPECIES[genus];
  if (!sp || sp.evergreen) return null;
  return {
    onset: crossingDate(series, sp.onset),
    peak: crossingDate(series, sp.peak),
    bare: crossingDate(series, sp.bare),
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
