"use strict";
// Tiny anti-aliased vector rasterizer for synthetic test assets (dev-only, Node).
//
// Shapes are signed distance functions in pixel units (negative inside) with a
// bounding box. Coverage at a pixel center is clamp(0.5 - d / feather, 0, 1), which
// gives ~1 px analytic anti-aliasing. The canvas stores PREMULTIPLIED float RGBA
// so "over" compositing is exact. Output: straight-alpha PNG (default), the
// premultiplied-on-black variant (fringe test), or opaque.

const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

/* ------------------------------- noise -------------------------------- */

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function valueNoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}
function fbm(x, y, octaves = 5, seed = 0) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * valueNoise(x * f, y * f, seed + o * 17);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}
/** Deterministic PRNG (mulberry32) for asset layout. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------- shapes ------------------------------- */

const INF = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
const bbUnion = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const bbInter = (a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const bbGrow = (a, g) => ({ x0: a.x0 - g, y0: a.y0 - g, x1: a.x1 + g, y1: a.y1 + g });

const shape = (d, bb) => ({ d, bb });

function circle(cx, cy, r) {
  return shape((x, y) => Math.hypot(x - cx, y - cy) - r, { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r });
}
function ellipse(cx, cy, rx, ry) {
  // Inigo Quilez's gradient-normalized approximation; exact enough for AA.
  return shape((x, y) => {
    const px = (x - cx) / rx, py = (y - cy) / ry;
    const k0 = Math.hypot(px, py);
    const k1 = Math.hypot(px / rx, py / ry);
    if (k1 < 1e-9) return -Math.min(rx, ry);
    return (k0 * (k0 - 1)) / k1;
  }, { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry });
}
function poly(pts) {
  // Inigo Quilez's exact polygon SDF.
  const n = pts.length;
  let bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) bb = bbUnion(bb, { x0: x, y0: y, x1: x, y1: y });
  return shape((x, y) => {
    let d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
    let s = 1;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const ex = pts[j][0] - pts[i][0], ey = pts[j][1] - pts[i][1];
      const wx = x - pts[i][0], wy = y - pts[i][1];
      const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey));
      const bx = wx - ex * t, by = wy - ey * t;
      d = Math.min(d, bx * bx + by * by);
      const c1 = y >= pts[i][1], c2 = y < pts[j][1], c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * Math.sqrt(d);
  }, bb);
}
function rect(x0, y0, x1, y1) { return poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); }
function roundRect(x0, y0, x1, y1, r) { return offset(rect(x0 + r, y0 + r, x1 - r, y1 - r), r); }
function offset(s, r) { return shape((x, y) => s.d(x, y) - r, bbGrow(s.bb, Math.max(0, r))); }
function translate(s, dx, dy) {
  return shape((x, y) => s.d(x - dx, y - dy), { x0: s.bb.x0 + dx, y0: s.bb.y0 + dy, x1: s.bb.x1 + dx, y1: s.bb.y1 + dy });
}
function union(...ss) {
  return shape((x, y) => { let m = Infinity; for (const s of ss) m = Math.min(m, s.d(x, y)); return m; }, ss.map((s) => s.bb).reduce(bbUnion));
}
function smoothUnion(a, b, k) {
  return shape((x, y) => {
    const da = a.d(x, y), db = b.d(x, y);
    const h = clamp(0.5 + (0.5 * (db - da)) / k);
    return mix(db, da, h) - k * h * (1 - h);
  }, bbUnion(a.bb, b.bb));
}
function inter(...ss) {
  return shape((x, y) => { let m = -Infinity; for (const s of ss) m = Math.max(m, s.d(x, y)); return m; }, ss.map((s) => s.bb).reduce(bbInter));
}
function sub(a, b) { return shape((x, y) => Math.max(a.d(x, y), -b.d(x, y)), a.bb); }
/** Half-plane: inside where (p - p0)·n < 0. */
function halfplane(px, py, nx, ny) {
  const l = Math.hypot(nx, ny);
  return shape((x, y) => ((x - px) * nx + (y - py) * ny) / l, INF);
}
/** Outline of a closed shape: band of width w centered on its boundary. */
function outline(s, w) { return shape((x, y) => Math.abs(s.d(x, y)) - w / 2, bbGrow(s.bb, w)); }

/** Sample quadratic (3 pts) or cubic (4 pts) Bézier segments into a polyline. */
function bezierPts(ctrl, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    if (ctrl.length === 3) {
      out.push([u * u * ctrl[0][0] + 2 * u * t * ctrl[1][0] + t * t * ctrl[2][0], u * u * ctrl[0][1] + 2 * u * t * ctrl[1][1] + t * t * ctrl[2][1]]);
    } else {
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * ctrl[0][0] + b * ctrl[1][0] + c * ctrl[2][0] + d * ctrl[3][0], a * ctrl[0][1] + b * ctrl[1][1] + c * ctrl[2][1] + d * ctrl[3][1]]);
    }
  }
  return out;
}
/**
 * Open stroke along a polyline. w may be a number or [wStart, wEnd] (tapered, like a
 * brush stroke).
 */
