/* ============================================================
   learn.js — Learn Mode lessons and checkpoints
   ------------------------------------------------------------
   TSP.LESSONS: guided demonstrations with plain-English steps,
   prediction checkpoints (multiple choice with explanations),
   and links into the live visualizer. All claims match the
   actual implementations in algorithms.js.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  TSP.LESSONS = [
    {
      id: 'bf-expensive',
      title: '1 · Why Brute Force becomes expensive',
      goal: 'Feel the factorial: every extra city multiplies the work.',
      demo: { preset: 'preset6', algo: 'brute', note: 'Watch the “States explored” counter — it will hit exactly 120 = 5! tours.' },
      steps: [
        { html: '<p>With the start city fixed, a tour is an ordering of the other <b>n−1</b> cities: <b>(n−1)!</b> possibilities. The visualizer’s Brute Force really enumerates every single one with Heap’s algorithm — nothing is skipped, which is why its counter is exact.</p>' },
        { html: '<p>Press <b>Run</b> on the 6-city preset and watch: 5! = <b>120</b> tours, each scored from scratch by summing its edges. Now imagine n = 11: 10! = <b>3,628,800</b> tours. Each new city multiplies the work by ~n.</p>' },
        { html: '<p>Rule of thumb: factorials defeat exponentials, and exponentials defeat polynomials. That ordering — <b>n² &lt; 2ⁿ &lt; n!</b> — is the whole reason TSP needs smarter algorithms. Check it on the growth chart in “Why Does TSP Get Hard?”.</p>' }
      ],
      quiz: [
        {
          q: 'Brute force on 8 cities (start fixed) evaluates how many tours?',
          options: ['8! = 40,320', '7! = 5,040', '7!/2 = 2,520', '2⁸ = 256'],
          answer: 1,
          why: 'Fixing the start leaves 7 cities to permute: 7! = 5,040. (7!/2 would count distinct undirected tours, but this implementation enumerates all directed permutations.)'
        },
        {
          q: 'Why is brute force’s best/average/worst case all Θ(n!)?',
          options: [
            'Because it always gets lucky',
            'Because it enumerates every tour regardless of the distances',
            'Because Heap’s algorithm is slow',
            'Because the graph is complete'
          ],
          answer: 1,
          why: 'There is no pruning and no early exit — the distances never change how many tours are generated.'
        }
      ]
    },
    {
      id: 'greedy-fails',
      title: '2 · Why Greedy does not always find the optimum',
      goal: 'See Nearest Neighbor make a locally perfect, globally wrong choice.',
      demo: { preset: 'symmetric', algo: 'nearest', note: 'Compare the greedy tour cost against the Held–Karp optimum on the same graph.' },
      steps: [
        { html: '<p>Nearest Neighbor always visits the closest unvisited city. Each step is <i>locally</i> perfect — and never reconsidered. That is both its speed (Θ(n²)) and its flaw.</p>' },
        { html: '<p>Run it, then run <b>Held–Karp</b> on the same graph. If the costs differ, the greedy tour was not optimal. The classic trap: one “nearest” hop strands the tour far from the remaining cities, forcing a huge final return edge.</p>' },
        { html: '<p>Moral: a greedy choice needs the <i>greedy-choice property</i> (local optimum ⇒ global optimum). TSP doesn’t have it — unlike MST, where Prim’s greedy <i>is</i> provably optimal.</p>' }
      ],
      quiz: [
        {
          q: 'The greedy tour is valid but not optimal. What does that prove?',
          options: [
            'Greedy is useless',
            'Locally optimal choices don’t guarantee a globally optimal tour',
            'The implementation has a bug',
            'Held–Karp is also heuristic'
          ],
          answer: 1,
          why: 'Greedy algorithms need a proof that local choices compose into a global optimum. For TSP no such proof exists — hence heuristics.'
        }
      ]
    },
    {
      id: 'bb-prune',
      title: '3 · How Branch and Bound prunes states',
      goal: 'Understand admissible lower bounds: pruning that can never discard the optimum.',
      demo: { preset: 'preset6', algo: 'branchbound', note: 'Open the Search Tree tab while it runs — red ✕ nodes are pruned, with the exact reason.' },
      steps: [
        { html: '<p>Branch & Bound explores the same tree as brute force, but keeps an <b>incumbent</b> (best complete tour so far — seeded by a greedy tour) and a <b>lower bound</b> for each partial route.</p>' },
        { html: '<p>The bound used here: <b>LB = cost so far + cheapest way out of the current city + cheapest way out of every unvisited city + cheapest return to start</b>. No completion can possibly cost less — so if <b>LB ≥ incumbent</b>, the whole subtree is discarded <i>safely</i>.</p>' },
        { html: '<p>Key subtlety: pruning is <i>safe</i> but not <i>free</i> — computing LB costs Θ(n) per node, and on hostile instances almost nothing prunes (worst case stays Θ(n!)). The Search Tree tab shows every prune with its exact LB vs incumbent numbers.</p>' }
      ],
      quiz: [
        {
          q: 'A partial route has LB = 120 and the incumbent is 120. What happens?',
          options: [
            'It is explored — it might tie',
            'It is pruned — it cannot beat the incumbent',
            'It is pruned only if the bound is exact',
            'Nothing — ties are ignored'
          ],
          answer: 1,
          why: 'LB ≥ incumbent ⇒ no completion can be strictly better. (A tie can’t improve the best, so pruning is safe; the implementation uses ≥.)'
        },
        {
          q: 'Why must the lower bound never overestimate?',
          options: [
            'Otherwise the animation looks wrong',
            'Otherwise pruning could discard the true optimum',
            'Otherwise the bound is too slow to compute',
            'It may overestimate — that only prunes more'
          ],
          answer: 1,
          why: 'Admissibility (never overestimating) is exactly what makes pruning safe. An overestimating “bound” could cut the branch containing the optimum.'
        }
      ]
    },
    {
      id: 'hk-reuse',
      title: '4 · How Held–Karp reuses subproblem results',
      goal: 'See memoization turn repeated work into table lookups.',
      demo: { preset: 'preset6', algo: 'heldkarp', note: 'Open the DP Table tab: click any state to see its recurrence and which predecessor won.' },
      steps: [
        { html: '<p>Brute force solves the same subproblem (“cheapest way to start at A, visit {B,C,D}, end at E”) once per completion — exponentially many times. Held–Karp defines it as a <b>state dp[mask][i]</b> and solves it <b>once</b>.</p>' },
        { html: '<p>The recurrence: <b>dp[mask][i] = min over j of dp[mask∖{i}][j] + d(j,i)</b>. States fill in increasing subset size, so predecessors are always ready. There are Θ(n·2ⁿ) states × Θ(n) transitions = Θ(n²·2ⁿ) total — exponential, but far below factorial.</p>' },
        { html: '<p>In the DP Table tab, click a state: you’ll see every candidate predecessor transition with its cost, the winner highlighted, and the parent pointer that later reconstructs the optimal tour. That table <i>is</i> the algorithm’s memory.</p>' }
      ],
      quiz: [
        {
          q: 'What does dp[{A,B,C}][C] represent?',
          options: [
            'The cheapest tour through all cities ending at C',
            'The cheapest path starting at A, visiting exactly A,B,C, and ending at C',
            'The cheapest edge into C',
            'The number of ways to visit A,B,C ending at C'
          ],
          answer: 1,
          why: 'The state fixes the visited set AND the endpoint. Different endpoints with the same visited set are different states — that’s why the table has n·2ⁿ entries.'
        },
        {
          q: 'Why must states be computed in order of increasing subset size?',
          options: [
            'It looks nicer in the table',
            'The recurrence reads dp[mask∖{i}][j], a strictly smaller subset — it must already be computed',
            'It reduces memory usage',
            'It isn’t necessary — any order works'
          ],
          answer: 1,
          why: 'DP needs its dependencies solved first. Increasing subset size is a topological order of the recurrence.'
        }
      ]
    },
    {
      id: 'twoopt-improve',
      title: '5 · How 2-opt improves an existing tour',
      goal: 'Watch uncrossing: a local move with a global effect on cost.',
      demo: { preset: 'preset8', algo: 'twoopt', note: 'Removed edges glow red-dashed, added edges green-dashed; the delta shows the exact saving.' },
      steps: [
        { html: '<p>2-opt starts from a valid tour (nearest neighbor here) and looks for <b>crossings</b>: two edges (a,b) and (c,e) whose replacement by (a,c),(b,e) shortens the tour. The saving is computed in <b>O(1)</b> from just four edges — the whole tour is never re-scored.</p>' },
        { html: '<p>When a swap helps, it is applied immediately (first-improvement) and the scan restarts. When a full pass finds nothing, the tour is <b>2-optimal</b>: no single swap helps.</p>' },
        { html: '<p>Crucial: 2-optimal ≠ globally optimal. A tour can be immune to every 2-swap and still not be the best tour. Local search climbs to the top of <i>its</i> hill — which may not be the mountain.</p>' }
      ],
      quiz: [
        {
          q: '2-opt stops with no improving swap. What do we know?',
          options: [
            'The tour is optimal',
            'The tour is 2-optimal (a local optimum)',
            'The tour is the worst possible',
            'Nothing — it stopped at random'
          ],
          answer: 1,
          why: 'No single 2-swap improves it, so it’s locally optimal in the 2-swap neighborhood. Better tours reachable only via bigger moves may still exist.'
        }
      ]
    },
    {
      id: 'approx-vs-optimal',
      title: '6 · Approximation guarantee vs. optimality proof',
      goal: 'Distinguish “≤ 2·OPT, proven” from “optimal, proven” from “looks good”.',
      demo: { preset: 'preset6', algo: 'mst', note: 'Compare the MST tour cost with the Held–Karp optimum: the ratio is the empirical approximation factor.' },
      steps: [
        { html: '<p>Three very different claims: <b>(a)</b> Brute force / Held–Karp / B&B return the <i>optimal</i> tour — <i>proven</i>, because they examine (or safely prune) the whole search space. <b>(b)</b> MST double-tree returns a tour <i>proven ≤ 2·OPT</i> — but <b>only for metric TSP</b> (symmetric + triangle inequality). <b>(c)</b> Heuristics (NN, 2-opt, GA, SA) return a valid tour with <i>no guarantee at all</i>.</p>' },
        { html: '<p>The factor-2 proof: MST weight ≤ OPT (delete one edge from the optimal tour to get a spanning tree); the preorder walk traverses each MST edge twice (≤ 2·OPT); shortcutting visited cities can’t lengthen the walk <i>if the triangle inequality holds</i>.</p>' },
        { html: '<p>Try it: run MST then Held–Karp on the same preset and compute cost(MST)/cost(OPT). It should be well under 2 — the guarantee is a <i>worst-case</i> bound, and real instances do better. Now hand-edit one matrix entry to violate the triangle inequality and re-run: the guarantee no longer applies, though the tour stays valid.</p>' }
      ],
      quiz: [
        {
          q: 'The MST tour costs 1.9 × OPT on some instance. Is the implementation broken?',
          options: [
            'Yes — it should always be ≤ 1.5 × OPT',
            'No — the guarantee is ≤ 2·OPT, and 1.9 < 2',
            'Yes — approximation means nearly optimal',
            'No — but only if the instance is metric'
          ],
          answer: 1,
          why: '2·OPT is a worst-case ceiling, not a typical value. (On a non-metric instance even the ceiling wouldn’t apply.)'
        },
        {
          q: 'Which statement is a valid “optimality proof”?',
          options: [
            '2-opt found no improving swap',
            'The genetic algorithm converged',
            'Branch & Bound finished: every non-pruned branch was explored and every prune was safe',
            'Simulated annealing cooled to T ≈ 0'
          ],
          answer: 2,
          why: 'Only exhaustive search with safe pruning proves nothing better exists. The others are stopping conditions, not proofs.'
        }
      ]
    }
  ];

  /** Render the lesson picker into a container; hooks.onLaunchDemo(demo). */
  TSP.renderLessonList = function (container, hooks) {
    container.innerHTML = '';
    TSP.LESSONS.forEach((L, idx) => {
      const card = document.createElement('article');
      card.className = 'panel card lesson-card';
      const h = document.createElement('h3');
      h.textContent = L.title;
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = L.goal;
      const row = document.createElement('div');
      row.className = 'row';
      const open = document.createElement('button');
      open.className = 'btn btn-small';
      open.textContent = 'Start lesson';
      open.addEventListener('click', () => hooks.onOpenLesson(idx));
      row.appendChild(open);
      if (L.demo) {
        const demo = document.createElement('button');
        demo.className = 'btn btn-small btn-ghost';
        demo.textContent = '▶ Run the demo';
        demo.title = L.demo.note;
        demo.addEventListener('click', () => hooks.onLaunchDemo(L.demo, idx));
        row.appendChild(demo);
      }
      card.appendChild(h); card.appendChild(p); card.appendChild(row);
      container.appendChild(card);
    });
  };
})();
