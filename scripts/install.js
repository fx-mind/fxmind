#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { npxInstall, globalInstall } = require("./constants");
const {
  listPackIds,
  listPacks,
  getPack,
  getDefaultPackIds,
  getDefaultSkillsForPacks,
  validatePackIds,
} = require("./packs");
const {
  PACKAGE_ROOT,
  buildSkillSources,
} = require("./resolve-packs");

let SKILL_SOURCES = new Map();

const DEFAULT_AGENTS = ["cursor"];

const COMMAND_FILE = "fxmind.md";
const COMMAND_SKILL_NAME = "fxmind";
const COMMAND_TEMPLATE = path.join("templates", "commands", COMMAND_FILE);
const LEGACY_COMMAND_FILE = "fivem.md";
const LEGACY_COMMAND_SKILL = "fivem";
const LEGACY_COMMAND_FILE_DEV = "fivem-dev.md";
const LEGACY_COMMAND_SKILL_DEV = "fivem-dev";
const REFERENCE_TEMPLATES_DIR = path.join("templates", "rules");
const FXMIND_TEMPLATES_DIR = path.join("templates", "fxmind");
const GEMINI_COMMANDS_DIR = path.join("templates", "commands", "gemini");
const CORE_TEMPLATE_FILES = [
  "reference.template.mdc",
  "memory.template.md",
  "memory-index.template.md",
  "memory-health.template.md",
  "knowledge-graph.html",
];
const LEGACY_TEMPLATE_FILES = [
  "reference.example.mdc",
  "audit.template.md",
  "topic-catalog.md",
];
const LEGACY_FIVEM_FILES = [
  "knowledge-graph.template.html",
  "knowledge-graph.data.json",
  "knowledge-graph.live.json",
  "graph-data.json",
  "live-graph.json",
  "build-knowledge-graph.js",
  "build-knowledge-graph.mjs",
  "build-knowledge-graph.cjs",
  "build-knowledge-graph.py",
  "generate-knowledge-graph.js",
  "generate-knowledge-graph.py",
  "update-knowledge-graph.js",
  "update-knowledge-graph.py",
  path.join("scripts", "build-knowledge-graph.js"),
  path.join("scripts", "build-knowledge-graph.mjs"),
  path.join("scripts", "build-knowledge-graph.cjs"),
  path.join("scripts", "build-knowledge-graph.py"),
  path.join("scripts", "generate-knowledge-graph.js"),
  path.join("scripts", "generate-knowledge-graph.py"),
  path.join("scripts", "update-knowledge-graph.js"),
  path.join("scripts", "update-knowledge-graph.py"),
];
const SHARED_DIR = ".fxmind";
const LEGACY_SHARED_DIRS = [".fivem"];

const LEGACY_AGENT_FIVEM_DIRS = [
  path.join(".cursor", "fivem"),
  path.join(".gemini", "fivem"),
  path.join(".opencode", "fivem"),
];

const AGENTS = {
  cursor: {
    label: "Cursor",
    skillsDir: path.join(".cursor", "skills"),
    commandsDir: path.join(".cursor", "commands"),
    commandMode: "file",
  },
  claude: {
    label: "Claude Code",
    skillsDir: path.join(".claude", "skills"),
    commandsDir: path.join(".claude", "commands"),
    commandMode: "file",
  },
  codex: {
    label: "Codex",
    skillsDir: path.join(".agents", "skills"),
    altSkillsDir: path.join(".codex", "skills"),
    commandMode: "skill",
  },
  gemini: {
    label: "Gemini CLI",
    skillsDir: path.join(".gemini", "skills"),
    altSkillsDir: path.join(".agents", "skills"),
    commandsDir: path.join(".gemini", "commands"),
    commandMode: "toml",
  },
  opencode: {
    label: "OpenCode",
    skillsDir: path.join(".opencode", "skills"),
    commandsDir: path.join(".opencode", "commands"),
    commandMode: "file",
  },
};

function printHelp() {
  console.log(`
Install fxmind — project memory and knowledge packs for AI agents (Cursor, Claude Code, Codex, Gemini CLI, OpenCode).

Knowledge packs add domain-specific Agent Skills and templates (e.g. fivem for FiveM).

Recommended (install once globally, then use short command):
  ${globalInstall()}
  fxmind -y

Without global install:
  ${npxInstall()}                    Interactive mode (packs, agents, skills)
  ${npxInstall("-y")}                Core + fivem pack (default skills)
  ${npxInstall("--no-packs -y")}     Core /fxmind only — no domain skills
  ${npxInstall("--pack fivem -y")}   Explicit fivem knowledge pack
  ${npxInstall("--all-packs -y")}    Every available pack
  ${npxInstall("--all -y")}          All skills from selected pack(s)

Local dev (monorepo):
  node scripts/install.js --target ./my-project --pack fivem -y

Options:
  --target <dir>     Project root (default: current directory)
  --pack <id>        Knowledge pack to install (e.g. fivem)
  --packs <list>     Comma-separated packs (e.g. fivem)
  --all-packs        Install every available knowledge pack
  --no-packs         Core fxmind only — skip domain skills and pack templates
  --skills-dir <dir> Legacy: skills folder (only when a single pack is selected)
  --skills <list>    Comma-separated skill names (skips interactive)
  --all              Install every skill (skips interactive)
  --cursor           Install for Cursor only
  --claude           Install for Claude Code only
  --codex            Install for Codex only
  --gemini           Install for Gemini CLI only
  --opencode         Install for OpenCode only
  --agent <list>     Comma-separated: cursor, claude, codex, gemini, opencode
  --no-command       Skip /fxmind helper
  -i, --interactive  Force interactive mode
  -y, --yes          Skip prompts, use defaults
  -h, --help         Show this help

Interactive mode (default in terminal):
  1. Select knowledge packs (fivem, …)
  2. Select agents (Cursor, Claude, Codex, Gemini CLI, OpenCode)
  3. Select skills from chosen packs
  4. Confirm /fxmind helper
`);
}

