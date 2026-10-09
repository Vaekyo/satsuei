"use strict";
// Synthetic "painted" anime backgrounds, 1920x1080, opaque. Original procedural
// scenes: layered gradients + low-frequency noise + simple shapes + glows, then a
// light paint texture and fine grain so grain/softness metrics have something to
// measure. Each scene documents its intended light (for analyzer sanity checks).

const R = require("./raster.js");
const { clamp, mix, mix3, smoothstep, hex, fbm, valueNoise, rng, circle, ellipse, poly, rect, offset, union, inter, halfplane, outline, stroke, Canvas } = R;

const W = 1920, H = 1080;

function vgrad(stops) {
  // stops: [[y, [r,g,b]], ...] sorted by y
  return (y) => {
    if (y <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (y <= stops[i][0]) {
        const t = smoothstep(stops[i - 1][0], stops[i][0], y);
        return mix3(stops[i - 1][1], stops[i][1], t);
      }
    }
    return stops[stops.length - 1][1];
  };
}

/** Paint texture (low-frequency value variation) + fine per-pixel grain. */
function texture(c, { seed = 1, amount = 0.05, grain = 1.5 / 255, scale = 70 } = {}) {
  const g = rng(seed * 7919);
  return c.post((rgb, x, y) => {
    const m = 1 + amount * (fbm(x / scale, y / scale, 3, seed) - 0.5) * 2;
    const n = (g() - 0.5) * 2 * grain;
    return [rgb[0] * m + n, rgb[1] * m + n, rgb[2] * m + n];
  });
}

function ridge(x, base, amp, scale, seed) {
  return base - amp * fbm(x / scale, 0.5, 4, seed);
}

function silhouetteRidge(base, amp, scale, seed, x0 = 0, x1 = W) {
  const pts = [];
  for (let x = x0; x <= x1; x += 8) pts.push([x, ridge(x, base, amp, scale, seed)]);
  pts.push([x1, H + 10], [x0, H + 10]);
  return poly(pts);
}

/* ------------------------------------------------------------------ */

function daySky() {
  const sky = vgrad([[0, hex("#2f6fd6")], [420, hex("#79b3ec")], [700, hex("#c4e2f6")]]);
  const sun = [260, 110];
  const c = new Canvas(W, H).paint((x, y) => sky(y));
  c.glow(sun[0], sun[1], 420, [1, 0.97, 0.86], 0.35);
  // cumulus clouds, lit from the upper left
  const dens = (x, y) => smoothstep(0.52, 0.66, fbm(x / 330, y / 150, 5, 3)) * smoothstep(80, 220, y) * (1 - smoothstep(520, 640, y));
  c.post((rgb, x, y) => {
    const d = dens(x, y);
    if (d <= 0) return rgb;
    const toward = dens(x - 26, y - 22);
    const lit = clamp(0.55 + (d - toward) * 2.2 + 0.25);
    const col = mix3(hex("#a9b7d4"), [1, 0.99, 0.96], lit);
    return mix3(rgb, col, d);
  });
  c.fill(silhouetteRidge(700, 120, 260, 5), (x, y) => mix3(hex("#8fb2c4"), hex("#a9c6d3"), smoothstep(600, 760, y)));
  c.fill(silhouetteRidge(790, 90, 340, 9), (x, y) => {
    const g = mix3(hex("#79b04a"), hex("#3f7a2e"), smoothstep(760, 1080, y));
    return mix3(g, hex("#9ccf63"), 0.35 * (1 - smoothstep(0, 900, x)) * (1 - smoothstep(700, 900, y)));
  });
  c.fill(silhouetteRidge(900, 50, 220, 13), (x, y) => mix3(hex("#4f8f37"), hex("#2f5f25"), smoothstep(860, 1080, y)));
  // a tree on the right, lit from the left
  c.fill(rect(1608, 640, 1636, 930), hex("#5a3b26"));
  const crown = union(circle(1622, 560, 120), circle(1540, 620, 90), circle(1710, 610, 95), circle(1620, 680, 100));
  c.fill(crown, (x, y) => mix3(hex("#5e9c3d"), hex("#2d5a26"), smoothstep(1500, 1760, x + (y - 560) * 0.5)));
  return texture(c, { seed: 1 });
}
daySky.light = { angle: 315, key: "neutral-warm", note: "sun upper left" };

