# TSP Visualizer — Interactive DAA Laboratory

**Travelling Salesman Problem laboratory** for Design and Analysis of Algorithms:
visualize *why* TSP becomes computationally difficult and how eight different
algorithms deal with that difficulty — with human-readable playback, live
pseudocode highlighting, a Branch & Bound search-tree explorer, a Held–Karp DP
table, mathematical complexity derivations, synchronized comparison, an
experiment lab, and a guided Learn Mode.

> A small increase in the number of cities can cause an enormous increase in the number of possible tours.

## How to Run

**Option 1 — single file (simplest):** double-click `tsp-visualizer-single.html`.
It is the entire app (HTML + CSS + all JS) bundled into one file — no folder
structure to get wrong, no server needed.

**Option 2 — multi-file:** double-click `index.html`, or serve the folder:
```bash
cd tsp-visualizer
python3 -m http.server 8000
# then open http://localhost:8000
```
Plain scripts (no modules/bundler) share a `window.TSP` namespace, so the app
runs from `file://` with no build step.

**Tests:** `node tests/run.js` — 200+ assertions covering algorithm
correctness on known instances, the event engine, playback invariants, the
independent tour validator, and the live-intel panels (operation/decisions/
math/metrics all derive from real event data).

## Interface layout

Desktop-first three-column DAA laboratory:

- **Left — Live Algorithm Intelligence:** Current Operation (what the
  algorithm is doing now, with accepted/rejected/pruned decisions and
  reasons), Live Mathematical Analysis (complexity formulas with current
  values plugged in + expandable full derivation), Performance Monitor
  (compute time vs animation time reported separately), Pseudocode
  Inspector (live line highlighting synced to events, auto-scrolled).
- **Center — Graph workspace:** the large interactive TSP graph, with the
  execution toolbar (run/pause/step/back/end/skip/reset, 1500 ms/step
  default, event timeline) directly beneath it.
- **Right — Configuration:** algorithm selection + parameters, city
  management, distance matrix, resets.
- **Bottom — Analysis tabs:** full statistics dashboard, algorithm log,
  pseudocode, search tree, DP table, complexity derivations, compare,
  experiment lab, learn mode, report, how-it-works. The sidebar is the
  concise live summary; the tabs are the deep analysis.

All four left panels update from the same playback event stream as the
graph, so operation, math, metrics, pseudocode and timeline stay
synchronized on every step — including step-backward.

## Playback model

**Compute first, then animate.** Pressing ▶ Run executes the algorithm
headlessly as fast as possible (chunked so the UI stays responsive, with a
progress indicator and Cancel), recording a stream of *typed events*. Playback
then navigates that recording with an index cursor.

This gives, by construction:
- **1500 ms per meaningful event by default** — one algorithmic decision per
  step, at a classroom-demo pace. A speed slider shows the exact interval
  (ms/step or steps/sec).
- **Pause / resume / step forward / step backward / jump to end / skip to result.**
- **Changing speed never changes the answer** — computation is fully separated
  from animation; compute time and animation time are reported separately.
- **One guarded timer** — every path that (re)starts it clears the old one first.
- Large runs (>100,000 events) switch to **keyframe sampling**: best-tour
  updates, key events and periodic keyframes are kept; the result and all
  statistics are unaffected and the UI says so honestly.

## Algorithms (all real implementations, all measured)

| Algorithm | Kind | Complexity | Notes |
|---|---|---|---|
| Brute Force | exact | Θ(n!) | Heap's algorithm over (n−1)! tours, scored from scratch |
| Held–Karp (DP) | exact | Θ(n²·2ⁿ) time, Θ(n·2ⁿ) space | bitmask DP, parent-pointer reconstruction |
| Branch & Bound | exact | worst Θ(n!), usually far less | DFS + admissible min-out lower bound, NN initial bound |
| Nearest Neighbor | heuristic | Θ(n²) | greedy, never claims optimality |
| 2-opt Local Search | heuristic | O(k·n²) | first-improvement, O(1) delta eval, 2-optimal stop |
| MST Approximation | approximation | Θ(n²), ≤ 2·OPT | double-tree; guarantee needs metric TSP |
| Genetic Algorithm | heuristic | Θ(g·p·n) | tournament + ordered crossover + swap mutation, seeded |
| Simulated Annealing | heuristic | Θ(iterations) | random 2-swaps, exp(−Δ/T) acceptance, seeded |

Heuristics are **never labeled optimal**. The lab validates every reported tour
with an independent checker (visits, start/end, edge weights, cost sum).

## Features

- **Interactive SVG graph** — draggable cities, zoom (wheel), pan, full-screen,
  hover tooltips (edge weights, city/route info), toggleable distance labels,
  optional auto Euclidean distances, full legend.
