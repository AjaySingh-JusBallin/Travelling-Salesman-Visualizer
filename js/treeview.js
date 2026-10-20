/* ============================================================
   treeview.js — Branch & Bound search-tree explorer
   ------------------------------------------------------------
   Renders the REAL search tree recorded by the B&B runner
   (runner.getTree()): root, extensions, bounds, statuses.
   The tree is the algorithm's own data — nothing is invented.

   Statuses: generated | expanded | pruned | complete (+ best)
   Interactions: click to inspect, double-click to collapse,
   "show on graph" jumps playback to the node's event.
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

  const MAX_RENDER_NODES = 2000;
  const X_GAP = 46, Y_GAP = 64, R = 13;

  TSP.createTreeView = function (svg, detailEl, hooks) {
    hooks = hooks || {};
    let tree = null, problem = null;
    let activeNodeId = null;
    let collapsed = new Set();   // user-collapsed
    let expanded = new Set();    // user-expanded beyond auto depth
    let autoDepth = 6;
    let nodeEventIndex = {};     // nodeId -> event index (for "show on graph")

    function reset() {
      activeNodeId = null;
      collapsed = new Set();
      expanded = new Set();
      autoDepth = 6;
      nodeEventIndex = {};
    }

    function setTree(t, p, eventIndexByNode) {
      tree = t; problem = p;
      nodeEventIndex = eventIndexByNode || {};
      resetView();
      render();
    }

    function resetView() {
      collapsed = new Set(); expanded = new Set();
      // auto depth: keep rendered nodes under the cap
      autoDepth = 12;
      const nodes = tree.nodes;
      const countAt = (d) => nodes.filter(nd => nodeDepth(nd) <= d).length;
      while (autoDepth > 2 && countAt(autoDepth) > MAX_RENDER_NODES) autoDepth--;
    }

    const nodeById = id => tree.nodes[id];
    function nodeDepth(nd) { return nd.path.length - 1; }

    function activePathSet() {
      const s = new Set();
      let id = activeNodeId;
      while (id !== null && id !== undefined && id >= 0 && nodeById(id)) {
        s.add(id);
        id = nodeById(id).parentId;
      }
      return s;
    }

    function childrenVisible(nd, onActivePath) {
      if (collapsed.has(nd.id)) return false;
      if (onActivePath) return true;
      if (expanded.has(nd.id)) return true;
      return nodeDepth(nd) < autoDepth;
    }

    // visible node ids (preorder), honoring collapse rules
    function visibleNodes() {
      const out = [];
      const onPath = activePathSet();
      (function walk(id) {
        const nd = nodeById(id);
        if (!nd) return;
        out.push(id);
        if (childrenVisible(nd, onPath.has(id))) {
          nd.children.forEach(walk);
        }
      })(tree.rootId);
      return out;
    }

    function layout(visible) {
      // simple tidy layout: leaves in order, parents centered.
      // NOTE: pos stores both the fractional leaf-order index `i` and the
      // final pixel coordinate `x` — parents average the *indices* of their
      // children, and only leaves are ever multiplied by X_GAP. (Averaging
      // already-scaled coordinates and scaling again compounds per level
      // and explodes the layout.)
      const visSet = new Set(visible);
      const pos = new Map();
      let nextX = 0;
      const onPath = activePathSet();
      function place(id) {
        const nd = nodeById(id);
        const kids = nd.children.filter(c => visSet.has(c) && childrenVisible(nd, onPath.has(id)));
        let i;
        if (!kids.length) i = nextX++;
        else { kids.forEach(place); i = (pos.get(kids[0]).i + pos.get(kids[kids.length - 1]).i) / 2; }
        pos.set(id, { i: i, x: i * X_GAP, y: nodeDepth(nd) * Y_GAP });
      }
      place(tree.rootId);
      return pos;
    }

    function statusClass(nd) {
      if (nd.id === activeNodeId) return 'tnode-active';
      switch (nd.status) {
        case 'pruned': return 'tnode-pruned';
        case 'expanded': return 'tnode-expanded';
        case 'complete': return 'tnode-complete';
        default: return 'tnode-generated';
      }
    }

    function render() {
      svg.innerHTML = '';
      detailEl.innerHTML = '';
      if (!tree || !tree.nodes.length) {
        svg.innerHTML = '';
        return;
      }
      const visible = visibleNodes();
      const pos = layout(visible);
      const onPath = activePathSet();

      let maxX = 0, maxY = 0;
      pos.forEach(p => { maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
      const W = Math.max(600, maxX + X_GAP * 2), H = Math.max(320, maxY + Y_GAP * 2);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

      const gE = el('g', {}, svg), gN = el('g', {}, svg);

      // edges
      visible.forEach(id => {
        const nd = nodeById(id);
        const p = pos.get(id);
        if (!p) return;
        nd.children.forEach(cid => {
          const cp = pos.get(cid);
          if (!cp) return;
          const hot = onPath.has(id) && onPath.has(cid);
          el('line', {
            x1: p.x + X_GAP / 2, y1: p.y, x2: cp.x + X_GAP / 2, y2: cp.y,
            class: 'tedge' + (hot ? ' tedge-hot' : '')
          }, gE);
        });
      });

      // nodes
      visible.forEach(id => {
        const nd = nodeById(id);
        const p = pos.get(id);
        if (!p) return;
        const cx = p.x + X_GAP / 2, cy = p.y;
        const g = el('g', { class: 'tnode ' + statusClass(nd), transform: 'translate(' + cx + ',' + cy + ')' }, gN);
        const hiddenKids = nd.children.length - nd.children.filter(c => pos.has(c)).length;
        if (hiddenKids > 0 && !collapsed.has(id)) {
          el('path', { d: 'M -7 7 L 0 15 L 7 7 Z', class: 'tnode-more' }, g)
            .appendChild(title('+' + hiddenKids + ' more (double-click to expand)'));
        }
        const circle = el('circle', { r: R, class: 'tnode-circle' }, g);
        circle.appendChild(title(
          'node #' + id + '\nroute: ' + nd.path.map(i => problem.cities[i].label).join('→') +
          '\ncost: ' + nd.cost +
          (nd.bound !== null ? '\nbound: ' + nd.bound : '') +
          '\nstatus: ' + nd.status +
          (nd.pruneReason ? '\n' + nd.pruneReason : '')
        ));
        const t = el('text', { class: 'tnode-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
        t.textContent = nd.status === 'pruned' ? '✕' : (nd.order >= 0 ? nd.order : '');
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => inspect(id));
        g.addEventListener('dblclick', (e) => { e.stopPropagation(); toggleCollapse(id); });
      });

      function title(s) {
        const t = document.createElementNS(SVGNS, 'title');
        t.textContent = s;
        return t;
      }

      // caption
      const cap = document.createElement('div');
      cap.className = 'tree-caption';
      const counts = { generated: 0, expanded: 0, pruned: 0, complete: 0 };
      tree.nodes.forEach(nd => { if (counts[nd.status] !== undefined) counts[nd.status]++; });
      cap.innerHTML =
        'Showing <b>' + visible.length + '</b> of <b>' + tree.nodes.length + '</b> nodes' +
        (tree.truncated ? ' <span class="warn">(tree recording truncated at 50,000 nodes)</span>' : '') +
        ' · <span class="lg tnode-expanded">■</span> expanded ' + counts.expanded +
        ' · <span class="lg-prune">■</span> pruned ' + counts.pruned +
        ' · <span class="lg-ok">■</span> complete ' + counts.complete +
        ' · <span class="lg-step">■</span> generated ' + counts.generated +
        '<br><span class="hint">Click a node to inspect · double-click to collapse/expand · number = exploration order</span>';
      detailEl.appendChild(cap);
    }

    function inspect(id) {
      const nd = nodeById(id);
      if (!nd) return;
      activeNodeId = id;
      render();
      const box = document.createElement('div');
      box.className = 'tree-inspect';
      const route = nd.path.map(i => problem.cities[i].label).join(' → ');
      box.innerHTML =
        '<h4>Node #' + id + ' <span class="node-status st-' + nd.status + '">' + nd.status + '</span></h4>' +
        '<table class="kv">' +
        '<tr><td>Partial route</td><td class="mono">' + route + '</td></tr>' +
        '<tr><td>Accumulated cost</td><td class="mono">' + nd.cost + '</td></tr>' +
        '<tr><td>Lower bound</td><td class="mono">' + (nd.bound === null ? '—' : nd.bound) + '</td></tr>' +
        '<tr><td>Exploration order</td><td class="mono">' + (nd.order >= 0 ? '#' + nd.order : 'not expanded yet') + '</td></tr>' +
        (nd.pruneReason ? '<tr><td>Prune reason</td><td>' + nd.pruneReason + '</td></tr>' : '') +
        '<tr><td>Children</td><td class="mono">' + nd.children.length + '</td></tr>' +
        '</table>';
      const btnRow = document.createElement('div');
      btnRow.className = 'row';
      if (nodeEventIndex[id] !== undefined) {
        const b = document.createElement('button');
        b.className = 'btn btn-small';
        b.textContent = '⇄ Show on graph';
        b.title = 'Jump playback to the event that created this node';
        b.addEventListener('click', () => { if (hooks.onShowOnGraph) hooks.onShowOnGraph(nodeEventIndex[id]); });
        btnRow.appendChild(b);
      }
      const bc = document.createElement('button');
      bc.className = 'btn btn-small btn-ghost';
      bc.textContent = collapsed.has(id) ? 'Expand branch' : 'Collapse branch';
      bc.addEventListener('click', () => toggleCollapse(id));
      btnRow.appendChild(bc);
      box.appendChild(btnRow);
      // replace caption with inspect (keep caption on top)
      detailEl.appendChild(box);
      if (hooks.onSelect) hooks.onSelect(nd);
    }

    function toggleCollapse(id) {
      if (collapsed.has(id)) { collapsed.delete(id); }
      else { collapsed.add(id); expanded.delete(id); }
      // if it was auto-hidden, user expand wins
      const nd = nodeById(id);
      if (!collapsed.has(id) && nodeDepth(nd) >= autoDepth) expanded.add(id);
      render();
      if (activeNodeId !== null) inspect(activeNodeId);
    }

    return {
      setTree,
      /** highlight the node being processed at the current playback event */
      setActive(nodeId) { activeNodeId = nodeId; render(); if (nodeId !== null && nodeId !== undefined) inspect(nodeId); },
      expandAll() { autoDepth = 12; collapsed.clear(); render(); },
      collapseAll() { autoDepth = 2; expanded.clear(); render(); },
      clear() { tree = null; svg.innerHTML = ''; detailEl.innerHTML = ''; }
    };
  };
})();
