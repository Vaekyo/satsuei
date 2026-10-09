# Algorithms

Every formula the engine uses. Code references are to `src/core/*` (pure ES3, unit-tested in
Node) unless noted. Constants live in `config/defaults.json`. Defaults that differ from the
spec are explained in `docs/DECISIONS.md` (D-011).

## 1. Color

- **Working values** are sRGB-encoded 0..1, i.e. what effects see in a non-linear 8/16 bpc
  project. **Linear** values are linear Rec.709/D65.
- **sRGB transfer** (`color.srgbToLinear`): `v ≤ 0.04045 → v/12.92`, else
  `((v+0.055)/1.055)^2.4`. It is sign-symmetric, so negative (32 bpc) values survive.
- **Luminance**: `Y = 0.2126 R + 0.7152 G + 0.0722 B` (linear).
- **Lightness used by the histograms**: `Lr = Y^(1/3)`. This is exactly Oklab L for a
  neutral color, so percentiles live on a perceptual scale (black levels have resolution).
- **Oklab** per Ottosson (2020). There are two paths: direct linear-sRGB→LMS, and Ottosson's
  XYZ path. A test checks the published XYZ test vectors (±1.5e-3) and that the two paths
  agree. Hue is `atan2(b, a)` in degrees [0, 360). "Relative tint" `(a/L, b/L)` (L ≥ 0.05)
  compares tints across lightness.
- **CCT**: McCamy (1992) from CIE xy (reporting only; it is unreliable off the Planckian
  locus, which is why the classifier uses Oklab hue/chroma instead). Its inverse uses Kim et
  al.'s cubic-spline Planckian locus, for tests.

## 2. Pixel buffers & analysis passes

`{ w, h, r, g, b, a }`: planar float arrays with straight alpha. Backend A1
(`src/ae/analyze.js`) nests the main comp into a temporary comp scaled so the longest side is
`analysis.maxSide` (384). Each pass solos one role inside the main comp, then the frame is
written with `saveFrameToPng` and decoded by `core/png` (our own inflate). The passes are:
BG alone; each character alone (its alpha is in comp space); and optionally the full comp.
The Node reference (`tools/lib/comp.js`) builds the same passes from the source PNGs. It
uses bilinear placement and area-average downscaling.

## 3. Statistics (`core/stats`)

Region weights `w_i`: background global = 1; ring = see below; character core = `a ≥ 0.95`.

- **Moments**: weighted mean and 3×3 covariance in working RGB and in linear RGB.
- **Histogram**: 1024 bins of `Lr` in [0, 1]. Percentile `p` is interpolated linearly
  inside the bin where the cumulative weight crosses `p·W`. Tested within 2 bins of exact
  sorted percentiles.
- **Black color**: mean of pixels with `Lr ≤ p3`.
- **Key color**: mean of the brightest 3% (of total weight) among *eligible* pixels
  from the top ~15%. Eligible means not clipped (max channel < 0.995) and not a saturated
  emitter (Oklab C > 0.14 at L > 0.55). If nothing is eligible (pure white or black frames),
  it falls back to all pixels.
- **Band tints**: mean Oklab inside lightness bands `[0, p20]`, `[p40, p60]` and
  `[p80, 1]`, computed on a deterministic subset of at most 20 000 pixels.
- **Illuminant**:
  - Shades-of-gray estimate `e_c = (Σ w c^6 / Σ w)^(1/6)` over unclipped, non-emitter
    pixels. The emitter proxy is `max ≥ 0.6 ∧ (max−min) ≥ 0.65·max`; with p = 6, a single
    neon sign would otherwise dominate.
  - Then `E = norm(lerp(sog, norm(key), 0.7))`, where norm means unit luminance. Highlights
    get the larger weight because shades-of-gray reads big colored areas (sky, grass) as
    light.
  - Reported as linear RGB, Oklab hue/chroma and CCT.
- **Palette**: weighted k-means, k = 5, in Oklab on ≤ 4096 deterministic samples. Seeding
  is k-means++ driven by the shared Park–Miller PRNG (seed 12345), so the result is
  identical in Node and ExtendScript. Stops early when assignments stop changing.
- **Light direction**:
  1. Weighted least-squares plane fit `Y ≈ a·x + b·y + c` with x right, y down, both
     normalized to [−1, 1], on a ≤ 96×96 sample grid. The angle is
     `vecToAeAngle(a, b)` (AE convention: 0° up, clockwise). Confidence is
     `clamp(4·R²) · clamp(|∇|/(Ȳ+1e-3) / 0.3)`.
  2. Bright blob: Y-weighted centroid and spread of the top 2% by Y. Its direction is taken
     from the character centroid. Confidence is
     `clamp(1−3·spread) · clamp(dist/0.2) · clamp(log2(Ȳ_blob/Y_med)/3)`.
  3. The two are combined as a confidence-weighted sum of unit vectors.
