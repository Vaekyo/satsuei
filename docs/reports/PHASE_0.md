# Phase 0 — Recon & scaffolding · report (2026-10-09)

**Status: done except for the steps that need After Effects.** This session ran in a Linux
cloud container. AE only runs on Windows/macOS (D-001), so the doctor, the bridge round trip,
the catalog and the "aerender frame viewed" criteria are **open** and need a machine with AE.

## Built

| Item | Where | State |
|---|---|---|
| Repo, git, `.gitignore`, `CLAUDE.md`, `README.md` | root | ✅ |
| ES3 lint (ESLint 10 + es-x restrict-to-es3 + ES5 method bans + ASCII test) | `eslint.config.js`, `tests/node/bundle.test.js` | ✅ checked: it catches `let`, `forEach`, `trim`, `JSON`, trailing commas, `o.default`, `Object.keys`, `[].indexOf` |
| Node test runner (`node:test`) | `npm test` = lint + 57 unit tests | ✅ green |
| Bundler (`//@include` inliner, version stamp, ASCII check) | `tools/bundle.js` → `dist/Satsuei.jsx`, `dist/satsuei_engine.jsx` | ✅ output parses as ES3 and loads in a simulated ExtendScript global |
| JSON for ExtendScript (namespaced, strict parser, cycle-safe) | `src/lib/json2.js` | ✅ tested vs native |
| Doctor (OS, AE installs, aerender, panels path, scripting pref) | `node tools/ae.js doctor` | ✅ on Linux it exits 2 with an explicit message · ⏳ Win/mac paths unverified |
| Run-in-AE bridge (wrapper .jsx → result.json, atomic, dialogs suppressed) | `node tools/ae.js run/eval` | ✅ protocol tested against a mocked ExtendScript host · ⏳ real launch (P-01) |
| aerender wrapper | `node tools/ae.js render` | ⏳ unverified |
| Effect catalog dumper | `tools/dump_catalog.jsx` | ⏳ written + linted; **catalog not generated** (needs AE) |
| Synthetic assets | `npm run assets` (`tools/make_test_assets.js`) | ✅ viewed: `docs/img/synthetic_assets.png` |
| UXP/CEP status | `docs/DECISIONS.md` D-003 | ✅ (via web search; developer.adobe.com unreachable from the container) |

## Synthetic assets (all original, deterministic)

- **Characters** (1200×1600, straight alpha): an anime cel bust with flat fills, two-tone
  cel shadows, an "angel ring" hair highlight and ~3.2 px anti-aliased near-black line
  art, in four palettes (brunette/red jacket, blonde/white dress, black hair/navy uniform,
  pastel pink). Variants: premultiplied-on-black (fringe test), green screen #00B140 with
  edge spill, and a tight crop.
- **Backgrounds** (1920×1080): day sky, golden hour, twilight, night street with lamps, neon
  alley, overcast rain, snow, warm interior, underwater, pure black, pure white, magenta
  abstract, high-frequency noise, plus a **48-frame flickering fire-lit sequence**. They are
  painted procedurally (gradients, fbm noise, shapes, glows) with paint texture and fine
  grain.
- **Shipped in `assets/`**: a 16-bit calibration chart (24 checker patches, 10 skin tones,
  primaries/secondaries at 100% and 50%, a 32-step gray ramp, continuous K/R/G/B ramps)
  with a JSON patch layout; a HALD-8 identity (512², 16-bit); and an **exact 65³ lattice
  identity** (585×520, 16-bit, contains the 33³ grid). Both identities decode to within
  7.4e-6 of the ideal values.

## Measured

- Asset generation: ~96 s for everything (the fire sequence takes 50 s).
- Unit tests: 57 pass. Coverage includes PNG decode across every type × depth × filter ×
  zlib strategy, plus Jacobi, MKL, Oklab, percentiles, EDT and k-means.

## Known issues / next steps (needs a Windows or macOS machine with AE ≥ 23)

1. `npm run doctor` must come back clean. If it flags the scripting preference, enable
   "Allow Scripts to Write Files and Access Network".
2. `node tools/ae.js run tests/ae/ping.jsx` checks the JSON round trip (P-01, P-02, P-03).
3. `node tools/ae.js run tools/dump_catalog.jsx`, then commit `catalog/effects_<ver>.json`.
4. Render one frame with `aerender` and look at it (P-14: PNG output module from script).
5. Then the Phase 1 acceptance run (see PHASE_1.md).
