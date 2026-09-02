/**
 * Canonical .fxmind/ layout (LAYOUT_VERSION 3).
 *
 * Writes go to the new folders. Reads fall back to the old flat-root layout
 * so un-migrated projects keep working until `fxmind --update`.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SHARED_DIR = ".fxmind";
const LAYOUT_VERSION = 3;

const REL = {
  templates: "templates",
  policy: "policy",
  graph: "graph",
  state: "state",
  reports: "reports",
  memory: "memory",
  modes: "modes",
  skills: "skills",
  audits: "audits",
  corrections: "corrections",

  router: "fxmind.md",
  packs: "packs.json",
  lockfile: "packs.lock.json",
  store: "store.json",

  memoryTemplate: "templates/memory.md",
  memoryHealthTemplate: "templates/memory-health.md",
  referenceTemplate: "templates/reference.mdc",
  referenceExample: "templates/reference.example.mdc",

  failureModes: "policy/failure-modes.md",
  minimumEvidence: "policy/minimum-evidence.md",
  topicCatalog: "policy/topic-catalog.md",

  auditProcedure: "audits/procedure.md",

  graphJson: "graph/knowledge-graph.json",
  graphHtml: "graph/knowledge-graph.html",
  memoryIndexJson: "graph/memory-index.json",

  gates: "state/fxmind-gates.json",
  metrics: "state/metrics.jsonl",
  graphCache: "state/graph-cache.json",
  rcon: "state/rcon.json",
  fivemLog: "state/fivem-console.log",
  serverDebugLog: "state/server-debug.log",
  nuiDump: "state/nui-dump.json",
  nuiWire: "state/nui-wire.json",
  tmp: "state/tmp",

  memoryHealthReport: "reports/memory-health.md",
};

const LEGACY_REL = {
  memoryTemplate: "memory.template.md",
  memoryHealthTemplate: "memory-health.template.md",
  memoryIndexTemplate: "memory-index.template.md",
  referenceTemplate: "reference.template.mdc",
  referenceExample: "reference.example.mdc",
  failureModes: "failure-modes.md",
  minimumEvidence: "minimum-evidence.md",
  topicCatalog: "topic-catalog.md",
  auditProcedure: "audit-procedure.md",
  auditTemplate: "audit.template.md",
  graphJson: "knowledge-graph.json",
  graphHtml: "knowledge-graph.html",
  memoryIndexJson: "memory-index.json",
  gates: "fxmind-gates.json",
  metrics: "metrics.jsonl",
  graphCache: "graph-cache.json",
  rcon: "rcon.json",
  fivemLog: "fivem-console.log",
  serverDebugLog: "server-debug.log",
  nuiDump: "nui-dump.json",
  nuiWire: "nui-wire.json",
  tmp: "tmp",
  memoryHealthReport: "memory-health.md",
  mcpLaunch: "mcp-launch.js",
};

const DEPRECATED_ROOT_FILES = [
  "audit.template.md",
  "memory-index.template.md",
  "mcp-launch.js",
];

const PROJECT_GITIGNORE_LINES = [
  ".fxmind/graph/",
  ".fxmind/state/",
  ".fxmind/knowledge-graph.json",
  ".fxmind/knowledge-graph.html",
  ".fxmind/memory-index.json",
  ".fxmind/fxmind-gates.json",
  ".fxmind-gates.json",
  ".fxmind/metrics.jsonl",
  ".fxmind/fivem-console.log",
  ".fxmind/server-debug.log",
  ".fxmind/nui-dump.json",
  ".fxmind/nui-wire.json",
  ".fxmind/rcon.json",
  ".fxmind/graph-cache.json",
  ".fxmind/tmp/",
];

/** Already-tracked generated files to drop from the git index (`git rm --cached`). */
const PROJECT_GITIGNORE_UNTRACK = [
  ".fxmind/graph",
  ".fxmind/state",
  ".fxmind/knowledge-graph.json",
  ".fxmind/knowledge-graph.html",
  ".fxmind/memory-index.json",
  ".fxmind/graph-cache.json",
  ".fxmind/metrics.jsonl",
  ".fxmind/fxmind-gates.json",
  ".fxmind/tmp",
  ".fxmind-gates.json",
];