- **Distance transform**: exact Euclidean, Felzenszwalb & Huttenlocher, two separable 1-D
  passes (tested against brute force).
- **Ring** around character k: pixels with `a_k < 0.5` within `R = 0.08·H` of the
  character mask, weighted `(1 − d/R)² · (1 − a_k)`.
- **Haze**: for the upper and lower thirds, `p95−p5` of `Lr`, the mean Oklab chroma, and
  the fraction of cool pixels (hue ≥ 200° or < 10°, C > 0.03; a sky cue). The index is
  `haze = ½·clamp(1−c_up/c_lo) + ½·clamp(1−chroma_up/chroma_lo)`.
- **Grain**: RMS of `luma − box3(luma)` over flat pixels (box3-gradient magnitude ≤ its
  p30). For a white-noise field of std σ the expected value is `√(8/9)·σ` (tested).
  *Measure on full-resolution crops*: the 384 px analysis buffers average grain away.
- **Sharpness**: `mean|∇Lr| / std(Lr)`, with `softness = 1/(1+sharpness)`.
- **Character extras**:
  - Line art: dark (`Lr ≤ 0.33`), low-chroma (C ≤ 0.06) pixels that have a pixel ≥ 0.3
    brighter within 2 px (thin structures, not dark fills).
  - Skin: Oklab hue 25–75°, C 0.02–0.10, L ≥ 0.7. This window excludes blonde (~88°) and
    pink hair.
  - Alpha-weighted bbox, centroid and area.
  - Inner edge band: `a ≥ 0.5` within 0.6% of H of the outside.
- **Emitters**: bright, saturated pixels (L ≥ 0.45, C ≥ 0.12), split into warm (hue
  20–110°: fire, lamps) and other (neon).
- **Relative chroma**: `mean(C / max(L, 0.1))`. This is the saturation measure for matching,
  because darkening must not read as desaturation.

## 4. Scene classifier (`core/classify`)

Each class gets a score in [0, 1] built from smooth steps of the features. The winner is the
argmax, with `confidence = top − runner-up`. If the top score is below 0.15, the class falls
back to NIGHT or DAY by brightness (edge cases such as abstract or noise backgrounds).
Defined helpers:

- `warm = band(hue_illum, 25°, 100°) · ss(0.03, 0.08, C_illum)`
- `veryWarm = warm · ss(0.13, 0.2, C_illum)`
- `dark = ss(0.5, 0.25, medL)`
- `neonish = ss(0.002, 0.01, emitters_other)`

Selected rules:

| Class | Score |
|---|---|
| NEON | `dark · neonish · (1 − veryWarm)` |
| FIRE | `ss(.55,.3,medL) · veryWarm · (½ + ½·ss(.001,.008, emitters_warm))` |
| NIGHT | `dark · (.55 + .45·[blue shadows]) · (1 − .8·neonish) · (1 − veryWarm) · (1 − .8·ss(.055,.075, chroma))` |
| GOLDEN | `warm · band(medL,.38,.75) · ss(.06,.09,C_illum) · ss(.12,.3, skyCool)` |
| INTERIOR_WARM | `warm · band(medL,.3,.7) · ss(.25,.1, skyCool)` |

The full set is in the source. On the 14 synthetic scenes, all 12 designed classes come out
correct (`tests/golden/classifier_features.json`), and the two edge cases stay
low-confidence. These rules are tuned on synthetic data only; real frames will need tuning
(`test_assets/private/`).

## 5. Effect models (`core/fxmodel`)

All models are UNVERIFIED until calibrated (P-10). Calibration overrides `fxmodel.CAL`.

- **Exposure, Individual Channels**: `out = enc( (lin(in)·2^stops + offset)^(1/γ) )`, where
  enc/lin is the sRGB curve (assumed).
- **Levels (Individual Controls)**, per channel, master at identity:
  `out = ob + (ow − ob) · clamp((in − ib)/(iw − ib))^(1/γ)`.
- **Channel Mixer**: `out = (M/100)·in + const/100` (AE percent units).
- **Saturation** (folded into the mixer): `s·I + (1−s)·1·wᵀ` with Rec.709 luma weights on
  working values. It is luma-preserving and exactly affine.
