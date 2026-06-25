const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { getPack } = require("./packs");

const PACKAGE_ROOT = path.join(__dirname, "..");
const CACHE_ROOT = path.join(os.homedir(), ".fxmind", "packs-cache");

function hasValidSkillsDir(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return false;
  }

  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .some(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(dir, entry.name, "SKILL.md")),
      );
  } catch {
    return false;
  }
}

function runGit(args, cwd) {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: process.env,
  });
}

function syncPackSkillsCache(pack) {
  const cacheRepoRoot = path.join(CACHE_ROOT, pack.skills.cacheName);
  const cacheSkillsDir = path.join(cacheRepoRoot, "skills");

  if (fs.existsSync(cacheRepoRoot)) {
    try {
      runGit(["pull", "--ff-only"], cacheRepoRoot);
    } catch {
      fs.rmSync(cacheRepoRoot, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(cacheRepoRoot)) {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    runGit(["clone", "--depth", "1", pack.skills.repo, cacheRepoRoot]);
  }

  if (!hasValidSkillsDir(cacheSkillsDir)) {
    throw new Error(
      `Pack "${pack.id}" skills cache is invalid: ${cacheSkillsDir}`,
    );
  }

  return cacheSkillsDir;
}

function resolvePackSkillsDir(packId, options = {}) {
  const pack = getPack(packId);
  const overrideKey = `pack_${packId}`;

  if (options.packSkillsDirs?.[packId]) {
    const explicit = path.resolve(options.packSkillsDirs[packId]);
    if (!hasValidSkillsDir(explicit)) {
      throw new Error(
        `Invalid skills dir for pack "${packId}": ${explicit}`,
      );
    }
    return explicit;
  }

  if (options.skillsDir && options.packs?.length === 1 && options.packs[0] === packId) {
    const legacy = path.resolve(options.skillsDir);
    if (!hasValidSkillsDir(legacy)) {
      throw new Error(`--skills-dir is not a valid skills folder: ${legacy}`);
    }
    return legacy;
  }

  const envKey = `FXMIND_PACK_${packId.toUpperCase()}_SKILLS_DIR`;
  if (process.env[envKey]) {
    const fromEnv = path.resolve(process.env[envKey]);
    if (!hasValidSkillsDir(fromEnv)) {
      throw new Error(`${envKey} is not a valid skills folder: ${fromEnv}`);
    }
    return fromEnv;
  }

  if (process.env.FXMIND_SKILLS_DIR && packId === "fivem") {
    const fromEnv = path.resolve(process.env.FXMIND_SKILLS_DIR);
    if (hasValidSkillsDir(fromEnv)) {
      return fromEnv;
    }
  }

  const sibling = path.resolve(PACKAGE_ROOT, pack.skills.siblingPath);
  if (hasValidSkillsDir(sibling)) {
    return sibling;
  }

  return syncPackSkillsCache(pack);
}

function listSkillsInDir(skillsDir) {
  if (!hasValidSkillsDir(skillsDir)) {
    return [];
  }

  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md")))
    .sort();
}

function buildSkillSources(packIds, options = {}) {
  const sources = new Map();

  for (const packId of packIds) {
    const skillsDir = resolvePackSkillsDir(packId, { ...options, packs: packIds });
    for (const skillName of listSkillsInDir(skillsDir)) {
      if (sources.has(skillName)) {
        throw new Error(
          `Skill "${skillName}" exists in multiple packs — resolve conflict manually`,
        );
      }
      sources.set(skillName, { packId, skillsDir, skillName });
    }
  }

  return sources;
}

module.exports = {
  PACKAGE_ROOT,
  CACHE_ROOT,
  hasValidSkillsDir,
  resolvePackSkillsDir,
  listSkillsInDir,
  buildSkillSources,
};
