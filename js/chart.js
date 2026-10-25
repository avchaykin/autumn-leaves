// Temperature chart for the detail panel: 10-year normal band + mean,
// this season's observed / forecast / outlook daily means, and a marker
// for the selected date. Inline SVG with a crosshair tooltip.

const W = 368, H = 170, M = { l: 30, r: 8, t: 8, b: 22 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function temperatureChart(container, { days, norm, from, to, selected }) {
  const pts = days.filter((d) => d.date >= from && d.date <= to);
  const dates = pts.map((d) => d.date);
  const n = dates.length;
  if (!n) { container.textContent = 'No temperature data.'; return { setSelected() {} }; }
  const normFor = (d) => norm[d.slice(5)];
  const values = pts.flatMap((d) => [d.tmean, normFor(d.date)?.p10, normFor(d.date)?.p90]).filter((v) => v != null);
  const lo = Math.floor(Math.min(...values) / 5) * 5;
  const hi = Math.ceil(Math.max(...values) / 5) * 5;
  const x = (i) => M.l + (i / (n - 1)) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
  const path = (sel, get) => {
    let dstr = '', pen = false;
    pts.forEach((d, i) => {
      const v = sel(d) ? get(d) : null;
      if (v == null) { pen = false; return; }
      dstr += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return dstr;
  };
  // series meet at their boundaries: include the previous day in each segment
  const srcOf = (i) => pts[i].src;
  const inSrc = (src) => (d) => {
    const i = dates.indexOf(d.date);
    return pts[i].src === src || (i + 1 < n && srcOf(i + 1) === src);
  };

  const band = (() => {
    const top = [], bot = [];
    pts.forEach((d, i) => {
      const nn = normFor(d.date);
      if (nn) { top.push(`${x(i).toFixed(1)},${y(nn.p90).toFixed(1)}`); bot.unshift(`${x(i).toFixed(1)},${y(nn.p10).toFixed(1)}`); }
    });
    return `M${top.join('L')}L${bot.join('L')}Z`;
  })();

  const grid = [];
  for (let v = lo; v <= hi; v += 5) {
    grid.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>`);
    grid.push(`<text x="${M.l - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${v}°</text>`);
  }
  const ticks = [];
  pts.forEach((d, i) => {
    if (d.date.endsWith('-01')) {
      ticks.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${H - M.b}" y2="${H - M.b + 4}" stroke="var(--muted)"/>`);
      ticks.push(`<text x="${x(i) + 3}" y="${H - 6}" font-size="10" fill="var(--muted)">${MONTHS[+d.date.slice(5, 7) - 1]}</text>`);
    }
  });
  const si = dates.indexOf(selected);

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily mean temperature this season compared with the 10-year normal">
      ${grid.join('')}
      <path d="${band}" fill="var(--band)"/>
      <path d="${path(() => true, (d) => normFor(d.date)?.tmean)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2 3"/>
      <path d="${path(inSrc('outlook'), (d) => d.tmean)}" fill="none" stroke="var(--outlook)" stroke-width="2" stroke-dasharray="1 3" stroke-linecap="round"/>
      <path d="${path(inSrc('forecast'), (d) => d.tmean)}" fill="none" stroke="var(--forecast)" stroke-width="2"/>
      <path d="${path((d) => d.src === 'observed', (d) => d.tmean)}" fill="none" stroke="var(--observed)" stroke-width="2"/>
      <line class="sel" x1="${si >= 0 ? x(si) : 0}" x2="${si >= 0 ? x(si) : 0}" y1="${M.t}" y2="${H - M.b}" stroke="var(--accent)" stroke-width="1.5" visibility="${si >= 0 ? 'visible' : 'hidden'}"/>
      ${ticks.join('')}
      <line class="xh" x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>
      <circle class="dot" r="4" fill="var(--surface)" stroke="var(--ink)" stroke-width="2" visibility="hidden"/>
      <rect x="${M.l}" y="0" width="${W - M.l - M.r}" height="${H}" fill="transparent" class="hit"/>
    </svg>
    <div class="tip"></div>
    <div class="chart-legend">
      <span><i style="background:var(--observed)"></i>Observed</span>
      <span><i style="background:var(--forecast)"></i>Forecast</span>
      <span><i style="border-top:2px dotted var(--outlook);height:0"></i>Outlook</span>
      <span><i style="border-top:2px dotted var(--muted);height:0"></i>Normal, 10–90 % range</span>
    </div>`;

  const svg = container.querySelector('svg');
  const tip = container.querySelector('.tip');
  const xh = svg.querySelector('.xh');
  const dot = svg.querySelector('.dot');
  const label = { observed: 'observed', forecast: 'forecast', outlook: 'outlook' };
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / (W - M.l - M.r)) * (n - 1))));
    const d = pts[i];
    const nn = normFor(d.date);
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(d.tmean)); dot.setAttribute('visibility', 'visible');
    const diff = nn ? d.tmean - nn.tmean : null;
    tip.innerHTML = `<strong>${fmtDate(d.date)}</strong><br>${d.tmean.toFixed(1)} °C ${label[d.src] || ''}` +
      (nn ? `<br><span style="color:var(--muted)">normal ${nn.tmean.toFixed(1)} °C (${diff >= 0 ? '+' : ''}${diff.toFixed(1)})</span>` : '');
    tip.style.display = 'block';
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(left + 10, r.width - tip.offsetWidth)}px`;
    tip.style.top = `${(y(d.tmean) / H) * r.height - tip.offsetHeight - 8}px`;
  };
  const leave = () => { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', leave);

  // move the selected-date marker without re-rendering the chart
  const sel = svg.querySelector('.sel');
  return {
    setSelected(date) {
      const i = dates.indexOf(date);
      sel.setAttribute('visibility', i >= 0 ? 'visible' : 'hidden');
      if (i >= 0) { sel.setAttribute('x1', x(i)); sel.setAttribute('x2', x(i)); }
    },
  };
}

export function fmtDate(isoDate, opts = { day: 'numeric', month: 'short' }) {
  return new Date(isoDate + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}
