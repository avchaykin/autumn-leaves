// Tree genus profiles: autumn colour palette and senescence thresholds.
//
// Thresholds are expressed in "senescence units" accumulated by phenology.js
// (cold degree-days below Tb + a photoperiod term). They were calibrated so a
// normal year in northern France / Belgium (~50.5°N) gives: first colour mid
// September, peak around the last third of October, bare trees mid November,
// with the usual species ordering (horse chestnut & birch early, oak & larch late).

export const SPECIES = {
  Fagus:     { name: 'Beech',          fr: 'Hêtre',            gbif: 2874875, onset: 90,  peak: 300, bare: 560, colors: ['#e0a030', '#c8641e', '#8a4a22'] },
  Quercus:   { name: 'Oak',            fr: 'Chêne',            gbif: 2877951, onset: 120, peak: 380, bare: 760, colors: ['#c8a040', '#b06a2a', '#7a5230'] },
  Carpinus:  { name: 'Hornbeam',       fr: 'Charme',           gbif: 2875770, onset: 90,  peak: 290, bare: 560, colors: ['#e8c840', '#d4a02a', '#9a7a3a'] },
  Acer:      { name: 'Maple',          fr: 'Érable',           gbif: 3189834, onset: 80,  peak: 270, bare: 520, colors: ['#f0a020', '#e0502a', '#a03a22'] },
  Betula:    { name: 'Birch',          fr: 'Bouleau',          gbif: 2875008, onset: 70,  peak: 240, bare: 500, colors: ['#f4d43a', '#e8b828', '#a08a40'] },
  Fraxinus:  { name: 'Ash',            fr: 'Frêne',            gbif: 3172323, onset: 90,  peak: 250, bare: 440, colors: ['#b8b850', '#c8b840', '#8a8050'] },
  Populus:   { name: 'Poplar',         fr: 'Peuplier',         gbif: 3040183, onset: 90,  peak: 280, bare: 520, colors: ['#ecd040', '#e0b020', '#9a8440'] },
  Castanea:  { name: 'Sweet chestnut', fr: 'Châtaignier',      gbif: 2882140, onset: 100, peak: 320, bare: 600, colors: ['#e0c040', '#c89a30', '#8a6a30'] },
  Tilia:     { name: 'Lime',           fr: 'Tilleul',          gbif: 3152041, onset: 70,  peak: 250, bare: 480, colors: ['#e8d040', '#d8b030', '#9a8040'] },
  Alnus:     { name: 'Alder',          fr: 'Aulne',            gbif: 2876099, onset: 140, peak: 420, bare: 620, colors: ['#8a9a40', '#8a8a3a', '#6a5a38'] },
  Salix:     { name: 'Willow',         fr: 'Saule',            gbif: 3039576, onset: 110, peak: 340, bare: 600, colors: ['#d8d040', '#c8b030', '#8a7a40'] },
  Aesculus:  { name: 'Horse chestnut', fr: 'Marronnier',       gbif: 3189801, onset: 50,  peak: 210, bare: 440, colors: ['#d8a030', '#b0602a', '#7a4a2a'] },
  Prunus:    { name: 'Cherry',         fr: 'Merisier',         gbif: 3020559, onset: 60,  peak: 230, bare: 480, colors: ['#f0a030', '#d8402a', '#902a2a'] },
  Sorbus:    { name: 'Rowan',          fr: 'Sorbier',          gbif: 3012146, onset: 60,  peak: 230, bare: 480, colors: ['#f09030', '#d0402a', '#8a2a22'] },
  Robinia:   { name: 'Black locust',   fr: 'Robinier',         gbif: 2952066, onset: 110, peak: 320, bare: 520, colors: ['#e0d040', '#d0b830', '#8a7a40'] },
  Ulmus:     { name: 'Elm',            fr: 'Orme',             gbif: 2984510, onset: 100, peak: 300, bare: 540, colors: ['#e0c838', '#c8a030', '#8a7038'] },
  Platanus:  { name: 'Plane',          fr: 'Platane',          gbif: 3152811, onset: 110, peak: 340, bare: 640, colors: ['#d8b840', '#b88a3a', '#8a6a3a'] },
  Liquidambar:{ name: 'Sweetgum',      fr: 'Copalme',          gbif: 3152823, onset: 90,  peak: 300, bare: 580, colors: ['#e86a2a', '#c02a3a', '#6a1a3a'] },
  Larix:     { name: 'Larch',          fr: 'Mélèze',           gbif: 2686156, onset: 140, peak: 400, bare: 700, colors: ['#d8c040', '#e0a028', '#a06a2a'] },
  // Evergreen conifers: stay green, listed so composition is complete.
  Pinus:     { name: 'Pine',           fr: 'Pin',              gbif: 2684241, evergreen: true, green: '#3a5a32' },
  Picea:     { name: 'Spruce',         fr: 'Épicéa',           gbif: 7606064, evergreen: true, green: '#2a4a30' },
  Abies:     { name: 'Fir',            fr: 'Sapin',            gbif: 2684876, evergreen: true, green: '#2a4a32' },
  Pseudotsuga:{ name: 'Douglas fir',   fr: 'Douglas',          gbif: 2685775, evergreen: true, green: '#2e5032' },
};

