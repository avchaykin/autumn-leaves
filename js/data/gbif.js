// Local tree-genus mix from GBIF occurrence records (open data, CC0/CC BY).
// One faceted count query per cell: how many observations of each tree
// genus were recorded inside the cell since 2000.

import { SPECIES, BROADLEAF, CONIFER, BROADLEAF_PRIOR, CONIFER_PRIOR, normalize, blend } from '../species.js';
import { cached, pool } from './cache.js';

const API = 'https://api.gbif.org/v1/occurrence/search';
const keyToGenus = new Map(Object.entries(SPECIES).map(([g, s]) => [String(s.gbif), g]));

// Pre-built counts for the start region (scripts/build-gbif-cache.mjs),
// so the first view doesn't need dozens of API calls.
let bundled = null;
const bundledReady = fetch(new URL('../../data/gbif-genus-counts.json', import.meta.url))
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => { bundled = j?.cells || null; })
  .catch(() => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function gbifQuery(bounds) {
  const { s, w, n, e } = bounds;
  const poly = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  const params = new URLSearchParams({
    geometry: poly,
    year: '2000,2100',
    occurrenceStatus: 'PRESENT',
    facet: 'genusKey',
    facetLimit: '40',
    limit: '0',
  });
  for (const sp of Object.values(SPECIES)) params.append('taxonKey', sp.gbif);
  return `${API}?${params}`;
}

export function parseFacets(json) {
  const counts = {};
  for (const c of json.facets?.[0]?.counts || []) {
    const g = keyToGenus.get(c.name);
    if (g) counts[g] = c.count;
  }
  return counts;
}

async function genusCounts(cell) {
  await bundledReady;
  if (bundled?.[cell.key]) return bundled[cell.key];
  const key = `gbif:${cell.id}`;
  const hit = cached.get(key);
  if (hit) return hit;
  // GBIF answers 429 to bursts: back off and retry
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(gbifQuery(cell.bounds));
    if (res.status === 429 && attempt < 5) { await sleep(800 * 2 ** attempt + Math.random() * 400); continue; }
    if (!res.ok) throw new Error(`GBIF ${res.status}`);
    const counts = parseFacets(await res.json());
    cached.set(key, counts);
    return counts;
  }
}

// Turn raw counts into the compositions the model uses.
// GBIF is dominated by park/street trees, so it is blended with the forest
// inventory prior; the more records, the more weight GBIF gets (max 50%).
export function mixFromCounts(counts, { failed = false } = {}) {
  const broad = {}, conif = {};
  let nb = 0, nc = 0;
  for (const [g, n] of Object.entries(counts)) {
    if (BROADLEAF.includes(g)) { broad[g] = n; nb += n; }
    else if (CONIFER.includes(g)) { conif[g] = n; nc += n; }
  }
  const wb = 0.5 * nb / (nb + 300);
  const wc = 0.5 * nc / (nc + 100);
  const broadleaf = nb ? blend(normalize(broad), BROADLEAF_PRIOR, wb) : { ...BROADLEAF_PRIOR };
  const conifer = nc ? blend(normalize(conif), CONIFER_PRIOR, wc) : { ...CONIFER_PRIOR };
  // overall mix for areas without forest polygons: conifer share from GBIF,
  // kept in a plausible lowland range
  const coniferShare = Math.min(0.5, Math.max(0.05, nb + nc ? nc / (nb + nc) : 0.1));
  return {
    records: failed ? null : nb + nc, // null = unknown (lookup failed)
    broadleaf: normalize(broadleaf),
    conifer,
    overall: blend(broadleaf, conifer, 1 - coniferShare),
  };
}

export async function cellMixes(cells, onProgress) {
  let done = 0;
  const res = await pool(cells, 2, async (c) => {
    let mix;
    try { mix = mixFromCounts(await genusCounts(c)); } catch { mix = mixFromCounts({}, { failed: true }); }
    onProgress?.(++done, cells.length);
    return [c.id, mix];
  });
  return new Map(res);
}
