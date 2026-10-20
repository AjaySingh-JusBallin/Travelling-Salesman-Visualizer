/* ============================================================
   algorithms.js — TSP algorithms as *steppable* event producers
   ------------------------------------------------------------
   Each algorithm is a factory:  createRunner(problem, params)

   A runner advances exactly ONE meaningful operation per step()
   call and returns a TYPED event (see engine.js for the kinds):

     runner.step()  ->  event object, or null when finished

   Event: { kind, line, explain, text, data }
     kind: one of TSP.EVENT_KINDS
     line: pseudocode line id (for live highlighting)
     data: structured payload (path, cost, edge, bound, ...)

   The engine (engine.js) records these events headlessly and then
   plays them back — the runner never touches the DOM and knows
   nothing about animation speed.

   Every runner exposes:
     .id, .name, .kind ('exact' | 'approximation' | 'heuristic')
     .guaranteesOptimal (bool)
     .stats { statesExplored, statesPruned, transitions }
     .bestCost (null until a tour is found), .bestPath
     .params (for reproducibility / reports)
     .getFrame()  -> compact visual frame after the latest event
     .getTree()   -> search-tree nodes (Branch & Bound) or null
     .getDP()     -> DP table access (Held–Karp) or null

   All statistics are measured from the real implementation —
   nothing is faked. Stochastic algorithms use a seeded PRNG so
   runs are reproducible.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  TSP.factorial = function (k) {
    let f = 1;
    for (let i = 2; i <= k; i++) f *= i;
    return f;
  };

  /** Algorithm catalogue for the UI (order = display order). */
  TSP.ALGORITHMS = [
    { id: 'brute',       name: 'Brute Force',          tc: 'O((n−1)!)', kind: 'exact' },
    { id: 'heldkarp',    name: 'Held–Karp (DP)',       tc: 'O(n²·2ⁿ)',  kind: 'exact' },
    { id: 'branchbound', name: 'Branch & Bound',       tc: 'exp.*',     kind: 'exact' },
    { id: 'nearest',     name: 'Nearest Neighbor',     tc: 'O(n²)',     kind: 'heuristic' },
    { id: 'twoopt',      name: '2-opt Local Search',   tc: 'O(k·n²)',   kind: 'heuristic' },
    { id: 'mst',         name: 'MST Approximation',    tc: 'O(n²)',     kind: 'approximation' },
    { id: 'genetic',     name: 'Genetic Algorithm',    tc: 'O(g·p·n)',  kind: 'heuristic' },
    { id: 'annealing',   name: 'Simulated Annealing',  tc: 'O(i·n)',    kind: 'heuristic' }
  ];
  TSP.algoMeta = function (id) {
    return TSP.ALGORITHMS.find(a => a.id === id) || { id, name: id, tc: '', kind: 'heuristic' };
  };

  function frame(path, cost, bestPath, bestCost, node, extra) {
    return {
      path: path ? path.slice() : null,
      cost: cost === undefined ? null : cost,
      bestPath: bestPath ? bestPath.slice() : null,
      bestCost: bestCost === undefined ? null : bestCost,
      node: node === undefined ? null : node,
      mask: null,
      pruned: null,
      extra: extra || {}
    };
  }

  /* ============================================================
     1. BRUTE FORCE — enumerate all (n-1)! permutations (Heap's
     algorithm, iterative so we can step through it).
     Fix start city 0; permute the remaining n-1 cities.
     Exact. Time O((n-1)!), Space O(n).
     ============================================================ */
  function createBruteForceRunner(problem) {
    const n = problem.n;
    const others = [];
    for (let i = 1; i < n; i++) others.push(i);
    const k = others.length;

    const runner = {
      id: 'brute',
      name: 'Brute Force',
      kind: 'exact',
      guaranteesOptimal: true,
      params: {},
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: null,
      bestPath: null,
      currentPath: null,
      currentCost: null,
      done: false,
      getTree() { return null; },
      getDP() { return null; }
    };

    const perm = others.slice();
    const c = new Array(k).fill(0);
    let i = 0;
    let started = false;
    let firstPending = true;

    function evaluate() {
      const tour = [0].concat(perm, [0]);
      const cost = problem.tourCost(tour);
      runner.stats.statesExplored++;
      runner.stats.transitions++;
      runner.currentPath = tour;
      runner.currentCost = cost;
      if (runner.bestCost === null || cost < runner.bestCost) {
        const prev = runner.bestCost;
        runner.bestCost = cost;
        runner.bestPath = tour.slice();
        return {
          kind: 'BEST_TOUR_UPDATED', line: 'brute-5',
          explain: 'This tour is cheaper than every tour seen so far — it becomes the new incumbent.',
          data: { path: tour.slice(), cost, prevBest: prev }
        };
      }
      return {
        kind: 'TOUR_COMPLETED', line: 'brute-4',
        explain: 'Complete tour evaluated. It does not beat the incumbent, so the best is unchanged.',
        data: { path: tour.slice(), cost, improved: false }
      };
    }

    runner.step = function () {
      if (runner.done) return null;
      if (!started) {
        started = true;
        return {
          kind: 'START', line: 'brute-1',
          explain: 'Fixing the start city avoids counting rotations of the same tour as different tours.',
          data: { note: 'Enumerating all ' + TSP.factorial(k) + ' tours from ' + problem.cities[0].label + ' (Heap’s algorithm)', n, tours: TSP.factorial(k) }
        };
      }
      if (firstPending) {
        firstPending = false;
        const ev = evaluate();
        if (k === 0) { runner.done = true; }
        return ev;
      }
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
      return null;
    };

    runner.getFrame = function () {
      const f = frame(runner.currentPath, runner.currentCost, runner.bestPath, runner.bestCost,
        runner.currentPath ? runner.currentPath[runner.currentPath.length - 2] : null);
      return f;
    };
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
     Exact. Time O(n²·2ⁿ), Space O(n·2ⁿ).
     ============================================================ */
  function createHeldKarpRunner(problem) {
    const n = problem.n;
    const FULL = (1 << n) - 1;
    const INF = Number.POSITIVE_INFINITY;

    const dp = new Float64Array((FULL + 1) * n).fill(INF);
    const parent = new Int16Array((FULL + 1) * n).fill(-1);
    const at = (mask, i) => mask * n + i;
    dp[at(1, 0)] = 0;

    const pop = new Uint8Array(FULL + 1);
    for (let m = 1; m <= FULL; m++) pop[m] = pop[m >> 1] + (m & 1);

    const queue = [];
    for (let size = 2; size <= n; size++) {
      for (let mask = 0; mask <= FULL; mask++) {
        if (pop[mask] !== size || !(mask & 1)) continue;
        for (let i = 1; i < n; i++) {
          if (mask & (1 << i)) queue.push([mask, i]);
        }
      }
    }

    const runner = {
      id: 'heldkarp',
      name: 'Held–Karp (DP)',
      kind: 'exact',
      guaranteesOptimal: true,
      params: {},
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: null,
      bestPath: null,
      currentPath: null,
      currentCost: null,
      done: false,
      getTree() { return null; },
      getDP() { return { n, FULL, dp, parent, order: queue }; }
    };

    let started = false;
    let qi = 0;
    let phase = 'dp';
    let bestEnd = -1;
    let reconMask = 0, reconCity = -1;
    let reconRev = [];
    let dpInfo = null; // {mask, city, via} for the frame

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
      return rev;
    }

    runner.step = function () {
      if (runner.done) return null;
      if (!started) {
        started = true;
        return {
          kind: 'START', line: 'heldkarp-1',
          explain: 'Each DP state memoizes the cheapest way to reach a subset of cities — no subproblem is ever solved twice.',
          data: { note: 'Computing ' + queue.length + ' DP states dp[mask][city] in order of increasing subset size', n, states: queue.length }
        };
      }

      if (phase === 'dp') {
        if (qi >= queue.length) { phase = 'finish'; return runner.step(); }
        const [mask, i] = queue[qi++];
        const prev = mask ^ (1 << i);
        let best = INF, bestJ = -1, tried = 0;
        const candidates = [];
        for (let j = 0; j < n; j++) {
          if (!(prev & (1 << j))) continue;
          tried++;
          const cand = dp[at(prev, j)] + problem.dist[j][i];
          candidates.push({ from: j, cost: cand });
          if (cand < best) { best = cand; bestJ = j; }
        }
        dp[at(mask, i)] = best;
        parent[at(mask, i)] = bestJ;
        runner.stats.statesExplored++;
        runner.stats.transitions += tried;
        runner.currentPath = partialPath(mask, i);
        runner.currentCost = best;
        dpInfo = { mask, city: i, via: bestJ };
        return {
          kind: 'DP_STATE_UPDATED', line: 'heldkarp-4',
          explain: 'Trying every possible previous city; the cheapest transition wins and is memoized.',
          data: { mask, city: i, value: best, via: bestJ, tried, candidates, prevMask: prev }
        };
      }

      if (phase === 'finish') {
        let best = INF;
        for (let i = 1; i < n; i++) {
          const cand = dp[at(FULL, i)] + problem.dist[i][0];
          if (cand < best) { best = cand; bestEnd = i; }
        }
        runner.bestCost = best;
        phase = 'reconstruct';
        reconMask = FULL; reconCity = bestEnd; reconRev = [];
        dpInfo = null;
        return {
          kind: 'PARTIAL_ROUTE_UPDATED', line: 'heldkarp-7',
          explain: 'DP table complete. Closing every full state back to the start gives the optimal tour cost — now backtracking parent pointers to recover the tour itself.',
          data: { path: null, cost: best, note: 'Best closed-tour cost = ' + best }
        };
      }

      if (phase === 'reconstruct') {
        reconRev.push(reconCity);
        const p = parent[at(reconMask, reconCity)];
        if (p < 0) {
          const tour = reconRev.slice().reverse();
          tour.push(0);
          runner.bestPath = tour;
          runner.currentPath = tour;
          runner.currentCost = runner.bestCost;
          runner.done = true;
          return {
            kind: 'BEST_TOUR_UPDATED', line: 'heldkarp-8',
            explain: 'Parent pointers chain every state back to the start — following them recovers the optimal tour.',
            data: { path: tour.slice(), cost: runner.bestCost, prevBest: null }
          };
        }
        reconMask = reconMask ^ (1 << reconCity);
        reconCity = p;
        runner.currentPath = reconRev.slice().reverse();
        return {
          kind: 'PARTIAL_ROUTE_UPDATED', line: 'heldkarp-8',
          explain: problem.cities[reconRev[reconRev.length - 1]].label + ' was reached cheapest from ' +
            problem.cities[p].label + ' — continuing the backtrack.',
          data: { path: runner.currentPath.slice(), cost: null, note: 'backtrack step' }
        };
      }
      return null;
    };

    runner.getFrame = function () {
      const f = frame(runner.currentPath, runner.currentCost, runner.bestPath, runner.bestCost,
        runner.currentPath ? runner.currentPath[runner.currentPath.length - 1] : null,
        dpInfo ? { dpMask: dpInfo.mask, dpCity: dpInfo.city, dpVia: dpInfo.via } : {});
      if (dpInfo) {
        f.mask = [];
        for (let j = 0; j < n; j++) if (dpInfo.mask & (1 << j)) f.mask.push(j);
      }
      return f;
    };
    return runner;
  }

  /* ============================================================
     3. BRANCH & BOUND — depth-first search with an admissible
     lower bound, so whole subtrees can be pruned safely.
     ------------------------------------------------------------
     Partial route: 0 → … → cur, unvisited set U.
     Lower bound (admissible — never overestimates):
         LB = costSoFar
            + minOut(cur)              // must leave the current city
            + Σ minOut(u) for u in U   // must leave every unvisited city
     (The return edge to the start IS one of those outgoing edges —
     the edge leaving whichever city precedes 0 — so it must not be
     counted twice.)
     If LB ≥ best known complete tour → prune the subtree.
     A nearest-neighbor tour seeds the initial upper bound.
     Exact. Worst case is still exponential — pruning only
     *usually* helps.
     ============================================================ */
  function createBranchBoundRunner(problem) {
    const n = problem.n;
    const FULL = (1 << n) - 1;
    const MAX_TREE_NODES = 50000;

    // Precompute the minimum outgoing edge per city. A completion of a
    // partial route adds exactly |U|+1 edges — one outgoing edge from
    // `cur` and one from every unvisited city — so each is lower-bounded
    // by its tail's minimum outgoing edge. (The final return to the
    // start is already one of those outgoing edges, hence it is NOT
    // added separately: doing so would double-count it and make the
    // bound inadmissible.)
    const minOut = new Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const d = problem.dist[i][j];
        if (d < minOut[i]) minOut[i] = d;
      }
    }

    // Admissible lower bound for a partial route. No real completion
    // can be cheaper than this sum.
    function lowerBound(path, costSoFar) {
      const cur = path[path.length - 1];
      let visited = 0;
      for (const c of path) visited |= (1 << c);
      let lb = costSoFar + minOut[cur];
      for (let u = 0; u < n; u++) {
        if (!(visited & (1 << u))) lb += minOut[u];
      }
      return lb;
    }

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

    // ---- search-tree recording ----
    let nodeSeq = 0;
    let treeTruncated = false;
    const treeNodes = [];
    function newNode(parentId, path, cost) {
      if (nodeSeq >= MAX_TREE_NODES) { treeTruncated = true; return null; }
      const node = {
        id: nodeSeq++, parentId, path: path.slice(), cost,
        bound: null, status: 'generated', children: [],
        pruneReason: null, order: -1
      };
      treeNodes.push(node);
      if (parentId !== null && parentId >= 0 && treeNodes[parentId]) treeNodes[parentId].children.push(node.id);
      return node;
    }
    const rootNode = newNode(-1, [0], 0);

    const runner = {
      id: 'branchbound',
      name: 'Branch & Bound',
      kind: 'exact',
      guaranteesOptimal: true,
      params: {},
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: nn.cost,
      bestPath: nn.path.slice(),
      currentPath: null,
      currentCost: null,
      currentNodeId: null,
      currentBound: null,
      done: false,
      getTree() { return { nodes: treeNodes, rootId: 0, truncated: treeTruncated }; },
      getDP() { return null; }
    };

    const stack = [{ node: rootNode, path: [0], cost: 0 }];
    let started = false;
    let expandOrder = 0;
    let lastPrunedPath = null;

    runner.step = function () {
      if (runner.done) return null;
      if (!started) {
        started = true;
        runner.currentPath = nn.path.slice();
        runner.currentCost = nn.cost;
        return {
          kind: 'START', line: 'bb-1',
          explain: 'A quick greedy tour gives an initial upper bound, so pruning can start working immediately.',
          data: { note: 'Initial upper bound ' + nn.cost + ' from nearest-neighbor', bound: nn.cost, path: nn.path.slice() }
        };
      }
      if (stack.length === 0) {
        runner.done = true;
        return null;
      }
      const item = stack.pop();
      const node = item.node;
      runner.stats.statesExplored++;
      runner.currentPath = item.path;
      runner.currentCost = item.cost;

      const cur = item.path[item.path.length - 1];
      let visited = 0;
      for (const c of item.path) visited |= (1 << c);

      if (visited === FULL) {
        const total = item.cost + problem.dist[cur][0];
        const tour = item.path.concat([0]);
        runner.currentPath = tour;
        runner.currentCost = total;
        if (node) { node.status = 'complete'; node.order = expandOrder++; }
        if (total < runner.bestCost) {
          const prev = runner.bestCost;
          runner.bestCost = total;
          runner.bestPath = tour.slice();
          return {
            kind: 'BEST_TOUR_UPDATED', line: 'bb-6',
            explain: 'A complete tour cheaper than the incumbent becomes the new upper bound — future pruning gets stronger.',
            data: { path: tour.slice(), cost: total, prevBest: prev, nodeId: node ? node.id : null }
          };
        }
        return {
          kind: 'TOUR_COMPLETED', line: 'bb-6',
          explain: 'Complete tour, but no better than the incumbent.',
          data: { path: tour.slice(), cost: total, improved: false, nodeId: node ? node.id : null }
        };
      }

      const lb = lowerBound(item.path, item.cost);
      runner.currentBound = lb;
      if (node) { node.bound = lb; runner.currentNodeId = node.id; }
      if (lb >= runner.bestCost) {
        runner.stats.statesPruned++;
        if (node) {
          node.status = 'pruned';
          node.order = expandOrder++;
          node.pruneReason = 'LB ' + lb + ' ≥ best ' + runner.bestCost +
            ': even the cheapest possible completion (min outgoing edge from each remaining city) cannot beat the incumbent.';
        }
        lastPrunedPath = item.path.slice();
        return {
          kind: 'STATE_PRUNED', line: 'bb-5',
          explain: 'The lower bound is admissible (never overestimates), so discarding this subtree cannot discard the optimum.',
          data: {
            nodeId: node ? node.id : null, path: item.path.slice(), bound: lb, best: runner.bestCost,
            reason: 'Lower bound ' + lb + ' ≥ incumbent ' + runner.bestCost
          }
        };
      }

      // expand: generate children nearest-first so good incumbents appear early
      if (node) { node.status = 'expanded'; node.order = expandOrder++; }
      const kids = [];
      for (let u = 0; u < n; u++) {
        if (!(visited & (1 << u))) kids.push(u);
      }
      kids.sort((a, b) => problem.dist[cur][b] - problem.dist[cur][a]);
      const childIds = [];
      for (const u of kids) {
        const child = newNode(node ? node.id : -1, item.path.concat([u]), item.cost + problem.dist[cur][u]);
        if (child) childIds.push(child.id);
        stack.push({ node: child, path: item.path.concat([u]), cost: item.cost + problem.dist[cur][u] });
      }
      runner.stats.transitions += kids.length;
      lastPrunedPath = null;
      return {
        kind: 'STATE_EXPANDED', line: 'bb-4',
        explain: 'Bound ' + lb + ' < incumbent ' + runner.bestCost + ' — this branch might still improve, so it is explored.',
        data: { nodeId: node ? node.id : null, path: item.path.slice(), cost: item.cost, bound: lb, children: childIds }
      };
    };

    runner.getFrame = function () {
      const f = frame(runner.currentPath, runner.currentCost, runner.bestPath, runner.bestCost,
        runner.currentPath ? runner.currentPath[runner.currentPath.length - 1] : null,
        { nodeId: runner.currentNodeId, bound: runner.currentBound });
      if (lastPrunedPath && lastPrunedPath.length >= 2) {
        f.pruned = [];
        for (let k = 0; k + 1 < lastPrunedPath.length; k++) {
          f.pruned.push([lastPrunedPath[k], lastPrunedPath[k + 1]]);
        }
      }
      return f;
    };
    return runner;
  }

  /* ============================================================
     4. NEAREST NEIGHBOR — greedy tour construction.
     Repeatedly go to the nearest unvisited city.
     Heuristic (no optimality guarantee). Time O(n²): each of the
     n−1 selections scans all unvisited cities.
     ============================================================ */
  function createNearestNeighborRunner(problem, params) {
    const n = problem.n;
    const FULL = (1 << n) - 1;
    const runner = {
      id: 'nearest',
      name: 'Nearest Neighbor',
      kind: 'heuristic',
      guaranteesOptimal: false,
      params: { startCity: 0 },
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: null,
      bestPath: null,
      currentPath: [0],
      currentCost: 0,
      done: false,
      getTree() { return null; },
      getDP() { return null; }
    };
    let started = false;
    let visited = 1, cur = 0, cost = 0;
    const path = [0];
    let lastCandidates = [], lastChosen = -1;

    runner.step = function () {
      if (runner.done) return null;
      if (!started) {
        started = true;
        return {
          kind: 'START', line: 'nn-1',
          explain: 'Greedy choice: always visit the closest unvisited city. Fast — but greedy is not always optimal.',
          data: { note: 'Greedy construction from ' + problem.cities[0].label, n }
        };
      }
      if (visited === FULL) {
        const total = cost + problem.dist[cur][0];
        const tour = path.concat([0]);
        runner.bestCost = total;
        runner.bestPath = tour.slice();
        runner.currentPath = tour;
        runner.currentCost = total;
        runner.done = true;
        lastCandidates = [];
        return {
          kind: 'TOUR_COMPLETED', line: 'nn-5',
          explain: 'Greedy tour complete. It is a valid tour, but nothing proves it is optimal.',
          data: { path: tour.slice(), cost: total, improved: true }
        };
      }
      const candidates = [];
      for (let u = 0; u < n; u++) {
        if (visited & (1 << u)) continue;
        candidates.push({ city: u, dist: problem.dist[cur][u] });
        runner.stats.transitions++;
      }
      candidates.sort((a, b) => a.dist - b.dist || a.city - b.city);
      const chosen = candidates[0];
      cost += chosen.dist;
      cur = chosen.city;
      path.push(cur);
      visited |= (1 << cur);
      runner.stats.statesExplored++;
      runner.currentPath = path.slice();
      runner.currentCost = cost;
      lastCandidates = candidates.map(c => c.city);
      lastChosen = cur;
      return {
        kind: 'CANDIDATE_SELECTED', line: 'nn-3',
        explain: problem.cities[cur].label + ' is the nearest unvisited city (distance ' + chosen.dist +
          ') — the greedy choice. A different choice might lead to a better overall tour.',
        data: { city: cur, candidates: candidates.map(c => ({ city: c.city, dist: c.dist })), cost, path: path.slice() }
      };
    };

    runner.getFrame = function () {
      const f = frame(runner.currentPath, runner.currentCost, runner.bestPath, runner.bestCost, cur,
        { candidates: lastCandidates.slice(), chosen: lastChosen });
      return f;
    };
    return runner;
  }

  /* ============================================================
     5. 2-OPT LOCAL SEARCH — start from a valid tour, repeatedly
     replace two edges (a,b),(c,e) with (a,c),(b,e) whenever it
     shortens the tour.
     Heuristic. Each full scan evaluates O(n²) swaps; the number
     of improving iterations k depends on the instance and the
     maxIterations cap → O(k·n²) total.
     ============================================================ */
  function createTwoOptRunner(problem, params) {
    const n = problem.n;
    const maxIterations = Math.max(1, Math.min(10000, (params && params.maxIterations) || 1000));
    // initial tour: nearest neighbor
    function nnTour() {
      const path = [0];
      let visited = 1, cost = 0, cur = 0;
      const FULL = (1 << n) - 1;
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
    const init = nnTour();

    const runner = {
      id: 'twoopt',
      name: '2-opt Local Search',
      kind: 'heuristic',
      guaranteesOptimal: false,
      params: { maxIterations, startTour: 'nearest-neighbor' },
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: init.cost,
      bestPath: init.path.slice(),
      currentPath: init.path.slice(),
      currentCost: init.cost,
      done: false,
      getTree() { return null; },
      getDP() { return null; }
    };

    let tour = init.path.slice(); // closed: tour[0] === tour[n] === 0
    let cost = init.cost;
    let started = false;
    let i = 1, j = 2;
    let iteration = 0;
    let improvedThisPass = false;
    let lastSwap = null;

    function resetScan() { i = 1; j = i + 1; improvedThisPass = false; }

    runner.step = function () {
      if (runner.done) return null;
      if (!started) {
        started = true;
        return {
          kind: 'START', line: 'twoopt-1',
          explain: 'Local search: start from a valid (greedy) tour and keep fixing crossings until no single 2-swap helps.',
          data: { note: 'Initial tour cost ' + cost + ' (nearest neighbor); max ' + maxIterations + ' improving iterations', cost }
        };
      }
      // scan pairs (i,j): reverse segment tour[i..j]
      while (true) {
        if (i > n - 2) {
          // full pass done
          if (!improvedThisPass || iteration >= maxIterations) {
            runner.bestCost = cost;
            runner.bestPath = tour.slice();
            runner.done = true;
            lastSwap = null;
            return {
              kind: 'TOUR_COMPLETED', line: 'twoopt-7',
              explain: improvedThisPass
                ? 'Stopped at the iteration cap (' + maxIterations + ') — a local optimum was not necessarily reached.'
                : 'No improving 2-swap remains: the tour is 2-optimal (a local optimum, not necessarily global).',
              data: { path: tour.slice(), cost, improved: false, iterations: iteration }
            };
          }
          iteration++;
          resetScan();
          continue;
        }
        if (j > n - 1) { i++; j = i + 1; continue; }
        break;
      }
      const a = tour[i - 1], b = tour[i], c = tour[j], e = tour[j + 1];
      const delta = -problem.dist[a][b] - problem.dist[c][e] + problem.dist[a][c] + problem.dist[b][e];
      runner.stats.statesExplored++;
      runner.stats.transitions++;
      const ci = i, cj = j;
      j++;
      lastSwap = { remove: [[a, b], [c, e]], add: [[a, c], [b, e]], delta, improved: delta < 0 };
      if (delta < 0) {
        // apply first-improvement: reverse segment
        const seg = tour.slice(ci, cj + 1).reverse();
        for (let k = 0; k < seg.length; k++) tour[ci + k] = seg[k];
        cost += delta;
        improvedThisPass = true;
        runner.currentPath = tour.slice();
        runner.currentCost = cost;
        if (cost < runner.bestCost) {
          const prev = runner.bestCost;
          runner.bestCost = cost;
          runner.bestPath = tour.slice();
          return {
            kind: 'BEST_TOUR_UPDATED', line: 'twoopt-5',
            explain: 'Uncrossing those two edges shortens the tour by ' + (-delta) + ' — the improvement is kept.',
            data: { path: tour.slice(), cost, prevBest: prev, improvement: -delta, iteration }
          };
        }
        return {
          kind: 'PARTIAL_ROUTE_UPDATED', line: 'twoopt-5',
          explain: 'Uncrossing shortens the tour by ' + (-delta) + '.',
          data: { path: tour.slice(), cost, improvement: -delta, iteration }
        };
      }
      return {
        kind: 'EDGE_CONSIDERED', line: 'twoopt-4',
        explain: 'Swapping these edges would change the cost by ' + (delta > 0 ? '+' : '') + delta + ' — not an improvement, skipped.',
        data: { remove: [[a, b], [c, e]], add: [[a, c], [b, e]], delta, improved: false, iteration }
      };
    };

    runner.getFrame = function () {
      const f = frame(runner.currentPath, runner.currentCost, runner.bestPath, runner.bestCost,
        null, { swap: lastSwap, iteration });
      return f;
    };
    return runner;
  }

  /* ============================================================
     6. MST APPROXIMATION — double-tree heuristic.
     Build an MST (Prim, O(n²)), preorder-walk it, shortcut
     repeated vertices → a tour ≤ 2 × OPT for *metric* TSP
     (triangle inequality required for the guarantee).
     Approximation, not exact.
     ============================================================ */
  function createMstRunner(problem) {
    const n = problem.n;
    const runner = {
      id: 'mst',
      name: 'MST Approximation',
      kind: 'approximation',
      guaranteesOptimal: false,
      params: {},
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: null,
      bestPath: null,
      currentPath: null,
      currentCost: null,
      done: false,
      getTree() { return null; },
      getDP() { return null; }
    };

    // Prim's algorithm state
    const inMST = new Array(n).fill(false);
    const minEdge = new Array(n).fill(Infinity);
    const parentEdge = new Array(n).fill(-1);
    const mstEdges = [];
    const adj = Array.from({ length: n }, () => []);
    inMST[0] = true;
    for (let v = 1; v < n; v++) { minEdge[v] = problem.dist[0][v]; parentEdge[v] = 0; }
    let addedCount = 1;
    let started = false;
    let phase = 'mst';
    let preorder = [], dfsStack = null, dfsVisited = null, walkPath = [];

    runner.step = function () {
      if (runner.done) return null;
      if (!started) {
        started = true;
        return {
          kind: 'START', line: 'mst-1',
          explain: 'Double-tree method: an MST is at most OPT (drop one edge from the optimal tour), and walking it twice visits every city — shortcutting gives a tour ≤ 2·OPT on metric instances.',
          data: { note: 'Prim’s MST (O(n²)), then preorder walk with shortcuts', n }
        };
      }
      if (phase === 'mst') {
        if (addedCount >= n) {
          phase = 'walk';
          dfsVisited = new Array(n).fill(false);
          dfsStack = [0];
          walkPath = [];
          let mstW = 0;
          for (const [a, b] of mstEdges) mstW += problem.dist[a][b];
          return {
            kind: 'PARTIAL_ROUTE_UPDATED', line: 'mst-4',
            explain: 'MST complete (weight ' + mstW + '). A preorder DFS walk visits every city; skipping already-visited cities can only shorten the walk (triangle inequality).',
            data: { path: null, cost: mstW, note: 'MST weight = ' + mstW, mstEdges: mstEdges.map(e => e.slice()) }
          };
        }
        // pick cheapest edge from tree to outside
        let v = -1, best = Infinity;
        for (let x = 0; x < n; x++) {
          if (!inMST[x] && minEdge[x] < best) { best = minEdge[x]; v = x; }
          runner.stats.transitions++;
        }
        const u = parentEdge[v];
        mstEdges.push([u, v]);
        adj[u].push(v); adj[v].push(u);
        inMST[v] = true;
        addedCount++;
        for (let x = 0; x < n; x++) {
          if (!inMST[x] && problem.dist[v][x] < minEdge[x]) { minEdge[x] = problem.dist[v][x]; parentEdge[x] = v; }
        }
        runner.stats.statesExplored++;
        return {
          kind: 'EDGE_CONSIDERED', line: 'mst-2',
          explain: problem.cities[v].label + ' joins the tree via its cheapest connection (to ' +
            problem.cities[u].label + ', weight ' + best + ').',
          data: { edge: [u, v], w: best, mstEdges: mstEdges.map(e => e.slice()) }
        };
      }
      // phase === 'walk': iterative preorder DFS, shortcutting visited cities
      if (dfsStack.length === 0) {
        const tour = walkPath.concat([0]);
        const total = problem.tourCost(tour);
        runner.bestCost = total;
        runner.bestPath = tour.slice();
        runner.currentPath = tour;
        runner.currentCost = total;
        runner.done = true;
        return {
          kind: 'TOUR_COMPLETED', line: 'mst-6',
          explain: 'Shortcut tour complete. On metric TSP this is guaranteed ≤ 2·OPT; on custom non-metric weights the guarantee may not hold.',
          data: { path: tour.slice(), cost: total, improved: true, mstEdges: mstEdges.map(e => e.slice()) }
        };
      }
      const v = dfsStack.pop();
      if (dfsVisited[v]) return runner.step(); // shortcut: skip silently (no event for skipped repeats)
      dfsVisited[v] = true;
      walkPath.push(v);
      // push children in reverse label order for a stable walk
      const kids = adj[v].slice().sort((a, b) => b - a);
      for (const c of kids) if (!dfsVisited[c]) dfsStack.push(c);
      runner.stats.statesExplored++;
      runner.currentPath = walkPath.slice();
      return {
        kind: 'CANDIDATE_SELECTED', line: 'mst-5',
        explain: 'Preorder visit: ' + problem.cities[v].label + ' (already-visited cities are shortcut, never revisited).',
        data: { city: v, path: walkPath.slice(), cost: null, mstEdges: mstEdges.map(e => e.slice()) }
      };
    };

    runner.getFrame = function () {
      const f = frame(runner.currentPath, runner.currentCost, runner.bestPath, runner.bestCost,
        runner.currentPath ? runner.currentPath[runner.currentPath.length - 1] : null,
        { mstEdges: mstEdges.map(e => e.slice()), phase });
      return f;
    };
    return runner;
  }

  /* ============================================================
     7. GENETIC ALGORITHM — population of tours evolved with
     selection, ordered crossover and swap mutation.
     Heuristic. Work per generation: O(p·n) tour evaluations.
     ============================================================ */
  function createGeneticRunner(problem, params) {
    const n = problem.n;
    params = params || {};
    const popSize = Math.max(4, Math.min(500, params.populationSize || 50));
    const generations = Math.max(1, Math.min(2000, params.generations || 100));
    const mutationRate = Math.min(1, Math.max(0, params.mutationRate === undefined ? 0.1 : params.mutationRate));
    const seed = params.seed === undefined ? 42 : params.seed;
    const rand = TSP.seededRandom(seed);

    const tourOf = chrom => [0].concat(chrom, [0]);
    const costOf = chrom => problem.tourCost(tourOf(chrom));

    function randomChrom() {
      const c = [];
      for (let i = 1; i < n; i++) c.push(i);
      for (let i = c.length - 1; i > 0; i--) {
        const k = Math.floor(rand() * (i + 1));
        const t = c[i]; c[i] = c[k]; c[k] = t;
      }
      return c;
    }
    // ordered crossover (OX): valid permutation offspring
    function crossover(a, b) {
      const len = a.length;
      let i = Math.floor(rand() * len), j = Math.floor(rand() * len);
      if (i > j) { const t = i; i = j; j = t; }
      const child = new Array(len).fill(-1);
      const used = new Set();
      for (let k = i; k <= j; k++) { child[k] = a[k]; used.add(a[k]); }
      let p = (j + 1) % len;
      for (let k = 0; k < len; k++) {
        const gene = b[(j + 1 + k) % len];
        if (!used.has(gene)) { child[p] = gene; p = (p + 1) % len; }
      }
      return child;
    }
    function mutate(chrom) {
      for (let k = 0; k < chrom.length; k++) {
        if (rand() < mutationRate) {
          const l = Math.floor(rand() * chrom.length);
          const t = chrom[k]; chrom[k] = chrom[l]; chrom[l] = t;
        }
      }
    }
    function tournament(pop, fits) {
      let bi = Math.floor(rand() * pop.length), bf = fits[bi];
      for (let t = 1; t < 3; t++) {
        const i = Math.floor(rand() * pop.length);
        if (fits[i] < bf) { bf = fits[i]; bi = i; }
      }
      return pop[bi].slice();
    }

    let population = [];
    for (let k = 0; k < popSize; k++) population.push(randomChrom());

    const runner = {
      id: 'genetic',
      name: 'Genetic Algorithm',
      kind: 'heuristic',
      guaranteesOptimal: false,
      params: { populationSize: popSize, generations, mutationRate, seed },
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: null,
      bestPath: null,
      currentPath: null,
      currentCost: null,
      done: false,
      getTree() { return null; },
      getDP() { return null; }
    };
    let started = false;
    let gen = 0;
    let lastStats = null;

    runner.step = function () {
      if (runner.done) return null;
      if (!started) {
        started = true;
        return {
          kind: 'START', line: 'ga-1',
          explain: 'A population of ' + popSize + ' random tours evolves: fitter tours reproduce (ordered crossover), with occasional swap mutations. Seed ' + seed + ' makes the run reproducible.',
          data: { note: 'pop=' + popSize + ', generations=' + generations + ', mutation=' + mutationRate + ', seed=' + seed }
        };
      }
      if (gen >= generations) {
        runner.done = true;
        return null;
      }
      gen++;
      const fits = population.map(costOf);
      runner.stats.transitions += popSize;
      runner.stats.statesExplored++;
      let bi = 0;
      for (let k = 1; k < fits.length; k++) if (fits[k] < fits[bi]) bi = k;
      const genBest = fits[bi];
      let sum = 0, worst = fits[0];
      for (const f of fits) { sum += f; if (f > worst) worst = f; }
      const avg = sum / fits.length;
      const genBestTour = tourOf(population[bi]);
      lastStats = { generation: gen, best: genBest, avg, worst };
      runner.currentPath = genBestTour.slice();
      runner.currentCost = genBest;

      // breed next generation (elitism: keep the best)
      const next = [population[bi].slice()];
      while (next.length < popSize) {
        const a = tournament(population, fits);
        const b = tournament(population, fits);
        const child = crossover(a, b);
        mutate(child);
        next.push(child);
      }
      population = next;

      const isNewGlobal = runner.bestCost === null || genBest < runner.bestCost;
      const prev = runner.bestCost;
      if (isNewGlobal) {
        runner.bestCost = genBest;
        runner.bestPath = genBestTour.slice();
        return {
          kind: 'BEST_TOUR_UPDATED', line: 'ga-6',
          explain: 'Generation ' + gen + ': offspring beat the previous best (avg ' + avg.toFixed(1) + ', worst ' + worst.toFixed(0) + ').',
          data: { path: genBestTour.slice(), cost: genBest, prevBest: prev, generation: gen, avg, worst }
        };
      }
      return {
        kind: 'PARTIAL_ROUTE_UPDATED', line: 'ga-5',
        explain: 'Generation ' + gen + ': best ' + genBest + ', average ' + avg.toFixed(1) + ', worst ' + worst + '. No improvement over the global best.',
        data: { path: genBestTour.slice(), cost: genBest, generation: gen, avg, worst }
      };
    };

    runner.getFrame = function () {
      const f = frame(runner.currentPath, runner.currentCost, runner.bestPath, runner.bestCost,
        null, lastStats ? { generation: lastStats.generation, avg: lastStats.avg, worst: lastStats.worst } : {});
      return f;
    };
    return runner;
  }

  /* ============================================================
     8. SIMULATED ANNEALING — random 2-swaps, accepting worse
     moves with probability exp(−Δ/T) as T cools.
     Heuristic. O(iterations) moves, each evaluated in O(1)
     with a delta update (O(n) if the tour were re-scored).
     ============================================================ */
  function createAnnealingRunner(problem, params) {
    const n = problem.n;
    params = params || {};
    const temp0 = params.initialTemp || 1000;
    const cooling = params.coolingRate || 0.995;
    const iterations = Math.max(1, Math.min(50000, params.iterations || 2000));
    const seed = params.seed === undefined ? 7 : params.seed;
    const rand = TSP.seededRandom(seed);

    function nnTour() {
      const path = [0];
      let visited = 1, cost = 0, cur = 0;
      const FULL = (1 << n) - 1;
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
    const init = nnTour();
    let tour = init.path.slice();
    let curCost = init.cost;

    const runner = {
      id: 'annealing',
      name: 'Simulated Annealing',
      kind: 'heuristic',
      guaranteesOptimal: false,
      params: { initialTemp: temp0, coolingRate: cooling, iterations, seed },
      stats: { statesExplored: 0, statesPruned: 0, transitions: 0 },
      bestCost: init.cost,
      bestPath: init.path.slice(),
      currentPath: init.path.slice(),
      currentCost: init.cost,
      done: false,
      getTree() { return null; },
      getDP() { return null; }
    };
    let started = false;
    let it = 0;
    let temp = temp0;
    let lastMove = null;

    runner.step = function () {
      if (runner.done) return null;
      if (!started) {
        started = true;
        return {
          kind: 'START', line: 'sa-1',
          explain: 'Start hot (T=' + temp0 + '): almost any move is accepted, so the search roams. As T cools, only improving moves survive. Seed ' + seed + '.',
          data: { note: 'T₀=' + temp0 + ', cooling ×' + cooling + ', ' + iterations + ' iterations, seed=' + seed }
        };
      }
      if (it >= iterations) {
        runner.done = true;
        lastMove = null;
        return null;
      }
      it++;
      // random 2-swap of positions 1..n-1
      let i = 1 + Math.floor(rand() * (n - 1));
      let j = 1 + Math.floor(rand() * (n - 1));
      if (i === j) j = (j % (n - 1)) + 1;
      if (i > j) { const t = i; i = j; j = t; }
      const a = tour[i - 1], b = tour[i], c = tour[j], e = tour[j + 1];
      const delta = -problem.dist[a][b] - problem.dist[c][e] + problem.dist[a][c] + problem.dist[b][e];
      const acceptProb = delta < 0 ? 1 : Math.exp(-delta / temp);
      const accepted = rand() < acceptProb;
      runner.stats.statesExplored++;
      runner.stats.transitions++;
      lastMove = { remove: [[a, b], [c, e]], add: [[a, c], [b, e]], delta, accepted, temp, iteration: it };
      let ev;
      if (accepted) {
        const seg = tour.slice(i, j + 1).reverse();
        for (let k = 0; k < seg.length; k++) tour[i + k] = seg[k];
        curCost += delta;
        runner.currentPath = tour.slice();
        runner.currentCost = curCost;
        if (curCost < runner.bestCost) {
          const prev = runner.bestCost;
          runner.bestCost = curCost;
          runner.bestPath = tour.slice();
          ev = {
            kind: 'BEST_TOUR_UPDATED', line: 'sa-5',
            explain: 'Accepted (Δ=' + delta + ', T=' + temp.toFixed(1) + ') and it is the best tour seen so far.',
            data: { path: tour.slice(), cost: curCost, prevBest: prev, iteration: it, temp, accepted: true, delta }
          };
        } else {
          ev = {
            kind: 'EDGE_CONSIDERED', line: 'sa-4',
            explain: (delta < 0 ? 'Improving move accepted (Δ=' + delta + ').' : 'Worse move accepted anyway (Δ=+' + delta + ', p=' + acceptProb.toFixed(3) + ', T=' + temp.toFixed(1) + ') — this is how annealing escapes local optima.'),
            data: { remove: [[a, b], [c, e]], add: [[a, c], [b, e]], delta, accepted: true, temp, iteration: it, currentCost: curCost, bestCost: runner.bestCost }
          };
        }
      } else {
        ev = {
          kind: 'EDGE_CONSIDERED', line: 'sa-4',
          explain: 'Worse move rejected (Δ=+' + delta + ', p=' + acceptProb.toFixed(3) + ' < rand, T=' + temp.toFixed(1) + ').',
          data: { remove: [[a, b], [c, e]], add: [[a, c], [b, e]], delta, accepted: false, temp, iteration: it, currentCost: curCost, bestCost: runner.bestCost }
        };
      }
      temp *= cooling;
      return ev;
    };

    runner.getFrame = function () {
      const f = frame(runner.currentPath, runner.currentCost, runner.bestPath, runner.bestCost,
        null, { temp, iteration: it, lastMove });
      return f;
    };
    return runner;
  }

  /* ---------------- factory ---------------- */
  TSP.createRunner = function (algoId, problem, params) {
    switch (algoId) {
      case 'brute': return createBruteForceRunner(problem);
      case 'heldkarp': return createHeldKarpRunner(problem);
      case 'branchbound': return createBranchBoundRunner(problem);
      case 'nearest': return createNearestNeighborRunner(problem, params);
      case 'twoopt': return createTwoOptRunner(problem, params);
      case 'mst': return createMstRunner(problem);
      case 'genetic': return createGeneticRunner(problem, params);
      case 'annealing': return createAnnealingRunner(problem, params);
      default: throw new Error('Unknown algorithm: ' + algoId);
    }
  };
})();
