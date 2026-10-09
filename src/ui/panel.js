/*
 * SATSUEI ui/panel - ScriptUI front-end. Phase 0: bootstrap shell only (shows the
 * engine is loaded and reports the environment). The full tabbed panel is Phase 2/5.
 */
(function () {
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.ui = S.ui || {};

  function create(thisObj) {
    var t = S.ui.strings.t;
    var isPanel = (typeof Panel !== "undefined") && (thisObj instanceof Panel);
    var w = isPanel ? thisObj : new Window("palette", t("title"), undefined, { resizeable: true });
    w.orientation = "column";
    w.alignChildren = ["fill", "top"];
    w.spacing = 6;
    w.margins = 10;

    var head = w.add("statictext", undefined, t("title") + "  v" + (S.VERSION || "dev"));
    head.graphics.font = ScriptUI.newFont(head.graphics.font.name, "BOLD", 14);
    w.add("statictext", undefined, t("tagline"));
    var msg = w.add("statictext", undefined, t("engineLoaded") + " " + t("notYet"), { multiline: true });
    msg.preferredSize = [260, 48];

    var envBtn = w.add("button", undefined, t("envButton"));
    envBtn.onClick = function () {
      var info = S.ae.env.info();
      var lines = [S.json.stringify(info, 2)];
      if (!info.supported) { lines.unshift(t("unsupported", info.aeVersion)); }
      if (info.fileAccess === false) { lines.unshift(t("fileAccessOff")); }
      alert(lines.join("\n\n"), t("title"));
    };

    w.onResizing = w.onResize = function () { this.layout.resize(); };
    if (w instanceof Window) {
      w.center();
      w.show();
    } else {
      w.layout.layout(true);
    }
    return w;
  }

  S.ui.panel = { create: create };
}());
