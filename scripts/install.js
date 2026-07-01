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
  refreshPackSkillsCaches,
} = require("./resolve-packs");
const {
  setupGlobalStore,
  isGlobalStore,
  resolveSkillsRoot,
  GLOBAL_SHARED_SKILLS,
} = require("./global-store");
const { writeLockfile, readLockfile, diffLockfiles, printLockSummary } = require("./lockfile");
const { installHooks, uninstallHooks, hooksStatus, runHooksCli, FXMIND_COMMANDS } = require("./hooks");
const { createPackScaffold, runPackCli } = require("./pack-new");

let SKILL_SOURCES = new Map();

const DEFAULT_AGENTS = ["cursor"];

const COMMAND_FILE = "fxmind.md";
const COMMAND_SKILL_NAME = "fxmind";
const COMMAND_TEMPLATE = path.join("templates", "commands", COMMAND_FILE);
const FXMIND_SKILL_TEMPLATE = path.join("templates", "skills", "fxmind", "SKILL.md");
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
  "audit-procedure.md",
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
const PACK_SKILLS_DIR = path.join(SHARED_DIR, "skills");
const AUDITS_DIR = path.join(SHARED_DIR, "audits");
/** Bump when shared layout changes (e.g. audits/ folder). */
const LAYOUT_VERSION = 2;
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

