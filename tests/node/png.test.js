"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { PNG } = require("pngjs");
const P = require("../../src/core/png.js");
const H = require("../../src/core/halton.js");

// ---- tiny reference encoder (lets us control color type, depth, filters, zlib mode) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const NCH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** samples: Array of rows, each an array of integer samples (w*nch). */
function encode({ w, h, ct, bd, samples, filters, zopts, plte, trns }) {
  const nch = NCH[ct];
  const stride = Math.ceil((w * nch * bd) / 8);
  const bpp = Math.max(1, (nch * bd) >> 3);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(stride);
    for (let k = 0; k < w * nch; k++) {
      const v = samples[y][k];
      if (bd === 16) { row[2 * k] = v >> 8; row[2 * k + 1] = v & 255; }
      else if (bd === 8) row[k] = v;
      else { const bit = k * bd; row[bit >> 3] |= v << (8 - bd - (bit & 7)); }
    }
    rows.push(row);
  }
  const out = [];
  for (let y = 0; y < h; y++) {
    const ft = filters[y % filters.length];
    const cur = rows[y], prev = y ? rows[y - 1] : Buffer.alloc(stride);
    const f = Buffer.alloc(stride + 1); f[0] = ft;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][ft];
      f[x + 1] = (cur[x] - pred) & 255;
    }
    out.push(f);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bd; ihdr[9] = ct;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
  if (plte) parts.push(chunk("PLTE", Buffer.from(plte)));
  if (trns) parts.push(chunk("tRNS", Buffer.from(trns)));
  const z = zlib.deflateSync(Buffer.concat(out), zopts || {});
  // split IDAT in two to exercise multi-chunk concatenation
  const mid = z.length >> 1;
  parts.push(chunk("IDAT", z.subarray(0, mid)), chunk("IDAT", z.subarray(mid)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function randomSamples(w, h, nch, maxv, seed) {
  const r = H.rng(seed);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let k = 0; k < w * nch; k++) {
      // mix smooth gradients (compressible, long matches) and noise (literals)
      const smooth = Math.round(((k + y) % 37) / 36 * maxv);
      row.push(r() < 0.5 ? smooth : Math.floor(r() * (maxv + 1)));
    }
    rows.push(row);
  }
  return rows;
}

const ZMODES = [
  { name: "default", opts: {} },
  { name: "stored", opts: { level: 0 } },
  { name: "fixed", opts: { strategy: zlib.constants.Z_FIXED } },
  { name: "huffman-only", opts: { strategy: zlib.constants.Z_HUFFMAN_ONLY } },
  { name: "rle", opts: { strategy: zlib.constants.Z_RLE } }
];

test("inflate matches zlib on random + repetitive data in every mode", () => {
  const r = H.rng(11);
  for (const len of [0, 1, 100, 70000]) {
    const src = Buffer.alloc(len);
    for (let i = 0; i < len; i++) src[i] = i % 300 < 150 ? (i * 7) & 255 : Math.floor(r() * 256);
    for (const m of ZMODES) {
      const out = P.inflateZlib(zlib.deflateSync(src, m.opts));
      assert.deepEqual(Buffer.from(out), src, `${m.name} len=${len}`);
    }
  }
});

