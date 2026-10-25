import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLength, accumulate, genusState, canopy, milestones } from '../js/phenology.js';
import { extendWithNormals, seasonFor, adjustNormals } from '../js/data/weather.js';
import { mixFromCounts } from '../js/data/gbif.js';
import { compositionFromBdForet, compositionFromOsm } from '../js/species.js';

const season = (tmean, from = '2025-07-01', to = '2025-12-31') => {
  const days = [];
  for (let d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, tmean: typeof tmean === 'function' ? tmean(iso) : tmean, tmin: 0 });
  }
  return days;
};
// rough N-France seasonal cycle: 18°C in early Aug falling to ~5°C late Dec
const typical = (iso) => 18 - Math.max(0, (Date.parse(iso) - Date.parse('2025-08-01')) / 86400000) * 0.085;

test('day length at 50°N', () => {
  assert.ok(Math.abs(dayLength(50, 172) - 16.3) < 0.3);
  assert.ok(Math.abs(dayLength(50, 355) - 8.1) < 0.3);
});

test('colder autumn colours earlier than warmer one', () => {
  const cold = milestones('Fagus', accumulate(50.5, season((d) => typical(d) - 2)));
  const warm = milestones('Fagus', accumulate(50.5, season((d) => typical(d) + 2)));
  assert.ok(cold.peak < warm.peak, `${cold.peak} < ${warm.peak}`);
});

test('typical year: beech peaks in October, oak after beech, birch before', () => {
  const s = accumulate(50.5, season(typical));
  const beech = milestones('Fagus', s), oak = milestones('Quercus', s), birch = milestones('Betula', s);
  assert.match(beech.peak, /-10-/);
  assert.ok(oak.peak > beech.peak && birch.peak < beech.peak);
});

test('genus stages progress green -> peak -> bare', () => {
  assert.equal(genusState('Fagus', 0).stage, 'green');
  assert.equal(genusState('Fagus', 300).stage, 'peak');
  assert.equal(genusState('Fagus', 1000).stage, 'bare');
  assert.equal(genusState('Pinus', 1000).stage, 'evergreen');
});

test('canopy of a pine stand stays green, beech goes bare', () => {
  assert.equal(canopy({ Pinus: 1 }, 2000).foliage, 1);
  assert.ok(canopy({ Fagus: 1 }, 2000).foliage < 0.05);
});

test('outlook continues the series to season end', () => {
  const norm = {};
  for (const d of season(10)) norm[d.date.slice(5)] = { tmean: 10, tmin: 5 };
  const entry = { days: season(12, '2025-07-01', '2025-10-20') };
  const ext = extendWithNormals(entry, norm, '2025-12-31');
  assert.equal(ext.at(-1).date, '2025-12-31');
  assert.equal(ext.at(-1).src, 'outlook');
  assert.ok(Math.abs(ext.at(-1).tmean - 10) < 0.1, 'recent anomaly decays to normal');
  const far = extendWithNormals(entry, norm, '2025-12-31', { keepOffset: true });
  assert.ok(Math.abs(far.at(-1).tmean - 12) < 0.01, 'keeps the offset from distant normals');
});

test('normals adjusted for elevation', () => {
  const adj = adjustNormals({ elevation: 100, days: { '10-01': { tmean: 12, tmin: 8, p10: 9, p90: 15 } } }, 600);
  assert.ok(Math.abs(adj['10-01'].tmean - (12 - 3.25)) < 1e-9);
});

test('senescence cannot start before the season window opens', () => {
  // day length must still be above the 13.5 h threshold on 15 Aug at 45-55°N
  for (const lat of [45, 50, 55]) assert.ok(dayLength(lat, 227) > 13.5, `lat ${lat}`);
});

test('season boundaries', () => {
  assert.equal(seasonFor('2026-10-24').year, 2026);
  assert.equal(seasonFor('2026-03-01').year, 2025);
});

test('GBIF mix blends with prior and handles no data', () => {
  const empty = mixFromCounts({});
  assert.ok(empty.broadleaf.Quercus > 0.25);
  const m = mixFromCounts({ Acer: 5000, Pinus: 100 });
  assert.ok(m.broadleaf.Acer < 0.6, 'GBIF weight capped');
  const sum = Object.values(m.overall).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('BD Forêt and OSM mappings', () => {
  assert.deepEqual(compositionFromBdForet('Hêtre', '', {}), { Fagus: 1 });
  assert.deepEqual(compositionFromBdForet('Chênes décidus', '', {}), { Quercus: 1 });
  assert.equal(compositionFromBdForet('NC', 'Lande', {}), null);
  assert.deepEqual(compositionFromOsm({ genus: 'Fagus' }, {}), { Fagus: 1 });
  assert.deepEqual(compositionFromOsm({ leaf_type: 'needleleaved', leaf_cycle: 'deciduous' }, {}), { Larix: 1 });
});
