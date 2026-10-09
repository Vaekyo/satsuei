/*
 * SATSUEI core/halton - low-discrepancy sampling + a seeded PRNG (pure ES3).
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory();
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.core = S.core || {};
  S.core.halton = factory();
}(function () {
  /** Radical inverse of index i (>= 0) in the given base, in [0, 1). */
  function radicalInverse(i, base) {
    var f = 1, r = 0;
    while (i > 0) {
      f /= base;
      r += f * (i % base);
      i = Math.floor(i / base);
    }
    return r;
  }

  /**
   * n 2-D Halton points (bases 2, 3) in [0,1)^2, skipping the first `skip` indices
   * (default 20, avoids the correlated start). Returns { x: [], y: [] }.
   */
  function points(n, skip) {
    var s = skip === undefined ? 20 : skip;
    var xs = new Array(n), ys = new Array(n), i;
    for (i = 0; i < n; i++) {
      xs[i] = radicalInverse(i + s + 1, 2);
      ys[i] = radicalInverse(i + s + 1, 3);
    }
    return { x: xs, y: ys };
  }

  /**
   * Deterministic PRNG: 31-bit Park-Miller LCG (a = 48271) using Schrage's method,
   * so every intermediate stays an exact double - identical sequences in Node and
   * ExtendScript (which has no Math.imul). rng() returns a float in [0, 1).
   */
  function rng(seed) {
    var s = Math.floor(Math.abs(seed || 1)) % 2147483647;
    if (s === 0) { s = 1; }
    return function () {
      // Schrage: a = 48271, m = 2^31 - 1, q = m / a, r = m % a
      var hi = Math.floor(s / 44488);
      var lo = s % 44488;
      s = 48271 * lo - 3399 * hi;
      if (s <= 0) { s += 2147483647; }
      return (s - 1) / 2147483646;
    };
  }

  return { radicalInverse: radicalInverse, points: points, rng: rng };
}));
