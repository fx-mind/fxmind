/**
 * install/skills — pack skill resolution + installation into .fxmind/skills/.
 */
const fs = require("fs");
const path = require("path");

const { buildSkillSources } = require("../resolve-packs");
const {
  listPackIds,
  getDefaultPackIds,
  getDefaultSkillsForPacks,
  validatePackIds,
} = require("../packs");
const { isGlobalStore, GLOBAL_SHARED_SKILLS } = require("../global-store");
const { PACK_SKILLS_DIR } = require("./config");
const state = require("./state");
const { copyDirIfChanged, writeFileIfChanged } = require("./sync-files");

function listAllSkills() {
  return [...state.SKILL_SOURCES.keys()].sort();
}

function getSkillsDirForSkill(skillName) {
  const source = state.SKILL_SOURCES.get(skillName);
  if (!source) {
    throw new Error(`Skill not found in selected packs: ${skillName}`);
  }
  return source.skillsDir;
}

function copyDir(src, dest) {
  return copyDirIfChanged(src, dest);
}

function installPackSkill(skillName, skillsRoot) {
  const src = path.join(getSkillsDirForSkill(skillName), skillName);

  if (!fs.existsSync(src)) {
    throw new Error(`Skill not found in package: ${skillName}`);
  }

  if (!fs.existsSync(path.join(src, "SKILL.md"))) {
    throw new Error(`Invalid skill (missing SKILL.md): ${skillName}`);
  }

  const dest = path.join(skillsRoot, skillName);
  const result = copyDirIfChanged(src, dest);
  return { dest, changed: result.changed, files: result.files };
}

function installPackSkills(targetRoot, skills, options = {}) {
  const skillsRoot =
    options.skillsRoot ||
    (options.globalStore || isGlobalStore(targetRoot)
      ? GLOBAL_SHARED_SKILLS
      : path.join(targetRoot, PACK_SKILLS_DIR));
  const installed = [];
  const unchanged = [];

  for (const skillName of skills) {
    const result = installPackSkill(skillName, skillsRoot);
    const rel = path.relative(targetRoot, result.dest).replace(/\\/g, "/") || result.dest;
    if (result.changed) {
      installed.push(rel);
    } else {
      unchanged.push(rel);
    }
  }

  return { installed, unchanged };
}

function writePackSkillsIndex(targetRoot, skills, options = {}) {
  const skillsRoot =
    options.skillsRoot ||
    (options.globalStore || isGlobalStore(targetRoot)
      ? GLOBAL_SHARED_SKILLS
      : path.join(targetRoot, PACK_SKILLS_DIR));
  const indexPath = path.join(skillsRoot, "_index.md");
  const lines = [
    "# Pack skills (fxmind-managed)",
    "",
    "Domain skills installed by fxmind. Read from here — not from the agent skills folder.",
    "",
    "| Skill | Path |",
    "|-------|------|",
  ];

  for (const skillName of [...skills].sort()) {
    lines.push(`| ${skillName} | \`.fxmind/skills/${skillName}/SKILL.md\` |`);
  }

  lines.push("");
  const rel = path.relative(targetRoot, indexPath);
  if (!writeFileIfChanged(indexPath, `${lines.join("\n")}\n`, "utf8").changed) {
    return null;
  }
  return rel;
}

function installPackSkillsLayer(targetRoot, skills, allPackSkillNames, options = {}) {
  const { removePackSkillsFromAgentDirs } = require("./agents");
  const actions = { installed: [], unchanged: [], removed: [], index: null };
  const packSkillOptions = {
    globalStore: options.globalStore || isGlobalStore(targetRoot),
  };

  if (skills.length > 0) {
    const result = installPackSkills(targetRoot, skills, packSkillOptions);
    actions.installed.push(...result.installed);
    actions.unchanged.push(...result.unchanged);
    actions.index = writePackSkillsIndex(targetRoot, skills, packSkillOptions);
  }

  if (allPackSkillNames.length > 0) {
    actions.removed.push(
      ...removePackSkillsFromAgentDirs(targetRoot, allPackSkillNames),
    );
  }

  return actions;
}

function resolvePackOptions(options) {
  if (options.allPacks) {
    options.packs = listPackIds();
  } else if (options.noPacks) {
    options.packs = [];
  } else if (!options.packs) {
    options.packs = options.yes ? getDefaultPackIds() : [];
  }

  validatePackIds(options.packs);

  if (!options.explicitSkills && options.packs.length > 0) {
    options.skills = getDefaultSkillsForPacks(options.packs);
  }

  state.SKILL_SOURCES =
    options.packs.length > 0
      ? buildSkillSources(options.packs, options)
      : new Map();

  if (options.all && options.packs.length > 0) {
    options.skills = listAllSkills();
  }
}

module.exports = {
  listAllSkills,
  getSkillsDirForSkill,
  copyDir,
  installPackSkill,
  installPackSkills,
  writePackSkillsIndex,
  installPackSkillsLayer,
  resolvePackOptions,
};
