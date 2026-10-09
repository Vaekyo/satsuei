/*
 * SATSUEI ae/roles - role detection (sec. 6.1): characters, background, foreground
 * (BOOK), reference. ExtendScript only.
 *
 * Auto-detection when the user has not set roles:
 *   - characters: selected (else all) visible AV layers with alpha and partial coverage
 *   - background: the lowest full-frame opaque layer
 *   - foreground: layers named like book / fg / front / temae ("\u624b\u524d")
 *   - a character with a track matte brings its matte layer along
 */
(function () {
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.ae = S.ae || {};
  var U = S.ae.util;

  var FG_RE = /(^|[^a-z])(book|fg|front|foreground)([^a-z]|$)|\u624b\u524d/i;

  function isAV(L) {
    return (L instanceof AVLayer) && L.hasVideo && !U.isRigName(L.name) && !L.guideLayer && !L.adjustmentLayer;
  }

  function hasAlpha(L) {
    try { return !!(L.source && L.source.hasAlpha); } catch (e) { return false; }
  }

  /** Does the layer cover the whole comp at time t (by its source rect in comp space)? */
  function coversFrame(L, comp, t) {
    var r, tl, br;
    try {
      r = L.sourceRectAtTime(t, false);
      tl = L.sourcePointToComp ? L.sourcePointToComp([r.left, r.top]) : null;
      br = L.sourcePointToComp ? L.sourcePointToComp([r.left + r.width, r.top + r.height]) : null;
      if (!tl || !br) { return r.width >= comp.width && r.height >= comp.height; }
      return Math.min(tl[0], br[0]) <= 0.5 && Math.min(tl[1], br[1]) <= 0.5 &&
        Math.max(tl[0], br[0]) >= comp.width - 0.5 && Math.max(tl[1], br[1]) >= comp.height - 0.5;
    } catch (e) {
      return false;
    }
  }

  function matteOf(L) {
    try { if (L.trackMatteLayer) { return L.trackMatteLayer; } } catch (e) { /* < AE 23 */ }
    try {
      if (L.hasTrackMatte && L.index > 1) { return L.containingComp.layer(L.index - 1); } // legacy adjacent matte
    } catch (e2) { /* ignore */ }
    return null;
  }

  /**
   * detect(comp, explicit) -> { characters: [Layer], background: Layer|null,
   *   foreground: [Layer], reference: Layer|null, mattes: [Layer], notes: [] }
   * explicit (optional) entries override detection.
   */
  function detect(comp, explicit) {
    var ex = explicit || {}, t = comp.time, notes = [];
    var all = U.layers(comp), i, L;
    var bg = ex.background || null;
    if (!bg) {
      for (i = all.length - 1; i >= 0; i--) {
        L = all[i];
        if (isAV(L) && L.enabled && !hasAlpha(L) && coversFrame(L, comp, t)) { bg = L; break; }
      }
      if (!bg) {
        for (i = all.length - 1; i >= 0; i--) {
          L = all[i];
          if (isAV(L) && L.enabled && coversFrame(L, comp, t)) { bg = L; notes.push("background has alpha; using it anyway"); break; }
        }
      }
    }
    var fg = ex.foreground || [];
    if (!ex.foreground) {
      for (i = 0; i < all.length; i++) {
        if (isAV(all[i]) && FG_RE.test(all[i].name) && all[i] !== bg) { fg.push(all[i]); }
      }
    }
    var chars = ex.characters || [];
    var mattes = [];
    if (!ex.characters) {
      var pool = comp.selectedLayers && comp.selectedLayers.length ? comp.selectedLayers : all;
      for (i = 0; i < pool.length; i++) {
        L = pool[i];
        if (!isAV(L) || L === bg || U.contains(fg, L) || !L.enabled) { continue; }
        try { if (L.isTrackMatte) { continue; } } catch (e) { /* ignore */ }
        if (hasAlpha(L) || matteOf(L) || !coversFrame(L, comp, t)) { chars.push(L); }
      }
    }
    for (i = 0; i < chars.length; i++) {
      var m = matteOf(chars[i]);
      if (m) { mattes.push(m); }
    }
    if (!bg) { notes.push("no background found: select a full-frame layer as Background"); }
    if (!chars.length) { notes.push("no character found: select the character layer(s)"); }
    return { characters: chars, background: bg, foreground: fg, reference: ex.reference || null, mattes: mattes, notes: notes };
  }

  /** ASCII-safe short id for a character's helper layer names (sec. 6.6). */
  function charTag(layer, n) {
    var nm = String(layer.name);
    if (/^[A-Za-z0-9 _-]{1,24}$/.test(nm)) { return nm; }
    return "C" + n;
  }

  /** JSON-able description of a roles object (for metadata / hashing). */
  function describe(roles) {
    function d(L) { return L ? { name: L.name, index: L.index, id: U.layerId(L) } : null; }
    var out = { characters: [], background: d(roles.background), foreground: [], reference: d(roles.reference) }, i;
    for (i = 0; i < roles.characters.length; i++) { out.characters.push(d(roles.characters[i])); }
    for (i = 0; i < roles.foreground.length; i++) { out.foreground.push(d(roles.foreground[i])); }
    return out;
  }

  S.ae.roles = { detect: detect, charTag: charTag, describe: describe, matteOf: matteOf, coversFrame: coversFrame };
}());
