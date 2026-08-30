/**
 * install/agents — agent detection, manifest handling, per-agent skill/command install.
 */
const fs = require("fs");
const path = require("path");

const { npxInstall } = require("../constants");
const { PACKAGE_ROOT, buildSkillSources, refreshPackSkillsCaches } = require("../resolve-packs");
const { getDefaultSkillsForPacks, validatePackIds } = require("../packs");
const { resolveSkillsRoot } = require("../global-store");
const {
  DEFAULT_AGENTS,
  AGENTS,
  COMMAND_FILE,
  COMMAND_SKILL_NAME,
  COMMAND_TEMPLATE,
  FXMIND_SKILL_TEMPLATE,
  LEGACY_COMMAND_FILE,
  LEGACY_COMMAND_SKILL,
  GEMINI_COMMANDS_DIR,
  COPILOT_COMMANDS_DIR,
  COPILOT_PROMPT_FILE,
  SHARED_DIR,
} = require("./config");
const state = require("./state");
const { pruneEmptyDirsUpward } = require("./legacy");

function resolveAgents(agentNames) {
  const resolved = [];

  for (const name of agentNames) {
    if (!AGENTS[name]) {
      throw new Error(
        `Unknown agent: ${name}. Valid: ${Object.keys(AGENTS).join(", ")}`,
      );
    }
    resolved.push({ id: name, ...AGENTS[name] });
  }

  return resolved;
}

function readInstalledManifest(targetRoot) {
  const manifestPath = path.join(targetRoot, SHARED_DIR, "packs.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `No fxmind install found (.fxmind/packs.json missing). Run ${npxInstall("-y")} first.`,
    );
  }

  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function hasAgentInstall(targetRoot, agent) {
  if (agent.commandsDir && agent.commandMode === "file") {
    if (fs.existsSync(path.join(targetRoot, agent.commandsDir, COMMAND_FILE))) {
      return true;
    }
  }

  if (agent.commandsDir && agent.commandMode === "toml") {
    const tomlPath = path.join(targetRoot, agent.commandsDir, "fxmind.toml");
    const dirPath = path.join(targetRoot, agent.commandsDir, "fxmind");
    if (fs.existsSync(tomlPath) || fs.existsSync(dirPath)) {
      return true;
    }
  }

  if (agent.commandsDir && agent.commandMode === "prompt") {
    const promptPath = path.join(targetRoot, agent.commandsDir, COPILOT_PROMPT_FILE);
    if (fs.existsSync(promptPath)) {
      return true;
    }
  }

  if (agent.commandMode === "skill") {
    const skillPath = path.join(
      targetRoot,
      agent.skillsDir,
      COMMAND_SKILL_NAME,
      "SKILL.md",
    );
    if (fs.existsSync(skillPath)) {
      return true;
    }

    if (agent.altSkillsDir) {
      const altPath = path.join(
        targetRoot,
        agent.altSkillsDir,
        COMMAND_SKILL_NAME,
        "SKILL.md",
      );
      if (fs.existsSync(altPath)) {
        return true;
      }
    }
  }

  const skillRoots = [path.join(targetRoot, agent.skillsDir)];
  if (agent.altSkillsDir) {
    skillRoots.push(path.join(targetRoot, agent.altSkillsDir));
  }

  for (const skillRoot of skillRoots) {
    if (!fs.existsSync(skillRoot)) {
      continue;
    }

    for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === COMMAND_SKILL_NAME) {
        continue;
      }

      if (fs.existsSync(path.join(skillRoot, entry.name, "SKILL.md"))) {
        return true;
      }
    }
  }

  return false;
}

function detectInstalledAgents(targetRoot) {
  const found = listInstalledAgentIds(targetRoot);
  return found.length ? found : [...DEFAULT_AGENTS];
}

function listInstalledAgentIds(targetRoot) {
  return Object.keys(AGENTS).filter((agentId) => hasAgentInstall(targetRoot, AGENTS[agentId]));
}

function readManifestAgentIds(targetRoot) {
  const manifestPath = path.join(targetRoot, SHARED_DIR, "packs.json");
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(manifest.agents)) {
      return [];
    }
    return manifest.agents.filter((agentId) => AGENTS[agentId]);
  } catch {
    return [];
  }
}

/**
 * Merge newly requested agents with those already installed (manifest + disk).
 * Unless --replace-agents, never drop an agent the project already has.
 */
function resolveInstallAgentIds(targetRoot, options) {
  const requested =
    options.agents && options.agents.length ? options.agents : [...DEFAULT_AGENTS];

  if (options.replaceAgents) {
    options.agents = [...new Set(requested.filter((id) => AGENTS[id]))];
    return options.agents;
  }

  const merged = [
    ...new Set([
      ...readManifestAgentIds(targetRoot),
      ...listInstalledAgentIds(targetRoot),
      ...requested,
    ]),
  ].filter((id) => AGENTS[id]);

  options.agents = merged.length ? merged : requested;
  return options.agents;
}