Knowledge packs add domain-specific skills under \`.fxmind/skills/\` and the fxmind agent skill.

Recommended (install once globally, then use short command):
  ${globalInstall()}
  fxmind -y
  fxmind --update -y
  fxmind graph               Build 3D knowledge graph + open browser
  fxmind graph --no-open     Build graph files only
  fxmind -h

Without global install:
  ${npxInstall()}                    Interactive mode (packs, agents, skills)
  ${npxInstall("-y")}                Core + fivem pack (Cursor only)
  ${npxInstall("--cursor -y")}       Cursor only (explicit)
  ${npxInstall("--claude -y")}       Claude Code only
  ${npxInstall("--codex -y")}        Codex only
  ${npxInstall("--gemini -y")}       Gemini CLI only
  ${npxInstall("--opencode -y")}     OpenCode only
  ${npxInstall("--agent cursor,claude,gemini -y")}  Multiple agents
  ${npxInstall("--no-packs -y")}     Core /fxmind only — no domain skills
  ${npxInstall("--pack fivem -y")}   Explicit fivem knowledge pack
  ${npxInstall("--all-packs -y")}    Every available pack
  ${npxInstall("--all -y")}          All skills from selected pack(s)
  ${npxInstall("--update -y")}       Refresh installed packs, skills, and templates
  ${npxInstall("graph")}             Build graph from .fxmind/memory/ + open browser
  ${npxInstall("--global-store -y")} Install with global store (~/.fxmind/projects/<id>/)
  ${npxInstall("migrate")}            Move legacy audit-*.md → audits/
  ${npxInstall("global list")}       List projects in global store
  ${npxInstall("hooks install")}      Install Cursor hooks (gate-guard, drift-watcher, learn-prompt)
  ${npxInstall("hooks install-git")}  Install git pre-commit drift check only
  ${npxInstall("hooks status")}       Show installed hooks
  ${npxInstall("pack new <id>")}      Scaffold a new knowledge pack under packs/<id>/
  fxmind-mcp                          Run the fxmind MCP server (stdio) for agent tool access

Local dev (monorepo):
  node scripts/install.js --target ./my-project --pack fivem -y
  node scripts/install.js --target ./my-project --update -y
  node scripts/build-graph.js --target ./my-project

Options:
  --global-store     Store memories/graph in ~/.fxmind/projects/<id>/ (shared pack skills)
  --update           Refresh packs/skills/commands/modes from .fxmind/packs.json (keeps memories)
  --hooks            Install Cursor hooks (gate-guard, drift-watcher, learn-prompt)
  --no-hooks         Skip hook installation even when Cursor is selected
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
    update: false,
    globalStore: false,
    hooks: null,
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

    if (arg === "--global-store") {
      options.globalStore = true;
      continue;
    }

    if (arg === "--hooks") {
      options.hooks = true;
      continue;
    }

    if (arg === "--no-hooks") {
      options.hooks = false;
      continue;
    }

    if (arg === "--update") {
      options.update = true;
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
  const names = new Set();
  if (includeCommand) {
    names.add(COMMAND_SKILL_NAME);
    names.add(LEGACY_COMMAND_SKILL);
    names.add(LEGACY_COMMAND_SKILL_DEV);
  }
  for (const skillName of skills) {
    names.add(skillName);
  }
  return names;
}

function getAgentSkillCleanupNames(packSkillNames, includeCommand) {
  const names = new Set(packSkillNames);
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

function installPackSkill(skillName, skillsRoot) {
  const src = path.join(getSkillsDirForSkill(skillName), skillName);

  if (!fs.existsSync(src)) {
    throw new Error(`Skill not found in package: ${skillName}`);
  }

  if (!fs.existsSync(path.join(src, "SKILL.md"))) {
    throw new Error(`Invalid skill (missing SKILL.md): ${skillName}`);
  }

  const dest = path.join(skillsRoot, skillName);
  copyDir(src, dest);
  return dest;
}

function installPackSkills(targetRoot, skills, options = {}) {
  const skillsRoot =
    options.skillsRoot ||
    (options.globalStore || isGlobalStore(targetRoot)
      ? GLOBAL_SHARED_SKILLS
      : path.join(targetRoot, PACK_SKILLS_DIR));
  const installed = [];

  for (const skillName of skills) {
    installed.push(installPackSkill(skillName, skillsRoot));
  }

  return installed.map((dest) => path.relative(targetRoot, dest).replace(/\\/g, "/") || dest);
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
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, `${lines.join("\n")}\n`, "utf8");
  return path.relative(targetRoot, indexPath);
}

function applyGlobalStore(targetRoot, packs, enabled) {
  if (!enabled && !isGlobalStore(targetRoot)) {
    return null;
  }

  const result = setupGlobalStore(targetRoot, {
    packs: packs.map((id) => ({ id })),
  });

  const manifestPath = path.join(targetRoot, SHARED_DIR, "packs.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.storage = "global";
    manifest.projectId = result.projectId;
    manifest.globalRoot = result.globalProjectDir.replace(/\\/g, "/");
    manifest.sharedSkills = result.sharedSkills.replace(/\\/g, "/");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  return result;
}

function printGlobalStoreWarnings(result) {
  if (!result || !Array.isArray(result.copyFallbacks) || result.copyFallbacks.length === 0) {
    return;
  }
  console.log("[global] WARNING: symlinks unavailable — fell back to copies for:");
  for (const name of result.copyFallbacks) {
    console.log(`  • ${name}`);
  }
  console.log(
    "  Copies are NOT live: edits under .fxmind/ will not sync back to ~/.fxmind/.",
  );
  console.log(
    "  Enable Windows Developer Mode (Settings → For developers) for real symlinks,",
  );
  console.log("  then re-run: fxmind --global-store --update -y");
}

function writeProjectLockfile(targetRoot, packs, options = {}) {
  if (packs.length === 0) {
    return null;
  }
  const prev = readLockfile(targetRoot);
  const { data } = writeLockfile(targetRoot, packs, {
    packSkillsDirs: options.packSkillsDirs,
  });
  if (prev) {
    const changes = diffLockfiles(prev, data);
    if (changes.length > 0) {
      console.log("[Lockfile] changes since last install:");
      for (const change of changes) {
        if (change.type === "commit") {
          console.log(`  • ${change.id}: ${change.from} → ${change.to}`);
        } else if (change.type === "skill-added") {
          console.log(`  • ${change.id}: +skill ${change.skill}`);
        } else if (change.type === "skill-removed") {
          console.log(`  • ${change.id}: -skill ${change.skill}`);
        } else {
          console.log(`  • ${change.id}: ${change.type}`);
        }
      }
    }
  }
  return data;
}

function shouldInstallHooks(options, agents) {
  if (options.hooks === false) return false;
  const cursorSelected = agents.some((agent) => agent.id === "cursor");
  if (options.hooks === true) return true;
  // default: install hooks when Cursor is selected and the /fxmind helper is on
  return Boolean(cursorSelected && options.command);
}

function installProjectHooks(targetRoot) {
  try {
    const result = installHooks(targetRoot, { gitHook: true });
    console.log("[Hooks]");
    for (const p of result.installed) console.log(`  ✓ ${p}`);
    console.log(`  ✓ ${result.hooksJson}`);
    if (result.gitHook && typeof result.gitHook === "string") {
      console.log(`  ✓ git pre-commit → ${result.gitHook}`);
    } else if (result.gitHook && result.gitHook.error) {
      console.log(`  ⚠ git pre-commit skipped: ${result.gitHook.error}`);
    }
    console.log(
      "  Restart Cursor (or reload hooks) to activate gate-guard / drift-watcher / learn-prompt.",
    );
  } catch (error) {
    console.log(`[Hooks] skipped: ${error.message}`);
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
      const resourceName = auditReportSlug(name);
      const auditsDir = path.join(sharedDir, "audits");
      const sharedPath = path.join(auditsDir, `${resourceName}.md`);
      fs.mkdirSync(auditsDir, { recursive: true });
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
  const found = Object.entries(AGENTS)
    .filter(([, agent]) => hasAgentInstall(targetRoot, agent))
    .map(([agentId]) => agentId);

  return found.length ? found : [...DEFAULT_AGENTS];
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

    if (agent.commandMode === "skill") {
      return fs.existsSync(
        path.join(targetRoot, agent.skillsDir, COMMAND_SKILL_NAME, "SKILL.md"),
      );
    }

    return false;
  });
}

function resolveUpdateOptions(options) {
  const manifest = readInstalledManifest(options.target);
  const packIds = (manifest.packs || []).map((pack) => pack.id).filter(Boolean);

  if (packIds.length === 0) {
    throw new Error(
      "Installed manifest has no packs. Re-run install with a pack, e.g. fxmind --pack fivem -y",
    );
  }

  validatePackIds(packIds);
  options.packs = packIds;

  const agentIds =
    Array.isArray(manifest.agents) && manifest.agents.length > 0
      ? manifest.agents.filter((agentId) => AGENTS[agentId])
      : detectInstalledAgents(options.target);

  options.agents = agentIds.length ? agentIds : [...DEFAULT_AGENTS];

  refreshPackSkillsCaches(packIds, options);
  SKILL_SOURCES = buildSkillSources(packIds, options);

  const manifestSkills = Array.isArray(manifest.skills)
    ? manifest.skills.filter((skillName) => SKILL_SOURCES.has(skillName))
    : [];
  const detectedSkills = detectInstalledSkills(options.target).filter((skillName) =>
    SKILL_SOURCES.has(skillName),
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

function hasLegacyAuditLayout(targetRoot) {
  const fxmindGuide = path.join(targetRoot, SHARED_DIR, "fxmind.md");
  if (!fs.existsSync(fxmindGuide)) {
    return true;
  }

  const content = fs.readFileSync(fxmindGuide, "utf8");
  return (
    content.includes(".fxmind/audit-<") &&
    !content.includes(".fxmind/audits/")
  );
}

function listLegacyAuditReportsAtRoot(targetRoot) {
  const fxmindDir = path.join(targetRoot, SHARED_DIR);
  if (!fs.existsSync(fxmindDir)) {
    return [];
  }

  return fs
    .readdirSync(fxmindDir)
    .filter(
      (name) =>
        name.startsWith("audit-") &&
        name.endsWith(".md") &&
        name !== "audit.template.md",
    );
}

function refreshSharedAuditLayout(targetRoot) {
  const installed = [];
  installed.push(installAuditsDir(targetRoot));

  const guideSrc = path.join(PACKAGE_ROOT, COMMAND_TEMPLATE);
  const guideDest = path.join(targetRoot, SHARED_DIR, "fxmind.md");
  if (fs.existsSync(guideSrc)) {
    fs.mkdirSync(path.dirname(guideDest), { recursive: true });
    fs.copyFileSync(guideSrc, guideDest);
    installed.push(path.relative(targetRoot, guideDest).replace(/\\/g, "/"));
  }

  for (const dest of migrateAuditReports(targetRoot)) {
    installed.push(dest);
  }

  return installed;
}

function printLegacyAuditLayoutWarning(targetRoot) {
  const legacyFiles = listLegacyAuditReportsAtRoot(targetRoot);
  const legacyGuide = hasLegacyAuditLayout(targetRoot);
  const auditsDir = path.join(targetRoot, AUDITS_DIR);

  if (!legacyGuide && legacyFiles.length === 0 && fs.existsSync(auditsDir)) {
    return;
  }

  console.log("\n⚠ Legacy audit layout detected:");
  if (legacyGuide) {
    console.log("  • .fxmind/fxmind.md still points to .fxmind/audit-<name>.md");
  }
  if (legacyFiles.length > 0) {
    console.log(`  • ${legacyFiles.length} report(s) at .fxmind/ root: ${legacyFiles.join(", ")}`);
  }
  if (!fs.existsSync(auditsDir)) {
    console.log("  • .fxmind/audits/ folder missing");
  }
  console.log(
    "  → Run update from the latest fxmind (npm/github or local monorepo), then restart the agent.\n",
  );
}

function installAuditsDir(targetRoot) {
  const auditsDir = path.join(targetRoot, AUDITS_DIR);
  fs.mkdirSync(auditsDir, { recursive: true });

  const readmeSrc = path.join(PACKAGE_ROOT, FXMIND_TEMPLATES_DIR, "audits", "README.md");
  const readmeDest = path.join(auditsDir, "README.md");
  if (fs.existsSync(readmeSrc)) {
    fs.copyFileSync(readmeSrc, readmeDest);
  }

  return AUDITS_DIR.replace(/\\/g, "/");
}

function runMigrateCli(argv) {
  const options = { target: process.cwd(), help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--target") {
      options.target = path.resolve(argv[i + 1] || "");
      i += 1;
    }
  }

  if (options.help) {
    console.log(`
