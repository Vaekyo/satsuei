#!/usr/bin/env node
"use strict";
// Simulated Auto Comp (match chain only) in Node, BEFORE After Effects is
// available: analyze -> classify -> solve -> apply the fxmodel chain to the
// full-resolution character -> composite -> metrics + contact sheets.
// The models are uncalibrated (docs/DECISIONS.md P-10): this tunes the solver's
// logic and defaults; AE renders remain the ground truth.
//
//   node tools/sim_preview.js [--char brunette_red|all] [--bg name] [--master 0.7]
// Outputs tests/out/sheets/sim_<char>_<n>.png and tests/out/sim_metrics.json

const fs = require("node:fs");
const path = require("node:path");
const R = require("./lib/raster.js");
const CP = require("./lib/comp.js");
const M = require("./lib/metrics.js");
const { analyzePair, listBackgrounds } = require("./analyze_ref.js");
const T = require("../src/core/transfer.js");
const K = require("../src/core/classify.js");
const FX = require("../src/core/fxmodel.js");

const OUT = path.join(CP.ROOT, "tests", "out");

function applyChainCanvas(c, settings) {
  const o = c.clone();
  for (let i = 0; i < o.w * o.h; i++) {
    const a = o.a[i];
    if (a <= 0) continue;
    const rgb = FX.applyChain([o.r[i] / a, o.g[i] / a, o.b[i] / a], settings);
    o.r[i] = rgb[0] * a; o.g[i] = rgb[1] * a; o.b[i] = rgb[2] * a;
  }
  return o;
}

function simulate(bgFile, charFile, opts = {}) {
  const r = analyzePair(bgFile, charFile);
  const cfg = CP.DEFAULTS;
  const cls = r.classification.cls;
  const cd = K.classDefaults(cls, cfg);
  const match = { ...cfg.match, ...(opts.master !== undefined ? { masterStrength: opts.master } : {}) };
  const extras = (cfg.classExtras && cfg.classExtras[cls]) || {};
  const k = T.effectiveStrengths(cd, match, extras);
  const samples = CP.charSamples(r._passes.chars[0].buf, cfg.analysis.coreAlpha, cfg.analysis.charSamples);
  const ring = r.background.rings[0];
  const sol = T.solve({ global: r.background.global, ring }, r.character, samples, { config: T.classTransferConfig(cls, cfg), classSat: cd.sat, strengths: k });
  const settings = FX.chainSettings(sol.params, k);
  const matched = applyChainCanvas(r._placed, settings);
  const before = r._bgCanvas.clone().draw(r._placed, 0, 0);
  const after = r._bgCanvas.clone().draw(matched, 0, 0);
  const ms = cfg.analysis.maxSide;
  const bBuf = CP.toBuffer(CP.downscaleTo(r._placed, ms));
  const aBuf = CP.toBuffer(CP.downscaleTo(matched, ms));
  const metrics = M.integrationMetrics(bBuf, aBuf, ring, sol.guards.readability ? sol.guards.readability.edgeL : undefined);
  return { r, cls, conf: r.classification.confidence, k, sol, settings, before, after, metrics };
}

function sheet(rows, file) {
  const W = 1920, H = 1080, f = 4; // 480x270 thumbnails
  const tw = W / f, th = H / f, crop = 270;
  const out = new R.Canvas(tw * 2 + crop * 2 + 30, rows.length * (th + 10)).paint(() => [0.12, 0.12, 0.13]);
  rows.forEach((row, i) => {
    const y = i * (th + 10);
    out.draw(row.before.downscale(f), 0, y);
    out.draw(row.after.downscale(f), tw + 10, y);
    // face crop (character head region at 50%)
    const p = CP.defaultPlacement({ w: 1200, h: 1600 }, W, H);
    const cx = Math.round(p.x0 + 600 * p.scale), cy = Math.round(p.y0 + 620 * p.scale);
    const x0 = Math.max(0, cx - crop), y0 = Math.max(0, cy - crop);
    out.draw(row.before.crop(x0, y0, x0 + crop * 2, y0 + crop * 2).downscale(2), tw * 2 + 20, y);
    out.draw(row.after.crop(x0, y0, x0 + crop * 2, y0 + crop * 2).downscale(2), tw * 2 + 20 + crop, y);
  });
  out.save(file, { mode: "opaque" });
  return file;
}

function main() {
  const args = process.argv.slice(2);
  const opt = { char: "brunette_red", bg: null, master: undefined, perSheet: 5 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--char") opt.char = args[++i];
    else if (args[i] === "--bg") opt.bg = args[++i];
    else if (args[i] === "--master") opt.master = Number(args[++i]);
  }
  const chars = opt.char === "all" ? Object.keys(require("./lib/character.js").PALETTES) : [opt.char];
  let bgs = listBackgrounds();
  if (opt.bg) bgs = bgs.filter((b) => path.basename(b, ".png") === opt.bg);
  fs.mkdirSync(path.join(OUT, "sheets"), { recursive: true });
  const all = [];
  for (const ch of chars) {
    const charFile = path.join(CP.ROOT, "test_assets", "synthetic", "characters", `${ch}.png`);
    let rows = [], n = 0;
    console.log(`\n${ch}\nbg                 class          tint b>a        blackdL b>a     Lratio b>a      Cratio b>a     skinHue b>a    clip+   read   ev     sat   wbStops`);
    for (const bgFile of bgs) {
      const name = path.basename(bgFile, ".png");
      const s = simulate(bgFile, charFile, opt);
      const m = s.metrics, b = m.before, a = m.after, p = s.sol.params;
      const f = (v, d = 3) => (v === null || v === undefined ? "  -  " : v.toFixed(d));
      console.log(`${name.padEnd(18)} ${s.cls.padEnd(14)} ${f(b.illumTintDist)}>${f(a.illumTintDist)}   ${f(b.blackDeltaL)}>${f(a.blackDeltaL)}   ${f(b.meanLRatio, 2)}>${f(a.meanLRatio, 2)}     ${f(b.chromaRatio, 2)}>${f(a.chromaRatio, 2)}     ${f(b.skinHue, 0)}>${f(a.skinHue, 0)}       ${f(m.clipIncrease)}  ${f(m.readability, 2)}  ${f(p.ev, 2)}  ${f(p.sat, 2)}  [${p.wbStops.map((v) => v.toFixed(2)).join(",")}]`);
      all.push({ char: ch, bg: name, cls: s.cls, confidence: s.conf, strengths: s.k, params: p, steps: s.sol.steps, guards: s.sol.guards, metrics: m });
      rows.push(s);
      if (rows.length === opt.perSheet) { sheet(rows, path.join(OUT, "sheets", `sim_${ch}_${n++}.png`)); rows = []; }
    }
    if (rows.length) sheet(rows, path.join(OUT, "sheets", `sim_${ch}_${n}.png`));
  }
  fs.writeFileSync(path.join(OUT, "sim_metrics.json"), JSON.stringify(all, null, 1));
  console.log(`\nsheets: tests/out/sheets/sim_*.png   metrics: tests/out/sim_metrics.json`);
}

if (require.main === module) main();
module.exports = { simulate, applyChainCanvas };
