# Decisions & verified findings

A running log. Each entry says **what** was decided or found, **why**, and **how it
was verified** (or that it is still unverified). Anything the spec marks *(verify)*
stays **UNVERIFIED** here until a probe on a real After Effects confirms it.

Status tags: `VERIFIED` (measured on a real AE or by tests) ·
`UNVERIFIED` (best knowledge, needs an AE probe) · `DECISION` (a choice we made).

---

## D-001 · Dev environment of the first session — DECISION (2026-10-09)

The first build session ran in a **Linux cloud container** (Ubuntu 24.04, Node 22.22,
no After Effects). AE runs only on Windows and macOS, so nothing that needs AE could
run there: the bridge, aerender, the catalog dump, renders, calibration and probes.

What we did about it:
- We built and tested everything AE-independent: the pure ES3 core math, the PNG
  decoder, JSON, the bundler, lint, synthetic assets, the Node reference analyzer and
  a Node-side *simulation* of the match chain. The simulation uses our current effect
  models; it is not calibrated yet.
- We wrote the AE-side scripts (`tools/ae.js`, `tests/ae/ping.jsx`,
  `tools/dump_catalog.jsx`) and linted them as ES3. We tested the run-wrapper protocol
  against a mocked ExtendScript host (`tests/node/runner.test.js`). The real launch
  paths (`AfterFX.exe -r`, `osascript … DoScriptFile`) are **UNVERIFIED**.
- `node tools/ae.js doctor` exits 2 on Linux with an explicit message.

**Next session needs a Windows/macOS machine with AE ≥ 23.0** (ideally Claude Code
running locally there) to finish Phase 0: doctor clean, bridge round trip, catalog
committed, one aerender frame viewed.

## D-002 · Kickoff defaults — DECISION (2026-10-09)

Nobody answered the §13 kickoff questions before Phase 0 started, so we took the
defaults; any of them can be changed later:
- Target AE: the newest installed. Minimum supported: 23.0.
- Character sources: all of them, with PNG/PSD cels and Roto Brush cutouts first.
- Native C++ effects: later (Phase 7).
- Reference looks: none yet. Drop stills into `test_assets/private/refs/`.

## D-003 · UXP / CEP status — UNVERIFIED-ONLINE (checked 2026-10-09)

- `developer.adobe.com` was not reachable from the build container (DNS failure), so
  we could not read the page directly. A web search (2026-10-09) found:
  - Adobe's After Effects UXP developer page still calls its resources **beta**
    ("more documentation and sample code … throughout the beta").
  - A dedicated *After Effects UXP* forum category opened on 2026-10-05 on
    forums.creativeclouddeveloper.com, which means AE UXP is opening to developers,
    but we found no GA announcement.
- **Decision:** keep Tier A on ExtendScript + ScriptUI as the spec says. All AE-DOM
  access lives behind `src/ae/` and all math in `src/core/` (pure, UMD, Node-tested),
  so a UXP front-end can be added later without touching the core.
- CEP: still works for HTML panels (PlayerDebugMode for unsigned, ZXP for
  distribution). It is an optional Phase 6 front-end calling the same engine.
- Re-check both on a machine with normal web access; update this entry.

## D-004 · JSON implementation — DECISION

`src/lib/json2.js` keeps the conventional path but is **our own** namespaced
implementation (`SATSUEI.json`). Crockford's json2.js defines a global `JSON` and
patches `Date.prototype.toJSON` etc., which conflicts with gotcha 1 (AE's engine is
shared with other scripts). Ours has a strict recursive-descent parser (no `eval`),
escapes U+2028/2029 (raw ones are syntax errors inside ES3 string literals, which
matters because we embed JSON in expressions and layer comments), and throws on
nesting deeper than 64 (AE DOM objects are cyclic, so a hang becomes a loud error).
Tested against native JSON in Node.

## D-005 · Module format & the global — DECISION

- Every `src/core/*.js` and `src/lib/json2.js` file is UMD. Under Node it uses
  `module.exports`. Under ExtendScript it attaches to `$.global.SATSUEI`.
- **Gotcha found while designing:** a script launched from *ScriptUI Panels* runs with
  top-level `this` set to the **Panel**, not the global object. So modules attach to
  `$.global`, never to `this`.
