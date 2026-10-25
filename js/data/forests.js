// Forest polygons with their tree type, from official open forest maps:
//  France:    IGN BD Forêt® V2, Géoplateforme WFS (Licence Ouverte 2.0) —
//             "essence" = dominant species group per polygon.
//  Wallonia:  SPW "Ancienneté des forêts actuelles" (ArcGIS REST, geoportail.wallonie.be)
//             — broadleaved / conifer / ancient sub-natural forest.
//  Flanders:  ANB Bosreferentielaag, Digitaal Vlaanderen WFS (Modellicentie gratis
//             hergebruik) — BMS tree-species code.
//  Fallback:  OpenStreetMap landuse=forest / natural=wood via Overpass (ODbL),
//             only used where none of the above returned anything.

import { pool } from './cache.js';

export const TILE = 0.1; // degrees
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const tileCache = new Map(); // tileId -> {official:[...], osm:[...]|undefined}

export function tilesFor(bounds) {
  const out = [];
  for (let y = Math.floor(bounds.s / TILE); y * TILE < bounds.n; y++) {
    for (let x = Math.floor(bounds.w / TILE); x * TILE < bounds.e; x++) {
      out.push({ id: `${x}:${y}`, s: +(y * TILE).toFixed(4), w: +(x * TILE).toFixed(4), n: +((y + 1) * TILE).toFixed(4), e: +((x + 1) * TILE).toFixed(4) });
    }
  }
  return out;
}

const timeout = () => AbortSignal.timeout(45000);

async function bdForet(t) {
  const params = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    TYPENAMES: 'LANDCOVER.FORESTINVENTORY.V2:formation_vegetale',
    OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:4326', COUNT: '5000',
    BBOX: `${t.s},${t.w},${t.n},${t.e},urn:ogc:def:crs:EPSG::4326`,
  });
  const res = await fetch(`https://data.geopf.fr/wfs/ows?${params}`, { signal: timeout() });
  if (!res.ok) throw new Error(`IGN WFS ${res.status}`);
  const json = await res.json();
  return (json.features || [])
    .filter((f) => f.geometry && !['NC', 'NR'].includes(f.properties.essence))
    .map((f) => ({
      id: 'bdf:' + f.properties.id,
      kind: 'bdforet',
      source: 'IGN BD Forêt V2',
      rings: polygonsToRings(f.geometry),
      essence: f.properties.essence,
      tfv: f.properties.tfv,
    }));
}

async function wallonia(t) {
  const url = 'https://geoservices.wallonie.be/arcgis/rest/services/FORET/FORETANC/MapServer/2/query';
  const out = [];
  for (let offset = 0; offset < 10000; offset += 2000) {
    const params = new URLSearchParams({
      where: 'CLASS_CODE > 0', geometry: `${t.w},${t.s},${t.e},${t.n}`, geometryType: 'esriGeometryEnvelope',
      inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,CLASS_CODE,CLASS_DESC',
      maxAllowableOffset: '0.00005', resultOffset: String(offset), resultRecordCount: '2000', f: 'geojson',
    });
    const res = await fetch(`${url}?${params}`, { signal: timeout() });
    if (!res.ok) throw new Error(`Wallonia ${res.status}`);
    const json = await res.json();
    const feats = (json.features || []).filter((f) => f.geometry);
    for (const f of feats) {
      out.push({
        id: 'wal:' + f.properties.OBJECTID,
        kind: 'wallonia',
        source: 'SPW Wallonie – forêts actuelles',
        rings: polygonsToRings(f.geometry),
        classCode: f.properties.CLASS_CODE,
        classDesc: f.properties.CLASS_DESC,
      });
    }
    if ((json.features || []).length < 2000) break;
  }
  return out;
}

async function flanders(t) {
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'Bosref:Bos',
    outputFormat: 'application/json', srsName: 'EPSG:4326', count: '5000', propertyName: 'UIDN,BMS,SHAPE',
    bbox: `${t.s},${t.w},${t.n},${t.e},urn:ogc:def:crs:EPSG::4326`,
  });
  const res = await fetch(`https://geo.api.vlaanderen.be/Bosref/wfs?${params}`, { signal: timeout() });
  if (!res.ok) throw new Error(`Flanders WFS ${res.status}`);
  const json = await res.json();
  return (json.features || [])
    .filter((f) => f.geometry)
    .map((f) => ({
      id: 'vl:' + (f.properties.UIDN ?? f.id),
      kind: 'flanders',
      source: 'ANB Bosreferentielaag (Vlaanderen)',
      rings: polygonsToRings(f.geometry),
      bms: f.properties.BMS,
    }));
}

// Rough extents, only to avoid pointless requests.
const SOURCES = [
  { name: 'IGN', fetch: bdForet, box: { s: 41.3, w: -5.2, n: 51.1, e: 9.6 } },
  { name: 'Wallonia', fetch: wallonia, box: { s: 49.45, w: 2.8, n: 50.85, e: 6.45 } },
  { name: 'Flanders', fetch: flanders, box: { s: 50.65, w: 2.5, n: 51.55, e: 5.95 } },
];
const overlaps = (a, b) => a.s < b.n && a.n > b.s && a.w < b.e && a.e > b.w;

function polygonsToRings(g) {
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  // Leaflet wants [lat, lon]; keep holes so clearings stay uncoloured
  return polys.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x])));
}