function stroke(pts, w) {
  const w0 = Array.isArray(w) ? w[0] : w, w1 = Array.isArray(w) ? w[1] : w;
  let bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) bb = bbUnion(bb, { x0: x, y0: y, x1: x, y1: y });
  const segLen = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { segLen.push(total); total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); }
  return shape((x, y) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1], ex = pts[i][0] - ax, ey = pts[i][1] - ay;
      const L2 = ex * ex + ey * ey || 1e-9;
      const t = clamp(((x - ax) * ex + (y - ay) * ey) / L2);
      const dist = Math.hypot(x - ax - ex * t, y - ay - ey * t);
      const s = total > 0 ? (segLen[i - 1] + t * Math.sqrt(L2)) / total : 0;
      const hw = mix(w0, w1, s) / 2;
      best = Math.min(best, dist - hw);
    }
    return best;
  }, bbGrow(bb, Math.max(w0, w1)));
}

/** Separable box blur (radius rad, clamped edges) of a single float plane. */
function boxBlur(src, w, h, rad) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * rad + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -rad; k <= rad; k++) acc += src[row + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + rad + 1)] - src[row + Math.max(0, x - rad)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -rad; k <= rad; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + rad + 1) * w + x] - tmp[Math.max(0, y - rad) * w + x];
    }
  }
  return out;
}

/* ------------------------------- canvas ------------------------------- */

