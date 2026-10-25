import { SPECIES, compositionOf } from './species.js';
import { accumulate, canopy, milestones, genusState } from './phenology.js';
import { leafSvg } from './leaves.js';
import { seasonFor, seasonSeries, normals, normalsBaseline, adjustNormals, extendWithNormals, normalSeries, addDays, onRateWait } from './data/weather.js';
import { cellMixes, mixFromCounts } from './data/gbif.js';
import { forestsIn, centroid, forestAt } from './data/forests.js';
import { temperatureChart, fmtDate } from './chart.js';

const MIX = 0.5;          // GBIF species-mix grid, degrees
const FINE = 0.25;        // finest weather / model grid, degrees
// Coarser grid when zoomed out keeps the number of weather points within
// Open-Meteo's free tier (each location counts as a separate call).
const gridStep = (z) => (z <= 7 ? 2 : z <= 8 ? 1 : z <= 9 ? 0.5 : FINE);
const FOREST_ZOOM = 12;   // show individual forest polygons from this zoom
const MAX_CELLS = 150;
const VIEW_FROM = '09-01', VIEW_TO = '12-15';

const $ = (id) => document.getElementById(id);
const realToday = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local

// ---------------------------------------------------------------- state
const state = {
  season: seasonFor(realToday),
  asOf: realToday,          // "today" for the chosen season (season end for past ones)
  date: realToday,
  cells: new Map(),         // wx cell id -> {id, lat, lon, bounds, mixId, S: Float32Array, days}
  mixes: new Map(),         // mix cell id -> {broadleaf, conifer, overall, records}
  forests: [],
  lastForecast: null,
  regionNormals: new Map(),
};

// ---------------------------------------------------------------- map
const map = L.map('map', { preferCanvas: true, zoomControl: false, minZoom: 6 });
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, className: 'basemap',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Weather <a href="https://open-meteo.com/">Open-Meteo</a> · Trees <a href="https://www.gbif.org/">GBIF</a>, <a href="https://geoservices.ign.fr/bdforet">IGN BD Forêt</a>, OSM',
}).addTo(map);
const renderer = L.canvas({ padding: 0.3 });
const gridLayer = L.layerGroup().addTo(map);
const forestLayer = L.layerGroup().addTo(map);

const initial = parseHash();
map.setView(initial.center || [50.45, 3.6], initial.zoom || 8);
if (initial.date) state.date = initial.date;

// ---------------------------------------------------------------- season & date controls
function setupSeasonSelect() {
  const sel = $('season');
  const current = seasonFor(realToday).year;
  for (let y = current; y >= current - 8; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y === current ? `${y} (current)` : y;
    sel.append(o);
  }
  sel.value = state.season.year;
  sel.addEventListener('change', () => {
    const y = +sel.value;
    state.season = seasonFor(`${y}-10-01`);
    // past seasons: "today" just after the season so all of it counts as observed
    state.asOf = y === current ? realToday : `${y + 1}-01-02`;
    state.date = clampDate(`${y}-${state.date.slice(5)}`);
    state.cells.clear();
    state.forests.forEach((f) => { delete f.comp; delete f.compKey; });
    clearForests();
    setupSlider();
    refresh();
  });
}

const sliderFrom = () => `${state.season.year}-${VIEW_FROM}`;
const sliderTo = () => `${state.season.year}-${VIEW_TO}`;
const dayIndex = (iso, from = sliderFrom()) => Math.round((Date.parse(iso) - Date.parse(from)) / 86400000);
const clampDate = (iso) => (iso < sliderFrom() ? sliderFrom() : iso > sliderTo() ? sliderTo() : iso);

function setupSlider() {
  const s = $('date');
  s.min = 0;
  s.max = dayIndex(sliderTo());
  state.date = clampDate(state.date.startsWith(String(state.season.year)) ? state.date : `${state.season.year}-${state.date.slice(5)}`);
  s.value = dayIndex(state.date);
  drawSliderZones();
  drawSliderTicks();
  updateDateLabel();
}

