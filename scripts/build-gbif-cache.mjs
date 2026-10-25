// Pre-fetch GBIF tree-genus counts for a region into data/gbif-genus-counts.json.
// Usage: node scripts/build-gbif-cache.mjs [south west north east]
// Default region: northern France, Belgium, Luxembourg and borders.
import { writeFileSync } from 'node:fs';
import { gbifQuery, parseFacets } from '../js/data/gbif.js';

const MIX = 0.5; // must match MIX in js/main.js
const [s, w, n, e] = process.argv.length > 5 ? process.argv.slice(2, 6).map(Number) : [48.5, 1, 52, 7];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cells = {};
for (let y = Math.floor(s / MIX); y * MIX < n; y++) {
  for (let x = Math.floor(w / MIX); x * MIX < e; x++) {
    const bounds = { s: y * MIX, w: x * MIX, n: (y + 1) * MIX, e: (x + 1) * MIX };
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(gbifQuery(bounds), { headers: { 'User-Agent': 'autumn-leaves-map/0.1 (open data build script)' } });
      if (res.status === 429 && attempt < 6) { await sleep(2000 * 2 ** attempt); continue; }
      if (!res.ok) throw new Error(`GBIF ${res.status} for ${x}:${y}`);
      cells[`${x}:${y}`] = parseFacets(await res.json());
      break;
    }
    process.stdout.write('.');
    await sleep(500);
  }
}
writeFileSync(new URL('../data/gbif-genus-counts.json', import.meta.url), JSON.stringify({
  source: 'GBIF.org occurrence search, facet genusKey, year>=2000',
  created: new Date().toISOString().slice(0, 10),
  cellSize: MIX,
  region: { s, w, n, e },
  cells,
}));
console.log(`\n${Object.keys(cells).length} cells written`);
