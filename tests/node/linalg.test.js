"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/core/linalg.js");
const H = require("../../src/core/halton.js");

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} vs ${b}`);

function randSym(rng) {
  const B = [[0, 0, 0], [0, 0, 0], [0, 0, 0]].map((r) => r.map(() => rng() * 2 - 1));
  return L.add3(L.mul3(B, L.transpose3(B)), L.scale3(L.I3(), 0.01));
}

test("Jacobi eigendecomposition reconstructs random SPD matrices", () => {
  const rng = H.rng(7);
  for (let t = 0; t < 200; t++) {
    const A = randSym(rng);
    const { values, vectors: V } = L.eigSym3(A);
    assert.ok(values[0] >= values[1] && values[1] >= values[2]);
    const D = [[values[0], 0, 0], [0, values[1], 0], [0, 0, values[2]]];
    const R = L.mul3(L.mul3(V, D), L.transpose3(V));
    assert.ok(L.maxAbsDiff3(R, A) < 1e-10);
    assert.ok(L.maxAbsDiff3(L.mul3(L.transpose3(V), V), L.I3()) < 1e-10, "orthonormal");
  }
});

test("Jacobi handles diagonal, repeated and degenerate matrices", () => {
  const e = L.eigSym3([[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
  assert.deepEqual(e.values, [3, 2, 1]);
  const e2 = L.eigSym3([[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  near(e2.values[0], 3, 1e-12); near(e2.values[1], 0, 1e-12); near(e2.values[2], 0, 1e-12);
});

test("sqrtm and inverse sqrtm", () => {
  const rng = H.rng(3);
  for (let t = 0; t < 50; t++) {
    const A = randSym(rng);
    const S = L.sqrtmSym3(A);
    assert.ok(L.maxAbsDiff3(L.mul3(S, S), A) < 1e-9);
    const Si = L.invSqrtmSym3(A);
    assert.ok(L.maxAbsDiff3(L.mul3(L.mul3(Si, A), Si), L.I3()) < 1e-6);
  }
});

test("inv3, solve, wls", () => {
  const A = [[2, 1, 0], [1, 3, 1], [0, 1, 4]];
  assert.ok(L.maxAbsDiff3(L.mul3(A, L.inv3(A)), L.I3()) < 1e-12);
  const x = L.solve([[0, 2, 1], [1, 1, 1], [3, 0, 2]], [4, 6, 13]);
  [3, 1, 2].forEach((v, i) => near(x[i], v, 1e-12));
  assert.equal(L.solve([[1, 2], [2, 4]], [1, 2]), null);
  // fit y = 2x - 3 with noise-free data
  const rows = [], y = [];
  for (let i = 0; i < 10; i++) { rows.push([i, 1]); y.push(2 * i - 3); }
  const beta = L.wls(rows, y);
  near(beta[0], 2, 1e-12); near(beta[1], -3, 1e-12);
});

test("affine blend is an exact linear blend of before/after", () => {
  const A = [[1.2, 0.1, -0.05], [0.0, 0.9, 0.1], [0.05, -0.02, 1.1]], b = [0.02, -0.01, 0.03];
  const v = [0.3, 0.6, 0.2];
  const k = 0.37;
  const { A: Ak, b: bk } = L.affineBlend(A, b, k);
  const full = L.applyAffine(A, b, v), part = L.applyAffine(Ak, bk, v);
  for (let i = 0; i < 3; i++) near(part[i], v[i] + k * (full[i] - v[i]), 1e-12);
});

test("AE angle convention: 0 up, clockwise", () => {
  near(L.vecToAeAngle(0, -1), 0, 1e-12);
  near(L.vecToAeAngle(1, 0), 90, 1e-12);
  near(L.vecToAeAngle(0, 1), 180, 1e-12);
  near(L.vecToAeAngle(-1, 0), 270, 1e-12);
  for (let a = 0; a < 360; a += 15) {
    const v = L.aeAngleToVec(a);
    near(L.angleDist(L.vecToAeAngle(v[0], v[1]), a), 0, 1e-9);
  }
  near(L.angleDist(350, 10), 20, 1e-12);
});
