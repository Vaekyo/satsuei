# CLAUDE.md — SATSUEI project memory

SATSUEI (撮影) is an After Effects toolkit. It auto-composites anime characters into
backgrounds and applies a finishing "Look", using only AE's built-in effects.
The full spec lives in `SATSUEI_PROMPT.md` (user-provided; not in the repo). This
file holds the working memory: commands, conventions, and the gotchas we've hit.

## Commands

```
npm install            # dev deps (eslint 10, eslint-plugin-es-x, pngjs, ajv)
npm test               # lint + Node unit tests (must stay green)
npm run lint           # ESLint; ES3 rules on src/, *.jsx
npm run unit           # node --test "tests/node/**/*.test.js"
npm run build          # bundle -> dist/Satsuei.jsx (panel) + dist/satsuei_engine.jsx
npm run assets         # regenerate synthetic test assets into test_assets/synthetic/
npm run doctor         # AE environment report (exit 2 on Linux: AE can't run there)
node tools/ae.js run tests/ae/ping.jsx          # run a script inside AE (Win/mac only)
node tools/ae.js eval "app.version"
node tools/ae.js run tools/dump_catalog.jsx     # writes catalog/effects_<maj>.<min>.json
node tools/ae.js render --project x.aep --comp "C" --frame 0 --out tests/out/f.png
node tools/analyze_ref.js [<bg.png> [<char.png>]]  # Node reference stats + classifier table
node tools/sim_preview.js [--char all]          # simulated match: metrics + tests/out/sheets/
node tools/golden_classifier.js                 # refresh tests/golden/classifier_features.json
node tools/ae.js run tests/ae/phase1_acceptance.jsx --timeout 900   # AE side of Phase 1
node tools/compare_ref.js                       # AE results vs Node reference
```

## Layout

- `src/lib/json2.js`: `SATSUEI.json` (our own; no global JSON, no prototype patches)
- `src/core/*.js`: **pure ES3 math**, UMD (Node `require` + `$.global.SATSUEI.core.*`).
  No AE DOM here, ever. Unit-tested in Node.
- `src/ae/*.js`: everything that touches the AE DOM (ExtendScript only).
- `src/ui/*.js`: ScriptUI. All strings in `ui/strings.js`.
- `src/engine.jsx` = engine includes; `src/Satsuei.jsx` = engine + panel bootstrap.
- `tools/*.js`: Node dev tooling. `tools/*.jsx`: scripts that run inside AE.
- `tests/node/`: Node unit tests. `tests/ae/`: AE integration scripts. `tests/out/`
  is gitignored scratch output (renders, contact sheets, runner results).
- `test_assets/synthetic/`: generated, committed. `test_assets/private/`: the user's
  real frames, **gitignored, never commit them or renders of them**.

## Conventions (ExtendScript)

- ES3 only in `src/` and `*.jsx`. Lint catches most of it. These it can't catch:
  - `arr.indexOf(x)` on a variable: use a loop or a helper (ES3 has no Array#indexOf).
    `String#indexOf` is fine.
  - `str[i]`: use `str.charAt(i)` / `str.charCodeAt(i)`.
  - no trailing commas, no reserved words as property names (`o["default"]`).
- **ASCII only in `src/`** (a test enforces it). Write Japanese UI text as `\uXXXX`
  escapes in `ui/strings.js`.
- Modules attach to `$.global.SATSUEI`, never top-level `this`: in a ScriptUI
  Panels script, `this` is the Panel.
- Add effects by **matchName**. Set params by matchName/index from
  `catalog/effects_*.json`. Never by display name (it's localized).
- Expressions: ES3 syntax only; reference params by index, `effect("SATSUEI WB")(1)`.
  After setting one, check `prop.expressionError`.
- Every user action is one `app.beginUndoGroup`/`endUndoGroup` pair, in `try/finally`.
- Re-acquire `Property` refs after any `addProperty`/`remove`.
- Rig names are ASCII with the `SATSUEI ` prefix. Metadata lives as
  `SATSUEI:{json}` in layer comments.
- Never pop modal dialogs during automation. The runner wraps scripts in
  `app.beginSuppressDialogs()`.

## Conventions (Node tooling)

- Node ≥ 20, CommonJS, `node:test`. No new runtime deps for end users. Dev deps OK.
- **Agent tooling gotcha:** literal `\uXXXX` escapes written through the file-write
  tool or a heredoc have come out as the raw characters (seen twice). For any
  `\u` escape in `src/`, write it from Python using `chr(92) + "u…"`, then run
  `LC_ALL=C grep -rnP '[^\x00-\x7F]' src` (the ASCII test in `npm test` also catches it).

## Math conventions

- Working values = sRGB-encoded 0..1. "Linear" = linear Rec.709/D65. Oklab per
  Ottosson. Hue in degrees [0, 360).
- Angles: AE Direction convention, **0° = up, clockwise**. Screen space has x right,
  y down (`linalg.vecToAeAngle`).
- Pixel buffers: `{ w, h, r, g, b, a }`, planar arrays of floats, **straight alpha**.
- Formulas are documented in `docs/ALGORITHMS.md`. Decisions and probe results go
  in `docs/DECISIONS.md`.

## Status

See `docs/reports/PHASE_*.md`. The first session ran on Linux without AE (D-001).
Phase 0 and Phase 1 are done except for the steps that need AE; anything marked
UNVERIFIED in `docs/DECISIONS.md` (probes P-01…P-18) needs an AE run. Next session:
on a machine with AE, run the "How to finish Phase 1" list in `docs/reports/PHASE_1.md`,
then start Phase 2 (rig builder) using the generated catalog.

## Gotchas found so far

- Shades-of-gray with p=6 is dominated by one neon sign: exclude emitters (D-011/stats).
- McCamy CCT is garbage for off-locus illuminants (magenta → 1000 K): use Oklab hue.
- Oklab chroma scales with lightness: compare saturation as C/L, or darkening reads as
  desaturation (affects saturation match and the skin keeper).
- Analysis-resolution (384 px) buffers average away grain and thin neon tubes: grain must
  be measured on full-res crops; emitter thresholds are tuned for downscaled tubes.