// Month marks under the slider so a date can be found without dragging.
function drawSliderTicks() {
  const total = dayIndex(sliderTo());
  const y = state.season.year;
  // fixed labels: en-GB's short September is "Sept", which looks off next to "Oct"
  $('slider-ticks').innerHTML = [['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec']]
    .map(([m, label]) => `<span style="left:${(dayIndex(`${y}-${m}-01`) / total) * 100}%">${label}</span>`)
    .join('');
}

function drawSliderZones() {
  const total = dayIndex(sliderTo());
  const obsEnd = Math.max(0, Math.min(total, dayIndex(state.asOf)));
  const fcEnd = state.lastForecast ? Math.min(total, dayIndex(state.lastForecast)) : obsEnd;
  $('slider-zones').innerHTML =
    `<i class="observed" style="width:${(obsEnd / total) * 100}%"></i>` +
    `<i class="forecast" style="width:${(Math.max(0, fcEnd - obsEnd) / total) * 100}%"></i>` +
    `<i class="outlook" style="flex:1"></i>`;
}

function dateKind(d) {
  if (d <= state.asOf) return 'observed';
  if (state.lastForecast && d <= state.lastForecast) return 'forecast';
  return 'outlook';
}

function updateDateLabel() {
  $('date-label').textContent = fmtDate(state.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const kind = dateKind(state.date);
  const badge = $('date-kind');
  badge.className = 'badge ' + kind;
  badge.textContent = { observed: 'Observed', forecast: 'Forecast', outlook: 'Outlook' }[kind];
  badge.title = {
    observed: 'Computed from measured temperatures',
    forecast: 'Uses the 16-day weather forecast',
    outlook: 'Beyond the forecast: uses 10-year normal temperatures',
  }[kind];
}

// Dragging fires input events faster than frames: update the label at once,
// repaint the map and detail panel at most once per frame.
let dateFrame = 0;
$('date').addEventListener('input', (e) => {
  state.date = addDays(sliderFrom(), +e.target.value);
  updateDateLabel();
  if (dateFrame) return;
  dateFrame = requestAnimationFrame(() => {
    dateFrame = 0;
    recolor();
    if (detailCtx) renderDetailDate(detailCtx);
    writeHash();
  });
});
$('today').addEventListener('click', () => {
  state.date = clampDate(state.asOf);
  $('date').value = dayIndex(state.date);
  $('date').dispatchEvent(new Event('input'));
});
let playTimer = null;
$('play').addEventListener('click', () => {
  const btn = $('play');
  if (playTimer) { stopPlay(); return; }
  btn.classList.add('playing'); btn.querySelector('span').textContent = 'Pause'; btn.setAttribute('aria-pressed', 'true');
  const s = $('date');
  if (+s.value >= +s.max) s.value = 0;
  playTimer = setInterval(() => {
    if (+s.value >= +s.max) { stopPlay(); return; }
    s.value = +s.value + 1;
    s.dispatchEvent(new Event('input'));
  }, 120);
});
function stopPlay() {
  clearInterval(playTimer); playTimer = null;
  const btn = $('play');
  btn.classList.remove('playing'); btn.querySelector('span').textContent = 'Play'; btn.setAttribute('aria-pressed', 'false');
}

// ---------------------------------------------------------------- status
const status = { msgs: {}, errors: new Set() };
function setStatus(key, msg) {
  if (msg) status.msgs[key] = msg; else delete status.msgs[key];
  const el = $('status');
  el.innerHTML = Object.values(status.msgs).join(' · ') +
    [...status.errors].map((e) => `<div class="err">${escapeHtml(e)}</div>`).join('');
}
function addError(e) { status.errors.add(e); setStatus(); }

// ---------------------------------------------------------------- grid
const cellId = (step, x, y) => `${step}/${x}:${y}`;

function cellsIn(b, step) {
  const out = [];
  for (let y = Math.floor(b.getSouth() / step); y * step < b.getNorth(); y++) {
    for (let x = Math.floor(b.getWest() / step); x * step < b.getEast(); x++) {
      const s = y * step, w = x * step;
      out.push({
        id: cellId(step, x, y), lat: s + step / 2, lon: w + step / 2,
        bounds: { s, w, n: s + step, e: w + step },
        mixId: `${Math.floor(w / MIX)}:${Math.floor(s / MIX)}`,
      });
    }
  }
  return out;
}

function mixCell(id) {
  const [x, y] = id.split(':').map(Number);
  const s = y * MIX, w = x * MIX;
  return { id: `m${MIX}:${id}`, key: id, bounds: { s, w, n: s + MIX, e: w + MIX } };
}

// Temperature normals per 1° region. The start area ships pre-computed
// (scripts/build-normals.mjs); elsewhere they are fetched once and cached.
const baseline = normalsBaseline(realToday);
let bundledNormals = null;
const bundledNormalsReady = fetch('data/normals-1deg.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    if (!j || j.baseline.join() !== baseline.join()) return;
    bundledNormals = {};
    for (const [k, c] of Object.entries(j.cells)) {
      const days = {};
      c.d.forEach(([tmean, tmin, p10, p90], i) => { days[addDays(`2001-${j.from}`, i).slice(5)] = { tmean, tmin, p10, p90 }; });
      bundledNormals[k] = { elevation: c.elevation, days };
    }
  })
  .catch(() => {});
