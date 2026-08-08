/**
 * install/cli — argument parsing, help/version output, interactive prompts.
 */
const fs = require("fs");
const path = require("path");

const { npxInstall, globalInstall } = require("../constants");
const { PACKAGE_ROOT, buildSkillSources } = require("../resolve-packs");
const {
  listPacks,
  getDefaultPackIds,
  getDefaultSkillsForPacks,
} = require("../packs");
const { AGENTS } = require("./config");
const state = require("./state");

function getPackageVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printVersion() {
  console.log(`fxmind ${getPackageVersion()}`);
}

function printHelp() {
  console.log(`
Install fxmind — project memory and knowledge packs for AI agents (Cursor, Claude Code, Codex, Gemini CLI, OpenCode, VS Code Copilot).

Knowledge packs add domain-specific skills under \`.fxmind/skills/\` and the fxmind agent skill.

Recommended (install once globally, then use short command):
  ${globalInstall()}
  fxmind -y
  fxmind --update -y
  fxmind graph               Build 3D knowledge graph + open browser
  fxmind graph --no-open     Build graph files only
  fxmind -v                  Show version
  fxmind -h

Without global install:
  ${npxInstall()}                    Interactive mode (packs, agents, skills)
  ${npxInstall("-y")}                Core + fivem pack (Cursor only)
  ${npxInstall("--cursor -y")}       Cursor only (explicit)
  ${npxInstall("--claude -y")}       Claude Code only
  ${npxInstall("--codex -y")}        Codex only
  ${npxInstall("--gemini -y")}       Gemini CLI only
  ${npxInstall("--opencode -y")}     OpenCode only
  ${npxInstall("--copilot -y")}      VS Code Copilot only
  ${npxInstall("--agent cursor,claude,gemini -y")}  Multiple agents
  ${npxInstall("--no-packs -y")}     Core /fxmind only — no domain skills
  ${npxInstall("--pack fivem -y")}   Explicit fivem knowledge pack
  ${npxInstall("--all-packs -y")}    Every available pack
  ${npxInstall("--all -y")}          All skills from selected pack(s)
  ${npxInstall("--update -y")}       Refresh global fxmind + project (packs, skills, hooks, MCP, fivem-start)
  ${npxInstall("graph")}             Build graph from .fxmind/memory/ + open browser
  ${npxInstall("--global-store -y")} Install with global store (~/.fxmind/projects/<id>/)
  ${npxInstall("migrate")}            Move legacy audit-*.md → audits/
  ${npxInstall("global list")}       List projects in global store
  ${npxInstall("hooks install")}      Install Cursor hooks + MCP (gate-guard, drift-watcher, learn-prompt)
  ${npxInstall("hooks install-git")}  Install git pre-commit drift check only
  ${npxInstall("hooks uninstall-mcp")} Remove fxmind MCP entries for installed agents
  ${npxInstall("hooks status")}       Show installed hooks
  ${npxInstall("memory validate")}    Validate memory frontmatter + duplicates
  ${npxInstall("corrections list")}   List skill-improvement corrections backlog
  ${npxInstall("corrections export")} Export open corrections for editing best-practices
  ${npxInstall("fivem install")}      Configure local RCON + Cursor fivem-start tee
  ${npxInstall("fivem status")}       Local FXServer RCON status (dev)
  ${npxInstall("fivem ensure <res>")} RCON ensure/stop/restart/refresh (allowlisted)
  ${npxInstall("fivem nui-wire <res>")} TEMP wire NUI for agent vision (then nui-unwire)
  ${npxInstall("fivem nui-dump")}       Structured NUI state (MCP fxmind_fivem_nui_dump)
  ${npxInstall("fivem nui-unwire")}     Remove TEMP nui-wire (mandatory cleanup)
  ${npxInstall("db status")}          MySQL from mysql_connection_string (cfg)
  ${npxInstall("db query \"SELECT 1\"")} Run SQL (DELETE needs --yes)
  ${npxInstall("pack new <id>")}      Scaffold a new knowledge pack under packs/<id>/
  fxmind-mcp                          Run the fxmind MCP server (stdio) for agent tool access

Local dev (monorepo):
  node scripts/install.js --target ./my-project --pack fivem -y
  node scripts/install.js --target ./my-project --update -y
  node scripts/build-graph.js --target ./my-project

Options:
  --global-store     Store memories/graph in ~/.fxmind/projects/<id>/ (shared pack skills)
  --update           Refresh global fxmind (GitHub) + project files from .fxmind/packs.json (keeps memories; also refreshes hooks, MCP, fivem-start)
  --no-self-update   With --update, skip npm install -g github:fx-mind/fxmind
  --hooks            Install Cursor hooks (gate-guard, drift-watcher, learn-prompt)
  --no-hooks         Skip hook installation even when Cursor is selected
  --mcp              Install MCP server configs for selected agents (fxmind-mcp)
  --no-mcp           Skip MCP wiring even when agents are selected
  --fivem-dev        Install/refresh local FiveM RCON + fivem-start task
  --no-fivem-dev     Skip local FiveM RCON / fivem-start wiring
  --replace-agents   Replace agent set (remove fxmind from agents not selected this run)
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
  --copilot          Install for VS Code Copilot only
  --agent <list>     Comma-separated: cursor, claude, codex, gemini, opencode, copilot
  --no-command       Skip /fxmind helper
  -i, --interactive  Force interactive mode
  -y, --yes          Skip prompts, use defaults
  -h, --help         Show this help
  -v, --version      Show fxmind version

Interactive mode (default in terminal):
  1. Select knowledge packs (fivem, …)
  2. Select agents (Cursor, Claude, Codex, Gemini CLI, OpenCode)
  3. Select skills from chosen packs
  4. Confirm /fxmind helper
`);
}