export const SUMMER_GREEN = '#4a7a2e';
export const BARE = '#7a6a5c';

export const BROADLEAF = Object.keys(SPECIES).filter((k) => !SPECIES[k].evergreen && k !== 'Larix');
export const CONIFER = ['Pinus', 'Picea', 'Abies', 'Pseudotsuga', 'Larix'];

// Prior composition of broadleaved forest in northern France / Belgium
// (rounded from IGN Inventaire Forestier regional results for Hauts-de-France
// and Walloon forest inventory). Blended with GBIF counts to correct GBIF's
// strong urban / park bias (maples, horse chestnuts, limes are over-recorded).
export const BROADLEAF_PRIOR = {
  Quercus: 0.32, Fagus: 0.12, Carpinus: 0.11, Fraxinus: 0.08, Populus: 0.08,
  Betula: 0.07, Acer: 0.06, Castanea: 0.05, Alnus: 0.04, Prunus: 0.02,
  Salix: 0.02, Tilia: 0.01, Robinia: 0.01, Sorbus: 0.005, Ulmus: 0.005,
};
export const CONIFER_PRIOR = { Pinus: 0.40, Picea: 0.30, Pseudotsuga: 0.12, Larix: 0.12, Abies: 0.06 };

export function normalize(mix) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  if (!total) return {};
  const out = {};
  for (const [k, v] of Object.entries(mix)) if (v > 0) out[k] = v / total;
  return out;
}

export function blend(a, b, wa) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[k] = (a[k] || 0) * wa + (b[k] || 0) * (1 - wa);
  }
  return normalize(out);
}

// IGN BD Forêt V2 "essence" attribute -> composition.
// `local` = the cell's broadleaf mix derived from GBIF + prior.
export function compositionFromBdForet(essence, tfv, local) {
  const e = (essence || '').toLowerCase();
  const conifers = CONIFER_PRIOR;
  if (e.includes('chêne') && e.includes('sempervirent')) return null; // evergreen oak, not in the north
  if (e.includes('chêne')) return { Quercus: 1 };
  if (e.includes('hêtre')) return { Fagus: 1 };
  if (e.includes('châtaignier')) return { Castanea: 1 };
  if (e.includes('peuplier')) return { Populus: 1 };
  if (e.includes('robinier')) return { Robinia: 1 };
  if (e.includes('mélèze')) return { Larix: 1 };
  if (e.includes('douglas')) return { Pseudotsuga: 1 };
  if (e.includes('sapin') || e.includes('épicéa')) return { Picea: 0.7, Abies: 0.3 };
  if (e.includes('pin')) return { Pinus: 1 };
  if (e.includes('conifère')) return conifers;
  if (e.includes('mixte')) {
    const conifPrep = (tfv || '').toLowerCase().includes('conifères prépondérants');
    return blend(local, conifers, conifPrep ? 0.35 : 0.7);
  }
  if (e.includes('feuillu')) return local;
  return null; // NC / NR: heath, grassland, clearings
}