function goldenHour() {
  const sky = vgrad([[0, hex("#3c2d63")], [300, hex("#9d4f6d")], [560, hex("#ef8a5a")], [740, hex("#ffc46e")]]);
  const sun = [1450, 700];
  const c = new Canvas(W, H).paint((x, y) => sky(y));
  c.glow(sun[0], sun[1], 600, [1, 0.6, 0.25], 0.55, "inv");
  c.post((rgb, x, y) => {
    const d = smoothstep(0.55, 0.7, fbm(x / 620, y / 55, 5, 21)) * smoothstep(150, 260, y) * (1 - smoothstep(480, 600, y));
    if (d <= 0) return rgb;
    const under = smoothstep(0.4, 1, (y - 200) / 400) * (0.6 + 0.4 * (1 - Math.abs(x - sun[0]) / W));
    return mix3(rgb, mix3(hex("#6a4a7a"), hex("#ffa585"), under), d * 0.9);
  });
  c.fill(circle(sun[0], sun[1], 62), [1, 0.96, 0.8]);
  c.glow(sun[0], sun[1], 120, [1, 0.85, 0.5], 0.8);
  // town / hills silhouette with warm rim toward the sun
  const hills = silhouetteRidge(760, 60, 300, 4);
  c.fill(hills, (x, y) => mix3(hex("#5a2f45"), hex("#2a1626"), smoothstep(740, 1080, y)));
  const g = rng(44);
  for (let i = 0; i < 26; i++) {
    const x0 = g() * W, w = 50 + g() * 110, h = 60 + g() * 220;
    const b = rect(x0, 1080 - 230 - h * 0.6, x0 + w, 1090);
    c.fill(b, (x, y) => mix3(hex("#3b1f33"), hex("#1f0f1c"), smoothstep(700, 1080, y)));
    c.fill(inter(b, halfplane(x0 + w - 6, 0, -1, 0)), hex("#c96a4a"), { opacity: 0.8 * (x0 > 900 ? 1 : 0.3) });
  }
  return texture(c, { seed: 2 });
}
goldenHour.light = { angle: 90, key: "warm", note: "low sun right" };

function twilight() {
  const sky = vgrad([[0, hex("#14193f")], [330, hex("#3b3a78")], [560, hex("#8c5f97")], [680, hex("#d98fa0")]]);
  const c = new Canvas(W, H).paint((x, y) => sky(y));
  const g = rng(7);
  for (let i = 0; i < 160; i++) {
    const x = g() * W, y = g() * 380;
    c.fill(circle(x, y, 0.6 + g() * 1.2), [0.95, 0.95, 1], { opacity: 0.4 + g() * 0.5 });
  }
  c.fill(circle(380, 190, 34), hex("#f3efe0"));
  c.fill(circle(395, 180, 32), sky(190));
  const sky2 = silhouetteRidge(700, 40, 500, 8);
  c.fill(sky2, hex("#2a2850"));
  for (let i = 0; i < 40; i++) {
    const x0 = g() * W, w = 40 + g() * 90, h = 80 + g() * 300;
    const top = 1080 - 260 - h * 0.7;
    c.fill(rect(x0, top, x0 + w, 1090), hex("#1d1c3a"));
    for (let wy = top + 14; wy < 1060; wy += 22) for (let wx = x0 + 8; wx < x0 + w - 10; wx += 18) {
      if (g() < 0.16) {
        c.fill(rect(wx, wy, wx + 8, wy + 10), [1, 0.82, 0.52]);
        c.glow(wx + 4, wy + 5, 10, [1, 0.7, 0.35], 0.25);
      }
    }
  }
  return texture(c, { seed: 3, amount: 0.04 });
}
twilight.light = { angle: 0, key: "cool-magenta", note: "diffuse sky, low contrast" };

