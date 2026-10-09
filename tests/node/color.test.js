"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../src/core/color.js");

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} vs ${b} (eps ${eps})`);
const near3 = (a, b, eps, msg) => { for (let i = 0; i < 3; i++) near(a[i], b[i], eps, `${msg || ""}[${i}]`); };

test("sRGB transfer round-trip and anchor values", () => {
  for (let i = -20; i <= 300; i++) {
    const v = i / 256;
    near(C.linearToSrgb(C.srgbToLinear(v)), v, 1e-12);
  }
  near(C.srgbToLinear(0.5), 0.21404114048223255, 1e-12);
  near(C.srgbToLinear(0.04045), 0.04045 / 12.92, 1e-12);
});

test("Oklab matches Ottosson's published XYZ test vectors", () => {
  // https://bottosson.github.io/posts/oklab/ (table "Table of example XYZ and Oklab pairs")
  const pairs = [
    [[0.950, 1.000, 1.089], [1.000, 0.000, 0.000]],
    [[1.000, 0.000, 0.000], [0.450, 1.236, -0.019]],
    [[0.000, 1.000, 0.000], [0.922, -0.671, 0.263]],
    [[0.000, 0.000, 1.000], [0.153, -1.415, -0.449]]
  ];
  for (const [xyz, lab] of pairs) near3(C.xyzToOklab(xyz), lab, 1.5e-3, "xyz->oklab");
});

test("direct linear-sRGB Oklab path agrees with XYZ path", () => {
  for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.2, 0.5, 0.9], [0.9, 0.7, 0.1], [0.18, 0.18, 0.18]]) {
    near3(C.linearToOklab(c), C.xyzToOklab(C.linearToXyz(c)), 2e-3);
  }
  // white → L=1, a=b=0
  near3(C.linearToOklab([1, 1, 1]), [1, 0, 0], 1e-4);
});

test("Oklab round-trip over the sRGB cube", () => {
  for (let r = 0; r <= 1; r += 0.125) for (let g = 0; g <= 1; g += 0.125) for (let b = 0; b <= 1; b += 0.125) {
    near3(C.oklabToLinear(C.linearToOklab([r, g, b])), [r, g, b], 5e-6);
    near3(C.oklabToSrgb(C.srgbToOklab([r, g, b])), [r, g, b], 5e-6);
  }
});

test("LCh round-trip and hue helpers", () => {
  const lab = [0.6, -0.08, 0.11];
  near3(C.lchToOklab(C.oklabToLch(lab)), lab, 1e-12);
  near(C.hueDeg(0, 1), 90, 1e-12);
  near(C.hueDeg(0, -1), 270, 1e-12);
  near(C.hueDiff(350, 10), 20, 1e-12);
  near(C.hueDiff(10, 350), -20, 1e-12);
});

test("CCT: D65 ≈ 6504 K, blackbody round trip, warm vs cool ordering", () => {
  near(C.linearToCct([1, 1, 1]), 6504, 15);
  // McCamy's cubic drifts above ~10000 K (≈3% at 12000 K): good enough for reporting.
  for (const t of [2000, 2700, 3200, 4000, 5000, 6500, 9000, 12000]) {
    near(C.linearToCct(C.cctToLinear(t)), t, t * (t > 10000 ? 0.05 : 0.02), `T=${t}`);
  }
  const warm = C.cctToLinear(3000), cool = C.cctToLinear(9000);
  assert.ok(warm[0] > warm[2] && cool[2] > cool[0]);
  near(C.luminance(warm), 1, 1e-9);
});
