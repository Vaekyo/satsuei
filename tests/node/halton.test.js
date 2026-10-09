"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../../src/core/halton.js");

test("radical inverse base 2/3", () => {
  assert.deepEqual([1, 2, 3, 4].map((i) => H.radicalInverse(i, 2)), [0.5, 0.25, 0.75, 0.125]);
  const b3 = [1, 2, 3].map((i) => H.radicalInverse(i, 3));
  assert.ok(Math.abs(b3[0] - 1 / 3) < 1e-15 && Math.abs(b3[1] - 2 / 3) < 1e-15 && Math.abs(b3[2] - 1 / 9) < 1e-15);
});

test("points are in [0,1) and evenly cover quadrants", () => {
  const p = H.points(4096);
  const q = [0, 0, 0, 0];
  for (let i = 0; i < 4096; i++) {
    assert.ok(p.x[i] >= 0 && p.x[i] < 1 && p.y[i] >= 0 && p.y[i] < 1);
    q[(p.x[i] < 0.5 ? 0 : 1) + (p.y[i] < 0.5 ? 0 : 2)]++;
  }
  for (const c of q) assert.ok(Math.abs(c - 1024) < 8, String(q));
});

test("rng is deterministic, uniform-ish, in [0,1)", () => {
  const a = H.rng(42), b = H.rng(42);
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
    sum += v;
  }
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.01);
  assert.notEqual(H.rng(1)(), H.rng(2)());
});
