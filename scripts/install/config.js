/**
 * install/config — shared constants for the fxmind installer.
 * Safe to require from any install module (path + layout only).
 */
const path = require("path");
const { SHARED_DIR, LAYOUT_VERSION } = require("../lib/layout");

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
const COPILOT_COMMANDS_DIR = path.join("templates", "commands", "copilot");
const COPILOT_PROMPT_FILE = "fxmind.prompt.md";
/** Core files copied into .fxmind/ — dest is relative to .fxmind/. */
const CORE_TEMPLATE_FILES = [
  { src: "reference.template.mdc", dest: "templates/reference.mdc", srcDir: "rules" },
  { src: "memory.template.md", dest: "templates/memory.md" },
  { src: "memory-health.template.md", dest: "templates/memory-health.md" },
  { src: "audit-procedure.md", dest: "audits/procedure.md" },
  { src: "failure-modes.md", dest: "policy/failure-modes.md" },
  { src: "knowledge-graph.html", dest: "graph/knowledge-graph.html" },
];
const LEGACY_TEMPLATE_FILES = [
  "reference.template.mdc",
  "memory.template.md",
  "memory-index.template.md",
  "memory-health.template.md",
  "audit-procedure.md",
  "failure-modes.md",
  "knowledge-graph.html",
  "reference.example.mdc",
  "audit.template.md",
  "topic-catalog.md",
  "minimum-evidence.md",
];
const PACK_TEMPLATE_DEST = {
  "topic-catalog.md": "policy/topic-catalog.md",
  "minimum-evidence.md": "policy/minimum-evidence.md",
  "reference.example.mdc": "templates/reference.example.mdc",
  "audit.template.md": null,
};
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
const OPENCODE_SUBAGENT_NAMES = ["explore", "reader", "general", "scout"];
const OPENCODE_INSTRUCTION_FILE = "delegate-io.md";
const OPENCODE_TOOLS_INSTRUCTION_FILE = "fxmind-tools-only.md";
const OPENCODE_INSTRUCTION_REL = path.join(".opencode", "instructions", OPENCODE_INSTRUCTION_FILE);
const OPENCODE_TOOLS_INSTRUCTION_REL = path.join(
  ".opencode",
  "instructions",
  OPENCODE_TOOLS_INSTRUCTION_FILE,
);
const OPENCODE_AGENTS_TEMPLATE_DIR = path.join("templates", "opencode", "agents");
const OPENCODE_INSTRUCTIONS_TEMPLATE_DIR = path.join("templates", "opencode", "instructions");
const OPENCODE_CONFIG_REL = "opencode.json";
const OPENCODE_INSTRUCTION_CONFIG_REL = ".opencode/instructions/delegate-io.md";
const OPENCODE_TOOLS_INSTRUCTION_CONFIG_REL = ".opencode/instructions/fxmind-tools-only.md";

const PACK_SKILLS_DIR = path.join(SHARED_DIR, "skills");
const AUDITS_DIR = path.join(SHARED_DIR, "audits");
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
    agentsDir: path.join(".opencode", "agents"),
    instructionsDir: path.join(".opencode", "instructions"),
    commandMode: "file",
  },
  copilot: {
    label: "VS Code Copilot",
    skillsDir: path.join(".github", "skills"),
    commandsDir: path.join(".github", "prompts"),
    commandMode: "prompt",
  },
};

module.exports = {
  DEFAULT_AGENTS,
  COMMAND_FILE,
  COMMAND_SKILL_NAME,
  COMMAND_TEMPLATE,
  FXMIND_SKILL_TEMPLATE,
  LEGACY_COMMAND_FILE,
  LEGACY_COMMAND_SKILL,
  LEGACY_COMMAND_FILE_DEV,
  LEGACY_COMMAND_SKILL_DEV,
  REFERENCE_TEMPLATES_DIR,
  FXMIND_TEMPLATES_DIR,
  GEMINI_COMMANDS_DIR,
  COPILOT_COMMANDS_DIR,
  COPILOT_PROMPT_FILE,
  CORE_TEMPLATE_FILES,
  LEGACY_TEMPLATE_FILES,
  PACK_TEMPLATE_DEST,
  LEGACY_FIVEM_FILES,
  SHARED_DIR,
  PACK_SKILLS_DIR,
  AUDITS_DIR,
  LAYOUT_VERSION,
  LEGACY_SHARED_DIRS,
  LEGACY_AGENT_FIVEM_DIRS,
  AGENTS,
  OPENCODE_SUBAGENT_NAMES,
  OPENCODE_INSTRUCTION_FILE,
  OPENCODE_TOOLS_INSTRUCTION_FILE,
  OPENCODE_AGENTS_TEMPLATE_DIR,
  OPENCODE_INSTRUCTIONS_TEMPLATE_DIR,
  OPENCODE_CONFIG_REL,
  OPENCODE_INSTRUCTION_CONFIG_REL,
  OPENCODE_TOOLS_INSTRUCTION_CONFIG_REL,
  OPENCODE_TOOLS_INSTRUCTION_REL,
};
