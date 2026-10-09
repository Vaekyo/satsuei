"use strict";
// Synthetic anime cel character (front-facing bust) on a 1200x1600 straight-alpha
// canvas: flat fills, 2-tone cel shadows (designed under neutral light from the
// upper left), hair highlights, ~3 px anti-aliased near-black line art.
// Original design; drawn with SDF shapes, painter's order.

const R = require("./raster.js");
const { hex, circle, ellipse, poly, offset, translate, union, smoothUnion, inter, halfplane, outline, bezierPts, stroke, Canvas } = R;

const W = 1200, H = 1600;
const LINE = [0.08, 0.07, 0.08];
const LW = 3.2; // main line width (px)
const LW2 = 2.2; // detail lines

const PALETTES = {
  brunette_red: {
    hair: hex("#6b4532"), hairShadow: hex("#4a2c22"), hairHi: hex("#a87656"),
    cloth: hex("#c8323c"), clothShadow: hex("#8e2230"),
    shirt: hex("#f4f1ec"), shirtShadow: hex("#c9c3d6"), tie: hex("#2b3a67"), tieShadow: hex("#1b2547"),
    iris: hex("#8a5a2b"), irisDark: hex("#4e2f17"), irisLight: hex("#d9a35f")
  },
  blonde_white: {
    hair: hex("#f2d48a"), hairShadow: hex("#d4a65e"), hairHi: hex("#fff3c8"),
    cloth: hex("#fbfbf8"), clothShadow: hex("#cfd3e3"),
    shirt: hex("#ffffff"), shirtShadow: hex("#d8dbe8"), tie: hex("#7fb2e5"), tieShadow: hex("#5a8ec4"),
    iris: hex("#3f86d6"), irisDark: hex("#1f4d8a"), irisLight: hex("#a9d6ff")
  },
  black_navy: {
    hair: hex("#26252e"), hairShadow: hex("#16151c"), hairHi: hex("#4f566e"),
    cloth: hex("#26304f"), clothShadow: hex("#171d33"),
    shirt: hex("#eef0f5"), shirtShadow: hex("#b9bfd3"), tie: hex("#8e2230"), tieShadow: hex("#5e1520"),
    iris: hex("#7a2f4f"), irisDark: hex("#3d1428"), irisLight: hex("#d57aa0")
  },
  pastel_pink: {
    hair: hex("#f6b3c8"), hairShadow: hex("#df8aa8"), hairHi: hex("#ffe1ea"),
    cloth: hex("#b9a6e0"), clothShadow: hex("#9078c2"),
    shirt: hex("#fff8fb"), shirtShadow: hex("#dcd0e8"), tie: hex("#f28fb0"), tieShadow: hex("#c96a8c"),
    iris: hex("#2fa79c"), irisDark: hex("#16645d"), irisLight: hex("#9ff0e4")
  }
};
const SKIN = hex("#fde3d3"), SKIN_SHADOW = hex("#f0b9a6"), BLUSH = hex("#f49a9a");
const SCLERA = [0.98, 0.98, 1.0], SCLERA_SHADOW = hex("#c9d0e6");

const mirrorX = (pts) => pts.map(([x, y]) => [W - x, y]);

