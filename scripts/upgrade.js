"use strict";
/** Safe migration helpers used by the existing `fxmind --update --global-store -y`. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const store = require("./global-store");

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function filesIn(folder) {
  const files = [];
  const walk = (dir, rel = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = path.join(rel, entry.name);
      const full = path.join(dir, entry.name);
      const stat = entry.isSymbolicLink() ? fs.statSync(full) : entry;
      if (stat.isDirectory()) walk(full, name);
      else if (stat.isFile()) files.push(name);
    }
  };
  walk(folder);
  return files.sort();
}

function makeBackup(source, target) {
  if (fs.existsSync(target)) throw new Error("Backup destination exists: " + target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true, force: false, errorOnExist: true });
  const from = filesIn(source), to = filesIn(target);
  if (from.length !== to.length) throw new Error("Backup file count mismatch");
  for (let i = 0; i < from.length; i++) {
    if (from[i] !== to[i] || sha(path.join(source, from[i])) !== sha(path.join(target, to[i]))) {
      throw new Error("Backup SHA-256 mismatch: " + from[i]);
    }
  }
  return from.length;
}

function backupPath(projectRoot, date = new Date()) {
  return path.join(os.homedir(), ".fxmind", "backups", store.projectIdForRoot(projectRoot),
    date.toISOString().replace(/[:.]/g, "-"));
}

function preserveSkills(projectRoot) {
  const source = path.join(projectRoot, ".fxmind", "skills");
  if (!fs.existsSync(source) || store.isGlobalStore(projectRoot)) return 0;
  const files = filesIn(source);
  const dest = store.GLOBAL_SHARED_SKILLS;
  // Validate *all* collisions before creating any global skill file.
  for (const file of files) {
    const existing = path.join(dest, file);
    if (fs.existsSync(existing) && sha(existing) !== sha(path.join(source, file))) {
      throw new Error("Shared skill collision (no files overwritten): " + file);
    }
  }
  for (const file of files) {
    const output = path.join(dest, file);
    if (fs.existsSync(output)) continue;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(source, file), output, fs.constants.COPYFILE_EXCL);
  }
  return files.length;
}

function prepareGlobalMigration(root, options = {}) {
  const project = path.resolve(root);
  const local = path.join(project, ".fxmind");
  if (!fs.existsSync(local) || !fs.statSync(local).isDirectory()) {
    throw new Error("Existing .fxmind project required for migration: " + project);
  }
  const target = options.backup || backupPath(project);
  const count = makeBackup(local, target);
  const skills = preserveSkills(project);
  if (options.activate !== false && !store.isGlobalStore(project)) store.setupGlobalStore(project);
  return { backup: target, files: count, skills, dataRoot: store.resolveDataRoot(project) };
}

function finishGlobalMigration(root, agents, options = {}) {
  const known = new Set(["cursor", "claude", "codex"]);
  const requested = [...new Set((agents || []).map((agent) => agent.id).filter((id) => known.has(id)))];
  const installer = options.plugin || require("./plugin-cli").runPluginCli;
  const results = [];
  for (const client of requested) {
    const status = installer([client]);
    if (status !== 0) throw new Error("FXMIND plugin installation failed for " + client);
    results.push(client);
  }
  const result = (options.buildGraph || require("./fxmind-tools").buildGraph)(root, { updateHtml: false });
  return { plugins: results, atomicIndex: result.atomicIndex, legacyMemoriesPreserved: true };
}

module.exports = { filesIn, makeBackup, backupPath, preserveSkills, prepareGlobalMigration, finishGlobalMigration };
