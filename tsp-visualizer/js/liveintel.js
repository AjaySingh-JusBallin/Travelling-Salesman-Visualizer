/* ============================================================
   liveintel.js — left-sidebar "Live Algorithm Intelligence".
   ------------------------------------------------------------
   Four panels, all driven by the REAL event stream — never by
   mock data:

     A. Current Operation — what the algorithm is doing now,
        the live values involved, and whether the candidate was
        accepted / rejected / pruned (with the reason).
     B. Live Mathematical Analysis — the complexity formulas for
        the selected algorithm with CURRENT values plugged in,
        plus the full derivation (rendered by derivations.js) in
        an expandable section.
     C. Performance Monitor — compact metric cards sourced from
        the actual run: compute time vs animation time are shown
        separately; unavailable metrics show "—", never fiction.
     D. Pseudocode Inspector — live line highlighting driven by
        ev.line (the explicit event→pseudocode mapping), with
        the active line kept in view and variable values.

   Pure helpers (opNameFor, decisionFor, explainFor,
   pseudoVarRows, liveMathHTML, perfMetrics) take plain data and
   return data/HTML — they are unit-tested in node. The
   updateIntel* functions bind them to the DOM.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function lbl(problem, i) {
    return (problem.cities[i] || {}).label || ('#' + i);
  }
  function routeOf(problem, p) {
    return p ? p.map(i => lbl(problem, i)).join(' → ') : '—';
  }
  function edgeOf(problem, e) {
    return e ? lbl(problem, e[0]) + '–' + lbl(problem, e[1]) : '—';
  }
  function num(v) { return TSP.formatInt(v); }

  /* ================= A. current operation ================= */

  const OP_NAMES = {
    START: 'Initialization',
    CANDIDATE_SELECTED: 'Evaluating candidate',
    EDGE_CONSIDERED: 'Considering edge',
    DISTANCE_EVALUATED: 'Measuring distance',
    PARTIAL_ROUTE_UPDATED: 'Extending partial route',
    STATE_EXPANDED: 'Expanding search node',
    STATE_GENERATED: 'Generating state',
    STATE_PRUNED: 'Pruning branch',
    DP_STATE_UPDATED: 'Filling DP table',
    BEST_TOUR_UPDATED: 'New best tour',
    TOUR_COMPLETED: 'Tour completed',
    OPTIMALITY_PROVEN: 'Optimality proven',
    ALGORITHM_COMPLETED: 'Algorithm finished'
  };
  TSP.opNameFor = function (kind) { return OP_NAMES[kind] || kind; };

  /** accepted | rejected | pruned | complete | evaluating — from real event data. */
  TSP.decisionFor = function (ev) {
    const d = ev.data || {};
    if (ev.kind === 'STATE_PRUNED') return { label: 'pruned', cls: 'dec-pruned' };
    if (ev.kind === 'BEST_TOUR_UPDATED') return { label: 'accepted · new best', cls: 'dec-accepted' };
    if (ev.kind === 'OPTIMALITY_PROVEN' || ev.kind === 'ALGORITHM_COMPLETED')
      return { label: 'complete', cls: 'dec-done' };
    if (ev.kind === 'TOUR_COMPLETED')
      return d.improved ? { label: 'accepted · new best', cls: 'dec-accepted' }
        : { label: 'rejected · no improvement', cls: 'dec-rejected' };
    if (d.accepted === true) return { label: 'accepted', cls: 'dec-accepted' };
    if (d.accepted === false) return { label: 'rejected', cls: 'dec-rejected' };
    return { label: 'evaluating', cls: 'dec-eval' };
  };

  /**
   * A short, dynamically generated explanation of the current decision,
   * composed from the actual event data. Falls back to the runner's own
   * explanation, then to the generic event description.
   */
  TSP.explainFor = function (problem, ev) {
    const d = ev.data || {};
    switch (ev.kind) {
      case 'EDGE_CONSIDERED':
        if (d.edge) return 'Evaluating the edge from ' + lbl(problem, d.edge[0]) +
          ' to ' + lbl(problem, d.edge[1]) + (d.w !== undefined ? ' (weight ' + d.w + ').' : '.');
        break;
      case 'CANDIDATE_SELECTED':
        if (d.city !== undefined) return 'Candidate ' + lbl(problem, d.city) +
          ' selected — this candidate extends the current partial route.';
        break;
      case 'PARTIAL_ROUTE_UPDATED':
        if (d.path) return 'Partial route is now ' + routeOf(problem, d.path) +
          (d.cost !== undefined && d.cost !== null ? ' with cost ' + d.cost + '.' : '.');
        break;
      case 'STATE_PRUNED':
        if (d.bound !== undefined && d.best !== undefined)
          return 'This branch is pruned because its valid lower bound (' + d.bound +
            ') cannot beat the best complete tour (' + d.best + ').';
        break;
      case 'STATE_EXPANDED':
        if (d.path) return 'Expanding search node ' + routeOf(problem, d.path) +
          (d.bound !== undefined ? ' — lower bound ' + d.bound + ' is below the incumbent, so the subtree survives.' : '.');
        break;
      case 'DP_STATE_UPDATED': {
        const mask = d.mask !== undefined
          ? '{' + d.mask.toString(2).padStart(problem.n, '0') + '}' : '?';
        return 'dp[' + mask + '][' + lbl(problem, d.city) + '] = ' + d.value +
          ' — cheapest way to start at ' + lbl(problem, 0) + ', visit exactly ' + mask +
          ', and end at ' + lbl(problem, d.city) +
          (d.via !== undefined && d.via >= 0 ? ' (via ' + lbl(problem, d.via) + ').' : '.');
      }
      case 'BEST_TOUR_UPDATED':
        return 'New incumbent: ' + routeOf(problem, d.path) + ' = ' + d.cost +
          ' beats the previous best of ' + d.prevBest + '.';
      case 'TOUR_COMPLETED':
        return d.improved
          ? 'Complete tour ' + routeOf(problem, d.path) + ' = ' + d.cost + ' improves the best.'
          : 'Complete tour ' + routeOf(problem, d.path) + ' = ' + d.cost + ' — no improvement over ' + d.best + '.';
      case 'OPTIMALITY_PROVEN':
        return 'No unexplored branch can beat ' + d.cost + ' — the incumbent is optimal.';
      default: break;
    }
    if (ev.explain) return ev.explain;
    return TSP.describeEvent(problem, ev);
  };

  /* ================= D (shared). variable rows ================= */

  /**
   * Important variable values for the current event, as [key, value]
   * rows. Shared by the sidebar inspector and the bottom Pseudocode tab.
   */
  TSP.pseudoVarRows = function (problem, ev) {
    if (!ev || !ev.data) return [];
    const d = ev.data;
    const rows = [];
    const push = (k, v) => rows.push([k, String(v)]);
    if (d.path) push('route', routeOf(problem, d.path));
    if (d.cost !== undefined && d.cost !== null) push('cost', num(d.cost));
    if (d.best !== undefined) push('incumbent best', num(d.best));
    if (d.prevBest !== undefined && d.prevBest !== null) push('previous best', num(d.prevBest));
    if (d.bound !== undefined) push('lower bound', d.bound);
    if (d.city !== undefined) push('city', lbl(problem, d.city));
    if (d.mask !== undefined) push('subset', '{' + d.mask.toString(2).padStart(problem.n, '0') + '}');
    if (d.value !== undefined) push('dp value', d.value);
    if (d.via !== undefined && d.via >= 0) push('via', lbl(problem, d.via));
    if (d.tried !== undefined) push('transitions tried', d.tried);
    if (d.edge) push('edge', edgeOf(problem, d.edge));
    if (d.remove) push('edges removed', d.remove.map(e => edgeOf(problem, e)).join(', '));
    if (d.add) push('edges added', d.add.map(e => edgeOf(problem, e)).join(', '));
    if (d.delta !== undefined) push('Δ cost', (d.delta > 0 ? '+' : '') + d.delta);
    if (d.improvement !== undefined) push('improvement', d.improvement);
    if (d.accepted !== undefined) push('accepted', d.accepted ? 'yes' : 'no');
    if (d.temp !== undefined) push('temperature', (+d.temp).toFixed(1));
    if (d.iteration !== undefined) push('iteration', d.iteration);
    if (d.generation !== undefined) push('generation', d.generation);
    if (d.avg !== undefined) push('avg fitness', (+d.avg).toFixed(1));
    if (d.worst !== undefined) push('worst fitness', d.worst);
    if (d.candidates) push('candidates', d.candidates.length + ' cities');
    if (d.children) push('children', d.children.length + ' nodes');
    if (d.nodeId !== undefined && d.nodeId !== null) push('tree node', '#' + d.nodeId);
    if (d.reason) push('reason', d.reason);
    if (d.note) push('note', d.note);
    return rows;
  };

  /* ================= B. live mathematical analysis ================= */

  const SPACE = {
    brute: 'Θ(n)', heldkarp: 'Θ(n·2<sup>n</sup>)', branchbound: 'Θ(n) search stack',
    nearest: 'Θ(n)', twoopt: 'Θ(n)', mst: 'Θ(n)',
    genetic: 'Θ(p·n)', annealing: 'Θ(n)'
  };
  const FORMULA = {
    brute: '(n−1)! tours × n edge lookups',
    heldkarp: 'dp[mask][i] = min<sub>j</sub> dp[mask−{i}][j] + d(j,i)',
    branchbound: 'LB = cost + minOut(cur) + Σ minOut(unvisited)',
    nearest: 'next = argmin<sub>u ∉ visited</sub> d(cur, u)',
    twoopt: 'Δ = −d(a,b) −d(c,e) +d(a,c) +d(b,e)',
    mst: 'tour ≤ 2 · w(MST) ≤ 2 · OPT',
    genetic: 'fitness = 1 / tour cost',
    annealing: 'P(accept) = e<sup>−Δ/T</sup>'
  };

  /**
   * Compact live math block for the selected algorithm, with CURRENT
   * values from the event stream plugged into the formulas.
   * ctx: { counts, frame, record } — all from the real run.
   */
  TSP.liveMathHTML = function (problem, algoId, ev, ctx) {
    const meta = TSP.algoMeta(algoId);
    const n = problem.n;
    const d = (ev && ev.data) || {};
    const counts = (ctx && ctx.counts) || {};
    const fr = (ctx && ctx.frame) || null;
    let live = '';
    const F = h => '<div class="formula live-formula">' + h + '</div>';
    const M = h => '<span class="mx">' + h + '</span>';

    if (algoId === 'brute') {
      const total = TSP.tourCount(n);
      // a tour that sets a new best emits BEST_TOUR_UPDATED instead of
      // TOUR_COMPLETED, so both kinds count as evaluated tours
      const done = (counts.TOUR_COMPLETED || 0) + (counts.BEST_TOUR_UPDATED || 0);
      const totalExact = (total && typeof total === 'object') ? total.exact : total;
      const totalTxt = totalExact ? num(totalExact) : '(n−1)!';
      const remTxt = totalExact ? num(Math.max(0, totalExact - done)) : '—';
      live = F(M('tours evaluated: ') + num(done) + ' / ' + totalTxt +
        M(' · remaining: ') + remTxt) +
        '<p>Each tour is scored by summing its ' + n + ' edges — Θ(n) work per tour, hence Θ(n!) total. Fixing the start city divides out the n rotations: (n−1)! distinct tours.</p>';
    } else if (algoId === 'heldkarp') {
      const filled = counts.DP_STATE_UPDATED || 0;
      const totalStates = n * Math.pow(2, n);
      let cur = '<p>Waiting for the first DP state…</p>';
      if (d.mask !== undefined && d.city !== undefined) {
        const mask = '{' + d.mask.toString(2).padStart(n, '0') + '}';
        const cands = (d.candidates || []).map(c =>
          M('dp[mask−{' + lbl(problem, d.city) + '}][' + lbl(problem, c.city) + '] + d = ' + c.cost)).join('<br>');
        cur = F(M('dp[') + esc(mask) + M('][') + esc(lbl(problem, d.city)) + M('] = min<sub>j</sub> dp[mask−{i}][j] + d(j,i) = ') + '<b>' + d.value + '</b>') +
          (cands ? '<div class="cand-list">' + cands + '</div>' : '') +
          (d.via !== undefined && d.via >= 0 ? '<p>Argmin: via <b>' + esc(lbl(problem, d.via)) + '</b> — the cheapest predecessor.</p>' : '');
      }
      live = '<p>States filled: <b>' + num(filled) + '</b> / ≈' + num(totalStates) +
        ' — each state tries every predecessor once, giving Θ(n²2ⁿ).</p>' + cur;
    } else if (algoId === 'branchbound') {
      const pruned = counts.STATE_PRUNED || 0;
      // incumbent as known at THIS event: event data, else the frame's best
      const frBest = ctx && ctx.frame && ctx.frame.bestCost !== null && ctx.frame.bestCost !== undefined
        ? ctx.frame.bestCost : (ctx && ctx.bestCost);
      let cur = '<p>Waiting for the first search node…</p>';
      if (d.bound !== undefined) {
        const inc = d.best !== undefined ? d.best : frBest;
        const verdict = inc !== undefined && inc !== null
          ? (d.bound >= inc
            ? '<span class="dec-pruned">prune — LB ≥ incumbent</span>'
            : '<span class="dec-accepted">keep — LB &lt; incumbent</span>')
          : '';
        cur = F(M('LB') + ' = ' + d.bound + ' &nbsp;&nbsp;' + M('incumbent') + ' = ' +
          (inc !== undefined && inc !== null ? num(inc) : '—') + '<br>' +
          M('prune ⟺ LB ≥ incumbent') + ' &nbsp;→&nbsp; ' + verdict);
      }
      live = '<p>Branches pruned so far: <b>' + num(pruned) + '</b>. The bound is admissible — a pruned subtree provably cannot contain the optimum.</p>' + cur;
    } else if (algoId === 'nearest') {
      live = (d.city !== undefined
        ? F(M('next') + ' = argmin<sub>u ∉ visited</sub> ' + M('d(') + esc(lbl(problem, d.city)) + M(', u)') +
          (d.cost !== undefined && d.cost !== null ? ' → partial cost <b>' + num(d.cost) + '</b>' : ''))
        : '<p>Waiting for the first greedy choice…</p>') +
        '<p>One argmin over ≤ n cities per step → Θ(n²) total. Greedy and fast — but never proven optimal.</p>';
    } else if (algoId === 'twoopt') {
      live = (d.delta !== undefined
        ? F(M('Δ') + ' = ' + (d.delta > 0 ? '+' : '') + d.delta +
          (d.accepted !== undefined ? ' → ' + (d.accepted ? '<span class="dec-accepted">improving — applied</span>' : '<span class="dec-rejected">not improving — skipped</span>') : ''))
        : '<p>Waiting for the first swap evaluation…</p>') +
        '<p>O(n²) candidate swaps per pass, each scored in O(1) by the delta — no full re-scoring.</p>';
    } else if (algoId === 'mst') {
      const mstW = d.note && /MST weight/.test(d.note) && d.cost !== undefined ? d.cost : null;
      live = F(M('tour ≤ 2 · w(MST)')) +
        (mstW !== null
          ? '<p>MST weight <b>' + num(mstW) + '</b> ⇒ this tour ≤ <b>' + num(2 * mstW) + '</b> on metric instances.</p>'
          : '<p>Prim’s algorithm is still growing the tree…</p>') +
        '<p>Why it holds: dropping one edge from the optimal tour leaves a spanning tree, so w(MST) ≤ OPT; the doubled walk with shortcuts is ≤ 2·w(MST).</p>';
    } else if (algoId === 'genetic') {
      live = F(M('fitness') + ' = 1 / tour cost') +
        ((d.generation !== undefined)
          ? '<p>Generation <b>' + d.generation + '</b>' +
            (d.best !== undefined ? ' · best <b>' + num(d.best) + '</b>' : '') +
            (d.avg !== undefined ? ' · avg ' + (+d.avg).toFixed(1) : '') + '.</p>'
          : '<p>Waiting for the first generation…</p>') +
        '<p>Each generation: tournament selection, ordered crossover, swap mutation — Θ(p·n) work per generation.</p>';
    } else if (algoId === 'annealing') {
      live = ((d.temp !== undefined || d.delta !== undefined)
        ? F(M('P(accept)') + ' = e<sup>−Δ/T</sup>' +
          (d.delta !== undefined && d.temp !== undefined
            ? ' = e<sup>−' + d.delta + '/' + (+d.temp).toFixed(1) + '</sup> ≈ <b>' +
              Math.exp(-d.delta / Math.max(1e-9, d.temp)).toFixed(3) + '</b>' : ''))
        : '<p>Waiting for the first move…</p>') +
        '<p>Worse moves are accepted with probability e<sup>−Δ/T</sup> so the search can escape local optima as T cools.</p>';
    }

    return '<div class="live-math-head">' +
      '<span class="lm-badge">' + esc(meta.name) + '</span>' +
      '<span class="lm-kind kind-' + meta.kind + '">' + meta.kind + '</span></div>' +
      '<div class="lm-complexity"><div><span class="k">Time</span><span class="v mono">' + esc(meta.tc) + '</span></div>' +
      '<div><span class="k">Space</span><span class="v mono">' + (SPACE[algoId] || '—') + '</span></div></div>' +
      '<div class="formula live-formula">' + FORMULA[algoId] + '</div>' +
      live;
  };

  /* ================= C. performance monitor ================= */

  /**
   * Compact metric cards from the REAL run. Anything unavailable is
   * "—", never invented. Compute (algorithm) time and animation
   * (visualization) time are reported separately.
   */
  TSP.perfMetrics = function (problem, record, playback, validation, counts) {
    const M = [];
    const dash = { label: null, value: '—' };
    if (!record || !record.result) {
      return [
        { label: 'Best tour', value: '—' }, { label: 'Current cost', value: '—' },
        { label: 'States explored', value: '—' }, { label: 'States pruned', value: '—' },
        { label: 'Compute time', value: '—' }, { label: 'Animation time', value: '—' },
        { label: 'Optimality', value: '—' }, { label: 'Tour valid', value: '—' }
      ];
    }
    const fr = playback && playback.currentEvent ? playback.currentEvent() : null;
    const frame = fr && fr.frame ? fr.frame : null;
    const best = frame && frame.bestCost !== null && frame.bestCost !== undefined
      ? frame.bestCost : record.result.bestCost;
    M.push({ label: 'Best tour', value: best === null ? '—' : num(best), cls: 'perf-best' });
    M.push({
      label: 'Current cost',
      value: frame && frame.cost !== null && frame.cost !== undefined ? num(frame.cost) : '—'
    });
    M.push({ label: 'States explored', value: num(record.stats.statesExplored) });
    const canPrune = record.runnerId === 'branchbound';
    M.push({ label: 'States pruned', value: canPrune ? num(record.stats.statesPruned) : 'N/A' });
    if (canPrune) {
      const t = record.stats.statesExplored + record.stats.statesPruned;
      M.push({ label: 'Pruning rate', value: t ? (100 * record.stats.statesPruned / t).toFixed(1) + '%' : '—' });
    }
    M.push({ label: 'Compute time', value: TSP.formatMs(record.computeMs), title: 'Algorithm computation only — excludes animation' });
    M.push({
      label: 'Animation time',
      value: playback ? playback.animSteps + ' steps × ' + (playback.intervalMs >= 100
        ? playback.intervalMs + ' ms' : '≈' + Math.round(1000 / playback.intervalMs) + '/s') : '—',
      title: 'Visualization playback only — does not affect the result'
    });
    M.push({
      label: 'First tour',
      value: record.firstTourIndex >= 0 ? 'event #' + (record.firstTourIndex + 1) : '—',
      title: 'When the first complete tour appeared'
    });
    const meta = TSP.algoMeta(record.runnerId);
    M.push({
      label: 'Optimality',
      value: record.result.optimal ? 'Proven optimal' : meta.kind === 'exact' ? 'Unknown' : 'Heuristic',
      cls: record.result.optimal ? 'ok-text' : 'warn-text'
    });
    if (validation) {
      M.push({
        label: 'Tour valid', value: validation.ok ? '✓ Valid' : '✕ Invalid',
        cls: validation.ok ? 'ok-text' : 'err-text'
      });
    }
    void dash; void counts;
    return M;
  };

  /* ================= DOM updaters ================= */

  function $(id) { return document.getElementById(id); }

  /* ---------- animation gating: step trackers ----------
     Detects genuine improvements / prunes / cost changes from the real
     record frames. Nothing is invented: every flag below is derived from
     actual event data. Trackers resync silently when stepping backward
     so no false "improvement" pulses fire on rewind. */
  const fxTrack = { cursor: -1, best: null, cost: null };
  let lastOpSig = null;
  TSP.intelResetTrack = function () {
    fxTrack.cursor = -1; fxTrack.best = null; fxTrack.cost = null;
    lastOpSig = null;
  };
  TSP.fxEnabled = function () {
    return typeof matchMedia === 'function' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  /* One-shot pulse via the Web Animations API: no timers to go stale,
     no classes left stuck on elements — the animation cleans itself up. */
  TSP.fxPulse = function (el, keyframes, opts) {
    if (!el || !TSP.fxEnabled() || typeof el.animate !== 'function') return;
    try { el.animate(keyframes, Object.assign({ duration: 600, easing: 'ease-out' }, opts || {})); } catch (e) { /* noop */ }
  };

  TSP.updateIntelOp = function (problem, ev, ctx) {
    const nameEl = $('op-name'), badgeEl = $('op-badge'),
      explEl = $('op-explain'), varsEl = $('op-vars'),
      panel = $('ip-op');
    if (!ev) {
      nameEl.textContent = 'No algorithm running';
      badgeEl.textContent = 'idle'; badgeEl.className = 'op-badge';
      explEl.innerHTML = 'Choose an algorithm on the right and press <b>Run</b> — every step is explained here as it executes.';
      varsEl.innerHTML = '';
      if (panel) panel.classList.remove('is-active', 'tone-exec', 'tone-eval', 'tone-good', 'tone-bad');
      lastOpSig = null;
      return;
    }
    const d = ev.data || {};
    const dec = TSP.decisionFor(ev);
    /* Pulse only when the operation/decision actually changes — rapid
       streams of same-kind events must not restart the animation. */
    const sig = TSP.opNameFor(ev.kind) + '|' + dec.cls;
    if (sig !== lastOpSig) {
      lastOpSig = sig;
      if (panel) {
        panel.classList.add('is-active');
        panel.classList.remove('tone-exec', 'tone-eval', 'tone-good', 'tone-bad');
        panel.classList.add(dec.cls === 'dec-eval' ? 'tone-eval'
          : (dec.cls === 'dec-accepted' || dec.cls === 'dec-done') ? 'tone-good'
          : (dec.cls === 'dec-rejected' || dec.cls === 'dec-pruned') ? 'tone-bad'
          : 'tone-exec');
        TSP.fxPulse(panel, [
          { boxShadow: '0 0 0 rgba(79,156,249,0)', offset: 0 },
          { boxShadow: '0 0 22px rgba(79,156,249,0.45)', offset: 0.35 },
          { boxShadow: '0 0 14px rgba(79,156,249,0.12)', offset: 1 }
        ]);
      }
      TSP.fxPulse(explEl, [{ opacity: 0.25 }, { opacity: 1 }], { duration: 280 });
    }
    nameEl.textContent = TSP.opNameFor(ev.kind);
    badgeEl.textContent = dec.label; badgeEl.className = 'op-badge ' + dec.cls;
    explEl.textContent = TSP.explainFor(problem, ev);
    const rows = [];
    if (d.city !== undefined) rows.push(['City', esc(lbl(problem, d.city))]);
    if (d.edge) rows.push(['Edge', esc(edgeOf(problem, d.edge))]);
    if (d.path) rows.push(['Partial route', esc(routeOf(problem, d.path))]);
    if (d.cost !== undefined && d.cost !== null) rows.push(['Path cost', num(d.cost)]);
    const best = (ctx && ctx.frame && ctx.frame.bestCost !== null && ctx.frame.bestCost !== undefined)
      ? ctx.frame.bestCost : (ctx && ctx.bestCost);
    if (best !== undefined && best !== null) rows.push(['Best so far', num(best)]);
    if (d.bound !== undefined) rows.push(['Lower bound', d.bound]);
    if (d.value !== undefined) rows.push(['DP value', d.value]);
    if (d.delta !== undefined) rows.push(['Δ cost', (d.delta > 0 ? '+' : '') + d.delta]);
    if (d.temp !== undefined) rows.push(['Temperature', (+d.temp).toFixed(1)]);
    if (d.generation !== undefined) rows.push(['Generation', d.generation]);
    if (d.iteration !== undefined) rows.push(['Iteration', d.iteration]);
    varsEl.innerHTML = rows.map(([k, v]) =>
      '<tr><td>' + esc(k) + '</td><td class="mono">' + v + '</td></tr>').join('');
  };

  TSP.updateIntelMath = function (problem, algoId, ev, ctx) {
    $('live-math').innerHTML = TSP.liveMathHTML(problem, algoId, ev, ctx || {});
  };

  TSP.renderIntelDerivation = function (algoId) {
    const box = $('live-deriv');
    if (box) TSP.renderDerivation(box, algoId);
  };

  /* Pure step-flag computation (unit-testable): given the current event,
     cursor, and frame values, report what deserves visual feedback.
     fwd-only improvements: stepping backward resyncs silently. */
  TSP.intelStepFlags = function (ev, cursor, best, cost) {
    const flags = { improved: false, prunedNow: false, costChanged: false };
    if (!ev) return flags;
    const fwd = cursor === undefined || cursor === null || cursor > fxTrack.cursor;
    if (cursor !== undefined && cursor !== null) fxTrack.cursor = cursor;
    if (best !== null && best !== undefined) {
      if (fwd && (fxTrack.best === null || best < fxTrack.best)) flags.improved = true;
      fxTrack.best = best;
    }
    if (cost !== null && cost !== undefined) {
      if (fxTrack.cost !== null && cost !== fxTrack.cost) flags.costChanged = true;
      fxTrack.cost = cost;
    }
    if (ev.kind === 'STATE_PRUNED') flags.prunedNow = true;
    return flags;
  };

  TSP.updateIntelPerf = function (problem, record, playback, validation, counts, ev, cursor) {
    const grid = $('perf-grid');
    const ms = TSP.perfMetrics(problem, record, playback, validation, counts);
    let flags = { improved: false, prunedNow: false, costChanged: false };
    if (record && record.result && ev) {
      const fr = playback && playback.currentEvent ? playback.currentEvent() : null;
      const frame = fr && fr.frame ? fr.frame : null;
      const best = frame && frame.bestCost !== null && frame.bestCost !== undefined ? frame.bestCost : null;
      const cost = frame && frame.cost !== null && frame.cost !== undefined ? frame.cost : null;
      flags = TSP.intelStepFlags(ev, cursor, best, cost);
    }
    /* Calm mode: at very fast playback speeds per-event ticks would just
       strobe, so value changes are shown without extra flashes. */
    const calm = !playback || (playback.intervalMs || 1500) >= 150;
    const optimal = !!(record && record.result && record.result.optimal);
    grid.innerHTML = ms.map(m => {
      let extra = '';
      if (m.label === 'Best tour' && flags.improved) extra = ' is-improved';
      else if (m.label === 'Current cost' && flags.costChanged && calm) extra = ' is-updating';
      else if (m.label === 'States pruned' && flags.prunedNow) extra = ' is-pruned';
      else if (m.label === 'Optimality' && optimal) extra = ' is-proven';
      return '<div class="perf-card' + (m.cls && m.cls.indexOf('perf-') === 0 ? ' ' + m.cls : '') + extra + '"' +
      (m.title ? ' title="' + esc(m.title) + '"' : '') + '>' +
      '<span class="perf-label">' + esc(m.label) + '</span>' +
      '<span class="perf-value ' + (m.cls || '') + '">' + esc(m.value) + '</span></div>';
    }).join('');
    return flags;
  };

  TSP.updateIntelPseudo = function (problem, algoId, ev) {
    const box = $('pseudo-side-box');
    TSP.renderPseudocode(box, algoId, ev ? ev.line : null, problem);
    const active = box.querySelector('.pseudo-line.active');
    if (active && box.scrollHeight > box.clientHeight + 4) {
      box.scrollTop = Math.max(0, active.offsetTop - box.clientHeight / 2 + 20);
    }
    const vars = $('pseudo-side-vars');
    const rows = TSP.pseudoVarRows(problem, ev);
    vars.innerHTML = rows.length
      ? rows.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td class="mono">' + esc(v) + '</td></tr>').join('')
      : '<tr><td colspan="2" class="hint-cell">No variables for this event.</td></tr>';
    const nameEl = $('pseudo-side-algo');
    if (nameEl) nameEl.textContent = TSP.algoMeta(algoId).name;
  };

  /** Idle placeholders (before any run / after reset / on problem change). */
  TSP.resetIntel = function (problem, algoId) {
    TSP.intelResetTrack();
    TSP.updateIntelOp(problem, null, null);
    TSP.updateIntelMath(problem, algoId, null, {});
    TSP.updateIntelPerf(problem, null, null, null, null);
    TSP.updateIntelPseudo(problem, algoId, null);
    TSP.renderIntelDerivation(algoId);
  };
})();