function parseArgs(argv) {
  const options = {
    target: process.cwd(),
    skills: [],
    packs: null,
    skillsDir: null,
    agents: null,
    all: false,
    allPacks: false,
    noPacks: false,
    command: true,
    help: false,
    yes: false,
    interactive: false,
    explicitSkills: false,
    explicitAgents: false,
    explicitPacks: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-y" || arg === "--yes") {
      options.yes = true;
      continue;
    }

    if (arg === "-i" || arg === "--interactive") {
      options.interactive = true;
      continue;
    }

    if (arg === "--all") {
      options.all = true;
      options.explicitSkills = true;
      continue;
    }

    if (arg === "--no-command") {
      options.command = false;
      continue;
    }

    if (arg === "--cursor") {
      options.agents = ["cursor"];
      options.explicitAgents = true;
      continue;
    }

    if (arg === "--claude") {
      options.agents = ["claude"];
      options.explicitAgents = true;
      continue;
    }

    if (arg === "--codex") {
      options.agents = ["codex"];
      options.explicitAgents = true;
      continue;
    }

    if (arg === "--gemini") {
      options.agents = ["gemini"];
      options.explicitAgents = true;
      continue;
    }

    if (arg === "--opencode") {
      options.agents = ["opencode"];
      options.explicitAgents = true;
      continue;
    }

    if (arg === "--agent" || arg === "-a") {
      const value = argv[i + 1] || "";
      options.agents = value
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      options.explicitAgents = true;
      i += 1;
      continue;
    }

    if (arg === "--no-packs") {
      options.noPacks = true;
      options.packs = [];
      options.explicitPacks = true;
      continue;
    }

    if (arg === "--all-packs") {
      options.allPacks = true;
      options.explicitPacks = true;
      continue;
    }

    if (arg === "--pack" || arg === "--packs") {
      const value = argv[i + 1] || "";
      options.packs = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      options.explicitPacks = true;
      i += 1;
      continue;
    }

    if (arg === "--skills-dir") {
      options.skillsDir = path.resolve(argv[i + 1] || "");
      i += 1;
      continue;
    }

    if (arg === "--target") {
      options.target = path.resolve(argv[i + 1] || "");
      i += 1;
      continue;
    }

    if (arg === "--skills") {
      const value = argv[i + 1] || "";
      options.skills = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      options.explicitSkills = true;
      i += 1;
      continue;
    }
  }

  return options;
}

function wantsInteractive(options) {
  if (options.yes) return false;
  if (options.interactive) return true;
  if (options.explicitSkills || options.explicitAgents || options.explicitPacks) {
    return false;
  }
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function ensureNonInteractiveChoice(options) {
  if (options.yes || options.explicitAgents) {
    return;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    return;
  }

  console.error(
    "Non-interactive terminal detected. Choose one:\n" +
      `  ${npxInstall("-y")}\n` +
      `  ${npxInstall("--cursor")}\n` +
      `  ${npxInstall("--agent cursor,claude,gemini")}\n`,
  );
  process.exit(1);
}

function getManagedSkillNames(skills, includeCommand) {
  const names = new Set(skills);
  if (includeCommand) {
    names.add(COMMAND_SKILL_NAME);
    names.add(LEGACY_COMMAND_SKILL);
    names.add(LEGACY_COMMAND_SKILL_DEV);
  }
  return names;
}

function isDirEmpty(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }

  return fs.readdirSync(dirPath).length === 0;
}

