/* Test runner: node tests/run.js */
'use strict';
const { summary } = require('./shim');

(async () => {
  await require('./test_algorithms')();
  await require('./test_engine')();
  await require('./test_intel')();
  summary();
})().catch(e => { console.error(e); process.exitCode = 1; });
