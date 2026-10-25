// Pre-compute daily temperature normals per 1° cell into data/normals-1deg.json,
// so the start region needs no 10-year archive requests in the browser.
// Usage: node scripts/build-normals.mjs [south west north east]
// Costs ~100 Open-Meteo call-units per cell; requests are paced automatically.
import { writeFileSync } from 'node:fs';
import { normals, normalsBaseline, addDays, onRateWait } from '../js/data/weather.js';

const [s, w, n, e] = process.argv.length > 5 ? process.argv.slice(2, 6).map(Number) : [49, 1, 52, 7];
const FROM = '08-15'; // must match SEASON_FROM in js/data/weather.js
const baseline = normalsBaseline(new Date().toISOString().slice(0, 10));
onRateWait((msg) => msg && console.log('\n' + msg));

const cells = {};
for (let y = Math.floor(s); y < n; y++) {
  for (let x = Math.floor(w); x < e; x++) {
    const norm = await normals(y + 0.5, x + 0.5, baseline);
    const d = [];
    for (let md = `2001-${FROM}`; md <= '2001-12-31'; md = addDays(md, 1)) {
      const v = norm.days[md.slice(5)];
      d.push([v.tmean, v.tmin, v.p10, v.p90]);
    }
    cells[`${x}:${y}`] = { elevation: norm.elevation, d };
    process.stdout.write('.');
  }
}
writeFileSync(new URL('../data/normals-1deg.json', import.meta.url), JSON.stringify({
  source: 'Open-Meteo Historical Weather API (ERA5), daily mean/min 2 m temperature, ±3-day window',
  created: new Date().toISOString().slice(0, 10),
  baseline, from: FROM, cellSize: 1, region: { s, w, n, e }, cells,
}));
console.log(`\n${Object.keys(cells).length} cells written, baseline ${baseline.join('–')}`);
