#!/usr/bin/env node
"use strict";
// Generate synthetic test assets (deterministic). No copyrighted frames anywhere.
//
//   node tools/make_test_assets.js                 everything
//   node tools/make_test_assets.js --only chars    chars | bgs | fire | charts | sheet
//   node tools/make_test_assets.js --fire-frames 8 shorter fire sequence (default 48)
//
// Outputs
//   test_assets/synthetic/characters/<palette>.png            straight alpha, 1200x1600
//   test_assets/synthetic/characters/brunette_red_premult.png premultiplied-on-black (fringe test)
//   test_assets/synthetic/characters/blonde_white_greenscreen.png  no alpha, #00B140 + spill
//   test_assets/synthetic/characters/brunette_red_tightcrop.png    cropped to alpha bbox
//   test_assets/synthetic/backgrounds/<scene>.png             1920x1080 opaque
//   test_assets/synthetic/backgrounds/fire_lit/fire_lit_0000.png ... (48 frames)
//   test_assets/synthetic/manifest.json
//   assets/calibration_chart.png (+ .json layout), assets/hald_8_identity.png,
//   assets/lut_identity_65.png (+ .json layout)          (shipped, committed)
//   docs/img/synthetic_assets.png                          contact sheet (committed)

const fs = require("node:fs");
const path = require("node:path");
const R = require("./lib/raster.js");
const CH = require("./lib/character.js");
const BG = require("./lib/backgrounds.js");
const CT = require("./lib/charts.js");

const ROOT = path.resolve(__dirname, "..");
const SYN = path.join(ROOT, "test_assets", "synthetic");
const ASSETS = path.join(ROOT, "assets");

function parseArgs(argv) {
  const o = { only: null, fireFrames: 48 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") o.only = argv[++i];
    else if (argv[i] === "--fire-frames") o.fireFrames = Number(argv[++i]);
  }
  return o;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const timed = (label, fn) => { const t = Date.now(); const r = fn(); console.log(`  ${label}  ${Date.now() - t} ms`); return r; };

function makeCharacters(manifest) {
  const dir = path.join(SYN, "characters");
  const out = {};
  for (const name of Object.keys(CH.PALETTES)) {
    const c = timed(`character ${name}`, () => CH.drawCharacter(name));
    out[name] = c;
    manifest.characters.push({ id: name, file: rel(c.save(path.join(dir, `${name}.png`))), alpha: "straight", w: c.w, h: c.h });
  }
  const pm = out.brunette_red;
  manifest.characters.push({ id: "brunette_red_premult", file: rel(pm.save(path.join(dir, "brunette_red_premult.png"), { mode: "premult" })), alpha: "premultiplied-on-black (wrong on purpose)", variantOf: "brunette_red" });
  const gs = CH.greenScreenVariant(out.blonde_white);
  manifest.characters.push({ id: "blonde_white_greenscreen", file: rel(gs.save(path.join(dir, "blonde_white_greenscreen.png"), { mode: "opaque" })), alpha: "none (green screen #00B140)", variantOf: "blonde_white" });
  const tc = CH.tightCropVariant(pm);
  manifest.characters.push({ id: "brunette_red_tightcrop", file: rel(tc.save(path.join(dir, "brunette_red_tightcrop.png"))), alpha: "straight", variantOf: "brunette_red", w: tc.w, h: tc.h });
  return out;
}

function makeBackgrounds(manifest) {
  const dir = path.join(SYN, "backgrounds");
  const out = {};
  for (const [name, fn] of Object.entries(BG.SCENES)) {
    const c = timed(`background ${name}`, () => fn());
    out[name] = c;
    manifest.backgrounds.push({ id: name, file: rel(c.save(path.join(dir, `${name}.png`), { mode: "opaque" })), light: fn.light || null });
  }
  return out;
}

function makeFire(manifest, frames) {
  const dir = path.join(SYN, "backgrounds", "fire_lit");
  const alb = BG.fireScene();
  let first = null;
  const t = Date.now();
  for (let f = 0; f < frames; f++) {
    const c = BG.fireFrame(alb, f);
    if (f === 0) first = c;
    c.save(path.join(dir, `fire_lit_${String(f).padStart(4, "0")}.png`), { mode: "opaque" });
  }
  console.log(`  fire_lit x${frames}  ${Date.now() - t} ms`);
  manifest.backgrounds.push({ id: "fire_lit", sequence: rel(path.join(dir, "fire_lit_[####].png")), frames, fps: 24, light: BG.fireFrame.light });
  return first;
}

function makeCharts() {
  fs.mkdirSync(ASSETS, { recursive: true });
  const chart = CT.calibrationChart();
  fs.writeFileSync(path.join(ASSETS, "calibration_chart.png"), chart.png);
  fs.writeFileSync(path.join(ASSETS, "calibration_chart.json"), JSON.stringify(chart.layout, null, 1) + "\n");
  fs.writeFileSync(path.join(ASSETS, "hald_8_identity.png"), CT.haldIdentity(8));
  const lat = CT.latticeIdentity(65, 9);
  fs.writeFileSync(path.join(ASSETS, "lut_identity_65.png"), lat.png);
  fs.writeFileSync(path.join(ASSETS, "lut_identity_65.json"), JSON.stringify(lat.layout, null, 1) + "\n");
  console.log("  charts: assets/calibration_chart.png, hald_8_identity.png, lut_identity_65.png");
}

function contactSheet(chars, bgs, fire) {
  const tw = 320, th = 180;
  const cols = 5;
  const bgList = Object.entries(bgs);
  if (fire) bgList.push(["fire_lit", fire]);
  const rows = Math.ceil(bgList.length / cols) + 1;
  const sheet = new R.Canvas(cols * tw, rows * th + 40).paint(() => [0.16, 0.16, 0.18]);
  bgList.forEach(([, c], i) => sheet.draw(c.downscale(6), (i % cols) * tw, Math.floor(i / cols) * th));
  const y0 = (rows - 1) * th;
  Object.values(chars).forEach((c, i) => {
    const s = c.downscale(8); // 150x200
    sheet.draw(s.over([0.45, 0.5, 0.55]), i * 170 + 10, y0 + 10);
  });
  const dest = path.join(ROOT, "docs", "img", "synthetic_assets.png");
  sheet.save(dest, { mode: "opaque" });
  console.log(`  contact sheet: ${rel(dest)}`);
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const want = (k) => !o.only || o.only === k;
  const manifest = { generator: "tools/make_test_assets.js", note: "Synthetic, original, deterministic.", characters: [], backgrounds: [] };
  let chars = {}, bgs = {}, fire = null;
  if (want("chars") || want("sheet")) chars = makeCharacters(manifest);
  if (want("bgs") || want("sheet")) bgs = makeBackgrounds(manifest);
  if (want("fire")) fire = makeFire(manifest, o.fireFrames);
  if (want("charts")) makeCharts();
  if (!o.only || o.only === "sheet") contactSheet(chars, bgs, fire);
  if (!o.only) {
    fs.writeFileSync(path.join(SYN, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
    console.log(`  manifest: ${rel(path.join(SYN, "manifest.json"))}`);
  }
}

if (require.main === module) main();