function pushRequestedAgent(options, agentId) {
  if (!options.agents) {
    options.agents = [];
  }
  if (!options.agents.includes(agentId)) {
    options.agents.push(agentId);
  }
  options.explicitAgents = true;
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
    version: false,
    yes: false,
    interactive: false,
    explicitSkills: false,
    explicitAgents: false,
    explicitPacks: false,
    update: false,
    globalStore: false,
    hooks: null,
    mcp: null,
    fivem: null,
    replaceAgents: false,
    noSelfUpdate: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      options.version = true;
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
      pushRequestedAgent(options, "cursor");
      continue;
    }

    if (arg === "--claude") {
      pushRequestedAgent(options, "claude");
      continue;
    }

    if (arg === "--codex") {
      pushRequestedAgent(options, "codex");
      continue;
    }

    if (arg === "--gemini") {
      pushRequestedAgent(options, "gemini");
      continue;
    }

    if (arg === "--opencode") {
      pushRequestedAgent(options, "opencode");
      continue;
    }

    if (arg === "--copilot") {
      pushRequestedAgent(options, "copilot");
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

    if (arg === "--mcp") {
      options.mcp = true;
      continue;
    }

    if (arg === "--no-mcp") {
      options.mcp = false;
      continue;
    }

    if (arg === "--fivem-dev") {
      options.fivem = true;
      continue;
    }

    if (arg === "--no-fivem-dev") {
      options.fivem = false;
      continue;
    }

    if (arg === "--replace-agents") {
      options.replaceAgents = true;
      continue;
    }

    if (arg === "--no-self-update") {
      options.noSelfUpdate = true;
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

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function getSkillDescription(skillName) {
  const source = state.SKILL_SOURCES.get(skillName);
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
    const savedSources = state.SKILL_SOURCES;
    state.SKILL_SOURCES = packSources;

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

    state.SKILL_SOURCES = savedSources;

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

module.exports = {
  getPackageVersion,
  printVersion,
  printHelp,
  parseArgs,
  wantsInteractive,
  ensureNonInteractiveChoice,
  truncate,
  getSkillDescription,
  promptSelections,
};
