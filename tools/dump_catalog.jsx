/*
 * Effect catalog dumper (Phase 0). Runs INSIDE After Effects:
 *
 *   node tools/ae.js run tools/dump_catalog.jsx                 (wanted effects only)
 *   node tools/ae.js run tools/dump_catalog.jsx --args '{"mode":"all"}'
 *
 * Writes catalog/effects_<major>.<minor>.json:
 *   - every installed effect: displayName, matchName, category
 *   - for each effect we might use: every parameter (index, matchName, name, property
 *     and value type, default value, min/max, dropdown flag, expression support)
 *   - findings for things marked (verify) in the spec (effect labels, dropdown APIs)
 *
 * It creates one temporary comp + solid in the open project and removes both (and the
 * solid's footage item) in a finally block. Effects known to open dialogs or start
 * background analysis are never applied.
 */
(function () {
  var R = $.global.SATSUEI_RUN || { args: {}, root: null, logs: [], log: function () {} };
  if (!R.root) { throw new Error("dump_catalog: run via node tools/ae.js run (needs SATSUEI_RUN.root)"); }
  $.evalFile(new File(R.root + "/dist/satsuei_engine.jsx"));
  var S = $.global.SATSUEI;
  var mode = (R.args && R.args.mode) || "wanted";

  // Appendix A guesses + expression controls. Missing ones are reported, not fatal.
  var WANTED = [
    "ADBE Gaussian Blur 2", "ADBE Box Blur2", "ADBE Camera Lens Blur", "ADBE Channel Blur",
    "ADBE Easy Levels2", "ADBE Pro Levels2", "ADBE CurvesCustom", "ADBE Exposure2",
    "ADBE HUE SATURATION", "ADBE Vibrance", "ADBE CHANNEL MIXER", "ADBE Color Balance 2",
    "ADBE Tritone", "ADBE Tint", "ADBE Photo Filter", "ADBE Lumetri", "ADBE Leave Color",
    "ADBE Black&White", "ADBE Glo2", "ADBE Ramp", "ADBE 4ColorGradient", "ADBE Fill",
    "ADBE Set Matte3", "ADBE Simple Choker", "ADBE Matte Choker", "ADBE Drop Shadow",
    "ADBE Bevel Alpha", "ADBE Geometry2", "ADBE Unsharp Mask2", "ADBE Sharpen", "ADBE Noise",
    "ADBE Fractal Noise", "VISINF Grain Implant", "VISINF Grain Duplication", "ADBE Shift Channels",
    "ADBE Optics Compensation", "ADBE Lens Flare", "CC Light Rays", "CC Light Sweep",
    "CC Composite", "Keylight 906",
    "ADBE Slider Control", "ADBE Color Control", "ADBE Angle Control", "ADBE Checkbox Control",
    "ADBE Point Control", "ADBE Point3D Control", "ADBE Layer Control", "ADBE Dropdown Control"
  ];
  // matchNames unknown to the spec: found by (English) display name. Run on an English AE.
  var FIND_BY_NAME = [
    "Color Link", "Change to Color", "Remove Color Matting", "Gamma/Pedestal/Gain",
    "Selective Color", "Grid", "Posterize", "Radial Blur", "Key Cleaner",
    "Advanced Spill Suppressor", "VR Chromatic Aberrations", "Apply Color LUT", "Invert",
    "Calculations", "Channel Combiner", "Set Channels", "Minimax", "Turbulent Displace",
    "Directional Blur", "Compound Blur", "Gradient Ramp", "Levels (Individual Controls)"
  ];
  // Never applied: dialogs, background analysis, or heavy setup (verify list over time).
  var DENY = /Apply Color LUT|Roto Brush|Refine (Soft|Hard) Matte|Puppet|Warp Stabilizer|Camera Tracker|Content-Aware|Detail-preserving|Mocha|Paint|Clone|Eraser|Auto (Color|Contrast|Levels)/i;

  function enumName(obj, value) {
    var k;
    for (k in obj) {
      if (obj.hasOwnProperty(k) && obj[k] === value) { return k; }
    }
    return String(value);
  }

  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

  function dumpProp(p) {
    var d = {
      index: p.propertyIndex,
      matchName: p.matchName,
      name: p.name,
      type: enumName(PropertyType, p.propertyType)
    };
    var i;
    if (p.propertyType === PropertyType.PROPERTY) {
      d.valueType = enumName(PropertyValueType, p.propertyValueType);
      if (p.propertyValueType !== PropertyValueType.NO_VALUE &&
          p.propertyValueType !== PropertyValueType.CUSTOM_VALUE) {
        d.value = safe(function () { return p.value; }, null);
      }
      d.hasMin = safe(function () { return p.hasMin; }, null);
      d.hasMax = safe(function () { return p.hasMax; }, null);
      if (d.hasMin) { d.min = safe(function () { return p.minValue; }, null); }
      if (d.hasMax) { d.max = safe(function () { return p.maxValue; }, null); }
      d.isDropdown = safe(function () { return p.isDropdownEffect; }, null); // AE 2022+ (verify)
      d.canSetExpression = safe(function () { return p.canSetExpression; }, null);
      d.canVaryOverTime = safe(function () { return p.canVaryOverTime; }, null);
      d.unitsText = safe(function () { return p.unitsText; }, null);
    } else {
      d.children = [];
      for (i = 1; i <= p.numProperties; i++) { d.children.push(dumpProp(p.property(i))); }
    }
    return d;
  }

  var t0 = new Date().getTime();
  var all = [];
  var byMatch = {};
  var i, e;
  for (i = 0; i < app.effects.length; i++) {
    e = app.effects[i];
    all.push({ displayName: e.displayName, matchName: e.matchName, category: e.category });
    byMatch[e.matchName] = e;
  }

  var toDump = [];
  var missing = [];
  var found = {};
  for (i = 0; i < WANTED.length; i++) {
    if (byMatch[WANTED[i]]) { toDump.push(WANTED[i]); } else { missing.push(WANTED[i]); }
  }
  var j;
  for (j = 0; j < FIND_BY_NAME.length; j++) {
    found[FIND_BY_NAME[j]] = null;
    for (i = 0; i < all.length; i++) {
      if (all[i].displayName === FIND_BY_NAME[j]) {
        found[FIND_BY_NAME[j]] = all[i].matchName;
        toDump.push(all[i].matchName);
        break;
      }
    }
  }
  if (mode === "all") {
    for (i = 0; i < all.length; i++) {
      if (/^(ADBE |CC |VISINF|APC |Keylight)/.test(all[i].matchName)) { toDump.push(all[i].matchName); }
    }
  }

  var details = {};
  var errors = {};
  var probes = {};
  var comp = null, layer = null, solidSource = null;
  app.beginUndoGroup("SATSUEI catalog dump");
  try {
    comp = app.project.items.addComp("SATSUEI CATALOG TMP", 64, 64, 1, 1, 24);
    layer = comp.layers.addSolid([0.5, 0.5, 0.5], "SATSUEI CATALOG SOLID", 64, 64, 1);
    solidSource = layer.source;
    var parade = layer.property("ADBE Effect Parade");
    for (i = 0; i < toDump.length; i++) {
      var mn = toDump[i];
      if (details[mn] || errors[mn]) { continue; }
      if (DENY.test(byMatch[mn] ? byMatch[mn].displayName : mn)) { errors[mn] = "skipped (deny list)"; continue; }
      try {
        var fx = parade.addProperty(mn);
        details[mn] = dumpProp(fx);
        if (!probes.effectLabel) {
          probes.effectLabel = safe(function () { return { readable: true, value: fx.label }; }, { readable: false });
        }
        // re-acquire: addProperty can invalidate references (gotcha 4)
        layer.property("ADBE Effect Parade").property(1).remove();
        parade = layer.property("ADBE Effect Parade");
      } catch (err) {
        errors[mn] = String(err.message || err);
        parade = layer.property("ADBE Effect Parade");
        while (parade.numProperties > 0) { parade.property(1).remove(); }
      }
    }
    // Dropdown Menu Control: can items be set from script? (verify)
    probes.dropdownSetItems = safe(function () {
      var dd = layer.property("ADBE Effect Parade").addProperty("ADBE Dropdown Control");
      var menu = dd.property(1);
      menu.setPropertyParameters(["A", "B", "C"]);
      var ok = layer.property("ADBE Effect Parade").property(1).property(1).maxValue;
      layer.property("ADBE Effect Parade").property(1).remove();
      return { ok: true, maxValueAfter: ok };
    }, { ok: false });
    probes.setTrackMatte = (typeof layer.setTrackMatte === "function");
  } finally {
    try { if (comp) { comp.remove(); } } catch (e1) { R.log("cleanup comp: " + e1); }
    try { if (solidSource) { solidSource.remove(); } } catch (e2) { R.log("cleanup solid: " + e2); }
    app.endUndoGroup();
  }

  var ver = S.ae.env.parseVersion(app.version);
  var catalog = {
    generatedBy: "tools/dump_catalog.jsx",
    generatedAt: String(new Date()),
    aeVersion: ver.full,
    buildName: safe(function () { return app.buildName; }, null),
    language: safe(function () { return String(app.isoLanguage); }, null),
    os: $.os,
    mode: mode,
    projectColor: S.ae.env.projectColor(),
    missingWanted: missing,
    foundByName: found,
    probes: probes,
    errors: errors,
    effects: all,
    params: details,
    bpcSupport: "not exposed to scripting; measured per effect by render (docs/DECISIONS.md)"
  };
  var out = new File(R.root + "/catalog/effects_" + ver.major + "." + ver.minor + ".json");
  out.encoding = "UTF-8";
  out.open("w");
  out.write(S.json.stringify(catalog, 1));
  out.close();
  R.result = {
    file: out.fsName,
    effects: all.length,
    dumped: (function () { var n = 0, k; for (k in details) { if (details.hasOwnProperty(k)) { n++; } } return n; }()),
    missingWanted: missing,
    errors: errors,
    probes: probes,
    ms: new Date().getTime() - t0
  };
}());
