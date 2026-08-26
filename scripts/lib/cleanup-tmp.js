/**
 * Ephemeral scratch under .fxmind/state/tmp — not part of fxmind artifacts; gitignored.
 */
const fs = require("fs");
const path = require("path");

const { resolveLocal, writeLocal, fxmindDir, projectRel, REL } = require("./layout");

const TMP_REL = projectRel(REL.tmp);
const LEGACY_TMP_REL = path.join(".fxmind", "tmp");
const LEGACY_GATES_REL = ".fxmind-gates.json";

function gatesPath(projectRoot) {
  const resolved = path.resolve(projectRoot);
  const canonical = writeLocal(resolved, "gates");
  if (fs.existsSync(canonical)) {
    return canonical;
  }
  const v2 = resolveLocal(resolved, "gates");
  if (v2 && fs.existsSync(v2)) {
    return v2;
  }
  const repoRoot = path.join(resolved, LEGACY_GATES_REL);
  if (fs.existsSync(repoRoot)) {
    return repoRoot;
  }
  return canonical;
}

function readGates(projectRoot) {
  const gatesPathResolved = gatesPath(projectRoot);
  if (!fs.existsSync(gatesPathResolved)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(gatesPathResolved, "utf8"));
  } catch {
    return null;
  }
}

/** Keep tmp while an active task is mid-flight (before Gate C). */
function shouldRetainFxmindTmp(projectRoot) {
  const gates = readGates(projectRoot);
  if (!gates || !gates.taskActive) {
    return false;
  }
  return !gates.gates?.C?.complete;
}

function tmpDirs(projectRoot) {
  const resolved = path.resolve(projectRoot);
  return [
    writeLocal(resolved, "tmp"),
    path.join(fxmindDir(resolved), "tmp"),
  ];
}

function cleanupFxmindTmp(projectRoot) {
  if (shouldRetainFxmindTmp(projectRoot)) {
    return { removed: false, retained: true, path: TMP_REL };
  }

  let removed = false;
  for (const tmpDir of tmpDirs(projectRoot)) {
    if (!fs.existsSync(tmpDir)) {
      continue;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    removed = true;
  }
  return { removed, retained: false, path: TMP_REL };
}

module.exports = {
  TMP_REL,
  LEGACY_TMP_REL,
  shouldRetainFxmindTmp,
  cleanupFxmindTmp,
};
