/* ============================================================
   visualization.js — SVG graph rendering & interaction
   ------------------------------------------------------------
   - draws the complete weighted graph (cities = nodes, every
     pair connected by an edge with a distance label)
   - cities are draggable; positions live in the TSPProblem
   - tooltips on edges (weights) and cities (route info)
   - zoom (wheel) + pan (drag background), reset view
   - highlights driven by engine frames:
       current path/city, best path, DP subset, pruned edges,
       nearest-neighbor candidates, 2-opt swaps, MST edges
   - owns no algorithm logic; it only renders frames
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
  function title(text) {
    const t = document.createElementNS(SVGNS, 'title');
    t.textContent = text;
    return t;
  }

  /**
   * Create a graph view.
   * @param {SVGSVGElement} svg
   * @param {TSPProblem} problem
   * @param {Object} hooks { onCityMoved(index), onCityAdded(x,y), interactive }
   */
  TSP.createGraphView = function (svg, problem, hooks) {
    hooks = hooks || {};
    const interactive = hooks.interactive !== false;
    const W = 1000, H = 620; // matches viewBox
    const R = 22;

    let viewport, gEdges, gLabels, gPaths, gNodes;
    let showLabels = true;
    const view = { x: 0, y: 0, k: 1 };

    build();

    function build() {
      svg.innerHTML = '';
      if (interactive) {
        const bg = el('rect', { class: 'graph-bg', x: 0, y: 0, width: W, height: H, fill: 'transparent' }, svg);
        attachPan(bg);
      }
      viewport = el('g', { class: 'viewport' }, svg);
      applyView();
      gEdges = el('g', { class: 'layer-edges' }, viewport);
      gLabels = el('g', { class: 'layer-labels' }, viewport);
      gPaths = el('g', { class: 'layer-paths' }, viewport);
      gNodes = el('g', { class: 'layer-nodes' }, viewport);
    }

    function applyView() {
      viewport.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    }

    function px(p) { return { x: p.x * W, y: p.y * H }; }

    /** Full re-render of nodes + edges (on problem structure change). */
    function render() {
      build();
      const n = problem.n;

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = px(problem.cities[i]), b = px(problem.cities[j]);
          const line = el('line', {
            class: 'edge', 'data-i': i, 'data-j': j,
            x1: a.x, y1: a.y, x2: b.x, y2: b.y
          }, gEdges);
          line.appendChild(title(edgeTitle(i, j)));
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const t = el('text', {
            class: 'edge-label', 'data-i': i, 'data-j': j,
            x: mx, y: my, 'text-anchor': 'middle', 'dominant-baseline': 'middle'
          }, gLabels);
          t.textContent = formatDist(problem.dist[i][j]);
          if (!showLabels) t.style.display = 'none';
        }
      }

      for (let i = 0; i < n; i++) {
        const p = px(problem.cities[i]);
        const g = el('g', { class: 'city-node', 'data-i': i, transform: 'translate(' + p.x + ',' + p.y + ')' }, gNodes);
        g.appendChild(title(cityTitle(i, null)));
        el('circle', { class: 'city-circle', r: R }, g);
        const label = el('text', { class: 'city-label' }, g);
        label.textContent = problem.cities[i].label;
        if (interactive) attachDrag(g, i);
      }
      update(null);
    }

    function edgeTitle(i, j) {
      return problem.cities[i].label + ' – ' + problem.cities[j].label + ': ' + formatDist(problem.dist[i][j]);
    }
    function cityTitle(i, frame) {
      let s = 'City ' + problem.cities[i].label;
      if (frame) {
        const inPath = (arr) => arr && arr.indexOf(i) >= 0;
        const roles = [];
        if (inPath(frame.path)) roles.push('on current route');
        if (inPath(frame.bestPath)) roles.push('on best route');
        if (frame.node === i) roles.push('current city');
        if (roles.length) s += ' — ' + roles.join(', ');
      }
      return s;
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
        const t = line.querySelector('title');
        if (t) t.textContent = edgeTitle(i, j);
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

    function edgeEl(a, b) {
      return gEdges.querySelector('line[data-i="' + Math.min(a, b) + '"][data-j="' + Math.max(a, b) + '"]');
    }
    function markPath(path, cls) {
      if (!path || path.length < 2) return;
      for (let k = 0; k + 1 < path.length; k++) {
        const line = edgeEl(path[k], path[k + 1]);
        if (line) line.setAttribute('class', 'edge ' + cls);
      }
    }
    function markEdges(pairs, cls) {
      (pairs || []).forEach(([a, b]) => {
        const line = edgeEl(a, b);
        if (line) line.setAttribute('class', 'edge ' + cls);
      });
    }
    function nodeEl(i) { return gNodes.querySelector('g.city-node[data-i="' + i + '"]'); }
    function nodeClass(i, cls) { const g = nodeEl(i); if (g) g.classList.add(cls); }

    /** Highlight routes / states described by an engine frame. */
    function update(frame) {
      gEdges.querySelectorAll('line.edge').forEach(l => l.setAttribute('class', 'edge'));
      gNodes.querySelectorAll('g.city-node').forEach(g => {
        g.setAttribute('class', 'city-node');
        const t = g.querySelector('title');
        if (t) t.textContent = cityTitle(+g.getAttribute('data-i'), frame);
      });

      if (!frame) return;
      const extra = frame.extra || {};

      if (frame.bestPath) {
        markPath(frame.bestPath, 'best-edge');
        const seen = {};
        frame.bestPath.forEach(i => { if (!seen[i]) { seen[i] = true; nodeClass(i, 'best-city'); } });
      }
      if (extra.mstEdges) markEdges(extra.mstEdges, 'mst-edge');
      if (frame.path) markPath(frame.path, 'current-edge');
      if (frame.node !== null && frame.node !== undefined) nodeClass(frame.node, 'current');
      if (frame.mask) {
        frame.mask.forEach(i => {
          const g = nodeEl(i);
          if (g && !g.classList.contains('current')) g.classList.add('best-city');
        });
      }
      if (extra.candidates) {
        extra.candidates.forEach(i => { if (i !== extra.chosen) nodeClass(i, 'candidate'); });
        if (extra.chosen !== undefined && extra.chosen !== null && extra.chosen >= 0) nodeClass(extra.chosen, 'current');
      }
      if (extra.swap) {
        markEdges(extra.swap.remove, 'swap-remove');
        markEdges(extra.swap.add, 'swap-add');
      }
      if (frame.pruned) markEdges(frame.pruned, 'pruned-edge');
    }

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
        evt.stopPropagation();
        if (hooks.onDragStart) hooks.onDragStart(index);
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

    /* ---------- pan & zoom ---------- */
    function attachPan(bg) {
      let panning = false, sx = 0, sy = 0, vx = 0, vy = 0;
      bg.addEventListener('pointerdown', (evt) => {
        panning = true; sx = evt.clientX; sy = evt.clientY; vx = view.x; vy = view.y;
        bg.setPointerCapture(evt.pointerId);
      });
      bg.addEventListener('pointermove', (evt) => {
        if (!panning) return;
        const rect = svg.getBoundingClientRect();
        const scaleX = W / rect.width, scaleY = H / rect.height;
        view.x = vx + (evt.clientX - sx) * scaleX;
        view.y = vy + (evt.clientY - sy) * scaleY;
        applyView();
      });
      const end = () => { panning = false; };
      bg.addEventListener('pointerup', end);
      bg.addEventListener('pointercancel', end);
      svg.addEventListener('wheel', (evt) => {
        evt.preventDefault();
        const factor = evt.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(evt.clientX, evt.clientY, factor);
      }, { passive: false });
    }

    function zoomAt(clientX, clientY, factor) {
      const rect = svg.getBoundingClientRect();
      const mx = (clientX - rect.left) * (W / rect.width);
      const my = (clientY - rect.top) * (H / rect.height);
      const k2 = Math.min(4, Math.max(0.5, view.k * factor));
      const s = k2 / view.k;
      view.x = mx - (mx - view.x) * s;
      view.y = my - (my - view.y) * s;
      view.k = k2;
      applyView();
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
      zoomIn() { zoomAtCenter(1.25); },
      zoomOut() { zoomAtCenter(1 / 1.25); },
      resetView() { view.x = 0; view.y = 0; view.k = 1; applyView(); },
      toNormalized(clientX, clientY) {
        const pt = svg.createSVGPoint();
        pt.x = clientX; pt.y = clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        return { x: Math.min(0.95, Math.max(0.05, p.x / W)), y: Math.min(0.95, Math.max(0.05, p.y / H)) };
      }
    };

    function zoomAtCenter(factor) {
      const rect = svg.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }
  };
})();
