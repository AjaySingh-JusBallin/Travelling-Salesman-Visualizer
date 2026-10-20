/* ============================================================
   dptable.js — Held–Karp DP table visualizer
   ------------------------------------------------------------
   Reads the REAL dp / parent arrays from the runner
   (runner.getDP()). States are shown in computation order
   (increasing subset size), paginated and filterable — never
   a separately computed imitation.
   Click a state to inspect its recurrence: every candidate
   predecessor transition, with the minimum highlighted.
   ============================================================ */
(function () {
  'use strict';
  const TSP = (window.TSP = window.TSP || {});

  const PAGE_SIZE = 14;

  function maskLabels(problem, mask) {
    const s = [];
    for (let j = 0; j < problem.n; j++) if (mask & (1 << j)) s.push(problem.cities[j].label);
    return s;
  }
  function popcount(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }

  TSP.createDPView = function (container) {
    let dpInfo = null, problem = null;
    let page = 0, sizeFilter = 0; // 0 = all
    let highlightKey = null;      // "mask:city"
    let traceChain = null;        // array of {mask, city} for optimal-path trace

    function setDP(info, p) {
      dpInfo = info; problem = p;
      page = 0; sizeFilter = 0; highlightKey = null; traceChain = null;
      render();
    }
    function clear() {
      dpInfo = null;
      container.innerHTML = '<p class="hint">Run Held–Karp to fill the DP table.</p>';
    }

    function filteredOrder() {
      if (!dpInfo) return [];
      return dpInfo.order.filter(([mask]) => !sizeFilter || popcount(mask) === sizeFilter);
    }
    const at = (mask, i) => mask * dpInfo.n + i;
    const key = (mask, i) => mask + ':' + i;

    function render() {
      container.innerHTML = '';
      if (!dpInfo) { clear(); return; }
      const order = filteredOrder();
      const pages = Math.max(1, Math.ceil(order.length / PAGE_SIZE));
      page = Math.max(0, Math.min(pages - 1, page));

      // controls
      const ctrl = document.createElement('div');
      ctrl.className = 'row dp-controls';
      const lab = document.createElement('label');
      lab.className = 'field-label';
      lab.textContent = 'Subset size';
      const sel = document.createElement('select');
      sel.className = 'select';
      sel.style.maxWidth = '130px';
      const opt0 = document.createElement('option');
      opt0.value = '0'; opt0.textContent = 'all sizes';
      sel.appendChild(opt0);
      for (let s = 2; s <= problem.n; s++) {
        const o = document.createElement('option');
        o.value = String(s); o.textContent = 'size ' + s;
        if (s === sizeFilter) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { sizeFilter = +sel.value; page = 0; render(); });
      ctrl.appendChild(lab); ctrl.appendChild(sel);

      const info = document.createElement('span');
      info.className = 'hint';
      info.textContent = order.length + ' states · page ' + (page + 1) + '/' + pages;
      ctrl.appendChild(info);

      const prev = document.createElement('button');
      prev.className = 'btn btn-small'; prev.textContent = '← Prev';
      prev.disabled = page === 0;
      prev.addEventListener('click', () => { page--; render(); });
      const next = document.createElement('button');
      next.className = 'btn btn-small'; next.textContent = 'Next →';
      next.disabled = page >= pages - 1;
      next.addEventListener('click', () => { page++; render(); });
      ctrl.appendChild(prev); ctrl.appendChild(next);

      const traceBtn = document.createElement('button');
      traceBtn.className = 'btn btn-small';
      traceBtn.textContent = traceChain ? 'Hide optimal trace' : 'Trace optimal tour states';
      traceBtn.title = 'Follow the parent-pointer chain from the base case to the optimal tour';
      traceBtn.addEventListener('click', () => { traceChain = traceChain ? null : buildTrace(); render(); });
      ctrl.appendChild(traceBtn);
      container.appendChild(ctrl);

      if (traceChain) renderTrace(container);

      // table
      const tbl = document.createElement('table');
      tbl.className = 'dp-table';
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>#</th><th>Subset mask</th><th>End</th><th>dp value</th><th>Via</th><th></th></tr>';
      tbl.appendChild(thead);
      const tbody = document.createElement('tbody');
      const start = page * PAGE_SIZE;
      order.slice(start, start + PAGE_SIZE).forEach(([mask, i], k) => {
        const tr = document.createElement('tr');
        if (key(mask, i) === highlightKey) tr.className = 'dp-active';
        tr.style.cursor = 'pointer';
        const v = dpInfo.dp[at(mask, i)];
        const via = dpInfo.parent[at(mask, i)];
        const cells = [
          String(start + k + 1),
          '{' + maskLabels(problem, mask).join(',') + '} <span class="dim">0b' + mask.toString(2).padStart(problem.n, '0') + '</span>',
          problem.cities[i].label,
          Number.isFinite(v) ? String(v) : '∞',
          via >= 0 ? problem.cities[via].label : '—'
        ];
        cells.forEach((c, ci) => {
          const td = document.createElement('td');
          if (ci === 1 || ci === 3) td.innerHTML = c; else td.textContent = c;
          if (ci === 3) td.className = 'mono';
          tr.appendChild(td);
        });
        const tdBtn = document.createElement('td');
        const b = document.createElement('button');
        b.className = 'btn btn-small btn-ghost';
        b.textContent = 'Recurrence';
        b.addEventListener('click', (e) => { e.stopPropagation(); inspectState(mask, i, container); });
        tdBtn.appendChild(b);
        tr.appendChild(tdBtn);
        tr.addEventListener('click', () => inspectState(mask, i, container));
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      container.appendChild(tbl);

      const detail = document.createElement('div');
      detail.id = 'dp-detail';
      detail.className = 'dp-detail';
      detail.innerHTML = '<p class="hint">Click a state to inspect its recurrence and candidate transitions.</p>';
      container.appendChild(detail);
    }

    function inspectState(mask, i, host) {
      const prev = mask ^ (1 << i);
      const rows = [];
      for (let j = 0; j < problem.n; j++) {
        if (!(prev & (1 << j))) continue;
        const dpPrev = dpInfo.dp[at(prev, j)];
        const w = problem.dist[j][i];
        rows.push({ j, dpPrev, w, sum: dpPrev + w });
      }
      rows.sort((a, b) => a.sum - b.sum);
      const best = dpInfo.dp[at(mask, i)];
      const via = dpInfo.parent[at(mask, i)];
      const detail = host.querySelector('#dp-detail');
      let html = '<h4>dp[{' + maskLabels(problem, mask).join(',') + '}][' + problem.cities[i].label + '] = ' +
        (Number.isFinite(best) ? best : '∞') + '</h4>';
      html += '<div class="formula">dp[mask][i] = min<sub>j ∈ mask∖{i}</sub> ( dp[mask∖{i}][j] + d(j,i) )</div>';
      html += '<table class="dp-cand"><thead><tr><th>Predecessor j</th><th>dp[mask∖{i}][j]</th><th>+ d(j,i)</th><th>= candidate</th></tr></thead><tbody>';
      rows.forEach(r => {
        const isMin = r.j === via;
        html += '<tr class="' + (isMin ? 'dp-min' : '') + '"><td>' + problem.cities[r.j].label +
          ' <span class="dim">{' + maskLabels(problem, prev).join(',') + '}</span></td>' +
          '<td class="mono">' + (Number.isFinite(r.dpPrev) ? r.dpPrev : '∞') + '</td>' +
          '<td class="mono">' + r.w + '</td>' +
          '<td class="mono"><b>' + (Number.isFinite(r.sum) ? r.sum : '∞') + '</b>' + (isMin ? ' ← min' : '') + '</td></tr>';
      });
      html += '</tbody></table>';
      html += '<p class="hint">The minimum (' + (via >= 0 ? problem.cities[via].label : '—') +
        ') is memoized as dp[mask][i] and its parent pointer is used to reconstruct the optimal tour. ' +
        'Every value above comes from the actual DP arrays of this run.</p>';
      detail.innerHTML = html;
    }

    function buildTrace() {
      // follow parent pointers from the best full state back to the base case
      const FULL = dpInfo.FULL, n = dpInfo.n;
      let best = Infinity, bestEnd = -1;
      for (let i = 1; i < n; i++) {
        const c = dpInfo.dp[at(FULL, i)] + problem.dist[i][0];
        if (c < best) { best = c; bestEnd = i; }
      }
      const chain = [];
      let m = FULL, cur = bestEnd;
      while (true) {
        chain.push({ mask: m, city: cur });
        if (m === 1) break;
        const p = dpInfo.parent[at(m, cur)];
        m = m ^ (1 << cur);
        cur = p;
      }
      return chain.reverse(); // base case → final
    }

    function renderTrace(host) {
      const box = document.createElement('div');
      box.className = 'dp-trace';
      box.innerHTML = '<h4>Optimal-tour state chain (base case → final)</h4>';
      const ol = document.createElement('ol');
      traceChain.forEach((s, idx) => {
        const li = document.createElement('li');
        const v = dpInfo.dp[at(s.mask, s.city)];
        li.innerHTML = '<span class="mono">dp[{' + maskLabels(problem, s.mask).join(',') + '}][' +
          problem.cities[s.city].label + '] = ' + v + '</span>';
        li.style.cursor = 'pointer';
        li.title = 'Jump to this state in the table';
        li.addEventListener('click', () => {
          const order = filteredOrder();
          const pos = order.findIndex(([m, c]) => m === s.mask && c === s.city);
          if (pos >= 0) { page = Math.floor(pos / PAGE_SIZE); sizeFilter = 0; highlightKey = key(s.mask, s.city); render(); }
        });
        ol.appendChild(li);
      });
      box.appendChild(ol);
      host.appendChild(box);
    }

    return {
      setDP,
      clear,
      /** highlight the state being computed at the current playback event */
      highlight(mask, city) {
        if (!dpInfo) return;
        highlightKey = key(mask, city);
        const order = filteredOrder();
        const pos = order.findIndex(([m, c]) => m === mask && c === city);
        if (pos >= 0) page = Math.floor(pos / PAGE_SIZE);
        render();
        const detail = container.querySelector('#dp-detail');
        if (detail) inspectState(mask, city, container);
      }
    };
  };
})();