function detectInstalledSkills(targetRoot) {
  const packSkillsRoot = resolveSkillsRoot(targetRoot);
  if (!fs.existsSync(packSkillsRoot)) {
    return [];
  }

  return fs
    .readdirSync(packSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .filter((name) =>
      fs.existsSync(path.join(packSkillsRoot, name, "SKILL.md")),
    )
    .sort();
}

function detectInstalledCommand(targetRoot, agentIds) {
  return agentIds.some((agentId) => {
    const agent = AGENTS[agentId];

    const fxmindSkill = path.join(
      targetRoot,
      agent.skillsDir,
      COMMAND_SKILL_NAME,
      "SKILL.md",
    );
    if (fs.existsSync(fxmindSkill)) {
      return true;
    }

    if (agent.altSkillsDir) {
      const altSkill = path.join(
        targetRoot,
        agent.altSkillsDir,
        COMMAND_SKILL_NAME,
        "SKILL.md",
      );
      if (fs.existsSync(altSkill)) {
        return true;
      }
    }

    if (agent.commandMode === "file" && agent.commandsDir) {
      return fs.existsSync(path.join(targetRoot, agent.commandsDir, COMMAND_FILE));
    }

    if (agent.commandMode === "toml" && agent.commandsDir) {
      return (
        fs.existsSync(path.join(targetRoot, agent.commandsDir, "fxmind.toml")) ||
        fs.existsSync(path.join(targetRoot, agent.commandsDir, "fxmind"))
      );
    }

    if (agent.commandMode === "prompt" && agent.commandsDir) {
      return fs.existsSync(path.join(targetRoot, agent.commandsDir, COPILOT_PROMPT_FILE));
    }

    if (agent.commandMode === "skill") {
      return fs.existsSync(
        path.join(targetRoot, agent.skillsDir, COMMAND_SKILL_NAME, "SKILL.md"),
      );
    }

    return false;
  });
}

function resolveUpdateAgentIds(targetRoot, manifest) {
  const fromManifest = Array.isArray(manifest.agents)
    ? manifest.agents.filter((agentId) => AGENTS[agentId])
    : [];
  const merged = [...new Set([...fromManifest, ...listInstalledAgentIds(targetRoot)])];
  if (merged.length) {
    return merged;
  }
  return detectInstalledAgents(targetRoot);
}

function resolveUpdateOptions(options) {
  const manifest = readInstalledManifest(options.target);
  const manifestPackIds = (manifest.packs || []).map((pack) => pack.id).filter(Boolean);
  const packIds = options.explicitPacks
    ? (options.packs || []).filter(Boolean)
    : manifestPackIds;

  if (packIds.length === 0) {
    throw new Error(
      "Installed manifest has no packs. Re-run install with a pack, e.g. fxmind --pack fivem -y",
    );
  }

  validatePackIds(packIds);
  options.packs = packIds;

  options.agents = options.explicitAgents
    ? [...new Set((options.agents || []).filter((agentId) => AGENTS[agentId]))]
    : resolveUpdateAgentIds(options.target, manifest);

  refreshPackSkillsCaches(packIds, options);
  state.SKILL_SOURCES = buildSkillSources(packIds, options);

  const manifestSkills = Array.isArray(manifest.skills)
    ? manifest.skills.filter((skillName) => state.SKILL_SOURCES.has(skillName))
    : [];
  const detectedSkills = detectInstalledSkills(options.target).filter((skillName) =>
    state.SKILL_SOURCES.has(skillName),
  );

  options.skills =
    manifestSkills.length > 0
      ? manifestSkills
      : detectedSkills.length > 0
        ? detectedSkills
        : getDefaultSkillsForPacks(packIds);

  options.command =
    typeof manifest.command === "boolean"
      ? manifest.command
      : detectInstalledCommand(options.target, options.agents);

  if (options.skills.length === 0 && !options.command) {
    throw new Error(
      "Nothing to update: no skills or /fxmind helper detected. Re-run install.",
    );
  }
}

function removePackSkillsFromAgentDirs(targetRoot, packSkillNames) {
  const removed = [];

  for (const agent of Object.values(AGENTS)) {
    const skillRoots = [path.join(targetRoot, agent.skillsDir)];
    if (agent.altSkillsDir) {
      skillRoots.push(path.join(targetRoot, agent.altSkillsDir));
    }

    for (const skillRoot of skillRoots) {
      for (const skillName of packSkillNames) {
        const skillPath = path.join(skillRoot, skillName);
        if (!fs.existsSync(skillPath)) {
          continue;
        }

        fs.rmSync(skillPath, { recursive: true, force: true });
        removed.push(path.relative(targetRoot, skillPath));
      }

      pruneEmptyDirsUpward(skillRoot, targetRoot);
    }
  }

  return removed;
}

function installFxmindAgentSkill(targetRoot, agent) {
  const src = path.join(PACKAGE_ROOT, FXMIND_SKILL_TEMPLATE);
  if (!fs.existsSync(src)) {
    throw new Error(`fxmind skill template not found: ${FXMIND_SKILL_TEMPLATE}`);
  }

  const destinations = [
    path.join(targetRoot, agent.skillsDir, COMMAND_SKILL_NAME, "SKILL.md"),
  ];

  if (agent.altSkillsDir) {
    destinations.push(
      path.join(targetRoot, agent.altSkillsDir, COMMAND_SKILL_NAME, "SKILL.md"),
    );
  }

  for (const dest of destinations) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  return destinations.map((dest) => path.relative(targetRoot, dest));
}

function removeLegacyCommand(targetRoot, agent) {
  if (agent.commandsDir && agent.commandMode === "file") {
    const legacyPath = path.join(targetRoot, agent.commandsDir, LEGACY_COMMAND_FILE);
    if (fs.existsSync(legacyPath)) {
      fs.unlinkSync(legacyPath);
    }
  }

  const legacySkillRoots = [path.join(targetRoot, agent.skillsDir)];
  if (agent.altSkillsDir) {
    legacySkillRoots.push(path.join(targetRoot, agent.altSkillsDir));
  }

  for (const skillRoot of legacySkillRoots) {
    const legacySkillPath = path.join(skillRoot, LEGACY_COMMAND_SKILL);
    if (fs.existsSync(legacySkillPath)) {
      fs.rmSync(legacySkillPath, { recursive: true, force: true });
    }
  }
}

function installPromptCommands(targetRoot, agent) {
  const src = path.join(PACKAGE_ROOT, COPILOT_COMMANDS_DIR);
  const dest = path.join(targetRoot, agent.commandsDir);

  if (!fs.existsSync(src)) {
    throw new Error(`Copilot prompt templates not found: ${COPILOT_COMMANDS_DIR}`);
  }

  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });

  return fs
    .readdirSync(dest)
    .filter((name) => name.endsWith(".prompt.md"))
    .map((name) => path.join(agent.commandsDir, name).replace(/\\/g, "/"));
}