function pruneEmptyDirsUpward(dirPath, stopAt) {
  let current = dirPath;

  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!fs.existsSync(current) || !isDirEmpty(current)) {
      break;
    }

    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function removeFivemFiles(targetRoot, relativeDestDir, fileNames) {
  const removed = [];

  for (const fileName of fileNames) {
    const filePath = path.join(targetRoot, relativeDestDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    fs.rmSync(filePath, { recursive: true, force: true });
    removed.push(path.relative(targetRoot, filePath));
  }

  pruneEmptyDirsUpward(path.join(targetRoot, relativeDestDir), targetRoot);
  return removed;
}

function cleanLegacyFivemFiles(targetRoot, relativeDestDir) {
  return removeFivemFiles(targetRoot, relativeDestDir, LEGACY_FIVEM_FILES);
}

function cleanUnselectedAgents(targetRoot, selectedAgentIds, managedSkills) {
  for (const [agentId, agent] of Object.entries(AGENTS)) {
    if (selectedAgentIds.includes(agentId)) {
      continue;
    }

    if (agent.commandsDir && agent.commandMode === "file") {
      for (const fileName of [COMMAND_FILE, LEGACY_COMMAND_FILE, LEGACY_COMMAND_FILE_DEV]) {
        const commandPath = path.join(targetRoot, agent.commandsDir, fileName);
        if (fs.existsSync(commandPath)) {
          fs.unlinkSync(commandPath);
        }
      }

      pruneEmptyDirsUpward(
        path.join(targetRoot, agent.commandsDir),
        targetRoot,
      );
    }

    if (agent.commandsDir && agent.commandMode === "toml") {
      const commandPaths = [
        path.join(targetRoot, agent.commandsDir, "fxmind.toml"),
        path.join(targetRoot, agent.commandsDir, "fxmind"),
        path.join(targetRoot, agent.commandsDir, "fivem.toml"),
        path.join(targetRoot, agent.commandsDir, "fivem"),
      ];

      for (const commandPath of commandPaths) {
        if (fs.existsSync(commandPath)) {
          fs.rmSync(commandPath, { recursive: true, force: true });
        }
      }

      pruneEmptyDirsUpward(
        path.join(targetRoot, agent.commandsDir),
        targetRoot,
      );
    }

    const skillRoots = [path.join(targetRoot, agent.skillsDir)];
    if (agent.altSkillsDir) {
      skillRoots.push(path.join(targetRoot, agent.altSkillsDir));
    }

    for (const skillRoot of skillRoots) {
      for (const skillName of managedSkills) {
        const skillPath = path.join(skillRoot, skillName);
        if (fs.existsSync(skillPath)) {
          fs.rmSync(skillPath, { recursive: true, force: true });
        }
      }

      pruneEmptyDirsUpward(skillRoot, targetRoot);
    }
  }
}

function getSkillDescription(skillName) {
  const source = SKILL_SOURCES.get(skillName);
  if (!source) {
    return skillName;
  }

  const skillPath = path.join(source.skillsDir, skillName, "SKILL.md");

  if (!fs.existsSync(skillPath)) {
    return skillName;
  }

  const content = fs.readFileSync(skillPath, "utf8");
  const match = content.match(/^description:\s*(.+)$/m);

  if (!match) {
    return skillName;
  }

  return match[1].trim().replace(/^["']|["']$/g, "");
}

async function promptSelections() {
  const { checkbox, confirm } = await import("@inquirer/prompts");
  const { CancelPromptError } = await import("@inquirer/core");

  console.log("fxmind Installer\n");
  console.log("Tip: Space to toggle, Enter to confirm.\n");

  try {
    const selectedPacks = await checkbox({
      message: "Select knowledge packs",
      choices: listPacks().map((pack) => ({
        name: truncate(`${pack.label} — ${pack.description}`, 90),
        value: pack.id,
        checked: getDefaultPackIds().includes(pack.id),
      })),
      loop: false,
      required: false,
    });

    const packSources =
      selectedPacks.length > 0
        ? buildSkillSources(selectedPacks, {})
        : new Map();
    const allSkills = [...packSources.keys()].sort();
    const defaultSkills = getDefaultSkillsForPacks(selectedPacks);
    const savedSources = SKILL_SOURCES;
    SKILL_SOURCES = packSources;

    const selectedAgents = await checkbox({
      message: "Select agents",
      choices: Object.entries(AGENTS).map(([value, agent]) => ({
        name: agent.label,
        value,
        checked: value === "cursor",
      })),
      loop: false,
      required: true,
    });

    if (selectedAgents.length === 0) {
      return null;
    }

    const selectedSkills =
      allSkills.length > 0
        ? await checkbox({
            message: "Select skills to install",
            choices: allSkills.map((name) => ({
              name: truncate(`${name} — ${getSkillDescription(name)}`, 90),
              value: name,
              checked: defaultSkills.includes(name),
            })),
            loop: false,
            required: true,
          })
        : [];

    if (allSkills.length > 0 && selectedSkills.length === 0) {
      return null;
    }

    const installCommand = await confirm({
      message:
        "Install /fxmind helper (/fxmind, /fxmind reference, /fxmind audit, /fxmind learn, /fxmind memory health, /fxmind graph)?",
      default: true,
    });

    SKILL_SOURCES = savedSources;

    return {
      packs: [...new Set(selectedPacks)],
      agents: [...new Set(selectedAgents)],
      skills: [...new Set(selectedSkills)],
      command: installCommand,
      packSources,
    };
  } catch (error) {
    if (error instanceof CancelPromptError) {
      return null;
    }
    throw error;
  }
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

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

function listAllSkills() {
  return [...SKILL_SOURCES.keys()].sort();
}

function getSkillsDirForSkill(skillName) {
  const source = SKILL_SOURCES.get(skillName);
  if (!source) {
    throw new Error(`Skill not found in selected packs: ${skillName}`);
  }
  return source.skillsDir;
}

function copyDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function readCommandSource() {
  const src = path.join(PACKAGE_ROOT, COMMAND_TEMPLATE);
  if (!fs.existsSync(src)) {
    throw new Error(`Command template not found: ${COMMAND_TEMPLATE}`);
  }
  return fs.readFileSync(src, "utf8");
}

function toCodexSkillContent(content) {
  if (/^---[\s\S]*?name:/m.test(content)) {
    return content;
  }

  return content.replace(
    /^---\n/,
    `---\nname: ${COMMAND_SKILL_NAME}\n`,
  );
}

function installSkill(skillName, targetRoot, agent) {
  const src = path.join(getSkillsDirForSkill(skillName), skillName);

  if (!fs.existsSync(src)) {
    throw new Error(`Skill not found in package: ${skillName}`);
  }

  if (!fs.existsSync(path.join(src, "SKILL.md"))) {
    throw new Error(`Invalid skill (missing SKILL.md): ${skillName}`);
  }

  const destinations = [path.join(targetRoot, agent.skillsDir, skillName)];

  if (agent.altSkillsDir) {
    destinations.push(path.join(targetRoot, agent.altSkillsDir, skillName));
  }

  for (const dest of destinations) {
    copyDir(src, dest);
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

function parseFrontmatterUpdated(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return null;
  }

  const updated = match[1].match(/^updated:\s*(.+)$/m);
  if (!updated) {
    return null;
  }

  return updated[1].trim().replace(/^["']|["']$/g, "");
}

function parseUpdatedTimestamp(value) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseIndexRows(content) {
  const rows = new Map();
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith("|") || line.includes("Topic |") || line.includes("---")) {
      continue;
    }

    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length < 4 || cells[0].startsWith("_(")) {
      continue;
    }

    rows.set(cells[0].toLowerCase(), {
      topic: cells[0],
      file: cells[1],
      triggers: cells[2],
      updated: cells[3],
      line,
    });
  }

  return rows;
}

function mergeIndexTables(targetRoot, relativeDestDir, legacyDirs) {
  const indexPath = path.join(targetRoot, relativeDestDir, "memory", "_index.md");
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  let merged = parseIndexRows(fs.readFileSync(indexPath, "utf8"));

  for (const legacyDir of legacyDirs) {
    const legacyIndexPath = path.join(targetRoot, legacyDir, "memory", "_index.md");
    if (!fs.existsSync(legacyIndexPath)) {
      continue;
    }

    const legacyRows = parseIndexRows(fs.readFileSync(legacyIndexPath, "utf8"));

    for (const [topicKey, row] of legacyRows) {
      const existing = merged.get(topicKey);
      if (!existing) {
        merged.set(topicKey, {
          ...row,
          file: `.fxmind/memory/${topicKey}.md`,
        });
        continue;
      }

      if (
        parseUpdatedTimestamp(row.updated) >
        parseUpdatedTimestamp(existing.updated)
      ) {
        merged.set(topicKey, {
          ...row,
          file: `.fxmind/memory/${topicKey}.md`,
        });
      }
    }
  }

  const header = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);
  const preamble = [];
  for (const line of header) {
    preamble.push(line);
    if (line.startsWith("|-------")) {
      break;
    }
  }

  const body = [...merged.values()]
    .sort((a, b) => a.topic.localeCompare(b.topic))
    .map(
      (row) =>
        `| ${row.topic} | ${row.file} | ${row.triggers} | ${row.updated} |`,
    );

  const restStart = header.findIndex((line) => line.startsWith("Catalog:"));
  const rest = restStart >= 0 ? header.slice(restStart) : [];

  fs.writeFileSync(
    indexPath,
    [...preamble, ...body, "", ...rest].join("\n"),
    "utf8",
  );

  return path.relative(targetRoot, indexPath);
}

function migrateLegacyMemories(targetRoot) {
  const sharedMemoryDir = path.join(targetRoot, SHARED_DIR, "memory");
  const actions = [];

  fs.mkdirSync(sharedMemoryDir, { recursive: true });

  for (const legacyDir of LEGACY_AGENT_FIVEM_DIRS) {
    const legacyMemoryDir = path.join(targetRoot, legacyDir, "memory");
    if (!fs.existsSync(legacyMemoryDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(legacyMemoryDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "_index.md") {
        continue;
      }

      const legacyPath = path.join(legacyMemoryDir, entry.name);
      const sharedPath = path.join(sharedMemoryDir, entry.name);
      const legacyContent = fs.readFileSync(legacyPath, "utf8");
      const legacyUpdated = parseUpdatedTimestamp(
        parseFrontmatterUpdated(legacyContent),
      );

      if (!fs.existsSync(sharedPath)) {
        fs.copyFileSync(legacyPath, sharedPath);
        actions.push({
          type: "migrated",
          from: path.relative(targetRoot, legacyPath),
          to: path.relative(targetRoot, sharedPath),
        });
        continue;
      }

      const sharedContent = fs.readFileSync(sharedPath, "utf8");
      const sharedUpdated = parseUpdatedTimestamp(
        parseFrontmatterUpdated(sharedContent),
      );

      if (legacyUpdated > sharedUpdated) {
        fs.copyFileSync(legacyPath, sharedPath);
        actions.push({
          type: "merged",
          from: path.relative(targetRoot, legacyPath),
          to: path.relative(targetRoot, sharedPath),
        });
      } else {
        actions.push({
          type: "skipped",
          file: path.relative(targetRoot, sharedPath),
        });
      }
    }
  }

  const mergedIndex = mergeIndexTables(
    targetRoot,
    SHARED_DIR,
    LEGACY_AGENT_FIVEM_DIRS,
  );

  return { actions, mergedIndex };
}

function cleanLegacyAgentMemories(targetRoot) {
  const removed = [];
  const sharedMemoryDir = path.join(targetRoot, SHARED_DIR, "memory");

  for (const legacyDir of LEGACY_AGENT_FIVEM_DIRS) {
    const legacyMemoryDir = path.join(targetRoot, legacyDir, "memory");
    if (!fs.existsSync(legacyMemoryDir)) {
      continue;
    }

    for (const name of fs.readdirSync(legacyMemoryDir)) {
      if (!name.endsWith(".md")) {
        continue;
      }

      const legacyPath = path.join(legacyMemoryDir, name);
      if (!fs.existsSync(legacyPath) || !fs.statSync(legacyPath).isFile()) {
        continue;
      }

      if (name === "_index.md") {
        fs.unlinkSync(legacyPath);
        removed.push(path.relative(targetRoot, legacyPath));
        continue;
      }

      const sharedPath = path.join(sharedMemoryDir, name);
      if (fs.existsSync(sharedPath)) {
        fs.unlinkSync(legacyPath);
        removed.push(path.relative(targetRoot, legacyPath));
      }
    }

    if (fs.existsSync(legacyMemoryDir) && isDirEmpty(legacyMemoryDir)) {
      fs.rmdirSync(legacyMemoryDir);
      removed.push(path.relative(targetRoot, legacyMemoryDir));
    }

    pruneEmptyDirsUpward(path.join(targetRoot, legacyDir), targetRoot);
  }

  return removed;
}

function parseGraphMeta(filePath) {
  if (!fs.existsSync(filePath)) {
    return { nodes: 0, generatedAt: 0 };
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      nodes: Array.isArray(data.nodes) ? data.nodes.length : 0,
      generatedAt: parseUpdatedTimestamp(data.meta?.generatedAt),
    };
  } catch {
    return { nodes: 0, generatedAt: 0 };
  }
}

function syncKnowledgeGraphHtml(targetRoot, graphData) {
  const htmlPath = path.join(targetRoot, SHARED_DIR, "knowledge-graph.html");
  if (!fs.existsSync(htmlPath)) {
    return;
  }

  const graphJsonStr = JSON.stringify(graphData, null, 2);
  let html = fs.readFileSync(htmlPath, "utf8");

  if (html.includes("/*__GRAPH_DATA__*/")) {
    html = html.replace("/*__GRAPH_DATA__*/", graphJsonStr);
  } else {
    html = html.replace(
      /const GRAPH_DATA = [\s\S]*?;\s*\n/,
      `const GRAPH_DATA = ${graphJsonStr};\n`,
    );
  }

  fs.writeFileSync(htmlPath, html, "utf8");
}

function shouldPreferLegacyArtifact(legacyPath, sharedPath) {
  if (!fs.existsSync(legacyPath)) {
    return false;
  }

  if (!fs.existsSync(sharedPath)) {
    return true;
  }

  return fs.statSync(legacyPath).mtimeMs > fs.statSync(sharedPath).mtimeMs;
}

function migrateAndCleanLegacyAgentArtifacts(targetRoot) {
  const migrated = [];
  const removed = [];
  const sharedDir = path.join(targetRoot, SHARED_DIR);

  for (const legacyDir of LEGACY_AGENT_FIVEM_DIRS) {
    const legacyFull = path.join(targetRoot, legacyDir);
    if (!fs.existsSync(legacyFull)) {
      continue;
    }

    const legacyGraph = path.join(legacyFull, "knowledge-graph.json");
    const sharedGraph = path.join(sharedDir, "knowledge-graph.json");
    if (fs.existsSync(legacyGraph)) {
      const legacyMeta = parseGraphMeta(legacyGraph);
      const sharedMeta = parseGraphMeta(sharedGraph);
      const preferLegacy =
        !fs.existsSync(sharedGraph) ||
        legacyMeta.nodes > sharedMeta.nodes ||
        (legacyMeta.nodes === sharedMeta.nodes &&
          legacyMeta.generatedAt > sharedMeta.generatedAt);

      if (preferLegacy) {
        fs.copyFileSync(legacyGraph, sharedGraph);
        try {
          const graphData = JSON.parse(fs.readFileSync(sharedGraph, "utf8"));
          graphData.meta = {
            ...(graphData.meta || {}),
            agent: "shared",
            fxmindDir: SHARED_DIR,
          };
          fs.writeFileSync(sharedGraph, `${JSON.stringify(graphData, null, 2)}\n`, "utf8");
          syncKnowledgeGraphHtml(targetRoot, graphData);
        } catch {
          // keep copied file as-is
        }
        migrated.push(path.relative(targetRoot, sharedGraph));
      }
    }

    for (const name of ["memory-health.md"]) {
      const legacyPath = path.join(legacyFull, name);
      const sharedPath = path.join(sharedDir, name);
      if (shouldPreferLegacyArtifact(legacyPath, sharedPath)) {
        fs.copyFileSync(legacyPath, sharedPath);
        migrated.push(path.relative(targetRoot, sharedPath));
      }
    }

    for (const name of fs.readdirSync(legacyFull)) {
      if (!name.startsWith("audit-") || !name.endsWith(".md")) {
        continue;
      }

      const legacyPath = path.join(legacyFull, name);
      const sharedPath = path.join(sharedDir, name);
      if (shouldPreferLegacyArtifact(legacyPath, sharedPath)) {
        fs.copyFileSync(legacyPath, sharedPath);
        migrated.push(path.relative(targetRoot, sharedPath));
      }
    }

    for (const entry of fs.readdirSync(legacyFull, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      const legacyPath = path.join(legacyFull, entry.name);
      fs.unlinkSync(legacyPath);
      removed.push(path.relative(targetRoot, legacyPath));
    }

    pruneEmptyDirsUpward(legacyFull, targetRoot);
  }

  return { migrated, removed };
}

function migrateLegacySharedDir(targetRoot) {
  const actions = [];
  const sharedDir = path.join(targetRoot, SHARED_DIR);
  fs.mkdirSync(sharedDir, { recursive: true });

  for (const legacySharedDir of LEGACY_SHARED_DIRS) {
    const legacyFull = path.join(targetRoot, legacySharedDir);
    if (!fs.existsSync(legacyFull)) {
      continue;
    }

    for (const entry of fs.readdirSync(legacyFull, { withFileTypes: true })) {
      const legacyPath = path.join(legacyFull, entry.name);
      const sharedPath = path.join(sharedDir, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(sharedPath, { recursive: true });
        for (const child of fs.readdirSync(legacyPath, { withFileTypes: true })) {
          if (!child.isFile()) {
            continue;
          }
          const childLegacy = path.join(legacyPath, child.name);
          const childShared = path.join(sharedPath, child.name);
          if (
            !fs.existsSync(childShared) ||
            fs.statSync(childLegacy).mtimeMs > fs.statSync(childShared).mtimeMs
          ) {
            fs.copyFileSync(childLegacy, childShared);
            actions.push({
              type: "migrated",
              from: path.relative(targetRoot, childLegacy),
              to: path.relative(targetRoot, childShared),
            });
          }
        }
        continue;
      }

      if (
        !fs.existsSync(sharedPath) ||
        fs.statSync(legacyPath).mtimeMs > fs.statSync(sharedPath).mtimeMs
      ) {
        fs.copyFileSync(legacyPath, sharedPath);
        actions.push({
          type: "migrated",
          from: path.relative(targetRoot, legacyPath),
          to: path.relative(targetRoot, sharedPath),
        });
      }
    }

    fs.rmSync(legacyFull, { recursive: true, force: true });
    actions.push({
      type: "removed",
      path: path.relative(targetRoot, legacyFull),
    });
  }

  return actions;
}

function installSharedFxmind(targetRoot, packIds) {
  const relativeDestDir = SHARED_DIR;
  const destDir = path.join(targetRoot, relativeDestDir);
  const removed = cleanLegacyFivemFiles(targetRoot, relativeDestDir);
  const templates = CORE_TEMPLATE_FILES.map((fileName) => [
    fileName === "reference.template.mdc"
      ? REFERENCE_TEMPLATES_DIR
      : FXMIND_TEMPLATES_DIR,
    fileName,
  ]);
  const installed = [];

  for (const [srcDir, fileName] of templates) {
    const src = path.join(PACKAGE_ROOT, srcDir, fileName);
    if (!fs.existsSync(src)) {
      continue;
    }

    const dest = path.join(destDir, fileName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (fileName === "knowledge-graph.html") {
      const emptyGraph = {
        nodes: [],
        links: [],
        meta: {
          generatedAt: "",
          agent: "shared",
          fxmindDir: SHARED_DIR,
          counts: { learned: 0, catalog: 0, links: 0, tokens: 0 },
        },
      };
      const emptyGraphJson = JSON.stringify(emptyGraph, null, 2);
      const html = fs
        .readFileSync(src, "utf8")
        .replace("/*__GRAPH_DATA__*/", emptyGraphJson);
      fs.writeFileSync(dest, html, "utf8");

      const jsonDest = path.join(destDir, "knowledge-graph.json");
      if (!fs.existsSync(jsonDest)) {
        fs.writeFileSync(jsonDest, `${emptyGraphJson}\n`, "utf8");
        installed.push(path.relative(targetRoot, jsonDest));
      }
    } else {
      fs.copyFileSync(src, dest);
    }

    installed.push(path.relative(targetRoot, dest));
  }

  const memoryIndex = seedMemoryIndex(targetRoot, relativeDestDir);
  if (memoryIndex) {
    installed.push(memoryIndex);
  }

  for (const packId of packIds) {
    const pack = getPack(packId);
    for (const fileName of pack.templateFiles || []) {
      const src = path.join(pack.templatesDir, fileName);
      if (!fs.existsSync(src)) {
        continue;
      }

      const dest = path.join(destDir, fileName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      installed.push(path.relative(targetRoot, dest));
    }
  }

  writePacksManifest(targetRoot, packIds);
  installed.push(path.join(relativeDestDir, "packs.json").replace(/\\/g, "/"));

  return { installed, removed };
}

function writePacksManifest(targetRoot, packIds) {
  const manifest = {
    version: 1,
    packs: packIds.map((id) => {
      const pack = getPack(id);
      return { id, label: pack.label };
    }),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(targetRoot, SHARED_DIR, "packs.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function getAllTemplateFileNames(packIds) {
  const names = new Set([...CORE_TEMPLATE_FILES, ...LEGACY_TEMPLATE_FILES]);
  for (const packId of packIds) {
    for (const fileName of getPack(packId).templateFiles || []) {
      names.add(fileName);
    }
  }
  return [...names];
}

function cleanLegacyAgentFivemTemplates(targetRoot, packIds) {
  const removed = [];
  const templateFiles = getAllTemplateFileNames(packIds);

  for (const legacyDir of LEGACY_AGENT_FIVEM_DIRS) {
    removed.push(...cleanLegacyFivemFiles(targetRoot, legacyDir));
    removed.push(
      ...removeFivemFiles(targetRoot, legacyDir, templateFiles),
    );
  }

  return removed;
}

function seedMemoryIndex(targetRoot, relativeDestDir) {
  const memoryDir = path.join(targetRoot, relativeDestDir, "memory");
  const indexPath = path.join(memoryDir, "_index.md");

  if (fs.existsSync(indexPath)) {
    return null;
  }

  const templatePath = path.join(
    PACKAGE_ROOT,
    FXMIND_TEMPLATES_DIR,
    "memory-index.template.md",
  );

  if (!fs.existsSync(templatePath)) {
    return null;
  }

  fs.mkdirSync(memoryDir, { recursive: true });
  fs.copyFileSync(templatePath, indexPath);

  return path.relative(targetRoot, indexPath);
}

function cleanFivemTemplates(targetRoot, relativeDestDir, packIds) {
  removeFivemFiles(
    targetRoot,
    relativeDestDir,
    [...getAllTemplateFileNames(packIds), ...LEGACY_FIVEM_FILES],
  );

  // Never delete user-generated memory/*.md — only prune empty memory/ if no files left
  const memoryDir = path.join(targetRoot, relativeDestDir, "memory");
  if (fs.existsSync(memoryDir) && isDirEmpty(memoryDir)) {
    fs.rmdirSync(memoryDir);
  }

  pruneEmptyDirsUpward(path.join(targetRoot, relativeDestDir), targetRoot);
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

  const content = readCommandSource();

  if (agent.commandMode === "skill") {
    const skillContent = toCodexSkillContent(content);
    const destinations = [
      path.join(
        targetRoot,
        agent.skillsDir,
        COMMAND_SKILL_NAME,
        "SKILL.md",
      ),
    ];

    if (agent.altSkillsDir) {
      destinations.push(
        path.join(
          targetRoot,
          agent.altSkillsDir,
          COMMAND_SKILL_NAME,
          "SKILL.md",
        ),
      );
    }

    for (const dest of destinations) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, skillContent, "utf8");
    }

    return destinations.map((dest) => path.relative(targetRoot, dest));
  }

  if (agent.commandMode === "toml") {
    return installTomlCommands(targetRoot, agent);
  }

  const dest = path.join(targetRoot, agent.commandsDir, COMMAND_FILE);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(PACKAGE_ROOT, COMMAND_TEMPLATE), dest);

  return [path.relative(targetRoot, dest)];
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

  SKILL_SOURCES =
    options.packs.length > 0
      ? buildSkillSources(options.packs, options)
      : new Map();

  if (options.all && options.packs.length > 0) {
    options.skills = listAllSkills();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!fs.existsSync(options.target)) {
    console.error(`Error: target directory does not exist: ${options.target}`);
    process.exit(1);
  }

  if (wantsInteractive(options)) {
    const selections = await promptSelections();

    if (!selections) {
      console.log("Installation cancelled.");
      process.exit(0);
    }

    options.packs = selections.packs;
    options.agents = selections.agents;
    options.skills = selections.skills;
    options.command = selections.command;
    SKILL_SOURCES = selections.packSources;

    console.log(
      `\nPacks: ${selections.packs.length ? selections.packs.join(", ") : "(core only)"}`,
    );
    console.log(
      `Agents: ${selections.agents.map((id) => AGENTS[id].label).join(", ")}`,
    );
    console.log(
      `Skills: ${selections.skills.length ? selections.skills.join(", ") : "(none)"}`,
    );
    console.log(`Helper /fxmind: ${selections.command ? "yes" : "no"}\n`);
  } else {
    ensureNonInteractiveChoice(options);

    if (!options.agents) {
      options.agents = [...DEFAULT_AGENTS];
    }

    try {
      resolvePackOptions(options);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  const skills = options.skills;
  const packs = options.packs;
  const agents = resolveAgents(options.agents);
  const managedSkills = getManagedSkillNames(skills, options.command);

  if (skills.length === 0 && !options.command) {
    console.error("Error: select at least one skill or keep /fxmind helper enabled.");
    process.exit(1);
  }

  cleanUnselectedAgents(
    options.target,
    agents.map((agent) => agent.id),
    managedSkills,
  );

  console.log(`\nInstalling to: ${options.target}`);
  if (packs.length > 0) {
    console.log(`Packs: ${packs.join(", ")}`);
    for (const packId of packs) {
      const source = [...SKILL_SOURCES.values()].find((entry) => entry.packId === packId);
      if (source) {
        console.log(`  ${packId} skills → ${source.skillsDir}`);
      }
    }
  } else {
    console.log("Packs: (core only)");
  }
  console.log(
    `Agents: ${agents.map((agent) => agent.label).join(", ")}\n`,
  );

  if (options.command) {
    console.log("[Shared .fxmind]");

    const legacyShared = migrateLegacySharedDir(options.target);
    for (const action of legacyShared) {
      if (action.type === "migrated") {
        console.log(`  ✓ migrated → ${action.to} (from ${action.from})`);
      } else if (action.type === "removed") {
        console.log(`  ✓ removed  → ${action.path} (legacy shared dir)`);
      }
    }

    const shared = installSharedFxmind(options.target, packs);
    for (const dest of shared.removed) {
      console.log(`  ✓ cleanup  → ${dest}`);
    }
    for (const dest of shared.installed) {
      console.log(`  ✓ template → ${dest}`);
    }

    const migration = migrateLegacyMemories(options.target);
    for (const action of migration.actions) {
      if (action.type === "migrated") {
        console.log(`  ✓ migrated → ${action.to} (from ${action.from})`);
      } else if (action.type === "merged") {
        console.log(`  ✓ merged   → ${action.to} (kept newer from ${action.from})`);
      }
    }
    if (migration.mergedIndex) {
      console.log(`  ✓ index    → ${migration.mergedIndex} (merged legacy rows)`);
    }

    const legacyMemoryCleanup = cleanLegacyAgentMemories(options.target);
    for (const dest of legacyMemoryCleanup) {
      console.log(`  ✓ removed  → ${dest}`);
    }

    const legacyArtifacts = migrateAndCleanLegacyAgentArtifacts(options.target);
    for (const dest of legacyArtifacts.migrated) {
      console.log(`  ✓ artifact → ${dest} (from legacy agent folder)`);
    }
    for (const dest of legacyArtifacts.removed) {
      console.log(`  ✓ removed  → ${dest}`);
    }

    const legacyCleanup = cleanLegacyAgentFivemTemplates(options.target, packs);
    for (const dest of legacyCleanup) {
      console.log(`  ✓ legacy   → removed ${dest}`);
    }

    console.log("");
  }

  if (skills.length > 0) {
    for (const agent of agents) {
      console.log(`[${agent.label}]`);

      for (const skill of skills) {
        const dests = installSkill(skill, options.target, agent);
        for (const dest of dests) {
          console.log(`  ✓ skill   → ${dest}`);
        }
      }

      if (options.command) {
        const dests = installCommand(options.target, agent);
        for (const dest of dests) {
          console.log(`  ✓ command → ${dest}`);
        }
      }

      console.log("");
    }
  } else {
    for (const agent of agents) {
      console.log(`[${agent.label}]`);

      if (options.command) {
        const dests = installCommand(options.target, agent);
        for (const dest of dests) {
          console.log(`  ✓ command → ${dest}`);
        }
      }

      console.log("");
    }
  }

  console.log("Done.");
  console.log("Restart your agent IDE/CLI or open a new session.");
  console.log(`Update anytime: ${npxInstall("-y")}  (or after global: fxmind -y)`);
  console.log(
    "Cursor/Claude/OpenCode: /fxmind  |  Codex: $fxmind  |  Gemini: /fxmind, /fxmind:reference, /fxmind:audit, /fxmind:learn, /fxmind:memory, /fxmind:graph",
  );
  console.log("Gemini: run /commands reload after install.");
  console.log(
    "Run /fxmind reference (or /fxmind:reference) to generate reference.mdc at project root.",
  );
  console.log("Run /fxmind audit [scope] for security/perf/pattern audit + fix plan.");
  console.log(
    "Run /fxmind learn <topic> to scan the codebase and save compact English topic memory under .fxmind/memory/ (shared by all agents).",
  );
  console.log(
    "Run /fxmind memory health [fix] [topic] to verify memories vs codebase and optionally compact-rewrite stale topics.",
  );
  console.log(
    "Run /fxmind graph to build a static 3D knowledge map and open it in the browser.",
  );
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
