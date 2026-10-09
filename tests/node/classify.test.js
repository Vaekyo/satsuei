"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../../src/core/classify.js");
const golden = require("../golden/classifier_features.json");

test("classifier labels every synthetic scene as designed (stored features)", () => {
  for (const [name, { expected, features }] of Object.entries(golden.scenes)) {
    const r = K.classifyFeatures(features, { minScore: 0.15 });
    if (expected) {
      assert.equal(r.cls, expected, `${name}: got ${r.cls}`);
      assert.ok(r.confidence > 0.05, `${name}: confidence ${r.confidence}`);
    } else {
      assert.ok(r.confidence < 0.2, `${name} is an edge case and must not be classified confidently (${r.cls} ${r.confidence})`);
    }
  }
});

test("scores are bounded and every class has a score", () => {
  const f = golden.scenes.day_sky.features;
  const s = K.score(f);
  for (const c of K.CLASSES) {
    assert.ok(s[c] >= 0 && s[c] <= 1, `${c}=${s[c]}`);
  }
});