const normKey = (lat, lon) => `${Math.floor(lon)}:${Math.floor(lat)}`;

async function regionNormals(lat, lon) {
  await bundledNormalsReady;
  const k = normKey(lat, lon);
  if (bundledNormals?.[k]) return bundledNormals[k];
  if (!state.regionNormals.has(k)) {
    const [x, y] = k.split(':').map(Number);
    const p = normals(y + 0.5, x + 0.5, baseline);
    p.catch(() => state.regionNormals.delete(k)); // allow a retry later
    state.regionNormals.set(k, p);
  }
  return state.regionNormals.get(k);
}

// Species mixes load in the background: cells first use the forest-inventory
// prior, then switch to the GBIF-informed mix as batches arrive.
async function loadMixes(ids) {
  const placeholder = { ...mixFromCounts({}, { failed: true }), pending: true };
  for (const id of ids) state.mixes.set(id, placeholder);
  for (let i = 0; i < ids.length; i += 8) {
    const batch = ids.slice(i, i + 8);
    const mixes = await cellMixes(batch.map(mixCell));
    for (const id of batch) {
      const m = mixes.get(`m${MIX}:${id}`);
      state.mixes.set(id, m);
      if (m.records === null) setTimeout(() => state.mixes.delete(id), 60000); // retry later
    }
    setStatus('gbif', i + 8 < ids.length ? `GBIF species mix ${Math.min(i + 8, ids.length)}/${ids.length}` : '');
    state.forests.forEach((f) => { delete f.comp; delete f.compKey; });
    if (state.forests.length) drawForests(); else drawGrid();
  }
}

function runModel(lat, entry, norm, { keepOffset = false } = {}) {
  const normDays = adjustNormals(norm, entry.elevation);
  const days = extendWithNormals(entry, normDays, state.season.end, { keepOffset });
  const series = accumulate(lat, days);
  const S = new Float32Array(dayIndex(state.season.end, state.season.start) + 1);
  for (const d of series) S[dayIndex(d.date, state.season.start)] = d.S;
  return { days, series, S, normDays };
}
const sAt = (cell, date) => cell.S[dayIndex(date, state.season.start)] ?? 0;