function fxmindDir(root) {
  return path.join(path.resolve(root), SHARED_DIR);
}

function joinRel(base, rel) {
  return path.join(base, ...String(rel).split("/"));
}

function posixJoin(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
}

function projectRel(relInside) {
  return posixJoin(SHARED_DIR, relInside);
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function resolveInBase(base, key) {
  const canonical = REL[key];
  const legacy = LEGACY_REL[key];
  const candidates = [];
  if (canonical) {
    candidates.push(joinRel(base, canonical));
  }
  if (legacy) {
    candidates.push(joinRel(base, legacy));
  }
  return firstExisting(candidates);
}

function writePathInBase(base, key) {
  return joinRel(base, REL[key]);
}

function resolveLocal(root, key) {
  return resolveInBase(fxmindDir(root), key);
}

function writeLocal(root, key) {
  return writePathInBase(fxmindDir(root), key);
}

function resolveInDataRoot(dataRoot, key) {
  return resolveInBase(dataRoot, key);
}

function writeInDataRoot(dataRoot, key) {
  return writePathInBase(dataRoot, key);
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function moveRegular(from, to) {
  if (!from || !to || from === to) {
    return false;
  }
  if (!fs.existsSync(from)) {
    return false;
  }

  let stat;
  try {
    stat = fs.lstatSync(from);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink()) {
    return false;
  }

  if (stat.isDirectory()) {
    if (fs.existsSync(to)) {
      for (const name of fs.readdirSync(from)) {
        moveRegular(path.join(from, name), path.join(to, name));
      }
      try {
        if (fs.readdirSync(from).length === 0) {
          fs.rmdirSync(from);
        }
      } catch {
        // ignore non-empty or race
      }
      return true;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return true;
  }

  if (fs.existsSync(to)) {
    fs.unlinkSync(from);
    return true;
  }

  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
  return true;
}

function removeIfRegularFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }
  fs.unlinkSync(filePath);
  return true;
}

/**
 * Move v2 flat-root files into v3 folders. Idempotent.
 * `base` is project `.fxmind` or a global-store project dir.
 */
function migrateLayoutInDir(base) {
  const moved = [];
  if (!base || !fs.existsSync(base)) {
    return moved;
  }

  const keys = [
    "memoryTemplate",
    "memoryHealthTemplate",
    "referenceTemplate",
    "referenceExample",
    "failureModes",
    "minimumEvidence",
    "topicCatalog",
    "auditProcedure",
    "graphJson",
    "graphHtml",
    "memoryIndexJson",
    "gates",
    "metrics",
    "graphCache",
    "rcon",
    "fivemLog",
    "serverDebugLog",
    "nuiDump",
    "nuiWire",
    "tmp",
    "memoryHealthReport",
  ];

  for (const key of keys) {
    const fromRel = LEGACY_REL[key];
    const destRel = REL[key];
    if (!fromRel || !destRel) {
      continue;
    }
    const from = joinRel(base, fromRel);
    const to = joinRel(base, destRel);
    if (moveRegular(from, to)) {
      moved.push({ from: fromRel, to: destRel });
    }
  }

  for (const junk of DEPRECATED_ROOT_FILES) {
    if (removeIfRegularFile(joinRel(base, junk))) {
      moved.push({ from: junk, to: null });
    }
  }

  return moved;
}

function migrateProjectLayout(projectRoot) {
  return migrateLayoutInDir(fxmindDir(projectRoot));
}

module.exports = {
  SHARED_DIR,
  LAYOUT_VERSION,
  REL,
  LEGACY_REL,
  DEPRECATED_ROOT_FILES,
  PROJECT_GITIGNORE_LINES,
  PROJECT_GITIGNORE_UNTRACK,
  fxmindDir,
  joinRel,
  projectRel,
  firstExisting,
  resolveInBase,
  writePathInBase,
  resolveLocal,
  writeLocal,
  resolveInDataRoot,
  writeInDataRoot,
  ensureDirFor,
  migrateLayoutInDir,
  migrateProjectLayout,
};
