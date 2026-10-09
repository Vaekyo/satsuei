# Phase 1 — Analyzer · progress report (2026-10-09)

**Status: everything that can be built and checked without After Effects is done.** The AE
acceptance criteria (AE-side stats vs the Node reference, backend benchmark, default backend
choice) are **open**: they need one run on a machine with AE. Both scripts are ready.

## Built

- **Statistics** (`src/core/stats.js`):
  - moments in working and linear RGB
  - 1024-bin perceptual histogram with percentiles
  - black color; key color that skips clipped pixels and emitters
  - band tints
  - shades-of-gray illuminant blended with the key
  - Oklab k-means palette, deterministic across Node and ExtendScript
  - light direction: plane fit plus bright blob, confidence-weighted
  - exact EDT, and the distance-weighted ring around each character
  - haze, grain, sharpness
  - line art, skin, edge band
  - split emitters, relative chroma
  - All of it is in `docs/ALGORITHMS.md`.
- **Classifier** (`src/core/classify.js`): 13 classes, rule-based, smooth scores,
  confidence, per-class defaults from `config/defaults.json`.
- **Effect models + Lighting Transfer solver** (`src/core/fxmodel.js`,
  `src/core/transfer.js`):
  - steps 1–8 of sec. 6.5, with MKL and Reinhard-Oklab
  - solve-time skin keeper, per-channel clip guard, line-art guard, readability flag
  - This is Phase 2 math, pulled forward so it could be tuned in simulation.
- **Node reference analyzer** (`tools/analyze_ref.js`): builds the same isolation passes
  as backend A1 from the source PNGs. About 200 ms per scene at 384 px in Node.
- **AE side** (`src/ae/analyze.js`, `roles.js`, `util.js`):
  - `SATSUEI.analyze(comp, roles, opts)` with three backends behind one interface:
    **A1** `saveFrameToPng` + our PNG decoder, **A2** Render Queue, **B** a `sampleImage`
    expression probe.
  - Rig layers and effects are disabled during analysis, solo/enabled switches are
    restored, and temporary items are removed in `finally`.
  - Role auto-detection: BG, characters, BOOK, track mattes.
  - Linted ES3 only. **Not run** (no AE).
- **Acceptance tooling**: `tests/ae/phase1_acceptance.jsx` (AE) and
  `tools/compare_ref.js` (Node). Tolerances: means within 1/255, percentiles within 2 bins,
  light angle within 10°, plus the same class. Benchmark table per backend.

## Measured (Node, synthetic scenes)

Classifier on the 14 synthetic backgrounds (brunette_red ring):

| Scene | Class | Confidence |
|---|---|---|
| black | VOID_BLACK | 1.00 |
| day_sky | DAY | 0.80 |
| golden_hour | GOLDEN | 1.00 |
| neon_alley | NEON | 0.77 |
| night_street | NIGHT | 0.94 |
| overcast_rain | OVERCAST | 0.46 |
| snow | SNOW | 0.65 |
| twilight | TWILIGHT | 0.52 |
| underwater | UNDERWATER | 1.00 |
| warm_interior | INTERIOR_WARM | 1.00 |
| white | VOID_WHITE | 1.00 |
| fire_lit_0000 | FIRE | 0.99 |
| magenta_abstract | (fallback DAY) | 0.00 (edge case, as intended) |
| noisy | DAY | 0.10 (edge case) |

The first rule set mislabeled 4 of the 12 designed scenes. Fixes are in D-014, and the
results are pinned by `tests/node/classify.test.js`.

**Simulated match** (`tools/sim_preview.js`, match chain only, uncalibrated models; preview
in `docs/img/sim_match_brunette.png`), 4 characters × 14 scenes = 56 pairs:

- new clipping > 0.5%: **0** pairs
- skin hue/chroma out of range: **0** pairs (max skin hue shift 37°, underwater, by design)
- illuminant tint agreement (character whites vs ring key) improves: **55 / 56**
- night/neon/twilight/fire: exposure −0.8 to −1.4 EV effective (spec target −0.5 to −1.5);
  navy/brown line-art tint from the lift
- readability flag raised for night_street, neon_alley, twilight and fire (edge vs ring
  contrast < 0.08). That is the Phase 3 rim/separation trigger.

Contact-sheet review notes (as a compositor):

- Golden hour now reads as warm peach skin with cream whites.
- Night darkens with navy blacks.
- Day and snow are nearly untouched, which is correct: the designs are daylight models.
- Neon and fire get darker and warmer but still look "flat". Expected: their identity comes
  from rim, Live Ambient and the Look (Phases 2–3), not from the pointwise match.

## Not yet measured (needs AE)

- AE stats vs the Node reference, per backend: means, percentiles, angle.
- Backend timings and the default backend choice (A1 expected).
- ExtendScript speed of the stats themselves. Node takes ~200 ms per scene; ExtendScript is
  probably 30–100× slower, so if the 10 s Auto Comp budget is at risk, the first
  optimizations are LUT-based sRGB→linear and cbrt, and fewer Oklab samples.
- `saveFrameToPng` alpha and premultiplication (P-04); solo inside nested comps (P-05);
  `sampleImage` semantics (P-06).

## How to finish Phase 1 on a machine with AE

```
npm install && npm run assets
npm run doctor
node tools/ae.js run tests/ae/ping.jsx
node tools/ae.js run tools/dump_catalog.jsx
node tools/analyze_ref.js
node tools/ae.js run tests/ae/phase1_acceptance.jsx --timeout 900
node tools/compare_ref.js
```

Then record P-01…P-18 in `docs/DECISIONS.md`, pick the default backend, and update this
report.
