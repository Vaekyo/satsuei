/*
 * SATSUEI core/fxmodel - pointwise models of the built-in AE effects the match
 * chain uses, so the solver can predict what AE will render (pure ES3).
 *
 * Every model maps a WORKING-space triplet (sRGB-encoded 0..1 for a non-linear
 * 8/16 bpc project) to a working-space triplet. They are best-knowledge guesses
 * until calibrated (docs/DECISIONS.md P-10); calibration (config/calibration_*.json)
 * overrides the constants in CAL via setCalibration().
 *
 * Match chain (sec. 6.5), in effect order on the character layer:
 *   Exposure (Individual Channels: WB stops + EV)  ->  Levels (Individual Controls:
 *   lift / gamma / gain per channel)  ->  Channel Mixer (saturation, contrast and
 *   MKL harmony composed into one affine map).
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory(require("./color.js"), require("./linalg.js"));
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.core = S.core || {};
  S.core.fxmodel = factory(S.core.color, S.core.linalg);
}(function (C, L) {
  var CAL = {
    // Exposure converts working -> linear before applying stops unless "Bypass
    // Linear Light Conversion" is on (UNVERIFIED: which transfer curve).
    exposureLinearization: "srgb", // "srgb" | "gamma2.2" | "none"
    // Levels gamma: out = in^(1/gamma) (Photoshop convention) (UNVERIFIED)
    levelsGammaInverse: true,
    // 8/16 bpc effects clamp to [0, 1]; 32 bpc does not.
    clamp: true,
    // Rec.709 luma weights used by the Channel Mixer saturation matrix (working space).
    luma: [0.2126, 0.7152, 0.0722]
  };

  function setCalibration(cal) {
    var k;
    for (k in cal) { if (cal.hasOwnProperty(k) && CAL.hasOwnProperty(k)) { CAL[k] = cal[k]; } }
  }

  function cl(v) { return CAL.clamp ? (v < 0 ? 0 : (v > 1 ? 1 : v)) : v; }

  function toLin(v) {
    if (CAL.exposureLinearization === "none") { return v; }
    if (CAL.exposureLinearization === "gamma2.2") { return v <= 0 ? 0 : Math.pow(v, 2.2); }
    return C.srgbToLinear(v);
  }
  function fromLin(v) {
    if (CAL.exposureLinearization === "none") { return v; }
    if (CAL.exposureLinearization === "gamma2.2") { return v <= 0 ? 0 : Math.pow(v, 1 / 2.2); }
    return C.linearToSrgb(v);
  }

  /**
   * Exposure, Individual Channels. p = { stops: [r, g, b], offset: [..], gamma: [..] }
   * out = fromLin( (toLin(in) * 2^stops + offset) ^ (1 / gamma) ).
   */
  function exposure(rgb, p) {
    var out = [0, 0, 0], c, v, st, of, ga;
    for (c = 0; c < 3; c++) {
      st = p.stops ? p.stops[c] : 0;
      of = p.offset ? p.offset[c] : 0;
      ga = p.gamma ? p.gamma[c] : 1;
      v = toLin(rgb[c]) * Math.pow(2, st) + of;
      if (v < 0) { v = 0; }
      if (ga !== 1) { v = Math.pow(v, 1 / ga); }
      out[c] = cl(fromLin(v));
    }
    return out;
  }

  /**
   * Levels (Individual Controls), per channel only (master left at identity).
   * p = { inBlack, inWhite, gamma, outBlack, outWhite } each [r, g, b].
   */
  function levels(rgb, p) {
    var out = [0, 0, 0], c, t, ib, iw, g, ob, ow;
    for (c = 0; c < 3; c++) {
      ib = p.inBlack ? p.inBlack[c] : 0;
      iw = p.inWhite ? p.inWhite[c] : 1;
      g = p.gamma ? p.gamma[c] : 1;
      ob = p.outBlack ? p.outBlack[c] : 0;
      ow = p.outWhite ? p.outWhite[c] : 1;
      t = (rgb[c] - ib) / (iw - ib);
      if (t < 0) { t = 0; }
      if (CAL.clamp && t > 1) { t = 1; }
      if (g !== 1) { t = Math.pow(t, CAL.levelsGammaInverse ? 1 / g : g); }
      out[c] = cl(ob + (ow - ob) * t);
    }
    return out;
  }

  /** Channel Mixer: out = (M/100) * in + const/100, M and const in AE percent units. */
  function channelMixer(rgb, Mpct, constPct) {
    var o = L.mulVec3(L.scale3(Mpct, 0.01), rgb);
    return [cl(o[0] + constPct[0] / 100), cl(o[1] + constPct[1] / 100), cl(o[2] + constPct[2] / 100)];
  }

  /** Affine helpers in 0..1 units ({ A, b }); toMixer converts to AE percent units. */
  function affineIdentity() { return { A: L.I3(), b: [0, 0, 0] }; }

  /** (f2 o f1)(x) = A2 (A1 x + b1) + b2 */
  function affineCompose(f2, f1) {
    var A = L.mul3(f2.A, f1.A), b = L.mulVec3(f2.A, f1.b);
    return { A: A, b: [b[0] + f2.b[0], b[1] + f2.b[1], b[2] + f2.b[2]] };
  }

  /** Luma-preserving saturation in working space: s*I + (1-s)*1*w^T. */
  function saturationAffine(s) {
    var w = CAL.luma, A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], i, j;
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 3; j++) { A[i][j] = (1 - s) * w[j] + (i === j ? s : 0); }
    }
    return { A: A, b: [0, 0, 0] };
  }

  /** Contrast around a pivot (working units): pivot + c * (x - pivot). */
  function contrastAffine(c, pivot) {
    return { A: [[c, 0, 0], [0, c, 0], [0, 0, c]], b: [(1 - c) * pivot, (1 - c) * pivot, (1 - c) * pivot] };
  }

  function toMixer(f) {
    return { M: L.scale3(f.A, 100), constPct: [f.b[0] * 100, f.b[1] * 100, f.b[2] * 100] };
  }

  function applyAffine(f, rgb) {
    var o = L.applyAffine(f.A, f.b, rgb);
    return [cl(o[0]), cl(o[1]), cl(o[2])];
  }

  /**
   * Full match chain at given strengths.
   * params: { wbStops[3], ev, lift[3], gamma[3], gain[3], sat, contrast, pivot, mkl: {A, b} }
   * k: { wb, ev, lift, gamma, gain, sat, contrast, harmony } (0..1 effective strengths)
   */
  function chainSettings(params, k) {
    var ks = k || {};
    var kw = ks.wb === undefined ? 1 : ks.wb;
    var ke = ks.ev === undefined ? 1 : ks.ev;
    var kl = ks.lift === undefined ? 1 : ks.lift;
    var kg = ks.gamma === undefined ? 1 : ks.gamma;
    var kh = ks.gain === undefined ? 1 : ks.gain;
    var kS = ks.sat === undefined ? 1 : ks.sat;
    var kc = ks.contrast === undefined ? 1 : ks.contrast;
    var kH = ks.harmony === undefined ? 0 : ks.harmony;
    var stops = [0, 0, 0], lift = [0, 0, 0], gam = [1, 1, 1], gain = [1, 1, 1], c;
    for (c = 0; c < 3; c++) {
      stops[c] = (params.wbStops ? params.wbStops[c] : 0) * kw + (params.ev || 0) * ke;
      lift[c] = (params.lift ? params.lift[c] : 0) * kl;
      gam[c] = Math.pow(params.gamma ? params.gamma[c] : 1, kg);
      gain[c] = 1 - (1 - (params.gain ? params.gain[c] : 1)) * kh;
    }
    var sat = Math.pow(params.sat || 1, kS);
    var con = Math.pow(params.contrast || 1, kc);
    var f = saturationAffine(sat);
    f = affineCompose(contrastAffine(con, params.pivot === undefined ? 0.5 : params.pivot), f);
    if (params.mkl && kH > 0) {
      var mb = L.affineBlend(params.mkl.A, params.mkl.b, kH);
      f = affineCompose({ A: mb.A, b: mb.b }, f);
    }
    return {
      exposure: { stops: stops },
      levels: { outBlack: lift, gamma: gam, outWhite: gain },
      mixer: f
    };
  }

  function applyChain(rgb, settings) {
    return applyAffine(settings.mixer, levels(exposure(rgb, settings.exposure), settings.levels));
  }

  return {
    CAL: CAL,
    setCalibration: setCalibration,
    exposure: exposure,
    levels: levels,
    channelMixer: channelMixer,
    affineIdentity: affineIdentity,
    affineCompose: affineCompose,
    saturationAffine: saturationAffine,
    contrastAffine: contrastAffine,
    toMixer: toMixer,
    applyAffine: applyAffine,
    chainSettings: chainSettings,
    applyChain: applyChain
  };
}));
