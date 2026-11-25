const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCalc() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/\/\* Tarazu calculator logic[\s\S]*?\}\)\(typeof window !== "undefined" \? window : globalThis\);/);
  assert.ok(match, 'calculator module not found in index.html');
  const sandbox = { window: {} };
  vm.runInNewContext(match[0], sandbox, { filename: 'index.html:calc' });
  return sandbox.window.TarazuCalc;
}

const C = loadCalc();

test('₹450 bought, ₹540 sold -> ₹90 profit / 20%', () => {
  const out = C.percent({ mode: 'profit', a: 450, b: 540 });
  assert.equal(out.state, 'profit');
  assert.equal(out.diff, 90);
  assert.equal(out.percent, 20);
  assert.ok(Math.abs(out.margin - 90 / 540 * 100) < 1e-12);
});

test('selling below cost is reported as a loss', () => {
  const out = C.percent({ mode: 'profit', a: 540, b: 450 });
  assert.equal(out.state, 'loss');
  assert.equal(out.diff, -90);
  assert.ok(Math.abs(out.percent + 90 / 540 * 100) < 1e-12);
});

test('₹18,000 salary at 8% -> ₹1,440 (plus after/added amounts)', () => {
  const out = C.percent({ mode: 'salary', a: 18000, b: 8 });
  assert.equal(out.result, 1440);
  assert.equal(out.after, 16560);
  assert.equal(out.with, 19440);
});

test('validates both new modes', () => {
  assert.match(C.percent({ mode: 'profit', a: 0, b: 540 }).errors.a, /cost price/i);
  assert.match(C.percent({ mode: 'salary', a: 18000, b: -2 }).errors.b, /can't be negative/i);
  assert.equal(C.percent({ mode: 'profit', a: 450, b: 450 }).state, 'even');
});
