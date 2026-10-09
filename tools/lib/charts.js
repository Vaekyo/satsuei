"use strict";
// Calibration chart + LUT identity images (shipped in assets/).

const { PNG } = require("pngjs");

/* Approximate sRGB (8-bit) values of the classic 24-patch color checker. */
const CHECKER = [
  ["dark skin", [115, 82, 68]], ["light skin", [194, 150, 130]], ["blue sky", [98, 122, 157]],
  ["foliage", [87, 108, 67]], ["blue flower", [133, 128, 177]], ["bluish green", [103, 189, 170]],
  ["orange", [214, 126, 44]], ["purplish blue", [80, 91, 166]], ["moderate red", [193, 90, 99]],
  ["purple", [94, 60, 108]], ["yellow green", [157, 188, 64]], ["orange yellow", [224, 163, 46]],
  ["blue", [56, 61, 150]], ["green", [70, 148, 73]], ["red", [175, 54, 60]],
  ["yellow", [231, 199, 31]], ["magenta", [187, 86, 149]], ["cyan", [8, 133, 161]],
  ["white 9.5", [243, 243, 242]], ["neutral 8", [200, 200, 200]], ["neutral 6.5", [160, 160, 160]],
  ["neutral 5", [122, 122, 121]], ["neutral 3.5", [85, 85, 85]], ["black 2", [52, 52, 52]]
];
const SKINS = [
  ["anime skin", "#fde3d3"], ["anime skin shadow", "#f0b9a6"], ["anime pale", "#fff0e8"],
  ["anime tan", "#e8b896"], ["anime tan shadow", "#c68863"], ["real light", "#e9c2a6"],
  ["real medium", "#c58c64"], ["real tan", "#a26b45"], ["real deep", "#6b4430"], ["real dark", "#3f2a20"]
];

function hexTo01(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

/** 1920x1080 16-bit RGB chart + JSON layout (pixel rects are [x0, y0, x1, y1), exclusive). */
function calibrationChart() {
  const W = 1920, H = 1080;
  const img = new Float64Array(W * H * 3).fill(0.18); // mid-gray surround
  const patches = [];
  const ramps = [];
  const put = (x0, y0, x1, y1, f) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = f(x, y), i = (y * W + x) * 3;
      img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2];
    }
  };
  const patch = (id, name, x0, y0, w, h, rgb) => {
    put(x0, y0, x0 + w, y0 + h, () => rgb);
    patches.push({ id, name, rect: [x0, y0, x0 + w, y0 + h], rgb });
  };
  // 24-patch checker (6 x 4)
  CHECKER.forEach(([name, c8], i) => {
    patch(`cc${String(i + 1).padStart(2, "0")}`, name, 40 + (i % 6) * 152, 40 + Math.floor(i / 6) * 152, 140, 140, c8.map((v) => v / 255));
  });
  // skin tones (5 x 2)
  SKINS.forEach(([name, h], i) => {
    patch(`skin${String(i + 1).padStart(2, "0")}`, name, 1000 + (i % 5) * 176, 40 + Math.floor(i / 5) * 152, 164, 140, hexTo01(h));
  });
  // primaries / secondaries at 100% and 50% saturation (6 x 2)
  const prim = [["red", [1, 0, 0]], ["green", [0, 1, 0]], ["blue", [0, 0, 1]], ["cyan", [0, 1, 1]], ["magenta", [1, 0, 1]], ["yellow", [1, 1, 0]]];
  prim.forEach(([name, c], i) => {
    patch(`p100_${name}`, `${name} 100%`, 1000 + i * 146, 352, 134, 134, c);
    patch(`p50_${name}`, `${name} 50%`, 1000 + i * 146, 504, 134, 134, c.map((v) => 0.5 + 0.5 * v));
  });
  // 32-step gray ramp
  for (let i = 0; i < 32; i++) {
    const v = i / 31;
    patch(`gray${String(i).padStart(2, "0")}`, `gray ${i}/31`, 64 + i * 56, 676, 56, 90, [v, v, v]);
  }
  // continuous ramps (exactly 1792 px: value = (x - 64) / 1791)
  [["K", [1, 1, 1]], ["R", [1, 0, 0]], ["G", [0, 1, 0]], ["B", [0, 0, 1]]].forEach(([ch, m], k) => {
    const y0 = 800 + k * 62;
    put(64, y0, 1856, y0 + 50, (x) => { const v = (x - 64) / 1791; return [m[0] * v, m[1] * v, m[2] * v]; });
    ramps.push({ id: `ramp${ch}`, channel: ch, rect: [64, y0, 1856, y0 + 50], from: 0, to: 1, axis: "x" });
  });
  const png = new PNG({ width: W, height: H, bitDepth: 16, colorType: 2, inputColorType: 2, inputHasAlpha: false });
  const data = new Uint16Array(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) data[i] = Math.round(Math.min(1, Math.max(0, img[i])) * 65535);
  png.data = data;
  const buf = PNG.sync.write(png, { bitDepth: 16, colorType: 2, inputColorType: 2, inputHasAlpha: false });
  return {
    png: buf,
    layout: {
      description: "SATSUEI calibration chart. Values are sRGB-encoded 0..1 as stored (16-bit). Sample the inner 60% of each patch.",
      width: W, height: H, bitDepth: 16, surround: 0.18, patches, ramps
    }
  };
}

