/*
 * SATSUEI ui/strings - every user-visible string. ASCII source only: non-ASCII text
 * is written as \uXXXX escapes (gotcha 7, avoids .jsx encoding problems).
 */
(function () {
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.ui = S.ui || {};

  var TABLE = {
    en: {
      title: "SATSUEI \u64ae\u5f71",
      tagline: "Auto-compositing & look toolkit",
      engineLoaded: "Engine loaded.",
      notYet: "AUTO COMP arrives in Phase 2. Use Tools > Environment to check your setup.",
      envButton: "Environment",
      unsupported: "After Effects %1 is older than the minimum (AE 2023 / 23.0).",
      fileAccessOff: "Enable Settings > Scripting & Expressions > \"Allow Scripts to Write Files and Access Network\", then reopen this panel."
    },
    ja: {},
    id: {}
  };

  var lang = "en";

  /** t("key", arg1, ...) - %1, %2 ... are replaced by args. Falls back to English. */
  function t(key) {
    var s = (TABLE[lang] && TABLE[lang][key] !== undefined) ? TABLE[lang][key] : TABLE.en[key];
    var i;
    if (s === undefined) { return key; }
    for (i = 1; i < arguments.length; i++) {
      s = s.split("%" + i).join(String(arguments[i]));
    }
    return s;
  }

  function setLanguage(code) { if (TABLE[code]) { lang = code; } }

  S.ui.strings = { t: t, setLanguage: setLanguage, TABLE: TABLE };
}());
