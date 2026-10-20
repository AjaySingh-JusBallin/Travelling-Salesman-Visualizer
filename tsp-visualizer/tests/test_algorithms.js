/* Algorithm correctness tests on known instances. */
'use strict';
const { loadTSP, ok, eq } = require('./shim');
const TSP = loadTSP();

/** Classic 4-city instance. Optimum = 80 (A→B→D→C→A or A→C→D→B→A). */
function fourCity() {
  const p = new TSP.TSPProblem();
  for (let i = 0; i < 4; i++) p.addCity(0.2 + i * 0.15, 0.5);
  const D = [[0, 10, 15, 20], [10, 0, 35, 25], [15, 35, 0, 30], [20, 25, 30, 0]];
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) p.setDistance(i, j, D[i][j]);
  return p;
}

function twoCity() {
  const p = new TSP.TSPProblem();
  p.addCity(0.2, 0.5); p.addCity(0.8, 0.5);
  p.setDistance(0, 1, 7);
  return p;
}

function fiveCitySeeded() {
  const p = new TSP.TSPProblem();
  p.generateStructured(5, 'uniform', 777);
  return p;
}

async function recordAll(algoId, problem, params) {
  const runner = TSP.createRunner(algoId, problem, params || {});
  const rec = await TSP.recordRun(runner, problem, {});
  return { runner, rec };
}