async function overpass(bounds) {
  const bb = `${bounds.s},${bounds.w},${bounds.n},${bounds.e}`;
  const q = `[out:json][timeout:50];(way["landuse"="forest"](${bb});way["natural"="wood"](${bb});relation["landuse"="forest"](${bb});relation["natural"="wood"](${bb}););out geom qt;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function osmToForests(json) {
  const out = [];
  for (const el of json.elements || []) {
    if (el.type === 'way' && el.geometry?.length > 3) {
      out.push({ id: 'osm:w' + el.id, kind: 'osm', source: 'OpenStreetMap', tags: el.tags || {}, rings: [[el.geometry.map((p) => [p.lat, p.lon])]] });
    } else if (el.type === 'relation') {
      const outers = joinWays(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry));
      const inners = joinWays(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry));
      if (outers.length) {
        // holes are attached to the first outer ring; good enough for display
        out.push({ id: 'osm:r' + el.id, kind: 'osm', source: 'OpenStreetMap', tags: el.tags || {}, rings: outers.map((o, i) => (i === 0 ? [o, ...inners] : [o])) });
      }
    }
  }
  return out;
}

// Join multipolygon member ways into closed rings.
function joinWays(members) {
  const segs = members.map((m) => m.geometry.map((p) => [p.lat, p.lon]));
  const rings = [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (segs.length) {
    let ring = segs.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = ring[ring.length - 1];
        if (same(s[0], end)) ring = ring.concat(s.slice(1));
        else if (same(s[s.length - 1], end)) ring = ring.concat(s.slice(0, -1).reverse());
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

export function centroid(f) {
  const ring = f.rings[0][0];
  let la = 0, lo = 0;
  for (const [a, b] of ring) { la += a; lo += b; }
  return [la / ring.length, lo / ring.length];
}

function pointInRing([lat, lon], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, oi] = ring[i], [aj, oj] = ring[j];
    if ((ai > lat) !== (aj > lat) && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) inside = !inside;
  }
  return inside;
}

// The forest polygon containing a point, if any.
export function forestAt(lat, lon, forests) {
  return forests.find((f) => {
    const b = f.bbox || (f.bbox = bboxOf(f));
    return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e && f.rings.some((p) => pointInRing([lat, lon], p[0]));
  });
}

function bboxOf(f) {
  let s = 90, n = -90, w = 180, e = -180;
  for (const poly of f.rings) for (const [la, lo] of poly[0]) {
    if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo;
  }
  return { s, n, w, e };
}

function dedupe(osm, bdf) {
  if (!bdf.length) return osm;
  const boxes = bdf.map((f) => [f, f.bbox || (f.bbox = bboxOf(f))]);
  return osm.filter((o) => {
    const c = centroid(o);
    return !boxes.some(([f, b]) => c[0] >= b.s && c[0] <= b.n && c[1] >= b.w && c[1] <= b.e && f.rings.some((p) => pointInRing(c, p[0])));
  });
}

// Fetch forests for the given bounds. Returns { forests, errors }.
// `onPartial(forests)` is called as each tile arrives, so the map fills in
// progressively instead of waiting for every tile and the OSM fallback.
export async function forestsIn(bounds, onProgress, onPartial) {
  const tiles = tilesFor(bounds);
  const errors = [];
  const todo = tiles.filter((t) => !tileCache.has(t.id));
  let done = 0;
  await pool(todo, 4, async (t) => {
    const parts = await Promise.all(SOURCES.filter((src) => overlaps(t, src.box)).map((src) =>
      src.fetch(t).catch((e) => { errors.push(`${src.name}: ${e.message}`); return []; })));
    const official = parts.flat();
    // OSM only where no official forest map has data
    tileCache.set(t.id, { official, osm: official.length ? [] : undefined, tile: t });
    onProgress?.(++done, todo.length);
    onPartial?.(collect(tiles)); // draw this tile without waiting for the rest
  });

  const needOsm = tiles.filter((t) => tileCache.get(t.id).osm === undefined);
  if (needOsm.length) {
    onPartial?.(collect(tiles));
    const u = needOsm.reduce((a, t) => ({ s: Math.min(a.s, t.s), w: Math.min(a.w, t.w), n: Math.max(a.n, t.n), e: Math.max(a.e, t.e) }), { s: 90, w: 180, n: -90, e: -180 });
    try {
      const osm = osmToForests(await overpass(u));
      const fresh = new Set(needOsm.map((t) => t.id));
      for (const t of needOsm) tileCache.get(t.id).osm = [];
      // assign each OSM polygon to the tile holding its centroid
      for (const f of osm) {
        const c = centroid(f);
        const id = `${Math.floor(c[1] / TILE)}:${Math.floor(c[0] / TILE)}`;
        if (fresh.has(id)) tileCache.get(id).osm.push(f);
      }
      for (const t of needOsm) {
        const entry = tileCache.get(t.id);
        // a polygon can straddle tiles; check against BD Forêt of neighbours too
        const near = tilesFor({ s: t.s - TILE, w: t.w - TILE, n: t.n + TILE, e: t.e + TILE })
          .flatMap((n) => tileCache.get(n.id)?.official || []);
        entry.osm = dedupe(entry.osm, near);
      }
    } catch (e) {
      errors.push('OpenStreetMap: ' + e.message + ' (rate-limited? try again in a minute)');
    }
  }

  return { forests: collect(tiles), errors };
}

function collect(tiles) {
  const seen = new Set();
  const forests = [];
  for (const t of tiles) {
    const entry = tileCache.get(t.id);
    if (!entry) continue; // still loading
    for (const f of [...entry.official, ...(entry.osm || [])]) {
      if (seen.has(f.id)) continue; // BD Forêt polygons can be returned for several tiles
      seen.add(f.id);
      forests.push(f);
    }
  }
  return forests;
}
