"use strict";

const fs = require("fs");
const path = require("path");

function stripLua(source) {
  const input = String(source || "");
  let out = "";
  let i = 0;
  let state = "code";
  let quote = "";
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (state === "code") {
      if (ch === "-" && next === "-") {
        if (input.slice(i + 2, i + 4) === "[[") {
          out += "    ";
          i += 4;
          state = "block-comment";
          continue;
        }
        out += "  ";
        i += 2;
        state = "line-comment";
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        out += " ";
        i += 1;
        state = "string";
        continue;
      }
      if (ch === "[" && next === "[") {
        out += "  ";
        i += 2;
        state = "long-string";
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (state === "line-comment") {
      if (ch === "\n") {
        out += "\n";
        state = "code";
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (state === "block-comment" || state === "long-string") {
      if (ch === "]" && next === "]") {
        out += "  ";
        i += 2;
        state = "code";
      } else {
        out += ch === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    if (state === "string") {
      if (ch === "\\") {
        out += "  ";
        i += Math.min(2, input.length - i);
        continue;
      }
      if (ch === quote) {
        out += " ";
        i += 1;
        state = "code";
      } else {
        out += ch === "\n" ? "\n" : " ";
        i += 1;
      }
    }
  }
  return out;
}

function indentOf(line) {
  const match = String(line || "").match(/^\s*/);
  return (match ? match[0] : "").replace(/\t/g, "    ").length;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}

function callSites(lines, name) {
  const escaped = escapeRegex(name);
  const callRe = new RegExp("\\b" + escaped + "\\s*\\(", "g");
  const declarationRe = new RegExp("^\\s*local\\s+function\\s+" + escaped + "\\b");
  const calls = [];
  lines.forEach((line, index) => {
    if (declarationRe.test(line)) return;
    let match;
    while ((match = callRe.exec(line))) {
      const previous = line.slice(0, match.index).trimEnd().slice(-1);
      if (previous === "." || previous === ":") continue;
      calls.push({ line: index + 1, column: match.index + 1, indent: indentOf(line) });
    }
  });
  return calls;
}

function analyzeLuaSource(source, file) {
  const clean = stripLua(source);
  const lines = clean.split(/\r?\n/);
  const defs = [];

  lines.forEach((line, index) => {
    const localFn = line.match(/^\s*local\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (localFn) {
      defs.push({ name: localFn[1], line: index + 1, indent: indentOf(line), type: "local-function" });
      return;
    }

    const localAssignedFn = line.match(/^\s*local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*function\b/);
    if (localAssignedFn) {
      defs.push({ name: localAssignedFn[1], line: index + 1, indent: indentOf(line), type: "local-function" });
      return;
    }

    const assigned = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*function\b/);
    if (!assigned) return;
    const name = assigned[1];
    const localRe = new RegExp("^\\s*local\\s+" + escapeRegex(name) + "\\b");
    const localFnRe = new RegExp("^\\s*local\\s+function\\s+" + escapeRegex(name) + "\\b");
    const forwarded = lines.slice(0, index).some((candidate) => localRe.test(candidate) && !localFnRe.test(candidate));
    if (forwarded) {
      defs.push({ name, line: index + 1, indent: indentOf(line), type: "forward-assignment" });
    }
  });

  const issues = [];
  for (const def of defs) {
    for (const call of callSites(lines, def.name)) {
      if (call.line < def.line && def.type === "local-function") {
        issues.push({
          rule: "late-local-function",
          file: file || "<memory>",
          symbol: def.name,
          line: call.line,
          declarationLine: def.line,
          message: def.name + "() is called before its local function declaration; the earlier reference cannot resolve to that later local.",
        });
      }
      if (call.line > def.line && def.type === "local-function" && def.indent > call.indent) {
        issues.push({
          rule: "narrow-local-scope",
          file: file || "<memory>",
          symbol: def.name,
          line: call.line,
          declarationLine: def.line,
          message: def.name + "() is called from a visibly wider scope than its local declaration; verify lexical visibility.",
        });
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const issue of issues) {
    const key = [issue.rule, issue.file, issue.symbol, issue.line, issue.declarationLine].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return { ok: unique.length === 0, issues: unique };
}

function checkFiles(root, files) {
  const luaFiles = [...new Set((files || []).filter((file) => /\.lua$/i.test(file)))];
  const issues = [];
  const checked = [];
  for (const rel of luaFiles) {
    const absolute = path.resolve(root, rel);
    const relative = path.relative(path.resolve(root), absolute);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep)) continue;
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    checked.push(rel.replace(/\\/g, "/"));
    issues.push(...analyzeLuaSource(fs.readFileSync(absolute, "utf8"), rel).issues);
  }
  return { ok: issues.length === 0, filesChecked: checked, issues };
}

module.exports = { stripLua, analyzeLuaSource, checkFiles };
