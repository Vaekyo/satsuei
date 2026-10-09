#!/usr/bin/env node
"use strict";
// Talk to After Effects from the terminal (dev-only tooling, Node 20+).
//
//   node tools/ae.js doctor                      environment report (exit 0 = clean)
//   node tools/ae.js run <script.jsx> [--args '{"k":1}'] [--timeout 120] [--ae 2026]
//   node tools/ae.js eval "<extendscript code>" [--timeout 60]
//   node tools/ae.js render --project p.aep [--comp "Name" --frame 0 --out f.png] [--rqindex 1]
//   node tools/ae.js paths                       JSON of detected install paths
//
// run/eval: writes a wrapper .jsx into tests/out/run/<id>/ that loads SATSUEI.json,
// evaluates the target with dialogs suppressed, and writes result.json atomically.
// The target hands back data by returning a value (last expression) or by setting
// $.global.SATSUEI_RUN.result; SATSUEI_RUN.args holds --args, SATSUEI_RUN.root the
// repo root (load the engine with $.evalFile(root + "/dist/satsuei_engine.jsx");
// run rebuilds dist/ first). Launch mechanism:
//   Windows: AfterFX.exe -r <wrapper>            (verify)
//   macOS:   osascript ... DoScriptFile <wrapper> (verify)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tests", "out");

/* ----------------------------- discovery ----------------------------- */

function versionFromName(name) {
  // "Adobe After Effects 2026" -> major 26; "Adobe After Effects (Beta)" -> 99 (sorts newest)
  let m = /After Effects (\d{4})$/.exec(name);
  if (m) return { label: m[1], major: Number(m[1]) - 2000 };
  m = /After Effects CC (\d{4})$/.exec(name);
  if (m) return { label: `CC ${m[1]}`, major: Number(m[1]) - 2000 - 3 }; // CC 2019 = 16.x
  if (/\(Beta\)$/.test(name)) return { label: "Beta", major: 99 };
  return null;
}

function findInstalls() {
  const found = [];
  const plat = process.platform;
  if (plat === "win32") {
    const roots = [process.env.ProgramFiles, "C:\\Program Files"].filter(Boolean);
    for (const r of [...new Set(roots)]) {
      const adobe = path.join(r, "Adobe");
      if (!fs.existsSync(adobe)) continue;
      for (const d of fs.readdirSync(adobe)) {
        const v = versionFromName(d);
        if (!v) continue;
        const sf = path.join(adobe, d, "Support Files");
        const exe = path.join(sf, "AfterFX.exe");
        if (!fs.existsSync(exe)) continue;
        found.push({
          name: d, ...v, dir: path.join(adobe, d), app: exe,
          aerender: path.join(sf, "aerender.exe"),
          panels: path.join(sf, "Scripts", "ScriptUI Panels")
        });
      }
    }
  } else if (plat === "darwin") {
    const apps = "/Applications";
    for (const d of fs.existsSync(apps) ? fs.readdirSync(apps) : []) {
      const v = versionFromName(d);
      if (!v) continue;
      const dir = path.join(apps, d);
      const app = path.join(dir, `${d}.app`);
      if (!fs.existsSync(app)) continue;
      found.push({
        name: d, ...v, dir, app, appName: d,
        aerender: path.join(dir, "aerender"),
        panels: path.join(dir, "Scripts", "ScriptUI Panels")
      });
    }
  }
  found.sort((a, b) => b.major - a.major);
  return found;
}

function prefsDirs() {
  if (process.platform === "win32") {
    return [path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Adobe", "After Effects")];
  }
  if (process.platform === "darwin") {
    return [path.join(os.homedir(), "Library", "Preferences", "Adobe", "After Effects")];
  }
  return [];
}

/** Reads "Pref_SCRIPTING_FILE_NETWORK_SECURITY" from each version's Prefs.txt (verify key). */
function scriptingPrefs() {
  const res = [];
  for (const base of prefsDirs()) {
    if (!fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base)) {
      if (!/^\d+\.\d+$/.test(ver)) continue;
      const dir = path.join(base, ver);
      const file = fs.readdirSync(dir).find((f) => /Prefs\.txt$/.test(f) && !/indep/i.test(f));
      if (!file) continue;
      const txt = fs.readFileSync(path.join(dir, file), "latin1");
      const m = /"Pref_SCRIPTING_FILE_NETWORK_SECURITY"\s*=\s*(\d+)/.exec(txt);
      res.push({ version: ver, file: path.join(dir, file), fileAccess: m ? Number(m[1]) === 1 : null });
    }
  }
  return res;
}

