/*
 * SATSUEI ae/env - host environment facts (AE version, project bit depth, color
 * management, scripting-file-access preference, user folders).
 *
 * Everything here touches the AE DOM, so it is ExtendScript-only (no Node tests).
 * Facts marked (verify) are best knowledge until a probe on a real AE confirms them;
 * record probe results in docs/DECISIONS.md.
 */
(function () {
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.ae = S.ae || {};

  var MIN_MAJOR = 23; // AE 2023: "any layer as track matte" (AVLayer.setTrackMatte) (verify)

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  /** "26.5.0x12" -> { major: 26, minor: 5, full: "26.5.0x12" } */
  function parseVersion(v) {
    var m = /^(\d+)\.(\d+)/.exec(String(v));
    return {
      full: String(v),
      major: m ? parseInt(m[1], 10) : 0,
      minor: m ? parseInt(m[2], 10) : 0
    };
  }

  function osName() {
    return ($.os.toLowerCase().indexOf("windows") >= 0) ? "win" : "mac";
  }

  /**
   * "Allow Scripts to Write Files and Access Network". Returns true / false, or
   * null when it cannot be read. Section name changed across versions (verify).
   */
  function fileAccessAllowed() {
    var v = null;
    var sections = ["Main Pref Section v2", "Main Pref Section"];
    var i;
    for (i = 0; i < sections.length && v === null; i++) {
      v = safe(function () {
        return app.preferences.getPrefAsLong(sections[i], "Pref_SCRIPTING_FILE_NETWORK_SECURITY",
          PREFType.PREF_Type_MACHINE_INDEPENDENT);
      }, null);
      if (v === null) {
        v = safe(function () {
          return app.preferences.getPrefAsLong(sections[i], "Pref_SCRIPTING_FILE_NETWORK_SECURITY");
        }, null);
      }
    }
    if (v === null) { return null; }
    return v === 1;
  }

  /** Project color settings; any field AE does not expose comes back null. */
  function projectColor() {
    var p = app.project;
    return {
      bitsPerChannel: safe(function () { return p.bitsPerChannel; }, null),
      linearBlending: safe(function () { return p.linearBlending; }, null),
      workingSpace: safe(function () { return p.workingSpace; }, null),
      workingGamma: safe(function () { return p.workingGamma; }, null),
      linearizeWorkingSpace: safe(function () { return p.linearizeWorkingSpace; }, null),
      colorManagementSystem: safe(function () { return p.colorManagementSystem; }, null), // 0 Adobe, 1 OCIO (verify)
      ocioConfigurationFile: safe(function () { return p.ocioConfigurationFile; }, null)
    };
  }

  /** ~/Satsuei (shared with Node tools; Folder.temp is sandboxed on macOS). */
  function homePath() {
    // Must equal Node's os.homedir() so tools and scripts agree on ~/Satsuei.
    return $.getenv("USERPROFILE") || $.getenv("HOME") || Folder.myDocuments.parent.fsName;
  }

  function userFolder(sub) {
    var f = new Folder(homePath() + "/Satsuei" + (sub ? "/" + sub : ""));
    if (!f.exists) { f.create(); }
    return f;
  }

  function info() {
    var ver = parseVersion(app.version);
    return {
      satsuei: S.VERSION || "dev",
      aeVersion: ver.full,
      aeMajor: ver.major,
      aeMinor: ver.minor,
      buildName: safe(function () { return app.buildName; }, null),
      language: safe(function () { return String(app.isoLanguage); }, null),
      os: osName(),
      osString: $.os,
      engine: safe(function () { return app.project.expressionEngine; }, null),
      supported: ver.major >= MIN_MAJOR,
      fileAccess: fileAccessAllowed(),
      color: projectColor()
    };
  }

  S.ae.env = {
    MIN_MAJOR: MIN_MAJOR,
    parseVersion: parseVersion,
    osName: osName,
    fileAccessAllowed: fileAccessAllowed,
    projectColor: projectColor,
    homePath: homePath,
    userFolder: userFolder,
    info: info
  };
}());