function drawCharacter(paletteName) {
  const P = PALETTES[paletteName];
  if (!P) throw new Error(`unknown palette ${paletteName}`);
  const c = new Canvas(W, H);
  const fillLine = (s, color, w = LW) => { c.fill(s, color); c.fill(outline(s, w), LINE); };

  /* ---- back hair ---- */
  const backHair = offset(poly([
    [330, 520], [352, 330], [470, 232], [600, 212], [730, 232], [848, 330], [870, 520],
    [905, 880], [870, 1090], [790, 1010], [720, 830], [480, 830], [410, 1010], [330, 1090], [295, 880]
  ]), 24);
  fillLine(backHair, P.hair);
  c.fill(inter(backHair, union(halfplane(0, 760, 0, -1), halfplane(760, 0, -1, -0.25))), P.hairShadow);
  c.fill(outline(backHair, LW), LINE);

  /* ---- torso / jacket ---- */
  const torso = offset(poly([[260, 1110], [385, 1004], [540, 978], [660, 978], [815, 1004], [940, 1110], [1000, 1640], [200, 1640]]), 28);
  fillLine(torso, P.cloth);
  c.fill(inter(torso, halfplane(770, 1000, -1, 0.28)), P.clothShadow); // far (right) side
  c.fill(inter(torso, ellipse(600, 1000, 200, 80)), P.clothShadow); // under the collar
  c.fill(outline(torso, LW), LINE);
  // sleeve seams / folds
  c.fill(stroke(bezierPts([[330, 1180], [355, 1350], [330, 1600]]), [LW2, 1]), LINE);
  c.fill(stroke(bezierPts([[870, 1180], [845, 1350], [870, 1600]]), [LW2, 1]), LINE);

  /* ---- shirt V + tie ---- */
  const shirt = poly([[528, 978], [672, 978], [600, 1190]]);
  fillLine(shirt, P.shirt, LW2);
  c.fill(inter(shirt, halfplane(600, 0, -1, 0)), P.shirtShadow);
  c.fill(outline(shirt, LW2), LINE);
  const tie = offset(poly([[584, 1030], [616, 1030], [628, 1185], [600, 1222], [572, 1185]]), 3);
  fillLine(tie, P.tie, LW2);
  c.fill(inter(tie, halfplane(603, 0, -1, 0)), P.tieShadow);
  c.fill(outline(tie, LW2), LINE);
  const knot = offset(poly([[582, 1000], [618, 1000], [612, 1034], [588, 1034]]), 2);
  fillLine(knot, P.tie, LW2);

  /* ---- lapels ---- */
  const lapL = offset(poly([[530, 980], [598, 1185], [522, 1268], [468, 1036]]), 3);
  const lapR = offset(poly(mirrorX([[530, 980], [598, 1185], [522, 1268], [468, 1036]])), 3);
  fillLine(lapL, P.cloth);
  fillLine(lapR, P.clothShadow);
  // buttons
  for (const y of [1330, 1450]) fillLine(circle(600, y, 11), P.clothShadow, LW2);

  /* ---- neck ---- */
  const neck = offset(poly([[548, 820], [652, 820], [660, 1000], [540, 1000]]), 10);
  fillLine(neck, SKIN);
  c.fill(inter(neck, ellipse(600, 845, 150, 95)), SKIN_SHADOW);
  c.fill(outline(neck, LW), LINE);

  /* ---- ears ---- */
  for (const ex of [355, 845]) {
    const ear = ellipse(ex, 640, 30, 52);
    fillLine(ear, SKIN, LW);
    c.fill(stroke(bezierPts([[ex + (ex < 600 ? 10 : -10), 612], [ex + (ex < 600 ? -8 : 8), 640], [ex + (ex < 600 ? 8 : -8), 668]]), LW2), SKIN_SHADOW);
  }

  /* ---- face ---- */
  const cranium = circle(600, 560, 250);
  const jaw = offset(poly([[372, 560], [828, 560], [800, 752], [684, 878], [600, 902], [516, 878], [400, 752]]), 18);
  const face = smoothUnion(cranium, jaw, 40);
  const faceClip = inter(face, halfplane(0, 905, 0, 1));
  c.fill(faceClip, SKIN);
  // cel shadow on the far side + under the bangs (bangs shape shifted down-right)
  const bangsShape = buildBangs();
  c.fill(inter(faceClip, halfplane(770, 600, -1, 0.35)), SKIN_SHADOW);
  c.fill(inter(faceClip, translate(bangsShape, 8, 30)), SKIN_SHADOW);
  c.fill(outline(faceClip, LW), LINE);

  /* ---- blush ---- */
  for (const bx of [462, 738]) c.fill(ellipse(bx, 742, 48, 17), BLUSH, { opacity: 0.38, feather: 8 });
  for (const bx of [440, 462, 484, 716, 738, 760]) {
    c.fill(stroke([[bx + 6, 734], [bx - 6, 752]], 2), hex("#e57f86"), { opacity: 0.8 });
  }

  /* ---- eyes ---- */
  for (const side of [-1, 1]) {
    const ex = 600 + side * 98, ey = 660;
    const sclera = ellipse(ex, ey, 60, 50);
    c.fill(sclera, SCLERA);
    c.fill(inter(sclera, halfplane(0, ey - 28, 0, 1)), SCLERA_SHADOW);
    const iris = inter(ellipse(ex + side * 4, ey + 6, 36, 46), sclera);
    c.fill(iris, P.iris);
    c.fill(inter(iris, halfplane(0, ey - 8, 0, 1)), P.irisDark);
    c.fill(inter(iris, ellipse(ex + side * 4, ey + 34, 26, 14)), P.irisLight);
    c.fill(inter(ellipse(ex + side * 4, ey + 10, 14, 20), sclera), P.irisDark.map((v) => v * 0.5));
    c.fill(outline(iris, 1.6), P.irisDark.map((v) => v * 0.6));
    c.fill(circle(ex + side * 4 - 15, ey - 16, 10), [1, 1, 1]); // highlights: light from upper left
    c.fill(circle(ex + side * 4 + 12, ey + 24, 5), [1, 1, 1]);
    // lashes
    const up = bezierPts([[ex - side * 66, ey - 12], [ex - side * 10, ey - 70], [ex + side * 72, ey - 22]]);
    c.fill(stroke(up, [6, 11]), LINE);
    c.fill(stroke([[ex + side * 70, ey - 22], [ex + side * 86, ey - 34]], [6, 1]), LINE);
    c.fill(stroke(bezierPts([[ex - side * 40, ey + 46], [ex, ey + 54], [ex + side * 44, ey + 44]]), [1, 3]), LINE);
  }

  /* ---- nose / mouth ---- */
  c.fill(stroke([[606, 738], [598, 752]], [1, 3]), LINE);
  c.fill(stroke(bezierPts([[572, 802], [600, 812], [628, 800]]), [2.5, 1.5]), LINE);

  /* ---- front hair (bangs + side locks) ---- */
  const LOCK = [[338, 470], [386, 548], [400, 800], [370, 945], [330, 770]];
  const lockL = offset(poly(LOCK), 7);
  const lockR = offset(poly(mirrorX(LOCK)), 7);
  for (const lock of [lockL, lockR]) fillLine(lock, P.hair);
  c.fill(inter(lockR, halfplane(0, 0, 1, 0)), P.hairShadow);
  c.fill(inter(lockL, halfplane(0, 760, 0, -1)), P.hairShadow);
  c.fill(outline(lockR, LW), LINE);
  c.fill(outline(lockL, LW), LINE);

  c.fill(bangsShape, P.hair);
  c.fill(inter(bangsShape, union(halfplane(690, 0, -1, 0.25), halfplane(0, 528, 0, -1))), P.hairShadow);
  // "angel ring" highlight
  const ring = inter(bangsShape, outline(circle(600, 560, 222), 26), halfplane(0, 420, 0, 1),
    halfplane(410, 0, -1, 0), halfplane(790, 0, 1, 0));
  c.fill(ring, P.hairHi);
  for (const [x0, x1] of [[470, 488], [560, 574], [648, 660]]) {
    c.fill(inter(ring, halfplane(x0, 0, -1, 0), halfplane(x1, 0, 1, 0)), P.hair); // breaks in the ring
  }
  c.fill(outline(bangsShape, LW), LINE);
  // strand lines inside bangs
  for (const s of [[[520, 300], [500, 420], [470, 560]], [[600, 270], [612, 420], [600, 590]], [[690, 300], [700, 420], [728, 540]]]) {
    c.fill(stroke(bezierPts(s), [LW2, 0.6]), LINE);
  }

  /* ---- eyebrows (drawn over the bangs, anime style) ---- */
  for (const side of [-1, 1]) {
    const pts = bezierPts([[600 + side * 50, 566], [600 + side * 100, 552], [600 + side * 150, 566]]);
    c.fill(stroke(pts, [4, 2]), P.hairShadow.map((v) => v * 0.7));
  }
  return c;
}