function pickInstall(want) {
  const all = findInstalls();
  if (!all.length) return null;
  if (!want) return all[0];
  return all.find((i) => i.label === String(want) || String(i.major) === String(want)) || null;
}

/* ------------------------------- doctor ------------------------------ */

function doctor() {
  const lines = [];
  const problems = [];
  const ok = (s) => lines.push(`  ok   ${s}`);
  const bad = (s, fix) => { lines.push(`  FAIL ${s}`); problems.push(fix || s); };
  const info = (s) => lines.push(`  ..   ${s}`);

  lines.push("SATSUEI doctor");
  info(`OS: ${process.platform} ${os.release()} (${os.arch()})`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 20) ok(`Node ${process.versions.node}`); else bad(`Node ${process.versions.node} < 20`, "Install Node 20+");
  for (const dep of ["pngjs", "eslint"]) {
    try { require.resolve(dep, { paths: [ROOT] }); ok(`dev dependency ${dep}`); }
    catch { bad(`dev dependency ${dep} missing`, "Run npm install"); }
  }

  if (process.platform !== "win32" && process.platform !== "darwin") {
    bad("After Effects only runs on Windows and macOS; this machine cannot run AE, aerender or the bridge.",
      "Run AE-dependent steps (bridge, catalog, renders, calibration) on a Windows/macOS machine with AE installed.");
  } else {
    const inst = findInstalls();
    if (!inst.length) bad("No After Effects installation found", "Install After Effects 2023 (23.0) or newer");
    for (const i of inst) {
      const tag = i.major >= 23 ? "" : "  (below minimum 23.0)";
      info(`AE ${i.label} (major ${i.major})${tag}`);
      info(`     app      ${i.app}`);
      (fs.existsSync(i.aerender) ? ok : bad)(`     aerender ${i.aerender}`);
      info(`     panels   ${i.panels}`);
    }
    const prefs = scriptingPrefs();
    if (!prefs.length) info("No AE preference files found (AE never launched?)");
    for (const p of prefs) {
      if (p.fileAccess === true) ok(`AE ${p.version}: "Allow Scripts to Write Files and Access Network" is on`);
      else if (p.fileAccess === false) bad(`AE ${p.version}: "Allow Scripts to Write Files and Access Network" is OFF`,
        "In AE: Settings > Scripting & Expressions > enable \"Allow Scripts to Write Files and Access Network\"");
      else info(`AE ${p.version}: scripting file-access preference not found in ${p.file}`);
    }
  }
  const sat = path.join(os.homedir(), "Satsuei");
  info(`~/Satsuei: ${fs.existsSync(sat) ? sat : "(not created yet - created on first use)"}`);
  console.log(lines.join("\n"));
  if (problems.length) {
    console.log("\nTo fix:");
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log("\nDoctor is clean.");
  }
  return problems.length ? 2 : 0;
}

/* -------------------------------- run -------------------------------- */

function esPath(p) { return p.split(path.sep).join("/"); }

function wrapperSource({ id, resultPath, target, code, args }) {
  const J = JSON.stringify;
  return [
    "// generated by tools/ae.js - do not edit",
    "(function () {",
    `  var RESULT = ${J(esPath(resultPath))};`,
    `  var JSONLIB = ${J(esPath(path.join(ROOT, "src", "lib", "json2.js")))};`,
    `  var TARGET = ${J(target ? esPath(target) : null)};`,
    `  var CODE = ${J(code || null)};`,
    `  $.global.SATSUEI_RUN = { id: ${J(id)}, root: ${J(esPath(ROOT))}, args: ${J(args || {})}, result: null, logs: [],`,
    "    log: function (s) { this.logs.push(String(s)); } };",
    "  var R = $.global.SATSUEI_RUN;",
    "  var out = { id: R.id, ok: false, result: null };",
    "  var t0 = new Date().getTime();",
    "  var ret, text, tmp, dest;",
    "  try { app.beginSuppressDialogs(); } catch (e0) {}",
    "  try {",
    "    $.evalFile(new File(JSONLIB));",
    "    ret = TARGET ? $.evalFile(new File(TARGET)) : eval(CODE);",
    "    out.result = (R.result !== null) ? R.result : (ret === undefined ? null : ret);",
    "    out.ok = true;",
    "  } catch (e) {",
    "    out.error = { message: String(e && e.message ? e.message : e), line: (e && e.line) || null,",
    "      file: (e && e.fileName) ? String(e.fileName) : null };",
    "  }",
    "  try { app.endSuppressDialogs(false); } catch (e1) {}",
    "  out.ms = new Date().getTime() - t0;",
    "  out.logs = R.logs;",
    "  try { text = $.global.SATSUEI.json.stringify(out); }",
    "  catch (e2) { text = '{\"id\":\"' + R.id + '\",\"ok\":false,\"error\":{\"message\":\"result not serializable\"}}'; }",
    "  tmp = new File(RESULT + '.tmp');",
    "  tmp.encoding = 'UTF-8';",
    "  tmp.open('w'); tmp.write(text); tmp.close();",
    "  dest = new File(RESULT);",
    "  if (dest.exists) { dest.remove(); }",
    "  tmp.rename(dest.name);",
    "}());",
    ""
  ].join("\n");
}

