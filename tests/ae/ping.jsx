/*
 * Bridge smoke test: node tools/ae.js run tests/ae/ping.jsx
 * Loads the bundled engine, reports the environment and a JSON round trip.
 */
(function () {
  var R = $.global.SATSUEI_RUN;
  $.evalFile(new File(R.root + "/dist/satsuei_engine.jsx"));
  var S = $.global.SATSUEI;
  var sample = { a: [1, 2.5, -0.125], s: "satsuei", n: null, t: true };
  var back = S.json.parse(S.json.stringify(sample));
  R.result = {
    env: S.ae.env.info(),
    roundTripOk: S.json.stringify(back) === S.json.stringify(sample),
    effectsCount: app.effects.length,
    projectItems: app.project ? app.project.numItems : null,
    srgbToLinearHalf: S.core.color.srgbToLinear(0.5)
  };
}());
