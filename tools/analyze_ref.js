#!/usr/bin/env node
"use strict";
// Node reference analyzer: the ground truth AE-side analysis is checked against
// (Phase 1 acceptance: means within 1/255, percentiles within 2 bins, light angle
// within 10 deg). Builds the analysis passes from source PNGs exactly like backend A1
// would (place, isolate, downscale), runs src/core stats + classifier.
//
//   node tools/analyze_ref.js                         all synthetic BGs x brunette_red
//   node tools/analyze_ref.js <bg.png> [<char.png>]   one pair
//   options: --char <palette>  --max-side 384  --json (print full JSON)  --out <dir>
//
// Writes tests/out/ref/<bg>__<char>.json and prints a summary table.

const fs = require("node:fs");
const path = require("node:path");
const CP = require("./lib/comp.js");
const S = require("../src/core/stats.js");
const K = require("../src/core/classify.js");

const SYN = path.join(CP.ROOT, "test_assets", "synthetic");

function analyzePair(bgFile, charFile, { maxSide = CP.DEFAULTS.analysis.maxSide } = {}) {
  const bgC = CP.loadCanvas(bgFile);
  const chC = CP.loadCanvas(charFile);
  const placed = CP.placeLayer(chC, bgC.w, bgC.h, CP.defaultPlacement(chC, bgC.w, bgC.h));
  const id = path.basename(charFile, ".png");
  const passes = CP.analysisPasses(bgC, [{ id, canvas: placed }], maxSide);
  const o = CP.DEFAULTS.analysis;
  const t0 = Date.now();
  const bg = S.analyzeBackground(passes.bg, passes.chars.map((c) => ({ id: c.id, alpha: c.buf.a })), o);
  const t1 = Date.now();
  const ch = S.analyzeCharacter(passes.chars[0].buf, o);
  const t2 = Date.now();
  const cls = K.classify(bg, CP.DEFAULTS.classifier);
  return {
    input: { bg: path.relative(CP.ROOT, bgFile), char: path.relative(CP.ROOT, charFile), maxSide, w: passes.bg.w, h: passes.bg.h },
    timingMs: { background: t1 - t0, character: t2 - t1 },
    classification: cls,
    background: bg,
    character: ch,
    _passes: passes,
    _placed: placed,
    _bgCanvas: bgC
  };
}

function listBackgrounds() {
  const dir = path.join(SYN, "backgrounds");
  if (!fs.existsSync(dir)) throw new Error("No backgrounds: run `npm run assets` first.");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => path.join(dir, f));
  const fire = path.join(dir, "fire_lit", "fire_lit_0000.png");
  if (fs.existsSync(fire)) files.push(fire);
  return files;
}

const strip = (r) => { const o = { ...r }; delete o._passes; delete o._placed; delete o._bgCanvas; return o; };
const f2 = (v, d = 2) => (v === null || v === undefined ? "  -  " : Number(v).toFixed(d));

function main() {
  const args = process.argv.slice(2);
  const opt = { char: "brunette_red", maxSide: CP.DEFAULTS.analysis.maxSide, json: false, out: path.join(CP.ROOT, "tests", "out", "ref") };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--char") opt.char = args[++i];
    else if (args[i] === "--max-side") opt.maxSide = Number(args[++i]);
    else if (args[i] === "--json") opt.json = true;
    else if (args[i] === "--out") opt.out = args[++i];
    else pos.push(args[i]);
  }
  const bgs = pos[0] ? [path.resolve(pos[0])] : listBackgrounds();
  const charFile = pos[1] ? path.resolve(pos[1]) : path.join(SYN, "characters", `${opt.char}.png`);
  fs.mkdirSync(opt.out, { recursive: true });
  console.log("bg                 class           conf  medL   p95   chroma  cct    illumHue  light(conf)    ringY   emit   ms");
  for (const bgFile of bgs) {
    const r = analyzePair(bgFile, charFile, opt);
    const name = path.basename(bgFile, ".png");
    fs.writeFileSync(path.join(opt.out, `${name}__${path.basename(charFile, ".png")}.json`), JSON.stringify(strip(r), null, 1));
    const g = r.background.global, ring = r.background.rings[0], c = r.classification;
    const la = ring.light;
    console.log(
      `${name.padEnd(18)} ${c.cls.padEnd(15)} ${f2(c.confidence)}  ${f2(g.L.p50)}  ${f2(g.L.p95)}  ${f2(g.meanChroma, 3)}  ${String(g.illuminant.cct).padEnd(5)}  ${f2(g.illuminant.hue, 0).padStart(5)}     ` +
      `${(la.angle === null ? "  -" : f2(la.angle, 0)).padStart(4)} (${f2(la.confidence)})    ${f2(ring.medianY, 3)}  ${f2(r.background.emitterFraction, 3)}  ${r.timingMs.background + r.timingMs.character}`
    );
    if (opt.json) console.log(JSON.stringify(strip(r), null, 1));
  }
}

if (require.main === module) main();
module.exports = { analyzePair, listBackgrounds, strip };
