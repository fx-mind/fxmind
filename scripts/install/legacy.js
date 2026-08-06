/**
 * install/legacy — legacy layout cleanup + migrations (.fivem, per-agent dirs,
 * audit-*.md at root, legacy graph artifacts).
 */
const fs = require("fs");
const path = require("path");

const { PACKAGE_ROOT } = require("../resolve-packs");
const {
  AGENTS,
  COMMAND_FILE,
  COMMAND_SKILL_NAME,
  COMMAND_TEMPLATE,
  LEGACY_COMMAND_FILE,
  LEGACY_COMMAND_SKILL,
  LEGACY_COMMAND_FILE_DEV,
  LEGACY_COMMAND_SKILL_DEV,
  FXMIND_TEMPLATES_DIR,
  COPILOT_PROMPT_FILE,
  LEGACY_FIVEM_FILES,
  SHARED_DIR,
  AUDITS_DIR,
  LEGACY_SHARED_DIRS,
  LEGACY_AGENT_FIVEM_DIRS,
} = require("./config");

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

    if (agent.commandsDir && agent.commandMode === "prompt") {
      const commandPath = path.join(targetRoot, agent.commandsDir, COPILOT_PROMPT_FILE);
      if (fs.existsSync(commandPath)) {
        fs.unlinkSync(commandPath);
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
        name !== "audit.template.md" &&
        name !== "audit-procedure.md",
    );
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

function installCorrectionsDir(targetRoot) {
  const {
    ensureCorrectionsDir,
    CORRECTIONS_DIR,
  } = require("../fxmind-tools");
  ensureCorrectionsDir(targetRoot);
  const destDir = path.join(targetRoot, SHARED_DIR, CORRECTIONS_DIR);
  for (const name of ["README.md", "correction.template.md", "_index.md"]) {
    const src = path.join(PACKAGE_ROOT, FXMIND_TEMPLATES_DIR, "corrections", name);
    const dest = path.join(destDir, name);
    if (!fs.existsSync(src)) continue;
    if (name === "_index.md" && fs.existsSync(dest)) continue;
    fs.copyFileSync(src, dest);
  }
  return path.join(SHARED_DIR, CORRECTIONS_DIR).replace(/\\/g, "/");
}

function refreshSharedAuditLayout(targetRoot) {
  const installed = [];
  installed.push(installAuditsDir(targetRoot));
  installed.push(installCorrectionsDir(targetRoot));

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

module.exports = {
  getManagedSkillNames,
  getAgentSkillCleanupNames,
  isDirEmpty,
  pruneEmptyDirsUpward,
  removeFivemFiles,
  cleanLegacyFivemFiles,
  cleanUnselectedAgents,
  parseFrontmatterUpdated,
  parseUpdatedTimestamp,
  parseIndexRows,
  mergeIndexTables,
  migrateLegacyMemories,
  cleanLegacyAgentMemories,
  parseGraphMeta,
  syncKnowledgeGraphHtml,
  shouldPreferLegacyArtifact,
  auditReportSlug,
  migrateAuditReports,
  migrateAndCleanLegacyAgentArtifacts,
  migrateLegacySharedDir,
  hasLegacyAuditLayout,
  listLegacyAuditReportsAtRoot,
  printLegacyAuditLayoutWarning,
  installAuditsDir,
  installCorrectionsDir,
  refreshSharedAuditLayout,
};