async function main() {
  console.log('--- algorithm correctness ---');
  const OPT4 = 80;

  // exact algorithms must hit the known optimum on the 4-city instance
  for (const id of ['brute', 'heldkarp', 'branchbound']) {
    const p = fourCity();
    const { rec } = await recordAll(id, p);
    eq(rec.result.bestCost, OPT4, id + ': optimum on 4-city instance');
    ok(rec.result.optimal === true, id + ': guaranteesOptimal');
    const v = TSP.validateTour(p, rec.result.bestPath, rec.result.bestCost);
    ok(v.ok, id + ': best tour validates (' + (v.errors.join('; ') || 'ok') + ')');
    ok(rec.events.length > 0 && rec.events[0].kind === 'START', id + ': first event is START');
    ok(rec.events[rec.events.length - 1].kind === 'ALGORITHM_COMPLETED', id + ': last event is ALGORITHM_COMPLETED');
  }

  // brute force explores exactly (n-1)! tours on n=5
  {
    const p = fiveCitySeeded();
    const { rec } = await recordAll('brute', p);
    eq(rec.stats.statesExplored, 24, 'brute: 24 tours on n=5');
    // every tour-cost event must be self-consistent
    let checked = 0;
    for (const ev of rec.events) {
      if ((ev.kind === 'TOUR_COMPLETED' || ev.kind === 'BEST_TOUR_UPDATED') && ev.data.path) {
        eq(ev.data.cost, p.tourCost(ev.data.path), 'brute: event cost matches tourCost (#' + ev.seq + ')');
        if (++checked > 40) break;
      }
    }
  }

  // held-karp: DP table internal consistency (spot check states)
  {
    const p = fourCity();
    const { runner, rec } = await recordAll('heldkarp', p);
    const dp = runner.getDP();
    ok(dp.order.length === rec.stats.statesExplored, 'heldkarp: queue length matches states explored');
    const n = dp.n, FULL = dp.FULL;
    const at = (m, i) => m * n + i;
    let mism = 0;
    for (const [mask, i] of dp.order.slice(0, 12)) {
      const prev = mask ^ (1 << i);
      let best = Infinity;
      for (let j = 0; j < n; j++) {
        if (prev & (1 << j)) best = Math.min(best, dp.dp[at(prev, j)] + p.dist[j][i]);
      }
      if (Math.abs(dp.dp[at(mask, i)] - best) > 1e-9) mism++;
    }
    eq(mism, 0, 'heldkarp: dp recurrence holds on sampled states');
    // candidate data on DP events: min candidate == stored value
    for (const ev of rec.events) {
      if (ev.kind === 'DP_STATE_UPDATED') {
        const cands = ev.data.candidates;
        const minC = Math.min(...cands.map(c => c.cost));
        eq(minC, ev.data.value, 'heldkarp: event min candidate == dp value');
        break;
      }
    }
  }

  // branch & bound: tree consistency + prune safety
  {
    const p = fiveCitySeeded();
    const { runner, rec } = await recordAll('branchbound', p);
    const tree = runner.getTree();
    ok(tree.nodes.length > 0 && tree.nodes[0].path.join() === '0', 'branchbound: tree has root');
    let bad = 0;
    for (const nd of tree.nodes) {
      if (nd.parentId >= 0) {
        const par = tree.nodes[nd.parentId];
        if (!(nd.path.length === par.path.length + 1 && nd.path.slice(0, -1).join() === par.path.join())) bad++;
      }
      if (nd.status === 'pruned' && !(nd.bound >= 0)) bad++;
    }
    eq(bad, 0, 'branchbound: tree parent/child paths consistent');
    for (const ev of rec.events) {
      if (ev.kind === 'STATE_PRUNED') {
        ok(ev.data.bound >= ev.data.best, 'branchbound: prune only when bound >= best (#' + ev.seq + ')');
      }
    }
    // partial-path costs in tree match tourCost
    const nd = tree.nodes[1];
    if (nd) {
      let c = 0;
      for (let k = 0; k + 1 < nd.path.length; k++) c += p.dist[nd.path[k]][nd.path[k + 1]];
      eq(nd.cost, c, 'branchbound: node cost matches partial path cost');
    }
  }

  // branch & bound admissibility regression: on random non-Euclidean
  // weights the lower bound must never prune the optimum away.
  // (The bound once double-counted the return edge, returning
  // suboptimal tours labelled optimal.)
  {
    for (let trial = 0; trial < 12; trial++) {
      for (const n of [5, 6, 7]) {
        const pr = new TSP.TSPProblem();
        const rand = TSP.mulberry32(9000 + trial * 131 + n);
        for (let i = 0; i < n; i++) pr.addCity(0.1 + rand() * 0.8, 0.1 + rand() * 0.8);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pr.setDistance(i, j, 1 + Math.floor(rand() * 60));
        const bf = await TSP.runHeadless('brute', pr);
        const bb = await TSP.runHeadless('branchbound', pr);
        eq(bb.bestCost, bf.bestCost, 'branchbound == brute optimum (n=' + n + ' trial=' + trial + ')');
        if (bb.bestCost !== bf.bestCost) break;
      }
    }
  }

  // heuristics: valid tours, never claim optimality, sane bounds
  {
    const p = fourCity();
    const nn = await recordAll('nearest', p);
    ok(nn.rec.result.optimal === false, 'nearest: does not claim optimality');
    ok(TSP.validateTour(p, nn.rec.result.bestPath, nn.rec.result.bestCost).ok, 'nearest: tour valid');
    ok(nn.rec.result.bestCost >= OPT4, 'nearest: cost >= optimum');

    const t2 = await recordAll('twoopt', p, { maxIterations: 50 });
    ok(TSP.validateTour(p, t2.rec.result.bestPath, t2.rec.result.bestCost).ok, 'twoopt: tour valid');
    ok(t2.rec.result.bestCost <= nn.rec.result.bestCost, 'twoopt: no worse than its NN start');
    ok(t2.rec.result.bestCost >= OPT4, 'twoopt: cost >= optimum');

    const mst = await recordAll('mst', p);
    ok(TSP.validateTour(p, mst.rec.result.bestPath, mst.rec.result.bestCost).ok, 'mst: tour valid');
    ok(mst.rec.result.bestCost <= 2 * OPT4, 'mst: within 2x optimum on metric instance');

    const ga1 = await recordAll('genetic', p, { populationSize: 20, generations: 30, seed: 42 });
    const ga2 = await recordAll('genetic', p, { populationSize: 20, generations: 30, seed: 42 });
    eq(ga1.rec.result.bestCost, ga2.rec.result.bestCost, 'genetic: reproducible with same seed');
    ok(TSP.validateTour(p, ga1.rec.result.bestPath, ga1.rec.result.bestCost).ok, 'genetic: tour valid');

    const sa1 = await recordAll('annealing', p, { iterations: 500, seed: 7 });
    const sa2 = await recordAll('annealing', p, { iterations: 500, seed: 7 });
    eq(sa1.rec.result.bestCost, sa2.rec.result.bestCost, 'annealing: reproducible with same seed');
    ok(TSP.validateTour(p, sa1.rec.result.bestPath, sa1.rec.result.bestCost).ok, 'annealing: tour valid');
  }

  // edge case: n = 2 works for every algorithm
  for (const id of TSP.ALGORITHMS.map(a => a.id)) {
    const p = twoCity();
    const params = id === 'genetic' ? { populationSize: 6, generations: 5, seed: 1 }
      : id === 'annealing' ? { iterations: 20, seed: 1 } : {};
    const { rec } = await recordAll(id, p, params);
    eq(rec.result.bestCost, 14, id + ': n=2 optimum is 14');
    ok(!rec.cancelled, id + ': n=2 completes');
  }

  // all emitted event kinds are in the vocabulary
  {
    const p = fiveCitySeeded();
    const seen = new Set();
    for (const id of TSP.ALGORITHMS.map(a => a.id)) {
      const { rec } = await recordAll(id, p, id === 'genetic' ? { generations: 5, populationSize: 8, seed: 3 } : id === 'annealing' ? { iterations: 30, seed: 3 } : {});
      rec.events.forEach(e => seen.add(e.kind));
    }
    const unknown = [...seen].filter(k => !TSP.EVENT_KINDS.includes(k));
    eq(unknown.length, 0, 'all event kinds are in TSP.EVENT_KINDS (saw: ' + [...seen].join(',') + ')');
  }

  // sampling path: tiny cap still yields a correct result + key events
  {
    const oldCap = TSP.MAX_RECORDED_EVENTS;
    TSP.MAX_RECORDED_EVENTS = 10;
    const p = fiveCitySeeded();
    const { rec } = await recordAll('brute', p);
    TSP.MAX_RECORDED_EVENTS = oldCap;
    ok(rec.sampled === true, 'sampling: stream flagged as sampled over the cap');
    ok(rec.totalEvents === 27, 'sampling: true event count preserved (start + 24 tours + optimality + completed = ' + rec.totalEvents + ')');
    ok(rec.events[rec.events.length - 1].kind === 'ALGORITHM_COMPLETED', 'sampling: completion event kept');
    const kinds = new Set(rec.events.map(e => e.kind));
    ok(kinds.has('BEST_TOUR_UPDATED'), 'sampling: best-tour events kept');
    const v = TSP.validateTour(p, rec.result.bestPath, rec.result.bestCost);
    ok(v.ok, 'sampling: final result still valid');
  }

  // treeview layout regression: node coordinates must stay finite and
  // sane (a prior bug averaged already-scaled coordinates, blowing the
  // viewBox up to ~1e10 and rendering an empty SVG).
  {
    const vm = require('vm');
    const fs = require('fs');
    const path = require('path');
    function stubEl() {
      return {
        attrs: {}, children: [], style: {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k]; },
        appendChild(c) { this.children.push(c); return c; },
        addEventListener() {},
      };
    }
    const sandbox = {
      window: {},
      document: {
        createElementNS: () => stubEl(),
        createElement: () => stubEl(),
      },
    };
    const ctx = vm.createContext(sandbox);
    for (const f of ['tsp.js', 'treeview.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
    }
    const T2 = sandbox.window.TSP;
    const p = new TSP.TSPProblem();
    p.loadPreset('preset6');
    const runner = TSP.createRunner('branchbound', p);
    await TSP.recordRun(runner, p, {});
    const tree = runner.getTree();
    const svg = stubEl(), detail = stubEl();
    // detailEl needs innerHTML property; stubEl allows plain assignment
    const tv = T2.createTreeView(svg, detail, {});
    tv.setTree(tree, p, {});
    // walk the stub DOM for .tnode transforms + viewBox
    let maxAbs = 0, nNodes = 0, bad = 0;
    (function walk(e) {
      const cls = (e.attrs.class || '').split(' ');
      if (cls.includes('tnode')) {
        nNodes++;
        const m = /translate\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)/.exec(e.attrs.transform || '');
        if (!m) { bad++; }
        else {
          const x = parseFloat(m[1]), y = parseFloat(m[2]);
          if (!isFinite(x) || !isFinite(y)) bad++;
          maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
        }
      }
      e.children.forEach(walk);
    })(svg);
    ok(nNodes === tree.nodes.length, 'treeview: renders one node per tree node (' + nNodes + ')');
    eq(bad, 0, 'treeview: all node coordinates finite');
    ok(maxAbs < 1e6, 'treeview: coordinates sane (max |coord| = ' + maxAbs + ')');
    const vb = (svg.attrs.viewBox || '').split(/\s+/).map(Number);
    ok(vb.length === 4 && vb[2] < 1e6 && vb[3] < 1e6, 'treeview: viewBox sane (' + svg.attrs.viewBox + ')');
  }
}

module.exports = main;
