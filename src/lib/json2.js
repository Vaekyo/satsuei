/*
 * SATSUEI.json - JSON for ExtendScript (ES3).
 *
 * Kept at the conventional path lib/json2.js, but unlike Crockford's json2.js this
 * implementation never defines a global JSON object and never touches built-in
 * prototypes (other scripts share AE's ExtendScript engine). The parser is a strict
 * recursive-descent parser: no eval.
 *
 * UMD: Node gets module.exports; ExtendScript gets $.global.SATSUEI.json.
 */
(function (factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory();
    return;
  }
  var S = $.global.SATSUEI = $.global.SATSUEI || {};
  S.json = factory();
}(function () {
  var ESC = {
    "\"": "\\\"", "\\": "\\\\", "\b": "\\b", "\f": "\\f",
    "\n": "\\n", "\r": "\\r", "\t": "\\t"
  };

  function hex4(n) {
    var s = n.toString(16);
    while (s.length < 4) { s = "0" + s; }
    return s;
  }

  function quote(str) {
    var out = ["\""];
    var i, c, code;
    for (i = 0; i < str.length; i++) {
      c = str.charAt(i);
      code = str.charCodeAt(i);
      if (ESC.hasOwnProperty(c)) {
        out.push(ESC[c]);
      } else if (code < 0x20 || code === 0x2028 || code === 0x2029) {
        out.push("\\u" + hex4(code));
      } else {
        out.push(c);
      }
    }
    out.push("\"");
    return out.join("");
  }

  function isArray(v) {
    return Object.prototype.toString.call(v) === "[object Array]" ||
      (v !== null && typeof v === "object" && typeof v.length === "number" &&
       typeof v.BYTES_PER_ELEMENT === "number");
  }

  var MAX_DEPTH = 64;

  function ser(v, indent, cur, depth) {
    var t = typeof v;
    var i, parts, k, s, inner, sep, open;
    if (v === null) { return "null"; }
    if (t === "number") { return isFinite(v) ? String(v) : "null"; }
    if (t === "boolean") { return v ? "true" : "false"; }
    if (t === "string") { return quote(v); }
    if (t === "undefined" || t === "function") { return undefined; }
    if (v instanceof Date) { return quote(String(v)); }
    if (depth > MAX_DEPTH) {
      // AE DOM objects are cyclic (layer.containingComp.layer(1)...): fail loudly, never hang.
      throw new Error("SATSUEI.json.stringify: nesting deeper than " + MAX_DEPTH + " (cyclic object?)");
    }
    inner = indent ? cur + indent : "";
    sep = indent ? ",\n" + inner : ",";
    open = indent ? "\n" + inner : "";
    if (isArray(v)) {
      if (v.length === 0) { return "[]"; }
      parts = [];
      for (i = 0; i < v.length; i++) {
        s = ser(v[i], indent, inner, depth + 1);
        parts.push(s === undefined ? "null" : s);
      }
      return "[" + open + parts.join(sep) + (indent ? "\n" + cur : "") + "]";
    }
    parts = [];
    for (k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) {
        s = ser(v[k], indent, inner, depth + 1);
        if (s !== undefined) {
          parts.push(quote(k) + (indent ? ": " : ":") + s);
        }
      }
    }
    if (parts.length === 0) { return "{}"; }
    return "{" + open + parts.join(sep) + (indent ? "\n" + cur : "") + "}";
  }

  /** stringify(value[, indent]) - indent is a number of spaces or a string. */
  function stringify(value, indent) {
    var ind = "";
    var n;
    if (typeof indent === "number") {
      for (n = 0; n < indent && n < 10; n++) { ind += " "; }
    } else if (typeof indent === "string") {
      ind = indent;
    }
    return ser(value, ind, "", 0);
  }

  function ParseError(msg, pos) {
    this.name = "SyntaxError";
    this.message = "SATSUEI.json.parse: " + msg + " at position " + pos;
  }
  ParseError.prototype = new Error();

  /** parse(text) - strict JSON; throws on any syntax error. */
  function parse(text) {
    var s = String(text);
    var pos = 0;
    var len = s.length;

    if (s.charCodeAt(0) === 0xFEFF) { pos = 1; }

    function fail(msg) { throw new ParseError(msg, pos); }

    function ws() {
      var c;
      while (pos < len) {
        c = s.charCodeAt(pos);
        if (c === 32 || c === 9 || c === 10 || c === 13) { pos++; } else { break; }
      }
    }

    function str() {
      var out = [];
      var start, c, h;
      pos++; // opening quote
      start = pos;
      while (true) {
        if (pos >= len) { fail("unterminated string"); }
        c = s.charAt(pos);
        if (c === "\"") {
          out.push(s.substring(start, pos));
          pos++;
          return out.join("");
        }
        if (c === "\\") {
          out.push(s.substring(start, pos));
          pos++;
          c = s.charAt(pos);
          if (c === "\"" || c === "\\" || c === "/") { out.push(c); }
          else if (c === "b") { out.push("\b"); }
          else if (c === "f") { out.push("\f"); }
          else if (c === "n") { out.push("\n"); }
          else if (c === "r") { out.push("\r"); }
          else if (c === "t") { out.push("\t"); }
          else if (c === "u") {
            h = s.substring(pos + 1, pos + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) { fail("bad \\u escape"); }
            out.push(String.fromCharCode(parseInt(h, 16)));
            pos += 4;
          } else { fail("bad escape"); }
          pos++;
          start = pos;
        } else {
          if (s.charCodeAt(pos) < 0x20) { fail("control character in string"); }
          pos++;
        }
      }
    }

    function num() {
      var m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(s.substring(pos, pos + 64));
      if (!m) { fail("bad number"); }
      pos += m[0].length;
      return parseFloat(m[0]);
    }

    function lit(word, val) {
      if (s.substring(pos, pos + word.length) !== word) { fail("unexpected token"); }
      pos += word.length;
      return val;
    }

    function value() {
      var c, arr, obj, key;
      ws();
      if (pos >= len) { fail("unexpected end"); }
      c = s.charAt(pos);
      if (c === "{") {
        obj = {};
        pos++;
        ws();
        if (s.charAt(pos) === "}") { pos++; return obj; }
        while (true) {
          ws();
          if (s.charAt(pos) !== "\"") { fail("expected key"); }
          key = str();
          ws();
          if (s.charAt(pos) !== ":") { fail("expected ':'"); }
          pos++;
          obj[key] = value();
          ws();
          c = s.charAt(pos);
          if (c === ",") { pos++; continue; }
          if (c === "}") { pos++; return obj; }
          fail("expected ',' or '}'");
        }
      }
      if (c === "[") {
        arr = [];
        pos++;
        ws();
        if (s.charAt(pos) === "]") { pos++; return arr; }
        while (true) {
          arr.push(value());
          ws();
          c = s.charAt(pos);
          if (c === ",") { pos++; continue; }
          if (c === "]") { pos++; return arr; }
          fail("expected ',' or ']'");
        }
      }
      if (c === "\"") { return str(); }
      if (c === "t") { return lit("true", true); }
      if (c === "f") { return lit("false", false); }
      if (c === "n") { return lit("null", null); }
      return num();
    }

    var result = value();
    ws();
    if (pos !== len) { fail("trailing characters"); }
    return result;
  }

  return { stringify: stringify, parse: parse };
}));