let refreshToken = 0;
async function refresh() {
  const token = ++refreshToken;
  const b = map.getBounds().pad(0.05);
  const want = cellsIn(b, gridStep(map.getZoom()));
  if (want.length > MAX_CELLS) {
    setStatus('load', 'Zoom in to compute leaf colours');
    gridLayer.clearLayers();
    return;
  }
  const missing = want.filter((c) => !state.cells.has(c.id));
  const mixIds = [...new Set(want.map((c) => c.mixId))].filter((id) => !state.mixes.has(id));
  if (mixIds.length) loadMixes(mixIds);

  // forests download in parallel with the weather and draw tile by tile
  const forestMode = map.getZoom() >= FOREST_ZOOM;
  const forestsDone = forestMode
    ? forestsIn(
      { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() },
      (d, n) => setStatus('load', `Loading forests ${d}/${n}…`),
      (partial) => {
        if (token !== refreshToken) return;
        state.forests = partial;
        drawForests();
      },
    )
    : null;

  try {
    if (missing.length) {
      setStatus('load', `Loading weather for ${missing.length} cells…`);
      const center = map.getCenter();
      const [wx, centerNorm] = await Promise.all([
        seasonSeries(missing, state.asOf),
        regionNormals(center.lat, center.lng),
      ]);
      for (const c of missing) {
        const entry = wx.get(c.id);
        if (!entry) continue;
        if (entry.lastForecast) state.lastForecast = entry.lastForecast;
        // own region's normals when available, else the view centre's plus
        // this cell's mean offset from them
        const own = bundledNormals?.[normKey(c.lat, c.lon)];
        state.cells.set(c.id, { ...c, ...runModel(c.lat, entry, own || centerNorm, { keepOffset: !own }) });
      }
      drawSliderZones();
      updateDateLabel();
    }
  } catch (e) {
    addError(e.message);
  }
  if (token !== refreshToken) return;
  drawGrid(want);

  if (forestsDone) {
    drawForests(); // polygons that arrived before their weather cell existed
    const { forests, errors } = await forestsDone;
    errors.forEach(addError);
    if (token !== refreshToken) return;
    state.forests = forests;
    drawForests();
  } else {
    clearForests();
    state.forests = [];
    drawGrid();
  }
  $('zoom-hint').hidden = map.getZoom() >= FOREST_ZOOM;
  setStatus('load', describeView());
}

function describeView() {
  const n = state.forests.length;
  return map.getZoom() >= FOREST_ZOOM ? `${n} forest polygons` : `${gridLayer.getLayers().length} cells of ${gridStep(map.getZoom())}°`;
}

let lastCells = [];
function drawGrid(cells = lastCells) {
  lastCells = cells;
  gridLayer.clearLayers();
  // with forest polygons on screen the grid only tints the background;
  // without any (no data / service down) it stays the main layer
  const forestMode = map.getZoom() >= FOREST_ZOOM && state.forests.length > 0;
  for (const c of cells) {
    const cell = state.cells.get(c.id);
    const mix = state.mixes.get(c.mixId);
    if (!cell || !mix || mix.records === 0) continue; // no tree records at all: open sea
    const rect = L.rectangle([[c.bounds.s, c.bounds.w], [c.bounds.n, c.bounds.e]], {
      renderer, weight: 0, fillOpacity: forestMode ? 0.08 : 0.62, interactive: !forestMode,
    });
    rect._cellId = c.id;
    gridLayer.addLayer(rect);
  }
  recolor();
}

function forestComposition(f, mix) {
  if (f.comp === undefined) { f.comp = compositionOf(f, mix.broadleaf); delete f.compKey; }
  return f.comp;
}

function cellAt(lat, lon) {
  return state.cells.get(cellId(FINE, Math.floor(lon / FINE), Math.floor(lat / FINE)));
}

// Incremental: called once per arriving tile, so only new polygons are
// created and polygons that left the view are removed.
const forestLayers = new Map(); // forest id -> Leaflet polygon
function clearForests() {
  forestLayer.clearLayers();
  forestLayers.clear();
}

function drawForests() {
  drawGrid();
  const keep = new Set();
  for (const f of state.forests) {
    if (!f.cellId) {
      const [lat, lon] = centroid(f);
      f.cellId = cellId(FINE, Math.floor(lon / FINE), Math.floor(lat / FINE));
    }
    const cell = state.cells.get(f.cellId);
    const mix = cell && state.mixes.get(cell.mixId);
    if (!mix) continue;
    if (!forestComposition(f, mix)) continue;
    keep.add(f.id);
    if (forestLayers.has(f.id)) continue;
    const poly = L.polygon(f.rings, { renderer, weight: 0.6, fillOpacity: 0.85, opacity: 0.5 });
    poly._forest = f;
    poly.on('click', (e) => { L.DomEvent.stopPropagation(e); openDetail({ latlng: e.latlng, forest: f }); });
    forestLayer.addLayer(poly);
    forestLayers.set(f.id, poly);
  }
  for (const [id, poly] of forestLayers) {
    if (!keep.has(id)) { forestLayer.removeLayer(poly); forestLayers.delete(id); }
  }
  recolor();
}

