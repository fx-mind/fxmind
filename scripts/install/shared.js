/**
 * install/shared — shared .fxmind/ layer: core templates, modes, manifest,
 * audits/corrections dirs, global-store + lockfile wiring.
 */
const fs = require("fs");
const path = require("path");

const { PACKAGE_ROOT } = require("../resolve-packs");
const { getPack } = require("../packs");
const { setupGlobalStore } = require("../global-store");
const { writeLockfile, readLockfile, diffLockfiles, printLockSummary } = require("../lockfile");
const {
  COMMAND_TEMPLATE,
  REFERENCE_TEMPLATES_DIR,
  FXMIND_TEMPLATES_DIR,
  CORE_TEMPLATE_FILES,
  LEGACY_TEMPLATE_FILES,
  PACK_TEMPLATE_DEST,
  SHARED_DIR,
  PACK_SKILLS_DIR,
  AUDITS_DIR,
  LAYOUT_VERSION,
  LEGACY_FIVEM_FILES,
  LEGACY_AGENT_FIVEM_DIRS,
} = require("./config");
const {
  isDirEmpty,
  pruneEmptyDirsUpward,
  removeFivemFiles,
  cleanLegacyFivemFiles,
  migrateAuditReports,
  installAuditsDir,
  installCorrectionsDir,
} = require("./legacy");
const { migrateProjectLayout } = require("../lib/layout");
const { ensureProjectGitignore } = require("../lib/project-gitignore");

function coreTemplateEntry(entry) {
  if (typeof entry === "string") {
    return {
      src: entry,
      dest: entry,
      srcDir: entry === "reference.template.mdc" ? REFERENCE_TEMPLATES_DIR : FXMIND_TEMPLATES_DIR,
    };
  }
  return {
    src: entry.src,
    dest: entry.dest,
    srcDir: entry.srcDir === "rules" ? REFERENCE_TEMPLATES_DIR : FXMIND_TEMPLATES_DIR,
  };
}

function normalizePackTemplateFile(entry) {
  if (typeof entry === "string") {
    const dest = Object.prototype.hasOwnProperty.call(PACK_TEMPLATE_DEST, entry)
      ? PACK_TEMPLATE_DEST[entry]
      : entry;
    return { src: entry, dest };
  }
  return { src: entry.src, dest: entry.dest };
}

function installSharedFxmind(targetRoot, packIds, installOptions = {}) {
  const preserveUserData = Boolean(installOptions.preserveUserData);
  const relativeDestDir = SHARED_DIR;
  const destDir = path.join(targetRoot, relativeDestDir);
  migrateProjectLayout(targetRoot);
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of ["templates", "policy", "graph", "state", "reports", "memory", "modes"]) {
    fs.mkdirSync(path.join(destDir, name), { recursive: true });
  }
  const removed = cleanLegacyFivemFiles(targetRoot, relativeDestDir);
  const installed = [];

  for (const entry of CORE_TEMPLATE_FILES.map(coreTemplateEntry)) {
    const src = path.join(PACKAGE_ROOT, entry.srcDir, entry.src);
    if (!fs.existsSync(src)) {
      continue;
    }

    const dest = path.join(destDir, entry.dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (entry.src === "knowledge-graph.html") {
      const graphJsonPath = path.join(destDir, "graph", "knowledge-graph.json");
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

      if (!preserveUserData || !fs.existsSync(graphJsonPath)) {
        fs.mkdirSync(path.dirname(graphJsonPath), { recursive: true });
        fs.writeFileSync(graphJsonPath, `${graphJsonStr}\n`, "utf8");
        installed.push(path.relative(targetRoot, graphJsonPath));
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
      const { src: srcName, dest: destRel } = normalizePackTemplateFile(fileName);
      if (!destRel) {
        continue;
      }
      const src = path.join(pack.templatesDir, srcName);
      if (!fs.existsSync(src)) {
        continue;
      }

      const dest = path.join(destDir, destRel);
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
  installed.push(installCorrectionsDir(targetRoot));
  for (const dest of migrateAuditReports(targetRoot)) {
    installed.push(dest);
  }

  try {
    const gitignore = ensureProjectGitignore(targetRoot);
    if (gitignore?.added?.length) {
      installed.push(".gitignore");
    }
  } catch {
    // gitignore heal is best-effort
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
  const names = new Set(LEGACY_TEMPLATE_FILES);
  for (const entry of CORE_TEMPLATE_FILES) {
    if (typeof entry === "string") {
      names.add(entry);
    } else {
      names.add(entry.src);
      names.add(entry.dest);
    }
  }
  for (const packId of packIds) {
    for (const fileName of getPack(packId).templateFiles || []) {
      const { src, dest } = normalizePackTemplateFile(fileName);
      names.add(src);
      if (dest) {
        names.add(dest);
      }
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

function applyGlobalStore(targetRoot, packs, enabled) {
  const { isGlobalStore } = require("../global-store");
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

module.exports = {
  installSharedFxmind,
  writePacksManifest,
  getAllTemplateFileNames,
  normalizePackTemplateFile,
  listModeTemplateFiles,
  installModeFiles,
  cleanLegacyAgentFivemTemplates,
  seedMemoryIndex,
  cleanFivemTemplates,
  applyGlobalStore,
  printGlobalStoreWarnings,
  writeProjectLockfile,
  printLockSummary,
};
