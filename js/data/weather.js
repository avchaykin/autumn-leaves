// Daily temperatures from Open-Meteo (open data, CC BY 4.0, no API key).
//  - archive-api: ERA5 / ERA5-Land reanalysis -> this season so far + normals
//  - api (forecast): best-match weather models -> next 16 days
// Beyond the forecast horizon the series continues with daily normals.
//
// Open-Meteo's free tier allows ~600 "calls"/minute and 5000/hour, where a
// call is one location × up to 14 days. Requests here are therefore sized
// and paced against that budget (see `budget`), and retried on HTTP 429.

import { cached, pool } from './cache.js';

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const DAILY = 'temperature_2m_mean,temperature_2m_min';
const BATCH = 25;              // locations per request
const ARCHIVE_LAG = 3;         // days kept off the archive end (UTC + processing lag)
const PAST_DAYS = 7;           // recent days taken from the forecast API instead
const SEASON_FROM = '08-15';   // senescence can't start earlier north of 45°N (day length > 13.5 h)
export const NORMAL_YEARS = 10;
const LAPSE = -0.0065;         // °C per m, to adjust normals to a location's elevation

export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (isoDate, n) => {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

export function seasonFor(todayIso) {
  const y = +todayIso.slice(0, 4);
  const m = +todayIso.slice(5, 7);
  const year = m >= 7 ? y : y - 1;
  return { year, start: `${year}-${SEASON_FROM}`, end: `${year}-12-31` };
}

// Normals always use the last NORMAL_YEARS complete autumns before the
// current season, whatever season is being viewed, so they cache well.
export function normalsBaseline(todayIso) {
  const y = seasonFor(todayIso).year;
  return [y - NORMAL_YEARS, y - 1];
}

// ------------------------------------------------------------ rate budget
const listeners = new Set();
export const onRateWait = (fn) => listeners.add(fn);
const notify = (msg) => listeners.forEach((fn) => fn(msg));

const budget = {
  perMinute: 450,              // stay below the 600/min limit
  log: [],                     // [timestamp, units]
  async take(units) {
    for (;;) {
      const now = Date.now();
      this.log = this.log.filter(([t]) => now - t < 60000);
      const used = this.log.reduce((s, [, u]) => s + u, 0);
      if (used + units <= this.perMinute || !this.log.length) {
        this.log.push([now, units]);
        return;
      }
      const wait = 60000 - (now - this.log[0][0]) + 200;
      notify(`Pacing Open-Meteo requests (free-tier limit), ${Math.ceil(wait / 1000)} s…`);
      await sleep(wait);
      notify('');
    }
  },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unitsFor = (locations, days) => locations * Math.max(1, days / 14);

async function getJson(url, units) {
  await budget.take(units);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    let reason = '';
    try { reason = (await res.json()).reason || ''; } catch { /* not json */ }
    if (res.status === 429 && /minutely/i.test(reason) && attempt < 3) {
      notify(`Open-Meteo minute limit reached, retrying in 60 s…`);
      await sleep(61000);
      notify('');
      continue;
    }
    if (res.status === 429) {
      throw new Error(`Open-Meteo free-tier limit reached (${reason || 'too many requests'}). Cached areas still work; try again later.`);
    }
    throw new Error(`${res.status} ${new URL(url).host}${reason ? ': ' + reason : ''}`);
  }
}

// The archive's last available day moves with ERA5 processing. When a
// request runs past it, Open-Meteo answers 400 "... allowed range from
// 1940-01-01 to YYYY-MM-DD"; that date is remembered and the request retried.
let archiveMax = null;
async function archiveJson(makeUrl, end, units) {
  const e = archiveMax && archiveMax < end ? archiveMax : end;
  try {
    return await getJson(makeUrl(e), units);
  } catch (err) {
    const m = /end_date.*to (\d{4}-\d{2}-\d{2})/.exec(err.message);
    if (!m || m[1] >= e) throw err;
    archiveMax = m[1];
    return getJson(makeUrl(m[1]), units);
  }
}

const coordParams = (pts) =>
  `latitude=${pts.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(3)).join(',')}`;

async function fetchBatched(pts, days, makeUrl, { archiveEnd } = {}) {
  const batches = [];
  for (let i = 0; i < pts.length; i += BATCH) batches.push(pts.slice(i, i + BATCH));
  const results = await pool(batches, 2, async (b) => {
    const units = unitsFor(b.length, days);
    const json = archiveEnd ? await archiveJson((end) => makeUrl(b, end), archiveEnd, units) : await getJson(makeUrl(b), units);
    return Array.isArray(json) ? json : [json];
  });
  return results.flat();
}

// ------------------------------------------------------------ compact cache
// Stored as {start, t:[tmean], n:[tmin], f: index of first forecast day}
function pack(entry) {
  return {
    start: entry.days[0]?.date, f: entry.days.findIndex((d) => d.src === 'forecast'),
    t: entry.days.map((d) => Math.round(d.tmean * 10) / 10),
    n: entry.days.map((d) => (d.tmin == null ? null : Math.round(d.tmin * 10) / 10)),
    lastForecast: entry.lastForecast, elevation: entry.elevation,
  };
}
function unpack(p) {
  const days = p.t.map((t, i) => ({
    date: addDays(p.start, i), tmean: t, tmin: p.n[i],
    src: p.f >= 0 && i >= p.f ? 'forecast' : 'observed',
  }));
  return { days, lastForecast: p.lastForecast, elevation: p.elevation };
}

// Merged series are cached per day; drop the ones from earlier days.
try {
  const today = new Date().toLocaleDateString('sv-SE');
  for (const k of Object.keys(localStorage)) {
    const m = /^al\d+:wx:\d+:(\d{4}-\d{2}-\d{2}):/.exec(k);
    if (m && m[1] < today) localStorage.removeItem(k);
  }
} catch { /* no storage (or Node tests) */ }

// ------------------------------------------------------------ season series
// Observed (archive) + forecast for many points.
// Returns Map(point.id -> { days:[{date,tmean,tmin,src}], lastForecast, elevation })
//
// The archive part of the current season is cached per point (`wxo:`) and
// only extended with the days that are new since, so a return visit costs
// one small forecast request per point instead of the whole season again.
export async function seasonSeries(points, today) {
  const season = seasonFor(today);
  // The archive runs in UTC and lags a few days behind the viewer's local
  // date; the forecast API's recent past (past_days) covers that gap.
  const lagged = addDays(today, -ARCHIVE_LAG);
  const archiveEnd = lagged < season.end ? lagged : season.end;
  const live = today <= season.end;
  // past seasons never change; the current one is refreshed daily
  const keyOf = (p) => `wx:${season.year}:${live ? today : 'final'}:${p.id}`;
  const obsKey = (p) => `wxo:${season.year}:${p.id}`;
  const result = new Map();
  const missing = [];
  for (const p of points) {
    const hit = cached.get(keyOf(p));
    if (hit) result.set(p.id, unpack(hit)); else missing.push(p);
  }
  if (!missing.length) return result;

  // archive days still needed per point, grouped by their first missing day
  const obs = new Map();
  const groups = new Map();
  const covered = addDays(today, -PAST_DAYS - 1); // forecast past_days reach back to here
  for (const p of missing) {
    const o = live ? cached.get(obsKey(p)) : null;
    const prev = o ? unpack(o) : { days: [], elevation: undefined };
    obs.set(p.id, prev);
    const through = prev.days.at(-1)?.date;
    if (live && through && through >= covered) continue;
    const from = through ? addDays(through, 1) : season.start;
    if (from > archiveEnd) continue;
    if (!groups.has(from)) groups.set(from, []);
    groups.get(from).push(p);
  }

  const [, fc] = await Promise.all([
    Promise.all([...groups].map(async ([from, pts]) => {
      const json = await fetchBatched(pts, daysBetween(from, archiveEnd),
        (b, end) => `${ARCHIVE}?${coordParams(b)}&start_date=${from}&end_date=${end}&daily=${DAILY}&timezone=Europe%2FParis`,
        { archiveEnd });
      pts.forEach((p, i) => {
        const prev = obs.get(p.id);
        const a = json[i].daily;
        a.time.forEach((date, k) => {
          // ERA5's newest days can still be empty; stop at the first gap
          if (a.temperature_2m_mean[k] == null || (prev.days.at(-1) && date !== addDays(prev.days.at(-1).date, 1))) return;
          prev.days.push({ date, tmean: a.temperature_2m_mean[k], tmin: a.temperature_2m_min[k], src: 'observed' });
        });
        prev.elevation ??= json[i].elevation;
        if (live) cached.set(obsKey(p), pack(prev));
      });
    })),
    live
      ? fetchBatched(missing, PAST_DAYS + 16, (b) => `${FORECAST}?${coordParams(b)}&daily=${DAILY}&past_days=${PAST_DAYS}&forecast_days=16&timezone=Europe%2FParis`)
      : Promise.resolve(null),
  ]);

  missing.forEach((p, i) => {
    const o = obs.get(p.id);
    const byDate = new Map(o.days.map((d) => [d.date, d]));
    let lastForecast = null;
    if (fc) {
      const f = fc[i].daily;
      f.time.forEach((date, k) => {
        const tmean = f.temperature_2m_mean[k];
        if (tmean == null || date < season.start || date > season.end) return;
        // archive for the past, forecast for the future and the archive's gap
        if (date > today || !byDate.has(date)) byDate.set(date, { date, tmean, tmin: f.temperature_2m_min[k], src: date > today ? 'forecast' : 'observed' });
        if (date > today) lastForecast = date;
      });
    }
    const days = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
    const entry = { days, lastForecast, elevation: o.elevation ?? fc?.[i]?.elevation };
    cached.set(keyOf(p), pack(entry));
    result.set(p.id, entry);
  });
  return result;
}

// ------------------------------------------------------------ normals
// Daily normals (mean, tmin, p10, p90 of tmean) keyed by 'MM-DD', from
// SEASON_FROM to 31 Dec of the baseline years. One request per autumn keeps
// the cost at ~10 units/year instead of ~26 for whole years.
export async function normals(lat, lon, baseline) {
  const [y0, y1] = baseline;
  const key = `norm:${y0}-${y1}:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cached.get(key);
  if (hit) return hit;
  const days = daysBetween(`2001-${SEASON_FROM}`, '2001-12-31');
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const results = await pool(years, 2, (y) =>
    archiveJson((end) => `${ARCHIVE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${y}-${SEASON_FROM}&end_date=${end}&daily=${DAILY}&timezone=Europe%2FParis`, `${y}-12-31`, unitsFor(1, days)));
  const buckets = new Map();
  for (const json of results) {
    const d = json.daily;
    d.time.forEach((date, k) => {
      if (d.temperature_2m_mean[k] == null) return;
      const md = date.slice(5);
      if (!buckets.has(md)) buckets.set(md, { t: [], n: [] });
      buckets.get(md).t.push(d.temperature_2m_mean[k]);
      buckets.get(md).n.push(d.temperature_2m_min[k]);
    });
  }
  const out = { elevation: results[0].elevation, days: smoothNormals(buckets) };
  cached.set(key, out);
  return out;
}

function smoothNormals(buckets) {
  const out = {};
  const r1 = (v) => Math.round(v * 10) / 10;
  for (const md of buckets.keys()) {
    // ±3 day window smooths the normals
    const win = [], winMin = [];
    for (let k = -3; k <= 3; k++) {
      const other = buckets.get(addDays(`2001-${md}`, k).slice(5));
      if (other) { win.push(...other.t); winMin.push(...other.n); }
    }
    win.sort((a, b) => a - b);
    out[md] = { tmean: r1(avg(win)), tmin: r1(avg(winMin)), p10: r1(win[Math.floor(win.length * 0.1)]), p90: r1(win[Math.floor(win.length * 0.9)]) };
  }
  return out;
}
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// Normals shifted to another elevation with a standard lapse rate.
export function adjustNormals(norm, elevation) {
  if (elevation == null || norm.elevation == null) return norm.days;
  const dt = (elevation - norm.elevation) * LAPSE;
  if (Math.abs(dt) < 0.05) return norm.days;
  const out = {};
  for (const [md, n] of Object.entries(norm.days)) {
    out[md] = { tmean: n.tmean + dt, tmin: n.tmin + dt, p10: n.p10 + dt, p90: n.p90 + dt };
  }
  return out;
}

// Extend a season series to the season end with normals (`days` keyed MM-DD).
// The recent anomaly (last 14 days) decays to zero over ~3 weeks. When the
// normals come from a distant point (`keepOffset`), the location's mean
// offset from them over the season is kept as well.
export function extendWithNormals(entry, norm, seasonEnd, { keepOffset = false } = {}) {
  const days = entry.days.slice();
  if (!days.length) return days;
  const dev = (d) => d.tmean - (norm[d.date.slice(5)]?.tmean ?? d.tmean);
  const offset = keepOffset ? avg(days.map(dev)) : 0;
  const recent = avg(days.slice(-14).map(dev)) - offset;
  let date = days[days.length - 1].date;
  let k = 0;
  while (date < seasonEnd) {
    date = addDays(date, 1);
    k++;
    const n = norm[date.slice(5)];
    if (!n) continue;
    const a = offset + recent * Math.exp(-k / 21);
    days.push({ date, tmean: n.tmean + a, tmin: n.tmin + a, src: 'outlook' });
  }
  return days;
}

// A "normal year" series built purely from the normals, for comparison.
export function normalSeries(norm, season) {
  const days = [];
  for (let d = season.start; d <= season.end; d = addDays(d, 1)) {
    const n = norm[d.slice(5)];
    if (n) days.push({ date: d, tmean: n.tmean, tmin: n.tmin, src: 'normal' });
  }
  return days;
}
