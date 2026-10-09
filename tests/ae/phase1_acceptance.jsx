/*
 * Phase 1 acceptance, AE side. Run on a machine with After Effects:
 *
 *   npm run assets                                   (generates the backgrounds)
 *   node tools/ae.js run tests/ae/phase1_acceptance.jsx --timeout 900 \
 *        --args '{"backends":["png","probe","rq"],"scenes":["day_sky","night_street"]}'
 *   node tools/compare_ref.js                        (checks against the Node reference)
 *
 * Builds one comp per scene in a "SATSUEI TEST" folder of the open project (BG + the
 * brunette_red cel placed exactly like tools/lib/comp.js defaultPlacement), runs
 * SATSUEI.analyze with each backend, writes tests/out/ae/phase1/<scene>__<backend>.json,
 * then removes everything it created (pass "keep": true to inspect).
 */
(function () {
  var R = $.global.SATSUEI_RUN;
  $.evalFile(new File(R.root + "/dist/satsuei_engine.jsx"));
  var S = $.global.SATSUEI;
  var U = S.ae.util;
  var args = R.args || {};
  var backends = args.backends || ["png", "probe", "rq"];
  var scenes = args.scenes || ["day_sky", "golden_hour", "night_street", "neon_alley", "overcast_rain", "black", "white"];
  var charName = args.character || "brunette_red";
  var cfg = S.json.parse(U.readText(new File(R.root + "/config/defaults.json")));
  var outDir = new Folder(R.root + "/tests/out/ae/phase1");
  if (!outDir.exists) { outDir.create(); }

  function importFootage(path, straight) {
    var f = new File(path);
    if (!f.exists) { throw new Error("missing asset " + path + " (run npm run assets)"); }
    var item = app.project.importFile(new ImportOptions(f));
    if (straight) {
      try { item.mainSource.alphaMode = AlphaMode.STRAIGHT; } catch (e) { R.log("alphaMode: " + e); }
    }
    return item;
  }

  var created = [];
  var results = [];
  app.beginUndoGroup("SATSUEI phase 1 acceptance");
  try {
    var folder = app.project.items.addFolder(U.PREFIX + " TEST");
    created.push(folder);
    var ch = importFootage(R.root + "/test_assets/synthetic/characters/" + charName + ".png", true);
    ch.parentFolder = folder;
    var p = cfg.testPlacement;
    var i, b, comp, bgItem, bgL, chL, s, x0, y0, res, f, rec;
    for (i = 0; i < scenes.length; i++) {
      bgItem = importFootage(R.root + "/test_assets/synthetic/backgrounds/" + scenes[i] + ".png", false);
      bgItem.parentFolder = folder;
      comp = app.project.items.addComp("SATSUEI TEST " + scenes[i], 1920, 1080, 1, 1, 24);
      comp.parentFolder = folder;
      bgL = comp.layers.add(bgItem);
      chL = comp.layers.add(ch);
      s = p.heightFrac * 1080 / ch.height;
      x0 = p.centerX * 1920 - ch.width * s / 2;
      y0 = p.bottom * 1080 - ch.height * s;
      chL.property("ADBE Transform Group").property("ADBE Scale").setValue([s * 100, s * 100]);
      chL.property("ADBE Transform Group").property("ADBE Position").setValue([x0 + ch.width * s / 2, y0 + ch.height * s / 2]);
      try { chL.quality = LayerQuality.BEST; bgL.quality = LayerQuality.BEST; } catch (eq) { /* ignore */ }
      for (b = 0; b < backends.length; b++) {
        rec = { scene: scenes[i], backend: backends[b] };
        try {
          res = S.analyze(comp, { characters: [chL], background: bgL, foreground: [], reference: null, mattes: [], notes: [] },
            { backend: backends[b], maxSide: cfg.analysis.maxSide, time: 0, config: cfg });
          f = new File(outDir.fsName + "/" + scenes[i] + "__" + backends[b] + ".json");
          U.writeText(f, S.json.stringify(res));
          rec.ok = true;
          rec.cls = res.classification.cls;
          rec.timingMs = res.timingMs;
        } catch (err) {
          rec.ok = false;
          rec.error = String(err.message || err) + (err.line ? " (line " + err.line + ")" : "");
        }
        results.push(rec);
      }
      created.push(comp);
      created.push(bgItem);
    }
    created.push(ch);
  } finally {
    if (!args.keep) {
      for (i = created.length - 1; i >= 0; i--) {
        try { created[i].remove(); } catch (e2) { /* ignore */ }
      }
    }
    app.endUndoGroup();
  }
  R.result = { aeVersion: app.version, results: results };
}());
