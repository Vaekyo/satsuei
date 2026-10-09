"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const CH = require("../../tools/lib/character.js");
const BG = require("../../tools/lib/backgrounds.js");
const CT = require("../../tools/lib/charts.js");
const P = require("../../src/core/png.js");

test("character cel: deterministic, padded on top/sides, AA edges, line art present", () => {
  const a = CH.drawCharacter("black_navy"), b = CH.drawCharacter("black_navy");
  assert.deepEqual(a.toPNG(), b.toPNG());
  const bb = a.alphaBBox(0);
  assert.ok(bb.x0 > 100 && bb.y0 > 100 && a.w - bb.x1 > 100, JSON.stringify(bb));
  assert.equal(bb.y1, a.h, "bust is cut by the bottom edge");
  let semi = 0, dark = 0, opaque = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const al = a.a[i];
    if (al > 0.02 && al < 0.98) semi++;
    if (al > 0.98) {
      opaque++;
      if (a.r[i] < 0.1 && a.g[i] < 0.1 && a.b[i] < 0.1) dark++;
    }
  }
  assert.ok(semi > 2000, `anti-aliased edge pixels: ${semi}`);
  assert.ok(dark / opaque > 0.01, `line-art fraction ${dark / opaque}`);
});

test("edge-case backgrounds are exact", () => {
  const k = BG.SCENES.black(), w = BG.SCENES.white();
  assert.equal(k.r[12345], 0); assert.equal(w.g[54321], 1);
});

test("LUT identity lattice decodes to exact grid values", () => {
  const lat = CT.latticeIdentity(65, 9);
  const img = P.decode(lat.png);
  for (const [r, g, b] of [[0, 0, 0], [64, 64, 64], [10, 33, 57], [64, 0, 32]]) {
    const x = (b % 9) * 65 + r, y = Math.floor(b / 9) * 65 + g, i = y * img.w + x;
    assert.ok(Math.abs(img.r[i] - r / 64) < 1e-5 && Math.abs(img.g[i] - g / 64) < 1e-5 && Math.abs(img.b[i] - b / 64) < 1e-5);
  }
});
