#!/usr/bin/env node
"use strict";
// Bundler: inline every //@include "path" (resolved relative to the including file,
// like ExtendScript does) into single distributable .jsx files under dist/.
// Each file is included once. Output must stay ASCII (gotcha 7).
//
//   node tools/bundle.js            -> dist/Satsuei.jsx, dist/satsuei_engine.jsx

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const INCLUDE_RE = /^\s*\/\/@include\s+"([^"]+)"\s*$/;
const TARGET_RE = /^\s*\/\/@target\s+/;

function bundleFile(entry) {
  const seen = new Set();
  const out = [];
  function visit(file) {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    seen.add(abs);
    if (!fs.existsSync(abs)) throw new Error(`bundle: missing include ${abs}`);
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    out.push(`// ---- ${rel} ----`);
    for (const line of fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n").split("\n")) {
      const m = INCLUDE_RE.exec(line);
      if (m) visit(path.resolve(path.dirname(abs), m[1]));
      else if (!TARGET_RE.test(line)) out.push(line);
    }
  }
  visit(entry);
  return { text: out.join("\n"), files: [...seen] };
}

function gitRev() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "nogit"; }
}

function build({ outDir = path.join(ROOT, "dist"), quiet = false } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const stamp = `${pkg.version}+${gitRev()}`;
  const targets = [
    { entry: "src/Satsuei.jsx", out: "Satsuei.jsx" },
    { entry: "src/engine.jsx", out: "satsuei_engine.jsx" }
  ];
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const t of targets) {
    const { text, files } = bundleFile(path.join(ROOT, t.entry));
    const header = [
      "//@target aftereffects",
      `// SATSUEI ${stamp} - bundled from ${t.entry} (${files.length} files). Do not edit; edit src/ and run npm run build.`,
      ""
    ].join("\n");
    // stamp the runtime version too
    const body = text.replace(/S\.VERSION = "[^"]*";/, `S.VERSION = "${stamp}";`);
    const full = header + body + "\n";
    const bad = [...full].findIndex((ch) => ch.charCodeAt(0) > 0x7f);
    if (bad >= 0) throw new Error(`bundle: non-ASCII character in ${t.out} near: ${full.slice(Math.max(0, bad - 40), bad + 10)}`);
    const dest = path.join(outDir, t.out);
    fs.writeFileSync(dest, full);
    results.push({ out: dest, files: files.length, bytes: full.length });
    if (!quiet) console.log(`built ${path.relative(ROOT, dest)}  (${files.length} files, ${full.length} bytes, ${stamp})`);
  }
  return results;
}

if (require.main === module) build();
module.exports = { build, bundleFile };
