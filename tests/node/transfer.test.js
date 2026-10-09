"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../../src/core/transfer.js");
const FX = require("../../src/core/fxmodel.js");
const L = require("../../src/core/linalg.js");
const C = require("../../src/core/color.js");
const H = require("../../src/core/halton.js");

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} vs ${b} (eps ${eps})`);

function randomSet(n, mean, spread, seed) {
  const r = H.rng(seed), s = { r: [], g: [], b: [], w: [] };
  for (let i = 0; i < n; i++) {
    const t = r() - 0.5, u = r() - 0.5, v = r() - 0.5;
    s.r.push(mean[0] + spread[0] * (t + 0.3 * u));
    s.g.push(mean[1] + spread[1] * (u + 0.2 * v));
    s.b.push(mean[2] + spread[2] * (v + 0.25 * t));
    s.w.push(1);
  }
  return s;
}

test("MKL: transformed covariance equals the target covariance, means match", () => {
  const src = T.describe(randomSet(4000, [0.5, 0.45, 0.4], [0.3, 0.25, 0.2], 1));
  const tgt = T.describe(randomSet(4000, [0.3, 0.35, 0.55], [0.15, 0.2, 0.3], 2));
  const m = T.mkl(src.mean, src.cov, tgt.mean, tgt.cov, { mklEps: 1e-9, mklMaxGain: 10 });
  const tc = L.mul3(L.mul3(m.A, src.cov), L.transpose3(m.A));
  assert.ok(L.maxAbsDiff3(tc, tgt.cov) < 1e-6, "A Σs Aᵀ = Σt");
  const mu = L.applyAffine(m.A, m.b, src.mean);
  for (let c = 0; c < 3; c++) near(mu[c], tgt.mean[c], 1e-9);
  assert.ok(L.maxAbsDiff3(m.A, L.transpose3(m.A)) < 1e-9, "T is symmetric");
});

test("MKL is identity for identical distributions and stays bounded for degenerate sources", () => {
  const s = T.describe(randomSet(2000, [0.5, 0.5, 0.5], [0.2, 0.2, 0.2], 3));
  const m = T.mkl(s.mean, s.cov, s.mean, s.cov, {});
  assert.ok(L.maxAbsDiff3(m.A, L.I3()) < 1e-6);
  // flat cel: zero variance in two directions
  const flat = { r: [], g: [], b: [], w: [] };
  for (let i = 0; i < 500; i++) { const v = 0.3 + 0.4 * (i % 2); flat.r.push(v); flat.g.push(v); flat.b.push(v); flat.w.push(1); }
  const d = T.describe(flat);
  const tgt = T.describe(randomSet(2000, [0.4, 0.3, 0.5], [0.2, 0.3, 0.25], 4));
  const m2 = T.mkl(d.mean, d.cov, tgt.mean, tgt.cov, { mklMaxGain: 2 });
  const e = L.eigSym3(m2.A).values;
  assert.ok(e[0] <= 2 + 1e-9 && e[2] >= 0.5 - 1e-9, `eigenvalues clamped: ${e}`);
});

test("Reinhard-Oklab affine fit reduces the distance to the target statistics", () => {
  const src = randomSet(3000, [0.6, 0.5, 0.45], [0.25, 0.2, 0.2], 5);
  const tgtMean = [0.55, -0.02, -0.06], tgtStd = [0.12, 0.03, 0.04];
  const fit = T.reinhardAffine(src, tgtMean, tgtStd, {});
  const out = T.mapSamples(src, (c) => L.applyAffine(fit.A, fit.b, c));
  const d = T.describe(out);
  near(d.meanLab[0], tgtMean[0], 0.03, "L"); near(d.meanLab[1], tgtMean[1], 0.02, "a"); near(d.meanLab[2], tgtMean[2], 0.02, "b");
  assert.ok(fit.residualDE < 0.05, `residual ${fit.residualDE}`);
});

test("fxmodel: identity settings are the identity; saturation keeps luma", () => {
  const st = FX.chainSettings({}, {});
  for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.3]]) {
    const o = FX.applyChain(c, st);
    for (let k = 0; k < 3; k++) near(o[k], c[k], 1e-12);
  }
  const s = FX.saturationAffine(0.5);
  const c = [0.8, 0.3, 0.2], o = FX.applyAffine(s, c);
  const luma = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  near(luma(o), luma(c), 1e-12);
  const mix = FX.toMixer(s);
  const o2 = FX.channelMixer(c, mix.M, mix.constPct);
  for (let k = 0; k < 3; k++) near(o2[k], o[k], 1e-12, "mixer % units");
});

function regionLike(mean, cov, medianY, black, keyLin, illumLin, bandsMidLab, meanChroma, Lp) {
  return {
    weight: 1000, mean, cov, meanLab: C.srgbToOklab(mean), meanChroma, medianY,
    L: Lp || { p5: 0.2, p50: 0.5, p95: 0.85 },
    black: { rgb: black, lin: C.toLinear3(black) }, key: { lin: keyLin, rgb: C.toSrgb3(keyLin) },
    illuminant: { known: true, lin: C.normalizeLuminance(illumLin) },
    bands: { mid: { lab: bandsMidLab } }
  };
}

function charLike(samples) {
  const d = T.describe(samples);
  return { illuminant: { known: true, lin: [1, 1, 1] }, lineArt: { rgb: [0.08, 0.08, 0.08] }, edge: { rgb: [0.3, 0.3, 0.3] }, meanLab: d.meanLab };
}

test("solver: neutral mid-grey scene gives (near) identity", () => {
  const samples = randomSet(3000, [0.6, 0.55, 0.5], [0.5, 0.5, 0.5], 6);
  const cov = T.describe(samples).cov;
  const d = T.describe(samples);
  const g = regionLike([0.6, 0.55, 0.5], cov, T.DEFAULTS.yRef, [0, 0, 0], [1, 1, 1], [1, 1, 1], [0.6, 0, 0], d.meanChroma);
  g.meanRelChroma = d.meanRelChroma / T.DEFAULTS.rho;
  const bg = { global: g, ring: null };
  const r = T.solve(bg, charLike(samples), samples, {});
  for (let c = 0; c < 3; c++) near(r.params.wbStops[c], 0, 1e-6, "wb");
  near(r.params.ev, 0, 1e-6, "ev");
  for (let c = 0; c < 3; c++) { near(r.params.lift[c], 0, 1e-9); near(r.params.gamma[c], 1, 0.02); }
});

test("solver: warm dim scene -> warm WB, negative EV, lifted navy blacks guarded", () => {
  const samples = randomSet(3000, [0.6, 0.55, 0.5], [0.5, 0.5, 0.5], 7);
  const cov = L.scale3(T.describe(samples).cov, 0.3);
  const warm = C.cctToLinear(3000);
  const g = regionLike([0.3, 0.25, 0.3], cov, 0.02, [0.05, 0.06, 0.25], warm, warm, [0.3, 0.0, -0.05], 0.05);
  g.meanRelChroma = 0.05;
  const bg = { global: g, ring: null };
  const r = T.solve(bg, charLike(samples), samples, {});
  assert.ok(r.params.wbStops[0] > 0.1 && r.params.wbStops[2] < -0.1, `warm WB ${r.params.wbStops}`);
  assert.ok(r.params.ev < -0.5, `night EV ${r.params.ev}`);
  assert.ok(r.params.lift[2] > r.params.lift[0], "blue lift");
  assert.ok(r.params.lift[2] <= 0.2 + 1e-12, "lift cap");
  assert.ok(r.params.sat < 1, "desaturate toward a low-chroma ring");
  assert.ok(r.predicted.luma.p99 <= 0.985 + 1e-9 || r.guards.clipEvReduction === 0);
});

test("solver: EV is clamped and the clip guard pulls exposure down in bright scenes", () => {
  const samples = randomSet(3000, [0.75, 0.72, 0.7], [0.5, 0.5, 0.5], 8);
  const cov = T.describe(samples).cov;
  const bg = { global: regionLike([0.9, 0.9, 0.92], cov, 0.9, [0.6, 0.6, 0.65], [1, 1, 1], [1, 1, 1], [0.9, 0, 0], 0.02), ring: null };
  const r = T.solve(bg, charLike(samples), samples, {});
  assert.ok(r.steps.ev.ev <= 1.0 + 1e-12);
  assert.ok(r.params.ev <= r.steps.ev.ev);
  assert.ok(r.predicted.clipFraction - r.before.clipFraction <= 0.02, "clipping barely increases");
});
