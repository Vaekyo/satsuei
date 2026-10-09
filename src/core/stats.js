/*
 * SATSUEI core/stats - image statistics for analysis (pure ES3, no AE DOM).
 *
 * Input buffers: { w, h, r, g, b, a } planar arrays (Array or typed array), working
 * space (sRGB-encoded) 0..1, straight alpha. Weights are per-pixel arrays (0..1).
 * Formulas: docs/ALGORITHMS.md sec. Statistics.
 *
 * Cost model: everything is O(pixels) except per-sample Oklab work (bands, palette,
 * skin, chroma), which runs on a deterministic subset of at most opts.maxSamples
 * pixels, and k-means, which runs on at most opts.kmeansSamples.
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory(require("./color.js"), require("./linalg.js"), require("./halton.js"));
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.core = S.core || {};
  S.core.stats = factory(S.core.color, S.core.linalg, S.core.halton);
}(function (C, L, H) {
  var DEFAULTS = {
    bins: 1024,
    maxSamples: 20000,
    kmeansSamples: 4096,
    k: 5,
    seed: 12345,
    blackPct: 0.03,
    keyPct: 0.03,
    clipLevel: 0.995,
    emitterChroma: 0.14,
    emitterMinL: 0.55,
    sogPower: 6,
    illumKeyBlend: 0.7,
    ringFrac: 0.08,
    coreAlpha: 0.95,
    blobPct: 0.02
  };

  function opt(o, k) { return (o && o[k] !== undefined) ? o[k] : DEFAULTS[k]; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* ------------------------------------------------------------------ */
  /* preparation                                                         */
  /* ------------------------------------------------------------------ */

  /** Linear planes, luminance Y and lightness Lr = cbrt(Y) (= Oklab L of a gray). */
  function prepare(img) {
    var n = img.w * img.h;
    var lr = new Array(n), lg = new Array(n), lb = new Array(n), Y = new Array(n), Lr = new Array(n);
    var i, y, r, g, b, mx = new Array(n), mn = new Array(n);
    for (i = 0; i < n; i++) {
      r = img.r[i]; g = img.g[i]; b = img.b[i];
      lr[i] = C.srgbToLinear(r); lg[i] = C.srgbToLinear(g); lb[i] = C.srgbToLinear(b);
      y = 0.2126 * lr[i] + 0.7152 * lg[i] + 0.0722 * lb[i];
      Y[i] = y;
      Lr[i] = y > 0 ? Math.pow(y, 1 / 3) : 0;
      mx[i] = r > g ? (r > b ? r : b) : (g > b ? g : b);
      mn[i] = r < g ? (r < b ? r : b) : (g < b ? g : b);
    }
    return { w: img.w, h: img.h, n: n, r: img.r, g: img.g, b: img.b, a: img.a, lr: lr, lg: lg, lb: lb, Y: Y, Lr: Lr, max: mx, min: mn };
  }

  function oklabAt(P, i) { return C.linearToOklab([P.lr[i], P.lg[i], P.lb[i]]); }

  /** Weights from alpha: 1 where a >= thr (core pixels), else 0. */
  function coreWeights(a, thr) {
    var n = a.length, w = new Array(n), i;
    for (i = 0; i < n; i++) { w[i] = a[i] >= thr ? 1 : 0; }
    return w;
  }

  function onesWeights(n) {
    var w = new Array(n), i;
    for (i = 0; i < n; i++) { w[i] = 1; }
    return w;
  }

  /** Deterministic evenly spaced subset of indices with weight > 0 (at most maxS). */
  function sampleIndices(wts, maxS) {
    var idx = [], i, n = wts.length, cnt = 0, step, acc;
    for (i = 0; i < n; i++) { if (wts[i] > 0) { cnt++; } }
    if (cnt <= maxS) {
      for (i = 0; i < n; i++) { if (wts[i] > 0) { idx.push(i); } }
      return idx;
    }
    step = cnt / maxS;
    acc = 0;
    for (i = 0; i < n; i++) {
      if (wts[i] > 0) {
        if (acc <= 0) { idx.push(i); acc += step; }
        acc -= 1;
      }
    }
    return idx;
  }

  /* ------------------------------------------------------------------ */
  /* moments, histograms, percentiles                                    */
  /* ------------------------------------------------------------------ */

  /** Weighted mean + 3x3 covariance of three planes. */
  function moments3(x0, x1, x2, wts) {
    var n = wts.length, sw = 0, m = [0, 0, 0], i, w, d0, d1, d2;
    var cv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (i = 0; i < n; i++) {
      w = wts[i];
      if (w > 0) { sw += w; m[0] += w * x0[i]; m[1] += w * x1[i]; m[2] += w * x2[i]; }
    }
    if (sw <= 0) { return { weight: 0, mean: [0, 0, 0], cov: cv }; }
    m[0] /= sw; m[1] /= sw; m[2] /= sw;
    for (i = 0; i < n; i++) {
      w = wts[i];
      if (w > 0) {
        d0 = x0[i] - m[0]; d1 = x1[i] - m[1]; d2 = x2[i] - m[2];
        cv[0][0] += w * d0 * d0; cv[0][1] += w * d0 * d1; cv[0][2] += w * d0 * d2;
        cv[1][1] += w * d1 * d1; cv[1][2] += w * d1 * d2; cv[2][2] += w * d2 * d2;
      }
    }
    cv[0][0] /= sw; cv[0][1] /= sw; cv[0][2] /= sw; cv[1][1] /= sw; cv[1][2] /= sw; cv[2][2] /= sw;
    cv[1][0] = cv[0][1]; cv[2][0] = cv[0][2]; cv[2][1] = cv[1][2];
    return { weight: sw, mean: m, cov: cv };
  }

  /** Weighted histogram of values in [lo, hi]; values outside clamp to the end bins. */
  function histogram(vals, wts, bins, lo, hi) {
    var counts = new Array(bins), i, b, total = 0, over = 0, under = 0, w, v;
    var scale = bins / (hi - lo);
    for (i = 0; i < bins; i++) { counts[i] = 0; }
    for (i = 0; i < vals.length; i++) {
      w = wts ? wts[i] : 1;
      if (!(w > 0)) { continue; }
      v = vals[i];
      b = Math.floor((v - lo) * scale);
      if (b < 0) { b = 0; under += w; }
      if (b >= bins) { b = bins - 1; if (v > hi) { over += w; } }
      counts[b] += w;
      total += w;
    }
    return { bins: bins, lo: lo, hi: hi, counts: counts, total: total, over: over, under: under };
  }

  /** Value at quantile p (0..1), linearly interpolated inside the bin. */
  function percentile(hist, p) {
    var target = p * hist.total, cum = 0, i, c, f;
    var bw = (hist.hi - hist.lo) / hist.bins;
    if (hist.total <= 0) { return hist.lo; }
    for (i = 0; i < hist.bins; i++) {
      c = hist.counts[i];
      if (cum + c >= target && c > 0) {
        f = (target - cum) / c;
        return hist.lo + (i + f) * bw;
      }
      cum += c;
    }
    return hist.hi;
  }

  function percentiles(hist, ps) {
    var out = {}, i;
    for (i = 0; i < ps.length; i++) { out["p" + Math.round(ps[i] * 100)] = percentile(hist, ps[i]); }
    return out;
  }

  /** Mean color (working + linear) of pixels with weight > 0 that satisfy pred(i). */
  function meanWhere(P, wts, pred) {
    var sw = 0, s = [0, 0, 0], sl = [0, 0, 0], i, w;
    for (i = 0; i < P.n; i++) {
      w = wts[i];
      if (w > 0 && pred(i)) {
        sw += w;
        s[0] += w * P.r[i]; s[1] += w * P.g[i]; s[2] += w * P.b[i];
        sl[0] += w * P.lr[i]; sl[1] += w * P.lg[i]; sl[2] += w * P.lb[i];
      }
    }
    if (sw <= 0) { return null; }
    return { weight: sw, rgb: [s[0] / sw, s[1] / sw, s[2] / sw], lin: [sl[0] / sw, sl[1] / sw, sl[2] / sw] };
  }

  /* ------------------------------------------------------------------ */
  /* black / key / bands / illuminant                                    */
  /* ------------------------------------------------------------------ */

  function blackColor(P, wts, hist, pct) {
    var thr = percentile(hist, pct);
    var m = meanWhere(P, wts, function (i) { return P.Lr[i] <= thr; });
    if (m) { m.threshold = thr; }
    return m;
  }

  /**
   * Key/highlight color: mean of the brightest keyPct of eligible pixels. Eligible =
   * not clipped (max channel < clipLevel) and not a saturated emitter (Oklab chroma >
   * emitterChroma at L > emitterMinL). Falls back to all pixels when nothing is
   * eligible (e.g. a pure white or pure black frame).
   */
  function keyColor(P, wts, hist, o) {
    var pct = opt(o, "keyPct"), clipL = opt(o, "clipLevel"), eC = opt(o, "emitterChroma"), eL = opt(o, "emitterMinL");
    var pre = percentile(hist, Math.max(0, 1 - pct * 5)); // candidate pool: top ~15%
    var cand = [], i, lab, ch, clippedW = 0, emitterW = 0, total = 0;
    for (i = 0; i < P.n; i++) {
      if (!(wts[i] > 0)) { continue; }
      total += wts[i];
      if (P.Lr[i] < pre) { continue; }
      if (P.max[i] >= clipL) { clippedW += wts[i]; continue; }
      lab = oklabAt(P, i);
      ch = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
      if (ch > eC && lab[0] > eL) { emitterW += wts[i]; continue; }
      cand.push(i);
    }
    if (cand.length === 0) {
      var top = percentile(hist, 1 - pct);
      var m0 = meanWhere(P, wts, function (j) { return P.Lr[j] >= top; });
      if (m0) { m0.fallback = true; m0.clippedFraction = total > 0 ? clippedW / total : 0; }
      return m0;
    }
    cand.sort(function (x, y) { return P.Lr[y] - P.Lr[x]; });
    var want = pct * total, sw = 0, s = [0, 0, 0], sl = [0, 0, 0], k, w2, j2;
    for (k = 0; k < cand.length && sw < want; k++) {
      j2 = cand[k]; w2 = wts[j2];
      sw += w2;
      s[0] += w2 * P.r[j2]; s[1] += w2 * P.g[j2]; s[2] += w2 * P.b[j2];
      sl[0] += w2 * P.lr[j2]; sl[1] += w2 * P.lg[j2]; sl[2] += w2 * P.lb[j2];
    }
    return {
      weight: sw,
      rgb: [s[0] / sw, s[1] / sw, s[2] / sw],
      lin: [sl[0] / sw, sl[1] / sw, sl[2] / sw],
      clippedFraction: total > 0 ? clippedW / total : 0,
      emitterFraction: total > 0 ? emitterW / total : 0,
      fallback: false
    };
  }

  /** Mean Oklab within lightness bands defined by percentiles of the region. */
  function bandTints(P, sampleIdx, wts, hist) {
    var edges = {
      shadow: [-1, percentile(hist, 0.2)],
      mid: [percentile(hist, 0.4), percentile(hist, 0.6)],
      high: [percentile(hist, 0.8), 2]
    };
    var acc = { shadow: [0, 0, 0, 0], mid: [0, 0, 0, 0], high: [0, 0, 0, 0] };
    var k, i, j, lab, w, Lr, band;
    for (k = 0; k < sampleIdx.length; k++) {
      i = sampleIdx[k];
      w = wts[i];
      Lr = P.Lr[i];
      lab = null;
      for (band in edges) {
        if (edges.hasOwnProperty(band) && Lr >= edges[band][0] && Lr <= edges[band][1]) {
          if (!lab) { lab = oklabAt(P, i); }
          for (j = 0; j < 3; j++) { acc[band][j] += w * lab[j]; }
          acc[band][3] += w;
        }
      }
    }
    var out = {};
    for (band in acc) {
      if (acc.hasOwnProperty(band)) {
        if (acc[band][3] > 0) {
          lab = [acc[band][0] / acc[band][3], acc[band][1] / acc[band][3], acc[band][2] / acc[band][3]];
          out[band] = { lab: lab, chroma: Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]), hue: C.hueDeg(lab[1], lab[2]), lin: C.oklabToLinear(lab) };
        } else {
          out[band] = null;
        }
      }
    }
    return out;
  }

  /** Cheap per-pixel emitter proxy (HSV-style): bright and strongly saturated. */
  function isEmitterish(P, i) {
    var mx = P.max[i];
    return mx >= 0.6 && (mx - P.min[i]) >= 0.65 * mx;
  }

  /**
   * Shades-of-gray estimate e_c = mean(c^p)^(1/p) over unclipped, non-emitter pixels
   * (p = 6 lets a single neon sign dominate otherwise); unit luminance.
   */
  function shadesOfGray(P, wts, p, clipLevel) {
    var s = [0, 0, 0], sw = 0, i, w;
    for (i = 0; i < P.n; i++) {
      w = wts[i];
      if (w > 0 && P.max[i] < clipLevel && !isEmitterish(P, i)) {
        sw += w;
        s[0] += w * Math.pow(P.lr[i], p); s[1] += w * Math.pow(P.lg[i], p); s[2] += w * Math.pow(P.lb[i], p);
      }
    }
    if (sw <= 0) { return null; }
    var e = [Math.pow(s[0] / sw, 1 / p), Math.pow(s[1] / sw, 1 / p), Math.pow(s[2] / sw, 1 / p)];
    if (C.luminance(e) < 1e-9) { return null; }
    return C.normalizeLuminance(e);
  }

  function describeIlluminant(e) {
    var lab = C.linearToOklab(e);
    return {
      lin: e,
      lab: lab,
      hue: C.hueDeg(lab[1], lab[2]),
      chroma: Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]),
      cct: Math.round(C.linearToCct(e))
    };
  }

  /** Blend of shades-of-gray and the key color (both unit luminance). Neutral when unknown. */
  function illuminant(P, wts, key, o) {
    var sog = shadesOfGray(P, wts, opt(o, "sogPower"), opt(o, "clipLevel"));
    var kb = opt(o, "illumKeyBlend");
    var kn = (key && C.luminance(key.lin) > 1e-6) ? C.normalizeLuminance(key.lin) : null;
    var e;
    if (sog && kn) {
      e = C.normalizeLuminance([L.lerp(sog[0], kn[0], kb), L.lerp(sog[1], kn[1], kb), L.lerp(sog[2], kn[2], kb)]);
    } else {
      e = sog || kn || [1, 1, 1];
    }
    var d = describeIlluminant(e);
    d.sog = sog;
    d.keyNorm = kn;
    d.known = !!(sog || kn);
    return d;
  }

  /* ------------------------------------------------------------------ */
  /* palette (weighted k-means in Oklab, k-means++ with a fixed seed)    */
  /* ------------------------------------------------------------------ */

  function kmeans(pts, wts, k, seed, iters) {
    var n = pts.length, rand = H.rng(seed || 1), cents = [], i, j, c, best, bd, d, tw, r, acc;
    var assign = new Array(n), dist2 = new Array(n);
    if (n === 0) { return []; }
    function d2(p, q) { var a = p[0] - q[0], b = p[1] - q[1], e = p[2] - q[2]; return a * a + b * b + e * e; }
    // k-means++ seeding (weighted)
    tw = 0;
    for (i = 0; i < n; i++) { tw += wts[i]; }
    r = rand() * tw; acc = 0;
    for (i = 0; i < n; i++) { acc += wts[i]; if (acc >= r) { break; } }
    cents.push(pts[Math.min(i, n - 1)].slice(0));
    while (cents.length < k) {
      tw = 0;
      for (i = 0; i < n; i++) {
        bd = Infinity;
        for (c = 0; c < cents.length; c++) { d = d2(pts[i], cents[c]); if (d < bd) { bd = d; } }
        dist2[i] = bd * wts[i];
        tw += dist2[i];
      }
      if (tw <= 1e-18) { break; } // fewer distinct colors than k
      r = rand() * tw; acc = 0;
      for (i = 0; i < n; i++) { acc += dist2[i]; if (acc >= r) { break; } }
      cents.push(pts[Math.min(i, n - 1)].slice(0));
    }
    var K = cents.length, it, sums, changed;
    for (it = 0; it < (iters || 25); it++) {
      changed = false;
      for (i = 0; i < n; i++) {
        best = 0; bd = Infinity;
        for (c = 0; c < K; c++) { d = d2(pts[i], cents[c]); if (d < bd) { bd = d; best = c; } }
        if (assign[i] !== best) { assign[i] = best; changed = true; }
      }
      sums = [];
      for (c = 0; c < K; c++) { sums.push([0, 0, 0, 0]); }
      for (i = 0; i < n; i++) {
        for (j = 0; j < 3; j++) { sums[assign[i]][j] += wts[i] * pts[i][j]; }
        sums[assign[i]][3] += wts[i];
      }
      for (c = 0; c < K; c++) {
        if (sums[c][3] > 0) { cents[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]; }
      }
      if (!changed && it > 0) { break; }
    }
    var out = [], totalW = 0;
    var cw = [];
    for (c = 0; c < K; c++) { cw.push(0); }
    for (i = 0; i < n; i++) { cw[assign[i]] += wts[i]; totalW += wts[i]; }
    for (c = 0; c < K; c++) {
      if (cw[c] > 0) {
        out.push({ lab: cents[c], weight: cw[c] / totalW, rgb: C.oklabToSrgb(cents[c]), chroma: Math.sqrt(cents[c][1] * cents[c][1] + cents[c][2] * cents[c][2]), hue: C.hueDeg(cents[c][1], cents[c][2]) });
      }
    }
    out.sort(function (x, y) { return y.weight - x.weight; });
    return out;
  }

  function palette(P, wts, o) {
    var idx = sampleIndices(wts, opt(o, "kmeansSamples"));
    var pts = [], w = [], k;
    for (k = 0; k < idx.length; k++) { pts.push(oklabAt(P, idx[k])); w.push(wts[idx[k]]); }
    return kmeans(pts, w, opt(o, "k"), opt(o, "seed"), 25);
  }

  /* ------------------------------------------------------------------ */
  /* spatial: light direction, distance transform, ring                  */
  /* ------------------------------------------------------------------ */

  /**
   * Weighted LS plane fit Y = a*x + b*y + c with x, y normalized to [-1, 1]
   * (x right, y down). The gradient (a, b) points toward the light.
   */
  function planeFit(P, wts, vals) {
    var V = vals || P.Y;
    var rows = [], ys = [], ws = [], x, y, i, sx = 2 / P.w, sy = 2 / P.h;
    var stepX = Math.max(1, Math.floor(P.w / 96)), stepY = Math.max(1, Math.floor(P.h / 96));
    for (y = 0; y < P.h; y += stepY) {
      for (x = 0; x < P.w; x += stepX) {
        i = y * P.w + x;
        if (wts[i] > 0) { rows.push([(x + 0.5) * sx - 1, (y + 0.5) * sy - 1, 1]); ys.push(V[i]); ws.push(wts[i]); }
      }
    }
    if (rows.length < 3) { return { a: 0, b: 0, c: 0, angle: null, strength: 0, r2: 0, confidence: 0 }; }
    var beta = L.wls(rows, ys, ws, 1e-9) || [0, 0, 0];
    var mean = 0, sw = 0, ssTot = 0, ssRes = 0, k, pred;
    for (k = 0; k < ys.length; k++) { mean += ws[k] * ys[k]; sw += ws[k]; }
    mean /= sw;
    for (k = 0; k < ys.length; k++) {
      pred = beta[0] * rows[k][0] + beta[1] * rows[k][1] + beta[2];
      ssTot += ws[k] * (ys[k] - mean) * (ys[k] - mean);
      ssRes += ws[k] * (ys[k] - pred) * (ys[k] - pred);
    }
    var r2 = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 0;
    var g = Math.sqrt(beta[0] * beta[0] + beta[1] * beta[1]);
    var strength = g / (mean + 1e-3);
    return {
      a: beta[0], b: beta[1], c: beta[2],
      angle: g > 1e-9 ? L.vecToAeAngle(beta[0], beta[1]) : null,
      strength: strength,
      r2: r2,
      confidence: clamp01(r2 * 4) * clamp01(strength / 0.3)
    };
  }

  /** Centroid/spread of the brightest blobPct of pixels (by Y), in normalized coords. */
  function brightBlob(P, wts, o) {
    var hist = histogram(P.Y, wts, 2048, 0, Math.max(1, maxOf(P.Y)));
    var thr = percentile(hist, 1 - opt(o, "blobPct"));
    var med = percentile(hist, 0.5);
    var sw = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sY = 0, i, w, x, y;
    for (i = 0; i < P.n; i++) {
      if (wts[i] > 0 && P.Y[i] >= thr && P.Y[i] > 0) {
        w = wts[i] * P.Y[i];
        x = ((i % P.w) + 0.5) / P.w; y = (Math.floor(i / P.w) + 0.5) / P.h;
        sw += w; sx += w * x; sy += w * y; sxx += w * x * x; syy += w * y * y; sY += w * P.Y[i];
      }
    }
    if (sw <= 0) { return null; }
    var cx = sx / sw, cy = sy / sw;
    var spread = Math.sqrt(Math.max(0, sxx / sw - cx * cx) + Math.max(0, syy / sw - cy * cy));
    return { x: cx, y: cy, spread: spread, meanY: sY / sw, medianY: med };
  }

  function maxOf(arr) { var m = -Infinity, i; for (i = 0; i < arr.length; i++) { if (arr[i] > m) { m = arr[i]; } } return m; }

  /**
   * Combine plane-fit direction with the bright-blob direction as seen from the
   * character centroid (both as confidence-weighted unit vectors).
   */
  function lightDirection(plane, blob, from, aspect) {
    var vx = 0, vy = 0, c1 = plane.confidence || 0, c2 = 0, u, dx, dy, dist, ang2 = null;
    if (plane.angle !== null && c1 > 0) {
      u = L.aeAngleToVec(plane.angle);
      vx += c1 * u[0]; vy += c1 * u[1];
    }
    if (blob && from) {
      dx = (blob.x - from.x) * (aspect || 1); dy = blob.y - from.y;
      dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1e-6) {
        ang2 = L.vecToAeAngle(dx, dy);
        c2 = clamp01(1 - 3 * blob.spread) * clamp01(dist / 0.2) *
          clamp01(Math.log(Math.max(1e-6, blob.meanY) / Math.max(1e-4, blob.medianY)) / Math.LN2 / 3);
        vx += c2 * dx / dist; vy += c2 * dy / dist;
      }
    }
    var mag = Math.sqrt(vx * vx + vy * vy);
    return {
      angle: mag > 1e-9 ? L.vecToAeAngle(vx, vy) : null,
      confidence: (c1 + c2) > 0 ? clamp01(mag / (c1 + c2) * Math.max(c1, c2)) : 0,
      planeAngle: plane.angle, planeConfidence: c1, blobAngle: ang2, blobConfidence: c2
    };
  }

  /** 1-D squared distance transform (Felzenszwalb & Huttenlocher 2012). */
  function dt1d(f, n, d, v, z) {
    var k = 0, q, s;
    v[0] = 0; z[0] = -1e30; z[1] = 1e30;
    for (q = 1; q < n; q++) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = 1e30;
    }
    k = 0;
    for (q = 0; q < n; q++) {
      while (z[k + 1] < q) { k++; }
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }

  /** Euclidean distance (px) from each pixel to the nearest pixel where mask(i) is true. */
  function distanceTransform(maskFn, w, h) {
    var INF = 1e20, n = w * h, grid = new Array(n), i, x, y;
    var m = Math.max(w, h), f = new Array(m), d = new Array(m), v = new Array(m), z = new Array(m + 1);
    for (i = 0; i < n; i++) { grid[i] = maskFn(i) ? 0 : INF; }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) { f[y] = grid[y * w + x]; }
      dt1d(f, h, d, v, z);
      for (y = 0; y < h; y++) { grid[y * w + x] = d[y]; }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) { f[x] = grid[y * w + x]; }
      dt1d(f, w, d, v, z);
      for (x = 0; x < w; x++) { grid[y * w + x] = Math.sqrt(d[x]); }
    }
    return grid;
  }

  /**
   * Ring weights around a character: pixels outside its alpha (a < 0.5) within
   * radius R, weighted (1 - d/R)^2 * (1 - a). Returns { w, radius, count }.
   */
  function ringWeights(alpha, w, h, radius) {
    var dist = distanceTransform(function (i) { return alpha[i] >= 0.5; }, w, h);
    var n = w * h, out = new Array(n), i, d, t, cnt = 0;
    for (i = 0; i < n; i++) {
      d = dist[i];
      if (alpha[i] < 0.5 && d > 0 && d <= radius) {
        t = 1 - d / radius;
        out[i] = t * t * (1 - alpha[i]);
        cnt++;
      } else {
        out[i] = 0;
      }
    }
    return { w: out, radius: radius, count: cnt };
  }

  /* ------------------------------------------------------------------ */
  /* haze / grain / sharpness                                            */
  /* ------------------------------------------------------------------ */

  function bandContrast(P, y0, y1, sampleStep) {
    var wts = new Array(P.n), i, x, y, s = sampleStep || 1, labC = 0, cnt = 0, cool = 0, hu, cc;
    for (i = 0; i < P.n; i++) { wts[i] = 0; }
    for (y = y0; y < y1; y++) {
      for (x = 0; x < P.w; x++) {
        i = y * P.w + x;
        wts[i] = 1;
        if ((x + y) % s === 0) {
          var lab = oklabAt(P, i);
          cc = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
          labC += cc;
          cnt++;
          hu = C.hueDeg(lab[1], lab[2]);
          if (cc > 0.03 && (hu >= 200 || hu < 10)) { cool++; }
        }
      }
    }
    var hist = histogram(P.Lr, wts, 256, 0, 1);
    return {
      contrast: percentile(hist, 0.95) - percentile(hist, 0.05),
      chroma: cnt ? labC / cnt : 0,
      meanL: percentile(hist, 0.5),
      coolFraction: cnt ? cool / cnt : 0  // blue/purple/pink pixels: a visible sky
    };
  }

  /** Atmospheric haze proxy: contrast and chroma of the upper vs lower thirds. */
  function haze(P) {
    var t = Math.floor(P.h / 3);
    var step = Math.max(1, Math.floor(P.n / 3 / 6000));
    var up = bandContrast(P, 0, t, step), lo = bandContrast(P, P.h - t, P.h, step);
    var cr = lo.contrast > 1e-4 ? up.contrast / lo.contrast : 1;
    var hr = lo.chroma > 1e-4 ? up.chroma / lo.chroma : 1;
    return { upper: up, lower: lo, haze: clamp01(0.5 * clamp01(1 - cr) + 0.5 * clamp01(1 - hr)) };
  }

  /** 3x3 box mean of a plane (edges clamped). */
  function box3(V, w, h) {
    var out = new Array(w * h), x, y, dx, dy, s, xx, yy;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        s = 0;
        for (dy = -1; dy <= 1; dy++) {
          yy = y + dy < 0 ? 0 : (y + dy >= h ? h - 1 : y + dy);
          for (dx = -1; dx <= 1; dx++) {
            xx = x + dx < 0 ? 0 : (x + dx >= w ? w - 1 : x + dx);
            s += V[yy * w + xx];
          }
        }
        out[y * w + x] = s / 9;
      }
    }
    return out;
  }

  /** Working-space luma (Rec.709 weights on encoded values) - matches what grain looks like. */
  function luma(P) {
    var out = new Array(P.n), i;
    for (i = 0; i < P.n; i++) { out[i] = 0.2126 * P.r[i] + 0.7152 * P.g[i] + 0.0722 * P.b[i]; }
    return out;
  }

  /**
   * Grain: RMS of (luma - box3(luma)) over flat areas (local gradient energy below
   * its 30th percentile). Measure on full-resolution crops: downscaled analysis
   * buffers average grain away.
   */
  function grain(P, wts) {
    var Yv = luma(P), B = box3(Yv, P.w, P.h), n = P.n, i, x, y, gx, gy;
    var gm = new Array(n), wv = wts || onesWeights(n);
    for (y = 0; y < P.h; y++) {
      for (x = 0; x < P.w; x++) {
        i = y * P.w + x;
        gx = B[y * P.w + (x + 1 < P.w ? x + 1 : x)] - B[y * P.w + (x > 0 ? x - 1 : x)];
        gy = B[(y + 1 < P.h ? y + 1 : y) * P.w + x] - B[(y > 0 ? y - 1 : y) * P.w + x];
        gm[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    var hist = histogram(gm, wv, 512, 0, 0.5);
    var thr = percentile(hist, 0.3);
    var s = 0, sw = 0, d;
    for (i = 0; i < n; i++) {
      if (wv[i] > 0 && gm[i] <= thr) { d = Yv[i] - B[i]; s += wv[i] * d * d; sw += wv[i]; }
    }
    return { grain: sw > 0 ? Math.sqrt(s / sw) : 0, flatThreshold: thr };
  }

  /** Sharpness: mean |grad L| / std(L) over weighted pixels; softness = 1 / (1 + sharpness). */
  function sharpness(P, wts) {
    var n = P.n, wv = wts || onesWeights(n), x, y, i, gx, gy, s = 0, sw = 0, m = 0, v = 0, V = P.Lr;
    for (i = 0; i < n; i++) { if (wv[i] > 0) { m += wv[i] * V[i]; sw += wv[i]; } }
    if (sw <= 0) { return { sharpness: 0, softness: 1 }; }
    m /= sw;
    for (i = 0; i < n; i++) { if (wv[i] > 0) { v += wv[i] * (V[i] - m) * (V[i] - m); } }
    v = Math.sqrt(v / sw);
    sw = 0;
    for (y = 0; y < P.h - 1; y++) {
      for (x = 0; x < P.w - 1; x++) {
        i = y * P.w + x;
        if (wv[i] > 0) {
          gx = V[i + 1] - V[i]; gy = V[i + P.w] - V[i];
          s += wv[i] * Math.sqrt(gx * gx + gy * gy); sw += wv[i];
        }
      }
    }
    var sh = (sw > 0 && v > 1e-6) ? (s / sw) / v : 0;
    return { sharpness: sh, softness: 1 / (1 + sh) };
  }

  /* ------------------------------------------------------------------ */
  /* character-specific                                                  */
  /* ------------------------------------------------------------------ */

  /** Alpha-weighted bbox + centroid in normalized coords, area fraction. */
  function bboxCentroid(a, w, h, thr) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0, sw = 0, i, x, y, t = thr || 0.02;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (a[i] > t) {
          if (x < x0) { x0 = x; } if (x > x1) { x1 = x; }
          if (y < y0) { y0 = y; } if (y > y1) { y1 = y; }
          sx += a[i] * (x + 0.5); sy += a[i] * (y + 0.5); sw += a[i];
        }
      }
    }
    if (sw <= 0) { return null; }
    return {
      bbox: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h],
      centroid: { x: sx / sw / w, y: sy / sw / h },
      area: sw / (w * h)
    };
  }

  /**
   * Line art: dark, low-chroma pixels adjacent (within 2 px) to much brighter
   * pixels - thin dark structures rather than dark fills.
   */
  function lineArt(P, wts) {
    var cand = [], i, x, y, dx, dy, j, lab, ch, lr, near, sw = 0, s = [0, 0, 0], sl = [0, 0, 0], core = 0;
    for (i = 0; i < P.n; i++) { if (wts[i] > 0) { core += wts[i]; } }
    for (y = 2; y < P.h - 2; y++) {
      for (x = 2; x < P.w - 2; x++) {
        i = y * P.w + x;
        lr = P.Lr[i];
        if (!(wts[i] > 0) || lr > 0.33) { continue; }
        near = false;
        for (dy = -2; dy <= 2 && !near; dy++) {
          for (dx = -2; dx <= 2; dx++) {
            j = i + dy * P.w + dx;
            if (P.Lr[j] > lr + 0.3 && P.a[j] > 0.5) { near = true; break; }
          }
        }
        if (!near) { continue; }
        lab = oklabAt(P, i);
        ch = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
        if (ch > 0.06) { continue; }
        cand.push(i);
        sw += wts[i];
        s[0] += wts[i] * P.r[i]; s[1] += wts[i] * P.g[i]; s[2] += wts[i] * P.b[i];
        sl[0] += wts[i] * P.lr[i]; sl[1] += wts[i] * P.lg[i]; sl[2] += wts[i] * P.lb[i];
      }
    }
    if (sw <= 0) { return null; }
    var lin = [sl[0] / sw, sl[1] / sw, sl[2] / sw];
    return { rgb: [s[0] / sw, s[1] / sw, s[2] / sw], lin: lin, L: C.linearToOklab(lin)[0], fraction: core > 0 ? sw / core : 0, count: cand.length };
  }

  /** Skin estimate: Oklab hue window, moderate chroma, high lightness (tunable). */
  function skin(P, sampleIdx, wts, o) {
    // hue 25..75 deg, chroma 0.02..0.10: excludes blonde (~88 deg, C ~0.10+) and pink hair
    var h0 = (o && o.skinHue) ? o.skinHue[0] : 25, h1 = (o && o.skinHue) ? o.skinHue[1] : 75;
    var c0 = 0.02, c1 = 0.10, l0 = 0.7;
    var sw = 0, s = [0, 0, 0], tot = 0, k, i, lab, ch, hu, x, y, bx0 = 1, by0 = 1, bx1 = 0, by1 = 0;
    for (k = 0; k < sampleIdx.length; k++) {
      i = sampleIdx[k];
      tot += wts[i];
      lab = oklabAt(P, i);
      if (lab[0] < l0) { continue; }
      ch = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
      if (ch < c0 || ch > c1) { continue; }
      hu = C.hueDeg(lab[1], lab[2]);
      if (hu < h0 || hu > h1) { continue; }
      sw += wts[i];
      s[0] += wts[i] * lab[0]; s[1] += wts[i] * lab[1]; s[2] += wts[i] * lab[2];
      x = ((i % P.w) + 0.5) / P.w; y = (Math.floor(i / P.w) + 0.5) / P.h;
      if (x < bx0) { bx0 = x; } if (x > bx1) { bx1 = x; } if (y < by0) { by0 = y; } if (y > by1) { by1 = y; }
    }
    if (sw <= 0) { return null; }
    var labm = [s[0] / sw, s[1] / sw, s[2] / sw];
    return { lab: labm, rgb: C.oklabToSrgb(labm), hue: C.hueDeg(labm[1], labm[2]), fraction: sw / tot, bbox: [bx0, by0, bx1, by1] };
  }

  /** Weights of the inner edge band: alpha >= 0.5 and within px of the outside. */
  function edgeBand(a, w, h, px) {
    var dist = distanceTransform(function (i) { return a[i] < 0.5; }, w, h);
    var out = new Array(w * h), i;
    for (i = 0; i < w * h; i++) { out[i] = (a[i] >= 0.5 && dist[i] <= px) ? 1 : 0; }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* region summaries                                                    */
  /* ------------------------------------------------------------------ */

  function sumW(w) { var s = 0, i; for (i = 0; i < w.length; i++) { if (w[i] > 0) { s += w[i]; } } return s; }

  /** Everything we report for one weighted region of one image. */
  function region(P, wts, o) {
    var weight = sumW(wts);
    if (weight <= 0) { return { weight: 0, empty: true }; }
    var hist = histogram(P.Lr, wts, opt(o, "bins"), 0, 1);
    var idx = sampleIndices(wts, opt(o, "maxSamples"));
    var mw = moments3(P.r, P.g, P.b, wts);
    var ml = moments3(P.lr, P.lg, P.lb, wts);
    var labSum = [0, 0, 0], cSum = 0, rcSum = 0, sw = 0, k, i, lab, wv, cc;
    for (k = 0; k < idx.length; k++) {
      i = idx[k]; wv = wts[i];
      lab = oklabAt(P, i);
      labSum[0] += wv * lab[0]; labSum[1] += wv * lab[1]; labSum[2] += wv * lab[2];
      cc = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
      cSum += wv * cc;
      rcSum += wv * cc / Math.max(0.1, lab[0]);
      sw += wv;
    }
    var key = keyColor(P, wts, hist, o);
    var pct = percentiles(hist, [0.01, 0.02, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]);
    var yMed = Math.pow(pct.p50, 3);
    return {
      weight: weight,
      mean: mw.mean, cov: mw.cov,
      meanLin: ml.mean, covLin: ml.cov,
      meanLab: [labSum[0] / sw, labSum[1] / sw, labSum[2] / sw],
      meanChroma: cSum / sw,
      meanRelChroma: rcSum / sw, // mean C/L (lightness-independent "saturation")
      L: pct,
      medianY: yMed,
      meanY: C.luminance(ml.mean),
      clipFraction: hist.total > 0 ? hist.over / hist.total : 0,
      black: blackColor(P, wts, hist, opt(o, "blackPct")),
      key: key,
      bands: bandTints(P, idx, wts, hist),
      illuminant: illuminant(P, wts, key, o),
      _hist: hist,
      _idx: idx
    };
  }

  function strip(rg) {
    if (rg) { delete rg._hist; delete rg._idx; }
    return rg;
  }

  /**
   * Bright saturated "emitter" pixels (neon detector), split by hue: warm (orange/
   * yellow, hue 20..110 deg: fire, lamps) vs other (magenta, cyan, green, blue: neon).
   * Thresholds are low enough for thin tubes after downscaling to analysis size.
   */
  function emitters(P, wts, idx, o) {
    var minL = (o && o.emitterMinL2 !== undefined) ? o.emitterMinL2 : 0.45;
    var minC = (o && o.emitterMinC2 !== undefined) ? o.emitterMinC2 : 0.12;
    var k, i, lab, ch, hu, warm = 0, other = 0, tot = 0;
    for (k = 0; k < idx.length; k++) {
      i = idx[k]; tot += wts[i];
      if (P.Lr[i] < minL * 0.8) { continue; }
      lab = oklabAt(P, i);
      if (lab[0] < minL) { continue; }
      ch = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
      if (ch < minC) { continue; }
      hu = C.hueDeg(lab[1], lab[2]);
      if (hu >= 20 && hu <= 110) { warm += wts[i]; } else { other += wts[i]; }
    }
    return { all: tot > 0 ? (warm + other) / tot : 0, warm: tot > 0 ? warm / tot : 0, other: tot > 0 ? other / tot : 0 };
  }

  function emitterFraction(P, wts, idx) { return emitters(P, wts, idx).all; }

  /**
   * Analyze a background buffer. chars: array of { id, alpha } (alpha planes in the
   * same grid, comp space) for ring statistics. Returns a JSON-serializable object.
   */
  function analyzeBackground(bg, chars, o) {
    var P = prepare(bg);
    var all = onesWeights(P.n);
    var g = region(P, all, o);
    var res = { w: P.w, h: P.h, global: null, rings: [], light: null };
    var idx = g._idx;
    res.emitters = emitters(P, all, idx, o);
    res.emitterFraction = res.emitters.all;
    res.palette = palette(P, all, o);
    res.plane = planeFit(P, all);
    res.blob = brightBlob(P, all, o);
    res.haze = haze(P);
    res.sharpness = sharpness(P, all);
    res.grainAtAnalysisRes = grain(P, all).grain;
    res.global = strip(g);
    var i, ch, ring, rg, bc, R = Math.max(2, Math.round(opt(o, "ringFrac") * P.h));
    for (i = 0; chars && i < chars.length; i++) {
      ch = chars[i];
      ring = ringWeights(ch.alpha, P.w, P.h, R);
      rg = region(P, ring.w, o);
      bc = bboxCentroid(ch.alpha, P.w, P.h);
      rg.light = lightDirection(res.plane, res.blob, bc ? bc.centroid : null, P.w / P.h);
      rg.localPlane = planeFit(P, ring.w);
      rg.ringRadiusPx = R;
      rg.ringPixels = ring.count;
      rg.id = ch.id;
      res.rings.push(strip(rg));
    }
    res.light = lightDirection(res.plane, res.blob, null, P.w / P.h);
    return res;
  }

  /** Analyze an isolated character buffer (its own alpha, comp space). */
  function analyzeCharacter(chImg, o) {
    var P = prepare(chImg);
    var core = coreWeights(P.a, opt(o, "coreAlpha"));
    var rg = region(P, core, o);
    if (rg.empty) { return { empty: true }; }
    rg.palette = palette(P, core, o);
    rg.lineArt = lineArt(P, core);
    rg.skin = skin(P, rg._idx, core, o);
    var bc = bboxCentroid(P.a, P.w, P.h);
    rg.bbox = bc ? bc.bbox : null;
    rg.centroid = bc ? bc.centroid : null;
    rg.area = bc ? bc.area : 0;
    var eb = edgeBand(P.a, P.w, P.h, Math.max(1.5, P.h * 0.006));
    var em = meanWhere(P, eb, function () { return true; });
    rg.edge = em ? { rgb: em.rgb, lin: em.lin, L: C.linearToOklab(em.lin)[0] } : null;
    rg.sharpness = sharpness(P, core);
    rg.w = P.w; rg.h = P.h;
    return strip(rg);
  }

  return {
    DEFAULTS: DEFAULTS,
    prepare: prepare,
    coreWeights: coreWeights,
    onesWeights: onesWeights,
    sampleIndices: sampleIndices,
    moments3: moments3,
    histogram: histogram,
    percentile: percentile,
    percentiles: percentiles,
    meanWhere: meanWhere,
    blackColor: blackColor,
    keyColor: keyColor,
    bandTints: bandTints,
    shadesOfGray: shadesOfGray,
    illuminant: illuminant,
    describeIlluminant: describeIlluminant,
    kmeans: kmeans,
    palette: palette,
    planeFit: planeFit,
    brightBlob: brightBlob,
    lightDirection: lightDirection,
    distanceTransform: distanceTransform,
    ringWeights: ringWeights,
    haze: haze,
    grain: grain,
    sharpness: sharpness,
    bboxCentroid: bboxCentroid,
    lineArt: lineArt,
    skin: skin,
    edgeBand: edgeBand,
    region: function (P, w, o) { return strip(region(P, w, o)); },
    emitters: emitters,
    emitterFraction: emitterFraction,
    analyzeBackground: analyzeBackground,
    analyzeCharacter: analyzeCharacter
  };
}));
