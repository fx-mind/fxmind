const fs = require("fs");
const path = require("path");

const PACKAGE_ROOT = path.join(__dirname, "..");
const PACKS_DIR = path.join(PACKAGE_ROOT, "packs");

function loadPackManifest(packId) {
  const manifestPath = path.join(PACKS_DIR, packId, "pack.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Unknown knowledge pack: ${packId}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return {
    ...manifest,
    id: packId,
    templatesDir: path.join(PACKS_DIR, packId, "templates"),
  };
}

function listPackIds() {
  if (!fs.existsSync(PACKS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(PACKS_DIR, id, "pack.json")))
    .sort();
}

function listPacks() {
  return listPackIds().map(loadPackManifest);
}

function getPack(packId) {
  return loadPackManifest(packId);
}

function getDefaultPackIds() {
  return ["fivem"];
}

function getDefaultSkillsForPacks(packIds) {
  const skills = new Set();
  for (const packId of packIds) {
    for (const skill of getPack(packId).defaultSkills || []) {
      skills.add(skill);
    }
  }
  return [...skills];
}

function validatePackIds(packIds) {
  const available = new Set(listPackIds());
  for (const packId of packIds) {
    if (!available.has(packId)) {
      throw new Error(
        `Unknown pack: ${packId}. Available: ${[...available].join(", ")}`,
      );
    }
  }
}

module.exports = {
  PACKAGE_ROOT,
  PACKS_DIR,
  listPackIds,
  listPacks,
  getPack,
  getDefaultPackIds,
  getDefaultSkillsForPacks,
  validatePackIds,
};
