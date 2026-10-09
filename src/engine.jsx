//@target aftereffects
/*
 * SATSUEI engine (no UI). Include this from test scripts and batch tools.
 * Dev: //@include paths resolve relative to this file. Dist: tools/bundle.js
 * inlines every include into one file.
 */
//@include "lib/json2.js"
//@include "core/color.js"
//@include "core/linalg.js"
//@include "core/halton.js"
//@include "core/png.js"
//@include "core/stats.js"
//@include "core/fxmodel.js"
//@include "core/transfer.js"
//@include "core/classify.js"
//@include "ae/env.js"
//@include "ae/util.js"
//@include "ae/roles.js"
//@include "ae/analyze.js"

(function () {
  var S = $.global.SATSUEI;
  S.VERSION = "0.1.0-dev";
}());