Migrate legacy .fxmind layout (e.g. audit-*.md at root → audits/).

Usage:
  fxmind migrate [--target <dir>]

Moves:
  .fxmind/audit-<resource>.md  →  .fxmind/audits/<resource>.md

Also ensures .fxmind/audits/ exists with README.
`);
    return 0;
  }

  if (!fs.existsSync(options.target)) {
    console.error(`Error: target directory does not exist: ${options.target}`);
    return 1;
  }

  const fxmindDir = path.join(options.target, SHARED_DIR);
  if (!fs.existsSync(fxmindDir)) {
    console.error(`Error: missing ${SHARED_DIR}/ — run fxmind -y first.`);
    return 1;
  }

  installAuditsDir(options.target);
  const migrated = migrateAuditReports(options.target);

  console.log(`\nMigrated: ${options.target}`);
  if (migrated.length === 0) {
    console.log("  (nothing to move — audits/ already clean)");
  } else {
    for (const dest of migrated) {
      console.log(`  ✓ → ${dest}`);
    }
  }
  console.log(`  ✓ audits/ ready\n`);
  return 0;
}

function auditReportSlug(fileName) {
  let slug = fileName.slice("audit-".length);
  if (slug.endsWith(".md")) {
    slug = slug.slice(0, -3);
  }
  return slug;
}

function migrateAuditReports(targetRoot) {
  const fxmindDir = path.join(targetRoot, SHARED_DIR);
  const auditsDir = path.join(targetRoot, AUDITS_DIR);
  const migrated = [];

  if (!fs.existsSync(fxmindDir)) {
    return migrated;
  }

  fs.mkdirSync(auditsDir, { recursive: true });

  for (const name of fs.readdirSync(fxmindDir)) {
    if (
      !name.startsWith("audit-") ||
      !name.endsWith(".md") ||
      name === "audit.template.md" ||
      name === "audit-procedure.md"
    ) {
      continue;
    }

    const legacyPath = path.join(fxmindDir, name);
    if (!fs.statSync(legacyPath).isFile()) {
      continue;
    }

    const resourceName = auditReportSlug(name);
    const destPath = path.join(auditsDir, `${resourceName}.md`);

    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(legacyPath, destPath);
      migrated.push(path.relative(targetRoot, destPath));
    }

    fs.unlinkSync(legacyPath);
  }

  return migrated;
}

function installSharedFxmind(targetRoot, packIds, installOptions = {}) {
  const preserveUserData = Boolean(installOptions.preserveUserData);
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
      const graphJsonPath = path.join(destDir, "knowledge-graph.json");
      let graphData = null;

      if (preserveUserData && fs.existsSync(graphJsonPath)) {
        try {
          graphData = JSON.parse(fs.readFileSync(graphJsonPath, "utf8"));
        } catch {
          graphData = null;
        }
      }

      if (!graphData) {
        graphData = {
          nodes: [],
          links: [],
          meta: {
            generatedAt: "",
            agent: "shared",
            fxmindDir: SHARED_DIR,
            counts: { learned: 0, catalog: 0, links: 0, tokens: 0 },
          },
        };
      }

      const graphJsonStr = JSON.stringify(graphData, null, 2);
      const html = fs
        .readFileSync(src, "utf8")
        .replace("/*__GRAPH_DATA__*/", graphJsonStr);
      fs.writeFileSync(dest, html, "utf8");

      const jsonDest = path.join(destDir, "knowledge-graph.json");
      if (!preserveUserData || !fs.existsSync(jsonDest)) {
        fs.writeFileSync(jsonDest, `${graphJsonStr}\n`, "utf8");
        installed.push(path.relative(targetRoot, jsonDest));
      }
    } else {
      fs.copyFileSync(src, dest);
    }

    installed.push(path.relative(targetRoot, dest));
  }

  installed.push(...installModeFiles(targetRoot, relativeDestDir, preserveUserData));

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

  writePacksManifest(targetRoot, packIds, installOptions.manifestMeta);
  installed.push(path.join(relativeDestDir, "packs.json").replace(/\\/g, "/"));

  const fxmindGuideSrc = path.join(PACKAGE_ROOT, COMMAND_TEMPLATE);
  const fxmindGuideDest = path.join(destDir, "fxmind.md");
  if (fs.existsSync(fxmindGuideSrc)) {
    fs.copyFileSync(fxmindGuideSrc, fxmindGuideDest);
    installed.push(path.relative(targetRoot, fxmindGuideDest));
  }

  fs.mkdirSync(path.join(targetRoot, AUDITS_DIR), { recursive: true });
  installed.push(installAuditsDir(targetRoot));
  for (const dest of migrateAuditReports(targetRoot)) {
    installed.push(dest);
  }

  return { installed, removed };
}

function writePacksManifest(targetRoot, packIds, meta = {}) {
  const manifest = {
    version: 1,
    layoutVersion: LAYOUT_VERSION,
    packSkillsDir: PACK_SKILLS_DIR.replace(/\\/g, "/"),
    packs: packIds.map((id) => {
      const pack = getPack(id);
      return { id, label: pack.label };
    }),
    updatedAt: new Date().toISOString(),
  };

  if (Array.isArray(meta.agents) && meta.agents.length > 0) {
    manifest.agents = meta.agents;
  }

  if (Array.isArray(meta.skills) && meta.skills.length > 0) {
    manifest.skills = meta.skills;
  }

  if (typeof meta.command === "boolean") {
    manifest.command = meta.command;
  }

  if (meta.storage) {
    manifest.storage = meta.storage;
  }

  if (meta.projectId) {
    manifest.projectId = meta.projectId;
  }

  if (meta.globalRoot) {
    manifest.globalRoot = meta.globalRoot;
  }

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

function listModeTemplateFiles() {
  const srcDir = path.join(PACKAGE_ROOT, FXMIND_TEMPLATES_DIR, "modes");
  if (!fs.existsSync(srcDir)) {
    return [];
  }
  return fs
    .readdirSync(srcDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

function installModeFiles(targetRoot, relativeDestDir, preserveUserData) {
  const srcDir = path.join(PACKAGE_ROOT, FXMIND_TEMPLATES_DIR, "modes");
  const destDir = path.join(targetRoot, relativeDestDir, "modes");
  const installed = [];

  if (!fs.existsSync(srcDir)) {
    return installed;
  }

  fs.mkdirSync(destDir, { recursive: true });

  const sourceFiles = listModeTemplateFiles();
  const sourceSet = new Set(sourceFiles);

  for (const fileName of sourceFiles) {
    const src = path.join(srcDir, fileName);
    const dest = path.join(destDir, fileName);
    fs.copyFileSync(src, dest);
    installed.push(path.relative(targetRoot, dest));
  }

  if (preserveUserData) {
    return installed;
  }

  for (const existing of fs.existsSync(destDir)
    ? fs.readdirSync(destDir)
    : []) {
    if (!existing.endsWith(".md")) {
      continue;
    }
    if (!sourceSet.has(existing)) {
      fs.unlinkSync(path.join(destDir, existing));
    }
  }

  return installed;
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

  if (agent.commandMode === "skill") {
    return [];
  }

  if (agent.commandMode === "toml") {
    return installTomlCommands(targetRoot, agent);
  }

  const dest = path.join(targetRoot, agent.commandsDir, COMMAND_FILE);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(PACKAGE_ROOT, COMMAND_TEMPLATE), dest);

  return [path.relative(targetRoot, dest)];
}

function installPackSkillsLayer(targetRoot, skills, allPackSkillNames, options = {}) {
  const actions = { installed: [], removed: [], index: null };
  const packSkillOptions = {
    globalStore: options.globalStore || isGlobalStore(targetRoot),
  };

  if (skills.length > 0) {
    actions.installed.push(...installPackSkills(targetRoot, skills, packSkillOptions));
    actions.index = writePackSkillsIndex(targetRoot, skills, packSkillOptions);
  }

  if (allPackSkillNames.length > 0) {
    actions.removed.push(
      ...removePackSkillsFromAgentDirs(targetRoot, allPackSkillNames),
    );
  }

  return actions;
}

function installAgentsLayer(targetRoot, agents, options) {
  const installed = [];

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
  }

  return installed;
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
  const argv = process.argv.slice(2);

  if (argv[0] === "graph") {
    const { runGraphCli } = require("./build-graph");
    process.exit(runGraphCli(argv.slice(1)));
  }

  if (argv[0] === "global") {
    const { runGlobalCli } = require("./global-store");
    process.exit(runGlobalCli(argv.slice(1)));
  }

  if (argv[0] === "hooks") {
    process.exit(runHooksCli(argv.slice(1)));
  }

  if (argv[0] === "pack") {
    process.exit(runPackCli(argv.slice(1)));
  }

  if (argv[0] === "migrate") {
    process.exit(runMigrateCli(argv.slice(1)));
  }

  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!fs.existsSync(options.target)) {
    console.error(`Error: target directory does not exist: ${options.target}`);
    process.exit(1);
  }

  if (options.update) {
    if (options.interactive || options.allPacks || options.noPacks || options.explicitPacks) {
      console.error("Error: --update cannot be combined with pack selection flags.");
      process.exit(1);
    }

    try {
      resolveUpdateOptions(options);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }

    const skills = options.skills;
    const packs = options.packs;
    const agents = resolveAgents(options.agents);
    const manifestMeta = {
      agents: agents.map((agent) => agent.id),
      skills,
      command: options.command,
    };

    console.log(`\nUpdating: ${options.target}`);
    console.log(`Packs: ${packs.join(", ")}`);
    for (const packId of packs) {
      const source = [...SKILL_SOURCES.values()].find((entry) => entry.packId === packId);
      if (source) {
        console.log(`  ${packId} skills → ${source.skillsDir}`);
      }
    }
    console.log(`Skills: ${skills.length ? skills.join(", ") : "(none)"}`);
    console.log(
      `Agents: ${agents.map((agent) => agent.label).join(", ")}\n`,
    );

    const layoutRefresh = refreshSharedAuditLayout(options.target);
    if (layoutRefresh.length > 0) {
      console.log("[Layout]");
      for (const dest of layoutRefresh) {
        console.log(`  ✓ ${dest}`);
      }
      console.log("");
    }

    if (options.command) {
      console.log("[Shared .fxmind]");
      const shared = installSharedFxmind(options.target, packs, {
        preserveUserData: true,
        manifestMeta,
      });
      for (const dest of shared.installed) {
        console.log(`  ✓ template → ${dest}`);
      }

      const lockData = writeProjectLockfile(options.target, packs);
      if (lockData) {
        printLockSummary(lockData);
      }

      const packSkills = installPackSkillsLayer(
        options.target,
        skills,
        listAllSkills(),
        { globalStore: options.globalStore || isGlobalStore(options.target) },
      );
      for (const dest of packSkills.installed) {
        console.log(`  ✓ pack skill → ${dest}`);
      }
      if (packSkills.index) {
        console.log(`  ✓ index    → ${packSkills.index}`);
      }
      for (const dest of packSkills.removed) {
        console.log(`  ✓ cleanup  → ${dest} (removed from agent folder)`);
      }

      const globalStore = applyGlobalStore(
        options.target,
        packs,
        options.globalStore || isGlobalStore(options.target),
      );
      if (globalStore) {
        console.log(`  ✓ global   → ${globalStore.globalProjectDir}`);
        console.log(`  ✓ shared   → ${globalStore.sharedSkills}`);
      }
      printGlobalStoreWarnings(globalStore);
      console.log("");
    } else {
      writePacksManifest(options.target, packs, manifestMeta);
    }

    let lastAgentLabel = "";
    for (const entry of installAgentsLayer(options.target, agents, options)) {
      if (entry.agent !== lastAgentLabel) {
        if (lastAgentLabel) {
          console.log("");
        }
        console.log(`[${entry.agent}]`);
        lastAgentLabel = entry.agent;
      }
      console.log(
        `  ✓ ${entry.kind === "skill" ? "skill   " : "command "} → ${entry.path}`,
      );
    }
    if (lastAgentLabel) {
      console.log("");
    }

    if (shouldInstallHooks(options, agents)) {
      installProjectHooks(options.target);
    }

    console.log("Update complete.");
    printLegacyAuditLayoutWarning(options.target);
    console.log("Restart your agent IDE/CLI or open a new session.");
    console.log(`Refresh again anytime: ${npxInstall("--update -y")}`);
    console.log("Gemini: run /commands reload after update.");
    return;
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

    const shared = installSharedFxmind(options.target, packs, {
      manifestMeta: {
        agents: agents.map((agent) => agent.id),
        skills,
        command: options.command,
      },
    });
    for (const dest of shared.removed) {
      console.log(`  ✓ cleanup  → ${dest}`);
    }
    for (const dest of shared.installed) {
      console.log(`  ✓ template → ${dest}`);
    }

    const lockData = writeProjectLockfile(options.target, packs);
    if (lockData) {
      printLockSummary(lockData);
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

    const packSkills = installPackSkillsLayer(
      options.target,
      skills,
      listAllSkills(),
      { globalStore: options.globalStore || isGlobalStore(options.target) },
    );
    for (const dest of packSkills.installed) {
      console.log(`  ✓ pack skill → ${dest}`);
    }
    if (packSkills.index) {
      console.log(`  ✓ index    → ${packSkills.index}`);
    }
    for (const dest of packSkills.removed) {
      console.log(`  ✓ cleanup  → ${dest} (removed from agent folder)`);
    }

    const globalStore = applyGlobalStore(
      options.target,
      packs,
      options.globalStore || isGlobalStore(options.target),
    );
    if (globalStore) {
      console.log(`  ✓ global   → ${globalStore.globalProjectDir}`);
      console.log(`  ✓ shared   → ${globalStore.sharedSkills}`);
    }
    printGlobalStoreWarnings(globalStore);

    console.log("");
  }

  let lastAgentLabel = "";
  for (const entry of installAgentsLayer(options.target, agents, options)) {
    if (entry.agent !== lastAgentLabel) {
      if (lastAgentLabel) {
        console.log("");
      }
      console.log(`[${entry.agent}]`);
      lastAgentLabel = entry.agent;
    }
    console.log(
      `  ✓ ${entry.kind === "skill" ? "skill   " : "command "} → ${entry.path}`,
    );
  }
  if (lastAgentLabel) {
    console.log("");
  }

  if (shouldInstallHooks(options, agents)) {
    installProjectHooks(options.target);
  }

  console.log("Done.");
  console.log("Restart your agent IDE/CLI or open a new session.");
  console.log(`Update packs/skills: ${npxInstall("--update -y")}  (or after global: fxmind --update -y)`);
  console.log(`Reinstall from scratch: ${npxInstall("-y")}  (or after global: fxmind -y)`);
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
    "Run fxmind graph (or /fxmind graph) to build a static 3D knowledge map and open it in the browser.",
  );
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
