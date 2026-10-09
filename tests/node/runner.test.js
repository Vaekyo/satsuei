"use strict";
// Exercises the run-in-AE wrapper protocol in a simulated ExtendScript host
// (mock File / $ / app). The real launch (AfterFX -r / osascript) needs AE.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const espree = require("espree");
const { wrapperSource, versionFromName } = require("../../tools/ae.js");

function host() {
  const sandbox = { Math, Date, Error, String, Number, Array, Object, RegExp, parseInt, parseFloat, isFinite };
  class File {
    constructor(p) { this.fsName = p; this.encoding = "UTF-8"; this._buf = ""; }
    get exists() { return fs.existsSync(this.fsName); }
    get name() { return path.basename(this.fsName); }
    open(mode) { this._mode = mode; this._buf = ""; return true; }
    write(s) { this._buf += s; return true; }
    close() { if (this._mode === "w") fs.writeFileSync(this.fsName, this._buf); return true; }
    remove() { fs.unlinkSync(this.fsName); return true; }
    rename(n) { const d = path.join(path.dirname(this.fsName), n); fs.renameSync(this.fsName, d); this.fsName = d; return true; }
  }
  sandbox.File = File;
  sandbox.app = { beginSuppressDialogs() {}, endSuppressDialogs() {} };
  sandbox.$ = {
    global: sandbox,
    evalFile: (f) => vm.runInContext(fs.readFileSync(f.fsName, "utf8").replace(/^\uFEFF/, ""), sandbox, { filename: f.fsName })
  };
  vm.createContext(sandbox);
  return sandbox;
}

function runWrapper(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "satsuei-run-"));
  const resultPath = path.join(dir, "result.json");
  const src = wrapperSource({ id: "t1", resultPath, ...opts });
  espree.parse(src, { ecmaVersion: 3, sourceType: "script" }); // wrapper itself must be ES3
  vm.runInContext(src, host());
  const res = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.ok(!fs.existsSync(resultPath + ".tmp"), "tmp file renamed away");
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

test("wrapper returns SATSUEI_RUN.result and args round-trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "satsuei-target-"));
  const target = path.join(dir, "t.jsx");
  fs.writeFileSync(target, "var R = $.global.SATSUEI_RUN; R.log('hello'); R.result = { sum: R.args.a + R.args.b, s: R.args.s };");
  const res = runWrapper({ target, args: { a: 2, b: 3, s: "日本" } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.result, { sum: 5, s: "日本" });
  assert.deepEqual(res.logs, ["hello"]);
  assert.equal(typeof res.ms, "number");
});

test("wrapper captures thrown errors", () => {
  const res = runWrapper({ code: "throw new Error('boom');" });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /boom/);
});

test("wrapper returns the value of inline code", () => {
  const res = runWrapper({ code: "var x = 20; ({ answer: x + 22 })" });
  assert.deepEqual(res.result, { answer: 42 });
});

test("version parsing from install folder names", () => {
  assert.deepEqual(versionFromName("Adobe After Effects 2026"), { label: "2026", major: 26 });
  assert.deepEqual(versionFromName("Adobe After Effects 2023"), { label: "2023", major: 23 });
  assert.equal(versionFromName("Adobe After Effects (Beta)").major, 99);
  assert.equal(versionFromName("Adobe Premiere Pro 2026"), null);
});