- `src/engine.jsx` is the engine with no UI. `src/Satsuei.jsx` is engine + panel.
  `tools/bundle.js` inlines every `//@include` (the comment form keeps the files valid
  JS for ESLint) into `dist/Satsuei.jsx` and `dist/satsuei_engine.jsx`, stamping
  `SATSUEI.VERSION` with `<pkg version>+<git rev>`.
- AE-side test scripts load **`dist/satsuei_engine.jsx`** with `$.evalFile` (the
  runner rebuilds first). This avoids depending on whether `//@include` resolves
  inside `$.evalFile`'d files — **UNVERIFIED**, probe in AE.

## D-006 · ES3 enforcement — DECISION / VERIFIED (by lint tests)

- ESLint 10 flat config: `src/**`, `tools/**/*.jsx` and `tests/ae/**` parse with
  `ecmaVersion: 3`, plus `eslint-plugin-es-x` `flat/restrict-to-es3`.
- Without type information, es-x only flags array methods when the receiver is
  provably an array. So `no-restricted-properties` also bans `.forEach/.map/.filter/
  .reduce/.some/.every/.trim/.bind/.toISOString`, plus `Object.keys/create/
  defineProperty/freeze/getPrototypeOf`, `Array.isArray` and `Date.now`. `JSON` is a
  restricted global.
- Not catchable by lint, so it's a convention (see CLAUDE.md): `arr.indexOf` on
  variables, and `str[i]` indexing (use `charAt`/`charCodeAt`).
- A Node test asserts every file under `src/` is pure ASCII (gotcha 7).

## D-007 · PRNG — DECISION

k-means++ seeding and the Randomize feature need identical sequences in Node and
ExtendScript. We use a Park–Miller LCG (a = 48271) with Schrage's method. All of its
arithmetic is exact in doubles. ExtendScript has no `Math.imul`, which rules out
mulberry/xorshift-style generators.

## D-008 · PNG decoder scope — DECISION / VERIFIED (Node)

`src/core/png.js` contains its own inflate (stored, fixed and dynamic blocks) and
handles PNG bit depths 1/2/4/8/16, color types 0/2/3/4/6, filters 0–4, `tRNS`, and
multiple IDAT chunks. It rejects interlaced PNGs and does not verify adler32/CRC (to
save time in ExtendScript). Tests check exact equality against a reference encoder
across all type × depth × filter × zlib-strategy combinations, and against pngjs.
Whether `saveFrameToPng` writes premultiplied color is **UNVERIFIED**;
`png.unpremultiply()` is ready if it does.

## D-009 · Angle convention — DECISION

One project-wide convention: AE "Direction" style, **0° = up, clockwise**, screen
space with x to the right and y down. Helpers: `linalg.vecToAeAngle`,
`linalg.aeAngleToVec`. That AE's angle params really use this convention is
**UNVERIFIED** (probe Drop Shadow Direction / Gradient Ramp points).

## Open probes (run on a real AE, then record results here)

| # | Probe | Spec ref |
|---|---|---|
| P-01 | `AfterFX.exe -r` / `osascript DoScriptFile` round trip; dialogs suppressed | §10.1 |
| P-02 | `//@include` inside `$.evalFile`d scripts | D-005 |
| P-03 | Scripting file-access pref section/key (`Main Pref Section v2`?) | gotcha 16 |
| P-04 | `saveFrameToPng` async behavior + alpha premultiplication | gotcha 14 |
| P-05 | solo inside a nested comp affects the parent render | §6.2 A1 |
| P-06 | `sampleImage` semantics (alpha-weighted? straight/premult?) | §6.2 B |
| P-07 | Effect labels exposed to scripting (26.5) | §6.6 |
| P-08 | `Property.setPropertyParameters` on Dropdown Menu Control | §6.7 |
| P-09 | `AVLayer.setTrackMatte` availability/semantics (≥ 23.0) | §3 |
| P-10 | Exposure / Levels / Channel Mixer / Hue-Sat exact math, per bpc | §10.4 |
| P-11 | Adjustment-layer blend-mode semantics (diffusion) | §7.2 |
| P-12 | Expression references survive layer/effect renames | gotcha 7 |
| P-13 | AE Direction angle convention | D-009 |
| P-14 | Output-module template for PNG from script (`setSettings` keys) | §10.1 |
