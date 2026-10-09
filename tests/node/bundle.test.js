"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const espree = require("espree");
const { build } = require("../../tools/bundle.js");

const SRC = path.join(__dirname, "..", "..", "src");

test("every file under src/ is ASCII (gotcha 7)", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(SRC)) {
    const buf = fs.readFileSync(f);
    const i = buf.findIndex((b) => b > 0x7f);
    assert.equal(i, -1, `${path.relative(SRC, f)} has a non-ASCII byte at ${i}`);
  }
});

test("bundles parse as ES3 and load in a simulated ExtendScript global", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "satsuei-bundle-"));
  const res = build({ outDir: out, quiet: true });
  for (const r of res) {
    const text = fs.readFileSync(r.out, "utf8");
    espree.parse(text, { ecmaVersion: 3, sourceType: "script" });
  }
  const engine = fs.readFileSync(path.join(out, "satsuei_engine.jsx"), "utf8");
  const sandbox = { Math, Date, Error, String, Number, Array, Object, RegExp, parseInt, parseFloat, isFinite };
  sandbox.$ = { global: sandbox, os: "Windows/64 10.0", getenv: () => null };
  vm.createContext(sandbox);
  vm.runInContext(engine, sandbox);
  const S = sandbox.SATSUEI;
  assert.ok(S, "SATSUEI global defined");
  assert.match(S.VERSION, /^\d+\.\d+\.\d+\+/);
  for (const k of ["color", "linalg", "halton", "png"]) assert.equal(typeof S.core[k], "object", k);
  assert.equal(typeof S.json.parse, "function");
  assert.equal(typeof S.ae.env.info, "function");
  assert.equal(S.json.stringify({ a: [1] }), "{\"a\":[1]}");
  assert.ok(Math.abs(S.core.color.srgbToLinear(1) - 1) < 1e-12);
  fs.rmSync(out, { recursive: true, force: true });
});
