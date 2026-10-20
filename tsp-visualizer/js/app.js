/* ============================================================
   app.js — UI wiring for the TSP DAA Laboratory
   ------------------------------------------------------------
   Owns: problem instance, graph view, the compute→playback
   pipeline, transport controls, stats + log + pseudocode +
   tree + DP panels, distance-matrix editor, undo/redo, presets,
   complexity explorer, comparison mode, experiment lab,
   learn mode, report export, and all reset behavior.

   Algorithm execution and animation are separated by engine.js:
   "Run" first computes the full event stream (cancellable,
   with progress), then plays it back at a human-readable pace.
   ============================================================ */
(function () {
  'use strict';
  const TSP = window.TSP;
  const $ = id => document.getElementById(id);

  /* ---------------- state ---------------- */
  const problem = new TSP.TSPProblem();
  let graphView = null;
  let treeView = null;
  let dpView = null;
  let playback = null;
  let record = null;
  let runnerRef = null;      // runner used for the current record (tree/DP access)
  let currentAlgo = 'brute';
  let currentParams = {};
  let runState = 'idle';     // idle | computing | ready | playing | paused | done
  let computeGen = 0;        // guards stale compute callbacks
  let computeCancelled = false;
  let lastLogSeq = -2;
  let validation = null;
  let measuredOverlay = {};  // algoId -> [{n, v}] for the growth chart
  let liveCounts = {};       // per-kind event counts for the current run (live intel panels)

  const SPEEDS = [1500, 1000, 600, 300, 150, 60, 25, 10];

  /* undo / redo: snapshots of the whole problem (tiny at n ≤ 11) */
  const undoStack = [], redoStack = [];
  function snapshotProblem() {
    return {
      cities: problem.cities.map(c => ({ id: c.id, label: c.label, x: c.x, y: c.y })),
      dist: problem.dist.map(r => r.slice()),
      nextId: problem._nextId
    };
  }
  function restoreProblem(s) {
    problem.cities = s.cities.map(c => ({ id: c.id, label: c.label, x: c.x, y: c.y }));
    problem.dist = s.dist.map(r => r.slice());
    problem._nextId = s.nextId;
  }
  function pushUndo(label) {
    undoStack.push({ label, snap: snapshotProblem() });
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }
  function doUndo() {
    if (!undoStack.length) return;
    redoStack.push({ label: 'redo', snap: snapshotProblem() });
    const u = undoStack.pop();
    restoreProblem(u.snap);
    onProblemMutated('Undid: ' + u.label + '.');
    updateUndoButtons();
  }
  function doRedo() {
    if (!redoStack.length) return;
    undoStack.push({ label: 'redo', snap: snapshotProblem() });
    const r = redoStack.pop();
    restoreProblem(r.snap);
    onProblemMutated('Redone.');
    updateUndoButtons();
  }
  function updateUndoButtons() {
    $('btn-undo').disabled = !undoStack.length;
    $('btn-redo').disabled = !redoStack.length;
  }

  /* ---------------- helpers ---------------- */
  function setStatus(state, text) {
    runState = state;
    const dot = $('status-dot');
    dot.className = 'dot ' + (state === 'playing' || state === 'computing' ? 'running'
      : state === 'paused' || state === 'ready' ? 'paused'
      : state === 'done' ? 'done' : '');
    $('status-text').textContent = text;
    const playing = state === 'playing', computing = state === 'computing';
    $('btn-run').disabled = playing || computing;
    $('btn-pause').disabled = !playing;
    const canStep = !playing && !computing && playback;
    $('btn-step').disabled = !canStep;
    $('btn-step-back').disabled = !canStep;
    $('btn-jump-end').disabled = !canStep;
    $('btn-skip').disabled = !canStep;
    /* visual feedback hooks: idle-ready glow on Run, progress shimmer */
    const idleReady = !playing && !computing;
    ['btn-run', 'btn-run-side'].forEach(id => {
      const b = $(id); if (b) b.classList.toggle('is-ready', idleReady && !b.disabled);
    });
    const bar = document.querySelector('.execbar');
    if (bar) bar.classList.toggle('is-playing', playing);
  }

  function notice(msg, type) {
    const n = $('notice');
    n.hidden = false;
    n.textContent = msg;
    n.className = 'notice' + (type ? ' ' + type : '');
    clearTimeout(notice._t);
    notice._t = setTimeout(() => { n.hidden = true; }, 7000);
  }

  function selectedAlgo() { return currentAlgo; }

  function speedLabel(ms) {
    return ms >= 100 ? ms + ' ms/step' : '≈ ' + Math.round(1000 / ms) + ' steps/sec';
  }

  // the execution timeline lives in the center toolbar and is always visible
  function resetTimeline() {
    $('progress-fill').style.width = '0%';
    $('event-counter').textContent = '0 / 0';
  }

  /* ---------------- log panel ---------------- */
  const LOG_ICONS = {
    START: ['lg-step', '○'], CANDIDATE_SELECTED: ['lg-arrow', '→'],
    EDGE_CONSIDERED: ['lg-arrow', '→'], DISTANCE_EVALUATED: ['lg-step', '·'],
    PARTIAL_ROUTE_UPDATED: ['lg-arrow', '→'], STATE_EXPANDED: ['lg-arrow', '→'],
    STATE_GENERATED: ['lg-step', '+'], STATE_PRUNED: ['lg-prune', '✕'],
    DP_STATE_UPDATED: ['lg-arrow', '→'], BEST_TOUR_UPDATED: ['lg-star', '★'],
    TOUR_COMPLETED: ['lg-ok', '✓'], OPTIMALITY_PROVEN: ['lg-ok', '✓'],
    ALGORITHM_COMPLETED: ['lg-ok', '✓']
  };
  function logEvent(ev, cursor, total) {
    const box = $('log');
    // a jump (non-sequential navigation): mark the discontinuity
    if (ev.seq !== lastLogSeq + 1 && lastLogSeq !== -2) {
      const div = document.createElement('div');
      div.className = 'log-entry log-jump';
      div.textContent = '⋯ jumped to event #' + (ev.seq + 1) + ' of ' + total;
      box.appendChild(div);
    }
    lastLogSeq = ev.seq;
    const [cls, icon] = LOG_ICONS[ev.kind] || ['lg-step', '·'];
    box.querySelectorAll('.log-entry.latest').forEach(e => e.classList.remove('latest'));
    const div = document.createElement('div');
    div.className = 'log-entry latest';
    div.title = ev.explain || '';
    const step = document.createElement('span');
    step.className = 'lg-step';
    step.textContent = '#' + (ev.seq + 1) + ' ';
    const ic = document.createElement('span');
    ic.className = cls;
    ic.textContent = icon + ' ';
    div.appendChild(step); div.appendChild(ic);
    div.appendChild(document.createTextNode(TSP.describeEvent(problem, ev)));
    box.appendChild(div);
    while (box.children.length > 600) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
    $('log-count').textContent = '· ' + (cursor + 1) + ' / ' + total + ' events' +
      (record && record.sampled ? ' (sampled stream)' : '');
  }

  /* ---------------- statistics ---------------- */
  function updateStats() {
    $('st-cities').textContent = problem.n;
    if (!record || !record.result) {
      ['st-best', 'st-current', 'st-explored', 'st-pruned', 'st-prunerate', 'st-compute',
       'st-anim', 'st-first-tour', 'st-optimality', 'st-valid', 'st-route']
        .forEach(id => { $(id).textContent = '–'; });
      return;
    }
    const ev = playback ? playback.currentEvent() : null;
    const fr = ev && ev.frame ? ev.frame : null;
    const best = fr && fr.bestCost !== null && fr.bestCost !== undefined ? fr.bestCost : record.result.bestCost;
    $('st-best').textContent = best === null ? '–' : TSP.formatInt(best);
    $('st-current').textContent = fr && fr.cost !== null && fr.cost !== undefined ? TSP.formatInt(fr.cost) : '–';
    $('st-explored').textContent = TSP.formatInt(record.stats.statesExplored);
    const canPrune = record.runnerId === 'branchbound';
    $('st-pruned').textContent = canPrune ? TSP.formatInt(record.stats.statesPruned) : 'N/A';
    if (canPrune) {
      const total = record.stats.statesExplored + record.stats.statesPruned;
      $('st-prunerate').textContent = total ? (100 * record.stats.statesPruned / total).toFixed(1) + '%' : '–';
    } else $('st-prunerate').textContent = 'N/A';
    $('st-compute').textContent = TSP.formatMs(record.computeMs);
    $('st-anim').textContent = playback
      ? playback.animSteps + ' steps × ' + speedLabel(playback.intervalMs) : '–';
    $('st-first-tour').textContent = record.firstTourIndex >= 0
      ? 'event #' + (record.firstTourIndex + 1) + ' (≈' + TSP.formatMs(record.computeMs * record.firstTourIndex / Math.max(1, record.totalEvents)) + ' compute)' : '–';
    const meta = TSP.algoMeta(record.runnerId);
    $('st-optimality').textContent = record.result.optimal ? 'Proven optimal'
      : meta.kind === 'exact' ? 'Unknown' : 'Heuristic — not proven';
    $('st-optimality').className = 'stat-value ' + (record.result.optimal ? 'ok-text' : 'warn-text');
    if (validation) {
      $('st-valid').textContent = validation.ok ? '✓ Valid' : '✕ Invalid';
      $('st-valid').className = 'stat-value ' + (validation.ok ? 'ok-text' : 'err-text');
      $('st-valid').title = validation.ok ? 'Independent check passed.' : validation.errors.join('; ');
    } else { $('st-valid').textContent = '–'; $('st-valid').className = 'stat-value'; }
    const bp = fr && fr.bestPath ? fr.bestPath : record.result.bestPath;
    $('st-route').textContent = bp ? bp.map(i => problem.cities[i].label).join(' → ') : '–';
  }

  /* ---------------- pseudocode panel ---------------- */
  function renderPseudoEvent(algoId, ev) {
    TSP.renderPseudocode($('pseudo-box'), algoId, ev ? ev.line : null);
    $('pseudo-explain').textContent = ev && ev.explain ? ev.explain : 'Run an algorithm to see live execution highlighting.';
    const vars = $('pseudo-vars');
    vars.innerHTML = '';
    // variable rows come from the shared liveintel helper (same data as the sidebar inspector)
    const rows = TSP.pseudoVarRows(problem, ev);
    if (!rows.length) { vars.innerHTML = '<p class="hint">No variables for this event.</p>'; return; }
    const tbl = document.createElement('table');
    tbl.className = 'kv';
    rows.forEach(([k, v]) => {
      const tr = document.createElement('tr');
      const tdK = document.createElement('td'); tdK.textContent = k;
      const tdV = document.createElement('td'); tdV.className = 'mono'; tdV.textContent = v;
      tr.appendChild(tdK); tr.appendChild(tdV); tbl.appendChild(tr);
    });
    vars.appendChild(tbl);
  }

  /* ---------------- run pipeline ---------------- */
  function disposePlayback() {
    if (playback) { playback.dispose(); playback = null; }
    record = null; runnerRef = null; validation = null;
    computeGen++; // invalidate in-flight compute callbacks
  }

  function clearRunViews() {
    graphView.update(null);
    treeView.clear();
    dpView.clear();
    liveCounts = {};
    const bar = document.querySelector('.execbar');
    if (bar) bar.classList.remove('is-complete');
    if (typeof TSP.resetIntel === 'function') TSP.resetIntel(problem, currentAlgo);
    $('tree-note').textContent = 'Run Branch & Bound to grow the search tree. The tree explorer is specific to Branch & Bound — other algorithms don’t build a search tree.';
    $('dp-note').textContent = 'Run Held–Karp to fill the DP table. The table visualizer is specific to Held–Karp — other algorithms don’t memoize DP states.';
    renderPseudoEvent(currentAlgo, null);
    $('pseudo-algo-name').textContent = '· ' + TSP.algoMeta(currentAlgo).name;
    updateStats();
  }

  function readParams(algoId) {
    const box = $('algo-params');
    const params = {};
    box.querySelectorAll('[data-param]').forEach(inp => {
      const k = inp.dataset.param;
      params[k] = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
    });
    return params;
  }

  async function onRun() {
    if (runState === 'playing') return;
    if (runState === 'paused' && playback) { // resume
      playback.play();
      return;
    }
    const errors = problem.validate();
    if (errors.length) { notice(errors[0], 'error'); return; }
    const algoId = selectedAlgo();
    if (algoId === 'brute' && problem.n > TSP.LIMITS.MAX_BF_CITIES) {
      const tours = TSP.tourCount(problem.n) || { log: TSP.logFactorial(problem.n - 1) };
      if (!window.confirm('Brute Force on ' + problem.n + ' cities = ' + TSP.formatCount(tours) +
        ' tours. The event stream will be sampled for playback. Continue?')) return;
    }
    currentParams = readParams(algoId);
    disposePlayback();
    clearRunViews();
    liveCounts = {};
    lastLogSeq = -2;
    $('log').innerHTML = '';
    $('log-count').textContent = '';

    const gen = ++computeGen;
    computeCancelled = false;
    const runner = TSP.createRunner(algoId, problem, currentParams);
    setStatus('computing', 'Computing events…');
    $('compute-wrap').hidden = false;
    $('btn-cancel-compute').disabled = false;
    resetTimeline();

    const rec = await TSP.recordRun(runner, problem, {
      onProgress: (total) => {
        if (gen !== computeGen) return;
        $('compute-text').textContent = 'Computing… ' + TSP.formatInt(total) + ' events';
        $('compute-fill').style.width = Math.min(100, total / 2000) + '%';
      },
      isCancelled: () => computeCancelled || gen !== computeGen
    });
    $('compute-wrap').hidden = true;
    if (gen !== computeGen) return; // superseded
    if (rec.cancelled || computeCancelled) {
      setStatus('idle', 'Ready');
      notice('Computation cancelled.', '');
      return;
    }

    record = rec;
    runnerRef = runner;
    validation = TSP.validateTour(problem, rec.result.bestPath, rec.result.bestCost);
    if (!validation.ok) {
      notice('Tour validation failed: ' + validation.errors.join('; '), 'error');
    }

    // wire algorithm-specific views from the REAL runner state
    if (algoId === 'branchbound') {
      const tree = runner.getTree();
      const nodeEventIndex = {};
      rec.events.forEach((ev, idx) => {
        const nid = ev.data && ev.data.nodeId;
        if (nid !== undefined && nid !== null && nodeEventIndex[nid] === undefined) nodeEventIndex[nid] = idx;
      });
      treeView.setTree(tree, problem, nodeEventIndex);
      $('tree-note').textContent = tree.nodes.length + ' search-tree nodes recorded' +
        (tree.truncated ? ' (recording truncated at 50,000 nodes)' : '') + '. Click a node to inspect it.';
    }
    if (algoId === 'heldkarp') {
      dpView.setDP(runner.getDP(), problem);
      $('dp-note').textContent = runner.getDP().order.length + ' DP states computed. Click a state to inspect its recurrence.';
    }

    const total = rec.events.length;
    resetTimeline();

    let lastTreeNode = null;
    playback = TSP.createPlayback(rec, {
      onEvent: (ev, cursor, n) => {
        logEvent(ev, cursor, n);
        if (ev.frame) graphView.update(ev.frame);
        /* candidate edge under evaluation: amber travelling marker (additive,
           cleared by the next update()) */
        if (ev.data && ev.data.edge && ev.data.edge.length === 2) {
          const a = Math.min(ev.data.edge[0], ev.data.edge[1]);
          const b = Math.max(ev.data.edge[0], ev.data.edge[1]);
          const line = document.querySelector('#graph line.edge[data-i="' + a + '"][data-j="' + b + '"]');
          if (line) line.classList.add('active-edge');
        }
        renderPseudoEvent(algoId, ev);
        liveCounts[ev.kind] = (liveCounts[ev.kind] || 0) + 1;
        const ictx = { frame: ev.frame || null, bestCost: rec.result.bestCost,
                       counts: liveCounts, record: rec };
        TSP.updateIntelOp(problem, ev, ictx);
        TSP.updateIntelMath(problem, algoId, ev, ictx);
        const flags = TSP.updateIntelPerf(problem, rec, playback, validation, liveCounts, ev, cursor);
        if (flags && flags.improved) {
          /* restrained green flash across the new best route */
          const svg = document.querySelector('#graph');
          const lines = svg ? svg.querySelectorAll('line.edge.best-edge') : [];
          lines.forEach(l => TSP.fxPulse(l,
            [{ strokeWidth: 8 }, { strokeWidth: 3.5 }], { duration: 900 }));
        }
        TSP.updateIntelPseudo(problem, algoId, ev);
        if (algoId === 'branchbound' && ev.data) {
          const nid = ev.data.nodeId !== undefined && ev.data.nodeId !== null
            ? ev.data.nodeId
            : (ev.frame && ev.frame.extra ? ev.frame.extra.nodeId : null);
          if (nid !== undefined && nid !== null && nid !== lastTreeNode) {
            lastTreeNode = nid;
            treeView.setActive(nid);
          }
        }
        if (algoId === 'heldkarp' && ev.kind === 'DP_STATE_UPDATED' && ev.data) {
          dpView.highlight(ev.data.mask, ev.data.city);
        }
        $('progress-fill').style.width = (100 * (cursor + 1) / n).toFixed(1) + '%';
        $('event-counter').textContent = (cursor + 1) + ' / ' + n + (rec.sampled ? ' (sampled)' : '');
        updateStats();
      },
      onState: (s) => {
        const label = TSP.algoMeta(algoId).name;
        if (s === 'playing') setStatus('playing', 'Playing · ' + label);
        else if (s === 'paused') setStatus('paused', 'Paused · ' + label);
        else if (s === 'done') {
          setStatus('done', 'Completed · ' + label);
          updateReportPanel();
          if (validation && !validation.ok) notice('Finished, but tour validation failed: ' + validation.errors.join('; '), 'error');
          else notice(label + ' finished — best distance ' + TSP.formatInt(rec.result.bestCost) +
            (rec.result.optimal ? ' (proven optimal).' : ' (heuristic).'), 'ok');
          /* one-shot success pulse on the execution bar (validated finish) */
          const bar = document.querySelector('.execbar');
          if (bar && validation && validation.ok) {
            bar.classList.remove('is-complete');
            void bar.offsetWidth; /* retrigger for repeated runs */
            bar.classList.add('is-complete');
          }
        }
        updateStats();
      },
      onSpeed: (ms) => { $('speed-label').textContent = speedLabel(ms); }
    });
    playback.setIntervalMs(SPEEDS[+$('speed').value]);
    setStatus('ready', 'Ready · ' + TSP.algoMeta(algoId).name);
    updateStats();
    playback.play(); // start the human-readable playback
  }

  function onCancelCompute() {
    computeCancelled = true;
    $('btn-cancel-compute').disabled = true;
  }

  /* ---------------- graph + matrix rendering ---------------- */
  function renderAll() {
    graphView.render();
    renderMatrix();
    renderCitySelect();
    updateStats();
  }

  function renderCitySelect() {
    const sel = $('city-select');
    const prev = sel.value;
    sel.innerHTML = '';
    problem.cities.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = c.label;
      sel.appendChild(o);
    });
    if (prev && +prev < problem.n) sel.value = prev;
  }

  function renderMatrix() {
    const tbl = $('matrix');
    tbl.innerHTML = '';
    const n = problem.n;
    if (!n) { tbl.innerHTML = '<tr><td style="padding:10px;color:var(--faint)">No cities yet.</td></tr>'; return; }
    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    for (let j = 0; j < n; j++) {
      const th = document.createElement('th');
      th.textContent = problem.cities[j].label;
      head.appendChild(th);
    }
    tbl.appendChild(head);
    for (let i = 0; i < n; i++) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = problem.cities[i].label;
      tr.appendChild(th);
      for (let j = 0; j < n; j++) {
        const td = document.createElement('td');
        if (i === j) { td.className = 'diag'; td.textContent = '—'; }
        else {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = TSP.formatInt(problem.dist[i][j]);
          inp.setAttribute('aria-label', 'Distance ' + problem.cities[i].label + ' to ' + problem.cities[j].label);
          inp.addEventListener('change', onMatrixEdit.bind(null, i, j, inp, td));
          td.appendChild(inp);
        }
        tr.appendChild(td);
      }
      tbl.appendChild(tr);
    }
  }

  function onMatrixEdit(i, j, inp, td) {
    const raw = inp.value.trim().replace(/,/g, '');
    const v = Number(raw);
    if (raw === '' || !Number.isFinite(v) || v < 0) {
      td.classList.add('invalid');
      notice('Invalid distance — enter a non-negative number.', 'error');
      inp.value = TSP.formatInt(problem.dist[i][j]);
      return;
    }
    pushUndo('edit distance');
    td.classList.remove('invalid');
    problem.setDistance(i, j, v);
    renderMatrix();
    graphView.refreshEdges();
    onProblemMutated('Distance updated. Previous run discarded.', true);
  }

  /** The problem changed: stale run state goes away (quietly or with a note). */
  function onProblemMutated(msg, silent) {
    if (runState === 'computing') { computeCancelled = true; }
    disposePlayback();
    clearRunViews();
    lastLogSeq = -2;
    if (!silent) { $('log').innerHTML = ''; }
    renderAll();
    setStatus('idle', 'Ready');
    updateReportPanel();
    if (msg) notice(msg, '');
  }

  /* ---------------- presets & city controls ---------------- */
  function loadPreset() {
    const sel = $('preset-select').value;
    if (!sel) { notice('Choose a preset first.', 'error'); return; }
    pushUndo('load preset');
    problem.loadPreset(sel);
    onProblemMutated('Preset loaded: ' + sel + ' (' + problem.n + ' cities).');
  }

  function addCity() {
    try {
      pushUndo('add city');
      problem.addCity();
      if ($('toggle-euclid').checked) problem.recalcEuclidean();
      onProblemMutated('City added.', true);
    } catch (e) { undoStack.pop(); notice(e.message, 'error'); }
  }

  function removeSelectedCity() {
    const idx = +$('city-select').value;
    if (!Number.isInteger(idx) || idx < 0 || idx >= problem.n) { notice('Select a city first.', 'error'); return; }
    if (problem.n <= 2) { notice('A TSP needs at least 2 cities.', 'error'); return; }
    pushUndo('remove city');
    problem.removeCity(idx);
    onProblemMutated('City removed.', true);
  }

  function renameSelectedCity() {
    const idx = +$('city-select').value;
    const name = $('city-rename').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (!Number.isInteger(idx) || idx < 0 || idx >= problem.n) { notice('Select a city first.', 'error'); return; }
    if (!name) { notice('Enter a new label (letters/digits, max 4).', 'error'); return; }
    if (problem.cities.some((c, i) => i !== idx && c.label === name)) { notice('Label already in use.', 'error'); return; }
    pushUndo('rename city');
    problem.cities[idx].label = name;
    $('city-rename').value = '';
    onProblemMutated('City renamed to ' + name + '.', true);
  }

  function generateRandom() {
    const n = Math.max(3, Math.min(11, +$('random-count').value || 6));
    const structure = $('random-structure').value;
    pushUndo('generate random');
    problem.generateStructured(Math.min(n, TSP.LIMITS.MAX_ANIMATED_CITIES), structure, Date.now() % 100000);
    onProblemMutated('Generated ' + problem.n + ' ' + structure + ' cities.');
  }

  function exportGraph() {
    TSP.download('tsp-graph-n' + problem.n + '.json', 'application/json',
      JSON.stringify({ cities: problem.cities, dist: problem.dist }, null, 2));
    notice('Graph exported as JSON.', 'ok');
  }

  function importGraph(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(rd.result);
        if (!obj.cities || !obj.dist || obj.cities.length !== obj.dist.length) throw new Error('bad format');
        if (obj.cities.length > TSP.LIMITS.MAX_ANIMATED_CITIES) throw new Error('too many cities (max 11)');
        pushUndo('import graph');
        problem.clear();
        obj.cities.forEach(c => {
          const city = problem.addCity(Math.min(0.95, Math.max(0.05, +c.x || 0.5)), Math.min(0.95, Math.max(0.05, +c.y || 0.5)));
          if (c.label) city.label = String(c.label).slice(0, 4);
        });
        for (let i = 0; i < problem.n; i++)
          for (let j = 0; j < problem.n; j++) {
            const v = +((obj.dist[i] || [])[j]);
            if (i !== j && (!Number.isFinite(v) || v < 0)) throw new Error('invalid distance at [' + i + '][' + j + ']');
            problem.dist[i][j] = i === j ? 0 : v;
          }
        onProblemMutated('Graph imported (' + problem.n + ' cities).');
      } catch (e) { notice('Import failed: ' + e.message, 'error'); }
    };
    rd.readAsText(file);
  }

  /* ---------------- algorithm selection ---------------- */
  function buildAlgoOptions() {
    const box = $('algo-options');
    box.innerHTML = '';
    TSP.ALGORITHMS.forEach(a => {
      const lab = document.createElement('label');
      lab.className = 'algo-option';
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'algo'; radio.value = a.id;
      radio.checked = a.id === currentAlgo;
      radio.addEventListener('change', () => selectAlgorithm(a.id));
      const nm = document.createElement('span'); nm.className = 'algo-name'; nm.textContent = a.name;
      const tc = document.createElement('span'); tc.className = 'algo-tc'; tc.textContent = a.tc;
      const kind = document.createElement('span'); kind.className = 'algo-kind kind-' + a.kind;
      kind.textContent = a.kind === 'approximation' ? 'approx' : a.kind;
      lab.appendChild(radio); lab.appendChild(nm); lab.appendChild(tc); lab.appendChild(kind);
      box.appendChild(lab);
    });
  }

  const PARAM_DEFS = {
    genetic: [
      { key: 'populationSize', label: 'Population', type: 'number', value: 50, min: 4, max: 500 },
      { key: 'generations', label: 'Generations', type: 'number', value: 100, min: 1, max: 2000 },
      { key: 'mutationRate', label: 'Mutation rate', type: 'number', value: 0.1, min: 0, max: 1, step: 0.01 },
      { key: 'seed', label: 'Seed', type: 'number', value: 42, min: 0, max: 999999 }
    ],
    annealing: [
      { key: 'initialTemp', label: 'Initial temp', type: 'number', value: 1000, min: 1, max: 100000 },
      { key: 'coolingRate', label: 'Cooling rate', type: 'number', value: 0.995, min: 0.8, max: 0.99999, step: 0.0005 },
      { key: 'iterations', label: 'Iterations', type: 'number', value: 2000, min: 1, max: 50000 },
      { key: 'seed', label: 'Seed', type: 'number', value: 7, min: 0, max: 999999 }
    ],
    twoopt: [
      { key: 'maxIterations', label: 'Max improving iterations', type: 'number', value: 1000, min: 1, max: 10000 }
    ]
  };

  function buildAlgoParams(algoId) {
    const box = $('algo-params');
    box.innerHTML = '';
    const defs = PARAM_DEFS[algoId];
    if (!defs) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = algoId === 'mst'
        ? 'No parameters. The 2·OPT guarantee needs metric TSP (symmetric + triangle inequality).'
        : 'No parameters.';
      box.appendChild(p);
      return;
    }
    defs.forEach(d => {
      const row = document.createElement('div');
      row.className = 'row param-row';
      const lab = document.createElement('label');
      lab.className = 'field-label';
      lab.textContent = d.label;
      lab.htmlFor = 'param-' + d.key;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.id = 'param-' + d.key;
      inp.dataset.param = d.key;
      inp.value = d.value; inp.min = d.min; inp.max = d.max;
      if (d.step) inp.step = d.step;
      row.appendChild(lab); row.appendChild(inp);
      box.appendChild(row);
    });
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'The seed makes stochastic runs exactly reproducible.';
    box.appendChild(p);
  }

  function selectAlgorithm(id) {
    if (runState === 'computing') computeCancelled = true;
    currentAlgo = id;
    document.querySelectorAll('input[name="algo"]').forEach(r => { r.checked = r.value === id; });
    buildAlgoParams(id);
    TSP.renderDerivation($('deriv-box'), id);
    disposePlayback();
    clearRunViews();
    lastLogSeq = -2;
    $('log').innerHTML = '';
    setStatus('idle', 'Ready');
    updateStats();
  }

  /* ---------------- complexity explorer ---------------- */
  function initComplexityExplorer() {
    const slider = $('cx-cities');
    const render = () => {
      const n = +slider.value;
      $('cx-n-label').textContent = n;
      const tbl = $('cx-table');
      tbl.innerHTML = '<tr><th>Cities (n)</th><th>Possible tours (n−1)!</th></tr>';
      for (let k = 4; k <= 12; k++) {
        const tr = document.createElement('tr');
        if (k === n) tr.className = 'current';
        const tdN = document.createElement('td'); tdN.textContent = k;
        const tdT = document.createElement('td'); tdT.className = 'num';
        tdT.textContent = TSP.formatCount(TSP.tourCount(k) || { log: TSP.logFactorial(k - 1) });
        tr.appendChild(tdN); tr.appendChild(tdT);
        tbl.appendChild(tr);
      }
      const showMeasured = $('cx-measured').checked ? measuredOverlay : null;
      TSP.drawGrowthChart($('growth-chart'), n, showMeasured);
    };
    slider.addEventListener('input', render);
    $('cx-measured').addEventListener('change', render);
    render();
  }

  /* ---------------- compare tab ---------------- */
  const cmp = { runs: [], masterTimer: null, playbacks: [], problem: null, playing: false };
  const CMP_COLORS = ['#e5484d', '#3fb950', '#4f9cf9', '#d29922', '#b083f0', '#39c5cf', '#f778ba', '#8e8e93'];

  function buildCmpSelect() {
    const box = $('cmp-select');
    box.innerHTML = '';
    TSP.ALGORITHMS.forEach((a, i) => {
      const lab = document.createElement('label');
      lab.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = a.id;
      cb.checked = i < 3;
      lab.appendChild(cb);
      const sp = document.createElement('span');
      sp.innerHTML = ' <b>' + a.name + '</b> <span class="algo-tc">' + a.tc + '</span>';
      lab.appendChild(sp);
      box.appendChild(lab);
    });
  }

  function cmpSelected() {
    return Array.from($('cmp-select').querySelectorAll('input:checked')).map(c => c.value);
  }

  function cloneProblem(src) {
    const p = new TSP.TSPProblem();
    src.cities.forEach(c => p.addCity(c.x, c.y));
    p.cities.forEach((c, i) => { c.label = src.cities[i].label; });
    for (let i = 0; i < p.n; i++)
      for (let j = 0; j < p.n; j++) p.dist[i][j] = src.dist[i][j];
    p._nextId = src._nextId;
    return p;
  }

  async function runComparison() {
    const ids = cmpSelected();
    if (ids.length < 2) { notice('Select at least two algorithms to compare.', 'error'); return; }
    const errors = problem.validate();
    if (errors.length) { notice(errors[0], 'error'); return; }
    if (ids.includes('brute') && problem.n > TSP.LIMITS.MAX_BF_CITIES) {
      if (!window.confirm('Brute Force on ' + problem.n + ' cities is very heavy. Continue?')) return;
    }
    stopCmpPlayback();
    cmp.runs = []; cmp.playbacks = [];
    $('cmp-results').innerHTML = '';
    $('cmp-playback').hidden = true;
    $('btn-cmp-run').disabled = true;
    $('btn-cmp-cancel').disabled = false;
    $('cmp-progress').hidden = false;

    const frozen = cloneProblem(problem);
    cmp.problem = frozen;
    let cancelled = false;
    $('btn-cmp-cancel').onclick = () => { cancelled = true; };
    try {
      for (let k = 0; k < ids.length; k++) {
        if (cancelled) break;
        const id = ids[k];
        $('cmp-status').textContent = TSP.algoMeta(id).name + ' …';
        $('cmp-fill').style.width = (100 * k / ids.length).toFixed(0) + '%';
        const rec = await TSP.recordRun(TSP.createRunner(id, frozen, {}), frozen, {
          isCancelled: () => cancelled,
          onProgress: () => {}
        });
        if (cancelled || rec.cancelled) break;
        cmp.runs.push({ algoId: id, record: rec });
        await new Promise(r => setTimeout(r, 0));
      }
    } finally {
      $('cmp-fill').style.width = '100%';
      $('cmp-status').textContent = cancelled ? 'Cancelled.' : 'Done.';
      $('btn-cmp-run').disabled = false;
      $('btn-cmp-cancel').disabled = true;
      if (cmp.runs.length >= 2 && !cancelled) renderCmpResults();
      else if (!cancelled) notice('Comparison needs at least two completed runs.', 'error');
    }
  }

  function renderCmpResults() {
    const exactCosts = cmp.runs.filter(r => r.record.result.optimal).map(r => r.record.result.bestCost);
    const optimum = exactCosts.length ? Math.min(...exactCosts) : null;

    // results table
    const tbl = document.createElement('table');
    tbl.className = 'cmp-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.appendChild(document.createElement('th'));
    cmp.runs.forEach((r, i) => {
      const th = document.createElement('th');
      th.innerHTML = '<span class="cmp-dot" style="background:' + CMP_COLORS[i % CMP_COLORS.length] + '"></span> ' + TSP.algoMeta(r.algoId).name;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    const rows = [
      ['Kind', r => TSP.algoMeta(r.algoId).kind, v => v],
      ['Final tour cost', r => r.record.result.bestCost, v => TSP.formatInt(v)],
      ['Optimal?', r => r.record.result.optimal, v => v ? 'proven' : 'not proven'],
      ['Relative error vs optimum', r => optimum !== null && r.record.result.bestCost !== null ? (r.record.result.bestCost - optimum) / optimum : null,
        v => v === null ? (optimum === null ? 'no exact optimum' : '–') : (v * 100).toFixed(2) + '%'],
      ['Compute time (excl. animation)', r => r.record.computeMs, v => TSP.formatMs(v)],
      ['Events recorded', r => r.record.totalEvents + (r.record.sampled ? ' (sampled)' : ''), v => v],
      ['States explored', r => r.record.stats.statesExplored, v => TSP.formatInt(v)],
      ['States pruned', r => r.record.stats.statesPruned, v => TSP.formatInt(v)],
      ['Transitions', r => r.record.stats.transitions, v => TSP.formatInt(v)],
      ['First tour at event', r => r.record.firstTourIndex >= 0 ? '#' + (r.record.firstTourIndex + 1) : '–', v => v]
    ];
    rows.forEach(([label, get, fmt]) => {
      const tr = document.createElement('tr');
      const td0 = document.createElement('td'); td0.textContent = label;
      tr.appendChild(td0);
      cmp.runs.forEach(r => {
        const td = document.createElement('td');
        td.textContent = fmt(get(r));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    const res = $('cmp-results');
    res.innerHTML = '';
    res.appendChild(tbl);
    if (optimum !== null) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Exact optimum on this graph: ' + TSP.formatInt(optimum) + ' (established by an exact algorithm in this comparison). Relative error is measured against it — heuristic results are never labeled optimal.';
      res.appendChild(p);
    }

    // mini graph views with final tours
    const views = $('cmp-views');
    views.innerHTML = '';
    cmp.runs.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'panel card cmp-view';
      const h = document.createElement('h3');
      h.innerHTML = '<span class="cmp-dot" style="background:' + CMP_COLORS[i % CMP_COLORS.length] + '"></span> ' +
        TSP.algoMeta(r.algoId).name + ' <span class="hint">best ' + TSP.formatInt(r.record.result.bestCost) + '</span>';
      card.appendChild(h);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 1000 620');
      svg.classList.add('cmp-svg');
      card.appendChild(svg);
      views.appendChild(card);
      const gv = TSP.createGraphView(svg, cmp.problem, { interactive: false });
      gv.render();
      const last = r.record.events[r.record.events.length - 1];
      if (last && last.frame) gv.update(last.frame);
      r.view = gv;
    });

    // synchronized playback: one master timer, lockstep stepping
    $('cmp-playback').hidden = false;
    cmp.playbacks = cmp.runs.map((r, i) => TSP.createPlayback(r.record, {
      onEvent: (ev) => { if (ev.frame && r.view) r.view.update(ev.frame); drawCmpChart(); },
      onState: () => {}
    }));
    drawCmpChart();
    $('cmp-step-label').textContent = '';
  }

  function drawCmpChart() {
    const svg = $('cmp-chart');
    svg.innerHTML = '';
    if (!cmp.runs.length) return;
    const W = 640, H = 260, padL = 56, padR = 14, padT = 14, padB = 30;
    const NS = 'http://www.w3.org/2000/svg';
    const elc = (t, a, p) => {
      const e = document.createElementNS(NS, t);
      for (const k in a) e.setAttribute(k, a[k]);
      if (p) p.appendChild(e);
      return e;
    };
    // best-cost-so-far series per run, sampled to ≤ 300 points
    const series = cmp.playbacks.map((pb, i) => {
      const rec = cmp.runs[i].record;
      const evs = rec.events;
      const step = Math.max(1, Math.floor(evs.length / 300));
      const pts = [];
      let best = Infinity;
      for (let k = 0; k < evs.length; k += step) {
        const fr = evs[k].frame;
        if (fr && fr.bestCost !== null && fr.bestCost !== undefined && fr.bestCost < best) best = fr.bestCost;
        if (best !== Infinity) pts.push({ x: k / Math.max(1, evs.length - 1), y: best });
      }
      // extend to the run's current cursor
      return { pts, color: CMP_COLORS[i % CMP_COLORS.length], name: TSP.algoMeta(cmp.runs[i].algoId).name };
    });
    const allY = series.flatMap(s => s.pts.map(p => p.y));
    if (!allY.length) return;
    const yMin = Math.min(...allY), yMax = Math.max(...allY);
    const span = Math.max(1e-9, yMax - yMin);
    const X = t => padL + t * (W - padL - padR);
    const Y = v => padT + (1 - (v - yMin) / span) * (H - padT - padB);
    [yMin, (yMin + yMax) / 2, yMax].forEach(v => {
      elc('line', { x1: padL, x2: W - padR, y1: Y(v), y2: Y(v), stroke: '#1c2532' }, svg);
      const t = elc('text', { x: padL - 6, y: Y(v) + 4, 'text-anchor': 'end', fill: '#5d6b7e', 'font-size': 10, 'font-family': 'monospace' }, svg);
      t.textContent = Math.round(v);
    });
    const xl = elc('text', { x: (padL + W - padR) / 2, y: H - 6, 'text-anchor': 'middle', fill: '#8b98a9', 'font-size': 11 }, svg);
    xl.textContent = 'event progress (normalized per algorithm)';
    series.forEach(s => {
      if (s.pts.length < 2) return;
      elc('polyline', {
        points: s.pts.map(p => X(p.x).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' '),
        fill: 'none', stroke: s.color, 'stroke-width': 2
      }, svg);
    });
    // legend
    series.forEach((s, i) => {
      const t = elc('text', { x: padL + i * 150, y: 12, fill: s.color, 'font-size': 11, 'font-weight': 700 }, svg);
      t.textContent = '— ' + s.name;
    });
    // current lockstep position marker
    const pos = cmp.playbacks.length && cmp.playbacks[0].length > 1
      ? cmp.playbacks[0].cursor / (cmp.playbacks[0].length - 1) : 0;
    elc('line', { x1: X(pos), x2: X(pos), y1: padT, y2: H - padB, stroke: '#e6edf3', 'stroke-width': 1, 'stroke-dasharray': '4 3' }, svg);
  }

  function cmpTick() {
    let anyAlive = false;
    cmp.playbacks.forEach(pb => {
      if (pb.state !== 'done') {
        pb.stepForward();
        anyAlive = anyAlive || pb.state !== 'done';
      }
    });
    const first = cmp.playbacks[0];
    $('cmp-step-label').textContent = first ? 'step ' + (first.cursor + 1) + ' / ' + first.length + ' (reference: ' + TSP.algoMeta(cmp.runs[0].algoId).name + ')' : '';
    if (!anyAlive) stopCmpPlayback();
  }

  function stopCmpPlayback() {
    if (cmp.masterTimer) { clearInterval(cmp.masterTimer); cmp.masterTimer = null; }
    cmp.playing = false;
  }

  /* ---------------- experiment lab ---------------- */
  const exp = { rows: [], cancelled: false };
  const EXP_COLORS = { brute: '#e5484d', heldkarp: '#3fb950', branchbound: '#4f9cf9', nearest: '#d29922', twoopt: '#b083f0', mst: '#39c5cf', genetic: '#f778ba', annealing: '#8e8e93' };

  function buildExpAlgos() {
    const box = $('exp-algos');
    box.innerHTML = '';
    TSP.ALGORITHMS.forEach((a, i) => {
      const lab = document.createElement('label');
      lab.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = a.id;
      cb.checked = i < 3;
      lab.appendChild(cb);
      const sp = document.createElement('span');
      sp.textContent = ' ' + a.name;
      lab.appendChild(sp);
      box.appendChild(lab);
    });
  }

  function expSelected() {
    return Array.from($('exp-algos').querySelectorAll('input:checked')).map(c => c.value);
  }

  async function runExperiment() {
    const ids = expSelected();
    if (!ids.length) { notice('Select at least one algorithm.', 'error'); return; }
    let start = Math.max(4, Math.min(10, +$('exp-start').value || 4));
    let end = Math.max(4, Math.min(10, +$('exp-end').value || 7));
    if (end < start) { const t = start; start = end; end = t; }
    const trials = Math.max(1, Math.min(20, +$('exp-trials').value || 3));
    const seedBase = Math.max(0, +$('exp-seed').value || 0);
    const structure = $('exp-structure').value;
    if (runState === 'computing') { notice('Wait for the current computation to finish.', 'error'); return; }

    // cost warning for heavy exact runs
    const heavy = ids.includes('brute') && end >= 10 && trials > 2;
    if (heavy && !window.confirm('Brute force at n=10 × ' + trials + ' trials = ' +
      TSP.formatInt(trials * TSP.factorial(9)) + ' tour evaluations. This may take a while. Continue?')) return;

    exp.rows = [];
    exp.cancelled = false;
    $('btn-experiment').disabled = true;
    $('btn-exp-cancel').disabled = false;
    $('btn-exp-csv').disabled = true;
    $('btn-exp-json').disabled = true;
    $('exp-progress').hidden = false;
    $('exp-results').innerHTML = '';
    $('exp-chart').hidden = true;

    const exact = id => ['brute', 'heldkarp', 'branchbound'].includes(id);
    const totalJobs = (end - start + 1) * trials * ids.length;
    let jobs = 0;
    try {
      for (let n = start; n <= end; n++) {
        for (let t = 1; t <= trials; t++) {
          if (exp.cancelled) break;
          const seed = seedBase + t * 7919 + n * 131;
          const p = new TSP.TSPProblem();
          p.generateStructured(n, structure, seed);
          for (const id of ids) {
            if (exp.cancelled) break;
            jobs++;
            $('exp-status').textContent = 'n=' + n + ' trial ' + t + '/' + trials + ' · ' + TSP.algoMeta(id).name;
            $('exp-fill').style.width = (100 * jobs / totalJobs).toFixed(1) + '%';
            if (exact(id) && n > 10) {
              exp.rows.push({ n, trial: t, seed, structure, algo: id, skipped: true });
              continue;
            }
            const r = await TSP.runHeadless(id, p, {});
            exp.rows.push({
              n, trial: t, seed, structure, algo: id,
              statesExplored: r.statesExplored, statesPruned: r.statesPruned,
              transitions: r.transitions, bestCost: r.bestCost,
              optimal: r.optimal, computeMs: r.computeMs
            });
            await new Promise(rr => setTimeout(rr, 0));
          }
        }
        if (exp.cancelled) break;
      }
    } finally {
      $('exp-fill').style.width = '100%';
      $('exp-status').textContent = exp.cancelled ? 'Cancelled.' : 'Done.';
      $('btn-experiment').disabled = false;
      $('btn-exp-cancel').disabled = true;
      if (exp.rows.length && !exp.cancelled) {
        renderExperimentResults(ids);
        $('btn-exp-csv').disabled = false;
        $('btn-exp-json').disabled = false;
      }
    }
  }

  function renderExperimentResults(ids) {
    // aggregate by (n, algo)
    const groups = {};
    exp.rows.forEach(r => {
      if (r.skipped) return;
      const k = r.n + '|' + r.algo;
      (groups[k] = groups[k] || []).push(r);
    });
    const res = $('exp-results');
    res.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.className = 'exp-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Cities</th><th>Algorithm</th><th>Trials</th><th>Avg states</th><th>Avg compute</th><th>Best cost (min/avg/max)</th><th>Optimal runs</th></tr>';
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    const keys = Object.keys(groups).sort((a, b) => {
      const [na, aa] = a.split('|'), [nb, ab] = b.split('|');
      return (+na - +nb) || (aa < ab ? -1 : 1);
    });
    const chartRows = [];
    keys.forEach(k => {
      const [n, algo] = k.split('|');
      const rs = groups[k];
      const avg = f => rs.reduce((s, r) => s + r[f], 0) / rs.length;
      const costs = rs.map(r => r.bestCost);
      const tr = document.createElement('tr');
      [n, TSP.algoMeta(algo).name, rs.length,
        TSP.formatInt(avg('statesExplored')), TSP.formatMs(avg('computeMs')),
        Math.min(...costs) + ' / ' + avg('bestCost').toFixed(1) + ' / ' + Math.max(...costs),
        rs.filter(r => r.optimal).length + '/' + rs.length
      ].forEach(v => {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      const cr = chartRows.find(r => r.n === +n) || (() => { const x = { n: +n }; chartRows.push(x); return x; })();
      cr[algo] = avg('statesExplored');
    });
    tbl.appendChild(tbody);
    res.appendChild(tbl);

    const skipped = exp.rows.filter(r => r.skipped).length;
    if (skipped) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = skipped + ' exact runs skipped (n > 10 cap).';
      res.appendChild(p);
    }

    // chart: avg states per (n, algo), log y
    const series = ids.filter(id => keys.some(k => k.endsWith('|' + id)))
      .map(id => ({ key: id, color: EXP_COLORS[id] || '#fff', name: TSP.algoMeta(id).name }));
    const chart = $('exp-chart');
    chart.hidden = false;
    TSP.drawExperimentChart(chart, chartRows.sort((a, b) => a.n - b.n), series);

    // feed the growth-chart overlay with measured averages
    measuredOverlay = {};
    keys.forEach(k => {
      const [n, algo] = k.split('|');
      const rs = groups[k];
      const avgStates = rs.reduce((s, r) => s + r.statesExplored, 0) / rs.length;
      (measuredOverlay[algo] = measuredOverlay[algo] || []).push({ n: +n, v: avgStates });
    });
    initComplexityExplorer();
    notice('Experiment complete — measured curves overlaid on the growth chart.', 'ok');
  }

  /* ---------------- learn mode ---------------- */
  const lesson = { idx: -1, step: 0, answers: {} };

  function initLearn() {
    TSP.renderLessonList($('lesson-list'), {
      onOpenLesson: openLesson,
      onLaunchDemo: (demo) => {
        // load the demo preset + algorithm, then switch to the graph
        if (demo.preset) {
          pushUndo('learn demo');
          problem.loadPreset(demo.preset);
          onProblemMutated('', true);
        }
        selectAlgorithm(demo.algo);
        notice('Demo ready: ' + TSP.algoMeta(demo.algo).name + ' on ' + problem.n + ' cities. Press ▶ Run. ' + (demo.note || ''), 'ok');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    $('lesson-back').addEventListener('click', () => {
      $('lesson-view').hidden = true;
      $('lesson-list').hidden = false;
      lesson.idx = -1;
    });
    $('lesson-prev').addEventListener('click', () => { if (lesson.step > 0) { lesson.step--; renderLessonStep(); } });
    $('lesson-next').addEventListener('click', () => {
      const L = TSP.LESSONS[lesson.idx];
      if (lesson.step < L.steps.length) { lesson.step++; renderLessonStep(); }
    });
    $('lesson-restart').addEventListener('click', () => {
      lesson.step = 0; lesson.answers = {};
      renderLessonStep();
    });
  }

  function openLesson(idx) {
    lesson.idx = idx; lesson.step = 0; lesson.answers = {};
    $('lesson-list').hidden = true;
    $('lesson-view').hidden = false;
    const L = TSP.LESSONS[idx];
    $('lesson-title').textContent = L.title;
    $('lesson-goal').textContent = L.goal;
    renderLessonStep();
  }

  function renderLessonStep() {
    const L = TSP.LESSONS[lesson.idx];
    const box = $('lesson-steps');
    box.innerHTML = '';
    const inQuiz = lesson.step >= L.steps.length;
    // show steps up to current
    L.steps.slice(0, Math.min(lesson.step + (inQuiz ? 99 : 1), L.steps.length)).forEach((s, i) => {
      if (!inQuiz && i > lesson.step) return;
      const div = document.createElement('div');
      div.className = 'lesson-step' + (i === lesson.step && !inQuiz ? ' current' : '');
      div.innerHTML = '<span class="lesson-step-n">Step ' + (i + 1) + '</span>' + s.html;
      box.appendChild(div);
    });
    $('lesson-prev').disabled = lesson.step === 0;
    $('lesson-next').disabled = inQuiz;
    $('lesson-next').textContent = lesson.step === L.steps.length - 1 ? 'Checkpoints →' : 'Next →';
    renderLessonQuiz(inQuiz);
  }

  function renderLessonQuiz(show) {
    const box = $('lesson-quiz');
    box.innerHTML = '';
    if (!show) return;
    const L = TSP.LESSONS[lesson.idx];
    const h = document.createElement('h3');
    h.textContent = 'Checkpoints — predict, then check';
    box.appendChild(h);
    L.quiz.forEach((q, qi) => {
      const card = document.createElement('div');
      card.className = 'quiz-card';
      const p = document.createElement('p');
      p.innerHTML = '<b>Q' + (qi + 1) + '.</b> ' + q.q;
      card.appendChild(p);
      const answered = lesson.answers[qi];
      q.options.forEach((opt, oi) => {
        const b = document.createElement('button');
        b.className = 'btn btn-small quiz-opt' +
          (answered !== undefined ? (oi === q.answer ? ' quiz-correct' : (oi === answered ? ' quiz-wrong' : '')) : '');
        b.textContent = opt;
        b.disabled = answered !== undefined;
        b.addEventListener('click', () => {
          lesson.answers[qi] = oi;
          renderLessonQuiz(true);
        });
        card.appendChild(b);
      });
      if (answered !== undefined) {
        const why = document.createElement('p');
        why.className = 'hint ' + (answered === q.answer ? 'ok-text' : 'err-text');
        why.textContent = (answered === q.answer ? 'Correct. ' : 'Not quite. ') + q.why;
        card.appendChild(why);
      }
      box.appendChild(card);
    });
  }

  /* ---------------- report ---------------- */
  function updateReportPanel() {
    const box = $('report-summary');
    if (!record || !record.result) {
      box.innerHTML = '<p class="hint">Run an algorithm first — the report reflects the latest completed run.</p>';
      ['btn-report-json', 'btn-report-csv-events', 'btn-report-html'].forEach(id => $(id).disabled = true);
      return;
    }
    const meta = TSP.algoMeta(record.runnerId);
    const r = record.result;
    box.innerHTML =
      '<table class="kv">' +
      '<tr><td>Algorithm</td><td class="mono">' + meta.name + ' (' + meta.kind + ')</td></tr>' +
      '<tr><td>Parameters</td><td class="mono">' + JSON.stringify(currentParams) + '</td></tr>' +
      '<tr><td>Best tour</td><td class="mono">' + (r.bestPath ? r.bestPath.map(i => problem.cities[i].label).join(' → ') : '—') + ' = ' + r.bestCost + '</td></tr>' +
      '<tr><td>Optimality</td><td class="mono">' + (r.optimal ? 'proven optimal' : 'not proven') + '</td></tr>' +
      '<tr><td>Validation</td><td class="mono">' + (validation ? (validation.ok ? '✓ valid' : '✕ ' + validation.errors.join('; ')) : '—') + '</td></tr>' +
      '<tr><td>Compute time</td><td class="mono">' + TSP.formatMs(record.computeMs) + ' (' + TSP.formatInt(record.totalEvents) + ' events)</td></tr>' +
      '</table>';
    ['btn-report-json', 'btn-report-csv-events', 'btn-report-html'].forEach(id => $(id).disabled = false);
  }

  function currentReport() {
    return TSP.buildReport(problem, record.runnerId, currentParams, record, validation);
  }

  /* ---------------- tabs ---------------- */
  function initTabs() {
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        $('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  /* ---------------- keyboard ---------------- */
  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.code === 'Space') {
        if (!playback) return;
        e.preventDefault();
        playback.toggle();
      } else if (e.key === 'ArrowRight') {
        if (playback && !$('btn-step').disabled) { e.preventDefault(); playback.stepForward(); }
      } else if (e.key === 'ArrowLeft') {
        if (playback && !$('btn-step-back').disabled) { e.preventDefault(); playback.stepBackward(); }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); doUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault(); doRedo();
      }
    });
  }

  /* ---------------- boot ---------------- */
  function init() {
    graphView = TSP.createGraphView($('graph'), problem, {
      onCityMoved: () => {
        if ($('toggle-euclid').checked) {
          problem.recalcEuclidean();
          graphView.refreshEdges();
          renderMatrix();
        }
        onProblemMutated('', true);
      },
      onDragStart: () => pushUndo('move city')
    });
    treeView = TSP.createTreeView($('tree-svg'), $('tree-detail'), {
      onShowOnGraph: (idx) => { if (playback) playback.jumpTo(idx); }
    });
    dpView = TSP.createDPView($('dp-box'));

    $('graph').addEventListener('dblclick', (evt) => {
      if (evt.target.closest('.city-node')) return;
      try {
        const p = graphView.toNormalized(evt.clientX, evt.clientY);
        pushUndo('add city');
        problem.addCity(p.x, p.y);
        if ($('toggle-euclid').checked) problem.recalcEuclidean();
        onProblemMutated('City added.', true);
      } catch (e) { undoStack.pop(); notice(e.message, 'error'); }
    });

    $('btn-zoom-in').addEventListener('click', () => graphView.zoomIn());
    $('btn-zoom-out').addEventListener('click', () => graphView.zoomOut());
    $('btn-zoom-reset').addEventListener('click', () => graphView.resetView());
    $('btn-fullscreen').addEventListener('click', () => {
      const panel = document.querySelector('.graph-panel');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (panel.requestFullscreen) panel.requestFullscreen();
    });

    $('btn-add-city').addEventListener('click', addCity);
    $('btn-remove-city').addEventListener('click', removeSelectedCity);
    $('btn-rename-city').addEventListener('click', renameSelectedCity);
    $('btn-clear-cities').addEventListener('click', () => {
      pushUndo('clear cities');
      problem.clear();
      onProblemMutated('All cities cleared.', true);
    });
    $('btn-undo').addEventListener('click', doUndo);
    $('btn-redo').addEventListener('click', doRedo);
    $('btn-random').addEventListener('click', generateRandom);
    $('btn-preset').addEventListener('click', loadPreset);
    $('btn-export-graph').addEventListener('click', exportGraph);
    $('btn-import-graph').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (e) => {
      if (e.target.files[0]) importGraph(e.target.files[0]);
      e.target.value = '';
    });

    $('toggle-labels').addEventListener('change', e => graphView.setShowLabels(e.target.checked));

    $('btn-run').addEventListener('click', onRun);
    $('btn-run-side').addEventListener('click', onRun);
    $('btn-pause').addEventListener('click', () => { if (playback) playback.pause(); });
    $('btn-step').addEventListener('click', () => { if (playback) playback.stepForward(); });
    $('btn-step-back').addEventListener('click', () => { if (playback) playback.stepBackward(); });
    $('btn-jump-end').addEventListener('click', () => { if (playback) playback.jumpToEnd(); });
    $('btn-skip').addEventListener('click', () => { if (playback) playback.skipToResult(); });
    $('btn-reset-algo').addEventListener('click', () => {
      disposePlayback();
      clearRunViews();
      lastLogSeq = -2;
      $('log').innerHTML = '';
      $('log-count').textContent = '';
      resetTimeline();
      setStatus('idle', 'Ready');
      updateReportPanel();
    });
    $('btn-reset-problem').addEventListener('click', () => {
      pushUndo('reset problem');
      disposePlayback();
      problem.clear();
      clearRunViews();
      $('log').innerHTML = ''; lastLogSeq = -2;
      resetTimeline();
      renderAll();
      setStatus('idle', 'Ready');
      updateReportPanel();
      notice('Problem cleared.', '');
    });
    $('btn-reset-all').addEventListener('click', () => {
      pushUndo('reset everything');
      disposePlayback();
      problem.clear();
      undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
      clearRunViews();
      $('log').innerHTML = ''; lastLogSeq = -2;
      resetTimeline();
      measuredOverlay = {};
      renderAll();
      initComplexityExplorer();
      setStatus('idle', 'Ready');
      updateReportPanel();
      notice('Everything reset.', 'ok');
    });
    $('btn-clear-log').addEventListener('click', () => { $('log').innerHTML = ''; $('log-count').textContent = ''; });
    $('btn-cancel-compute').addEventListener('click', onCancelCompute);

    // left-sidebar intel panels: collapsible (smooth max-height accordion)
    document.querySelectorAll('.intel-head').forEach(btn => {
      btn.addEventListener('click', () => {
        const body = document.getElementById(btn.dataset.target);
        const open = btn.getAttribute('aria-expanded') !== 'false';
        btn.setAttribute('aria-expanded', String(!open));
        if (body) body.classList.toggle('collapsed', open);
      });
    });
    $('btn-pseudo-expand').addEventListener('click', () => {
      const box = $('pseudo-side-box');
      const expanded = box.classList.toggle('expanded');
      $('btn-pseudo-expand').textContent = expanded ? '⤡ Collapse' : '⤢ Expand';
    });

    $('speed').addEventListener('input', () => {
      const ms = SPEEDS[+$('speed').value];
      $('speed-label').textContent = speedLabel(ms);
      if (playback) playback.setIntervalMs(ms);
    });
    $('speed-label').textContent = speedLabel(SPEEDS[+$('speed').value]);

    // compare
    buildCmpSelect();
    $('btn-cmp-run').addEventListener('click', runComparison);
    $('cmp-play').addEventListener('click', () => {
      if (cmp.playing) return;
      stopCmpPlayback();
      cmp.playing = true;
      cmp.masterTimer = setInterval(cmpTick, 700);
    });
    $('cmp-pause').addEventListener('click', stopCmpPlayback);
    $('cmp-step').addEventListener('click', () => { stopCmpPlayback(); cmpTick(); });

    // experiment
    buildExpAlgos();
    $('btn-experiment').addEventListener('click', runExperiment);
    $('btn-exp-cancel').addEventListener('click', () => { exp.cancelled = true; });
    $('btn-exp-csv').addEventListener('click', () => TSP.exportExperimentCSV(exp.rows));
    $('btn-exp-json').addEventListener('click', () => TSP.download(
      'tsp-experiment.json', 'application/json',
      JSON.stringify({
        config: {
          structure: $('exp-structure').value,
          from: $('exp-start').value, to: $('exp-end').value,
          trials: $('exp-trials').value, seed: $('exp-seed').value
        },
        rows: exp.rows
      }, null, 2)));

    // report
    $('btn-report-json').addEventListener('click', () => TSP.exportJSON(currentReport()));
    $('btn-report-csv-events').addEventListener('click', () => TSP.exportEventsCSV(problem, record));
    $('btn-report-html').addEventListener('click', () => {
      if (!TSP.exportHTMLReport(currentReport(), $('report-observations').value.trim())) {
        notice('Pop-up blocked — allow pop-ups to open the printable report.', 'error');
      }
    });

    $('tree-expand-all').addEventListener('click', () => treeView.expandAll());
    $('tree-collapse-all').addEventListener('click', () => treeView.collapseAll());

    initTabs();
    initKeyboard();
    initLearn();
    buildAlgoOptions();
    buildAlgoParams(currentAlgo);
    TSP.renderDerivation($('deriv-box'), currentAlgo);
    initComplexityExplorer();
    updateUndoButtons();
    updateReportPanel();

    problem.loadPreset('preset6');
    renderAll();
    setStatus('idle', 'Ready');
    renderPseudoEvent(currentAlgo, null);
    TSP.resetIntel(problem, currentAlgo);
    $('pseudo-algo-name').textContent = '· ' + TSP.algoMeta(currentAlgo).name;
    const welcome = document.createElement('div');
    welcome.className = 'log-entry';
    welcome.innerHTML = '<span class="lg-step">○</span> Welcome to the TSP laboratory. Pick an algorithm, press ▶ Run — computation runs first, then playback steps through every decision at 1.5 s/step. Step with ⏭/⏪, or ⤓ Skip to the result.';
    $('log').appendChild(welcome);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
