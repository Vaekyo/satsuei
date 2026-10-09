"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../../src/core/stats.js");
const K = require("../../src/core/classify.js");
const C = require("../../src/core/color.js");
const { compare } = require("../../tools/compare_ref.js");

function img(w, h, f) {
  const o = { w, h, r: [], g: [], b: [], a: [] };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y); o.r.push(c[0]); o.g.push(c[1]); o.b.push(c[2]); o.a.push(c[3]); }
  return o;
}

test("compare_ref passes identical analyses and flags a 2/255 shift", () => {
  const w = 96, h = 54;
  const bg = img(w, h, (x) => { const t = C.linearToSrgb(0.05 + 0.5 * x / w); return [t, t * 0.9, t * 0.8, 1]; });
  const ch = img(w, h, (x, y) => (Math.abs(x - 40) < 10 && y > 15 ? [0.8, 0.5, 0.4, 1] : [0, 0, 0, 0]));
  const bga = S.analyzeBackground(bg, [{ id: "C1", alpha: ch.a }], {});
  const cha = S.analyzeCharacter(ch, {});
  const cls = K.classify(bga, {});
  const ref = { background: bga, character: cha, classification: cls };
  const ae = { background: bga, characters: [cha], classification: cls };
  assert.ok(compare(ae, ref).every((c) => c.ok));
  const shifted = JSON.parse(JSON.stringify(ae));
  shifted.background.global.mean = shifted.background.global.mean.map((v) => v + 2 / 255);
  assert.ok(compare(shifted, ref).some((c) => !c.ok && c.name.startsWith("bg mean")));
});
