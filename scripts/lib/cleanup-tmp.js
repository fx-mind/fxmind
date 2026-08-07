/**
 * Ephemeral scratch under .fxmind/tmp — not part of fxmind artifacts; gitignored.
 */
const fs = require("fs");
const path = require("path");

const SHARED_DIR = ".fxmind";
const TMP_REL = path.join(SHARED_DIR, "tmp");
const GATES_REL = path.join(SHARED_DIR, "fxmind-gates.json");
const LEGACY_GATES_REL = ".fxmind-gates.json";

function gatesPath(projectRoot) {
  const resolved = path.resolve(projectRoot);
  const primary = path.join(resolved, GATES_REL);
  if (fs.existsSync(primary)) {
    return primary;
  }
  return path.join(resolved, LEGACY_GATES_REL);
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

function cleanupFxmindTmp(projectRoot) {
  if (shouldRetainFxmindTmp(projectRoot)) {
    return { removed: false, retained: true, path: TMP_REL };
  }

  const tmpDir = path.join(path.resolve(projectRoot), TMP_REL);
  if (!fs.existsSync(tmpDir)) {
    return { removed: false, retained: false, path: TMP_REL };
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { removed: true, retained: false, path: TMP_REL };
}

module.exports = {
  TMP_REL,
  shouldRetainFxmindTmp,
  cleanupFxmindTmp,
};