function installTomlCommands(targetRoot, agent) {
  const src = path.join(PACKAGE_ROOT, GEMINI_COMMANDS_DIR);
  const dest = path.join(targetRoot, agent.commandsDir);

  if (!fs.existsSync(src)) {
    throw new Error(`Gemini command templates not found: ${GEMINI_COMMANDS_DIR}`);
  }

  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });

  const installed = [];

  function collect(relativeDir) {
    const current = path.join(dest, relativeDir);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextRelative = relativeDir
        ? path.join(relativeDir, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        collect(nextRelative);
        continue;
      }

      if (entry.name.endsWith(".toml")) {
        installed.push(
          path.join(agent.commandsDir, nextRelative).replace(/\\/g, "/"),
        );
      }
    }
  }

  collect("");
  return installed;
}

function installCommand(targetRoot, agent) {
  removeLegacyCommand(targetRoot, agent);

  if (agent.commandMode === "skill") {
    return [];
  }

  if (agent.commandMode === "toml") {
    return installTomlCommands(targetRoot, agent);
  }

  if (agent.commandMode === "prompt") {
    return installPromptCommands(targetRoot, agent);
  }

  const dest = path.join(targetRoot, agent.commandsDir, COMMAND_FILE);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(PACKAGE_ROOT, COMMAND_TEMPLATE), dest);

  return [path.relative(targetRoot, dest)];
}

function installAgentsLayer(targetRoot, agents, options) {
  const installed = [];
  const { installOpenCodeSubagents } = require("./opencode");

  for (const agent of agents) {
    if (options.command) {
      for (const dest of installFxmindAgentSkill(targetRoot, agent)) {
        installed.push({ agent: agent.label, path: dest, kind: "skill" });
      }
    }

    if (options.command) {
      for (const dest of installCommand(targetRoot, agent)) {
        installed.push({ agent: agent.label, path: dest, kind: "command" });
      }
    }

    if (options.command && agent.id === "opencode") {
      for (const dest of installOpenCodeSubagents(targetRoot)) {
        const normalized = dest.replace(/\\/g, "/");
        const kind = normalized.includes("/instructions/") ? "instruction" : "subagent";
        installed.push({ agent: agent.label, path: normalized, kind });
      }
    }
  }

  return installed;
}

module.exports = {
  resolveAgents,
  readInstalledManifest,
  hasAgentInstall,
  detectInstalledAgents,
  listInstalledAgentIds,
  readManifestAgentIds,
  resolveInstallAgentIds,
  detectInstalledSkills,
  detectInstalledCommand,
  resolveUpdateAgentIds,
  resolveUpdateOptions,
  removePackSkillsFromAgentDirs,
  installFxmindAgentSkill,
  removeLegacyCommand,
  installPromptCommands,
  installTomlCommands,
  installCommand,
  installAgentsLayer,
};