function buildBangs() {
  return offset(poly([
    [342, 560], [350, 420], [420, 306], [520, 262], [600, 254], [680, 262], [780, 306], [850, 420], [858, 560],
    [822, 470], [770, 572], [726, 452], [664, 612], [626, 470], [566, 624], [526, 478], [454, 592], [412, 474]
  ]), 6);
}

/** Premultiplied color written as if straight (classic dark-fringe failure). */
function premultVariant(c) { return { canvas: c, mode: "premult" }; }

/** Green-screen plate: character over #00B140 with a little edge spill, no alpha. */
function greenScreenVariant(c, spill = 0.35) {
  const green = [0, 0.694, 0.251];
  const out = c.over(green);
  // edge spill: blend toward green where the 9x9 box-blurred alpha drops below 1
  const blur = R.boxBlur(c.a, c.w, c.h, 4);
  const w = c.w, h = c.h;
  for (let i = 0; i < w * h; i++) {
    const k = c.a[i] > 0.5 ? R.clamp((1 - blur[i]) * 2) * spill : 0;
    if (k > 0) {
      out.r[i] = R.mix(out.r[i], green[0], k * 0.5);
      out.g[i] = R.mix(out.g[i], Math.max(out.g[i], green[1]), k);
      out.b[i] = R.mix(out.b[i], green[2], k * 0.5);
    }
  }
  return out;
}

/** Crop exactly to the alpha bounding box (no padding): effect-bounds test. */
function tightCropVariant(c) {
  const bb = c.alphaBBox(0);
  return c.crop(bb.x0, bb.y0, bb.x1, bb.y1);
}

module.exports = { W, H, PALETTES, SKIN, SKIN_SHADOW, LINE, drawCharacter, premultVariant, greenScreenVariant, tightCropVariant };
