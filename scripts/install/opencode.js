/**
 * install/opencode — project OpenCode subagents (explore/reader/general/scout)
 * plus orchestration instruction. Copied on `fxmind --opencode` / `--update`.
 */
const fs = require("fs");
const path = require("path");

const { PACKAGE_ROOT } = require("../resolve-packs");
const {
  OPENCODE_SUBAGENT_NAMES,
  OPENCODE_INSTRUCTION_FILE,
  OPENCODE_AGENTS_TEMPLATE_DIR,
  OPENCODE_INSTRUCTIONS_TEMPLATE_DIR,
  OPENCODE_CONFIG_REL,
  OPENCODE_INSTRUCTION_CONFIG_REL,
} = require("./config");

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/")) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function rel(targetRoot, dest) {
  return path.relative(targetRoot, dest).replace(/\\/g, "/");
}

function installOpenCodeSubagents(targetRoot) {
  const projectRoot = path.resolve(targetRoot);
  const installed = [];

  const srcAgents = path.join(PACKAGE_ROOT, OPENCODE_AGENTS_TEMPLATE_DIR);
  const destAgents = path.join(projectRoot, ".opencode", "agents");
  fs.mkdirSync(destAgents, { recursive: true });

  for (const name of OPENCODE_SUBAGENT_NAMES) {
    const src = path.join(srcAgents, `${name}.md`);
    if (!fs.existsSync(src)) {
      throw new Error(`OpenCode subagent template missing: ${name}.md`);
    }
    const dest = path.join(destAgents, `${name}.md`);
    fs.copyFileSync(src, dest);
    installed.push(rel(projectRoot, dest));
  }

  const srcInstruction = path.join(
    PACKAGE_ROOT,
    OPENCODE_INSTRUCTIONS_TEMPLATE_DIR,
    OPENCODE_INSTRUCTION_FILE,
  );
  if (!fs.existsSync(srcInstruction)) {
    throw new Error(`OpenCode instruction template missing: ${OPENCODE_INSTRUCTION_FILE}`);
  }
  const destInstruction = path.join(
    projectRoot,
    ".opencode",
    "instructions",
    OPENCODE_INSTRUCTION_FILE,
  );
  fs.mkdirSync(path.dirname(destInstruction), { recursive: true });
  fs.copyFileSync(srcInstruction, destInstruction);
  installed.push(rel(projectRoot, destInstruction));

  mergeOpenCodeSubagentConfig(projectRoot);

  return installed;
}

function uninstallOpenCodeSubagents(targetRoot) {
  const projectRoot = path.resolve(targetRoot);
  const removed = [];

  for (const name of OPENCODE_SUBAGENT_NAMES) {
    const dest = path.join(projectRoot, ".opencode", "agents", `${name}.md`);
    if (!fs.existsSync(dest)) {
      continue;
    }
    fs.unlinkSync(dest);
    removed.push(rel(projectRoot, dest));
  }

  const destInstruction = path.join(
    projectRoot,
    ".opencode",
    "instructions",
    OPENCODE_INSTRUCTION_FILE,
  );
  if (fs.existsSync(destInstruction)) {
    fs.unlinkSync(destInstruction);
    removed.push(rel(projectRoot, destInstruction));
  }

  unmergeOpenCodeSubagentConfig(projectRoot);
  return removed;
}

function normalizeInstructions(value) {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string" && entry.length > 0);
}

function mergeOpenCodeSubagentConfig(targetRoot) {
  const configPath = path.join(path.resolve(targetRoot), OPENCODE_CONFIG_REL);
  const existing = readJson(configPath, {
    $schema: "https://opencode.ai/config.json",
  }) || { $schema: "https://opencode.ai/config.json" };

  if (!existing.$schema) {
    existing.$schema = "https://opencode.ai/config.json";
  }

  const instructions = normalizeInstructions(existing.instructions);
  if (!instructions.includes(OPENCODE_INSTRUCTION_CONFIG_REL)) {
    instructions.push(OPENCODE_INSTRUCTION_CONFIG_REL);
  }
  existing.instructions = instructions;

  existing.agent = existing.agent && typeof existing.agent === "object" ? existing.agent : {};
  for (const name of OPENCODE_SUBAGENT_NAMES) {
    const prev =
      existing.agent[name] && typeof existing.agent[name] === "object"
        ? existing.agent[name]
        : {};
    existing.agent[name] = { ...prev, mode: "subagent" };
  }

  writeJson(configPath, existing);
  return rel(path.resolve(targetRoot), configPath);
}

function unmergeOpenCodeSubagentConfig(targetRoot) {
  const configPath = path.join(path.resolve(targetRoot), OPENCODE_CONFIG_REL);
  const existing = readJson(configPath);
  if (!existing) {
    return false;
  }

  const instructions = normalizeInstructions(existing.instructions).filter(
    (entry) => entry !== OPENCODE_INSTRUCTION_CONFIG_REL,
  );
  if (instructions.length) {
    existing.instructions = instructions;
  } else {
    delete existing.instructions;
  }

  if (existing.agent && typeof existing.agent === "object") {
    for (const name of OPENCODE_SUBAGENT_NAMES) {
      delete existing.agent[name];
    }
    if (Object.keys(existing.agent).length === 0) {
      delete existing.agent;
    }
  }

  const remainingKeys = Object.keys(existing).filter((key) => key !== "$schema");
  if (remainingKeys.length === 0) {
    fs.unlinkSync(configPath);
    return true;
  }

  writeJson(configPath, existing);
  return true;
}

module.exports = {
  installOpenCodeSubagents,
  uninstallOpenCodeSubagents,
  mergeOpenCodeSubagentConfig,
  unmergeOpenCodeSubagentConfig,
};
