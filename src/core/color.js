/*
 * SATSUEI core/color - color-space math (pure ES3, no AE DOM).
 *
 * Conventions
 * - "working" values are display-referred sRGB-encoded, 0..1 (what an 8/16 bpc
 *   non-linear AE project hands to effects).
 * - "linear" values are linear-light Rec.709/sRGB primaries, D65.
 * - Oklab per Ottosson (2020). Hue angles in degrees, [0, 360).
 * See docs/ALGORITHMS.md sec.Color.
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory();
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.core = S.core || {};
  S.core.color = factory();
}(function () {
  var RAD2DEG = 180 / Math.PI;
  var DEG2RAD = Math.PI / 180;

  /* ---------- sRGB transfer (sign-symmetric so negative values survive) ---------- */

  function srgbToLinear(v) {
    var a = v < 0 ? -v : v;
    var o = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
    return v < 0 ? -o : o;
  }

  function linearToSrgb(v) {
    var a = v < 0 ? -v : v;
    var o = a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
    return v < 0 ? -o : o;
  }

  function toLinear3(c) { return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]; }
  function toSrgb3(c) { return [linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])]; }

  /** Rec.709 luminance of a linear triplet. */
  function luminance(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

  /* ---------- XYZ ---------- */

  var M_RGB2XYZ = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041]
  ];
  var M_XYZ2RGB = [
    [3.2404542, -1.5371385, -0.4985314],
    [-0.9692660, 1.8760108, 0.0415560],
    [0.0556434, -0.2040259, 1.0572252]
  ];

  function m3v(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
    ];
  }

  function linearToXyz(c) { return m3v(M_RGB2XYZ, c); }
  function xyzToLinear(c) { return m3v(M_XYZ2RGB, c); }

  /* ---------- Oklab ---------- */

  function cbrt(x) { return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3); }

  function linearToOklab(c) {
    var l = 0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2];
    var m = 0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2];
    var s = 0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2];
    l = cbrt(l); m = cbrt(m); s = cbrt(s);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }

  function oklabToLinear(lab) {
    var l = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
    var m = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
    var s = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }

  /** Ottosson's XYZ->Oklab path (used to test the direct sRGB path). */
  function xyzToOklab(c) {
    var l = 0.8189330101 * c[0] + 0.3618667424 * c[1] - 0.1288597137 * c[2];
    var m = 0.0329845436 * c[0] + 0.9293118715 * c[1] + 0.0361456387 * c[2];
    var s = 0.0482003018 * c[0] + 0.2643662691 * c[1] + 0.6338517070 * c[2];
    l = cbrt(l); m = cbrt(m); s = cbrt(s);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }

  function srgbToOklab(c) { return linearToOklab(toLinear3(c)); }
  function oklabToSrgb(lab) { return toSrgb3(oklabToLinear(lab)); }

  function hueDeg(a, b) {
    var h = Math.atan2(b, a) * RAD2DEG;
    return h < 0 ? h + 360 : h;
  }

  /** [L, C, h deg] */
  function oklabToLch(lab) {
    return [lab[0], Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]), hueDeg(lab[1], lab[2])];
  }

  function lchToOklab(lch) {
    var h = lch[2] * DEG2RAD;
    return [lch[0], lch[1] * Math.cos(h), lch[1] * Math.sin(h)];
  }

  /** Smallest signed difference b - a between two hue angles, in (-180, 180]. */
  function hueDiff(a, b) {
    var d = (b - a) % 360;
    if (d > 180) { d -= 360; }
    if (d <= -180) { d += 360; }
    return d;
  }

  /** Euclidean distance in Oklab (~ deltaE_ok; 0.02 ~ just noticeable). */
  function deltaEOk(p, q) {
    var d0 = p[0] - q[0], d1 = p[1] - q[1], d2 = p[2] - q[2];
    return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
  }

  /* ---------- illuminant helpers ---------- */

  /** Normalize a linear triplet to unit Rec.709 luminance (keeps chromaticity). */
  function normalizeLuminance(c) {
    var y = luminance(c);
    if (!(y > 1e-12)) { return [1, 1, 1]; }
    return [c[0] / y, c[1] / y, c[2] / y];
  }

  /** CIE 1931 xy chromaticity of a linear triplet. */
  function linearToXy(c) {
    var xyz = linearToXyz(c);
    var s = xyz[0] + xyz[1] + xyz[2];
    if (!(s > 1e-12)) { return [0.3127, 0.3290]; }
    return [xyz[0] / s, xyz[1] / s];
  }

  /** Approximate CCT in kelvin from xy (McCamy 1992). Clamped to [1000, 25000]. */
  function xyToCct(xy) {
    var n = (xy[0] - 0.3320) / (0.1858 - xy[1]);
    var t = 449 * n * n * n + 3525 * n * n + 6823.3 * n + 5520.33;
    if (!(t > 1000)) { t = 1000; }
    if (t > 25000) { t = 25000; }
    return t;
  }

  function linearToCct(c) { return xyToCct(linearToXy(c)); }

  /** Planckian-locus xy for a CCT (Kim et al. 2002 cubic spline), 1667..25000 K. */
  function cctToXy(t) {
    var x, y, t2, t3;
    if (t < 1667) { t = 1667; }
    if (t > 25000) { t = 25000; }
    t2 = t * t; t3 = t2 * t;
    if (t <= 4000) {
      x = -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.179910;
    } else {
      x = -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.240390;
    }
    if (t <= 2222) {
      y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683;
    } else if (t <= 4000) {
      y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
    } else {
      y = 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
    }
    return [x, y];
  }

  /** Linear-sRGB color of a blackbody at t kelvin, unit luminance, negatives clipped. */
  function cctToLinear(t) {
    var xy = cctToXy(t);
    var xyz = [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];
    var c = xyzToLinear(xyz);
    c = [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])];
    return normalizeLuminance(c);
  }

  /* ---------- buffers ---------- */

  /**
   * Convert planar working-space channels (arrays of 0..1 sRGB-encoded floats) to
   * linear. Returns new plain Arrays (ExtendScript has no typed arrays).
   */
  function planesToLinear(r, g, b) {
    var n = r.length;
    var lr = new Array(n), lg = new Array(n), lb = new Array(n);
    var i;
    for (i = 0; i < n; i++) {
      lr[i] = srgbToLinear(r[i]);
      lg[i] = srgbToLinear(g[i]);
      lb[i] = srgbToLinear(b[i]);
    }
    return { r: lr, g: lg, b: lb };
  }

  return {
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb,
    toLinear3: toLinear3,
    toSrgb3: toSrgb3,
    luminance: luminance,
    linearToXyz: linearToXyz,
    xyzToLinear: xyzToLinear,
    linearToOklab: linearToOklab,
    oklabToLinear: oklabToLinear,
    xyzToOklab: xyzToOklab,
    srgbToOklab: srgbToOklab,
    oklabToSrgb: oklabToSrgb,
    oklabToLch: oklabToLch,
    lchToOklab: lchToOklab,
    hueDeg: hueDeg,
    hueDiff: hueDiff,
    deltaEOk: deltaEOk,
    normalizeLuminance: normalizeLuminance,
    linearToXy: linearToXy,
    xyToCct: xyToCct,
    linearToCct: linearToCct,
    cctToXy: cctToXy,
    cctToLinear: cctToLinear,
    planesToLinear: planesToLinear
  };
}));