function nightStreet() {
  const sky = vgrad([[0, hex("#05081c")], [420, hex("#141a3a")]]);
  const vp = [960, 560];
  const c = new Canvas(W, H).paint((x, y) => sky(y));
  // buildings in perspective
  const left = poly([[0, 0], [700, 260], [700, 640], [0, 1080]]);
  const right = poly([[1920, 60], [1230, 300], [1230, 640], [1920, 1080]]);
  c.fill(left, (x, y) => mix3(hex("#151a2e"), hex("#0c0f1d"), smoothstep(0, 700, 700 - x)));
  c.fill(right, (x, y) => mix3(hex("#141a2c"), hex("#0b0e1a"), smoothstep(1230, 1920, x)));
  const g = rng(99);
  for (let i = 0; i < 70; i++) {
    const side = g() < 0.5 ? -1 : 1;
    const t = g(); // 0 near, 1 far
    const x = side < 0 ? mix(40, 660, t) : mix(1880, 1270, t);
    const y = mix(120, 330, t) + g() * mix(500, 250, t);
    const s = mix(36, 10, t);
    if (g() < 0.45) {
      c.fill(rect(x, y, x + s, y + s * 1.3), g() < 0.7 ? [1, 0.8, 0.5] : [0.6, 0.8, 1], { opacity: 0.85 });
      c.glow(x + s / 2, y + s * 0.65, s, [1, 0.7, 0.4], 0.15);
    } else {
      c.fill(rect(x, y, x + s, y + s * 1.3), hex("#0a0c16"));
    }
  }
  // street
  c.fill(poly([[0, 1080], [700, 640], [1230, 640], [1920, 1080]]), (x, y) => mix3(hex("#121420"), hex("#07080e"), smoothstep(640, 1080, y)));
  c.fill(stroke([[960, 660], [960, 1080]], [2, 26]), hex("#3a3a40"), { opacity: 0.5 });
  // street lamps (left near, receding)
  const lamps = [[470, 300, 1.0], [800, 420, 0.55], [1460, 400, 0.6], [1110, 470, 0.4]];
  for (const [lx, ly, s] of lamps) {
    c.fill(rect(lx - 6 * s, ly, lx + 6 * s, ly + 700 * s), hex("#1b1d24"));
    c.fill(offset(rect(lx - 26 * s, ly - 12 * s, lx + 26 * s, ly + 6 * s), 4 * s), hex("#2a2a30"));
    c.fill(ellipse(lx, ly + 8 * s, 20 * s, 8 * s), [1, 0.92, 0.7]);
    c.glow(lx, ly + 10 * s, 120 * s, [1, 0.72, 0.38], 0.9);
    c.glow(lx, ly + 10 * s, 30 * s, [1, 0.9, 0.7], 0.8);
    // pool of light and wet reflection on the street
    const gy = ly + 700 * s;
    c.glow(lx, gy, 220 * s, [1, 0.62, 0.3], 0.35);
    for (let k = 0; k < 6; k++) c.fill(stroke([[lx + (k - 3) * 3, gy - 10], [lx + (k - 3) * 5, Math.min(1080, gy + 260 * s)]], [3 * s, 1]), [1, 0.7, 0.4], { opacity: 0.18, mode: "add" });
  }
  c.glow(vp[0], vp[1] - 200, 500, [0.3, 0.4, 0.8], 0.08); // cool sky glow
  return texture(c, { seed: 4, amount: 0.06 });
}
nightStreet.light = { angle: 300, key: "warm lamps on cool ambient", note: "nearest lamp upper left" };

