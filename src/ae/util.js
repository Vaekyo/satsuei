/*
 * SATSUEI ae/util - small AE-DOM helpers shared by the engine (ExtendScript only).
 */
(function () {
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.ae = S.ae || {};

  var PREFIX = "SATSUEI";

  function isRigName(name) { return String(name).indexOf(PREFIX) === 0; }

  function layers(comp) {
    var out = [], i;
    for (i = 1; i <= comp.numLayers; i++) { out.push(comp.layer(i)); }
    return out;
  }

  function contains(arr, v) {
    var i;
    for (i = 0; i < arr.length; i++) { if (arr[i] === v) { return true; } }
    return false;
  }

  /** Layer id where available (AE 22+, verify), else null. */
  function layerId(layer) {
    try { return layer.id; } catch (e) { return null; }
  }

  /** Re-find a layer in comp by id (preferred) or by index fallback. */
  function findLayer(comp, id, index) {
    var i;
    if (id !== null && id !== undefined) {
      for (i = 1; i <= comp.numLayers; i++) {
        try { if (comp.layer(i).id === id) { return comp.layer(i); } } catch (e) { break; }
      }
    }
    if (index && index <= comp.numLayers) { return comp.layer(index); }
    return null;
  }

  /** Snapshot of per-layer switches we touch during analysis. */
  function snapshotSwitches(comp) {
    var snap = [], i, L;
    for (i = 1; i <= comp.numLayers; i++) {
      L = comp.layer(i);
      snap.push({ index: i, id: layerId(L), solo: L.solo, enabled: L.enabled });
    }
    return snap;
  }

  function restoreSwitches(comp, snap) {
    var k, L, rec;
    for (k = 0; k < snap.length; k++) {
      rec = snap[k];
      L = findLayer(comp, rec.id, rec.index);
      if (!L) { continue; }
      try { if (L.enabled !== rec.enabled) { L.enabled = rec.enabled; } } catch (e1) { /* locked */ }
      try { if (L.solo !== rec.solo) { L.solo = rec.solo; } } catch (e2) { /* video off */ }
    }
  }

  /**
   * Disable every SATSUEI layer and every SATSUEI effect on other layers, so analysis
   * measures the un-rigged comp (gotcha 18). Returns an undo record for restoreRig().
   */
  function disableRig(comp) {
    var rec = { layers: [], effects: [] }, i, j, L, fx, parade;
    for (i = 1; i <= comp.numLayers; i++) {
      L = comp.layer(i);
      if (isRigName(L.name)) {
        if (L.enabled) { rec.layers.push({ id: layerId(L), index: i }); L.enabled = false; }
        continue;
      }
      parade = L.property("ADBE Effect Parade");
      if (!parade) { continue; }
      for (j = 1; j <= parade.numProperties; j++) {
        fx = parade.property(j);
        if (isRigName(fx.name) && fx.enabled) {
          rec.effects.push({ id: layerId(L), index: i, fx: j });
          fx.enabled = false;
        }
      }
    }
    return rec;
  }

  function restoreRig(comp, rec) {
    var k, L, r;
    for (k = 0; k < rec.layers.length; k++) {
      r = rec.layers[k];
      L = findLayer(comp, r.id, r.index);
      if (L) { L.enabled = true; }
    }
    for (k = 0; k < rec.effects.length; k++) {
      r = rec.effects[k];
      L = findLayer(comp, r.id, r.index);
      if (L) {
        try { L.property("ADBE Effect Parade").property(r.fx).enabled = true; } catch (e) { /* removed */ }
      }
    }
  }

  /** Solo exactly `want` (array of layers); everything else un-soloed. */
  function soloOnly(comp, want) {
    var i, L;
    for (i = 1; i <= comp.numLayers; i++) {
      L = comp.layer(i);
      try { L.solo = contains(want, L); } catch (e) { /* cannot solo (no video) */ }
    }
  }

  function unsoloAll(comp) {
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
      try { comp.layer(i).solo = false; } catch (e) { /* ignore */ }
    }
  }

  /**
   * Poll until a file exists and its size is stable (saveFrameToPng returns before the
   * PNG is fully written - gotcha 14).
   */
  function waitForFile(f, timeoutMs) {
    var t0 = new Date().getTime(), last = -1, len;
    while (new Date().getTime() - t0 < timeoutMs) {
      if (f.exists) {
        len = f.length;
        if (len > 0 && len === last) { return true; }
        last = len;
      }
      $.sleep(40);
    }
    return false;
  }

  function readBinary(f) {
    f.encoding = "BINARY";
    if (!f.open("r")) { throw new Error("SATSUEI: cannot open " + f.fsName); }
    var s = f.read();
    f.close();
    return s;
  }

  function readText(f) {
    f.encoding = "UTF-8";
    if (!f.open("r")) { throw new Error("SATSUEI: cannot open " + f.fsName); }
    var s = f.read();
    f.close();
    return s;
  }

  function writeText(f, text) {
    f.encoding = "UTF-8";
    if (!f.open("w")) { throw new Error("SATSUEI: cannot write " + f.fsName); }
    f.write(text);
    f.close();
  }

  /** Unique temp file under ~/Satsuei/tmp (Folder.temp is sandboxed on macOS). */
  function tempFile(stem, ext) {
    var dir = S.ae.env.userFolder("tmp");
    var name = stem + "_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1e6) + ext;
    return new File(dir.fsName + "/" + name);
  }

  function timer() {
    var t0 = new Date().getTime();
    return function () { return new Date().getTime() - t0; };
  }

  S.ae.util = {
    PREFIX: PREFIX,
    isRigName: isRigName,
    layers: layers,
    contains: contains,
    layerId: layerId,
    findLayer: findLayer,
    snapshotSwitches: snapshotSwitches,
    restoreSwitches: restoreSwitches,
    disableRig: disableRig,
    restoreRig: restoreRig,
    soloOnly: soloOnly,
    unsoloAll: unsoloAll,
    waitForFile: waitForFile,
    readBinary: readBinary,
    readText: readText,
    writeText: writeText,
    tempFile: tempFile,
    timer: timer
  };
}());
