"use strict";
// ESLint flat config.
// - src/**, tools/**/*.jsx, tests/ae/** are ExtendScript (ES3) and must parse as ES3
//   and avoid ES5+ built-ins (eslint-plugin-es-x restrict-to-es3).
// - tools/**/*.js and tests/node/** are Node (modern JS, CommonJS).

const js = require("@eslint/js");
const esx = require("eslint-plugin-es-x");
const globals = require("globals");

// ExtendScript / After Effects host globals.
const extendscriptGlobals = {
  $: "readonly", app: "readonly", system: "readonly",
  File: "readonly", Folder: "readonly", Socket: "readonly", XML: "readonly", UnitValue: "readonly",
  Window: "readonly", Panel: "readonly", ScriptUI: "readonly",
  alert: "readonly", confirm: "readonly", prompt: "readonly", writeLn: "readonly", clearOutput: "readonly",
  isValid: "readonly",
  CompItem: "readonly", FootageItem: "readonly", FolderItem: "readonly",
  AVLayer: "readonly", ShapeLayer: "readonly", TextLayer: "readonly", CameraLayer: "readonly", LightLayer: "readonly",
  Property: "readonly", PropertyGroup: "readonly", MaskPropertyGroup: "readonly",
  PropertyType: "readonly", PropertyValueType: "readonly",
  KeyframeInterpolationType: "readonly", BlendingMode: "readonly", TrackMatteType: "readonly",
  ImportOptions: "readonly", ImportAsType: "readonly", MaskMode: "readonly", Shape: "readonly",
  LayerQuality: "readonly", ParagraphJustification: "readonly", AutoOrientType: "readonly",
  RQItemStatus: "readonly", GetSettingsFormat: "readonly", PostRenderAction: "readonly",
  FrameBlendingType: "readonly", ResolveType: "readonly", TimeDisplayType: "readonly",
  ToolType: "readonly", PREFType: "readonly", PurposeFlag: "readonly",
  // UMD wrapper of src/core lets Node require() the same files.
  module: "readonly", require: "readonly",
  SATSUEI: "writable"
};

// Things ES3 *parses* fine but ExtendScript lacks. es-x catches most of them only when
// the receiver is provably an array, so also ban the method names outright.
const BAN_MSG = "Not available in ExtendScript (ES3). Use a SATSUEI helper.";
const es5MethodBan = [
  ...["forEach", "map", "filter", "reduce", "reduceRight", "some", "every", "trim", "bind", "toISOString"]
    .map((p) => ({ property: p, message: BAN_MSG })),
  ...[["Object", "keys"], ["Object", "create"], ["Object", "defineProperty"], ["Object", "freeze"],
    ["Object", "getPrototypeOf"], ["Array", "isArray"], ["Date", "now"]]
    .map(([o, p]) => ({ object: o, property: p, message: BAN_MSG }))
];

module.exports = [
  {
    ignores: ["node_modules/**", "dist/**", "tests/out/**", "native/**", "test_assets/**", "catalog/**"]
  },
  {
    files: ["**/*.js"],
    ...js.configs.recommended
  },
  {
    files: ["eslint.config.js", "tools/**/*.js", "tests/node/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: { ...globals.node } },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }]
    }
  },
  {
    files: ["src/**/*.js", "src/**/*.jsx", "tools/**/*.jsx", "tests/ae/**/*.jsx"],
    languageOptions: {
      ecmaVersion: 3,
      sourceType: "script",
      globals: { ...globals.es3, ...extendscriptGlobals }
    },
    plugins: { "es-x": esx },
    rules: {
      ...js.configs.recommended.rules,
      ...esx.configs["flat/restrict-to-es3"].rules,
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", vars: "local" }],
      "no-restricted-properties": ["error", ...es5MethodBan],
      "no-restricted-globals": ["error", { name: "JSON", message: "Use SATSUEI.json (ExtendScript has no JSON)." }],
      "no-var": "off",
      "no-redeclare": "error",
      "no-implicit-globals": "off",
      "no-prototype-builtins": "off",
      // ES3: no getters/setters, no trailing commas (parser enforces most of it).
      "comma-dangle": "off"
    }
  }
];
