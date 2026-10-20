/* ============================================================
   derivations.js — mathematical complexity derivations
   ------------------------------------------------------------
   TSP.DERIVATIONS[algoId] = {
     badge:   short complexity label,
     params:  [{ name, meaning }],
     blocks:  [{ h, html }]   // html uses semantic math markup
   }

   Every derivation describes the ACTUAL implementation in
   algorithms.js — not a textbook idealization. Where the code
   makes a concrete choice (recompute vs. incremental, flat
   typed arrays, first-improvement, delta updates), the text
   says so and the formula reflects it.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  // shorthands for readable math markup
  const S = (base, sub) => '<span class="mx">' + base + '<sub>' + sub + '</sub></span>';
  const P = (base, sup) => '<span class="mx">' + base + '<sup>' + sup + '</sup></span>';
  const F = html => '<div class="formula">' + html + '</div>';

  TSP.DERIVATIONS = {

    /* ================= BRUTE FORCE ================= */
    brute: {
      badge: 'Θ(n!)',
      params: [
        { name: 'n', meaning: 'number of cities' },
        { name: '(n−1)!', meaning: 'permutations of the n−1 non-start cities (Heap’s algorithm enumerates each once)' }
      ],
      blocks: [
        {
          h: '1 · Counting the tours',
          html: '<p>Fix the start city <span class="mx">s</span>. A tour is then an ordering of the remaining ' +
            '<span class="mx">n − 1</span> cities. Counting choices per position:</p>' +
            F('(n−1) · (n−2) · … · 2 · 1 = (n−1)!') +
            '<p>This implementation enumerates <b>all</b> <span class="mx">(n−1)!</span> directed permutations with ' +
            'Heap’s algorithm — it does <b>not</b> exploit reversal symmetry.</p>' +
            '<p class="fine">In a <i>symmetric</i> TSP, a tour and its reverse (e.g. A→B→C→A vs A→C→B→A) are the same ' +
            'undirected cycle, so there are only <span class="mx">(n−1)! / 2</span> <i>distinct</i> tours. ' +
            'Exploiting that would halve the work — a constant factor, invisible inside big-O — so this ' +
            'implementation keeps the simpler full enumeration.</p>'
        },
        {
          h: '2 · Work per tour',
          html: '<p>Each tour is scored from scratch by summing its <span class="mx">n</span> edges ' +
            '(<span class="mx">tourCost</span> in <span class="mx">tsp.js</span>):</p>' +
            F('cost(π) = Σ<sub>k=0..n−1</sub> d(tour[k], tour[k+1]) &nbsp;&nbsp;→&nbsp;&nbsp; Θ(n) per tour') +
            '<p class="fine">An <i>incremental</i> variant could update the cost in O(1) per Heap swap ' +
            '(a swap changes only a few edges), giving Θ((n−1)!) total. This project recomputes from scratch, ' +
            'which is simpler to follow step-by-step in the visualization.</p>'
        },
        {
          h: '3 · Total',
          html: F('T(n) = (n−1)! · Θ(n) = Θ(n · (n−1)!) = Θ(n!)') +
            '<p>since <span class="mx">n · (n−1)! = n!</span> exactly. The commonly quoted ' +
            '<span class="mx">O(n!)</span> and the sharper <span class="mx">Θ((n−1)!)</span> (incremental scoring) ' +
            'describe the same factorial explosion — they differ by less than a factor of <span class="mx">n</span>.</p>'
        },
        {
          h: '4 · Space',
          html: '<p>Heap’s algorithm keeps the current permutation plus a counter array: ' +
            '<span class="mx">Θ(n)</span> auxiliary space. The best tour is another <span class="mx">Θ(n)</span>.</p>'
        },
        {
          h: '5 · Cases',
          html: '<p><b>Best = average = worst = Θ(n!).</b> Brute force enumerates every tour no matter what the ' +
            'distances are — a “lucky” instance saves nothing.</p>'
        },
        {
          h: '6 · Theory vs. what you measure',
          html: '<p>The “States explored” counter in this lab <i>is</i> the tour count: on <span class="mx">n</span> ' +
            'cities it reads exactly <span class="mx">(n−1)!</span>. If it doesn’t, that’s a bug, not a subtlety — ' +
            'brute force has no pruning, no early exit, no luck.</p>'
        },
        {
          h: '7 · Why it scales so poorly',
          html: '<p>Factorials outrun exponentials: <span class="mx">20! ≈ 2.4 × 10<sup>18</sup></span>. ' +
            'Each added city multiplies the work by roughly <span class="mx">n</span>. At ' +
            '<span class="mx">n = 11</span> this implementation already evaluates 3.6 million tours — ' +
            'watch the counter and feel why exact TSP needs smarter ideas.</p>'
        }
      ]
    },

    /* ================= HELD–KARP ================= */
    heldkarp: {
      badge: 'Θ(n²·2ⁿ)',
      params: [
        { name: 'n', meaning: 'number of cities' },
        { name: 'mask', meaning: 'bitmask of visited cities (2ⁿ possible subsets)' },
        { name: 'dp[mask][i]', meaning: 'cheapest cost to start at city 0, visit exactly the cities in mask, and end at city i' }
      ],
      blocks: [
        {
          h: '1 · The state',
          html: '<p>A subproblem is identified by <i>which</i> cities are visited and <i>where</i> the partial route ends:</p>' +
            F('dp[mask][i] = min cost of a path 0 ⇝ i visiting exactly the cities in mask') +
            '<p>Brute force re-solves the same subproblem exponentially many times (every completion of a shared prefix). ' +
            'Held–Karp solves each one <b>once</b> and memoizes it.</p>'
        },
        {
          h: '2 · The recurrence',
          html: '<p>To end at <span class="mx">i</span> having visited <span class="mx">mask</span>, the previous city ' +
            '<span class="mx">j</span> must lie in <span class="mx">mask ∖ {i}</span>:</p>' +
            F('dp[mask][i] = min<sub>j ∈ mask, j≠i</sub> ( dp[mask ∖ {i}][j] + d(j,i) )') +
            '<p>States are filled in order of increasing subset size, so every predecessor ' +
            '<span class="mx">dp[mask ∖ {i}][j]</span> is already computed when it is needed. The optimal tour is then</p>' +
            F('answer = min<sub>i</sub> ( dp[ALL][i] + d(i, 0) )') +
            '<p class="fine">This implementation stores parent pointers (<span class="mx">parent[mask][i] = argmin j</span>) ' +
            'so the optimal <i>tour</i> — not just its cost — is recovered by backtracking.</p>'
        },
        {
          h: '3 · Counting states and transitions',
          html: '<p>Only masks containing the start city are used: <span class="mx">2<sup>n−1</sup></span> of them. ' +
            'For a mask of size <span class="mx">k</span> there are <span class="mx">k − 1</span> possible endpoints ' +
            '<span class="mx">i</span>, each trying <span class="mx">k − 1</span> predecessors <span class="mx">j</span>:</p>' +
            F('transitions = Σ<sub>k=2..n</sub> C(n−1, k−1) · (k−1)<sup>2</sup> = (n−1)·n·2<sup>n−3</sup> = Θ(n²·2ⁿ)') +
            '<p class="fine">The closed form uses Σ C(N,m)·m² = N(N+1)·2<sup>N−2</sup> with N = n−1.</p>'
        },
        {
          h: '4 · Result',
          html: F('Time: Θ(n² · 2ⁿ) &nbsp;&nbsp;·&nbsp;&nbsp; Space: Θ(n · 2ⁿ)') +
            '<p class="fine">Space, concretely: one <span class="mx">Float64Array</span> of ' +
            '<span class="mx">(2ⁿ)·n</span> costs plus one <span class="mx">Int16Array</span> of ' +
            '<span class="mx">(2ⁿ)·n</span> parent pointers — flat typed arrays, exactly as allocated in ' +
            '<span class="mx">createHeldKarpRunner</span>.</p>'
        },
        {
          h: '5 · Cases',
          html: '<p><b>Best = average = worst = Θ(n²·2ⁿ).</b> The table is filled completely regardless of the ' +
            'distances — Held–Karp cannot “get lucky”. Its advantage over brute force is structural, not instance-dependent.</p>'
        },
        {
          h: '6 · Theory vs. what you measure',
          html: '<p>“States explored” here counts <span class="mx">(mask, i)</span> pairs and equals ' +
            '<span class="mx">Σ<sub>k</sub> C(n−1,k−1)(k−1)</span> exactly; “Transitions” counts the inner-loop ' +
            'predecessor tries. Compare both against the formula above — they match, because the implementation ' +
            '<i>is</i> the recurrence, executed in subset-size order.</p>'
        },
        {
          h: '7 · Why it scales the way it does',
          html: '<p>Exponential beats factorial: at <span class="mx">n = 20</span>, ' +
            '<span class="mx">n²·2ⁿ ≈ 4 × 10<sup>8</sup></span> vs <span class="mx">20! ≈ 2.4 × 10<sup>18</sup></span>. ' +
            'Held–Karp trades <i>memory</i> for <i>time</i> — the <span class="mx">n·2ⁿ</span> table is what makes ' +
            'the speedup possible, and it is also what ultimately limits <span class="mx">n</span>.</p>'
        }
      ]
    },

    /* ================= BRANCH & BOUND ================= */
    branchbound: {
      badge: 'worst Θ(n!) · usually far less',
      params: [
        { name: 'partial route', meaning: '0 → … → cur, with unvisited set U' },
        { name: 'incumbent', meaning: 'best complete tour found so far (upper bound); seeded by a nearest-neighbor tour' },
        { name: 'LB', meaning: 'admissible lower bound on any completion of the partial route' }
      ],
      blocks: [
        {
          h: '1 · Branching',
          html: '<p>Depth-first search over partial tours. At depth <span class="mx">d</span> there are ' +
            '<span class="mx">P(n−1, d) = (n−1)! / (n−1−d)!</span> nodes — the same tree brute force explores, ' +
            'built one extension at a time (nearest-first, so strong incumbents appear early).</p>'
        },
        {
          h: '2 · The lower bound (this implementation)',
          html: '<p>Any completion must add exactly <span class="mx">|U|+1</span> edges: one outgoing edge from the current city ' +
            'and one outgoing edge from each unvisited city. (The final return to the start <i>is</i> one of those ' +
            'outgoing edges — the edge leaving whichever city precedes 0 — so it must not be counted twice.) ' +
            'Lower-bounding each by its cheapest possible edge:</p>' +
            F('LB = costSoFar + minOut(cur) + Σ<sub>u ∈ U</sub> minOut(u)') +
            '<p>Each term is a true minimum over a forced choice, so <b>no completion can cost less than LB</b> — ' +
            'the bound is <i>admissible</i> (never overestimates). Computing it scans the unvisited set: ' +
            '<span class="mx">Θ(n)</span> work per node.</p>'
        },
        {
          h: '3 · The pruning rule',
          html: F('if LB ≥ incumbent → prune the entire subtree') +
            '<p>Safe <i>because</i> LB is admissible: a pruned subtree cannot contain a tour better than the incumbent, ' +
            'hence cannot contain the optimum. When the search ends, the incumbent <b>is</b> optimal.</p>'
        },
        {
          h: '4 · Worst case — honestly derived',
          html: '<p>If the bound never prunes (a hostile instance), every node is expanded:</p>' +
            F('nodes = Σ<sub>d=0..n−1</sub> P(n−1, d) < e · (n−1)! = Θ((n−1)!)') +
            '<p>at <span class="mx">Θ(n)</span> bound work per node:</p>' +
            F('worst-case time Θ(n!) · space Θ(n) (the DFS stack)') +
            '<p class="fine">No tighter worst-case bound is claimed here, because the number of surviving nodes ' +
            'depends on the instance, the bound quality, the branching order, and how early a strong incumbent appears. ' +
            'Any “O(cⁿ)” claim for branch and bound would need a proof for <i>this</i> bound — this lab does not pretend to have one.</p>'
        },
        {
          h: '5 · Best case and practice',
          html: '<p><b>Best case:</b> if the initial greedy tour is already optimal and the bound prunes every child ' +
            'below depth 1, only <span class="mx">Θ(n)</span> nodes are expanded → <span class="mx">Θ(n²)</span> time. ' +
            '<b>Typical Euclidean instances</b> (like the presets here) prune enormously — watch “States pruned” vs ' +
            '“States explored”. <b>Average case</b> has no clean formula; it is genuinely instance-dependent.</p>'
        },
        {
          h: '6 · Theory vs. what you measure',
          html: '<p>The lab reports explored nodes, pruned nodes, and the pruning rate ' +
            '(pruned ÷ (explored + pruned)). On the 6-city preset you will see a large fraction pruned; ' +
            'on adversarial weights it collapses toward brute-force behavior. <b>That gap is the lesson</b>: ' +
            'branch and bound’s power is practical, not asymptotic.</p>'
        }
      ]
    },

    /* ================= NEAREST NEIGHBOR ================= */
    nearest: {
      badge: 'Θ(n²)',
      params: [
        { name: 'n', meaning: 'number of cities' },
        { name: 'U', meaning: 'set of unvisited cities at each step' }
      ],
      blocks: [
        {
          h: '1 · The greedy loop',
          html: '<p>There are <span class="mx">n − 1</span> selection steps. At the step where ' +
            '<span class="mx">|U| = m</span> cities remain unvisited, the implementation scans all of them:</p>' +
            F('comparisons = Σ<sub>m=1..n−1</sub> m = (n−1)n / 2 = Θ(n²)')
        },
        {
          h: '2 · Result',
          html: F('Time: Θ(n²) &nbsp;&nbsp;·&nbsp;&nbsp; Space: Θ(n)') +
            '<p class="fine">A fancier data structure (e.g. a spatial index) could beat the naive scan, but this ' +
            'implementation uses the straightforward scan — the derivation above is for the code that actually runs.</p>'
        },
        {
          h: '3 · Cases',
          html: '<p><b>Best = average = worst = Θ(n²)</b> for the construction itself — the scan length depends only ' +
            'on how many cities remain, not on the distances. (The <i>quality</i> of the tour varies wildly, but that ' +
            'is a different question.)</p>'
        },
        {
          h: '4 · Why greedy is fast but not optimal',
          html: '<p>Each step makes the locally best choice and never reconsiders. That myopia is exactly what ' +
            'makes it quadratic — and exactly what lets a single early “nearest” hop strand the tour far from the ' +
            'remaining cities. Try Learn Mode demo 2 to watch it fail on purpose.</p>'
        }
      ]
    },

    /* ================= 2-OPT ================= */
    twoopt: {
      badge: 'O(k·n²)',
      params: [
        { name: 'n', meaning: 'number of cities' },
        { name: 'k', meaning: 'number of improving iterations (≤ maxIterations cap, default 1000)' },
        { name: 'Δ', meaning: 'cost change of uncrossing two edges: −d(a,b) −d(c,e) +d(a,c) +d(b,e)' }
      ],
      blocks: [
        {
          h: '1 · Candidate swaps per pass',
          html: '<p>Positions <span class="mx">1 ≤ i < j ≤ n−1</span> in the tour give</p>' +
            F('C(n−1, 2) = (n−1)(n−2) / 2 = Θ(n²) swaps per full pass')
        },
        {
          h: '2 · Cost of evaluating one swap',
          html: '<p>The delta is computed from just four edges — <span class="mx">Θ(1)</span>, no re-scoring of the tour. ' +
            'Applying an improvement reverses a segment: <span class="mx">Θ(n)</span>, but at most one application ' +
            'happens per iteration (first-improvement restarts the scan).</p>'
        },
        {
          h: '3 · Total',
          html: F('Time: O(k · n²), &nbsp; k = improving iterations ≤ maxIterations') +
            '<p class="fine">The <span class="mx">k</span> is the honest part of this bound: it depends on the instance, ' +
            'the starting tour (nearest neighbor here), and the stopping rule. A “no improving swap in a full pass” ' +
            'stop means the result is <i>2-optimal</i> — a local optimum, with no claim about the global one.</p>'
        },
        {
          h: '4 · Cases',
          html: '<p><b>Best case Θ(n²):</b> the starting tour is already 2-optimal — one pass, no improvement. ' +
            '<b>Worst case:</b> the iteration cap is hit. In practice <span class="mx">k</span> is small on ' +
            'Euclidean instances, which is why 2-opt is such a good cheap improver.</p>'
        },
        {
          h: '5 · Theory vs. what you measure',
          html: '<p>“States explored” counts swap evaluations; the run also reports the iteration count and the ' +
            'improvement per iteration. If the run stops at the cap instead of a clean pass, the log says so — ' +
            'a local optimum was <i>not</i> necessarily reached.</p>'
        }
      ]
    },

    /* ================= MST APPROXIMATION ================= */
    mst: {
      badge: 'Θ(n²), ≤ 2·OPT (metric)',
      params: [
        { name: 'n', meaning: 'number of cities (complete graph, dense)' },
        { name: 'OPT', meaning: 'optimal tour cost' }
      ],
      blocks: [
        {
          h: '1 · Building the MST (Prim, dense)',
          html: '<p><span class="mx">n − 1</span> iterations; each scans all <span class="mx">n</span> vertices for the ' +
            'minimum connecting edge:</p>' +
            F('T<sub>MST</sub>(n) = (n−1) · Θ(n) = Θ(n²)') +
            '<p class="fine">Dense-graph Prim needs no heap — the scan <i>is</i> the optimal strategy here.</p>'
        },
        {
          h: '2 · The walk and shortcuts',
          html: '<p>Preorder DFS of the tree: <span class="mx">Θ(n)</span>. Skipping already-visited cities: ' +
            '<span class="mx">Θ(n)</span>. Total stays <span class="mx">Θ(n²)</span>, space <span class="mx">Θ(n)</span>.</p>'
        },
        {
          h: '3 · The factor-2 guarantee (and its assumptions)',
          html: '<p>Delete any one edge from the optimal tour → a spanning tree, so</p>' +
            F('w(MST) ≤ OPT') +
            '<p>A preorder walk traverses each tree edge twice:</p>' +
            F('walk ≤ 2 · w(MST) ≤ 2 · OPT') +
            '<p>Shortcutting (skipping visited cities) replaces a path <span class="mx">x ⇝ y</span> by the direct edge ' +
            '<span class="mx">(x, y)</span>. <b>This step needs the triangle inequality</b> ' +
            '(<span class="mx">d(x,y) ≤ d(x,z) + d(z,y)</span>), i.e. <i>metric</i> TSP — plus symmetry. Hence:</p>' +
            F('tour ≤ 2 · OPT &nbsp;&nbsp;(metric TSP only)') +
            '<p class="fine">On custom hand-edited weights that violate the triangle inequality, the implementation ' +
            'still returns a valid tour, but the factor-2 guarantee may not hold. An approximation guarantee is a ' +
            '<i>proven bound on the answer quality</i> — weaker than an optimality proof, stronger than hope.</p>'
        }
      ]
    },

    /* ================= GENETIC ALGORITHM ================= */
    genetic: {
      badge: 'Θ(g·p·n)',
      params: [
        { name: 'p', meaning: 'population size (default 50)' },
        { name: 'g', meaning: 'generations (default 100)' },
        { name: 'm', meaning: 'mutation rate per gene (default 0.1)' },
        { name: 'n', meaning: 'number of cities' }
      ],
      blocks: [
        {
          h: '1 · Work per generation',
          html: '<p>Each generation evaluates <span class="mx">p</span> tours at <span class="mx">Θ(n)</span> per tour-cost sum, ' +
            'then breeds <span class="mx">p</span> offspring (tournament selection <span class="mx">Θ(1)</span>, ' +
            'ordered crossover <span class="mx">Θ(n)</span>, swap mutation <span class="mx">Θ(n)</span>):</p>' +
            F('per generation: p · Θ(n) = Θ(p·n)')
        },
        {
          h: '2 · Total',
          html: F('Time: Θ(g · p · n) &nbsp;&nbsp;·&nbsp;&nbsp; Space: Θ(p · n)') +
            '<p class="fine">With defaults (g=100, p=50): about <span class="mx">5000·n</span> elementary operations — ' +
            'cheap, predictable, and tunable via the parameter panel.</p>'
        },
        {
          h: '3 · What the bound does <i>not</i> say',
          html: '<p>This bounds the <i>effort</i>, not the <i>answer</i>. A genetic algorithm is a heuristic: it carries ' +
            '<b>no optimality guarantee and no approximation ratio</b>. Solution quality depends on the parameters, the ' +
            'instance, and the random seed (recorded with every run so results reproduce exactly).</p>'
        },
        {
          h: '4 · Theory vs. what you measure',
          html: '<p>The lab plots best / average / worst fitness per generation. A collapsing average with a flat best ' +
            'means premature convergence (raise mutation or the population); a steadily falling best means the search ' +
            'is still productive.</p>'
        }
      ]
    },

    /* ================= SIMULATED ANNEALING ================= */
    annealing: {
      badge: 'Θ(iterations)',
      params: [
        { name: 'T₀', meaning: 'initial temperature (default 1000)' },
        { name: 'α', meaning: 'cooling rate per iteration, T ← α·T (default 0.995)' },
        { name: 'iters', meaning: 'iteration budget (default 2000)' }
      ],
      blocks: [
        {
          h: '1 · Work per iteration',
          html: '<p>One random 2-swap is proposed; its cost change uses the same four-edge delta as 2-opt:</p>' +
            F('Δ = −d(a,b) −d(c,e) +d(a,c) +d(b,e) &nbsp;&nbsp;→&nbsp;&nbsp; Θ(1)') +
            '<p>Acceptance (<span class="mx">Δ < 0</span> or with probability ' +
            '<span class="mx">e<sup>−Δ/T</sup></span>) and cooling are <span class="mx">Θ(1)</span>.</p>' +
            '<p class="fine">The Θ(1) delta is a real optimization in this code: re-scoring the whole tour would make ' +
            'each iteration Θ(n).</p>'
        },
        {
          h: '2 · Total',
          html: F('Time: Θ(iters) &nbsp;&nbsp;·&nbsp;&nbsp; Space: Θ(n)') +
            '<p>Plus a Θ(n²) nearest-neighbor start. The schedule is geometric: after <span class="mx">t</span> iterations ' +
            '<span class="mx">T = T₀·α<sup>t</sup></span>.</p>'
        },
        {
          h: '3 · What the bound does <i>not</i> say',
          html: '<p>Like all metaheuristics here: <b>no optimality guarantee</b>. Theory only promises convergence ' +
            '<i>in probability</i> under impractically slow (logarithmic) cooling — the geometric schedule used here ' +
            'is a practical compromise. Watch the temperature readout: early on, worse moves are accepted freely ' +
            '(exploration); late, the search freezes into hill-climbing (exploitation).</p>'
        }
      ]
    }
  };

  /** Render the derivation for an algorithm into a container. */
  TSP.renderDerivation = function (container, algoId) {
    const d = TSP.DERIVATIONS[algoId];
    container.innerHTML = '';
    if (!d) {
      container.innerHTML = '<p class="hint">No derivation available for this algorithm.</p>';
      return;
    }
    const meta = TSP.algoMeta(algoId);
    const head = document.createElement('div');
    head.className = 'deriv-head';
    head.innerHTML = '<h3>' + meta.name + ' — complexity derivation</h3>' +
      '<span class="deriv-badge">' + d.badge + '</span>' +
      '<span class="deriv-kind kind-' + meta.kind + '">' + meta.kind + '</span>';
    container.appendChild(head);

    if (d.params && d.params.length) {
      const pdiv = document.createElement('div');
      pdiv.className = 'deriv-params';
      pdiv.innerHTML = '<h4>Input parameters</h4>';
      const ul = document.createElement('ul');
      d.params.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = '<span class="mx">' + p.name + '</span> — ' + p.meaning;
        ul.appendChild(li);
      });
      pdiv.appendChild(ul);
      container.appendChild(pdiv);
    }

    d.blocks.forEach(b => {
      const sec = document.createElement('section');
      sec.className = 'deriv-block';
      const h = document.createElement('h4');
      h.textContent = b.h;
      sec.appendChild(h);
      const body = document.createElement('div');
      body.innerHTML = b.html;
      sec.appendChild(body);
      container.appendChild(sec);
    });
  };
})();