test("decode every color type × bit depth × filter × zlib mode exactly", () => {
  const combos = [
    [0, 1], [0, 2], [0, 4], [0, 8], [0, 16], [2, 8], [2, 16], [3, 1], [3, 2], [3, 4], [3, 8],
    [4, 8], [4, 16], [6, 8], [6, 16]
  ];
  let seed = 1;
  for (const [ct, bd] of combos) {
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
      for (const m of [ZMODES[0], ZMODES[1 + (seed % 4)]]) {
        const w = 13, h = 7, nch = NCH[ct], maxv = 2 ** bd - 1;
        const samples = randomSamples(w, h, nch, maxv, seed++);
        let plte, trns;
        if (ct === 3) {
          plte = []; trns = [];
          for (let i = 0; i <= maxv; i++) { plte.push((i * 37) & 255, (i * 91) & 255, (i * 13) & 255); trns.push(255 - i); }
        }
        const buf = encode({ w, h, ct, bd, samples, filters, zopts: m.opts, plte, trns });
        // both input forms: byte array and ExtendScript-style binary string
        for (const input of [buf, buf.toString("latin1")]) {
          const img = P.decode(input);
          assert.equal(img.w, w); assert.equal(img.h, h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const o = y * w + x, s = samples[y].slice(x * nch, x * nch + nch);
            let exp;
            if (ct === 0) exp = [s[0] / maxv, s[0] / maxv, s[0] / maxv, 1];
            else if (ct === 2) exp = [s[0] / maxv, s[1] / maxv, s[2] / maxv, 1];
            else if (ct === 4) exp = [s[0] / maxv, s[0] / maxv, s[0] / maxv, s[1] / maxv];
            else if (ct === 6) exp = s.map((v) => v / maxv);
            else exp = [plte[s[0] * 3] / 255, plte[s[0] * 3 + 1] / 255, plte[s[0] * 3 + 2] / 255, trns[s[0]] / 255];
            const got = [img.r[o], img.g[o], img.b[o], img.a[o]];
            for (let c = 0; c < 4; c++) {
              assert.ok(Math.abs(got[c] - exp[c]) < 1e-12, `ct${ct} bd${bd} f${filters} ${m.name} (${x},${y}) c${c}`);
            }
          }
        }
      }
    }
  }
});

test("decode agrees with pngjs on pngjs-written RGBA files (8 and 16 bit)", () => {
  const w = 64, h = 40;
  for (const bitDepth of [8, 16]) {
    const png = new PNG({ width: w, height: h, bitDepth, colorType: 6, inputHasAlpha: true });
    const r = H.rng(bitDepth);
    const max = bitDepth === 16 ? 65535 : 255;
    if (bitDepth === 16) png.data = new Uint16Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i++) png.data[i] = Math.floor(r() * (max + 1));
    const buf = PNG.sync.write(png, { bitDepth, colorType: 6, inputColorType: 6 });
    const ref = PNG.sync.read(buf, { skipRescale: true });
    const img = P.decode(buf);
    for (let i = 0; i < w * h; i++) {
      assert.ok(Math.abs(img.r[i] - ref.data[4 * i] / max) < 1e-12);
      assert.ok(Math.abs(img.g[i] - ref.data[4 * i + 1] / max) < 1e-12);
      assert.ok(Math.abs(img.b[i] - ref.data[4 * i + 2] / max) < 1e-12);
      assert.ok(Math.abs(img.a[i] - ref.data[4 * i + 3] / max) < 1e-12);
    }
  }
});

test("header() and errors", () => {
  const buf = encode({ w: 3, h: 2, ct: 2, bd: 8, samples: [[0, 0, 0, 1, 1, 1, 2, 2, 2], [3, 3, 3, 4, 4, 4, 5, 5, 5]], filters: [0] });
  assert.deepEqual(P.header(buf), { w: 3, h: 2, bitDepth: 8, colorType: 2 });
  assert.deepEqual(P.header(buf.toString("latin1")), { w: 3, h: 2, bitDepth: 8, colorType: 2 });
  assert.throws(() => P.decode(Buffer.from("not a png at all")), /signature/);
  // zlib header lives in the first IDAT right after IHDR (8 sig + 25 IHDR + 8 chunk head)
  const bad = Buffer.from(buf); bad[41] ^= 0x0f;
  assert.throws(() => P.decode(bad), /zlib header/);
  // truncated stream (adler32 is deliberately not verified, so cut real data)
  assert.throws(() => P.inflateZlib(zlib.deflateSync(Buffer.alloc(5000, 7)).subarray(0, 6)), /unexpected end/);
});

test("unpremultiply", () => {
  const img = { w: 3, h: 1, r: [0.25, 0.5, 0.1], g: [0.25, 0.5, 0.1], b: [0, 0.5, 0.1], a: [0.5, 1, 0] };
  P.unpremultiply(img);
  assert.deepEqual(img.r, [0.5, 0.5, 0]);
  assert.deepEqual(img.b, [0, 0.5, 0]);
});