function neonAlley() {
  const c = new Canvas(W, H).paint((x, y) => mix3(hex("#0d0b1c"), hex("#050409"), smoothstep(0, 1080, y)));
  c.fill(poly([[760, 0], [1160, 0], [1060, 520], [860, 520]]), hex("#1a1636")); // sky slit
  c.fill(poly([[0, 0], [760, 0], [860, 520], [860, 700], [0, 1080]]), hex("#0b0a14"));
  c.fill(poly([[1920, 0], [1160, 0], [1060, 520], [1060, 700], [1920, 1080]]), hex("#0a0912"));
  c.fill(poly([[0, 1080], [860, 700], [1060, 700], [1920, 1080]]), hex("#07060b"));
  const signs = [
    { s: offset(rect(150, 180, 420, 300), 18), col: [1, 0.12, 0.72] },
    { s: offset(rect(1520, 140, 1610, 560), 14), col: [0.1, 0.92, 1] },
    { s: offset(rect(560, 380, 700, 430), 10), col: [1, 0.75, 0.15] },
    { s: offset(rect(1250, 330, 1420, 400), 12), col: [0.75, 0.2, 1] },
    { s: offset(rect(240, 460, 300, 760), 10), col: [0.15, 1, 0.6] }
  ];
  for (const { s, col } of signs) {
    c.fill(s, col.map((v) => v * 0.25));
    c.fill(outline(s, 9), col);
    c.fill(outline(s, 3), [1, 1, 1], { opacity: 0.7 });
    const cx = (s.bb.x0 + s.bb.x1) / 2, cy = (s.bb.y0 + s.bb.y1) / 2;
    c.glow(cx, cy, Math.max(s.bb.x1 - s.bb.x0, s.bb.y1 - s.bb.y0) * 0.6, col, 0.38, "inv");
    // reflection on the wet ground
    const gy = 700 + (1080 - 700) * clamp((Math.abs(cx - 960) / 960)) * 0.8 + 60;
    for (let k = 0; k < 10; k++) {
      const x = cx + (k - 5) * 6;
      c.fill(stroke([[x, gy], [x + (cx - 960) * 0.08, Math.min(1080, gy + 260)]], [6, 1]), col, { opacity: 0.12, mode: "add" });
    }
  }
  // kanji-ish sign glyph bars on the vertical sign
  for (let k = 0; k < 5; k++) c.fill(rect(1545, 170 + k * 78, 1585, 186 + k * 78), [0.8, 1, 1]);
  // pipes / AC units
  c.fill(rect(700, 600, 780, 650), hex("#15131e"));
  c.fill(stroke([[860, 60], [860, 700]], 10), hex("#14121c"));
  return texture(c, { seed: 5, amount: 0.05, grain: 2 / 255 });
}
neonAlley.light = { angle: 270, key: "magenta/cyan emitters", note: "dark, saturated emitters" };

function overcastRain() {
  const c = new Canvas(W, H).paint((x, y) => mix3(hex("#9da5ae"), hex("#8a9198"), smoothstep(0, 600, y)));
  const g = rng(31);
  const layers = [[640, "#aeb4ba", 0.5], [720, "#8e959c", 0.8], [820, "#6f767d", 1]];
  for (const [base, col, sc] of layers) {
    for (let i = 0; i < 18; i++) {
      const x0 = g() * W, w = 80 + g() * 160 * sc, h = 100 + g() * 260 * sc;
      c.fill(rect(x0, base - h, x0 + w, H + 10), hex(col));
    }
  }
  c.fill(rect(0, 860, W, H), (x, y) => mix3(hex("#5e646b"), hex("#4b5056"), smoothstep(860, 1080, y)));
  c.post((rgb, x, y) => mix3(rgb, hex("#b8bec4"), 0.35 * smoothstep(600, 1000, y) * fbm(x / 400, y / 120, 3, 8)));
  for (let i = 0; i < 1400; i++) {
    const x = g() * W, y = g() * H, l = 30 + g() * 40;
    c.fill(stroke([[x, y], [x - l * 0.25, y + l]], 1.1), [0.86, 0.88, 0.9], { opacity: 0.35 });
  }
  return texture(c, { seed: 6, amount: 0.03, grain: 2.5 / 255 });
}
overcastRain.light = { angle: 0, key: "neutral-cool, diffuse", note: "low contrast, low chroma" };

