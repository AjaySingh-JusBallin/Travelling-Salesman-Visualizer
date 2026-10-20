/* Live-intel panel tests: pure helpers must derive everything from real
   event data — never hardcode values. */
'use strict';
const { loadTSP, ok, eq } = require('./shim');
const TSP = loadTSP();

function fourCity() {
  const p = new TSP.TSPProblem();
  for (let i = 0; i < 4; i++) p.addCity(0.2 + i * 0.15, 0.5);
  const D = [[0, 10, 15, 20], [10, 0, 35, 25], [15, 35, 0, 30], [20, 25, 30, 0]];
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) p.setDistance(i, j, D[i][j]);
  return p;
}

async function recordAll(algoId, problem, params) {
  const runner = TSP.createRunner(algoId, problem, params || {});
  const rec = await TSP.recordRun(runner, problem, {});
  return { runner, rec };
}

async function main() {
  console.log('--- live intel panels ---');
  const p = fourCity();

  // A. operation names cover the whole vocabulary
  for (const k of TSP.EVENT_KINDS) {
    const name = TSP.opNameFor(k);
    ok(typeof name === 'string' && name.length > 2 && name !== k,
      'opNameFor(' + k + ') is human-readable');
  }

  // A. decision classification from real event shapes
  eq(TSP.decisionFor({ kind: 'STATE_PRUNED', data: {} }).label, 'pruned', 'decision: pruned');
  eq(TSP.decisionFor({ kind: 'BEST_TOUR_UPDATED', data: {} }).cls, 'dec-accepted', 'decision: accepted best');
  eq(TSP.decisionFor({ kind: 'TOUR_COMPLETED', data: { improved: false, cost: 90, best: 80 } }).label,
    'rejected · no improvement', 'decision: rejected tour');
  eq(TSP.decisionFor({ kind: 'TOUR_COMPLETED', data: { improved: true } }).cls,
    'dec-accepted', 'decision: improved tour accepted');
  eq(TSP.decisionFor({ kind: 'DP_STATE_UPDATED', data: { accepted: false } }).label,
    'rejected', 'decision: d.accepted=false');
  eq(TSP.decisionFor({ kind: 'EDGE_CONSIDERED', data: {} }).label,
    'evaluating', 'decision: neutral step is evaluating');

  // A. explanations are composed from the event's own data
  {
    const ev = { kind: 'STATE_PRUNED', data: { path: [0, 2], bound: 95, best: 80 } };
    const t = TSP.explainFor(p, ev);
    ok(t.includes('95') && t.includes('80'), 'explainFor prune uses bound + best numbers');
    const ev2 = { kind: 'EDGE_CONSIDERED', data: { edge: [1, 3], w: 25 } };
    const t2 = TSP.explainFor(p, ev2);
    ok(t2.includes('B') && t2.includes('D') && t2.includes('25'), 'explainFor edge uses labels + weight');
    const ev3 = { kind: 'BEST_TOUR_UPDATED', data: { path: [0, 1, 3, 2], cost: 80, prevBest: 95 } };
    ok(TSP.explainFor(p, ev3).includes('80'), 'explainFor best uses cost');
  }

  // describeEvent + explainFor + liveMathHTML must never throw, on any
  // event of any algorithm (regression: PARTIAL_ROUTE_UPDATED with
  // path:null used to crash the log at the tail of HK/MST runs)
  {
    for (const a of TSP.ALGORITHMS) {
      const pr = new TSP.TSPProblem(); pr.loadPreset('preset6');
      const params = a.id === 'genetic' ? { generations: 5, populationSize: 8, seed: 3 }
        : a.id === 'annealing' ? { iterations: 30, seed: 3 } : {};
      const runner = TSP.createRunner(a.id, pr, params);
      const rec = await TSP.recordRun(runner, pr, {});
      let crashes = 0;
      for (const ev of rec.events) {
        try {
          TSP.describeEvent(pr, ev);
          TSP.explainFor(pr, ev);
          TSP.liveMathHTML(pr, a.id, ev, { counts: {} });
          TSP.pseudoVarRows(pr, ev);
        } catch (e) { crashes++; }
      }
      eq(crashes, 0, a.id + ': no intel/describe crash on ' + rec.events.length + ' events');
    }
  }

  // D. variable rows extracted from event data
  {
    const ev = { kind: 'DP_STATE_UPDATED', data: { mask: 11, city: 2, value: 45, via: 1 } };
    const rows = TSP.pseudoVarRows(p, ev);
    const keys = rows.map(r => r[0]);
    ok(keys.includes('subset') && keys.includes('dp value') && keys.includes('via'),
      'pseudoVarRows extracts dp variables');
    eq(TSP.pseudoVarRows(p, null).length, 0, 'pseudoVarRows handles null event');
  }

  // B. live math renders for every algorithm, with and without an event
  for (const a of TSP.ALGORITHMS) {
    const html = TSP.liveMathHTML(p, a.id, null, {});
    ok(html.includes(a.tc.replace(/<[^>]*>/g, '')) || html.includes('Time'),
      'liveMathHTML(' + a.id + ') shows complexity header');
    ok(!/undefined|NaN/.test(html), 'liveMathHTML(' + a.id + ') has no undefined/NaN');
  }
  // B. live values are plugged into formulas from real events
  {
    const { rec } = await recordAll('branchbound', p);
    const prune = rec.events.find(e => e.kind === 'STATE_PRUNED');
    ok(!!prune, 'branchbound produced a prune event on 4-city');
    const html = TSP.liveMathHTML(p, 'branchbound', prune, { counts: { STATE_PRUNED: 1 } });
    ok(html.includes(String(prune.data.bound)) && html.includes(String(prune.data.best)),
      'liveMathHTML(branchbound) shows live LB vs incumbent');
  }
  {
    const { rec } = await recordAll('heldkarp', p);
    const dp = rec.events.find(e => e.kind === 'DP_STATE_UPDATED');
    const html = TSP.liveMathHTML(p, 'heldkarp', dp, { counts: { DP_STATE_UPDATED: 3 } });
    ok(html.includes(String(dp.data.value)), 'liveMathHTML(heldkarp) shows live dp value');
  }
  {
    const { rec } = await recordAll('brute', p);
    const html = TSP.liveMathHTML(p, 'brute', rec.events[1], { counts: { TOUR_COMPLETED: 2 } });
    ok(html.includes('2 /') && html.includes('6'), 'liveMathHTML(brute) shows tours done / total');
    // at the final event every tour is counted (BEST_TOUR_UPDATED counts too)
    const counts = {};
    rec.events.forEach(e => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
    const doneHtml = TSP.liveMathHTML(p, 'brute', rec.events[rec.events.length - 1], { counts });
    ok(doneHtml.includes('6 / 6') && doneHtml.includes('remaining:') && !doneHtml.includes('remaining: 6'),
      'liveMathHTML(brute) counts all 6 tours at completion');
  }

  // C. performance metrics: honest placeholders with no record…
  {
    const ms = TSP.perfMetrics(p, null, null, null, null);
    ok(ms.length >= 6 && ms.every(m => m.value === '—'),
      'perfMetrics with no record shows unavailable state, never fiction');
  }
  // …and real values from a real run, compute vs animation distinguished
  {
    const { rec } = await recordAll('nearest', p);
    const fakePlayback = { animSteps: 5, intervalMs: 1500, currentEvent: () => null };
    const ms = TSP.perfMetrics(p, rec, fakePlayback, { ok: true }, {});
    const byLabel = Object.fromEntries(ms.map(m => [m.label, m]));
    ok(byLabel['Best tour'].value !== '—', 'perfMetrics best tour is real');
    ok(byLabel['Compute time'].value !== '—', 'perfMetrics compute time is real');
    ok(/steps/.test(byLabel['Animation time'].value), 'perfMetrics animation time is steps-based');
    ok(byLabel['Compute time'].title !== byLabel['Animation time'].title,
      'compute vs animation time are distinguished');
    eq(byLabel['States pruned'].value, 'N/A', 'non-B&B shows N/A for pruned, not a fake zero');
  }

  /* ---------- dynamic glow: syntax highlighter ---------- */
  {
    const h = TSP.highlightPseudo;
    ok(h('for each city:').includes('<span class="tok-kw">for</span>'), 'keyword highlighted');
    ok(h('return best tour').includes('<span class="tok-kw">return</span>'), 'return highlighted');
    ok(!h('before the tour').includes('tok-kw'), 'substring "for" inside a word is not highlighted');
    const num = h('cost ← 211');
    ok(num.includes('<span class="tok-num">211</span>'), 'number highlighted');
    const com = h('x ← 1 // set x');
    ok(com.includes('<span class="tok-com">// set x</span>'), 'comment highlighted to end of line');
    ok(com.includes('<span class="tok-num">1</span>'), 'number before the comment is still highlighted');
    const esc = h('if Δ < 0 then');
    ok(esc.includes('&lt;') && !esc.includes('< 0'), 'angle brackets escaped, never raw');
    ok(!esc.includes('<span class="tok-num">39</span>'), 'escapes are not re-tokenized');
    ok(h('plain text here').indexOf('<span') === -1, 'plain text has no spans');
  }

  /* ---------- dynamic glow: step-flag trackers ---------- */
  {
    const F = TSP.intelStepFlags;
    const ev = k => ({ kind: k, data: {} });
    TSP.intelResetTrack();
    let f = F(ev('RUN_STARTED'), 0, null, null);
    ok(!f.improved && !f.prunedNow && !f.costChanged, 'no flags without a best/cost');
    f = F(ev('BEST_TOUR_UPDATED'), 1, 300, 300);
    ok(f.improved, 'first best tour counts as an improvement');
    f = F(ev('TOUR_COMPLETED'), 2, 300, 280);
    ok(!f.improved && f.costChanged, 'equal best is not an improvement; changed cost is');
    f = F(ev('BEST_TOUR_UPDATED'), 3, 250, 250);
    ok(f.improved, 'strictly better tour flags improvement');
    f = F(ev('STATE_PRUNED'), 4, 250, 250);
    ok(f.prunedNow && !f.improved && !f.costChanged, 'prune event flags only pruning');
    /* stepping backward resyncs silently */
    f = F(ev('BEST_TOUR_UPDATED'), 2, 300, 300);
    ok(!f.improved, 'stepping back to an older best does not pulse');
    /* stepping forward again replays the genuine improvement at that event */
    f = F(ev('BEST_TOUR_UPDATED'), 3, 250, 250);
    ok(f.improved, 're-forwarding through the improvement event replays its pulse');
    /* stepping forward to a non-improving event never pulses */
    f = F(ev('TOUR_COMPLETED'), 4, 250, 240);
    ok(!f.improved, 'forward step with no new best does not pulse');
    TSP.intelResetTrack();
    f = F(ev('BEST_TOUR_UPDATED'), 0, 200, 200);
    ok(f.improved, 'trackers reset cleanly for a new run');
  }
}

module.exports = main;
