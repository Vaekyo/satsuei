"use strict";
// Node-side stand-in for an AE comp, used for reference statistics and simulated
// previews: place layers (bilinear, premultiplied), build the analysis passes
// (BG alone / each character alone / full comp) at the analysis resolution.

const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const R = require("./raster.js");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "defaults.json"), "utf8"));

/** Load any 8/16-bit PNG into a premultiplied float Canvas. */
function loadCanvas(file) {
  const png = PNG.sync.read(fs.readFileSync(file), { skipRescale: true });
  const max = png.depth === 16 ? 65535 : 255;
  const c = new R.Canvas(png.width, png.height);
  for (let i = 0; i < c.w * c.h; i++) {
    const a = png.data[4 * i + 3] / max;
    c.r[i] = (png.data[4 * i] / max) * a; c.g[i] = (png.data[4 * i + 1] / max) * a; c.b[i] = (png.data[4 * i + 2] / max) * a; c.a[i] = a;
  }
  return c;
}

/** Resample src into a W x H canvas: dest = src scaled by s with its top-left at (x0, y0). */
function placeLayer(src, W, H, { scale, x0, y0 }) {
  const out = new R.Canvas(W, H);
  const inv = 1 / scale;
  const dx0 = Math.max(0, Math.floor(x0)), dy0 = Math.max(0, Math.floor(y0));
  const dx1 = Math.min(W, Math.ceil(x0 + src.w * scale)), dy1 = Math.min(H, Math.ceil(y0 + src.h * scale));
  for (let y = dy0; y < dy1; y++) {
    const sy = (y + 0.5 - y0) * inv - 0.5;
    const iy = Math.floor(sy), fy = sy - iy;
    for (let x = dx0; x < dx1; x++) {
      const sx = (x + 0.5 - x0) * inv - 0.5;
      const ix = Math.floor(sx), fx = sx - ix;
      let r = 0, g = 0, b = 0, a = 0;
      for (let v = 0; v < 2; v++) {
        const yy = iy + v;
        if (yy < 0 || yy >= src.h) continue;
        const wy = v ? fy : 1 - fy;
        for (let u = 0; u < 2; u++) {
          const xx = ix + u;
          if (xx < 0 || xx >= src.w) continue;
          const w = wy * (u ? fx : 1 - fx), j = yy * src.w + xx;
          r += w * src.r[j]; g += w * src.g[j]; b += w * src.b[j]; a += w * src.a[j];
        }
      }
      const i = y * W + x;
      out.r[i] = r; out.g[i] = g; out.b[i] = b; out.a[i] = a;
    }
  }
  return out;
}

/** Default placement of a character canvas in a W x H comp (config testPlacement). */
function defaultPlacement(src, W, H, p = DEFAULTS.testPlacement) {
  const scale = (p.heightFrac * H) / src.h;
  return { scale, x0: p.centerX * W - (src.w * scale) / 2, y0: p.bottom * H - src.h * scale };
}

/** Area-average downscale to fit maxSide (non-integer factors allowed). */
function downscaleTo(c, maxSide) {
  const f = Math.max(c.w, c.h) / maxSide;
  if (f <= 1) return c;
  const W = Math.round(c.w / f), H = Math.round(c.h / f);
  const out = new R.Canvas(W, H);
  for (let y = 0; y < H; y++) {
    const sy0 = y * f, sy1 = (y + 1) * f;
    for (let x = 0; x < W; x++) {
      const sx0 = x * f, sx1 = (x + 1) * f;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(sy0); yy < Math.ceil(sy1); yy++) {
        const wy = Math.min(sy1, yy + 1) - Math.max(sy0, yy);
        for (let xx = Math.floor(sx0); xx < Math.ceil(sx1); xx++) {
          const w = wy * (Math.min(sx1, xx + 1) - Math.max(sx0, xx)), j = yy * c.w + xx;
          r += w * c.r[j]; g += w * c.g[j]; b += w * c.b[j]; a += w * c.a[j]; wsum += w;
        }
      }
      const i = y * W + x;
      out.r[i] = r / wsum; out.g[i] = g / wsum; out.b[i] = b / wsum; out.a[i] = a / wsum;
    }
  }
  return out;
}

/** Premultiplied canvas -> straight-alpha planar buffer { w, h, r, g, b, a }. */
function toBuffer(c) {
  const n = c.w * c.h;
  const o = { w: c.w, h: c.h, r: new Float64Array(n), g: new Float64Array(n), b: new Float64Array(n), a: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const a = c.a[i];
    o.a[i] = a;
    if (a > 1e-6) { o.r[i] = Math.min(1, c.r[i] / a); o.g[i] = Math.min(1, c.g[i] / a); o.b[i] = Math.min(1, c.b[i] / a); }
  }
  return o;
}

/** Straight buffer -> premultiplied canvas. */
function fromBuffer(b) {
  const c = new R.Canvas(b.w, b.h);
  for (let i = 0; i < b.w * b.h; i++) {
    const a = b.a[i];
    c.r[i] = b.r[i] * a; c.g[i] = b.g[i] * a; c.b[i] = b.b[i] * a; c.a[i] = a;
  }
  return c;
}

/**
 * Build analysis passes like backend A1 would: { bg, chars: [{ id, buf }], comp }
 * at maxSide resolution. bgCanvas is opaque W x H; chars are placed full-res canvases.
 */
function analysisPasses(bgCanvas, placedChars, maxSide) {
  const bg = downscaleTo(bgCanvas, maxSide);
  const chars = placedChars.map(({ id, canvas }) => ({ id, buf: toBuffer(downscaleTo(canvas, maxSide)) }));
  const comp = bgCanvas.clone();
  for (const { canvas } of placedChars) comp.draw(canvas, 0, 0);
  return { bg: toBuffer(bg), chars, comp: toBuffer(downscaleTo(comp, maxSide)) };
}

/** Deterministic core-pixel sample (same code path as AE: src/core/stats.charSamples). */
function charSamples(buf, coreAlpha, n) {
  return require("../../src/core/stats.js").charSamples(buf, coreAlpha, n);
}

module.exports = { ROOT, DEFAULTS, loadCanvas, placeLayer, defaultPlacement, downscaleTo, toBuffer, fromBuffer, analysisPasses, charSamples };
