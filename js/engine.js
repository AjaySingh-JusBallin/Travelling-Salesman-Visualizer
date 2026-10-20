/* ============================================================
   engine.js — Central algorithm event engine
   ------------------------------------------------------------
   This file cleanly separates ALGORITHM EXECUTION from UI
   ANIMATION:

     Phase 1 (compute):  run the algorithm headlessly, as fast as
                         possible, recording a stream of typed
                         events + compact visual frames.
     Phase 2 (playback): navigate the recorded stream with an
                         index cursor. Pause, resume, step,
                         step-back, jump-to-end are all trivial
                         because nothing is recomputed.

   Consequences (all guaranteed by construction):
     - changing animation speed never changes the answer
     - no timer can run twice (single guarded timer)
     - stepping backward never reruns the algorithm
     - computation time and animation time are measured separately

   Event kinds:
     START, CANDIDATE_SELECTED, EDGE_CONSIDERED, DISTANCE_EVALUATED,
     PARTIAL_ROUTE_UPDATED, STATE_EXPANDED, STATE_GENERATED,
     STATE_PRUNED, DP_STATE_UPDATED, BEST_TOUR_UPDATED,
     TOUR_COMPLETED, OPTIMALITY_PROVEN, ALGORITHM_COMPLETED

   Plain (non-module) script so the app also runs from file://.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  /* ---------------- event kinds ---------------- */
  TSP.EVENT_KINDS = [
    'START', 'CANDIDATE_SELECTED', 'EDGE_CONSIDERED', 'DISTANCE_EVALUATED',
    'PARTIAL_ROUTE_UPDATED', 'STATE_EXPANDED', 'STATE_GENERATED', 'STATE_PRUNED',
    'DP_STATE_UPDATED', 'BEST_TOUR_UPDATED', 'TOUR_COMPLETED',
    'OPTIMALITY_PROVEN', 'ALGORITHM_COMPLETED'
  ];

  /** Default playback pace: one meaningful event every 1500 ms. */
  TSP.DEFAULT_INTERVAL_MS = 1500;

  /** Max full-detail events kept; beyond this the stream is sampled. */
  TSP.MAX_RECORDED_EVENTS = 100000;
  /** In sampled mode, keep one keyframe every N events. */
  TSP.SAMPLE_EVERY = 1000;

  /* ---------------- text rendering (lazy) ---------------- */

  function labelsOf(problem, path) {
    return path.map(i => (problem.cities[i] ? problem.cities[i].label : '?'));
  }
  function routeText(problem, path) {
    return labelsOf(problem, path).join(' → ');
  }
  function maskText(problem, mask) {
    const s = [];
    for (let j = 0; j < problem.n; j++) if (mask & (1 << j)) s.push(problem.cities[j].label);
    return '{' + s.join(',') + '}';
  }
  TSP.routeText = routeText;

  /**
   * Human-readable one-line description of an event, generated from
   * its structured data. Runners may also supply ev.text directly to
   * override this.
   */
  TSP.describeEvent = function (problem, ev) {
    if (ev.text) return ev.text;
    const d = ev.data || {};
    switch (ev.kind) {
      case 'START': return '○ ' + (d.note || 'Algorithm started.');
      case 'CANDIDATE_SELECTED':
        return '→ Candidate ' + (problem.cities[d.city] || {}).label + ' selected' +
          (d.cost !== undefined ? ' (partial cost ' + d.cost + ')' : '');
      case 'EDGE_CONSIDERED':
        return '→ Considering edge ' + lbl(problem, d.edge) + (d.w !== undefined ? ' = ' + d.w : '');
      case 'DISTANCE_EVALUATED':
        return '· d(' + lbl(problem, d.edge) + ') = ' + d.w;
      case 'PARTIAL_ROUTE_UPDATED':
        // note: some runners reuse this kind for milestone notes with path: null
        return d.path
          ? '→ Partial route ' + routeText(problem, d.path) + ' = ' + d.cost
          : '→ ' + (d.note || d.explain || 'Updated') + (d.cost !== undefined ? ' = ' + d.cost : '');
      case 'STATE_EXPANDED':
        return '→ Expanding state ' + routeText(problem, d.path) +
          (d.bound !== undefined ? ' (bound ' + d.bound + ')' : '');
      case 'STATE_GENERATED':
        return '+ Generated ' + routeText(problem, d.path) + ' (cost ' + d.cost + ')';
      case 'STATE_PRUNED':
        return '✕ Pruned ' + routeText(problem, d.path) + ' — ' + (d.reason || ('bound ' + d.bound + ' ≥ best ' + d.best));
      case 'DP_STATE_UPDATED':
        return 'dp[' + maskText(problem, d.mask) + '][' + (problem.cities[d.city] || {}).label + '] = ' + d.value +
          ' (via ' + (problem.cities[d.via] || {}).label + ')';
      case 'BEST_TOUR_UPDATED':
        return '★ New best = ' + d.cost + '  (' + routeText(problem, d.path) + ')';
      case 'TOUR_COMPLETED':
        return (d.improved ? '★ ' : '· ') + 'Tour ' + routeText(problem, d.path) + ' = ' + d.cost +
          (d.improved ? '' : ' (no improvement)');
      case 'OPTIMALITY_PROVEN':
        return '✓ Optimality proven: ' + d.cost + '  (' + routeText(problem, d.path) + ')';
      case 'ALGORITHM_COMPLETED':
        return '✓ Finished. Best = ' + d.bestCost +
          (d.optimal ? ' (proven optimal)' : ' (heuristic — not proven optimal)');
      default: return '· ' + ev.kind;
    }
    function lbl(p, e) {
      if (!e) return '?';
      return p.cities[e[0]].label + '–' + p.cities[e[1]].label;
    }
  };

  /* ---------------- recording ---------------- */

  /**
   * Run a runner to completion, recording typed events + frames.
   * Chunked with yields so the UI stays responsive; cancellable.
   *
   * Returns a "record":
   *   { events, sampled, totalEvents, computeMs, cancelled,
   *     firstTourIndex, result {bestCost, bestPath, optimal},
   *     stats {statesExplored, statesPruned, transitions} }
   */
  TSP.recordRun = async function (runner, problem, opts) {
    opts = opts || {};
    const events = [];
    let totalEvents = 0;
    let sampled = false;
    let computeMs = 0;
    let firstTourIndex = -1;
    let cancelled = false;

    const pushEvent = (raw) => {
      totalEvents++;
      const ev = {
        seq: totalEvents - 1,
        kind: raw.kind,
        line: raw.line || null,
        explain: raw.explain || null,
        text: raw.text || null,
        data: raw.data || {}
      };
      const isKey = ev.kind === 'BEST_TOUR_UPDATED' || ev.kind === 'OPTIMALITY_PROVEN' ||
        ev.kind === 'ALGORITHM_COMPLETED' || ev.kind === 'START' || ev.kind === 'TOUR_COMPLETED';
      if (!sampled) {
        ev.frame = runner.getFrame();
        events.push(ev);
        if (events.length >= TSP.MAX_RECORDED_EVENTS) sampled = true;
      } else if (isKey || (totalEvents % TSP.SAMPLE_EVERY === 0)) {
        ev.frame = runner.getFrame();
        ev.keyframe = true;
        events.push(ev);
      }
      if (firstTourIndex < 0 && (ev.kind === 'TOUR_COMPLETED' || ev.kind === 'BEST_TOUR_UPDATED')) {
        firstTourIndex = events.length - 1;
      }
      return ev;
    };

    let guard = 0;
    while (!runner.done) {
      const t0 = performance.now();
      const raw = runner.step();
      computeMs += performance.now() - t0;
      if (raw) pushEvent(raw);
      else break;
      if (++guard % 4000 === 0) {
        if (opts.onProgress) opts.onProgress(totalEvents, runner);
        await new Promise(r => setTimeout(r, 0)); // let UI breathe
        if (opts.isCancelled && opts.isCancelled()) { cancelled = true; break; }
      }
      // hard safety cap so a bug can never hang the tab
      if (totalEvents > 4000000) break;
    }

    if (!cancelled) {
      const doneEv = {
        kind: 'ALGORITHM_COMPLETED',
        data: {
          bestCost: runner.bestCost,
          bestPath: runner.bestPath ? runner.bestPath.slice() : null,
          optimal: !!runner.guaranteesOptimal,
          stats: Object.assign({}, runner.stats),
          computeMs: Math.round(computeMs * 10) / 10
        }
      };
      pushEvent(doneEv);
      if (runner.guaranteesOptimal && runner.bestPath) {
        const pev = {
          kind: 'OPTIMALITY_PROVEN',
          data: { cost: runner.bestCost, path: runner.bestPath.slice() }
        };
        // insert before ALGORITHM_COMPLETED; seq keeps true chronological order
        const last = events.pop();
        pushEvent(pev);
        events.push(last);
      }
    }

    return {
      events, sampled, totalEvents, computeMs, cancelled,
      firstTourIndex,
      runnerId: runner.id,
      result: cancelled ? null : {
        bestCost: runner.bestCost,
        bestPath: runner.bestPath ? runner.bestPath.slice() : null,
        optimal: !!runner.guaranteesOptimal
      },
      stats: Object.assign({}, runner.stats)
    };
  };

  /** Fast headless run without event recording (for experiments / compare). */
  TSP.runHeadless = async function (algoId, problem, params, onProgress) {
    const runner = TSP.createRunner(algoId, problem, params || {});
    let computeMs = 0, steps = 0;
    const t0 = performance.now();
    while (!runner.done) {
      const s = performance.now();
      runner.step();
      computeMs += performance.now() - s;
      if (++steps % 4000 === 0) {
        if (onProgress) onProgress(steps);
        await new Promise(r => setTimeout(r, 0));
      }
      if (steps > 4000000) break;
    }
    return {
      algoId,
      n: problem.n,
      params: runner.params || {},
      statesExplored: runner.stats.statesExplored,
      statesPruned: runner.stats.statesPruned,
      transitions: runner.stats.transitions,
      bestCost: runner.bestCost,
      bestPath: runner.bestPath ? runner.bestPath.slice() : null,
      optimal: !!runner.guaranteesOptimal,
      computeMs: Math.round(computeMs * 10) / 10,
      wallMs: Math.round((performance.now() - t0) * 10) / 10
    };
  };

  /* ---------------- playback ---------------- */

  /**
   * Navigate a recorded event stream. Exactly one timer, always
   * guarded: every path that (re)starts it clears the old one first.
   */
  TSP.createPlayback = function (record, hooks) {
    hooks = hooks || {};
    const n = record.events.length;
    let cursor = 0;
    let state = 'ready'; // ready | playing | paused | done
    let timer = null;
    let intervalMs = TSP.DEFAULT_INTERVAL_MS;
    let animSteps = 0;

    function clearTimer() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }
    function setState(s) {
      state = s;
      if (hooks.onState) hooks.onState(s);
    }
    function emit() {
      const ev = record.events[cursor];
      if (!ev) return;
      if (hooks.onEvent) hooks.onEvent(ev, cursor, n);
    }

    function arm() {
      clearTimer();
      if (state !== 'playing') return;
      timer = setTimeout(() => {
        timer = null;
        if (state !== 'playing') return;
        advance(1);
      }, intervalMs);
    }

    function advance(dir) {
      const next = cursor + dir;
      if (next < 0 || next >= n) {
        if (dir > 0 && next >= n) setState('done');
        return false;
      }
      cursor = next;
      if (dir > 0) animSteps++;
      emit();
      if (cursor >= n - 1 && state === 'playing') { clearTimer(); setState('done'); }
      else if (state === 'playing') arm();
      return true;
    }

    const api = {
      get cursor() { return cursor; },
      get length() { return n; },
      get state() { return state; },
      get intervalMs() { return intervalMs; },
      get animSteps() { return animSteps; },
      currentEvent() { return record.events[cursor] || null; },

      play() {
        if (state === 'playing') return;
        let restarted = false;
        if (cursor >= n - 1) { cursor = 0; restarted = true; } // replay from start
        clearTimer();
        setState('playing');
        if (restarted) emit();
        arm();
      },
      pause() {
        if (state !== 'playing') return;
        clearTimer();
        setState('paused');
      },
      toggle() { (state === 'playing' ? api.pause() : api.play()); },

      stepForward() {
        const wasPlaying = state === 'playing';
        clearTimer();
        if (wasPlaying) setState('paused');
        if (advance(1) && state !== 'done') setState('paused');
      },
      stepBackward() {
        const wasPlaying = state === 'playing';
        clearTimer();
        if (state === 'done' || wasPlaying) setState('paused');
        advance(-1);
        if (state !== 'done') setState('paused');
      },
      jumpTo(i) {
        clearTimer();
        const wasDone = state === 'done';
        if (state === 'playing' || wasDone) setState('paused');
        cursor = Math.max(0, Math.min(n - 1, i | 0));
        emit();
        setState(cursor >= n - 1 ? 'done' : 'paused');
      },
      jumpToEnd() { api.jumpTo(n - 1); },
      /** Compute phase already finished; skipping just jumps to the result. */
      skipToResult() { api.jumpToEnd(); },

      setIntervalMs(ms) {
        intervalMs = Math.max(5, Math.min(10000, ms | 0 || TSP.DEFAULT_INTERVAL_MS));
        if (hooks.onSpeed) hooks.onSpeed(intervalMs);
        if (state === 'playing') arm(); // re-arm: clears old timer first
      },

      dispose() {
        clearTimer();
        setState('ready');
        hooks = {};
      }
    };
    return api;
  };

  /* ---------------- independent tour validator ---------------- */

  /**
   * Check a closed tour path (e.g. [0,2,1,0]) against the problem.
   * Independent of whichever algorithm produced it.
   */
  TSP.validateTour = function (problem, path, claimedCost) {
    const errors = [];
    const n = problem.n;
    if (!Array.isArray(path) || path.length === 0) {
      return { ok: false, errors: ['Tour path is empty or missing.'], computedCost: null };
    }
    // 1. starts and ends at city 0
    if (path[0] !== 0) errors.push('Tour must start at the start city (' + (problem.cities[0] || {}).label + ').');
    if (path[path.length - 1] !== 0) errors.push('Tour must return to the start city at the end.');
    // 2. every city exactly once (excluding the repeated start at the end)
    const inner = path.slice(0, -1);
    if (inner.length !== n) {
      errors.push('Tour visits ' + inner.length + ' cities but the problem has ' + n + '.');
    } else {
      const seen = new Array(n).fill(0);
      for (const c of inner) {
        if (!Number.isInteger(c) || c < 0 || c >= n) { errors.push('Tour references invalid city index ' + c + '.'); break; }
        seen[c]++;
      }
      seen.forEach((k, i) => {
        if (k === 0) errors.push('City ' + problem.cities[i].label + ' is never visited.');
        if (k > 1) errors.push('City ' + problem.cities[i].label + ' is visited ' + k + ' times.');
      });
    }
    // 3 & 4. every edge exists; cost matches sum of edge weights
    let computedCost = 0;
    let edgesValid = true;
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k], b = path[k + 1];
      const w = (problem.dist[a] || [])[b];
      if (!Number.isFinite(w)) { edgesValid = false; errors.push('Edge ' + a + '→' + b + ' has no valid weight.'); }
      else computedCost += w;
    }
    if (claimedCost !== undefined && claimedCost !== null && computedCost !== claimedCost) {
      errors.push('Claimed cost ' + claimedCost + ' does not match the edge-weight sum ' + computedCost + '.');
    }
    return {
      ok: errors.length === 0,
      errors,
      computedCost,
      visitsAll: errors.indexOf(errors.find(e => /never visited|visited .* times/.test(e))) === -1,
      edgesValid,
      costMatches: claimedCost === undefined || claimedCost === null || computedCost === claimedCost
    };
  };

  /** Seeded PRNG helper for stochastic algorithms (reproducible runs). */
  TSP.seededRandom = function (seed) {
    return TSP.mulberry32(seed === undefined ? (Date.now() % 100000) : seed);
  };
})();
