/* ============================================================
   algorithms.js — The three TSP algorithms as *steppable* runners
   ------------------------------------------------------------
   Each algorithm is a factory:  createRunner(problem) -> runner

   A runner advances exactly ONE meaningful operation per step()
   call, so the UI can animate / pause / single-step it:

     runner.step()  ->  event object, or null when finished

   Event: { kind, text }
     kind: 'start' | 'eval' | 'best' | 'prune' | 'dp' | 'bound'
           | 'reconstruct' | 'done'

   Every runner exposes:
     .name, .stats { statesExplored, statesPruned, transitions }
     .bestCost (null until a tour is found), .bestPath
     .getVisual() -> { currentPath, currentCost, bestPath, bestCost,
                       currentNode, maskCities, pruned } for the renderer

   All statistics are measured from the real implementation —
   nothing is faked.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  function labelsOf(problem, path) {
    return path.map(i => problem.cities[i].label);
  }
  function routeText(problem, path) {
    return labelsOf(problem, path).join(' → ');
  }

  /* ============================================================
     1. BRUTE FORCE — enumerate all (n-1)! permutations (Heap's
     algorithm, iterative so we can step through it).
     Fix start city 0; permute the remaining n-1 cities.
     Time O((n-1)!), Space O(n).
     ============================================================ */
  function createBruteForceRunner(problem) {
    const n = problem.n;
    const others = [];                       // cities to permute: [1..n-1]
    for (let i = 1; i < n; i++) others.push(i);
    const k = others.length;

    const runner = {
      id: 'brute',
      name: 'Brute Force',
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: null,
      bestPath: null,
      currentPath: null,
      currentCost: null,
      done: false
    };

    // Heap's algorithm state
    const perm = others.slice();
    const c = new Array(k).fill(0);
    let i = 0;
    let firstPending = true;                 // the initial permutation still needs evaluation

    function evaluate() {
      const tour = [0].concat(perm, [0]);    // closed tour
      const cost = problem.tourCost(tour);
      runner.stats.statesExplored++;
      runner.currentPath = tour;
      runner.currentCost = cost;
      let ev;
      if (runner.bestCost === null || cost < runner.bestCost) {
        runner.bestCost = cost;
        runner.bestPath = tour.slice();
        ev = { kind: 'best', text: '★ New best = ' + cost + '  (' + routeText(problem, tour) + ')' };
      } else {
        ev = { kind: 'eval', text: 'Evaluating ' + routeText(problem, tour) + '  = ' + cost };
      }
      return ev;
    }

    runner.step = function () {
      if (runner.done) return null;
      if (runner.stats.statesExplored === 0 && firstPending) {
        firstPending = false;
        const ev = evaluate();
        if (k === 0) { runner.done = true; return { kind: 'done', text: '✓ Finished. Best = ' + runner.bestCost }; }
        return ev;
      }
      // advance Heap's algorithm to the next permutation
      while (i < k) {
        if (c[i] < i) {
          if (i % 2 === 0) { const t = perm[0]; perm[0] = perm[i]; perm[i] = t; }
          else { const t = perm[c[i]]; perm[c[i]] = perm[i]; perm[i] = t; }
          c[i]++;
          i = 0;
          return evaluate();
        }
        c[i] = 0;
        i++;
      }
      runner.done = true;
      return { kind: 'done', text: '✓ Finished. Evaluated ' + runner.stats.statesExplored + ' tours. Best = ' + runner.bestCost };
    };

    runner.getVisual = function () {
      return {
        currentPath: runner.currentPath,
        currentCost: runner.currentCost,
        bestPath: runner.bestPath,
        bestCost: runner.bestCost,
        currentNode: runner.currentPath ? runner.currentPath[runner.currentPath.length - 2] : null,
        maskCities: null,
        pruned: null
      };
    };

    runner._intro = { kind: 'start', text: 'Starting at ' + problem.cities[0].label + ' — enumerating all ' + TSP.factorial(k) + ' tours' };
    return runner;
  }

  /* ============================================================
     2. HELD–KARP DYNAMIC PROGRAMMING (bitmask DP)
     ------------------------------------------------------------
     State:  dp[mask][i] = cheapest cost to start at city 0,
             visit exactly the cities in `mask`, and end at city i.
     Recurrence:
             dp[mask][i] = min over j in mask, j≠i
                          of dp[mask ^ (1<<i)][j] + dist[j][i]
     Answer: min over i of dp[ALL][i] + dist[i][0]
     Time O(n²·2ⁿ), Space O(n·2ⁿ).
     ============================================================ */
  function createHeldKarpRunner(problem) {
    const n = problem.n;
    const FULL = (1 << n) - 1;
    const INF = Number.POSITIVE_INFINITY;

    // dp[mask][i] as a flat Float64Array; parent for reconstruction
    const dp = new Float64Array((FULL + 1) * n).fill(INF);
    const parent = new Int16Array((FULL + 1) * n).fill(-1);
    const at = (mask, i) => mask * n + i;
    dp[at(1, 0)] = 0;                        // mask = {0}, end at 0

    // popcount for every mask (computed once)
    const pop = new Uint8Array(FULL + 1);
    for (let m = 1; m <= FULL; m++) pop[m] = pop[m >> 1] + (m & 1);

    // queue of (mask, i) states ordered by increasing subset size
    const queue = [];
    for (let size = 2; size <= n; size++) {
      for (let mask = 0; mask <= FULL; mask++) {
        if (pop[mask] !== size || !(mask & 1)) continue;   // must contain city 0
        for (let i = 1; i < n; i++) {
          if (mask & (1 << i)) queue.push([mask, i]);
        }
      }
    }

    const runner = {
      id: 'heldkarp',
      name: 'Held–Karp (DP)',
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: null,
      bestPath: null,
      currentPath: null,
      currentCost: null,
      done: false
    };

    let qi = 0;               // position in queue
    let phase = 'dp';         // 'dp' -> 'finish' -> 'reconstruct'
    let bestEnd = -1;
    let reconMask = 0, reconCity = -1;

    function maskToLabels(mask) {
      const s = [];
      for (let j = 0; j < n; j++) if (mask & (1 << j)) s.push(problem.cities[j].label);
      return '{' + s.join(',') + '}';
    }

    // partial path for the current DP state, via parent pointers
    function partialPath(mask, i) {
      const rev = [i];
      let m = mask, cur = i;
      while (m !== 1) {
        const p = parent[at(m, cur)];
        if (p < 0) break;
        rev.push(p);
        m = m ^ (1 << cur);
        cur = p;
      }
      rev.reverse();
      return rev; // open path (not yet closed back to 0)
    }

    runner.step = function () {
      if (runner.done) return null;

      if (phase === 'dp') {
        if (qi >= queue.length) { phase = 'finish'; return runner.step(); }
        const [mask, i] = queue[qi++];
        // --- the DP transition: try every possible previous city j ---
        let best = INF, bestJ = -1, tried = 0;
        const prev = mask ^ (1 << i);
        for (let j = 0; j < n; j++) {
          if (!(prev & (1 << j))) continue;
          tried++;
          const cand = dp[at(prev, j)] + problem.dist[j][i];
          if (cand < best) { best = cand; bestJ = j; }
        }
        dp[at(mask, i)] = best;
        parent[at(mask, i)] = bestJ;
        runner.stats.statesExplored++;
        runner.stats.transitions += tried;
        runner.currentPath = partialPath(mask, i);
        runner.currentCost = best;
        runner._dpInfo = { mask: mask, city: i };
        return {
          kind: 'dp',
          text: 'dp[' + maskToLabels(mask) + '][' + problem.cities[i].label + '] = ' + best +
                '  (via ' + problem.cities[bestJ].label + ', ' + tried + ' transitions)'
        };
      }

      if (phase === 'finish') {
        // close every full tour back to the start city
        let best = INF;
        for (let i = 1; i < n; i++) {
          const cand = dp[at(FULL, i)] + problem.dist[i][0];
          if (cand < best) { best = cand; bestEnd = i; }
        }
        runner.bestCost = best;
        phase = 'reconstruct';
        reconMask = FULL; reconCity = bestEnd;
        return { kind: 'bound', text: 'All states done. Best closed tour = ' + best + ' (ending at ' + problem.cities[bestEnd].label + ')' };
      }

      if (phase === 'reconstruct') {
        // walk parent pointers back, one city per step, for the animation
        const rev = [reconCity];
        let m = reconMask, cur = reconCity;
        const p = parent[at(m, cur)];
        if (p >= 0) {
          reconMask = m ^ (1 << cur);
          reconCity = p;
          runner.currentPath = null; // let the log carry the reconstruction
          return { kind: 'reconstruct', text: '← backtrack: ' + problem.cities[cur].label + ' came from ' + problem.cities[p].label };
        }
        // finished: assemble the full closed tour
        const path = [];
        m = FULL; cur = bestEnd;
        while (true) {
          path.push(cur);
          if (m === 1) break;
          const pp = parent[at(m, cur)];
          m = m ^ (1 << cur);
          cur = pp;
        }
        path.reverse();
        path.push(0);
        runner.bestPath = path;
        runner.currentPath = path;
        runner.currentCost = runner.bestCost;
        runner.done = true;
        return { kind: 'done', text: '✓ Finished. Optimal tour = ' + routeText(problem, path) + ' = ' + runner.bestCost };
      }
      return null;
    };

    runner.getVisual = function () {
      const info = runner._dpInfo;
      let maskCities = null, currentNode = null;
      if (info && !runner.done) {
        maskCities = [];
        for (let j = 0; j < n; j++) if (info.mask & (1 << j)) maskCities.push(j);
        currentNode = info.city;
      }
      return {
        currentPath: runner.currentPath,
        currentCost: runner.currentCost,
        bestPath: runner.bestPath,
        bestCost: runner.bestCost,
        currentNode: currentNode,
        maskCities: maskCities,
        pruned: null
      };
    };

    runner._intro = { kind: 'start', text: 'Held–Karp: computing ' + queue.length + ' DP states dp[mask][city]' };
    return runner;
  }

  /* ============================================================
     3. BRANCH & BOUND — depth-first search with an admissible
     lower bound, so whole subtrees can be pruned safely.
     ------------------------------------------------------------
     Partial route: 0 → … → cur, unvisited set U.
     Lower bound used here (admissible — never overestimates):
         LB = costSoFar
            + minOut(cur)              // must leave the current city
            + Σ minOut(u) for u in U   // must leave every unvisited city
            + minIn(0)                 // must return to the start
     If LB ≥ best known complete tour → prune the subtree.
     A nearest-neighbor tour seeds the initial upper bound.
     Worst case is still exponential — pruning only *usually* helps.
     ============================================================ */
  function createBranchBoundRunner(problem) {
    const n = problem.n;
    const FULL = (1 << n) - 1;

    // precompute min outgoing / incoming edge per city
    const minOut = new Array(n).fill(Infinity);
    const minIn = new Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const d = problem.dist[i][j];
        if (d < minOut[i]) minOut[i] = d;
        if (d < minIn[j]) minIn[j] = d;
      }
    }

    // admissible lower bound for a partial route.
    // A completion must add exactly: one outgoing edge from `cur`,
    // one outgoing edge from every unvisited city, and one incoming
    // edge to the start city. Each is lower-bounded by its minimum,
    // so no real completion can be cheaper than this.
    function lowerBound(path, costSoFar) {
      const cur = path[path.length - 1];
      let visited = 0;
      for (const c of path) visited |= (1 << c);
      let lb = costSoFar + minOut[cur] + minIn[0];
      for (let u = 0; u < n; u++) {
        if (!(visited & (1 << u))) lb += minOut[u];
      }
      return lb;
    }

    // nearest-neighbor heuristic for a good initial upper bound
    function nearestNeighbor() {
      const path = [0];
      let visited = 1, cost = 0, cur = 0;
      while (visited !== FULL) {
        let best = -1, bd = Infinity;
        for (let u = 0; u < n; u++) {
          if (visited & (1 << u)) continue;
          if (problem.dist[cur][u] < bd) { bd = problem.dist[cur][u]; best = u; }
        }
        cost += bd; cur = best; path.push(cur); visited |= (1 << cur);
      }
      cost += problem.dist[cur][0];
      path.push(0);
      return { path, cost };
    }

    const nn = nearestNeighbor();

    const runner = {
      id: 'branchbound',
      name: 'Branch & Bound',
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: nn.cost,
      bestPath: nn.path.slice(),
      currentPath: null,
      currentCost: null,
      done: false
    };

    // explicit DFS stack; children pushed nearest-first so a good
    // incumbent appears early and pruning kicks in sooner
    const stack = [{ path: [0], cost: 0 }];

    function pushChildren(node) {
      const cur = node.path[node.path.length - 1];
      let visited = 0;
      for (const c of node.path) visited |= (1 << c);
      const kids = [];
      for (let u = 0; u < n; u++) {
        if (!(visited & (1 << u))) kids.push(u);
      }
      kids.sort((a, b) => problem.dist[cur][b] - problem.dist[cur][a]); // farthest first → nearest pops first
      for (const u of kids) {
        stack.push({ path: node.path.concat([u]), cost: node.cost + problem.dist[cur][u] });
      }
      runner.stats.transitions += kids.length;
    }

    runner.step = function () {
      if (runner.done) return null;
      if (stack.length === 0) {
        runner.done = true;
        return { kind: 'done', text: '✓ Finished. Optimal = ' + runner.bestCost + '  (' + routeText(problem, runner.bestPath) + ')' };
      }
      const node = stack.pop();
      runner.stats.statesExplored++;
      runner.currentPath = node.path;
      runner.currentCost = node.cost;

      const cur = node.path[node.path.length - 1];
      let visited = 0;
      for (const c of node.path) visited |= (1 << c);

      // complete tour?
      if (visited === FULL) {
        const total = node.cost + problem.dist[cur][0];
        const tour = node.path.concat([0]);
        runner.currentPath = tour;
        runner.currentCost = total;
        if (total < runner.bestCost) {
          runner.bestCost = total;
          runner.bestPath = tour.slice();
          return { kind: 'best', text: '★ New best = ' + total + '  (' + routeText(problem, tour) + ')' };
        }
        return { kind: 'eval', text: 'Complete tour ' + routeText(problem, tour) + ' = ' + total + ' (no improvement)' };
      }

      // bound check — the heart of Branch & Bound
      const lb = lowerBound(node.path, node.cost);
      if (lb >= runner.bestCost) {
        runner.stats.statesPruned++;
        return {
          kind: 'prune',
          text: '✕ Pruned ' + routeText(problem, node.path) + '…  — lower bound ' + lb + ' ≥ best ' + runner.bestCost,
          data: { path: node.path.slice(), bound: lb, best: runner.bestCost }
        };
      }

      pushChildren(node);
      return {
        kind: 'bound',
        text: '→ Exploring ' + routeText(problem, node.path) + '  (cost ' + node.cost + ', bound ' + lb + ' < best ' + runner.bestCost + ')'
      };
    };

    runner.getVisual = function () {
      return {
        currentPath: runner.currentPath,
        currentCost: runner.currentCost,
        bestPath: runner.bestPath,
        bestCost: runner.bestCost,
        currentNode: runner.currentPath ? runner.currentPath[runner.currentPath.length - 1] : null,
        maskCities: null,
        pruned: null
      };
    };

    runner._intro = {
      kind: 'start',
      text: 'Branch & Bound: initial upper bound ' + nn.cost + ' from nearest-neighbor (' + routeText(problem, nn.path) + ')'
    };
    return runner;
  }

  /* ---------------- factory ---------------- */
  TSP.createRunner = function (algoId, problem) {
    switch (algoId) {
      case 'brute': return createBruteForceRunner(problem);
      case 'heldkarp': return createHeldKarpRunner(problem);
      case 'branchbound': return createBranchBoundRunner(problem);
      default: throw new Error('Unknown algorithm: ' + algoId);
    }
  };

  /** Headless fast run (for Experiment mode): steps until done, yielding periodically. */
  TSP.runHeadless = async function (algoId, problem, onProgress) {
    const runner = TSP.createRunner(algoId, problem);
    const t0 = performance.now();
    let steps = 0;
    while (!runner.done) {
      runner.step();
      if (++steps % 2000 === 0) {
        if (onProgress) onProgress(steps);
        await new Promise(r => setTimeout(r, 0)); // keep UI responsive
      }
    }
    return {
      algoId,
      n: problem.n,
      statesExplored: runner.stats.statesExplored,
      statesPruned: runner.stats.statesPruned,
      transitions: runner.stats.transitions,
      bestCost: runner.bestCost,
      ms: performance.now() - t0
    };
  };

  // small helper used by the brute-force intro message (safe factorial)
  TSP.factorial = function (k) {
    let f = 1;
    for (let i = 2; i <= k; i++) f *= i;
    return f;
  };
})();
