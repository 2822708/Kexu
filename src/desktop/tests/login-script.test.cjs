const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const testDir = process.argv[2];
const script = fs.readFileSync(path.join(testDir, 'login-script.js'), 'utf8');
const expected = fs.readFileSync(path.join(testDir, 'expected-key.txt'), 'utf8');
for (const [origin, topLevel, permitted] of [
  ['http://127.0.0.1:17817', true, true],
  ['http://127.0.0.1:17817', false, false],
  ['http://127.0.0.1:17818', true, false],
  ['https://example.test', true, false],
  ['null', true, false],
]) {
  const saved = {};
  const window = {};
  window.top = topLevel ? window : {};
  vm.runInNewContext(script, { window, location: { origin }, localStorage: { setItem: (k, v) => { saved[k] = v; } } });
  assert.equal(saved['timetable.apiKey'], permitted ? expected : undefined, `credential boundary: ${origin}, ${topLevel}`);
}
console.log('PASS: login script escaping and 5 top-level/origin cases');