class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n); this.a = new Float32Array(n);
  }
  /** Fill every pixel with an opaque color function f(x, y) -> [r, g, b]. */
  paint(f) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = f(x + 0.5, y + 0.5), i = y * this.w + x;
      this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2]; this.a[i] = 1;
    }
    return this;
  }
  _box(bb) {
    return {
      x0: Math.max(0, Math.floor(bb.x0) - 2), y0: Math.max(0, Math.floor(bb.y0) - 2),
      x1: Math.min(this.w, Math.ceil(bb.x1) + 2), y1: Math.min(this.h, Math.ceil(bb.y1) + 2)
    };
  }
  /**
   * Composite a shape "over" the canvas. color: [r,g,b] or f(x,y) -> [r,g,b].
   * opts.opacity (0..1), opts.feather (px, soft edge), opts.mode "over" | "add" | "multiply".
   */
  fill(s, color, opts = {}) {
    const op = opts.opacity === undefined ? 1 : opts.opacity;
    const fe = opts.feather || 1;
    const mode = opts.mode || "over";
    const B = this._box(s.bb);
    const fn = typeof color === "function";
    for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const cov = clamp(0.5 - s.d(px, py) / fe) * op;
      if (cov <= 0) continue;
      const c = fn ? color(px, py) : color;
      const i = y * this.w + x;
      if (mode === "add") {
        this.r[i] += c[0] * cov * this.a[i]; this.g[i] += c[1] * cov * this.a[i]; this.b[i] += c[2] * cov * this.a[i];
      } else if (mode === "multiply") {
        this.r[i] *= mix(1, c[0], cov); this.g[i] *= mix(1, c[1], cov); this.b[i] *= mix(1, c[2], cov);
      } else {
        this.r[i] = c[0] * cov + this.r[i] * (1 - cov);
        this.g[i] = c[1] * cov + this.g[i] * (1 - cov);
        this.b[i] = c[2] * cov + this.b[i] * (1 - cov);
        this.a[i] = cov + this.a[i] * (1 - cov);
      }
    }
    return this;
  }
  /** Additive radial glow: color * strength * falloff(dist / radius). */
  glow(cx, cy, radius, color, strength = 1, falloff = "gauss") {
    const R = radius * (falloff === "gauss" ? 3 : 6);
    const B = this._box({ x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R });
    for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
      const f = falloff === "gauss" ? Math.exp(-d * d) : 1 / (1 + d * d);
      const k = f * strength;
      if (k < 1e-4) continue;
      const i = y * this.w + x;
      this.r[i] += color[0] * k * this.a[i]; this.g[i] += color[1] * k * this.a[i]; this.b[i] += color[2] * k * this.a[i];
    }
    return this;
  }
  /** Per-pixel post op on straight color: f(rgb, x, y, alpha) -> rgb. */
  post(f) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = y * this.w + x, a = this.a[i];
      if (a <= 0) continue;
      const c = f([this.r[i] / a, this.g[i] / a, this.b[i] / a], x + 0.5, y + 0.5, a);
      this.r[i] = c[0] * a; this.g[i] = c[1] * a; this.b[i] = c[2] * a;
    }
    return this;
  }
  clone() {
    const c = new Canvas(this.w, this.h);
    c.r.set(this.r); c.g.set(this.g); c.b.set(this.b); c.a.set(this.a);
    return c;
  }
  /** Alpha bounding box {x0,y0,x1,y1} (exclusive end) of pixels with alpha > thr. */
  alphaBBox(thr = 0) {
    let x0 = this.w, y0 = this.h, x1 = 0, y1 = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.a[y * this.w + x] > thr) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x >= x1) x1 = x + 1; if (y >= y1) y1 = y + 1; }
    }
    return { x0, y0, x1, y1 };
  }
  crop(x0, y0, x1, y1) {
    const c = new Canvas(x1 - x0, y1 - y0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * this.w + x, j = (y - y0) * c.w + (x - x0);
      c.r[j] = this.r[i]; c.g[j] = this.g[i]; c.b[j] = this.b[i]; c.a[j] = this.a[i];
    }
    return c;
  }
  /** Box-filter downscale by an integer factor (premultiplied, so edges stay clean). */
  downscale(f) {
    const c = new Canvas(Math.floor(this.w / f), Math.floor(this.h / f));
    const k = 1 / (f * f);
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) {
        const i = (y * f + v) * this.w + x * f + u;
        r += this.r[i]; g += this.g[i]; b += this.b[i]; a += this.a[i];
      }
      const j = y * c.w + x;
      c.r[j] = r * k; c.g[j] = g * k; c.b[j] = b * k; c.a[j] = a * k;
    }
    return c;
  }
  /** Composite this canvas over an opaque color; returns a new opaque canvas. */
  over(bg) {
    const c = new Canvas(this.w, this.h);
    for (let i = 0; i < this.w * this.h; i++) {
      const ia = 1 - this.a[i];
      c.r[i] = this.r[i] + bg[0] * ia; c.g[i] = this.g[i] + bg[1] * ia; c.b[i] = this.b[i] + bg[2] * ia; c.a[i] = 1;
    }
    return c;
  }
  /** Paste another canvas over this one at (dx, dy). */
  draw(src, dx, dy) {
    for (let y = 0; y < src.h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= this.h) continue;
      for (let x = 0; x < src.w; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= this.w) continue;
        const i = ty * this.w + tx, j = y * src.w + x, ia = 1 - src.a[j];
        this.r[i] = src.r[j] + this.r[i] * ia; this.g[i] = src.g[j] + this.g[i] * ia;
        this.b[i] = src.b[j] + this.b[i] * ia; this.a[i] = src.a[j] + this.a[i] * ia;
      }
    }
    return this;
  }
  /**
   * Encode to PNG. mode: "straight" (default; un-premultiplied RGBA), "premult"
   * (premultiplied RGB written into a straight file: dark fringes), "opaque" (RGB).
   */
  toPNG({ mode = "straight", bitDepth = 8 } = {}) {
    const alpha = mode !== "opaque";
    const colorType = alpha ? 6 : 2;
    const nch = 4; // pngjs input is always RGBA
    const max = bitDepth === 16 ? 65535 : 255;
    const png = new PNG({ width: this.w, height: this.h, bitDepth, colorType, inputColorType: 6, inputHasAlpha: true });
    const data = bitDepth === 16 ? new Uint16Array(this.w * this.h * nch) : Buffer.alloc(this.w * this.h * nch);
    const q = (v) => Math.round(clamp(v) * max);
    for (let i = 0; i < this.w * this.h; i++) {
      const a = this.a[i];
      let r = this.r[i], g = this.g[i], b = this.b[i];
      if (mode === "straight" && a > 0) { r /= a; g /= a; b /= a; }
      if (mode === "straight" && a <= 0) { r = g = b = 0; }
      data[4 * i] = q(r); data[4 * i + 1] = q(g); data[4 * i + 2] = q(b); data[4 * i + 3] = alpha ? q(a) : max;
    }
    png.data = data;
    return PNG.sync.write(png, { bitDepth, colorType, inputColorType: 6, inputHasAlpha: true });
  }
  save(file, opts) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, this.toPNG(opts));
    return file;
  }
  static load(file) {
    const png = PNG.sync.read(fs.readFileSync(file));
    const c = new Canvas(png.width, png.height);
    for (let i = 0; i < c.w * c.h; i++) {
      const a = png.data[4 * i + 3] / 255;
      c.r[i] = (png.data[4 * i] / 255) * a; c.g[i] = (png.data[4 * i + 1] / 255) * a; c.b[i] = (png.data[4 * i + 2] / 255) * a; c.a[i] = a;
    }
    return c;
  }
}

module.exports = {
  clamp, mix, mix3, smoothstep, hex, hash2, valueNoise, fbm, rng,
  circle, ellipse, poly, rect, roundRect, offset, translate, union, smoothUnion, inter, sub, halfplane, outline,
  bezierPts, stroke, boxBlur, Canvas
};