- **Graph editing** — add (double-click), remove, rename, undo/redo (Ctrl+Z/Y),
  random generation with 5 structures (uniform, clustered, circular, grid,
  outlier-heavy), presets, JSON import/export.
- **Editable distance matrix** — symmetric editing with validation.
- **Pseudocode panel** — the current line highlights live as the algorithm runs,
  with a plain-English explanation and variable values for each event.
- **Search-tree explorer** (Branch & Bound) — the real recorded tree: expand /
  collapse branches, per-node route/cost/bound/status, exact prune reasons,
  exploration order, click-to-inspect, jump from a node to its graph state.
- **DP table visualizer** (Held–Karp) — states in computation order with
  subset bitmasks, click any state for its full recurrence with all candidate
  transitions (minimum highlighted), trace the optimal chain via parent pointers.
- **Complexity Analysis tab** — a real mathematical derivation per algorithm
  (counting, recurrence/summation, simplification, space, cases, theory vs.
  measured), plus the tour-explosion table and a log-scale growth chart with
  optional measured-data overlay from your experiments.
- **Synchronized comparison** — run 2+ algorithms on the same frozen graph:
  results table (cost, compute time, states, optimality, relative error vs.
  the exact optimum when known), side-by-side mini graphs, lockstep playback,
  best-cost race chart.
- **Experiment Lab** — seeded, reproducible trials across structures and city
  counts: best/avg/worst outcomes, grouped log-scale charts, CSV/JSON export,
  cancellation, and cost warnings for heavy exact runs.
- **Learn Mode** — 6 guided demos (factorial explosion, greedy failure, B&B
  pruning, HK memoization, 2-opt, approximation vs. optimality) with
  prediction checkpoints and one-click demo launches.
- **Report export** — JSON / events CSV / printable HTML report of the actual
  run (graph, matrix, parameters, tour, validation, statistics).
- **Correctness-first Branch & Bound** — the lower bound is the provably
  admissible min-outgoing-edge relaxation
  (`costSoFar + minOut(cur) + Σ minOut(unvisited)`); a differential test
  suite checks B&B against brute force on randomized instances so a pruned
  subtree can never hide the optimum.

## Project Architecture

```
tsp-visualizer/
├── index.html                  # Dashboard: header, graph, controls, analysis tabs
├── style.css                   # Dark lab theme
├── tsp-visualizer-single.html  # Bundled single-file build (build-single.py)
├── README.md
├── js/
│   ├── tsp.js          # TSPProblem: cities, symmetric matrix, validation,
│   │                   #   presets, structured seeded generators
│   ├── engine.js       # Event vocabulary, headless recorder (cap+sampling),
│   │                   #   playback controller (single timer), tour validator
│   ├── algorithms.js   # 8 steppable runners emitting typed events + frames
│   ├── pseudocode.js   # Pseudocode listings keyed to event line ids
│   ├── derivations.js  # Mathematical complexity derivations per algorithm
│   ├── visualization.js# SVG graph: render, drag, zoom/pan, frame highlighting
│   ├── treeview.js     # B&B search-tree explorer (SVG)
│   ├── dptable.js      # Held–Karp DP table visualizer
│   ├── complexity.js   # Number formatting, growth chart (+measured overlay),
│   │                   #   experiment chart
│   ├── learn.js        # Learn Mode lessons + checkpoints
│   ├── report.js       # Report assembly + JSON/CSV/HTML export
│   └── app.js          # UI wiring: compute→playback pipeline, tabs, labs
└── tests/
    ├── run.js / shim.js / test_algorithms.js / test_engine.js
```

**Key design idea:** algorithms are *event producers*, not animators. A runner's
`step()` performs one meaningful operation and returns a typed event
`{kind, line, explain, data}` plus a compact visual frame. `engine.js` records
the whole stream headlessly, then `createPlayback` navigates it. Every view —
graph, log, pseudocode, tree, DP table, stats — renders from the *same*
recording, so all panels stay consistent and seeking never recomputes.

## Known limitations

- Symmetric TSP only; asymmetric (directed) distances are not supported.
- The B&B lower bound is the min-outgoing-edge relaxation (admissible but
  weak); no alternative bounds (MST/1-tree) yet.
- Event streams over 100,000 use keyframe-sampled playback (result unaffected).
- No Web Worker: long computations run chunked on the main thread with
  progress + cancel (keeps `file://` compatibility).
- Math is rendered with semantic HTML (sub/sup/Σ), not a TeX engine — a
  deliberate choice to avoid heavy dependencies and keep `file://` working.
