/**
 * Content-aware file sync for install/update.
 * Writes only when bytes (or JSON semantics) actually change.
 */
const fs = require("fs");
const path = require("path");

function readFileBuffer(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function buffersEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.equals(b);
}

function filesEqual(src, dest) {
  return buffersEqual(readFileBuffer(src), readFileBuffer(dest));
}

function copyFileIfChanged(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (filesEqual(src, dest)) {
    return { changed: false, path: dest };
  }
  fs.copyFileSync(src, dest);
  return { changed: true, path: dest };
}

function writeFileIfChanged(dest, content, encoding = "utf8") {
  const next = Buffer.isBuffer(content) ? content : Buffer.from(String(content), encoding);
  if (buffersEqual(readFileBuffer(dest), next)) {
    return { changed: false, path: dest };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, next);
  return { changed: true, path: dest };
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function jsonSemanticallyEqual(a, b) {
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return false;
  }
}

function writeJsonIfChanged(filePath, data) {
  const next = `${JSON.stringify(data, null, 2)}\n`;
  if (fs.existsSync(filePath)) {
    try {
      const prevRaw = fs.readFileSync(filePath, "utf8");
      if (prevRaw === next) {
        return { changed: false, path: filePath };
      }
      const prevData = JSON.parse(prevRaw);
      if (jsonSemanticallyEqual(prevData, data)) {
        return { changed: false, path: filePath };
      }
    } catch {
      // rewrite unreadable / invalid JSON
    }
  }
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/")) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, path: filePath };
}

function copyDirIfChanged(src, dest) {
  const files = [];
  function walk(fromDir, toDir, rel = "") {
    fs.mkdirSync(toDir, { recursive: true });
    for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
      const from = path.join(fromDir, entry.name);
      const to = path.join(toDir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(from, to, nextRel);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const result = copyFileIfChanged(from, to);
      if (result.changed) {
        files.push(nextRel.replace(/\\/g, "/"));
      }
    }
  }
  walk(src, dest);
  return { changed: files.length > 0, files, dest };
}

function omitKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const skip = new Set(keys);
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!skip.has(key)) {
      out[key] = entry;
    }
  }
  return out;
}

module.exports = {
  filesEqual,
  buffersEqual,
  copyFileIfChanged,
  writeFileIfChanged,
  writeJsonIfChanged,
  copyDirIfChanged,
  jsonSemanticallyEqual,
  stableStringify,
  omitKeys,
};
