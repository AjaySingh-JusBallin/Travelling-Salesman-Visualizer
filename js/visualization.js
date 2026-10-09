/* ============================================================
   visualization.js — SVG graph rendering & interaction
   ------------------------------------------------------------
   - draws the complete weighted graph (cities = nodes, every
     pair connected by an edge with a distance label)
   - cities are draggable; positions live in the TSPProblem
   - highlights: current city/route, best route, DP subset,
     pruned branches
   - owns no algorithm logic; it only renders a `visual` object
     of the shape produced by runner.getVisual()
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});
  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /**
   * Create a graph view.
   * @param {SVGSVGElement} svg
   * @param {TSPProblem} problem
   * @param {Object} hooks { onCityMoved(index), onCityAdded(x,y) }
   */
  TSP.createGraphView = function (svg, problem, hooks) {
    hooks = hooks || {};
    const W = 1000, H = 620; // matches viewBox
    const R = 22;

    let gEdges, gLabels, gNodes, gPaths;
    let showLabels = true;

    build();

    function build() {
      svg.innerHTML = '';
      // defs: subtle arrowheads not needed; keep it clean
      gEdges = el('g', { class: 'layer-edges' }, svg);
      gLabels = el('g', { class: 'layer-labels' }, svg);
      gPaths = el('g', { class: 'layer-paths' }, svg);
      gNodes = el('g', { class: 'layer-nodes' }, svg);
    }

    function px(p) { return { x: p.x * W, y: p.y * H }; }

    /** Full re-render of nodes + edges (on problem structure change). */
    function render() {
      build();
      const n = problem.n;

      // edges: every pair (complete graph)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = px(problem.cities[i]), b = px(problem.cities[j]);
          el('line', {
            class: 'edge', 'data-i': i, 'data-j': j,
            x1: a.x, y1: a.y, x2: b.x, y2: b.y
          }, gEdges);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const t = el('text', {
            class: 'edge-label', 'data-i': i, 'data-j': j,
            x: mx, y: my, 'text-anchor': 'middle', 'dominant-baseline': 'middle'
          }, gLabels);
          t.textContent = formatDist(problem.dist[i][j]);
          if (!showLabels) t.style.display = 'none';
        }
      }

      // nodes
      for (let i = 0; i < n; i++) {
        const p = px(problem.cities[i]);
        const g = el('g', { class: 'city-node', 'data-i': i, transform: 'translate(' + p.x + ',' + p.y + ')' }, gNodes);
        el('circle', { class: 'city-circle', r: R }, g);
        const label = el('text', { class: 'city-label' }, g);
        label.textContent = problem.cities[i].label;
        attachDrag(g, i);
      }
      update(null);
    }

    function formatDist(d) {
      if (!Number.isFinite(d)) return '?';
      return (Math.round(d * 10) / 10).toString();
    }

    /** Update edge positions/labels after cities move (cheap path). */
    function refreshEdges() {
      const lines = gEdges.querySelectorAll('line.edge');
      lines.forEach(line => {
        const i = +line.getAttribute('data-i'), j = +line.getAttribute('data-j');
        const a = px(problem.cities[i]), b = px(problem.cities[j]);
        line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
        line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      });
      const labels = gLabels.querySelectorAll('text.edge-label');
      labels.forEach(t => {
        const i = +t.getAttribute('data-i'), j = +t.getAttribute('data-j');
        const a = px(problem.cities[i]), b = px(problem.cities[j]);
        t.setAttribute('x', (a.x + b.x) / 2);
        t.setAttribute('y', (a.y + b.y) / 2);
        t.textContent = formatDist(problem.dist[i][j]);
      });
    }

    /** Highlight routes / states described by `visual` (from runner.getVisual()). */
    function update(visual) {
      // reset classes
      gEdges.querySelectorAll('line.edge').forEach(l => l.setAttribute('class', 'edge'));
      gNodes.querySelectorAll('g.city-node').forEach(g => g.setAttribute('class', 'city-node'));

      if (!visual) return;
      const n = problem.n;

      const markPath = (path, cls) => {
        if (!path || path.length < 2) return;
        for (let k = 0; k + 1 < path.length; k++) {
          const a = path[k], b = path[k + 1];
          const line = gEdges.querySelector('line[data-i="' + Math.min(a, b) + '"][data-j="' + Math.max(a, b) + '"]');
          if (line) line.setAttribute('class', 'edge ' + cls);
        }
      };

      if (visual.bestPath) {
        markPath(visual.bestPath, 'best-edge');
        const seen = {};
        visual.bestPath.forEach(i => {
          if (!seen[i]) { seen[i] = true; nodeClass(i, 'best-city'); }
        });
      }
      if (visual.currentPath) {
        markPath(visual.currentPath, 'current-edge');
        // current-path highlight takes precedence over best for shared edges is fine —
        // draw current on top by re-marking after best
      }
      if (visual.currentNode !== null && visual.currentNode !== undefined) {
        nodeClass(visual.currentNode, 'current');
      }
      if (visual.maskCities) {
        visual.maskCities.forEach(i => {
          const g = nodeEl(i);
          if (g && !g.classList.contains('current')) g.classList.add('best-city');
        });
      }
      if (visual.pruned && visual.pruned.length) {
        visual.pruned.forEach(([a, b]) => {
          const line = gEdges.querySelector('line[data-i="' + Math.min(a, b) + '"][data-j="' + Math.max(a, b) + '"]');
          if (line) line.setAttribute('class', 'edge pruned-edge');
        });
      }
    }

    function nodeEl(i) { return gNodes.querySelector('g.city-node[data-i="' + i + '"]'); }
    function nodeClass(i, cls) { const g = nodeEl(i); if (g) g.classList.add(cls); }

    /* ---------- dragging ---------- */
    function svgPoint(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const m = svg.getScreenCTM();
      if (!m) return { x: 0.5, y: 0.5 };
      const p = pt.matrixTransform(m.inverse());
      return { x: p.x / W, y: p.y / H };
    }

    function attachDrag(g, index) {
      let dragging = false;
      g.addEventListener('pointerdown', (evt) => {
        dragging = true;
        g.setPointerCapture(evt.pointerId);
        evt.preventDefault();
      });
      g.addEventListener('pointermove', (evt) => {
        if (!dragging) return;
        const p = svgPoint(evt);
        problem.moveCity(index, p.x, p.y);
        const sp = px(problem.cities[index]);
        g.setAttribute('transform', 'translate(' + sp.x + ',' + sp.y + ')');
        refreshEdges();
      });
      const end = () => {
        if (dragging) {
          dragging = false;
          if (hooks.onCityMoved) hooks.onCityMoved(index);
        }
      };
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
    }

    /* ---------- public API ---------- */
    return {
      render,
      refreshEdges,
      update,
      setShowLabels(v) {
        showLabels = v;
        gLabels.querySelectorAll('text.edge-label').forEach(t => {
          t.style.display = v ? '' : 'none';
        });
      },
      /** screen coords for placing a new city from a click (normalized) */
      toNormalized(clientX, clientY) {
        const pt = svg.createSVGPoint();
        pt.x = clientX; pt.y = clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        return { x: Math.min(0.95, Math.max(0.05, p.x / W)), y: Math.min(0.95, Math.max(0.05, p.y / H)) };
      }
    };
  };
})();
