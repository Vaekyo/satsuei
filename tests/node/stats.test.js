"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../../src/core/stats.js");
const C = require("../../src/core/color.js");
const L = require("../../src/core/linalg.js");
const H = require("../../src/core/halton.js");
const CH = require("../../tools/lib/character.js");

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} vs ${b} (eps ${eps})`);

function img(w, h, f) {
  const o = { w, h, r: new Float64Array(w * h), g: new Float64Array(w * h), b: new Float64Array(w * h), a: new Float64Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = f(x, y), i = y * w + x;
    o.r[i] = c[0]; o.g[i] = c[1]; o.b[i] = c[2]; o.a[i] = c.length > 3 ? c[3] : 1;
  }
  return o;
}

test("histogram percentiles are within 2 bins of exact sorted percentiles", () => {
  const rng = H.rng(5);
  const vals = [], wts = [];
  for (let i = 0; i < 50000; i++) { vals.push(Math.pow(rng(), 2.2)); wts.push(1); }
  const hist = S.histogram(vals, wts, 1024, 0, 1);
  const sorted = vals.slice().sort((a, b) => a - b);
  for (const p of [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) {
    near(S.percentile(hist, p), sorted[Math.floor(p * (sorted.length - 1))], 2 / 1024, `p${p}`);
  }
});

test("weighted moments match a direct computation", () => {
  const rng = H.rng(9);
  const n = 2000, x = [], y = [], z = [], w = [];
  for (let i = 0; i < n; i++) { const t = rng(); x.push(t); y.push(0.5 * t + 0.1 * rng()); z.push(rng()); w.push(rng() < 0.2 ? 0 : 1 + rng()); }
  const m = S.moments3(x, y, z, w);
  let sw = 0, mx = 0, my = 0;
  for (let i = 0; i < n; i++) { sw += w[i]; mx += w[i] * x[i]; my += w[i] * y[i]; }
  mx /= sw; my /= sw;
  let cxy = 0;
  for (let i = 0; i < n; i++) cxy += w[i] * (x[i] - mx) * (y[i] - my);
  near(m.mean[0], mx, 1e-12); near(m.mean[1], my, 1e-12); near(m.cov[0][1], cxy / sw, 1e-12);
  assert.equal(m.cov[1][0], m.cov[0][1]);
});

test("distance transform equals brute force", () => {
  const w = 37, h = 23, rng = H.rng(3);
  const mask = [];
  for (let i = 0; i < w * h; i++) mask.push(rng() < 0.03);
  const d = S.distanceTransform((i) => mask[i], w, h);
  for (let i = 0; i < w * h; i += 7) {
    let best = Infinity;
    for (let j = 0; j < w * h; j++) if (mask[j]) best = Math.min(best, Math.hypot((i % w) - (j % w), Math.floor(i / w) - Math.floor(j / w)));
    near(d[i], best, 1e-9);
  }
});

test("ring weights: zero inside, decreasing with distance, zero beyond radius", () => {
  const w = 60, h = 40;
  const alpha = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha.push(Math.hypot(x - 30, y - 20) < 8 ? 1 : 0);
  const ring = S.ringWeights(alpha, w, h, 6);
  assert.equal(ring.w[20 * w + 30], 0);
  assert.ok(ring.w[20 * w + 39] > ring.w[20 * w + 42]);
  assert.equal(ring.w[20 * w + 45], 0);
});

test("plane fit recovers gradient direction in the AE convention", () => {
  for (const ang of [0, 45, 90, 135, 200, 315]) {
    const v = L.aeAngleToVec(ang);
    const im = img(96, 54, (x, y) => {
      const nx = ((x + 0.5) / 96) * 2 - 1, ny = ((y + 0.5) / 54) * 2 - 1;
      const t = C.linearToSrgb(Math.max(0, 0.3 + 0.2 * (nx * v[0] + ny * v[1])));
      return [t, t, t];
    });
    const P = S.prepare(im);
    const pf = S.planeFit(P, S.onesWeights(P.n));
    assert.ok(L.angleDist(pf.angle, ang) < 1, `angle ${pf.angle} vs ${ang}`);
    assert.ok(pf.r2 > 0.99 && pf.confidence > 0.9);
  }
});

test("bright blob + light direction: blob to the right of the character", () => {
  const im = img(120, 68, (x, y) => {
    const d = Math.hypot(x - 105, y - 20);
    const t = d < 5 ? 1 : 0.2;
    return [t, t, t];
  });
  const P = S.prepare(im);
  const blob = S.brightBlob(P, S.onesWeights(P.n));
  near(blob.x, 105.5 / 120, 0.02); near(blob.y, 20.5 / 68, 0.03);
  const ld = S.lightDirection({ angle: null, confidence: 0 }, blob, { x: 0.3, y: 0.6 }, 120 / 68);
  assert.ok(ld.angle > 45 && ld.angle < 90, `angle ${ld.angle}`);
  assert.ok(ld.confidence > 0.3);
});

test("shades of gray recovers a global cast; key color skips clipped and neon pixels", () => {
  const cast = [1.2, 1.0, 0.7];
  const rng = H.rng(2);
  const im = img(80, 60, (x, y) => {
    if (x < 6 && y < 6) return [1, 1, 1]; // clipped
    if (x > 70 && y < 8) return [0.1, 0.98, 0.5]; // neon: bright, saturated, unclipped
    const v = 0.1 + 0.5 * rng();
    return [C.linearToSrgb(v * cast[0] * 0.7), C.linearToSrgb(v * cast[1] * 0.7), C.linearToSrgb(v * cast[2] * 0.7)];
  });
  const P = S.prepare(im), w = S.onesWeights(P.n);
  const e = S.shadesOfGray(P, w, 6, 0.995);
  const ce = C.normalizeLuminance(cast);
  for (let c = 0; c < 3; c++) near(e[c], ce[c], 0.05, `sog[${c}]`);
  const hist = S.histogram(P.Lr, w, 1024, 0, 1);
  const key = S.keyColor(P, w, hist, {});
  assert.ok(key.rgb[0] < 0.99 && key.rgb[1] < 0.99, "clipped excluded");
  assert.ok(key.emitterFraction > 0 && key.clippedFraction > 0);
  const kn = C.normalizeLuminance(key.lin);
  assert.ok(kn[0] > kn[2] * 1.4, `key keeps the warm cast ${kn}`);
});

test("k-means is deterministic and separates distinct clusters", () => {
  const pts = [], w = [];
  const centers = [[0.3, 0.1, 0], [0.8, -0.05, 0.1], [0.6, 0, -0.12]];
  const rng = H.rng(4);
  for (let i = 0; i < 900; i++) {
    const c = centers[i % 3];
    pts.push([c[0] + (rng() - 0.5) * 0.02, c[1] + (rng() - 0.5) * 0.02, c[2] + (rng() - 0.5) * 0.02]);
    w.push(1);
  }
  const a = S.kmeans(pts, w, 3, 77, 25), b = S.kmeans(pts, w, 3, 77, 25);
  assert.deepEqual(a, b);
  for (const c of centers) assert.ok(a.some((k) => Math.hypot(k.lab[0] - c[0], k.lab[1] - c[1], k.lab[2] - c[2]) < 0.01));
  const few = S.kmeans([[0.5, 0, 0], [0.5, 0, 0]], [1, 1], 5, 1, 10);
  assert.equal(few.length, 1, "fewer distinct colors than k");
});

test("grain measures known noise on a flat field", () => {
  const rng = H.rng(8);
  const sd = 4 / 255;
  const im = img(200, 120, () => {
    let g = 0; for (let k = 0; k < 12; k++) g += rng(); g = (g - 6) * sd; // ~N(0, sd)
    const v = 0.5 + g;
    return [v, v, v];
  });
  const P = S.prepare(im);
  const gr = S.grain(P).grain;
  // residual of x - box3(x) has std sqrt(1 - 2/9 + 1/9) * sd = sqrt(8/9) * sd
  near(gr, Math.sqrt(8 / 9) * sd, 0.4 * sd);
});

test("character analysis on the synthetic cel: line art, skin, bbox", () => {
  const c = CH.drawCharacter("brunette_red").downscale(4); // 300x400
  const im = { w: c.w, h: c.h, r: [], g: [], b: [], a: [] };
  for (let i = 0; i < c.w * c.h; i++) {
    const a = c.a[i];
    im.r.push(a > 0 ? c.r[i] / a : 0); im.g.push(a > 0 ? c.g[i] / a : 0); im.b.push(a > 0 ? c.b[i] / a : 0); im.a.push(a);
  }
  const r = S.analyzeCharacter(im, {});
  assert.ok(r.lineArt && r.lineArt.L < 0.3, `line art L ${r.lineArt && r.lineArt.L}`);
  const skinLab = C.srgbToOklab(CH.SKIN);
  assert.ok(r.skin && Math.hypot(r.skin.lab[1] - skinLab[1], r.skin.lab[2] - skinLab[2]) < 0.03, "skin found near the skin color");
  assert.ok(r.skin.bbox[1] > 0.15 && r.skin.bbox[3] < 0.75, "skin is in the face region");
  assert.ok(r.bbox[0] > 0.1 && r.bbox[3] > 0.99);
  assert.ok(r.palette.length >= 4);
  assert.ok(r.edge && r.edge.L < r.meanLab[0], "edge band is darker (outline)");
});

test("background analysis: ring + light + JSON serializable", () => {
  const w = 192, h = 108;
  const bg = img(w, h, (x) => { const t = C.linearToSrgb(0.05 + 0.4 * (x / w)); return [t, t * 0.95, t * 0.8]; });
  const alpha = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha.push(Math.abs(x - 70) < 15 && y > 30 ? 1 : 0);
  const r = S.analyzeBackground(bg, [{ id: "C1", alpha }], {});
  assert.equal(r.rings.length, 1);
  assert.ok(r.rings[0].ringPixels > 100);
  assert.ok(L.angleDist(r.light.angle, 90) < 5, `light from the right: ${r.light.angle}`);
  assert.ok(r.global.illuminant.cct < 6000, "warm cast detected");
  assert.doesNotThrow(() => JSON.stringify(r));
  assert.ok(!("_hist" in r.global));
});
