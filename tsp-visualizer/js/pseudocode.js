/* ============================================================
   pseudocode.js — pseudocode listings for live execution
   highlighting.
   ------------------------------------------------------------
   TSP.PSEUDO[algoId] = [{ id, code, note }]
     id:   referenced by runner events (ev.line) — this is what
           keeps highlighting synchronized with the real code.
     code: pseudocode text (rendered monospace, HTML-escaped).
     note: one-line plain-English gloss shown beside the line.

   The listings mirror the actual implementations in
   algorithms.js — not an idealized textbook version.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  TSP.PSEUDO = {
    brute: [
      { id: 'brute-1', code: 'fix start city s = 0', note: 'Rotations of the same tour are not distinct — fix the start.' },
      { id: 'brute-2', code: 'for each permutation π of the other n−1 cities   (Heap’s algorithm):', note: 'Generates every ordering exactly once.' },
      { id: 'brute-3', code: '    tour ← s → π → s;   cost ← Σ d(tour[k], tour[k+1])', note: 'Score the closed tour by summing its edges.' },
      { id: 'brute-4', code: '    if cost ≥ best: continue        // not an improvement', note: 'Most tours lose — only the count matters.' },
      { id: 'brute-5', code: '    else: best ← cost; bestTour ← tour', note: 'A new incumbent: the best tour seen so far.' },
      { id: 'brute-6', code: 'return bestTour                     // optimal: nothing was skipped', note: 'Exhaustive ⇒ the final best is optimal.' }
    ],
    heldkarp: [
      { id: 'heldkarp-1', code: 'dp[{s}][s] ← 0;  all other dp ← ∞', note: 'Base case: at the start, having visited only the start.' },
      { id: 'heldkarp-2', code: 'for subset size = 2 … n:', note: 'States are filled in increasing subset size…' },
      { id: 'heldkarp-3', code: '  for each mask ∋ s with |mask| = size, each end city i ∈ mask, i ≠ s:', note: '…so every predecessor state is already computed.' },
      { id: 'heldkarp-4', code: '    dp[mask][i] ← min over j ∈ mask, j≠i of  dp[mask−{i}][j] + d(j,i)', note: 'The recurrence: best way to reach i extends the best way to reach some j.' },
      { id: 'heldkarp-5', code: '    parent[mask][i] ← argmin j       // remember for reconstruction', note: 'Parent pointers let us recover the tour afterwards.' },
      { id: 'heldkarp-6', code: '// (memoized: each state is computed exactly once)', note: 'This is the whole trick — repeated work becomes a table lookup.' },
      { id: 'heldkarp-7', code: 'answer ← min over i of dp[ALL][i] + d(i,s)   // close every tour', note: 'Every full state must return to the start.' },
      { id: 'heldkarp-8', code: 'backtrack parent pointers from the best end city → optimal tour', note: 'Follow the argmin chain back to the start.' }
    ],
    branchbound: [
      { id: 'bb-1', code: 'best ← nearestNeighborTour()          // initial upper bound', note: 'A feasible tour gives pruning something to beat from step one.' },
      { id: 'bb-2', code: 'push partial route [s] onto DFS stack', note: 'Depth-first: complete tours surface early, strengthening the bound.' },
      { id: 'bb-3', code: 'while stack not empty:  pop node (path, cost)', note: 'Each pop is one search-tree node being expanded.' },
      { id: 'bb-4', code: '  LB ← cost + minOut(cur) + Σ minOut(unvisited)', note: 'Admissible lower bound: no completion of this route can cost less. (The return edge to the start is already one of these outgoing edges — never counted twice.)' },
      { id: 'bb-5', code: '  if LB ≥ best: prune subtree         // provably useless', note: 'Safe: the bound never overestimates, so the optimum cannot hide here.' },
      { id: 'bb-6', code: '  if path is a complete tour: best ← min(best, cost + return)', note: 'Complete tours tighten the upper bound for everything else.' },
      { id: 'bb-7', code: '  else: push children (nearest-first) // branch', note: 'Promising children are explored first to find strong bounds early.' }
    ],
    nearest: [
      { id: 'nn-1', code: 'path ← [s]; visited ← {s}; cost ← 0', note: 'Start at the fixed start city.' },
      { id: 'nn-2', code: 'while unvisited cities remain:', note: 'One greedy choice per step.' },
      { id: 'nn-3', code: '  next ← argmin over unvisited u of d(cur, u)', note: 'THE greedy step: closest unvisited city wins. Ties → lowest index.' },
      { id: 'nn-4', code: '  path.append(next); cost += d(cur, next); cur ← next', note: 'Commit to the choice — never reconsidered.' },
      { id: 'nn-5', code: 'return path + [s]                     // valid tour, not proven optimal', note: 'Greedy is fast but can be fooled — see Learn Mode demo 2.' }
    ],
    twoopt: [
      { id: 'twoopt-1', code: 'tour ← nearestNeighborTour()      // feasible start', note: 'Local search needs a valid tour to improve.' },
      { id: 'twoopt-2', code: 'repeat:', note: 'Keep sweeping until a full pass finds nothing.' },
      { id: 'twoopt-3', code: '  for each pair of positions i < j:', note: 'O(n²) candidate swaps per pass.' },
      { id: 'twoopt-4', code: '    Δ ← −d(a,b) −d(c,e) +d(a,c) +d(b,e)   // uncross edges (a,b),(c,e)', note: 'The delta is computed in O(1) — no need to re-score the whole tour.' },
      { id: 'twoopt-5', code: '    if Δ < 0: reverse segment tour[i..j]; cost += Δ  // first improvement', note: 'Apply immediately and restart the scan.' },
      { id: 'twoopt-6', code: '  until a full pass with no Δ < 0', note: '' },
      { id: 'twoopt-7', code: 'return tour                       // 2-optimal: local, not global, optimum', note: 'No single swap helps — but a better tour may still exist.' }
    ],
    mst: [
      { id: 'mst-1', code: '// Phase 1 — Prim’s MST, O(n²)', note: 'An MST weighs ≤ OPT (delete one edge from the optimal tour).' },
      { id: 'mst-2', code: 'repeatedly add the cheapest edge joining the tree to a new city', note: 'Greedy works here — MST has optimal substructure.' },
      { id: 'mst-3', code: '// Phase 2 — preorder walk of the MST', note: 'DFS order visits every city (twice, there and back).' },
      { id: 'mst-4', code: 'walk ← DFS preorder of MST', note: '' },
      { id: 'mst-5', code: 'tour ← walk with already-visited cities skipped  // shortcuts', note: 'Triangle inequality ⇒ skipping never lengthens the walk.' },
      { id: 'mst-6', code: 'return tour + [s]   // ≤ 2·OPT on metric TSP', note: 'Walk ≤ 2·MST ≤ 2·OPT. Needs the metric assumption!' }
    ],
    genetic: [
      { id: 'ga-1', code: 'population ← p random tours           // seeded RNG: reproducible', note: 'Each chromosome is a permutation of the cities — always a valid tour.' },
      { id: 'ga-2', code: 'for generation = 1 … g:', note: 'One step of the visualization = one generation.' },
      { id: 'ga-3', code: '  evaluate: cost of every tour (best / avg / worst)', note: 'Fitness = tour cost (lower is fitter).' },
      { id: 'ga-4', code: '  select parents by tournament; offspring ← orderedCrossover(a, b)', note: 'Ordered crossover preserves city orderings from both parents.' },
      { id: 'ga-5', code: '  swap-mutate offspring with probability m; keep the elite', note: 'Mutation keeps diversity; elitism never loses the best.' },
      { id: 'ga-6', code: '  track the best tour ever seen', note: 'The reported answer is the best across all generations — still heuristic.' }
    ],
    annealing: [
      { id: 'sa-1', code: 'tour ← nearestNeighborTour(); T ← T₀', note: 'Start from a decent tour, temperature high.' },
      { id: 'sa-2', code: 'for iteration = 1 … iters:', note: 'One step = one proposed move.' },
      { id: 'sa-3', code: '  pick random 2-swap; Δ ← cost change (O(1) delta)', note: 'Same swap neighborhood as 2-opt, but chosen randomly.' },
      { id: 'sa-4', code: '  accept if Δ < 0, else with probability exp(−Δ/T)', note: 'Worse moves are sometimes taken — that is how it escapes local optima.' },
      { id: 'sa-5', code: '  track the best tour ever seen; T ← T · cooling', note: 'Cooling freezes the search: late moves are almost all improving.' },
      { id: 'sa-6', code: 'return best tour seen               // heuristic', note: 'No optimality proof — quality depends on the cooling schedule.' }
    ]
  };

  /**
   * Lightweight syntax highlighter for pseudocode lines. Pure function:
   * tokenizes keywords, numbers and // comments, escaping everything else.
   * (Operates on the raw string in one pass so HTML entities can never be
   * split by the tokenizer.)
   */
  TSP.highlightPseudo = function (code) {
    const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const re = /(\/\/.*$)|(\b\d[\d.]*\b)|(\b(?:for|if|else|while|return|repeat|until|min|max|argmin|argmax|each|over|do|then)\b)/g;
    let out = '', last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const cls = m[1] ? 'tok-com' : m[2] ? 'tok-num' : 'tok-kw';
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
      if (m[0].length === 0) break; // safety: never spin on empty matches
    }
    out += esc(code.slice(last));
    return out;
  };

  /** Render a pseudocode listing into a container, highlighting lineId. */
  TSP.renderPseudocode = function (container, algoId, lineId, problem) {
    container.innerHTML = '';
    const lines = TSP.PSEUDO[algoId] || [];
    const pre = document.createElement('div');
    pre.className = 'pseudo';
    lines.forEach(L => {
      const div = document.createElement('div');
      div.className = 'pseudo-line' + (L.id === lineId ? ' active' : '');
      div.dataset.line = L.id;
      const code = document.createElement('code');
      code.innerHTML = TSP.highlightPseudo(L.code);
      div.appendChild(code);
      if (L.note) {
        const note = document.createElement('span');
        note.className = 'pseudo-note';
        note.textContent = '  // ' + L.note;
        div.appendChild(note);
      }
      pre.appendChild(div);
    });
    container.appendChild(pre);
  };
})();
