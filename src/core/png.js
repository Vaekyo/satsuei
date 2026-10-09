/*
 * SATSUEI core/png - PNG decoder with its own inflate (RFC 1950/1951), pure ES3.
 *
 * Used by analysis backend A1 (comp -> saveFrameToPng -> decode in ExtendScript).
 * Supports bit depths 1/2/4/8/16, color types 0 (gray), 2 (RGB), 3 (palette, with
 * tRNS), 4 (gray+alpha), 6 (RGBA), filters 0-4, non-interlaced only (AE never
 * writes interlaced PNGs; Adam7 input throws).
 *
 * Input: a binary string (ExtendScript File with encoding = "BINARY"; each char
 * code is one byte) or an array-like of byte values (Node Buffer / Uint8Array).
 * Output: { w, h, bitDepth, colorType, r, g, b, a } - planar Arrays of floats in
 * 0..1, straight (un-premultiplied) as stored in the file.
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory();
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.core = S.core || {};
  S.core.png = factory();
}(function () {
  /* ------------------------------------------------------------------ */
  /* inflate                                                             */
  /* ------------------------------------------------------------------ */

  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
    67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
    1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  /**
   * Canonical Huffman table as { counts[0..15], symbols[] } (zlib "puff" layout):
   * decoding walks code lengths bit by bit, which is simple and fast enough.
   */
  function buildHuffman(lengths, n) {
    var counts = [], offs = [], symbols = new Array(n), i, len;
    for (i = 0; i < 16; i++) { counts[i] = 0; }
    for (i = 0; i < n; i++) { counts[lengths[i]]++; }
    counts[0] = 0;
    offs[1] = 0;
    for (len = 1; len < 15; len++) { offs[len + 1] = offs[len] + counts[len]; }
    for (i = 0; i < n; i++) {
      if (lengths[i] !== 0) { symbols[offs[lengths[i]]++] = i; }
    }
    return { counts: counts, symbols: symbols };
  }

  var FIXED_LIT = null, FIXED_DIST = null;
  function fixedTables() {
    if (FIXED_LIT) { return; }
    var l = [], i;
    for (i = 0; i < 144; i++) { l[i] = 8; }
    for (; i < 256; i++) { l[i] = 9; }
    for (; i < 280; i++) { l[i] = 7; }
    for (; i < 288; i++) { l[i] = 8; }
    FIXED_LIT = buildHuffman(l, 288);
    l = [];
    for (i = 0; i < 30; i++) { l[i] = 5; }
    FIXED_DIST = buildHuffman(l, 30);
  }

  /** Inflate a raw DEFLATE stream from byte array `src` starting at `start`. */
  function inflateRaw(src, start, sizeHint) {
    var out = sizeHint ? new Array(sizeHint) : [];
    var op = 0;
    var ip = start;
    var bitbuf = 0, bitcnt = 0;
    var srclen = src.length;

    // need <= 13, so bitbuf never exceeds 21 bits: plain 32-bit ops are safe.
    function bits(need) {
      var v;
      while (bitcnt < need) {
        if (ip >= srclen) { throw new Error("inflate: unexpected end of data"); }
        bitbuf |= src[ip++] << bitcnt;
        bitcnt += 8;
      }
      v = bitbuf & ((1 << need) - 1);
      bitbuf >>>= need;
      bitcnt -= need;
      return v;
    }

    function decodeSym(h) {
      var code = 0, first = 0, index = 0, len, count;
      for (len = 1; len < 16; len++) {
        code |= bits(1);
        count = h.counts[len];
        if (code - count < first) { return h.symbols[index + (code - first)]; }
        index += count;
        first += count;
        first <<= 1;
        code <<= 1;
      }
      throw new Error("inflate: bad Huffman code");
    }

    function codes(lit, dist) {
      var sym, len, d, k, from;
      while (true) {
        sym = decodeSym(lit);
        if (sym < 256) {
          out[op++] = sym;
        } else if (sym === 256) {
          return;
        } else {
          sym -= 257;
          if (sym >= 29) { throw new Error("inflate: bad length symbol"); }
          len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
          sym = decodeSym(dist);
          if (sym >= 30) { throw new Error("inflate: bad distance symbol"); }
          d = DIST_BASE[sym] + bits(DIST_EXTRA[sym]);
          if (d > op) { throw new Error("inflate: distance too far back"); }
          from = op - d;
          for (k = 0; k < len; k++) { out[op++] = out[from + k]; }
        }
      }
    }

    function dynamicTables() {
      var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      var lengths = [], i, sym, len, rep, h;
      if (nlen > 286 || ndist > 30) { throw new Error("inflate: bad counts"); }
      for (i = 0; i < 19; i++) { lengths[i] = 0; }
      for (i = 0; i < ncode; i++) { lengths[CL_ORDER[i]] = bits(3); }
      h = buildHuffman(lengths, 19);
      lengths = [];
      i = 0;
      while (i < nlen + ndist) {
        sym = decodeSym(h);
        if (sym < 16) {
          lengths[i++] = sym;
        } else {
          len = 0;
          if (sym === 16) {
            if (i === 0) { throw new Error("inflate: repeat with no first length"); }
            len = lengths[i - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) {
            rep = 3 + bits(3);
          } else {
            rep = 11 + bits(7);
          }
          if (i + rep > nlen + ndist) { throw new Error("inflate: too many lengths"); }
          while (rep--) { lengths[i++] = len; }
        }
      }
      return {
        lit: buildHuffman(lengths.slice(0, nlen), nlen),
        dist: buildHuffman(lengths.slice(nlen), ndist)
      };
    }

    var last, type, n, t;
    do {
      last = bits(1);
      type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0; // discard to byte boundary
        if (ip + 4 > srclen) { throw new Error("inflate: truncated stored block"); }
        n = src[ip] | (src[ip + 1] << 8);
        ip += 4;
        if (ip + n > srclen) { throw new Error("inflate: truncated stored block"); }
        while (n--) { out[op++] = src[ip++]; }
      } else if (type === 1) {
        fixedTables();
        codes(FIXED_LIT, FIXED_DIST);
      } else if (type === 2) {
        t = dynamicTables();
        codes(t.lit, t.dist);
      } else {
        throw new Error("inflate: invalid block type");
      }
    } while (!last);

    if (out.length !== op) { out.length = op; }
    return out;
  }

  /** zlib (RFC 1950) wrapper: 2-byte header, raw deflate, adler32 (not checked). */
  function inflateZlib(src, sizeHint) {
    var cmf = src[0], flg = src[1];
    if ((cmf & 15) !== 8 || ((cmf * 256 + flg) % 31) !== 0) { throw new Error("inflate: bad zlib header"); }
    if (flg & 32) { throw new Error("inflate: preset dictionary not supported"); }
    return inflateRaw(src, 2, sizeHint);
  }

  /* ------------------------------------------------------------------ */
  /* PNG                                                                 */
  /* ------------------------------------------------------------------ */

  function toBytes(data) {
    var n, out, i;
    if (typeof data === "string") {
      n = data.length;
      out = new Array(n);
      for (i = 0; i < n; i++) { out[i] = data.charCodeAt(i) & 255; }
      return out;
    }
    return data;
  }

  function u32(b, p) { return ((b[p] * 16777216) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]); }

  function chunkType(b, p) {
    return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  }

  var SIG = [137, 80, 78, 71, 13, 10, 26, 10];

  /** Parse chunks; returns header info + concatenated IDAT bytes. */
  function readChunks(b) {
    var i, p = 8, len, type, info = {}, idat = [], j, plte = null, trns = null;
    for (i = 0; i < 8; i++) {
      if (b[i] !== SIG[i]) { throw new Error("png: bad signature"); }
    }
    while (p + 8 <= b.length) {
      len = u32(b, p);
      type = chunkType(b, p + 4);
      p += 8;
      if (type === "IHDR") {
        info.w = u32(b, p);
        info.h = u32(b, p + 4);
        info.bitDepth = b[p + 8];
        info.colorType = b[p + 9];
        info.interlace = b[p + 12];
      } else if (type === "PLTE") {
        plte = [];
        for (j = 0; j < len; j++) { plte.push(b[p + j]); }
      } else if (type === "tRNS") {
        trns = [];
        for (j = 0; j < len; j++) { trns.push(b[p + j]); }
      } else if (type === "IDAT") {
        for (j = 0; j < len; j++) { idat.push(b[p + j]); }
      } else if (type === "IEND") {
        break;
      }
      p += len + 4; // data + CRC
    }
    info.plte = plte;
    info.trns = trns;
    info.idat = idat;
    return info;
  }

  var CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

  function paeth(a, b, c) {
    var p = a + b - c;
    var pa = p > a ? p - a : a - p;
    var pb = p > b ? p - b : b - p;
    var pc = p > c ? p - c : c - p;
    if (pa <= pb && pa <= pc) { return a; }
    return pb <= pc ? b : c;
  }

  /** Undo scanline filters in place; returns the unfiltered byte array (no filter bytes). */
  function unfilter(raw, h, stride, bpp) {
    var out = new Array(h * stride);
    var y, x, ft, rp = 0, op, up, a, b2, c;
    for (y = 0; y < h; y++) {
      ft = raw[rp++];
      op = y * stride;
      up = op - stride;
      for (x = 0; x < stride; x++) {
        a = x >= bpp ? out[op + x - bpp] : 0;
        b2 = y > 0 ? out[up + x] : 0;
        c = (x >= bpp && y > 0) ? out[up + x - bpp] : 0;
        var v = raw[rp++];
        if (ft === 0) { out[op + x] = v; }
        else if (ft === 1) { out[op + x] = (v + a) & 255; }
        else if (ft === 2) { out[op + x] = (v + b2) & 255; }
        else if (ft === 3) { out[op + x] = (v + ((a + b2) >> 1)) & 255; }
        else if (ft === 4) { out[op + x] = (v + paeth(a, b2, c)) & 255; }
        else { throw new Error("png: bad filter type " + ft); }
      }
    }
    return out;
  }

  /**
   * decode(data[, opts]) - opts.keepRaw: also return integer sample planes.
   */
  function decode(data, opts) {
    var b = toBytes(data);
    var info = readChunks(b);
    var w = info.w, h = info.h, bd = info.bitDepth, ct = info.colorType;
    var nch = CHANNELS[ct];
    if (nch === undefined) { throw new Error("png: unsupported color type " + ct); }
    if (info.interlace) { throw new Error("png: interlaced PNG not supported"); }
    var bitsPP = nch * bd;
    var stride = Math.ceil(w * bitsPP / 8);
    var bpp = Math.max(1, bitsPP >> 3);
    var raw = inflateZlib(info.idat, h * (stride + 1));
    if (raw.length < h * (stride + 1)) { throw new Error("png: image data too short"); }
    var px = unfilter(raw, h, stride, bpp);

    var n = w * h;
    var R = new Array(n), G = new Array(n), B = new Array(n), A = new Array(n);
    var maxv = Math.pow(2, bd) - 1;
    var inv = 1 / maxv;
    var x, y, i, o, s0, s1, s2, s3, idx, row;
    var trns = info.trns, plte = info.plte;
    var tGray = -1, tR = -1, tG = -1, tB = -1;
    if (trns && ct === 0) { tGray = trns[0] * 256 + trns[1]; }
    if (trns && ct === 2) { tR = trns[0] * 256 + trns[1]; tG = trns[2] * 256 + trns[3]; tB = trns[4] * 256 + trns[5]; }

    function sample(rowStart, k) {
      // k-th sample of the row (sample = one channel value)
      var bit, byteIdx, shift;
      if (bd === 8) { return px[rowStart + k]; }
      if (bd === 16) { return px[rowStart + 2 * k] * 256 + px[rowStart + 2 * k + 1]; }
      bit = k * bd;
      byteIdx = rowStart + (bit >> 3);
      shift = 8 - bd - (bit & 7);
      return (px[byteIdx] >> shift) & maxv;
    }

    for (y = 0; y < h; y++) {
      row = y * stride;
      for (x = 0; x < w; x++) {
        o = y * w + x;
        i = x * nch;
        if (ct === 6) {
          R[o] = sample(row, i) * inv; G[o] = sample(row, i + 1) * inv;
          B[o] = sample(row, i + 2) * inv; A[o] = sample(row, i + 3) * inv;
        } else if (ct === 2) {
          s0 = sample(row, i); s1 = sample(row, i + 1); s2 = sample(row, i + 2);
          R[o] = s0 * inv; G[o] = s1 * inv; B[o] = s2 * inv;
          A[o] = (s0 === tR && s1 === tG && s2 === tB) ? 0 : 1;
        } else if (ct === 0) {
          s0 = sample(row, i);
          R[o] = G[o] = B[o] = s0 * inv;
          A[o] = s0 === tGray ? 0 : 1;
        } else if (ct === 4) {
          s0 = sample(row, i); s3 = sample(row, i + 1);
          R[o] = G[o] = B[o] = s0 * inv;
          A[o] = s3 * inv;
        } else { // 3: palette
          idx = sample(row, i);
          R[o] = plte[idx * 3] / 255; G[o] = plte[idx * 3 + 1] / 255; B[o] = plte[idx * 3 + 2] / 255;
          A[o] = (trns && idx < trns.length) ? trns[idx] / 255 : 1;
        }
      }
    }
    var res = { w: w, h: h, bitDepth: bd, colorType: ct, r: R, g: G, b: B, a: A };
    if (opts && opts.keepRaw) { res.raw = px; }
    return res;
  }

  /** Read only the header (cheap): { w, h, bitDepth, colorType }. */
  function header(data) {
    var b = toBytes(typeof data === "string" ? data.substring(0, 33) : data);
    var i;
    for (i = 0; i < 8; i++) {
      if (b[i] !== SIG[i]) { throw new Error("png: bad signature"); }
    }
    return { w: u32(b, 16), h: u32(b, 20), bitDepth: b[24], colorType: b[25] };
  }

  /**
   * Un-premultiply in place (for renderers that write premultiplied color into a
   * straight-alpha file - reported for saveFrameToPng, verify). Pixels with a < eps
   * get color 0.
   */
  function unpremultiply(img, eps) {
    var e = eps || 1 / 512;
    var n = img.w * img.h, i, a;
    for (i = 0; i < n; i++) {
      a = img.a[i];
      if (a < e) {
        img.r[i] = 0; img.g[i] = 0; img.b[i] = 0;
      } else if (a < 1) {
        img.r[i] = Math.min(1, img.r[i] / a);
        img.g[i] = Math.min(1, img.g[i] / a);
        img.b[i] = Math.min(1, img.b[i] / a);
      }
    }
    return img;
  }

  return {
    inflateRaw: inflateRaw,
    inflateZlib: inflateZlib,
    decode: decode,
    header: header,
    unpremultiply: unpremultiply
  };
}));
