"use strict";
// Integration metrics (spec sec. 10.5) on straight-alpha analysis buffers.
// Shared by the Node simulation and (later) AE-rendered measurements.

const C = require("../../src/core/color.js");

const rel = (lab) => { const l = Math.max(0.05, lab[0]); return [lab[1] / l, lab[2] / l]; };
const dist2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Character core-pixel summary: whites tint, blacks, mean L/chroma, skin hue, clipping. */
function charSummary(buf, coreAlpha = 0.95) {
  const n = buf.w * buf.h;
  const labs = [];
  let clip = 0;
  for (let i = 0; i < n; i++) {
    if (buf.a[i] < coreAlpha) continue;
    const lab = C.srgbToOklab([buf.r[i], buf.g[i], buf.b[i]]);
    labs.push(lab);
    if (buf.r[i] >= 0.999 || buf.g[i] >= 0.999 || buf.b[i] >= 0.999) clip++;
  }
  const Ls = labs.map((l) => l[0]).sort((a, b) => a - b);
  const q = (p) => Ls[Math.min(Ls.length - 1, Math.floor(p * (Ls.length - 1)))];
  const p90 = q(0.9);
  let wt = [0, 0, 0], wn = 0, mL = 0, mC = 0;
  const skin = [];
  for (const lab of labs) {
    const ch = Math.hypot(lab[1], lab[2]);
    mL += lab[0]; mC += ch;
    if (lab[0] >= p90 && ch < 0.08) { wt[0] += lab[0]; wt[1] += lab[1]; wt[2] += lab[2]; wn++; }
  }
  const whites = wn ? [wt[0] / wn, wt[1] / wn, wt[2] / wn] : null;
  return {
    count: labs.length,
    meanL: mL / labs.length,
    meanChroma: mC / labs.length,
    p2: q(0.02),
    whites,
    whitesTint: whites ? rel(whites) : null,
    clipFraction: clip / labs.length,
    skin
  };
}

/** Mean Oklab of pixels whose ORIGINAL color was skin (mask from the un-matched char). */
function skinHue(buf, skinMask) {
  let a = 0, b = 0, l = 0, k = 0;
  for (const i of skinMask) {
    const lab = C.srgbToOklab([buf.r[i], buf.g[i], buf.b[i]]);
    l += lab[0]; a += lab[1]; b += lab[2]; k++;
  }
  if (!k) return null;
  return { lab: [l / k, a / k, b / k], hue: C.hueDeg(a / k, b / k) };
}

function skinMaskOf(buf, coreAlpha = 0.95) {
  const out = [];
  for (let i = 0; i < buf.w * buf.h; i++) {
    if (buf.a[i] < coreAlpha) continue;
    const lab = C.srgbToOklab([buf.r[i], buf.g[i], buf.b[i]]);
    const ch = Math.hypot(lab[1], lab[2]), hu = C.hueDeg(lab[1], lab[2]);
    if (lab[0] > 0.7 && ch > 0.02 && ch < 0.10 && hu >= 25 && hu <= 75) out.push(i);
  }
  return out;
}

/**
 * Compare a character (before / after) against the BG ring.
 * ring: core/stats ring region. Returns before/after metric pairs.
 */
function integrationMetrics(before, after, ring, edgeL) {
  const keyLab = ring.key && ring.key.lin ? C.linearToOklab(C.normalizeLuminance(ring.key.lin)) : [1, 0, 0];
  const keyTint = rel(keyLab);
  const ringL = ring.meanLab[0];
  const ringP2 = ring.L.p2;
  const blackTint = ring.black ? rel(C.srgbToOklab(ring.black.rgb)) : [0, 0];
  const mask = skinMaskOf(before);
  const one = (buf) => {
    const s = charSummary(buf);
    const sk = skinHue(buf, mask);
    return {
      illumTintDist: s.whitesTint ? dist2(s.whitesTint, keyTint) : null,
      blackDeltaL: Math.abs(s.p2 - ringP2),
      meanLRatio: s.meanL / Math.max(1e-3, ringL),
      chromaRatio: s.meanChroma / Math.max(1e-3, ring.meanChroma),
      clipFraction: s.clipFraction,
      skinHue: sk ? sk.hue : null,
      skinChroma: sk ? Math.hypot(sk.lab[1], sk.lab[2]) : null,
      meanL: s.meanL,
      whitesTint: s.whitesTint
    };
  };
  const b = one(before), a = one(after);
  return {
    before: b,
    after: a,
    keyTint, blackTint, ringL,
    clipIncrease: a.clipFraction - b.clipFraction,
    skinOk: a.skinHue === null || (a.skinHue >= 15 && a.skinHue <= 95),
    readability: edgeL === undefined ? null : Math.abs(edgeL - ringL)
  };
}

module.exports = { charSummary, skinMaskOf, skinHue, integrationMetrics, rel };
