const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Pull the pure calculator module out of the single-file site and run it in a
// tiny sandbox — no DOM needed.
function loadCalc() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/\/\* Tarazu calculator logic[\s\S]*?\}\)\(typeof window !== "undefined" \? window : globalThis\);/);
  assert.ok(match, 'calculator module not found in index.html');
  const sandbox = { window: {} };
  vm.runInNewContext(match[0], sandbox, { filename: 'index.html:calc' });
  return sandbox.window.TarazuCalc;
}

const C = loadCalc();

test('budget -> grams keeps per-gram and per-kg rates', () => {
  const out = C.weight({ mode: 'toWeight', rate: 70, per: 1000, amount: 15 });
  assert.equal(out.mode, 'toWeight');
  assert.ok(Math.abs(out.perGram - 0.07) < 1e-12);
  assert.equal(out.perKg, 70);
  assert.ok(Math.abs(out.grams - 15 / 0.07) < 1e-9);
  assert.ok(Math.abs(out.kg - 0.15 / 0.7) < 1e-12);
});

test('grams -> price: ₹70/kg and 250 g costs ₹17.50', () => {
  const out = C.weight({ mode: 'toPrice', rate: 70, per: 1000, amount: 250 });
  assert.equal(out.mode, 'toPrice');
  assert.equal(out.grams, 250);
  assert.ok(Math.abs(out.price - 17.5) < 1e-12);
  assert.ok(Math.abs(out.perGram - 0.07) < 1e-12);
});

test('₹70 for 250 g -> ₹0.28/g and ₹280/kg', () => {
  const out = C.weight({ mode: 'toRate', rate: 70, per: 250, amount: 70 });
  assert.equal(out.mode, 'toRate');
  assert.equal(out.price, 70);
  assert.equal(out.grams, 250);
  assert.ok(Math.abs(out.perGram - 0.28) < 1e-12);
  assert.ok(Math.abs(out.perKg - 280) < 1e-9);
});

test('validates every mode without mixing up field names', () => {
  assert.ok(C.weight({ mode: 'toWeight', rate: 0, per: 1000, amount: 15 }).errors.rate);
  assert.ok(C.weight({ mode: 'toPrice', rate: 70, per: 1000, amount: 0 }).errors.amount);
  const rate = C.weight({ mode: 'toRate', rate: 70, per: 0, amount: 0 });
  assert.ok(rate.errors.amount, 'missing grams should map to the visible amount field');
  assert.ok(!rate.errors.per, 'there is no visible "per" field in the form');
});