// Leaf reference: the genera around the map centre, each leaf drawn in its
// modelled colour for the selected date.
function stageText(st) {
  if (st.stage === 'evergreen' || st.stage === 'green' || st.stage === 'falling' || st.stage === 'bare') return st.stage;
  const pct = Math.round(st.coloured * 100);
  return pct < 100 ? `turning ${pct}%` : 'peak';
}
function renderSpecies() {
  const list = $('species-list');
  const c = map.getCenter();
  const cell = lastCells.map((x) => state.cells.get(x.id))
    .find((x) => x && c.lat >= x.bounds.s && c.lat < x.bounds.n && c.lng >= x.bounds.w && c.lng < x.bounds.e);
  const mix = cell && state.mixes.get(cell.mixId);
  if (!mix) { list.innerHTML = '<li class="empty">Loading…</li>'; return; }
  // zoomed in on a forest: show that stand's species instead of the regional mix
  const forest = state.forests.length ? forestAt(c.lat, c.lng, state.forests) : null;
  const comp = (forest && forest.comp) || mix.overall;
  $('species-title').textContent = forest && forest.comp ? 'Leaves in the forest at the map centre' : 'Leaves near the map centre';
  const S = sAt(cell, state.date);
  list.innerHTML = Object.entries(comp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9)
    .map(([genus, share]) => {
      const st = genusState(genus, S);
      const name = SPECIES[genus].name;
      const detail = stageText(st);
      return `<li class="${st.stage}" title="${name}: ${Math.round(share * 100)}% of trees here, ${detail}">
        ${leafSvg(genus, st.color, { size: 30 })}
        <span class="sp-name">${name}</span>
        <span class="sp-stage">${detail}</span>
      </li>`;
    }).join('');
}

// Thousands of polygons share a handful of (species mix, weather cell)
// pairs, so the canopy colour is computed once per pair and date.
function compKey(comp) {
  return Object.entries(comp).map(([g, v]) => g + v.toFixed(3)).join(',');
}

function recolor() {
  renderSpecies();
  const colors = new Map();
  const colorFor = (key, comp, cell) => {
    const k = key + '|' + cell.id;
    let c = colors.get(k);
    if (c === undefined) {
      c = canopy(comp, sAt(cell, state.date))?.color ?? null;
      colors.set(k, c);
    }
    return c;
  };
  const paint = (layer, color, withStroke) => {
    if (!color || layer._fill === color) return; // unchanged: skip the canvas redraw
    layer._fill = color;
    layer.setStyle(withStroke ? { fillColor: color, color } : { fillColor: color });
  };
  gridLayer.eachLayer((r) => {
    const cell = state.cells.get(r._cellId);
    const mix = cell && state.mixes.get(cell.mixId);
    if (mix) paint(r, colorFor('mix:' + cell.mixId + (mix.pending ? '?' : ''), mix.overall, cell), false);
  });
  forestLayer.eachLayer((p) => {
    const f = p._forest;
    const cell = state.cells.get(f.cellId);
    if (f.comp && cell) paint(p, colorFor(f.compKey || (f.compKey = compKey(f.comp)), f.comp, cell), true);
  });
}

// ---------------------------------------------------------------- detail panel
let detailCtx = null;
let detailToken = 0;

map.on('click', (e) => openDetail({ latlng: e.latlng }));
function closeDetail() {
  $('detail').hidden = true;
  document.body.classList.remove('detail-open');
  detailCtx = null;
  marker?.remove();
}
$('detail-close').addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('detail').hidden) closeDetail(); });

