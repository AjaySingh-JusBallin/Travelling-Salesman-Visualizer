/* Engine tests: recording, playback navigation, validator. */
'use strict';
const { loadTSP, ok, eq } = require('./shim');
const TSP = loadTSP();

function prob(n, seed) {
  const p = new TSP.TSPProblem();
  p.generateStructured(n, 'uniform', seed);
  return p;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('--- engine: recording & playback ---');
  const p = prob(6, 99);
  const runner = TSP.createRunner('branchbound', p);
  const rec = await TSP.recordRun(runner, p, {});
  ok(!rec.cancelled, 'recordRun completes');
  ok(rec.computeMs >= 0, 'computeMs measured');
  ok(rec.events.length >= 2, 'events recorded');

  // default interval is 1500 ms
  eq(TSP.DEFAULT_INTERVAL_MS, 1500, 'default playback interval is 1500ms');

  // playback: default interval, step forward/backward, jump, skip
  const seen = [];
  const pb = TSP.createPlayback(rec, { onEvent: (ev, c) => seen.push([ev.seq, c]) });
  eq(pb.intervalMs, 1500, 'playback starts at 1500ms');
  eq(pb.cursor, 0, 'cursor starts at first event');

  pb.stepForward(); pb.stepForward(); pb.stepForward();
  eq(pb.cursor, 3, 'stepForward advances');
  eq(pb.state, 'paused', 'manual stepping leaves playback paused');
  pb.stepBackward(); pb.stepBackward();
  eq(pb.cursor, 1, 'stepBackward retreats without recompute');
  // frame at cursor matches the event's own frame
  const ev = pb.currentEvent();
  ok(JSON.stringify(ev.frame) === JSON.stringify(rec.events[1].frame), 'frame at cursor == recorded frame');

  pb.jumpToEnd();
  eq(pb.cursor, rec.events.length - 1, 'jumpToEnd reaches final event');
  eq(pb.state, 'done', 'state is done at end');
  pb.skipToResult();
  eq(pb.cursor, rec.events.length - 1, 'skipToResult == jumpToEnd');

  // jumping around never changes the recorded answer
  pb.jumpTo(0);
  const firstFrame = JSON.stringify(pb.currentEvent().frame);
  pb.jumpTo(5); pb.jumpTo(2); pb.jumpTo(0);
  eq(JSON.stringify(pb.currentEvent().frame), firstFrame, 'seeking is deterministic');

  // changing speed never changes the event stream
  const seqBefore = rec.events.map(e => e.seq + ':' + e.kind).join('|');
  pb.setIntervalMs(50);
  eq(pb.intervalMs, 50, 'speed change applies');
  pb.setIntervalMs(1500);
  eq(rec.events.map(e => e.seq + ':' + e.kind).join('|'), seqBefore, 'event stream untouched by speed changes');

  // single timer: play twice, then pause — cursor must not advance after pause
  const pb2 = TSP.createPlayback(rec, {});
  pb2.setIntervalMs(20);
  pb2.play(); pb2.play(); // second play must not arm a second timer
  await sleep(75);
  pb2.pause();
  const c1 = pb2.cursor;
  await sleep(80);
  eq(pb2.cursor, c1, 'no timer fires after pause (single guarded timer)');
  pb2.dispose();

  // done state replays from start
  pb.jumpToEnd();
  pb.play();
  eq(pb.cursor, 0, 'play from done restarts at the beginning');
  eq(pb.state, 'playing', 'replay state is playing');
  pb.pause();
  pb.dispose();

  console.log('--- engine: cancellation ---');
  {
    const big = prob(9, 5);
    const r2 = TSP.createRunner('brute', big);
    let calls = 0;
    const rec2 = await TSP.recordRun(r2, big, {
      onProgress: () => { calls++; },
      isCancelled: () => calls >= 2
    });
    ok(rec2.cancelled === true, 'recordRun honors cancellation');
    ok(rec2.result === null, 'cancelled run has no result');
  }

  console.log('--- validator ---');
  {
    const q = prob(4, 11);
    const rr = await TSP.recordRun(TSP.createRunner('heldkarp', q), q, {});
    const v = TSP.validateTour(q, rr.result.bestPath, rr.result.bestCost);
    ok(v.ok && v.costMatches && v.edgesValid, 'validator accepts the optimal tour');
    // missing city
    const bad1 = rr.result.bestPath.slice(0, -2).concat([0]);
    ok(!TSP.validateTour(q, bad1).ok, 'validator rejects a tour that skips a city');
    // wrong start/end
    const bad2 = rr.result.bestPath.slice();
    bad2[0] = 1;
    ok(!TSP.validateTour(q, bad2).ok, 'validator rejects a tour not starting at city 0');
    // cost mismatch
    ok(!TSP.validateTour(q, rr.result.bestPath, rr.result.bestCost + 1).ok, 'validator rejects a wrong claimed cost');
    // repeated city
    const bad3 = rr.result.bestPath.slice();
    bad3[2] = bad3[1];
    ok(!TSP.validateTour(q, bad3).ok, 'validator rejects a repeated city');
  }

  console.log('--- determinism ---');
  {
    const q1 = prob(6, 1234), q2 = prob(6, 1234);
    const r1 = await TSP.recordRun(TSP.createRunner('annealing', q1, { iterations: 200, seed: 9 }), q1, {});
    const r2 = await TSP.recordRun(TSP.createRunner('annealing', q2, { iterations: 200, seed: 9 }), q2, {});
    eq(r1.result.bestCost, r2.result.bestCost, 'same seed + same instance => same SA result');
    eq(r1.events.length, r2.events.length, 'same seed => same event count');
  }
}

module.exports = main;
