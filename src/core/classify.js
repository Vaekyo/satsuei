/*
 * SATSUEI core/classify - rule-based scene classifier (sec. 6.4). Pure ES3.
 *
 * Input: core/stats analyzeBackground() result. Output: { cls, confidence, scores,
 * features }. Thresholds come from config/defaults.json "classifier" (passed in as
 * cfg); built-in fallbacks below mirror that file. Every class score is in 0..1;
 * confidence = top score * (top - runner-up) / top, so a clear winner scores high.
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory();
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.core = S.core || {};
  S.core.classify = factory();
}(function () {
  var CLASSES = ["DAY", "GOLDEN", "TWILIGHT", "NIGHT", "NEON", "OVERCAST", "SNOW", "INTERIOR_WARM",
    "FIRE", "UNDERWATER", "FLASHBACK_MONO", "VOID_BLACK", "VOID_WHITE"];

  function ss(e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t);
  }
  /** 1 inside [lo, hi], smooth falloff of width f outside. */
  function band(x, lo, hi, f) { return ss(lo - f, lo, x) * (1 - ss(hi, hi + f, x)); }

  function features(bg) {
    var g = bg.global;
    var ill = g.illuminant || {};
    var sh = (g.bands && g.bands.shadow) ? g.bands.shadow : null;
    return {
      medL: g.L.p50,
      p5: g.L.p5,
      p95: g.L.p95,
      contrast: g.L.p95 - g.L.p5,
      chroma: g.meanChroma,
      cct: ill.cct || 6500,
      illumHue: ill.hue || 0,
      illumChroma: ill.chroma || 0,
      emitters: bg.emitterFraction || 0,
      warmEmitters: bg.emitters ? bg.emitters.warm : 0,
      coolEmitters: bg.emitters ? bg.emitters.other : 0,
      skyCool: bg.haze ? (bg.haze.upper.coolFraction || 0) : 0,
      direction: bg.plane ? bg.plane.confidence : 0,
      skyChroma: bg.haze ? bg.haze.upper.chroma : 0,
      shadowB: sh ? sh.lab[2] : 0,        // Oklab b of the shadow band (< 0 = blue shadows)
      shadowA: sh ? sh.lab[1] : 0,
      meanA: g.meanLab[1],
      meanB: g.meanLab[2],
      blobY: bg.blob ? bg.blob.y : 0.5
    };
  }

  function score(f) {
    var s = {};
    // Warmth from the illuminant's Oklab hue/chroma, not CCT: McCamy's CCT is
    // meaningless for off-locus (magenta/green) illuminants.
    var warm = band(f.illumHue, 25, 100, 15) * ss(0.03, 0.08, f.illumChroma);
    var veryWarm = warm * ss(0.13, 0.2, f.illumChroma);
    var cool = ss(6000, 9000, f.cct) * (1 - warm);
    var dark = ss(0.5, 0.25, f.medL);
    var bright = ss(0.55, 0.8, f.medL);
    var neonish = ss(0.002, 0.01, f.coolEmitters);
    s.VOID_BLACK = ss(0.12, 0.04, f.p95);
    s.VOID_WHITE = ss(0.9, 0.97, f.p5);
    s.FLASHBACK_MONO = ss(0.02, 0.008, f.chroma) * (1 - s.VOID_BLACK) * (1 - s.VOID_WHITE);
    s.NEON = dark * neonish * (1 - veryWarm);
    s.FIRE = ss(0.55, 0.3, f.medL) * veryWarm * (0.5 + 0.5 * ss(0.001, 0.008, f.warmEmitters));
    s.NIGHT = dark * (0.55 + 0.45 * ss(0, -0.04, f.shadowB)) * (1 - 0.8 * neonish) * (1 - veryWarm) *
      (1 - 0.8 * ss(0.055, 0.075, f.chroma)) * (1 - s.VOID_BLACK);
    s.TWILIGHT = band(f.medL, 0.22, 0.5, 0.08) * ss(0.05, 0.07, f.chroma) * ss(0.16, 0.12, f.chroma) *
      ss(0, 0.02, f.meanA) * ss(-0.02, -0.05, f.meanB) * (1 - warm * 0.5);
    s.UNDERWATER = band(f.illumHue, 175, 240, 20) * ss(0.03, 0.07, f.illumChroma) * ss(0.04, 0.08, f.chroma) * (1 - dark);
    s.GOLDEN = warm * band(f.medL, 0.38, 0.75, 0.1) * ss(0.06, 0.09, f.illumChroma) * ss(0.12, 0.3, f.skyCool) * (1 - veryWarm * 0.5);
    s.INTERIOR_WARM = warm * band(f.medL, 0.3, 0.7, 0.1) * ss(0.25, 0.1, f.skyCool) * (1 - veryWarm * 0.5);
    s.OVERCAST = band(f.medL, 0.5, 0.8, 0.08) * ss(0.04, 0.02, f.chroma) * ss(0.45, 0.3, f.contrast) * (1 - ss(0.8, 0.9, f.medL));
    s.SNOW = ss(0.72, 0.85, f.medL) * ss(0.05, 0.025, f.chroma) * (0.5 + 0.5 * cool) * (1 - s.VOID_WHITE);
    s.DAY = bright * (1 - warm) * ss(0.02, 0.05, f.chroma) * (1 - s.SNOW) * (1 - s.UNDERWATER) * (1 - ss(0.25, 0.4, f.illumChroma));
    return s;
  }

  function classify(bg, cfg) {
    return classifyFeatures(features(bg), cfg);
  }

  function classifyFeatures(f, cfg) {
    var s = score(f);
    var best = "DAY", top = -1, second = -1, k, i;
    for (i = 0; i < CLASSES.length; i++) {
      k = CLASSES[i];
      if (s[k] > top) { second = top; top = s[k]; best = k; } else if (s[k] > second) { second = s[k]; }
    }
    if (top < ((cfg && cfg.minScore) || 0.15)) {
      // nothing fits well: fall back by brightness
      best = f.medL < 0.35 ? "NIGHT" : "DAY";
    }
    var conf = top > 0 ? top * (top - Math.max(0, second)) / top : 0;
    return { cls: best, confidence: conf, scores: s, features: f };
  }

  /**
   * Per-class module strengths from config.classes (column order in config.classes._columns).
   * Returns { wb, lift, harmony, sat, para, rim, wrap, diffusion, look }.
   */
  function classDefaults(cls, config) {
    var row = config.classes[cls] || config.classes.DAY;
    var cols = config.classes._columns, out = {}, i;
    for (i = 0; i < cols.length; i++) { out[cols[i]] = row[i]; }
    return out;
  }

  return { CLASSES: CLASSES, features: features, score: score, classify: classify, classifyFeatures: classifyFeatures, classDefaults: classDefaults };
}));