let marker = null;
async function openDetail({ latlng, forest }) {
  const token = ++detailToken;
  const { lat, lng: lon } = latlng;
  marker?.remove();
  marker = L.circleMarker(latlng, { radius: 6, weight: 2, color: '#fff', fillColor: '#222', fillOpacity: 1 }).addTo(map);
  $('detail').hidden = false;
  document.body.classList.add('detail-open');
  $('detail-body').innerHTML = '<div class="loading">Computing leaf colours for this place…</div>';
  try {
    const point = { id: `pt:${lat.toFixed(3)},${lon.toFixed(3)}`, lat, lon };
    const mixId = `${Math.floor(lon / MIX)}:${Math.floor(lat / MIX)}`;
    const [wx, norm, mixes, place] = await Promise.all([
      seasonSeries([point], state.asOf),
      regionNormals(lat, lon),
      state.mixes.has(mixId) ? null : cellMixes([mixCell(mixId)]),
      placeName(lat, lon),
    ]);
    if (mixes) state.mixes.set(mixId, mixes.get(`m${MIX}:${mixId}`));
    const mix = state.mixes.get(mixId);
    const entry = wx.get(point.id);
    const model = runModel(lat, entry, norm);
    const normalModel = { series: accumulate(lat, normalSeries(model.normDays, state.season)) };
    const composition = forest ? forestComposition(forest, mix) || mix.overall : mix.overall;
    if (token !== detailToken) return;
    detailCtx = { lat, lon, forest, mix, composition, model, normalModel, norm: model.normDays, place, elevation: entry.elevation };
    renderDetail(detailCtx);
  } catch (e) {
    if (token === detailToken) $('detail-body').innerHTML = `<div class="loading">Could not load data: ${escapeHtml(e.message)}</div>`;
  }
}

// The detail panel is built once per opened place; moving the date only
// refreshes the summary and table (renderDetailDate) and the chart marker.
function renderDetail(ctx) {
  const { composition, model, normalModel, forest, mix } = ctx;
  // date-independent parts, computed once
  ctx.best = bestDate(composition, model.series);
  ctx.milestones = new Map(Object.keys(composition).map((g) => [g, [milestones(g, model.series), milestones(g, normalModel.series)]]));

  const source = forest
    ? `${forest.source}: ${escapeHtml(forestSummary(forest))}`
    : `No forest selected — regional mix (GBIF ${mix.records == null ? 'unavailable' : `${mix.records.toLocaleString()} tree records`} in ${MIX}° cell + forest inventory prior)`;

  $('detail-body').innerHTML = `
    <h2>${escapeHtml(ctx.place || `${ctx.lat.toFixed(3)}, ${ctx.lon.toFixed(3)}`)}</h2>
    <div class="meta">${ctx.lat.toFixed(3)}°N, ${ctx.lon.toFixed(3)}°E${ctx.elevation != null ? ` · ${Math.round(ctx.elevation)} m` : ''}</div>
    <div class="hero" id="detail-hero"></div>
    <h3>Trees</h3>
    <div class="meta">${source}</div>
    <table>
      <thead><tr><th>Genus</th><th class="share">Share</th><th>Now</th><th>Peak</th><th>vs normal</th></tr></thead>
      <tbody id="detail-rows"></tbody>
    </table>
    <h3>Daily mean temperature</h3>
    <div class="chart" id="chart"></div>
    <div class="sources">
      Model: photoperiod × cold degree-day senescence (after Delpierre et al. 2009), started ${fmtDate(state.season.start)}.
      “vs normal” compares with the same model driven by ${baseline[0]}–${baseline[1]} daily normals (ERA5, adjusted to this elevation).
      Data: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (ERA5 + forecast),
      <a href="https://www.gbif.org/" target="_blank" rel="noopener">GBIF</a>,
      <a href="https://geoservices.ign.fr/bdforet" target="_blank" rel="noopener">IGN BD Forêt V2</a>,
      <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener">OpenStreetMap</a>.
    </div>`;
  ctx.chart = temperatureChart($('chart'), { days: model.days, norm: ctx.norm, from: state.season.start, to: sliderTo(), selected: state.date });
  renderDetailDate(ctx);
}

