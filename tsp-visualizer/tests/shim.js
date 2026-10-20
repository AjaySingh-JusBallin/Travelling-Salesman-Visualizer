/* Test shim: loads the plain-script sources in a Node environment. */
'use strict';
const fs = require('fs');
const path = require('path');

function loadTSP() {
  const sandbox = {};
  // minimal browser shims — algorithm/engine files don't touch the DOM at load
  sandbox.window = {};
  sandbox.document = {
    createElementNS: () => { throw new Error('DOM not available in tests'); },
    createElement: () => { throw new Error('DOM not available in tests'); },
    addEventListener: () => {},
    getElementById: () => null,
    querySelectorAll: () => []
  };
  sandbox.performance = performance;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  const files = ['tsp.js', 'engine.js', 'algorithms.js', 'complexity.js',
               'pseudocode.js', 'derivations.js', 'liveintel.js'];
  const vm = require('vm');
  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  return sandbox.window.TSP;
}

/* tiny assertion library */
let passed = 0, failed = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('  FAIL: ' + name); }
}
function eq(a, b, name) {
  ok(a === b, name + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')');
}
function summary() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exitCode = 1; }
}

module.exports = { loadTSP, ok, eq, summary };
