"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const J = require("../../src/lib/json2.js");

test("stringify matches native JSON for plain data", () => {
  const cases = [
    null, true, false, 0, -1.5, 1e-7, 12345678901234, "", "a\"b\\c\n\t\u0001",
    [], {}, [1, [2, [3]]], { a: 1, b: [true, null, "x"], c: { d: "日本語" } }
  ];
  for (const c of cases) assert.equal(J.stringify(c), JSON.stringify(c));
});

test("stringify escapes U+2028/2029 (raw ones break ES3 string literals in expressions)", () => {
  const v = "x\u2028y\u2029z";
  assert.equal(J.stringify(v), "\"x\\u2028y\\u2029z\"");
  assert.equal(JSON.parse(J.stringify(v)), v);
});

test("stringify drops undefined/functions in objects, nulls them in arrays, nulls non-finite", () => {
  assert.equal(J.stringify({ a: undefined, b: () => 1, c: 2 }), "{\"c\":2}");
  assert.equal(J.stringify([undefined, NaN, Infinity]), "[null,null,null]");
});

test("stringify indents like native", () => {
  const v = { a: [1, 2], b: { c: "x" }, e: [], f: {} };
  assert.equal(J.stringify(v, 2), JSON.stringify(v, null, 2));
});

test("parse round-trips and matches native", () => {
  const texts = [
    "{\"a\":[1,2.5e3,-0.25,true,false,null],\"b\":\"\\u65e5\\n\\\"\"}",
    "  [ ]  ", "{}", "\"\\/\"", "-0", "1E+2", "﻿{\"bom\":1}"
  ];
  for (const t of texts) assert.deepEqual(J.parse(t), JSON.parse(t.replace(/^\uFEFF/, "")));
});

test("parse rejects invalid JSON", () => {
  for (const t of ["{a:1}", "[1,]", "{\"a\":1,}", "01", "'x'", "[1] x", "\"\u0001\"", "", "tru"]) {
    assert.throws(() => J.parse(t), /SATSUEI\.json\.parse/, t);
  }
});

test("stringify fails loudly on cyclic objects instead of hanging", () => {
  const a = { name: "comp" }; a.self = a;
  assert.throws(() => J.stringify(a), /cyclic/);
});
