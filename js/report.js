/* ============================================================
   report.js — experiment report export
   ------------------------------------------------------------
   Collects the ACTUAL run (graph, parameters, result,
   validation, statistics, complexity badge) and exports it as
   JSON, CSV, or a printable standalone HTML report.
   Downloads use Blob URLs — no server needed, works from file://.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  function download(filename, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }
  TSP.download = download;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Assemble a report object. Everything comes from the live
   * problem / record / runner — never hardcoded.
   */
  TSP.buildReport = function (problem, algoId, params, record, validation) {
    const meta = TSP.algoMeta(algoId);
    const deriv = (TSP.DERIVATIONS || {})[algoId];
    const r = record.result || {};
    return {
      generatedAt: new Date().toISOString(),
      tool: 'TSP Visualizer — DAA Laboratory',
      algorithm: { id: algoId, name: meta.name, kind: meta.kind, complexity: deriv ? deriv.badge : meta.tc },
      parameters: params || {},
      graph: {
        n: problem.n,
        cities: problem.cities.map(c => ({ label: c.label, x: +c.x.toFixed(4), y: +c.y.toFixed(4) })),
        distanceMatrix: problem.dist.map(row => row.slice())
      },
      result: {
        bestCost: r.bestCost,
        bestPath: r.bestPath,
        bestRouteLabels: r.bestPath ? r.bestPath.map(i => problem.cities[i].label) : null,
        optimal: !!r.optimal,
        optimalityStatus: r.optimal ? 'Optimality proven' : (meta.kind === 'exact' ? 'Unknown' : 'Heuristic — not proven optimal')
      },
      validation: validation || null,
      statistics: record.stats || {},
      performance: {
        computeMs: Math.round(record.computeMs * 10) / 10,
        eventsRecorded: record.events.length,
        totalEvents: record.totalEvents,
        sampledPlayback: !!record.sampled,
        firstTourEventIndex: record.firstTourIndex
      },
      notes: record.sampled
        ? 'Event stream exceeded ' + TSP.MAX_RECORDED_EVENTS + ' events; playback is keyframe-sampled. The result and statistics are unaffected.'
        : 'Full event stream recorded.'
    };
  };

  TSP.exportJSON = function (report) {
    download('tsp-report-' + report.algorithm.id + '-n' + report.graph.n + '.json',
      'application/json', JSON.stringify(report, null, 2));
  };

  TSP.exportEventsCSV = function (problem, record) {
    const rows = [['seq', 'kind', 'line', 'description']];
    record.events.forEach(ev => {
      rows.push([ev.seq, ev.kind, ev.line || '', '"' + TSP.describeEvent(problem, ev).replace(/"/g, '""') + '"']);
    });
    download('tsp-events-' + record.runnerId + '.csv', 'text/csv',
      rows.map(r => r.join(',')).join('\n'));
  };

  TSP.exportExperimentCSV = function (rows) {
    // rows: [{n, seed, structure, algoId, statesExplored, statesPruned, transitions, bestCost, optimal, computeMs, ...}]
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const out = [keys.join(',')];
    rows.forEach(r => {
      out.push(keys.map(k => {
        const v = r[k];
        return (v === null || v === undefined) ? '' : String(v).replace(/,/g, ';');
      }).join(','));
    });
    download('tsp-experiment.csv', 'text/csv', out.join('\n'));
  };

  /** Printable standalone HTML report (opens in a new tab; use browser Print → PDF). */
  TSP.exportHTMLReport = function (report, observations) {
    const g = report.graph;
    const matrixRows = g.distanceMatrix.map((row, i) =>
      '<tr><th>' + esc(g.cities[i].label) + '</th>' +
      row.map((v, j) => '<td>' + (i === j ? '—' : esc(v)) + '</td>').join('') + '</tr>').join('');
    const matrixHead = '<tr><th></th>' + g.cities.map(c => '<th>' + esc(c.label) + '</th>').join('') + '</tr>';
    const stats = report.statistics;
    const v = report.validation;
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>TSP Lab Report — ' + esc(report.algorithm.name) + '</title>' +
      '<style>body{font-family:Georgia,serif;max-width:820px;margin:32px auto;padding:0 20px;color:#111}' +
      'h1{font-size:24px}h2{font-size:18px;margin-top:28px;border-bottom:1px solid #ccc;padding-bottom:4px}' +
      'table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #bbb;padding:4px 8px;font-size:13px}' +
      '.mono{font-family:monospace}.ok{color:#0a6b1f}.bad{color:#a00}.meta{color:#555;font-size:13px}' +
      '@media print{.noprint{display:none}}</style></head><body>' +
      '<h1>TSP Laboratory — Experiment Report</h1>' +
      '<p class="meta">Generated ' + esc(report.generatedAt) + ' · ' + esc(report.tool) + '</p>' +
      '<h2>Algorithm</h2>' +
      '<p><b>' + esc(report.algorithm.name) + '</b> (' + esc(report.algorithm.kind) + ') — complexity ' +
      esc(report.algorithm.complexity) + '<br><span class="meta">Parameters: ' + esc(JSON.stringify(report.parameters)) + '</span></p>' +
      '<h2>Result</h2>' +
      '<p>Best tour: <span class="mono">' + esc((report.result.bestRouteLabels || []).join(' → ')) + '</span> = <b>' +
      esc(report.result.bestCost) + '</b><br>Status: <b>' + esc(report.result.optimalityStatus) + '</b></p>' +
      (v ? '<p>Tour validation: ' + (v.ok ? '<span class="ok">✓ valid</span>' : '<span class="bad">✕ INVALID: ' + esc(v.errors.join('; ')) + '</span>') +
        ' (edge-weight sum = ' + esc(v.computedCost) + ')</p>' : '') +
      '<h2>Statistics</h2>' +
      '<table><tr><th>States explored</th><th>States pruned</th><th>Transitions</th><th>Compute time</th><th>Events</th></tr>' +
      '<tr><td>' + esc(stats.statesExplored) + '</td><td>' + esc(stats.statesPruned) + '</td><td>' +
      esc(stats.transitions) + '</td><td>' + esc(report.performance.computeMs) + ' ms</td><td>' +
      esc(report.performance.totalEvents) + (report.performance.sampledPlayback ? ' (sampled)' : '') + '</td></tr></table>' +
      '<p class="meta">Compute time is pure algorithm time, excluding animation. ' + esc(report.notes) + '</p>' +
      '<h2>Graph (n = ' + g.n + ')</h2>' +
      '<table><thead>' + matrixHead + '</thead><tbody>' + matrixRows + '</tbody></table>' +
      (observations ? '<h2>Observations</h2><p>' + esc(observations) + '</p>' : '') +
      '<p class="noprint"><button onclick="window.print()">Print / Save as PDF</button></p>' +
      '</body></html>';
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(html);
    w.document.close();
    return true;
  };
})();
