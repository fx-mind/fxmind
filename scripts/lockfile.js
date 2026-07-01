/**
 * packs.lock.json — reproducible pack installs.
 *
 * Captures, per installed pack: skills repo URL, resolved commit SHA
 * (when the cache is a git clone), list of skill names, and the layout
 * version. `fxmind --update -y` rewrites the lockfile so installs can be
 * diffed over time and pinned.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const { SHARED_DIR } = require("./global-store");
const { getPack } = require("./packs");
const { CACHE_ROOT, listSkillsInDir, resolvePackSkillsDir } = require("./resolve-packs");

const LOCKFILE_NAME = "packs.lock.json";

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function resolveCommitSha(pack) {
  const cacheRepoRoot = path.join(CACHE_ROOT, pack.skills.cacheName);
  if (!fs.existsSync(path.join(cacheRepoRoot, ".git"))) {
    return null;
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: cacheRepoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function buildLockEntry(packId, options = {}) {
  const pack = getPack(packId);
  const skillsDir = resolvePackSkillsDir(packId, { ...options, packs: [packId] });
  const skills = listSkillsInDir(skillsDir);

  let resolvedSource = "sibling";
  if (process.env[`FXMIND_PACK_${packId.toUpperCase()}_SKILLS_DIR`]) {
    resolvedSource = "env";
  } else if (options.packSkillsDirs?.[packId]) {
    resolvedSource = "explicit";
  } else if (skillsDir.startsWith(CACHE_ROOT)) {
    resolvedSource = "cache";
  }

  return {
    id: packId,
    label: pack.label,
    skillsRepo: pack.skills.repo,
    cacheName: pack.skills.cacheName,
    resolvedSource,
    resolvedSkillsDir: skillsDir.replace(/\\/g, "/"),
    commitSha: resolveCommitSha(pack),
    skills,
    lockedAt: new Date().toISOString(),
  };
}

function buildLockfile(packIds, options = {}) {
  return {
    version: 1,
    generator: "fxmind",
    platform: process.platform,
    lockedAt: new Date().toISOString(),
    packs: packIds.map((id) => buildLockEntry(id, options)),
  };
}

function writeLockfile(targetRoot, packIds, options = {}) {
  const lockPath = path.join(path.resolve(targetRoot), SHARED_DIR, LOCKFILE_NAME);
  const data = buildLockfile(packIds, options);
  writeJson(lockPath, data);
  return { lockPath, data };
}

function readLockfile(targetRoot) {
  const lockPath = path.join(path.resolve(targetRoot), SHARED_DIR, LOCKFILE_NAME);
  return readJson(lockPath);
}

function diffLockfiles(prev, next) {
  const prevById = new Map((prev?.packs || []).map((p) => [p.id, p]));
  const nextById = new Map((next?.packs || []).map((p) => [p.id, p]));
  const changes = [];

  for (const [id, entry] of nextById) {
    const old = prevById.get(id);
    if (!old) {
      changes.push({ id, type: "added" });
      continue;
    }
    if (old.commitSha && entry.commitSha && old.commitSha !== entry.commitSha) {
      changes.push({
        id,
        type: "commit",
        from: old.commitSha.slice(0, 8),
        to: entry.commitSha.slice(0, 8),
      });
    }
    const oldSkills = new Set(old.skills || []);
    const newSkills = new Set(entry.skills || []);
    for (const s of newSkills) {
      if (!oldSkills.has(s)) changes.push({ id, type: "skill-added", skill: s });
    }
    for (const s of oldSkills) {
      if (!newSkills.has(s)) changes.push({ id, type: "skill-removed", skill: s });
    }
  }

  for (const [id] of prevById) {
    if (!nextById.has(id)) changes.push({ id, type: "removed" });
  }

  return changes;
}

function printLockSummary(data) {
  console.log(`Lockfile: ${SHARED_DIR}/${LOCKFILE_NAME}`);
  for (const entry of data.packs || []) {
    const sha = entry.commitSha ? entry.commitSha.slice(0, 8) : "no-git";
    console.log(
      `  ${entry.id}  source=${entry.resolvedSource}  sha=${sha}  skills=${entry.skills.length}`,
    );
  }
}

module.exports = {
  LOCKFILE_NAME,
  buildLockfile,
  writeLockfile,
  readLockfile,
  diffLockfiles,
  printLockSummary,
};
