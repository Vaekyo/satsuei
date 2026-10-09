/*
 * SATSUEI core/transfer - color transfer math and the Lighting Transfer solver
 * (sec. 6.5). Pure ES3. All formulas: docs/ALGORITHMS.md sec. Transfer.
 *
 * The solver predicts what AE will render by running the fxmodel chain over a
 * sample of the character's core pixels, so every step is solved on the output of
 * the previous steps (no double-applied casts), and guards (line art, clipping,
 * readability) are checked on the prediction.
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory(require("./color.js"), require("./linalg.js"), require("./fxmodel.js"));
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.core = S.core || {};
  S.core.transfer = factory(S.core.color, S.core.linalg, S.core.fxmodel);
}(function (C, L, FX) {
  var DEFAULTS = {
    ringIllumMix: 0.5,      // E_bg = lerp(global, ring) illuminant
    maxIllumChroma: 0.12,   // cap Oklab chroma of E_bg (strong casts come from scene colors)
    charIllumTrust: 0.3,    // E_char = lerp(neutral, measured, trust)
    maxWbStops: 1.5,
    kExposure: 0.6,
    yRef: 0.12,             // linear ring median luminance that needs no exposure change
    evMin: -2.5,
    evMax: 1.0,
    liftCap: 0.2,
    lineMargin: 0.12,       // Oklab L: lifted line art stays this much below p20 of fills
    midTintScale: 0.6,
    maxMidTint: 0.03,       // Oklab chroma cap of the midtone residual tint
    highTintScale: 0.5,
    minGain: 0.85,
    gammaMin: 0.75,
    gammaMax: 1.35,
    rho: 1.15,              // characters may be a little more saturated than the ring
    satMin: 0.6,
    satMax: 1.2,
    classSatWeight: 0.5,    // log-blend of measured saturation scale with the class prior
    contrastExp: 0.25,
    contrastMin: 0.85,
    contrastMax: 1.15,
    mklEps: 1e-4,
    mklMaxGain: 2.0,        // clamp eigenvalues of T into [1/g, g]
    clipP99: 0.985,
    readabilityMin: 0.08    // Oklab L contrast between edge band and ring
  };

  function cfgGet(o, k) { return (o && o[k] !== undefined) ? o[k] : DEFAULTS[k]; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function log2(v) { return Math.log(v) / Math.LN2; }

  /* ------------------------------------------------------------------ */
  /* sample sets                                                         */
  /* ------------------------------------------------------------------ */

  /** samples: { r: [], g: [], b: [], w: [] } (working). Returns a new mapped set. */
  function mapSamples(s, f) {
    var n = s.r.length, o = { r: new Array(n), g: new Array(n), b: new Array(n), w: s.w }, i, c;
    for (i = 0; i < n; i++) {
      c = f([s.r[i], s.g[i], s.b[i]]);
      o.r[i] = c[0]; o.g[i] = c[1]; o.b[i] = c[2];
    }
    return o;
  }

  /** Summary of a sample set: mean/cov (working), Oklab mean chroma, lightness percentiles, luma percentiles. */
  function describe(s) {
    var n = s.r.length, sw = 0, m = [0, 0, 0], i, w, d0, d1, d2, lab, cs = 0;
    var cv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var Ls = [], lumas = [], labSum = [0, 0, 0];
    for (i = 0; i < n; i++) {
      w = s.w ? s.w[i] : 1;
      sw += w; m[0] += w * s.r[i]; m[1] += w * s.g[i]; m[2] += w * s.b[i];
    }
    m[0] /= sw; m[1] /= sw; m[2] /= sw;
    for (i = 0; i < n; i++) {
      w = s.w ? s.w[i] : 1;
      d0 = s.r[i] - m[0]; d1 = s.g[i] - m[1]; d2 = s.b[i] - m[2];
      cv[0][0] += w * d0 * d0; cv[0][1] += w * d0 * d1; cv[0][2] += w * d0 * d2;
      cv[1][1] += w * d1 * d1; cv[1][2] += w * d1 * d2; cv[2][2] += w * d2 * d2;
      lab = C.srgbToOklab([s.r[i], s.g[i], s.b[i]]);
      cs += w * Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
      labSum[0] += w * lab[0]; labSum[1] += w * lab[1]; labSum[2] += w * lab[2];
      Ls.push(lab[0]);
      lumas.push(0.2126 * s.r[i] + 0.7152 * s.g[i] + 0.0722 * s.b[i]);
    }
    cv[0][0] /= sw; cv[0][1] /= sw; cv[0][2] /= sw; cv[1][1] /= sw; cv[1][2] /= sw; cv[2][2] /= sw;
    cv[1][0] = cv[0][1]; cv[2][0] = cv[0][2]; cv[2][1] = cv[1][2];
    Ls.sort(function (a, b) { return a - b; });
    lumas.sort(function (a, b) { return a - b; });
    function q(arr, p) { return arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1) + 0.5))] : 0; }
    return {
      n: n, mean: m, cov: cv, meanChroma: cs / sw,
      meanLab: [labSum[0] / sw, labSum[1] / sw, labSum[2] / sw],
      L: { p5: q(Ls, 0.05), p20: q(Ls, 0.2), p50: q(Ls, 0.5), p95: q(Ls, 0.95), p99: q(Ls, 0.99) },
      luma: { p5: q(lumas, 0.05), p50: q(lumas, 0.5), p95: q(lumas, 0.95), p99: q(lumas, 0.99) },
      clipFraction: (function () {
        var k, c = 0;
        for (k = 0; k < n; k++) { if (s.r[k] >= 0.999 || s.g[k] >= 0.999 || s.b[k] >= 0.999) { c++; } }
        return n ? c / n : 0;
      }())
    };
  }

  /* ------------------------------------------------------------------ */
  /* MKL / Reinhard                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Monge-Kantorovich linear transfer (Pitie & Kokaram 2007):
   * T = Ss^-1/2 (Ss^1/2 St Ss^1/2)^1/2 Ss^-1/2, x' = T (x - mu_s) + mu_t.
   * Regularized (Sigma + eps*I), T's eigenvalues clamped to [1/g, g].
   */
  function mkl(muS, covS, muT, covT, o) {
    var eps = cfgGet(o, "mklEps"), g = cfgGet(o, "mklMaxGain");
    var I = L.I3();
    var Ss = L.add3(covS, L.scale3(I, eps)), St = L.add3(covT, L.scale3(I, eps));
    var Sh = L.sqrtmSym3(Ss, eps), Shi = L.invSqrtmSym3(Ss, eps);
    var mid = L.sqrtmSym3(L.mul3(L.mul3(Sh, St), Sh), 0);
    var T = L.mul3(L.mul3(Shi, mid), Shi);
    // symmetrize, then clamp eigenvalues
    T = L.scale3(L.add3(T, L.transpose3(T)), 0.5);
    var e = L.eigSym3(T), clamped = 0;
    T = L.symFn3(T, function (lam) {
      var v = clamp(lam, 1 / g, g);
      if (v !== lam) { clamped++; }
      return v;
    });
    var Tm = L.mulVec3(T, muS);
    return {
      A: T,
      b: [muT[0] - Tm[0], muT[1] - Tm[1], muT[2] - Tm[2]],
      eigen: e.values,
      clamped: clamped
    };
  }

  /**
   * Reinhard in Oklab (per-channel mean/std match), realized as the best-fit affine
   * RGB map over the samples (weighted least squares, small ridge toward identity).
   * Returns { A, b, residualDE } (residual = mean Oklab distance to the ideal).
   */
  function reinhardAffine(src, tgtLabMean, tgtLabStd, o) {
    var n = src.r.length, labs = [], i, c, lab, mu = [0, 0, 0], sd = [0, 0, 0], sw = 0, w;
    for (i = 0; i < n; i++) {
      lab = C.srgbToOklab([src.r[i], src.g[i], src.b[i]]);
      labs.push(lab);
      w = src.w ? src.w[i] : 1;
      sw += w;
      for (c = 0; c < 3; c++) { mu[c] += w * lab[c]; }
    }
    for (c = 0; c < 3; c++) { mu[c] /= sw; }
    for (i = 0; i < n; i++) {
      w = src.w ? src.w[i] : 1;
      for (c = 0; c < 3; c++) { sd[c] += w * (labs[i][c] - mu[c]) * (labs[i][c] - mu[c]); }
    }
    for (c = 0; c < 3; c++) { sd[c] = Math.sqrt(sd[c] / sw); }
    var rows = [], ys = [[], [], []], ws = [], ideal = [], t;
    for (i = 0; i < n; i++) {
      t = [0, 0, 0];
      for (c = 0; c < 3; c++) {
        t[c] = (labs[i][c] - mu[c]) * (sd[c] > 1e-6 ? tgtLabStd[c] / sd[c] : 1) + tgtLabMean[c];
      }
      ideal.push(t);
      var rgb = C.oklabToSrgb(t);
      rows.push([src.r[i], src.g[i], src.b[i], 1]);
      ws.push(src.w ? src.w[i] : 1);
      for (c = 0; c < 3; c++) { ys[c].push(rgb[c]); }
    }
    var ridge = (o && o.ridge !== undefined) ? o.ridge : 1e-3 * n;
    var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0], beta;
    for (c = 0; c < 3; c++) {
      var prior = [0, 0, 0, 0];
      prior[c] = 1;
      beta = L.wls(rows, ys[c], ws, ridge, prior) || prior;
      A[c][0] = beta[0]; A[c][1] = beta[1]; A[c][2] = beta[2]; b[c] = beta[3];
    }
    var de = 0;
    for (i = 0; i < n; i++) {
      var pr = L.applyAffine(A, b, [src.r[i], src.g[i], src.b[i]]);
      de += (src.w ? src.w[i] : 1) * C.deltaEOk(C.srgbToOklab(pr), ideal[i]);
    }
    return { A: A, b: b, residualDE: de / sw };
  }

  /* ------------------------------------------------------------------ */
  /* Lighting Transfer solver                                            */
  /* ------------------------------------------------------------------ */

  function capChroma(e, maxC) {
    var lab = C.linearToOklab(e), ch = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
    if (ch <= maxC || ch < 1e-9) { return e; }
    var k = maxC / ch;
    var lin = C.oklabToLinear([lab[0], lab[1] * k, lab[2] * k]);
    return C.normalizeLuminance([Math.max(1e-6, lin[0]), Math.max(1e-6, lin[1]), Math.max(1e-6, lin[2])]);
  }

  function mixIllum(gl, ring, t) {
    var a = gl && gl.known ? gl.lin : null, b = ring && ring.known ? ring.lin : null;
    if (a && b) { return C.normalizeLuminance([L.lerp(a[0], b[0], t), L.lerp(a[1], b[1], t), L.lerp(a[2], b[2], t)]); }
    return a || b || [1, 1, 1];
  }

  /** Oklab (a/L, b/L) "relative tint" of a color. */
  function relTint(lab) {
    var l = Math.max(0.05, lab[0]);
    return [lab[1] / l, lab[2] / l];
  }

  function capVec(v, maxLen) {
    var len = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    return len > maxLen ? [v[0] * maxLen / len, v[1] * maxLen / len] : v;
  }

  /**
   * solve(bg, ch, samples, opts)
   *   bg: { global: region, ring: region | null }   (core/stats region objects)
   *   ch: analyzeCharacter() result
   *   samples: { r, g, b, w } core pixels of the character (working)
   *   opts: { config: {...DEFAULTS overrides}, classSat: 1.0,
   *           strengths: { wb, ev, lift, gamma, gain, sat, contrast, harmony } (effective, for prediction) }
   * Returns { params, steps, predicted, guards }.
   */
  function solve(bg, ch, samples, opts) {
    var o = (opts && opts.config) || {};
    var ringOk = !!(bg.ring && !bg.ring.empty && bg.ring.weight > 0);
    var R = ringOk ? bg.ring : bg.global;
    var steps = {};

    /* 1. white balance (von Kries, linear) */
    var Ebg = capChroma(mixIllum(bg.global.illuminant, ringOk ? bg.ring.illuminant : null, cfgGet(o, "ringIllumMix")), cfgGet(o, "maxIllumChroma"));
    var trust = cfgGet(o, "charIllumTrust");
    var em = (ch.illuminant && ch.illuminant.known) ? ch.illuminant.lin : [1, 1, 1];
    var Ech = C.normalizeLuminance([L.lerp(1, em[0], trust), L.lerp(1, em[1], trust), L.lerp(1, em[2], trust)]);
    var g = [Ebg[0] / Ech[0], Ebg[1] / Ech[1], Ebg[2] / Ech[2]];
    var gy = C.luminance(g);
    var mws = cfgGet(o, "maxWbStops");
    var wbStops = [clamp(log2(g[0] / gy), -mws, mws), clamp(log2(g[1] / gy), -mws, mws), clamp(log2(g[2] / gy), -mws, mws)];
    steps.wb = { Ebg: Ebg, Ech: Ech, stops: wbStops, cct: Math.round(C.linearToCct(Ebg)) };

    /* 2. exposure */
    var yRing = Math.max(1e-4, R.medianY);
    var ev = clamp(cfgGet(o, "kExposure") * log2(yRing / cfgGet(o, "yRef")), cfgGet(o, "evMin"), cfgGet(o, "evMax"));
    steps.ev = { yRing: yRing, ev: ev };

    var expoFull = { stops: [wbStops[0] + ev, wbStops[1] + ev, wbStops[2] + ev] };
    var s1 = mapSamples(samples, function (c) { return FX.exposure(c, expoFull); });
    var d1 = describe(s1);

    /* 3. lift (line-art tint), guarded so lines stay darker than fills */
    var black = (R.black && R.black.rgb) ? R.black.rgb : [0, 0, 0];
    var cap = cfgGet(o, "liftCap");
    var lift = [Math.min(cap, black[0]), Math.min(cap, black[1]), Math.min(cap, black[2])];
    var line0 = FX.exposure((ch.lineArt && ch.lineArt.rgb) ? ch.lineArt.rgb : [0.08, 0.08, 0.08], expoFull);
    var Lline0 = C.srgbToOklab(line0)[0];
    var lifted = [lift[0] + (1 - lift[0]) * line0[0], lift[1] + (1 - lift[1]) * line0[1], lift[2] + (1 - lift[2]) * line0[2]];
    var Lline = C.srgbToOklab(lifted)[0];
    var Lmax = d1.L.p20 - cfgGet(o, "lineMargin");
    var liftScale = 1;
    if (Lline > Lmax && Lline > Lline0 + 1e-6) {
      liftScale = clamp((Lmax - Lline0) / (Lline - Lline0), 0, 1);
      lift = [lift[0] * liftScale, lift[1] * liftScale, lift[2] * liftScale];
    }
    steps.lift = { black: black, lift: lift, guardScale: liftScale, lineL: Lline0, fillP20: d1.L.p20 };

    /* 4. midtone tint: residual of the ring's mid band vs the illuminant, per-channel gamma */
    var illumRel = relTint(C.linearToOklab(Ebg));
    var gamma = [1, 1, 1], midRes = [0, 0];
    if (R.bands && R.bands.mid) {
      var mr = relTint(R.bands.mid.lab);
      midRes = capVec([(mr[0] - illumRel[0]) * cfgGet(o, "midTintScale"), (mr[1] - illumRel[1]) * cfgGet(o, "midTintScale")], cfgGet(o, "maxMidTint"));
      var x0 = FX.exposure([0.5, 0.5, 0.5], expoFull); // a mid gray after WB/EV
      var lab0 = C.srgbToOklab(x0);
      var tgt = C.oklabToSrgb([lab0[0], lab0[1] + midRes[0] * lab0[0], lab0[2] + midRes[1] * lab0[0]]);
      var c;
      for (c = 0; c < 3; c++) {
        var xi = clamp(x0[c], 0.02, 0.98), ti = clamp(tgt[c], 0.02, 0.98);
        gamma[c] = clamp(Math.log(xi) / Math.log(ti), cfgGet(o, "gammaMin"), cfgGet(o, "gammaMax"));
      }
    }
    steps.mid = { residual: midRes, gamma: gamma };

    /* 5. highlight tint: residual of the key vs the illuminant, as output white <= 1 */
    var gain = [1, 1, 1], hiRes = [0, 0];
    if (R.key && R.key.lin && C.luminance(R.key.lin) > 1e-6) {
      var kr = relTint(C.linearToOklab(C.normalizeLuminance(R.key.lin)));
      hiRes = capVec([(kr[0] - illumRel[0]) * cfgGet(o, "highTintScale"), (kr[1] - illumRel[1]) * cfgGet(o, "highTintScale")], cfgGet(o, "maxMidTint"));
      var w1 = C.oklabToSrgb([1, hiRes[0], hiRes[1]]);
      var mx = Math.max(w1[0], w1[1], w1[2], 1e-6);
      gain = [clamp(w1[0] / mx, cfgGet(o, "minGain"), 1), clamp(w1[1] / mx, cfgGet(o, "minGain"), 1), clamp(w1[2] / mx, cfgGet(o, "minGain"), 1)];
    }
    steps.high = { residual: hiRes, gain: gain };

    var lv = { outBlack: lift, gamma: gamma, outWhite: gain };
    var s2 = mapSamples(s1, function (c2) { return FX.levels(c2, lv); });
    var d2 = describe(s2);

    /* 6. saturation (luma-preserving matrix) */
    var targetC = R.meanChroma * cfgGet(o, "rho");
    var satMeasured = d2.meanChroma > 1e-4 ? clamp(targetC / d2.meanChroma, cfgGet(o, "satMin"), cfgGet(o, "satMax")) : 1;
    var classSat = (opts && opts.classSat) || 1;
    var cw = cfgGet(o, "classSatWeight");
    var sat = Math.exp((1 - cw) * Math.log(satMeasured) + cw * Math.log(classSat));
    steps.sat = { target: targetC, current: d2.meanChroma, measured: satMeasured, classPrior: classSat, sat: sat };

    /* 7. contrast around the character's median luma */
    var rangeBg = (R.L.p95 - R.L.p5), rangeCh = (d2.L.p95 - d2.L.p5);
    var con = (rangeCh > 1e-3 && rangeBg > 1e-3) ? clamp(Math.pow(rangeBg / rangeCh, cfgGet(o, "contrastExp")), cfgGet(o, "contrastMin"), cfgGet(o, "contrastMax")) : 1;
    var pivot = d2.luma.p50;
    steps.contrast = { rangeBg: rangeBg, rangeCh: rangeCh, contrast: con, pivot: pivot };

    var f67 = FX.affineCompose(FX.contrastAffine(con, pivot), FX.saturationAffine(sat));
    var s3 = mapSamples(s2, function (c3) { return FX.applyAffine(f67, c3); });
    var d3 = describe(s3);

    /* 8. harmony: MKL from the post-step-7 distribution to the ring distribution */
    var M = mkl(d3.mean, d3.cov, R.mean, R.cov, o);
    steps.harmony = { eigen: M.eigen, clamped: M.clamped };

    var params = {
      wbStops: wbStops, ev: ev, lift: lift, gamma: gamma, gain: gain,
      sat: sat, contrast: con, pivot: pivot, mkl: { A: M.A, b: M.b }
    };

    /* guards on the prediction at the requested strengths */
    var k = (opts && opts.strengths) || { wb: 1, ev: 1, lift: 1, gamma: 1, gain: 1, sat: 1, contrast: 1, harmony: 0.25 };
    var pred = predict(samples, params, k);
    var it = 0;
    while (pred.luma.p99 > cfgGet(o, "clipP99") && pred.luma.p99 > describe(samples).luma.p99 && it < 20 && params.ev > cfgGet(o, "evMin")) {
      params.ev -= 0.1;
      pred = predict(samples, params, k);
      it++;
    }
    var edgeRgb = (ch.edge && ch.edge.rgb) ? ch.edge.rgb : null;
    var readability = null;
    if (edgeRgb) {
      var st = FX.chainSettings(params, k);
      var edgeOut = FX.applyChain(edgeRgb, st);
      var Le = C.srgbToOklab(edgeOut)[0], Lr = R.meanLab[0];
      readability = { edgeL: Le, ringL: Lr, contrast: Math.abs(Le - Lr), ok: Math.abs(Le - Lr) >= cfgGet(o, "readabilityMin") };
    }
    return {
      params: params,
      steps: steps,
      predicted: pred,
      before: describe(samples),
      guards: { clipEvReduction: it * 0.1, readability: readability, ringUsed: ringOk }
    };
  }

  /** Predict sample statistics after the chain at strengths k. */
  function predict(samples, params, k) {
    var st = FX.chainSettings(params, k);
    return describe(mapSamples(samples, function (c) { return FX.applyChain(c, st); }));
  }

  return {
    DEFAULTS: DEFAULTS,
    mapSamples: mapSamples,
    describe: describe,
    mkl: mkl,
    reinhardAffine: reinhardAffine,
    capChroma: capChroma,
    solve: solve,
    predict: predict
  };
}));