/** Standard HALD CLUT identity, level L (cube size L^2, image L^3 square), 16-bit. */
function haldIdentity(level = 8) {
  const n = level * level, side = level * level * level;
  const png = new PNG({ width: side, height: side, bitDepth: 16, colorType: 2, inputColorType: 2, inputHasAlpha: false });
  const data = new Uint16Array(side * side * 3);
  for (let i = 0; i < side * side; i++) {
    const r = i % n, g = Math.floor(i / n) % n, b = Math.floor(i / (n * n));
    data[3 * i] = Math.round((r / (n - 1)) * 65535);
    data[3 * i + 1] = Math.round((g / (n - 1)) * 65535);
    data[3 * i + 2] = Math.round((b / (n - 1)) * 65535);
  }
  png.data = data;
  return PNG.sync.write(png, { bitDepth: 16, colorType: 2, inputColorType: 2, inputHasAlpha: false });
}

/**
 * Exact 65^3 lattice (also contains the 33^3 lattice at even indices): 65 slices
 * of 65x65 (r along x, g along y), slice b at tile (b % 9, floor(b / 9)) of a 9x8
 * grid -> 585x520, 16-bit. Unused tiles are black.
 */
function latticeIdentity(N = 65, cols = 9) {
  const rows = Math.ceil(N / cols), W = N * cols, H = N * rows;
  const png = new PNG({ width: W, height: H, bitDepth: 16, colorType: 2, inputColorType: 2, inputHasAlpha: false });
  const data = new Uint16Array(W * H * 3);
  for (let b = 0; b < N; b++) {
    const tx = (b % cols) * N, ty = Math.floor(b / cols) * N;
    for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const i = ((ty + g) * W + tx + r) * 3;
      data[i] = Math.round((r / (N - 1)) * 65535);
      data[i + 1] = Math.round((g / (N - 1)) * 65535);
      data[i + 2] = Math.round((b / (N - 1)) * 65535);
    }
  }
  png.data = data;
  return {
    png: PNG.sync.write(png, { bitDepth: 16, colorType: 2, inputColorType: 2, inputHasAlpha: false }),
    layout: { N, cols, rows, width: W, height: H, rule: "pixel (tx*N + r, ty*N + g) of tile b=(ty*cols+tx) holds (r, g, b)/(N-1)" }
  };
}

module.exports = { CHECKER, SKINS, calibrationChart, haldIdentity, latticeIdentity };
