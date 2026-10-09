/* ============================================================
   app.js — UI wiring for the TSP Visualizer
   ------------------------------------------------------------
   Owns: controls, transport (run/pause/step), the run loop,
   stats + log panels, distance-matrix editor, presets,
   complexity explorer, comparison table, experiment mode,
   and all reset behavior.
   ============================================================ */
(function () {
  'use strict';
  const TSP = window.TSP;
  const $ = id => document.getElementById(id);

  /* ---------------- state ---------------- */
  const problem = new TSP.TSPProblem();
  let graphView = null;
  let runner = null;
  let runState = 'idle';          // idle | running | paused | done
  let runTimer = null;
  let runStartTime = 0;
  let eventCount = 0;
  const measured = { brute: null, heldkarp: null, branchbound: null }; // for the comparison tab
  let expCancelled = false;

  const ALGO_LABEL = { brute: 'Brute Force', heldkarp: 'Held–Karp', branchbound: 'Branch & Bound' };

  /* ---------------- helpers ---------------- */
  function setStatus(state, text) {
    runState = state;
    $('status-dot').className = 'dot ' + (state === 'running' ? 'running' : state === 'paused' ? 'paused' : state === 'done' ? 'done' : '');
    $('status-text').textContent = text;
    $('btn-run').disabled = state === 'running';
    $('btn-pause').disabled = state !== 'running';
    $('btn-step').disabled = state === 'running';
  }

  function notice(msg, type) {
    const n = $('notice');
    n.hidden = false;
    n.textContent = msg;
    n.className = 'notice' + (type ? ' ' + type : '');
    clearTimeout(notice._t);
    notice._t = setTimeout(() => { n.hidden = true; }, 6000);
  }

  function selectedAlgo() {
    return document.querySelector('input[name="algo"]:checked').value;
  }

  /* ---------------- log panel ---------------- */
  const LOG_ICONS = {
    start: ['lg-step', '○'], eval: ['lg-arrow', '→'], best: ['lg-star', '★'],
    prune: ['lg-prune', '✕'], dp: ['lg-arrow', '→'], bound: ['lg-arrow', '→'],
    reconstruct: ['lg-ok', '←'], done: ['lg-ok', '✓']
  };
  function logEvent(ev, force) {
    if (!ev) return;
    const fast = isFastMode();
    // during fast animated runs, skip routine per-step events so the DOM stays light
    if (fast && !force && (ev.kind === 'eval' || ev.kind === 'dp' || ev.kind === 'bound' || ev.kind === 'reconstruct')) return;
    eventCount++;
    const [cls, icon] = LOG_ICONS[ev.kind] || ['lg-step', '·'];
    const box = $('log');
    box.querySelectorAll('.log-entry.latest').forEach(e => e.classList.remove('latest'));
    const div = document.createElement('div');
    div.className = 'log-entry latest';
    const step = document.createElement('span');
    step.className = 'lg-step';
    step.textContent = '#' + eventCount + ' ';
    const ic = document.createElement('span');
    ic.className = cls;
    ic.textContent = icon + ' ';
    div.appendChild(step); div.appendChild(ic);
    div.appendChild(document.createTextNode(ev.text));
    box.appendChild(div);
    while (box.children.length > 600) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- statistics ---------------- */
  function updateStats() {
    $('st-cities').textContent = problem.n;
    if (!runner) {
      ['st-best', 'st-current', 'st-explored', 'st-pruned', 'st-prunerate', 'st-time', 'st-route']
        .forEach(id => { $(id).textContent = '–'; });
      return;
    }
    const v = runner.getVisual();
    $('st-best').textContent = runner.bestCost === null ? '–' : TSP.formatInt(runner.bestCost);
    $('st-current').textContent = (v.currentCost === null || v.currentCost === undefined) ? '–' : TSP.formatInt(v.currentCost);
    $('st-explored').textContent = TSP.formatInt(runner.stats.statesExplored);
    const canPrune = runner.id === 'branchbound';
    $('st-pruned').textContent = canPrune ? TSP.formatInt(runner.stats.statesPruned) : 'N/A';
    if (canPrune) {
      const total = runner.stats.statesExplored + runner.stats.statesPruned;
      $('st-prunerate').textContent = total ? (100 * runner.stats.statesPruned / total).toFixed(1) + '%' : '–';
    } else {
      $('st-prunerate').textContent = 'N/A';
    }
    const elapsed = runStartTime ? (performance.now() - runStartTime) : 0;
    $('st-time').textContent = runState === 'idle' ? '–' : TSP.formatMs(runState === 'done' ? runner._finalMs || elapsed : elapsed);
    $('st-route').textContent = runner.bestPath ? runner.bestPath.map(i => problem.cities[i].label).join(' → ') : '–';
  }

  /* ---------------- graph + matrix rendering ---------------- */
  function renderAll() {
    graphView.render();
    renderMatrix();
    updateStats();
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
        if (i === j) {
          td.className = 'diag'; td.textContent = '—';
        } else {
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
    td.classList.remove('invalid');
    problem.setDistance(i, j, v);
    renderMatrix();          // refresh the mirrored symmetric cell
    graphView.refreshEdges();
    resetAlgorithmState(true); // distances changed → previous run is stale
  }

  /* ---------------- run control ---------------- */
  function stopLoop() {
    if (runTimer !== null) { clearTimeout(runTimer); runTimer = null; }
  }

  function isFastMode() {
    return runState === 'running' && +$('speed').value >= 6;
  }

  function prepareRun() {
    const errors = problem.validate();
    if (errors.length) { notice(errors[0], 'error'); return null; }
    const algoId = selectedAlgo();
    if (algoId === 'brute' && problem.n > TSP.LIMITS.MAX_BF_CITIES) {
      if (!window.confirm('Brute Force on ' + problem.n + ' cities = ' + TSP.formatCount(TSP.tourCount(problem.n) || { log: TSP.logFactorial(problem.n - 1) }) + ' tours. This may take a while. Continue?')) {
        return null;
      }
    }
    stopLoop();
    runner = TSP.createRunner(algoId, problem);
    eventCount = 0;
    $('log').innerHTML = '';
    logEvent(runner._intro, true);
    runStartTime = performance.now();
    runner._finalMs = 0;
    setStatus('running', 'Running · ' + ALGO_LABEL[algoId]);
    return runner;
  }

  function tick() {
    runTimer = null;
    if (!runner || runState !== 'running') return;
    const speed = +$('speed').value;
    const batch = speed >= 9 ? 4000 : speed >= 7 ? 800 : speed >= 5 ? 120 : speed >= 3 ? 24 : 6;
    let guard = 0;
    while (guard++ < batch && !runner.done) {
      const ev = runner.step();
      logEvent(ev);
      if (ev && ev.kind === 'done') break;
    }
    graphView.update(runner.getVisual());
    updateStats();
    if (runner.done) {
      runner._finalMs = performance.now() - runStartTime;
      setStatus('done', 'Completed');
      measured[runner.id] = {
        states: runner.stats.statesExplored,
        pruned: runner.stats.statesPruned,
        time: runner._finalMs,
        best: runner.bestCost
      };
      updateComparison();
      updateStats();
      notice(ALGO_LABEL[runner.id] + ' finished — best distance ' + TSP.formatInt(runner.bestCost) + '.', 'ok');
    } else {
      const delay = speed >= 7 ? 0 : 130 - speed * 12;
      runTimer = setTimeout(tick, Math.max(0, delay));
    }
  }

  function onRun() {
    if (runState === 'paused' && runner) {
      setStatus('running', 'Running · ' + ALGO_LABEL[runner.id]);
      runStartTime = performance.now() - (runner._elapsedBeforePause || 0);
      tick();
      return;
    }
    if (prepareRun()) tick();
  }

  function onPause() {
    if (runState !== 'running') return;
    stopLoop();
    runner._elapsedBeforePause = performance.now() - runStartTime;
    setStatus('paused', 'Paused');
  }

  function onStep() {
    if (runState === 'running') return;
    if (!runner) {
      const errors = problem.validate();
      if (errors.length) { notice(errors[0], 'error'); return; }
      runner = TSP.createRunner(selectedAlgo(), problem);
      eventCount = 0;
      $('log').innerHTML = '';
      logEvent(runner._intro, true);
      runStartTime = performance.now();
      setStatus('paused', 'Paused · ' + ALGO_LABEL[runner.id]);
    }
    const ev = runner.step();
    logEvent(ev, true);
    graphView.update(runner.getVisual());
    if (runner.done) {
      runner._finalMs = performance.now() - runStartTime;
      setStatus('done', 'Completed');
      measured[runner.id] = {
        states: runner.stats.statesExplored,
        pruned: runner.stats.statesPruned,
        time: runner._finalMs,
        best: runner.bestCost
      };
      updateComparison();
    }
    updateStats();
  }

  /** Clear algorithm state; `silent` keeps the log (used when the problem changes mid-analysis). */
  function resetAlgorithmState(silent) {
    stopLoop();
    runner = null;
    runStartTime = 0;
    graphView.update(null);
    setStatus('idle', 'Ready');
    if (!silent) { $('log').innerHTML = ''; eventCount = 0; }
    updateStats();
  }

  function resetProblem() {
    resetAlgorithmState();
    problem.clear();
    renderAll();
    notice('Problem cleared. Add cities or load a preset to begin.', '');
  }

  function resetAll() {
    resetAlgorithmState();
    problem.clear();
    $('log').innerHTML = ''; eventCount = 0;
    measured.brute = measured.heldkarp = measured.branchbound = null;
    updateComparison();
    renderAll();
    initComplexityExplorer();
    notice('Everything reset.', 'ok');
  }

  /* ---------------- comparison tab ---------------- */
  function updateComparison() {
    const cells = {
      brute: ['cmp-bf-states', 'cmp-bf-time', 'cmp-bf-best'],
      heldkarp: ['cmp-hk-states', 'cmp-hk-time', 'cmp-bh-best'],
      branchbound: ['cmp-bb-states', 'cmp-bb-time', 'cmp-bb-best']
    };
    for (const id in cells) {
      const m = measured[id];
      $(cells[id][0]).textContent = m ? TSP.formatInt(m.states) : '–';
      $(cells[id][1]).textContent = m ? TSP.formatMs(m.time) : '–';
      $(cells[id][2]).textContent = m ? TSP.formatInt(m.best) : '–';
    }
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
      TSP.drawGrowthChart($('growth-chart'), n);
    };
    slider.addEventListener('input', render);
    render();
  }

  /* ---------------- experiment mode ---------------- */
  async function runExperiment() {
    let start = Math.max(4, Math.min(10, +$('exp-start').value || 4));
    let end = Math.max(4, Math.min(10, +$('exp-end').value || 8));
    if (end < start) { const t = start; start = end; end = t; }
    if (runState === 'running') { notice('Stop the current algorithm run first.', 'error'); return; }

    expCancelled = false;
    $('btn-experiment').disabled = true;
    $('btn-exp-cancel').disabled = false;
    $('exp-progress').hidden = false;
    $('exp-table').hidden = false;
    $('exp-chart').hidden = true;
    $('exp-body').innerHTML = '';

    const rows = [];
    const total = end - start + 1;
    try {
      for (let n = start; n <= end; n++) {
        if (expCancelled) break;
        $('exp-status').textContent = 'n = ' + n + ' …';
        $('exp-fill').style.width = ((n - start) / total * 100).toFixed(0) + '%';
        const p = new TSP.TSPProblem();
        p.randomize(n, 1000 + n); // deterministic instances
        const rB = await TSP.runHeadless('brute', p);
        if (expCancelled) break;
        const rH = await TSP.runHeadless('heldkarp', p);
        if (expCancelled) break;
        const rBB = await TSP.runHeadless('branchbound', p);
        const row = { n, brute: rB.statesExplored, heldkarp: rH.statesExplored, bb: rBB.statesExplored, bbPruned: rBB.statesPruned };
        rows.push(row);
        appendExperimentRow(row);
        await new Promise(r => setTimeout(r, 0));
      }
    } finally {
      $('exp-fill').style.width = '100%';
      $('exp-status').textContent = expCancelled ? 'Cancelled.' : 'Done.';
      $('btn-experiment').disabled = false;
      $('btn-exp-cancel').disabled = true;
      if (rows.length) {
        $('exp-chart').hidden = false;
        TSP.drawExperimentChart($('exp-chart'), rows);
      }
    }
  }

  function appendExperimentRow(row) {
    const tr = document.createElement('tr');
    [row.n, TSP.formatInt(row.brute), TSP.formatInt(row.heldkarp), TSP.formatInt(row.bb), TSP.formatInt(row.bbPruned)]
      .forEach(v => {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      });
    $('exp-body').appendChild(tr);
  }

  /* ---------------- presets & city controls ---------------- */
  function loadPreset() {
    const sel = $('preset-select').value;
    if (!sel) { notice('Choose a preset first.', 'error'); return; }
    resetAlgorithmState();
    problem.loadPreset(sel);
    renderAll();
    notice('Preset loaded: ' + sel + ' (' + problem.n + ' cities).', 'ok');
  }

  function addCity() {
    try {
      problem.addCity();
      if ($('toggle-euclid').checked) problem.recalcEuclidean();
      resetAlgorithmState(true);
      renderAll();
    } catch (e) { notice(e.message, 'error'); }
  }

  function generateRandom() {
    const n = Math.max(3, Math.min(12, +$('random-count').value || 6));
    resetAlgorithmState();
    problem.randomize(Math.min(n, TSP.LIMITS.MAX_ANIMATED_CITIES));
    renderAll();
    notice('Generated ' + problem.n + ' random cities.', 'ok');
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

  /* ---------------- boot ---------------- */
  function init() {
    graphView = TSP.createGraphView($('graph'), problem, {
      onCityMoved: () => {
        if ($('toggle-euclid').checked) {
          problem.recalcEuclidean();
          graphView.refreshEdges();
          renderMatrix();
        }
        if (runner && runState !== 'idle') resetAlgorithmState(true);
      }
    });

    // double-click empty graph space to add a city there
    $('graph').addEventListener('dblclick', (evt) => {
      if (evt.target.closest('.city-node')) return;
      try {
        const p = graphView.toNormalized(evt.clientX, evt.clientY);
        problem.addCity(p.x, p.y);
        if ($('toggle-euclid').checked) problem.recalcEuclidean();
        resetAlgorithmState(true);
        renderAll();
      } catch (e) { notice(e.message, 'error'); }
    });

    $('btn-add-city').addEventListener('click', addCity);
    $('btn-clear-cities').addEventListener('click', () => { resetAlgorithmState(); problem.clear(); renderAll(); });
    $('btn-random').addEventListener('click', generateRandom);
    $('btn-preset').addEventListener('click', loadPreset);

    $('toggle-labels').addEventListener('change', e => graphView.setShowLabels(e.target.checked));

    $('btn-run').addEventListener('click', onRun);
    $('btn-pause').addEventListener('click', onPause);
    $('btn-step').addEventListener('click', onStep);
    $('btn-reset-algo').addEventListener('click', () => resetAlgorithmState());
    $('btn-reset-problem').addEventListener('click', resetProblem);
    $('btn-reset-all').addEventListener('click', resetAll);
    $('btn-clear-log').addEventListener('click', () => { $('log').innerHTML = ''; eventCount = 0; });

    document.querySelectorAll('input[name="algo"]').forEach(r =>
      r.addEventListener('change', () => resetAlgorithmState()));

    $('btn-experiment').addEventListener('click', runExperiment);
    $('btn-exp-cancel').addEventListener('click', () => { expCancelled = true; });

    initTabs();
    initComplexityExplorer();
    updateComparison();

    // start with a sensible demo instance
    problem.loadPreset('preset6');
    renderAll();
    setStatus('idle', 'Ready');
    const welcome = document.createElement('div');
    welcome.className = 'log-entry';
    welcome.innerHTML = '<span class="lg-step">○</span> Welcome to the TSP laboratory. Load a preset, pick an algorithm, and press ▶ Run — or step through it with ⏭ Step.';
    $('log').appendChild(welcome);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