function snow() {
  const sky = vgrad([[0, hex("#c9d6e8")], [600, hex("#e6ecf4")]]);
  const c = new Canvas(W, H).paint((x, y) => sky(y));
  c.fill(silhouetteRidge(640, 90, 300, 12), hex("#a9b8cc"));
  c.fill(silhouetteRidge(700, 40, 200, 14), hex("#c7d2e2"));
  c.fill(silhouetteRidge(780, 30, 500, 16), (x, y) => {
    const n = fbm(x / 180, y / 60, 4, 17);
    return mix3(hex("#f2f6fc"), hex("#b9c8e6"), smoothstep(0.45, 0.7, n) * 0.8);
  });
  const g = rng(12);
  for (let i = 0; i < 14; i++) {
    const x = g() * W, base = 760 + g() * 220, h = 180 + g() * 260, s = h / 400;
    c.fill(rect(x - 8 * s, base - 30 * s, x + 8 * s, base + 10), hex("#3b3a3f"));
    for (let k = 0; k < 4; k++) {
      const y0 = base - 40 * s - k * h * 0.22, wdt = (150 - k * 28) * s;
      const tier = poly([[x - wdt, y0], [x + wdt, y0], [x, y0 - h * 0.34]]);
      c.fill(tier, hex("#26393f"));
      c.fill(inter(tier, halfplane(0, y0 - h * 0.14, 0, 1)), hex("#f4f7fc"));
      c.fill(inter(tier, halfplane(x, 0, -1, 0), halfplane(0, y0 - h * 0.14, 0, 1)), hex("#c7d3ea"));
    }
  }
  for (let i = 0; i < 700; i++) c.fill(circle(g() * W, g() * H, 1 + g() * 2.5), [1, 1, 1], { opacity: 0.85, feather: 1.5 });
  return texture(c, { seed: 7, amount: 0.03 });
}
snow.light = { angle: 330, key: "cool white", note: "high key" };

function warmInterior() {
  const c = new Canvas(W, H).paint((x, y) => {
    const v = 1 - 0.55 * smoothstep(300, 1100, Math.hypot(x - 1400, y - 420));
    return mix3(hex("#4a2e1d"), hex("#d6a46c"), v);
  });
  // floor
  c.fill(rect(0, 820, W, H), (x, y) => {
    const plank = Math.floor((x + (y - 820) * 1.2) / 180) % 2 ? 0.92 : 1;
    const v = 1 - 0.5 * smoothstep(200, 1300, Math.hypot(x - 1400, y - 900));
    return mix3(hex("#2c180d"), hex("#8a5530"), v).map((u) => u * plank);
  });
  // window on the left with blue evening outside
  const win = rect(160, 220, 560, 640);
  c.fill(offset(win, 22), hex("#3a2416"));
  c.fill(win, (x, y) => mix3(hex("#2c3b6e"), hex("#5a6aa0"), smoothstep(220, 640, y)));
  c.fill(rect(352, 220, 368, 640), hex("#3a2416"));
  c.fill(rect(160, 422, 560, 438), hex("#3a2416"));
  // bookshelf
  c.fill(rect(700, 300, 1000, 820), hex("#3e2414"));
  const g = rng(5);
  for (let sy = 330; sy < 800; sy += 120) {
    for (let bx = 715; bx < 985;) {
      const bw = 12 + g() * 20, bh = 70 + g() * 35;
      c.fill(rect(bx, sy + 100 - bh, bx + bw, sy + 100), [0.3 + g() * 0.5, 0.15 + g() * 0.3, 0.1 + g() * 0.2]);
      bx += bw + 2;
    }
    c.fill(rect(700, sy + 100, 1000, sy + 112), hex("#2c1a0e"));
  }
  // floor lamp on the right (key light)
  c.fill(rect(1494, 420, 1506, 830), hex("#2a1a10"));
  const shade = poly([[1420, 420], [1580, 420], [1545, 300], [1455, 300]]);
  c.fill(shade, hex("#ffd9a0"));
  c.glow(1500, 380, 260, [1, 0.62, 0.28], 0.75, "inv");
  c.glow(1500, 400, 70, [1, 0.85, 0.6], 0.6);
  c.fill(rect(1150, 560, 1300, 640), hex("#5a3a24")); // picture frame
  c.fill(rect(1165, 572, 1285, 628), hex("#7d8c6a"));
  return texture(c, { seed: 8, amount: 0.05 });
}
warmInterior.light = { angle: 75, key: "tungsten ~2800K", note: "floor lamp right" };

