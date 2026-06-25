const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const SHARED_DIR = ".fxmind";
const GLOBAL_ROOT = path.join(os.homedir(), ".fxmind");
const GLOBAL_PROJECTS_DIR = path.join(GLOBAL_ROOT, "projects");
const GLOBAL_SHARED_DIR = path.join(GLOBAL_ROOT, "shared");
const GLOBAL_SHARED_SKILLS = path.join(GLOBAL_SHARED_DIR, "skills");
const REGISTRY_PATH = path.join(GLOBAL_ROOT, "registry.json");
const STORE_FILE = "store.json";

const PROJECT_DATA_LINKS = [
  "memory",
  "knowledge-graph.json",
  "knowledge-graph.html",
];

function normalizeProjectRoot(projectRoot) {
  return path.resolve(projectRoot).replace(/\\/g, "/").toLowerCase();
}

function projectIdForRoot(projectRoot) {
  const normalized = normalizeProjectRoot(projectRoot);
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function projectNameFromRoot(projectRoot) {
  return path.basename(path.resolve(projectRoot)) || "project";
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readStore(projectRoot) {
  const storePath = path.join(path.resolve(projectRoot), SHARED_DIR, STORE_FILE);
  return readJson(storePath);
}

function isGlobalStore(projectRoot) {
  const store = readStore(projectRoot);
  return store?.mode === "global" && Boolean(store.globalRoot);
}

function getGlobalProjectDir(projectId) {
  return path.join(GLOBAL_PROJECTS_DIR, projectId);
}

function ensureGlobalDirs() {
  fs.mkdirSync(GLOBAL_PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(GLOBAL_SHARED_SKILLS, { recursive: true });
}

function readRegistry() {
  return readJson(REGISTRY_PATH, { version: 1, projects: {} });
}

function writeRegistry(registry) {
  writeJson(REGISTRY_PATH, registry);
}

function registerProject(projectRoot, meta = {}) {
  ensureGlobalDirs();
  const resolvedRoot = path.resolve(projectRoot);
  const projectId = projectIdForRoot(resolvedRoot);
  const registry = readRegistry();

  registry.projects[projectId] = {
    id: projectId,
    name: meta.name || projectNameFromRoot(resolvedRoot),
    root: resolvedRoot.replace(/\\/g, "/"),
    registeredAt: registry.projects[projectId]?.registeredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    packs: meta.packs || registry.projects[projectId]?.packs || [],
  };

  writeRegistry(registry);
  return registry.projects[projectId];
}

function listRegisteredProjects(excludeProjectId = null) {
  const registry = readRegistry();
  return Object.values(registry.projects || {}).filter(
    (project) => project.id !== excludeProjectId,
  );
}

function writeProjectStore(projectRoot, projectId, globalProjectDir) {
  const localFxmind = path.join(path.resolve(projectRoot), SHARED_DIR);
  fs.mkdirSync(localFxmind, { recursive: true });

  writeJson(path.join(localFxmind, STORE_FILE), {
    version: 1,
    mode: "global",
    projectId,
    projectRoot: path.resolve(projectRoot).replace(/\\/g, "/"),
    globalRoot: globalProjectDir.replace(/\\/g, "/"),
    sharedSkills: GLOBAL_SHARED_SKILLS.replace(/\\/g, "/"),
    registry: REGISTRY_PATH.replace(/\\/g, "/"),
    updatedAt: new Date().toISOString(),
  });
}

function removePathIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.unlinkSync(targetPath);
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

function linkOrMirror(target, linkPath, type = "dir") {
  removePathIfExists(linkPath);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  const absTarget = path.resolve(target);
  if (!fs.existsSync(absTarget)) {
    return "missing";
  }

  try {
    if (type === "dir") {
      if (process.platform === "win32") {
        fs.symlinkSync(absTarget, linkPath, "junction");
      } else {
        fs.symlinkSync(absTarget, linkPath, "dir");
      }
    } else if (process.platform === "win32") {
      fs.symlinkSync(absTarget, linkPath, "file");
    } else {
      fs.symlinkSync(absTarget, linkPath, "file");
    }
    return "symlink";
  } catch {
    if (type === "dir") {
      fs.cpSync(absTarget, linkPath, { recursive: true, force: true });
    } else {
      fs.copyFileSync(absTarget, linkPath);
    }
    return "copy";
  }
}

function createSymlink(target, linkPath, type = "dir") {
  linkOrMirror(target, linkPath, type);
}

function migrateLocalDataToGlobal(localFxmind, globalProjectDir) {
  fs.mkdirSync(globalProjectDir, { recursive: true });

  for (const name of PROJECT_DATA_LINKS) {
    const localPath = path.join(localFxmind, name);
    const globalPath = path.join(globalProjectDir, name);

    if (!fs.existsSync(localPath)) {
      continue;
    }

    const stat = fs.lstatSync(localPath);
    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isDirectory()) {
      if (!fs.existsSync(globalPath)) {
        fs.cpSync(localPath, globalPath, { recursive: true, force: true });
      }
      continue;
    }

    if (!fs.existsSync(globalPath)) {
      fs.mkdirSync(path.dirname(globalPath), { recursive: true });
      fs.copyFileSync(localPath, globalPath);
    }
  }
}

function wireProjectLinks(projectRoot, globalProjectDir) {
  const localFxmind = path.join(path.resolve(projectRoot), SHARED_DIR);
  fs.mkdirSync(localFxmind, { recursive: true });
  fs.mkdirSync(globalProjectDir, { recursive: true });

  for (const name of PROJECT_DATA_LINKS) {
    const globalPath = path.join(globalProjectDir, name);
    const localPath = path.join(localFxmind, name);

    if (name === "memory") {
      fs.mkdirSync(globalPath, { recursive: true });
      createSymlink(globalPath, localPath, "dir");
      continue;
    }

    if (!fs.existsSync(globalPath)) {
      if (name.endsWith(".html")) {
        continue;
      }
      if (name.endsWith(".json")) {
        writeJson(globalPath, {
          nodes: [],
          links: [],
          meta: {
            generatedAt: "",
            agent: "shared",
            fxmindDir: SHARED_DIR,
            counts: { learned: 0, catalog: 0, links: 0, tokens: 0 },
          },
        });
      }
    }

    if (fs.existsSync(globalPath)) {
      createSymlink(globalPath, localPath, "file");
    }
  }

  const sharedSkillsLink = path.join(localFxmind, "skills");
  fs.mkdirSync(GLOBAL_SHARED_SKILLS, { recursive: true });
  createSymlink(GLOBAL_SHARED_SKILLS, sharedSkillsLink, "dir");
}

function resolveDataRoot(projectRoot) {
  const store = readStore(projectRoot);
  if (store?.mode === "global" && store.globalRoot && fs.existsSync(store.globalRoot)) {
    return path.resolve(store.globalRoot);
  }

  return path.join(path.resolve(projectRoot), SHARED_DIR);
}

function resolveSkillsRoot(projectRoot) {
  const store = readStore(projectRoot);
  if (store?.mode === "global" && store.sharedSkills && fs.existsSync(store.sharedSkills)) {
    return path.resolve(store.sharedSkills);
  }

  return path.join(path.resolve(projectRoot), SHARED_DIR, "skills");
}

function resolveMemoryDir(projectRoot) {
  return path.join(resolveDataRoot(projectRoot), "memory");
}

function setupGlobalStore(projectRoot, meta = {}) {
  ensureGlobalDirs();
  const resolvedRoot = path.resolve(projectRoot);
  const projectId = projectIdForRoot(resolvedRoot);
  const globalProjectDir = getGlobalProjectDir(projectId);
  const localFxmind = path.join(resolvedRoot, SHARED_DIR);

  fs.mkdirSync(globalProjectDir, { recursive: true });
  migrateLocalDataToGlobal(localFxmind, globalProjectDir);
  registerProject(resolvedRoot, meta);
  writeProjectStore(resolvedRoot, projectId, globalProjectDir);
  wireProjectLinks(resolvedRoot, globalProjectDir);

  writeJson(path.join(globalProjectDir, "project.json"), {
    version: 1,
    projectId,
    name: meta.name || projectNameFromRoot(resolvedRoot),
    root: resolvedRoot.replace(/\\/g, "/"),
    updatedAt: new Date().toISOString(),
  });

  return {
    projectId,
    globalProjectDir,
    sharedSkills: GLOBAL_SHARED_SKILLS,
    registryPath: REGISTRY_PATH,
  };
}

function loadForeignMemories(currentProjectId) {
  const foreign = [];

  for (const project of listRegisteredProjects(currentProjectId)) {
    const memoryDir = path.join(getGlobalProjectDir(project.id), "memory");
    if (!fs.existsSync(memoryDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(memoryDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "_index.md") {
        continue;
      }

      const slug = entry.name.replace(/\.md$/i, "").toLowerCase();
      const filePath = path.join(memoryDir, entry.name);
      foreign.push({
        projectId: project.id,
        projectName: project.name,
        projectRoot: project.root,
        slug,
        filePath,
        content: fs.readFileSync(filePath, "utf8"),
      });
    }
  }

  return foreign;
}

function printGlobalList() {
  const registry = readRegistry();
  const projects = Object.values(registry.projects || {});

  if (projects.length === 0) {
    console.log("No projects registered in global store.");
    console.log(`Registry: ${REGISTRY_PATH}`);
    return 0;
  }

  console.log(`Global fxmind store: ${GLOBAL_ROOT}\n`);
  for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${project.name}`);
    console.log(`    id   → ${project.id}`);
    console.log(`    root → ${project.root}`);
    console.log(`    data → ${getGlobalProjectDir(project.id).replace(/\\/g, "/")}`);
    console.log("");
  }

  console.log(`Shared skills → ${GLOBAL_SHARED_SKILLS.replace(/\\/g, "/")}`);
  return 0;
}

function parseGlobalCliArgs(argv) {
  const options = { help: false };

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    }
  }

  return options;
}

function printGlobalHelp() {
  console.log(`
Global fxmind store — one knowledge base per machine, isolated per project.

Layout:
  ~/.fxmind/registry.json           All registered projects
  ~/.fxmind/shared/skills/          Pack skills (shared across projects)
  ~/.fxmind/projects/<id>/memory/   Per-project memories
  ~/.fxmind/projects/<id>/          Per-project graph + metadata

Enable for a project:
  fxmind --global-store -y
  fxmind --global-store --update -y

Commands:
  fxmind global list                List registered projects
  fxmind global list -h             This help

Project .fxmind/store.json points to the global data dir. Agent paths stay .fxmind/memory/ via symlinks.
Cross-project links appear in fxmind graph when topics relate across projects.
`);
}

function runGlobalCli(argv = []) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const options = parseGlobalCliArgs(rest);

  if (sub === "list") {
    if (options.help) {
      printGlobalHelp();
      return 0;
    }
    return printGlobalList();
  }

  printGlobalHelp();
  return sub ? 1 : 0;
}

module.exports = {
  SHARED_DIR,
  GLOBAL_ROOT,
  GLOBAL_SHARED_SKILLS,
  REGISTRY_PATH,
  projectIdForRoot,
  isGlobalStore,
  setupGlobalStore,
  resolveDataRoot,
  resolveSkillsRoot,
  resolveMemoryDir,
  readStore,
  registerProject,
  listRegisteredProjects,
  loadForeignMemories,
  getGlobalProjectDir,
  runGlobalCli,
  printGlobalHelp,
};
