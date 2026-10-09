#!/usr/bin/env node
"use strict";
// Regenerate tests/golden/classifier_features.json from tests/out/ref/*.json.
// Run `node tools/analyze_ref.js` first (needs the generated backgrounds).
// Expected labels are the scene designs; null = edge case (must stay low-confidence).

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const EXPECT = {
  black: "VOID_BLACK", day_sky: "DAY", golden_hour: "GOLDEN", neon_alley: "NEON", night_street: "NIGHT",
  overcast_rain: "OVERCAST", snow: "SNOW", twilight: "TWILIGHT", underwater: "UNDERWATER",
  warm_interior: "INTERIOR_WARM", white: "VOID_WHITE", fire_lit_0000: "FIRE", magenta_abstract: null, noisy: null
};
const out = {
  _doc: "Classifier features of the synthetic BGs (brunette_red ring). Regenerate: node tools/analyze_ref.js && node tools/golden_classifier.js",
  scenes: {}
};
for (const [k, v] of Object.entries(EXPECT)) {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "out", "ref", `${k}__brunette_red.json`), "utf8"));
  out.scenes[k] = { expected: v, features: r.classification.features };
}
fs.writeFileSync(path.join(ROOT, "tests", "golden", "classifier_features.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote tests/golden/classifier_features.json (${Object.keys(out.scenes).length} scenes)`);
