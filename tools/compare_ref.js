#!/usr/bin/env node
"use strict";
// Phase 1 acceptance, Node side: compare AE-side analysis (tests/out/ae/phase1/*.json,
// written by tests/ae/phase1_acceptance.jsx) with the Node reference computed from the
// source PNGs (tools/analyze_ref.js). Tolerances (spec sec. 11, Phase 1):
//   means within 1/255, percentiles within 2 histogram bins, light angle within 10 deg.
// Prints a pass/fail table and a backend benchmark; exit code 1 on any failure.

const fs = require("node:fs");
const path = require("node:path");
const CP = require("./lib/comp.js");
const L = require("../src/core/linalg.js");
const { analyzePair, strip } = require("./analyze_ref.js");

const DIR = path.join(CP.ROOT, "tests", "out", "ae", "phase1");
const REF = path.join(CP.ROOT, "tests", "out", "ref");
const BIN = 1 / 1024;

function refFor(scene, char) {
  const f = path.join(REF, `${scene}__${char}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const r = strip(analyzePair(path.join(CP.ROOT, "test_assets", "synthetic", "backgrounds", `${scene}.png`),
    path.join(CP.ROOT, "test_assets", "synthetic", "characters", `${char}.png`)));
  fs.mkdirSync(REF, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(r));
  return r;
}

function compare(ae, ref) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const meanDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const g = ae.background.global, gr = ref.background.global;
  const dm = meanDiff(g.mean, gr.mean);
  add("bg mean (1/255)", dm <= 1 / 255, `${(dm * 255).toFixed(2)}/255`);
  for (const p of ["p1", "p5", "p25", "p50", "p75", "p95", "p99"]) {
    const d = Math.abs(g.L[p] - gr.L[p]);
    add(`bg L ${p} (2 bins)`, d <= 2 * BIN, `${(d / BIN).toFixed(1)} bins`);
  }
  const la = ae.background.light, lr = ref.background.light;
  if (la.angle !== null && lr.angle !== null && Math.min(la.confidence, lr.confidence) > 0.3) {
    const d = L.angleDist(la.angle, lr.angle);
    add("light angle (10 deg)", d <= 10, `${d.toFixed(1)} deg`);
  } else {
    add("light angle (10 deg)", true, "skipped: low confidence");
  }
  const c = ae.characters[0], cr = ref.character;
  const dc = meanDiff(c.mean, cr.mean);
  add("char mean (1/255)", dc <= 1 / 255, `${(dc * 255).toFixed(2)}/255`);
  const ring = ae.background.rings[0], ringR = ref.background.rings[0];
  const dr = meanDiff(ring.mean, ringR.mean);
  add("ring mean (1/255)", dr <= 1 / 255, `${(dr * 255).toFixed(2)}/255`);
  add("class", ae.classification.cls === ref.classification.cls, `${ae.classification.cls} vs ${ref.classification.cls}`);
  return checks;
}

function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`no AE results in ${path.relative(CP.ROOT, DIR)}: run tests/ae/phase1_acceptance.jsx in After Effects first`);
    process.exitCode = 1;
    return;
  }
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  let fails = 0;
  const bench = {};
  for (const f of files) {
    const [scene, backend] = path.basename(f, ".json").split("__");
    const ae = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    const ref = refFor(scene, "brunette_red");
    const checks = compare(ae, ref);
    const bad = checks.filter((c) => !c.ok);
    fails += bad.length;
    console.log(`${bad.length ? "FAIL" : "ok  "} ${scene.padEnd(16)} ${backend.padEnd(6)} ` + checks.map((c) => `${c.ok ? "" : "!"}${c.name}=${c.detail}`).join("  "));
    (bench[backend] = bench[backend] || []).push(ae.timingMs);
  }
  console.log("\nbenchmark (ms, mean over scenes): backend  acquisition  total");
  for (const [b, ts] of Object.entries(bench)) {
    const m = (k) => (ts.reduce((s, t) => s + t[k], 0) / ts.length).toFixed(0);
    console.log(`  ${b.padEnd(7)} ${m("acquisition").padStart(11)}  ${m("total").padStart(6)}`);
  }
  process.exitCode = fails ? 1 : 0;
}

if (require.main === module) main();
module.exports = { compare };