// OSM tags -> composition.
const OSM_GENUS = {
  quercus: 'Quercus', fagus: 'Fagus', carpinus: 'Carpinus', acer: 'Acer', betula: 'Betula',
  fraxinus: 'Fraxinus', populus: 'Populus', castanea: 'Castanea', tilia: 'Tilia', alnus: 'Alnus',
  salix: 'Salix', aesculus: 'Aesculus', prunus: 'Prunus', sorbus: 'Sorbus', robinia: 'Robinia',
  ulmus: 'Ulmus', platanus: 'Platanus', larix: 'Larix', pinus: 'Pinus', picea: 'Picea',
  abies: 'Abies', pseudotsuga: 'Pseudotsuga',
};

export function compositionFromOsm(tags, local) {
  const g = (tags.genus || tags.species || tags['taxon'] || '').toLowerCase().split(/[\s;]/)[0];
  if (OSM_GENUS[g]) return { [OSM_GENUS[g]]: 1 };
  switch (tags.leaf_type) {
    case 'broadleaved': return local;
    case 'needleleaved': return tags.leaf_cycle === 'deciduous' ? { Larix: 1 } : CONIFER_PRIOR;
    case 'mixed': return blend(local, CONIFER_PRIOR, 0.6);
    default: return blend(local, CONIFER_PRIOR, 0.85); // untagged: assume mostly broadleaved
  }
}

// SPW Wallonia "forêts actuelles" classes.
// Ancient sub-natural forests in Wallonia are mostly beech / oak / hornbeam.
const WALLOON_ANCIENT = { Fagus: 0.4, Quercus: 0.4, Carpinus: 0.2 };
export function compositionFromWallonia(classCode, local) {
  switch (classCode) {
    case 1: return blend(WALLOON_ANCIENT, local, 0.6);
    case 4: return local;
    case 2: case 3: case 5: return CONIFER_PRIOR;
    default: return null; // 0 = cleared
  }
}

// Flanders Bosreferentielaag BMS (boomsoort) codes. The layer ships without
// a code list; this reading follows the 1990 Boskartering legend structure
// (1x broadleaved, 2x broadleaved-dominated mixed, 3x conifer-dominated
// mixed, 4x conifers) and was sanity-checked on known forests (Sonian Forest
// = 11 beech, Kempen pine heaths = 42, Scheldt valley poplar = 13).
export function compositionFromFlanders(bms, local) {
  const group = Math.floor(bms / 10);
  if (bms === 11) return { Fagus: 1 };
  if (bms === 12) return { Quercus: 1 };
  if (bms === 13) return { Populus: 1 };
  if (group === 1) return local;
  if (group === 2) return blend(local, CONIFER_PRIOR, 0.7);
  if (group === 3) return blend(local, CONIFER_PRIOR, 0.35);
  if (group === 4) return bms === 46 ? { Larix: 1 } : bms === 42 || bms === 43 ? { Pinus: 1 } : CONIFER_PRIOR;
  return null; // 0 / 50 / 70...: unknown, clearing, non-forest
}

export function compositionOf(forest, local) {
  switch (forest.kind) {
    case 'bdforet': return compositionFromBdForet(forest.essence, forest.tfv, local);
    case 'wallonia': return compositionFromWallonia(forest.classCode, local);
    case 'flanders': return compositionFromFlanders(forest.bms, local);
    default: return compositionFromOsm(forest.tags || {}, local);
  }
}
