/* ============================================================
   complexity.js — the "why does TSP get hard?" machinery
   ------------------------------------------------------------
   - safe big-number formatting (never NaN / Infinity shown)
   - log-space complexity values (no factorial overflow)
   - the theoretical growth chart (log-scale SVG)
   - the experiment bar chart
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});
  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ---------- safe arithmetic ---------- */

  /** log(n!) computed as a sum — never overflows. */
  function logFactorial(n) {
    let s = 0;
    for (let i = 2; i <= n; i++) s += Math.log(i);
    return s;
  }
  TSP.logFactorial = logFactorial;

  /** Exact (n-1)! for small n; null when it would exceed safe integers. */
  function tourCount(n) {
    let f = 1;
    for (let i = 2; i <= n - 1; i++) {
      f *= i;
      if (f > Number.MAX_SAFE_INTEGER) return null;
    }
    return f;
  }
  TSP.tourCount = tourCount;

  /** Held–Karp theoretical states n²·2ⁿ (exact for the n we plot). */
  function heldKarpStates(n) { return n * n * Math.pow(2, n); }
  TSP.heldKarpStates = heldKarpStates;

  /**
   * Format a count intelligently: 5,040 · 362,880 · 39.9 million · 13.9 billion …
   * Accepts either a number or { log: <natural log of value> } for huge values.
   */
  function formatCount(v) {
    let logv, exact = null;
    if (v && typeof v === 'object' && 'log' in v) {
      logv = v.log;
    } else {
      if (!Number.isFinite(v)) return '–';
      if (v < 0) return '–';
      exact = Math.round(v);
      logv = exact <= 0 ? -Infinity : Math.log(exact);
    }
    if (logv === -Infinity) return '0';
    const log10 = logv / Math.LN10;
    if (log10 < 4) return exact !== null ? exact.toLocaleString('en-US') : '–';
    if (log10 < 6) return (Math.pow(10, log10 - 3)).toFixed(1).replace(/\.0$/, '') + ' thousand';
    if (log10 < 9) return (Math.pow(10, log10 - 6)).toFixed(1).replace(/\.0$/, '') + ' million';
    if (log10 < 12) return (Math.pow(10, log10 - 9)).toFixed(1).replace(/\.0$/, '') + ' billion';
    if (log10 < 15) return (Math.pow(10, log10 - 12)).toFixed(1).replace(/\.0$/, '') + ' trillion';
    const mantissa = Math.pow(10, log10 - Math.floor(log10));
    return mantissa.toFixed(1) + 'e' + Math.floor(log10);
  }
  TSP.formatCount = formatCount;

  /** "1,234" for ordinary measured integers. */
  function formatInt(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    return Math.round(v).toLocaleString('en-US');
  }
  TSP.formatInt = formatInt;

  /** "12.4 ms" / "1.23 s" */
  function formatMs(ms) {
    if (!Number.isFinite(ms)) return '–';
    if (ms < 1000) return ms.toFixed(1) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }
  TSP.formatMs = formatMs;

  /** log10 of theoretical operation counts at city count n. */
  function complexityLogs(n) {
    return {
      brute: logFactorial(n - 1) / Math.LN10,          // (n-1)!
      heldkarp: (2 * Math.log(n) + n * Math.LN2) / Math.LN10,  // n²·2ⁿ
      poly: (2 * Math.log(n)) / Math.LN10             // n² reference
    };
  }

  /* ---------- growth chart ---------- */
  const CHART = { w: 640, h: 360, padL: 64, padR: 16, padT: 18, padB: 44 };
  const N_MAX = 12, N_MIN = 2;

  /**
   * Draw the theoretical growth chart. Optional `measured` overlays real
   * data: { algoId: [{ n, v }] } — plotted as markers joined by thin
   * lines, clearly distinguished from the theoretical curves.
   */
  function drawGrowthChart(svg, selectedN, measured) {
    svg.innerHTML = '';
    const { w, h, padL, padR, padT, padB } = CHART;

    // y range: from 10^0 to a bit above max value at N_MAX
    const logs = [];
    for (let n = N_MIN; n <= N_MAX; n++) logs.push(complexityLogs(n));
    const yMax = Math.ceil(Math.max(...logs.map(l => Math.max(l.brute, l.heldkarp, l.poly))) + 0.6);
    const yMin = 0;

    const x = n => padL + ((n - N_MIN) / (N_MAX - N_MIN)) * (w - padL - padR);
    const y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);

    // gridlines + y labels (powers of ten)
    for (let p = yMin; p <= yMax; p++) {
      el('line', { x1: padL, x2: w - padR, y1: y(p), y2: y(p), stroke: '#1c2532', 'stroke-width': 1 }, svg);
      const t = el('text', { x: padL - 8, y: y(p) + 4, 'text-anchor': 'end', fill: '#5d6b7e', 'font-size': 11, 'font-family': 'monospace' }, svg);
      t.textContent = p === 0 ? '1' : '10^' + p;
    }
    // x labels
    for (let n = N_MIN; n <= N_MAX; n++) {
      const t = el('text', { x: x(n), y: h - padB + 20, 'text-anchor': 'middle', fill: '#5d6b7e', 'font-size': 11, 'font-family': 'monospace' }, svg);
      t.textContent = n;
    }
    const xl = el('text', { x: (padL + w - padR) / 2, y: h - 6, 'text-anchor': 'middle', fill: '#8b98a9', 'font-size': 12 }, svg);
    xl.textContent = 'cities (n)';
    const yl = el('text', { x: 14, y: (padT + h - padB) / 2, 'text-anchor': 'middle', fill: '#8b98a9', 'font-size': 12, transform: 'rotate(-90 14 ' + ((padT + h - padB) / 2) + ')' }, svg);
    yl.textContent = 'operations (log scale)';

    // curves
    const series = [
      { key: 'poly', color: '#8e8e93', width: 1.5, dash: '5 4' },
      { key: 'heldkarp', color: '#3fb950', width: 2.5 },
      { key: 'brute', color: '#e5484d', width: 2.5 }
    ];
    for (const s of series) {
      const pts = [];
      for (let n = N_MIN; n <= N_MAX; n++) pts.push(x(n).toFixed(1) + ',' + y(complexityLogs(n)[s.key]).toFixed(1));
      const attrs = { points: pts.join(' '), fill: 'none', stroke: s.color, 'stroke-width': s.width };
      if (s.dash) attrs['stroke-dasharray'] = s.dash;
      el('polyline', attrs, svg);
    }

    // measured overlays (real data — markers + thin connectors)
    if (measured) {
      const mColors = { brute: '#e5484d', heldkarp: '#3fb950', branchbound: '#4f9cf9', nearest: '#d29922', twoopt: '#b083f0', mst: '#39c5cf', genetic: '#f778ba', annealing: '#8e8e93' };
      for (const algoId in measured) {
        const pts = measured[algoId].filter(p => p.n >= N_MIN && p.n <= N_MAX && p.v > 0);
        if (!pts.length) continue;
        const color = mColors[algoId] || '#ffffff';
        const coords = pts.map(p => x(p.n).toFixed(1) + ',' + y(Math.log10(p.v)).toFixed(1)).join(' ');
        el('polyline', { points: coords, fill: 'none', stroke: color, 'stroke-width': 1.2, 'stroke-dasharray': '2 3', opacity: 0.9 }, svg);
        pts.forEach(p => {
          const c = el('circle', { cx: x(p.n), cy: y(Math.log10(p.v)), r: 3.5, fill: '#0d1117', stroke: color, 'stroke-width': 2 }, svg);
          c.appendChild(document.createElementNS(SVGNS, 'title')).textContent =
            'measured · ' + algoId + ' · n=' + p.n + ': ' + formatCount(p.v) + ' states';
        });
      }
    }

    // marker at the selected city count + exact values
    if (selectedN >= N_MIN && selectedN <= N_MAX) {
      const cx = x(selectedN);
      el('line', { x1: cx, x2: cx, y1: padT, y2: h - padB, stroke: '#4f9cf9', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
      const vals = complexityLogs(selectedN);
      const rows = [
        ['Brute Force', vals.brute, '#e5484d'],
        ['Held–Karp', vals.heldkarp, '#3fb950'],
        ['n² ref', vals.poly, '#8e8e93']
      ];
      rows.forEach(([name, lv, color], ri) => {
        const dot = el('circle', { cx: cx, cy: y(lv), r: 4.5, fill: color, stroke: '#0d1117', 'stroke-width': 1.5 }, svg);
        dot.appendChild(document.createElementNS(SVGNS, 'title')).textContent = name + ': ' + formatCount({ log: lv * Math.LN10 });
        const t = el('text', {
          x: Math.min(cx + 10, w - padR - 120), y: y(lv) - 8 - ri * 2,
          fill: color, 'font-size': 11.5, 'font-family': 'monospace', 'font-weight': 700
        }, svg);
        t.textContent = name + ' ' + formatCount({ log: lv * Math.LN10 });
      });
    }
  }
  TSP.drawGrowthChart = drawGrowthChart;

  /* ---------- experiment bar chart (grouped bars, log y) ---------- */
  /**
   * rows: [{ n, <seriesKey>: value, ... }]
   * series: [{ key, color, name }] — defaults to the three exact algorithms.
   */
  function drawExperimentChart(svg, rows, series) {
    svg.innerHTML = '';
    if (!rows.length) return;
    series = series || [
      { key: 'brute', color: '#e5484d', name: 'Brute Force' },
      { key: 'heldkarp', color: '#3fb950', name: 'Held–Karp' },
      { key: 'bb', color: '#4f9cf9', name: 'B&B' }
    ];
    const w = 640, h = 300, padL = 64, padR = 16, padT = 18, padB = 44;
    const all = rows.flatMap(r => series.map(s => r[s.key]).filter(v => v > 0));
    const yMax = Math.ceil(Math.max(...all.map(v => Math.log10(v))) + 0.5);
    const y = v => padT + (1 - (v <= 0 ? 0 : Math.log10(v)) / yMax) * (h - padT - padB);

    for (let p = 0; p <= yMax; p++) {
      el('line', { x1: padL, x2: w - padR, y1: y(Math.pow(10, p)), y2: y(Math.pow(10, p)), stroke: '#1c2532' }, svg);
      const t = el('text', { x: padL - 8, y: y(Math.pow(10, p)) + 4, 'text-anchor': 'end', fill: '#5d6b7e', 'font-size': 11, 'font-family': 'monospace' }, svg);
      t.textContent = p === 0 ? '1' : '10^' + p;
    }

    const groupW = (w - padL - padR) / rows.length;
    const barW = Math.min(22, groupW / (series.length + 1));
    rows.forEach((r, gi) => {
      const gx = padL + gi * groupW + groupW / 2;
      series.forEach((s, si) => {
        const v = r[s.key];
        if (!v || v <= 0) return;
        const bx = gx + (si - (series.length - 1) / 2) * (barW + 3) - barW / 2;
        const rect = el('rect', { x: bx, y: y(v), width: barW, height: Math.max(2, h - padB - y(v)), fill: s.color, rx: 2 }, svg);
        rect.appendChild(document.createElementNS(SVGNS, 'title')).textContent =
          s.name + ' · n=' + r.n + ': ' + formatCount(v) + ' states';
      });
      const t = el('text', { x: gx, y: h - padB + 20, 'text-anchor': 'middle', fill: '#5d6b7e', 'font-size': 11, 'font-family': 'monospace' }, svg);
      t.textContent = 'n=' + r.n;
    });
    const xl = el('text', { x: (padL + w - padR) / 2, y: h - 6, 'text-anchor': 'middle', fill: '#8b98a9', 'font-size': 12 }, svg);
    xl.textContent = 'cities (log-scale states explored)';
  }
  TSP.drawExperimentChart = drawExperimentChart;
})();