function underwater() {
  const c = new Canvas(W, H).paint((x, y) => mix3(hex("#3fc2c9"), hex("#05284d"), smoothstep(0, 1080, y)));
  c.post((rgb, x, y) => {
    const a = Math.atan2(x - 960, y + 300);
    const ray = Math.pow(clamp(valueNoise(a * 9, 0.5, 4) * 1.4 - 0.4), 2);
    const fall = 1 - smoothstep(0, 900, y);
    const caust = Math.pow(1 - Math.abs(fbm(x / 90, y / 60, 3, 11) - 0.5) * 2, 8) * (1 - smoothstep(0, 500, y));
    return [rgb[0] + 0.25 * ray * fall + 0.15 * caust, rgb[1] + 0.45 * ray * fall + 0.3 * caust, rgb[2] + 0.4 * ray * fall + 0.28 * caust];
  });
  c.fill(silhouetteRidge(930, 60, 300, 23), (x, y) => mix3(hex("#0d4a5a"), hex("#062432"), smoothstep(880, 1080, y)));
  const g = rng(17);
  for (let i = 0; i < 9; i++) {
    const x = g() * W, base = 960 + g() * 80, hgt = 200 + g() * 280;
    const pts = [];
    for (let k = 0; k <= 12; k++) pts.push([x + Math.sin(k * 0.7 + i) * 18, base - (k * hgt) / 12]);
    c.fill(stroke(pts, [16, 4]), hex("#0f5c4c"));
  }
  for (let i = 0; i < 60; i++) {
    const x = 1300 + g() * 300, y = g() * 900, r = 3 + g() * 9;
    c.fill(outline(circle(x, y, r), 1.6), [0.85, 1, 1], { opacity: 0.6 });
  }
  return texture(c, { seed: 9, amount: 0.04 });
}
underwater.light = { angle: 0, key: "teal, red absorbed", note: "light from the surface" };

