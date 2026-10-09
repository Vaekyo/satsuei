/*
 * SATSUEI core/linalg - small dense linear algebra (pure ES3).
 *
 * Matrices are arrays of rows: [[a, b, c], [d, e, f], [g, h, i]].
 * Angles: project-wide convention is AE's "Direction" convention:
 *   0 deg = up (toward -y in screen space), increasing clockwise, [0, 360).
 *   Screen space: x right, y down.
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory();
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.core = S.core || {};
  S.core.linalg = factory();
}(function () {
  var RAD2DEG = 180 / Math.PI;
  var DEG2RAD = Math.PI / 180;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function I3() { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; }

  function copy3(A) { return [[A[0][0], A[0][1], A[0][2]], [A[1][0], A[1][1], A[1][2]], [A[2][0], A[2][1], A[2][2]]]; }

  function mul3(A, B) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var i, j;
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 3; j++) {
        C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
      }
    }
    return C;
  }

  function mulVec3(A, v) {
    return [
      A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
      A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
      A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]
    ];
  }

  function transpose3(A) {
    return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
  }

  function add3(A, B) {
    var C = copy3(A);
    var i, j;
    for (i = 0; i < 3; i++) { for (j = 0; j < 3; j++) { C[i][j] += B[i][j]; } }
    return C;
  }

  function scale3(A, k) {
    var C = copy3(A);
    var i, j;
    for (i = 0; i < 3; i++) { for (j = 0; j < 3; j++) { C[i][j] *= k; } }
    return C;
  }

  function det3(A) {
    return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
      A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
      A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  }

  function inv3(A) {
    var d = det3(A);
    if (Math.abs(d) < 1e-15) { return null; }
    var k = 1 / d;
    return [
      [(A[1][1] * A[2][2] - A[1][2] * A[2][1]) * k, (A[0][2] * A[2][1] - A[0][1] * A[2][2]) * k, (A[0][1] * A[1][2] - A[0][2] * A[1][1]) * k],
      [(A[1][2] * A[2][0] - A[1][0] * A[2][2]) * k, (A[0][0] * A[2][2] - A[0][2] * A[2][0]) * k, (A[0][2] * A[1][0] - A[0][0] * A[1][2]) * k],
      [(A[1][0] * A[2][1] - A[1][1] * A[2][0]) * k, (A[0][1] * A[2][0] - A[0][0] * A[2][1]) * k, (A[0][0] * A[1][1] - A[0][1] * A[1][0]) * k]
    ];
  }

  function maxAbsDiff3(A, B) {
    var m = 0;
    var i, j, d;
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 3; j++) {
        d = Math.abs(A[i][j] - B[i][j]);
        if (d > m) { m = d; }
      }
    }
    return m;
  }

  /**
   * Cyclic Jacobi eigendecomposition of a symmetric 3x3 matrix.
   * Returns { values: [lambda0, lambda1, lambda2] (descending), vectors: V } with A = V*diag(lambda)*V^T;
   * eigenvectors are the COLUMNS of V.
   */
  function eigSym3(A0) {
    var A = copy3(A0);
    var V = I3();
    var sweep, p, q, k, off, theta, t, c, s, tau, app, aqq, apq, akp, akq, vkp, vkq;
    var pairs = [[0, 1], [0, 2], [1, 2]];
    for (sweep = 0; sweep < 50; sweep++) {
      off = A[0][1] * A[0][1] + A[0][2] * A[0][2] + A[1][2] * A[1][2];
      if (off < 1e-30) { break; }
      for (k = 0; k < 3; k++) {
        p = pairs[k][0]; q = pairs[k][1];
        apq = A[p][q];
        if (Math.abs(apq) < 1e-300) { continue; }
        app = A[p][p]; aqq = A[q][q];
        theta = (aqq - app) / (2 * apq);
        t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        c = 1 / Math.sqrt(t * t + 1);
        s = t * c;
        tau = s / (1 + c);
        A[p][p] = app - t * apq;
        A[q][q] = aqq + t * apq;
        A[p][q] = 0; A[q][p] = 0;
        var r;
        for (r = 0; r < 3; r++) {
          if (r !== p && r !== q) {
            akp = A[r][p]; akq = A[r][q];
            A[r][p] = akp - s * (akq + tau * akp);
            A[p][r] = A[r][p];
            A[r][q] = akq + s * (akp - tau * akq);
            A[q][r] = A[r][q];
          }
          vkp = V[r][p]; vkq = V[r][q];
          V[r][p] = vkp - s * (vkq + tau * vkp);
          V[r][q] = vkq + s * (vkp - tau * vkq);
        }
      }
    }
    // sort descending
    var idx = [0, 1, 2];
    var vals = [A[0][0], A[1][1], A[2][2]];
    idx.sort(function (i, j) { return vals[j] - vals[i]; });
    var Vs = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var ii, rr;
    for (ii = 0; ii < 3; ii++) {
      for (rr = 0; rr < 3; rr++) { Vs[rr][ii] = V[rr][idx[ii]]; }
    }
    return { values: [vals[idx[0]], vals[idx[1]], vals[idx[2]]], vectors: Vs };
  }

  /** V*diag(f(lambda))*V^T for a symmetric matrix. */
  function symFn3(A, f) {
    var e = eigSym3(A);
    var V = e.vectors;
    var d = [f(e.values[0]), f(e.values[1]), f(e.values[2])];
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var i, j, k;
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 3; j++) {
        for (k = 0; k < 3; k++) { C[i][j] += V[i][k] * d[k] * V[j][k]; }
      }
    }
    return C;
  }

  function sqrtmSym3(A, eps) {
    var e = eps || 0;
    return symFn3(A, function (l) { return Math.sqrt(l > e ? l : e); });
  }

  function invSqrtmSym3(A, eps) {
    var e = eps || 1e-12;
    return symFn3(A, function (l) { return 1 / Math.sqrt(l > e ? l : e); });
  }

  /**
   * Solve the nxn system A*x = b by Gaussian elimination with partial pivoting.
   * Returns null if singular.
   */
  function solve(A0, b0) {
    var n = b0.length;
    var A = [], b = [], i, j, k, piv, mx, tmp, f, x;
    for (i = 0; i < n; i++) { A.push(A0[i].slice(0)); b.push(b0[i]); }
    for (k = 0; k < n; k++) {
      piv = k; mx = Math.abs(A[k][k]);
      for (i = k + 1; i < n; i++) {
        if (Math.abs(A[i][k]) > mx) { mx = Math.abs(A[i][k]); piv = i; }
      }
      if (mx < 1e-14) { return null; }
      if (piv !== k) {
        tmp = A[k]; A[k] = A[piv]; A[piv] = tmp;
        tmp = b[k]; b[k] = b[piv]; b[piv] = tmp;
      }
      for (i = k + 1; i < n; i++) {
        f = A[i][k] / A[k][k];
        if (f !== 0) {
          for (j = k; j < n; j++) { A[i][j] -= f * A[k][j]; }
          b[i] -= f * b[k];
        }
      }
    }
    x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      f = b[i];
      for (j = i + 1; j < n; j++) { f -= A[i][j] * x[j]; }
      x[i] = f / A[i][i];
    }
    return x;
  }

  /**
   * Weighted least squares with optional ridge: minimize sum w*(row*beta - y)^2 + lambda|beta - prior|^2.
   * rows: array of feature arrays (length m); returns beta (length m) or null.
   */
  function wls(rows, y, w, ridge, prior) {
    var m = rows[0].length;
    var AtA = [], Atb = [], i, j, k, wi, r;
    for (i = 0; i < m; i++) {
      AtA.push([]);
      for (j = 0; j < m; j++) { AtA[i].push(0); }
      Atb.push(0);
    }
    for (k = 0; k < rows.length; k++) {
      wi = w ? w[k] : 1;
      if (!(wi > 0)) { continue; }
      r = rows[k];
      for (i = 0; i < m; i++) {
        Atb[i] += wi * r[i] * y[k];
        for (j = i; j < m; j++) { AtA[i][j] += wi * r[i] * r[j]; }
      }
    }
    for (i = 0; i < m; i++) {
      for (j = 0; j < i; j++) { AtA[i][j] = AtA[j][i]; }
      if (ridge) {
        AtA[i][i] += ridge;
        Atb[i] += ridge * (prior ? prior[i] : 0);
      }
    }
    return solve(AtA, Atb);
  }

  /** Partial strength of an affine transform: A_k = I + k(A - I), b_k = k*b. */
  function affineBlend(A, b, k) {
    var Ak = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var i, j;
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 3; j++) { Ak[i][j] = (i === j ? 1 : 0) + k * (A[i][j] - (i === j ? 1 : 0)); }
    }
    return { A: Ak, b: [k * b[0], k * b[1], k * b[2]] };
  }

  function applyAffine(A, b, v) {
    var o = mulVec3(A, v);
    return [o[0] + b[0], o[1] + b[1], o[2] + b[2]];
  }

  /* ---------- angles (AE Direction convention: 0 deg up, clockwise) ---------- */

  /** Screen-space vector (x right, y down) -> AE angle in degrees [0, 360). */
  function vecToAeAngle(dx, dy) {
    var a = Math.atan2(dx, -dy) * RAD2DEG;
    return a < 0 ? a + 360 : a;
  }

  /** AE angle in degrees -> unit screen-space vector [dx, dy] (y down). */
  function aeAngleToVec(deg) {
    var r = deg * DEG2RAD;
    return [Math.sin(r), -Math.cos(r)];
  }

  /** Smallest absolute difference between two angles in degrees, [0, 180]. */
  function angleDist(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  return {
    clamp: clamp,
    lerp: lerp,
    I3: I3,
    copy3: copy3,
    mul3: mul3,
    mulVec3: mulVec3,
    transpose3: transpose3,
    add3: add3,
    scale3: scale3,
    det3: det3,
    inv3: inv3,
    maxAbsDiff3: maxAbsDiff3,
    eigSym3: eigSym3,
    symFn3: symFn3,
    sqrtmSym3: sqrtmSym3,
    invSqrtmSym3: invSqrtmSym3,
    solve: solve,
    wls: wls,
    affineBlend: affineBlend,
    applyAffine: applyAffine,
    vecToAeAngle: vecToAeAngle,
    aeAngleToVec: aeAngleToVec,
    angleDist: angleDist
  };
}));