- **Contrast** (folded into the mixer): `pivot + c·(x − pivot)`.
- **Chain**: Exposure (WB stops + EV) → Levels (lift, gamma, gain) → Channel Mixer
  (`MKL_h ∘ Contrast ∘ Saturation`).
- **Partial strength** (what the expressions do live):
  - stops × k
  - lift × k
  - `γ^k`
  - `1 − (1−gain)·k`
  - `sat^k`
  - `contrast^k`
  - MKL `A_k = I + k(A − I)`, `b_k = k·b` (an exact linear blend)

## 6. Lighting Transfer (`core/transfer.solve`)

Inputs: BG global and ring regions, character stats, ≤ 4096 core-pixel samples. Each step is
solved on the *predicted* output of the previous steps (the fxmodel chain over the samples),
so casts are never applied twice.

1. **White balance** (von Kries, linear):
   - `E_bg = capChroma(norm(lerp(E_global, E_ring, 0.5)), 0.08)`
   - `E_char = norm(lerp(1, E_char_measured, 0.3))` (character models are designed under
     neutral light)
   - `g = E_bg/E_char`, normalized to `Y(g) = 1`
   - stops `= clamp(log2 g, ±1.5)`
2. **Exposure**: `ΔEV = clamp(0.6·log2(Y_ring_median / 0.18), −2.5, +0.3)`.
3. **Lift**: `outBlack = min(0.2, black_ring)` per channel. A line-art guard then scales the
   lift down until the lightness gap between lifted line art and the lifted p20 fill keeps
   ≥ 60% of its original size.
4. **Midtone tint**:
   - Residual `Δ = (relTint(mid band) − relTint(E_bg))·0.6`, capped at |Δ| ≤ 0.02. This is
     the part WB didn't explain.
   - Target = WB'd mid-gray `+ Δ·L`.
   - Per-channel `γ_c = ln(x_c)/ln(t_c)`, clamped to [0.75, 1.35].
5. **Highlight tint**: the same residual for the key color, as `outWhite ≤ 1` (normalized by
   the max channel, floor 0.85).
6. **Saturation**:
   - `s_meas = clamp(1.4·relC_ring / relC_char, 0.75, 1.15)`
   - `s = exp(½ ln s_meas + ½ ln Sat×_class)`
7. **Contrast**: `c = clamp((range_bg/range_char)^0.25, 0.85, 1.15)` around the character's
   median luma.
8. **Harmony** (MKL, Pitié & Kokaram 2007), from the post-step-7 distribution to the ring:
   - `T = Σs^-½ (Σs^½ Σt Σs^½)^½ Σs^-½`
   - Regularized with `Σ + 1e-4·I`, symmetrized, eigenvalues clamped to [½, 2]
   - `b = μt − T·μs`
   - Tested: `T Σs Tᵀ = Σt`, and T = I for identical inputs.

**Guards** (on the prediction at the requested strengths):

- **Skin keeper**: binary-searches the largest scale `s ∈ [0, 1]` applied to WB, gamma,
  gain, saturation and MKL (`scaleColorParams`) such that the predicted skin color keeps:
  - its hue within 25° (40° for UNDERWATER)
  - relative chroma ≥ 0.8× the original (0.5× underwater, 0.3× mono)
  - relative chroma ≤ 2× the original
- **Clip guard**: lowers EV in 0.1 steps until new per-channel clipping is ≤ 0.5% of the
  character's pixels and luma p99 ≤ 0.985 (or no worse than before).
- **Readability**: `|L_edge − L_ring| ≥ 0.08`. Failing it flags rim/separation (Phase 3).

**Reinhard in Oklab** (alternative method): per-channel mean/std transfer in Oklab, then the
best-fit affine RGB map via WLS with a small ridge toward identity. The residual ΔE_ok is
reported.

## 7. Effective strengths

`k_step = Master × Match × step`:

- wb, lift and harmony come from the class row of `config.classes` (spec sec. 6.4 table).
- The others come from `config.match`.
- `classExtras[cls].ev` scales Exposure Match (it is 0 for the VOID classes).
- `classExtras[cls].transfer` overrides solver constants per class.

## 8. Metrics (`tools/lib/metrics.js`, spec sec. 10.5)

- Illuminant agreement: the distance between the relative tint of the character's whites
  (top-10% L with C < 0.08) and that of the ring key.
- Black-level agreement: `|p2_char − p2_ring|` in L.
- Mean-L and relative-chroma ratios.
- Clip increase.
- Skin hue/chroma, using the skin mask taken from the *un-matched* character.
- Readability: edge band L vs ring L.