function renderDetailDate(ctx) {
  const S = ctx.model.series.find((d) => d.date === state.date)?.S ?? 0;
  const now = canopy(ctx.composition, S);
  const kind = dateKind(state.date);
  $('detail-hero').innerHTML = `
    <div class="chip" style="background:${now.color}"></div>
    <div>
      <div class="big">${headline(now)} on ${fmtDate(state.date)}</div>
      <div class="small">${Math.round(now.intensity * 100)}% of the deciduous canopy in colour · ${Math.round(now.foliage * 100)}% of leaves still on</div>
      <div class="small">${{ observed: 'From measured temperatures', forecast: 'Uses the weather forecast', outlook: 'Uses normal temperatures (beyond the forecast)' }[kind]}</div>
      ${ctx.best ? `<div class="best">Best colour around <strong>${fmtDate(ctx.best)}</strong></div>` : ''}
    </div>`;
  $('detail-rows').innerHTML = now.parts.filter((p) => p.share >= 0.02).map((p) => {
    const sp = SPECIES[p.genus];
    const [m, mn] = ctx.milestones.get(p.genus);
    let vs = '';
    if (m?.peak && mn?.peak) {
      const dd = dayIndex(m.peak, mn.peak);
      vs = dd === 0 ? 'normal' : `<span class="${dd < 0 ? 'early' : 'late'}">${Math.abs(dd)} d ${dd < 0 ? 'early' : 'late'}</span>`;
    }
    return `<tr>
      <td class="genus${p.stage === 'bare' ? ' fallen' : ''}">${leafSvg(p.genus, p.color, { size: 20 })}${sp.name}<span class="share-inline">${Math.round(p.share * 100)}%</span></td>
      <td class="share">${Math.round(p.share * 100)}%</td>
      <td>${stageText(p)}</td>
      <td>${m?.peak ? fmtDate(m.peak) : sp.evergreen ? '–' : '> Dec'}</td>
      <td>${vs || '–'}</td>
    </tr>`;
  }).join('');
  ctx.chart.setSelected(state.date);
}

function headline(c) {
  if (c.intensity < 0.05 && c.foliage > 0.9) return 'Still green';
  if (c.foliage < 0.25) return 'Mostly bare';
  if (c.intensity < 0.35) return 'Starting to turn';
  if (c.foliage < 0.6) return 'Past peak, leaves falling';
  return 'Autumn colours';
}

function bestDate(comp, series) {
  let best = null, score = 0.15;
  for (const d of series) {
    if (d.date < sliderFrom() || d.date > sliderTo()) continue;
    const c = canopy(comp, d.S);
    if (c.intensity > score) { score = c.intensity; best = d.date; }
  }
  return best;
}

function forestSummary(f) {
  if (f.kind === 'bdforet') return `${f.essence} — ${f.tfv}`;
  if (f.kind === 'wallonia') return f.classDesc;
  if (f.kind === 'flanders') return `species code BMS ${f.bms}`;
  const t = f.tags;
  const bits = [t.name, t.genus || t.species, t.leaf_type, t.leaf_cycle].filter(Boolean);
  return bits.length ? bits.join(', ') : 'forest (no species tags)';
}

const placeCache = new Map();
async function placeName(lat, lon) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (placeCache.has(k)) return placeCache.get(k);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&lat=${lat}&lon=${lon}`, { headers: { 'Accept-Language': 'en' } });
    const j = await res.json();
    const a = j.address || {};
    const name = [a.village || a.town || a.city || a.municipality || a.county, a.country].filter(Boolean).join(', ');
    placeCache.set(k, name);
    return name;
  } catch { return ''; }
}

// ---------------------------------------------------------------- url hash
function parseHash() {
  const m = location.hash.match(/^#([\d.-]+),([\d.-]+),(\d+)(?:,(\d{4}-\d{2}-\d{2}))?/);
  if (!m) return {};
  return { center: [+m[1], +m[2]], zoom: +m[3], date: m[4] };
}
// Debounced: Safari throws after ~100 replaceState calls in 30 s (Play would hit it).
let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const c = map.getCenter();
    history.replaceState(null, '', `#${c.lat.toFixed(4)},${c.lng.toFixed(4)},${map.getZoom()},${state.date}`);
  }, 250);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------- start
let moveTimer;
map.on('moveend', () => {
  writeHash();
  renderSpecies();
  clearTimeout(moveTimer);
  moveTimer = setTimeout(refresh, 350);
});
onRateWait((msg) => setStatus('rate', msg));
if (matchMedia('(max-width: 720px)').matches) $('species').open = false; // keep the map visible on phones
setupSeasonSelect();
setupSlider();
refresh();