function launch(inst, wrapper) {
  if (process.platform === "win32") {
    const child = spawn(inst.app, ["-r", wrapper], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }
  if (process.platform === "darwin") {
    const scpt = `tell application "${inst.appName}" to DoScriptFile "${esPath(wrapper)}"`;
    const child = spawn("osascript", ["-e", scpt], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }
  throw new Error("After Effects cannot run on this OS (see `node tools/ae.js doctor`).");
}

async function waitForFile(file, timeoutMs) {
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (size > 0 && size === last) return true;
      last = size;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function run({ target, code, args, timeout = 120, ae }) {
  const inst = pickInstall(ae);
  if (!inst) throw new Error(`After Effects ${ae || ""} not found (see \`node tools/ae.js doctor\`).`);
  // AE-side scripts load the bundled engine (dist/satsuei_engine.jsx): rebuild first so
  // they always run the current src/.
  require("./bundle.js").build({ quiet: true });
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const dir = path.join(OUT, "run", id);
  fs.mkdirSync(dir, { recursive: true });
  const resultPath = path.join(dir, "result.json");
  const wrapper = path.join(dir, "wrapper.jsx");
  // UTF-8 BOM so ExtendScript reads non-ASCII paths correctly.
  fs.writeFileSync(wrapper, "\ufeff" + wrapperSource({ id, resultPath, target: target && path.resolve(target), code, args }));
  launch(inst, wrapper);
  if (!(await waitForFile(resultPath, timeout * 1000))) {
    throw new Error(`timed out after ${timeout}s waiting for ${resultPath}. Is AE running and is ` +
      "\"Allow Scripts to Write Files and Access Network\" enabled?");
  }
  return JSON.parse(fs.readFileSync(resultPath, "utf8"));
}

/* ------------------------------- render ------------------------------ */

function render({ project, comp, frame, out, rqindex, omtemplate, rstemplate, ae }) {
  const inst = pickInstall(ae);
  if (!inst) throw new Error("aerender not found (see doctor).");
  const a = ["-project", path.resolve(project)];
  if (comp !== undefined) {
    a.push("-comp", comp);
    if (frame !== undefined) a.push("-s", String(frame), "-e", String(frame));
    if (out) a.push("-output", path.resolve(out));
    if (omtemplate) a.push("-OMtemplate", omtemplate);
    if (rstemplate) a.push("-RStemplate", rstemplate);
  } else if (rqindex !== undefined) {
    a.push("-rqindex", String(rqindex));
  }
  a.push("-sound", "OFF", "-v", "ERRORS_AND_PROGRESS");
  const r = spawnSync(inst.aerender, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, args: a };
}

/* -------------------------------- cli -------------------------------- */

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      opt[k] = v;
    } else pos.push(argv[i]);
  }
  return { pos, opt };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  switch (cmd) {
    case "doctor": process.exitCode = doctor(); break;
    case "paths": console.log(JSON.stringify({ installs: findInstalls(), prefs: scriptingPrefs() }, null, 2)); break;
    case "run":
    case "eval": {
      const res = await run({
        target: cmd === "run" ? pos[0] : null,
        code: cmd === "eval" ? pos[0] : null,
        args: opt.args ? JSON.parse(opt.args) : {},
        timeout: Number(opt.timeout || 120),
        ae: opt.ae
      });
      console.log(JSON.stringify(res, null, 2));
      process.exitCode = res.ok ? 0 : 1;
      break;
    }
    case "render": {
      const r = render({ ...opt, frame: opt.frame, rqindex: opt.rqindex });
      process.stdout.write(r.stdout || "");
      process.stderr.write(r.stderr || "");
      process.exitCode = r.status === 0 ? 0 : 1;
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(2, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      process.exitCode = cmd ? 1 : 0;
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
}
module.exports = { findInstalls, scriptingPrefs, versionFromName, wrapperSource, doctor, run, render };