/* fire-lit sequence: static albedo + per-frame flickering fire light */
function fireScene() {
  const alb = new Canvas(W, H).paint((x, y) => mix3(hex("#1a1a2e"), hex("#2a2a3a"), smoothstep(0, 700, y)));
  const g = rng(77);
  for (let i = 0; i < 16; i++) {
    const x = g() * W, w = 30 + g() * 50;
    alb.fill(rect(x - w / 2, 0, x + w / 2, 900 + g() * 100), hex("#3a2c24"));
    alb.fill(union(circle(x, 80 + g() * 200, 140 + g() * 80), circle(x + 80, 160, 120)), hex("#1f2a24"));
  }
  alb.fill(rect(0, 860, W, H), (x, y) => mix3(hex("#4a3a2c"), hex("#3a2a20"), fbm(x / 120, y / 40, 3, 2)));
  alb.fill(offset(rect(1150, 905, 1360, 935), 10), hex("#2a1a10"));
  alb.fill(offset(poly([[1170, 950], [1340, 890], [1350, 915], [1180, 975]]), 8), hex("#30200f"));
  return alb;
}
function flicker(t, seed) {
  // smooth multi-octave noise over time, 0..1
  return 0.55 * valueNoise(t * 0.35, 0.3, seed) + 0.3 * valueNoise(t * 0.9, 0.7, seed + 1) + 0.15 * valueNoise(t * 2.1, 0.1, seed + 2);
}
function fireFrame(alb, f) {
  const fx = 1255, fy = 900;
  const k = flicker(f, 3);
  const inten = 0.75 + 0.6 * k;
  const rad = 680 + 260 * k;
  const amb = [0.16, 0.17, 0.26];
  const c = alb.clone().post((rgb, x, y) => {
    const d = Math.hypot(x - fx, (y - fy) * 1.25) / rad;
    const L = inten / (1 + d * d * 3);
    const light = [amb[0] + 1.9 * L, amb[1] + 0.95 * L, amb[2] + 0.32 * L];
    return [rgb[0] * light[0], rgb[1] * light[1], rgb[2] * light[2]];
  });
  // flames (shape varies per frame)
  for (let k2 = 0; k2 < 5; k2++) {
    const ph = flicker(f * 1.7 + k2 * 13, 9 + k2);
    const h = 120 + 140 * ph, w = 46 - k2 * 6;
    const x = fx + (k2 - 2) * 26 + (ph - 0.5) * 20;
    const flame = union(ellipse(x, fy - 10, w, w * 0.8), poly([[x - w, fy - 10], [x + w, fy - 10], [x + (ph - 0.5) * 30, fy - 10 - h]]));
    c.fill(flame, k2 % 2 ? [1, 0.45, 0.08] : [1, 0.7, 0.15], { feather: 3 });
    c.fill(offset(flame, -14), [1, 0.92, 0.55], { feather: 4 });
  }
  c.glow(fx, fy - 80, 140, [1, 0.55, 0.15], 0.7 * inten);
  const gE = rng(1000 + f);
  for (let i = 0; i < 18; i++) {
    const ex = fx + (gE() - 0.5) * 240, ey = fy - 150 - gE() * 400;
    c.fill(circle(ex, ey, 1.5 + gE() * 2), [1, 0.6, 0.2], { feather: 2 });
  }
  return texture(c, { seed: 10, amount: 0.04 });
}
fireFrame.light = { angle: 110, key: "fire ~1900K, flickering", note: "campfire lower right" };

function black() { return new Canvas(W, H).paint(() => [0, 0, 0]); }
function white() { return new Canvas(W, H).paint(() => [1, 1, 1]); }

function magentaAbstract() {
  const c = new Canvas(W, H).paint((x, y) => mix3(hex("#c2187e"), hex("#6a0f86"), smoothstep(0, W, x * 0.7 + y * 0.6)));
  const g = rng(3);
  for (let i = 0; i < 22; i++) {
    const s = circle(g() * W, g() * H, 40 + g() * 260);
    c.fill(s, [g() < 0.5 ? 1 : 0.95, g() * 0.3, 0.55 + g() * 0.4], { opacity: 0.55, feather: 2 + g() * 30 });
  }
  return texture(c, { seed: 11, amount: 0.03 });
}

function noisy() {
  const g = rng(8);
  return new Canvas(W, H).paint((x, y) => {
    const base = [fbm(x / 60, y / 60, 3, 1), fbm(x / 60, y / 60, 3, 2), fbm(x / 60, y / 60, 3, 3)];
    return [mix(base[0], g(), 0.5), mix(base[1], g(), 0.5), mix(base[2], g(), 0.5)];
  });
}

const SCENES = {
  day_sky: daySky,
  golden_hour: goldenHour,
  twilight,
  night_street: nightStreet,
  neon_alley: neonAlley,
  overcast_rain: overcastRain,
  snow,
  warm_interior: warmInterior,
  underwater,
  black,
  white,
  magenta_abstract: magentaAbstract,
  noisy
};

module.exports = { W, H, SCENES, fireScene, fireFrame, flicker, texture };
