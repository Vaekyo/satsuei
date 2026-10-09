/*
 * SATSUEI ae/analyze - pixel acquisition + analysis (sec. 6.2-6.4). ExtendScript only.
 *
 *   SATSUEI.analyze(comp, roles, opts) -> Analysis (JSON-serializable)
 *
 * Backends behind one interface getPixels(ctx, layerSet) -> { w, h, r, g, b, a }
 * (straight alpha, working space):
 *   A1 "png"   temporary analysis comp (main comp nested, scaled to maxSide) ->
 *              CompItem.saveFrameToPng -> core/png decode.          (default candidate)
 *   A2 "rq"    same analysis comp through the Render Queue (PNG output module).
 *   B  "probe" text layer whose Source Text expression runs sampleImage() on a grid.
 * Isolation passes use solo inside the main comp (P-05: verify that solo inside a
 * nested comp affects its render). Every switch, rig layer/effect and temp item is
 * restored or removed in finally blocks.
 */
(function () {
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.ae = S.ae || {};
  var U = S.ae.util;

  var DEFAULTS = {
    backend: "png",
    maxSide: 384,
    timeoutMs: 20000,
    probeGrid: 64,           // probe backend: samples along the long side
    unpremultiplyPng: false, // P-04: set true if saveFrameToPng writes premultiplied color
    keepTemp: false
  };

  function opt(o, k) { return (o && o[k] !== undefined) ? o[k] : DEFAULTS[k]; }

  /* ------------------------------------------------------------------ */
  /* analysis comp                                                       */
  /* ------------------------------------------------------------------ */

  function makeAnalysisComp(comp, maxSide) {
    var f = Math.min(1, maxSide / Math.max(comp.width, comp.height));
    var w = Math.max(4, Math.round(comp.width * f)), h = Math.max(4, Math.round(comp.height * f));
    var ana = app.project.items.addComp(U.PREFIX + " ANALYSIS TMP", w, h, 1, comp.duration, comp.frameRate);
    ana.bgColor = [0, 0, 0];
    var nest = ana.layers.add(comp);
    var tr = nest.property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").setValue([comp.width / 2, comp.height / 2]);
    tr.property("ADBE Position").setValue([w / 2, h / 2]);
    tr.property("ADBE Scale").setValue([100 * w / comp.width, 100 * h / comp.height]);
    try { nest.quality = LayerQuality.BEST; } catch (e) { /* ignore */ }
    try { ana.resolutionFactor = [1, 1]; } catch (e2) { /* ignore */ }
    return { comp: ana, nest: nest, w: w, h: h, scale: w / comp.width };
  }

  function removeItem(item) {
    try { if (item) { item.remove(); } } catch (e) { /* already gone */ }
  }

  /* ------------------------------------------------------------------ */
  /* backend A1: saveFrameToPng                                          */
  /* ------------------------------------------------------------------ */

  function pngFromFile(f, o) {
    var img = S.core.png.decode(U.readBinary(f));
    if (opt(o, "unpremultiplyPng")) { S.core.png.unpremultiply(img); }
    return img;
  }

  function grabPng(ctx, o) {
    var f = U.tempFile("analysis", ".png");
    ctx.ana.comp.saveFrameToPng(ctx.time, f);
    if (!U.waitForFile(f, opt(o, "timeoutMs"))) {
      throw new Error("SATSUEI analyze: saveFrameToPng timed out (" + f.fsName + ")");
    }
    try { return pngFromFile(f, o); } finally { if (!opt(o, "keepTemp")) { f.remove(); } }
  }

  /* ------------------------------------------------------------------ */
  /* backend A2: Render Queue                                            */
  /* ------------------------------------------------------------------ */

  function grabRenderQueue(ctx, o) {
    var rq = app.project.renderQueue, i, saved = [], item, om, dir, files, out;
    for (i = 1; i <= rq.numItems; i++) {
      saved.push(rq.item(i).render);
      try { rq.item(i).render = false; } catch (e) { /* rendering / done items */ }
    }
    item = rq.items.add(ctx.ana.comp);
    try {
      item.timeSpanStart = ctx.time;
      item.timeSpanDuration = ctx.ana.comp.frameDuration;
      om = item.outputModule(1);
      var set = false;
      try {
        // setSettings keys are English labels (verify P-14)
        om.setSettings({ "Format": "PNG Sequence", "Video Output": { "Channels": "RGB + Alpha", "Color": "Straight (Unmatted)" } });
        set = true;
      } catch (e2) { set = false; }
      if (!set) {
        try { om.applyTemplate(U.PREFIX + " PNG"); set = true; } catch (e3) { set = false; }
      }
      if (!set) { throw new Error("SATSUEI analyze: cannot configure a PNG output module (create an output-module template named \"" + U.PREFIX + " PNG\")"); }
      dir = S.ae.env.userFolder("tmp/rq_" + new Date().getTime());
      om.file = new File(dir.fsName + "/frame_[#####].png");
      rq.render();
      files = dir.getFiles("*.png");
      if (!files.length) { throw new Error("SATSUEI analyze: render queue produced no file"); }
      out = pngFromFile(files[0], o);
      if (!opt(o, "keepTemp")) {
        for (i = 0; i < files.length; i++) { files[i].remove(); }
        dir.remove();
      }
      return out;
    } finally {
      try { item.remove(); } catch (e4) { /* ignore */ }
      for (i = 1; i <= rq.numItems && i <= saved.length; i++) {
        try { rq.item(i).render = saved[i - 1]; } catch (e5) { /* ignore */ }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* backend B: expression probe (sampleImage on a grid)                 */
  /* ------------------------------------------------------------------ */

  /**
   * Builds (once per analysis) a text layer + row slider in the analysis comp. The
   * Source Text expression samples one grid row of the nested main comp per
   * evaluation and returns 4 hex digits per channel (16-bit) per sample.
   * sampleImage semantics (straight vs premultiplied; P-06) decide whether we
   * un-premultiply: opts.probePremultiplied.
   */
  function probeSetup(ctx, o) {
    if (ctx.probe) { return ctx.probe; }
    var gw = opt(o, "probeGrid");
    var gh = Math.max(2, Math.round(gw * ctx.ana.h / ctx.ana.w));
    var tl = ctx.ana.comp.layers.addText("0");
    tl.name = U.PREFIX + " PROBE";
    var sl = tl.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
    sl.name = U.PREFIX + " ROW";
    var nestName = ctx.ana.nest.name;
    var expr = [
      "var L = thisComp.layer(" + S.json.stringify(nestName) + ");",
      "var row = Math.round(effect(" + S.json.stringify(U.PREFIX + " ROW") + ")(1));",
      "var gw = " + gw + ", gh = " + gh + ";",
      "var cw = thisComp.width / gw, ch = thisComp.height / gh;",
      "var out = [], i, c, v, s;",
      "for (i = 0; i < gw; i++) {",
      "  s = L.sampleImage(L.fromComp([(i + 0.5) * cw, (row + 0.5) * ch]), [cw / 2, ch / 2], true, time);",
      "  for (c = 0; c < 4; c++) {",
      "    v = Math.round(Math.max(0, Math.min(1, s[c])) * 65535).toString(16);",
      "    while (v.length < 4) { v = '0' + v; }",
      "    out.push(v);",
      "  }",
      "}",
      "out.join('');"
    ].join("\n");
    var st = tl.property("ADBE Text Properties").property("ADBE Text Document");
    st.expression = expr;
    if (st.expressionError) { throw new Error("SATSUEI probe expression error: " + st.expressionError); }
    ctx.probe = { layer: tl, gw: gw, gh: gh };
    return ctx.probe;
  }

  function grabProbe(ctx, o) {
    var p = probeSetup(ctx, o);
    var row, i, txt, k, n = p.gw * p.gh;
    var img = { w: p.gw, h: p.gh, r: new Array(n), g: new Array(n), b: new Array(n), a: new Array(n) };
    var slider = p.layer.property("ADBE Effect Parade").property(1).property(1);
    var st = p.layer.property("ADBE Text Properties").property("ADBE Text Document");
    for (row = 0; row < p.gh; row++) {
      slider.setValue(row);
      txt = String(st.valueAtTime(ctx.time, false).text);
      if (txt.length < p.gw * 16) { throw new Error("SATSUEI probe: short row " + row + " (" + txt.length + " chars)"); }
      for (i = 0; i < p.gw; i++) {
        k = row * p.gw + i;
        img.r[k] = parseInt(txt.substr(i * 16, 4), 16) / 65535;
        img.g[k] = parseInt(txt.substr(i * 16 + 4, 4), 16) / 65535;
        img.b[k] = parseInt(txt.substr(i * 16 + 8, 4), 16) / 65535;
        img.a[k] = parseInt(txt.substr(i * 16 + 12, 4), 16) / 65535;
      }
    }
    if (opt(o, "probePremultiplied")) { S.core.png.unpremultiply(img); }
    return img;
  }

  var BACKENDS = { png: grabPng, rq: grabRenderQueue, probe: grabProbe };

  /* ------------------------------------------------------------------ */
  /* passes                                                              */
  /* ------------------------------------------------------------------ */

  /** Render the main comp with exactly `visible` soloed (null = everything). */
  function pass(ctx, visible, o) {
    if (visible) { U.soloOnly(ctx.comp, visible); } else { U.unsoloAll(ctx.comp); }
    return BACKENDS[ctx.backend](ctx, o);
  }

  function inputHash(comp, rolesDesc, time, o) {
    var parts = [comp.id, comp.width, comp.height, time, opt(o, "maxSide"), opt(o, "backend"), S.json.stringify(rolesDesc)];
    var s = parts.join("|"), h = 5381, i;
    for (i = 0; i < s.length; i++) { h = ((h * 33) + s.charCodeAt(i)) % 4294967296; }
    return h.toString(16);
  }

  /**
   * analyze(comp, roles, opts)
   *   roles: output of S.ae.roles.detect() (or null to auto-detect)
   *   opts: { backend: "png"|"rq"|"probe", maxSide, time, config (defaults.json), withComp }
   */
  function analyze(comp, roles, opts) {
    var o = opts || {};
    var cfg = o.config || {};
    var R = roles || S.ae.roles.detect(comp);
    if (!R.background) { throw new Error("SATSUEI analyze: no background layer (" + R.notes.join("; ") + ")"); }
    if (!R.characters.length) { throw new Error("SATSUEI analyze: no character layer (" + R.notes.join("; ") + ")"); }
    var t0 = U.timer();
    var time = o.time !== undefined ? o.time : comp.time;
    var backend = opt(o, "backend");
    if (!BACKENDS[backend]) { throw new Error("SATSUEI analyze: unknown backend " + backend); }
    var snap = U.snapshotSwitches(comp);
    var rig = U.disableRig(comp);
    var ctx = { comp: comp, time: time, backend: backend, ana: null, probe: null };
    var timing = {}, bgImg, charImgs = [], compImg = null, i, tp;
    try {
      ctx.ana = makeAnalysisComp(comp, opt(o, "maxSide"));
      tp = U.timer();
      bgImg = pass(ctx, [R.background], o);
      timing.bgPass = tp();
      for (i = 0; i < R.characters.length; i++) {
        tp = U.timer();
        charImgs.push(pass(ctx, [R.characters[i]], o));
        timing["charPass" + (i + 1)] = tp();
      }
      if (o.withComp) {
        tp = U.timer();
        compImg = pass(ctx, null, o);
        timing.compPass = tp();
      }
    } finally {
      if (ctx.probe) { try { ctx.probe.layer.remove(); } catch (e0) { /* ignore */ } }
      if (ctx.ana) { removeItem(ctx.ana.comp); }
      U.restoreSwitches(comp, snap);
      U.restoreRig(comp, rig);
    }
    var acq = t0();
    var sopt = cfg.analysis || {};
    var ts = U.timer();
    var chars = [];
    for (i = 0; i < charImgs.length; i++) { chars.push({ id: "C" + (i + 1), alpha: charImgs[i].a }); }
    var bg = S.core.stats.analyzeBackground(bgImg, chars, sopt);
    timing.bgStats = ts();
    var charStats = [];
    for (i = 0; i < charImgs.length; i++) {
      ts = U.timer();
      var cs = S.core.stats.analyzeCharacter(charImgs[i], sopt);
      cs.samples = S.core.stats.charSamples(charImgs[i], sopt.coreAlpha || 0.95, sopt.charSamples || 4096);
      cs.layer = { name: R.characters[i].name, index: R.characters[i].index, id: U.layerId(R.characters[i]), tag: S.ae.roles.charTag(R.characters[i], i + 1) };
      charStats.push(cs);
      timing["charStats" + (i + 1)] = ts();
    }
    var cls = S.core.classify.classify(bg, cfg.classifier || {});
    var rolesDesc = S.ae.roles.describe(R);
    var out = {
      version: S.VERSION,
      backend: backend,
      comp: { name: comp.name, w: comp.width, h: comp.height, time: time, analysisW: bgImg.w, analysisH: bgImg.h },
      roles: rolesDesc,
      inputHash: inputHash(comp, rolesDesc, time, o),
      background: bg,
      characters: charStats,
      classification: cls,
      timingMs: { acquisition: acq, total: t0(), detail: timing }
    };
    if (compImg && o.returnComp) { out.compImage = compImg; }
    if (o.returnImages) { out.images = { bg: bgImg, chars: charImgs }; }
    return out;
  }

  S.ae.analyze = { DEFAULTS: DEFAULTS, analyze: analyze, makeAnalysisComp: makeAnalysisComp, BACKENDS: BACKENDS };
  S.analyze = analyze;
}());
