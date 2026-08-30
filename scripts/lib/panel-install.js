/**
 * Panel API — fxmind install/setup for web UI.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getPack, listPacks } = require("../packs");
const { resolvePackSkillsDir } = require("../resolve-packs");
const { hooksStatus } = require("../hooks");
const { buildGraphData, writeGraph } = require("../build-graph");
const { AGENTS } = require("../install/config");
const { resolveSkillsRoot } = require("../global-store");
const {
  MCP_AGENT_TARGETS,
  MCP_SERVER_KEY,
  mcpStatusForAgent,
} = require("../mcp-install");
const { SERVER_INFO, TOOL_DEFS } = require("../mcp-server");

const PACKAGE_ROOT = path.join(__dirname, "..", "..");

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listInstalledSkills(root) {
  return listSkills(root)
    .filter((skill) => skill.active)
    .map((skill) => skill.name);
}

function mcpPanelStatus(root) {
  const projectRoot = path.resolve(root);
  const agents = Object.keys(MCP_AGENT_TARGETS).map((agentId) => {
    const status = mcpStatusForAgent(projectRoot, agentId);
    return {
      agentId: status.agentId,
      label: status.label,
      configRel: status.configRel,
      configExists: status.configExists,
      installed: status.installed,
    };
  });

  return {
    server: MCP_SERVER_KEY,
    version: SERVER_INFO.version,
    installed: agents.some((agent) => agent.installed),
    agents,
    tools: TOOL_DEFS.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      category: ["fivem", "db", "panel"].includes(tool.name.split("_")[1])
        ? tool.name.split("_")[1]
        : "core",
    })),
  };
}

function safeSkillName(value) {
  const name = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name) ? name : null;
}

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function skillRoots(root) {
  const projectRoot = path.resolve(root);
  const activeRoot = path.resolve(resolveSkillsRoot(projectRoot));
  return {
    projectRoot,
    activeRoot,
    disabledRoot: path.join(path.dirname(activeRoot), "skills-disabled"),
  };
}

function isGlobalSkillsRoot(roots) {
  const localRoot = path.resolve(roots.projectRoot, ".fxmind", "skills");
  return roots.activeRoot.toLowerCase() !== localRoot.toLowerCase();
}

function disabledManifestPath(root) {
  return path.join(path.resolve(root), ".fxmind", "skills-disabled.json");
}

function readDisabledSkills(root) {
  const data = readJsonSafe(disabledManifestPath(root));
  return new Set(Array.isArray(data?.skills) ? data.skills.filter(safeSkillName) : []);
}

function writeDisabledSkills(root, disabled) {
  const file = disabledManifestPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ version: 1, skills: [...disabled].sort() }, null, 2)}\n`,
    "utf8",
  );
}

function hasSkillFile(dir) {
  try {
    return (
      fs.lstatSync(dir).isDirectory() &&
      fs.lstatSync(path.join(dir, "SKILL.md")).isFile()
    );
  } catch {
    return false;
  }
}

function skillOrigin(root, name) {
  const candidates = [
    path.join(path.resolve(root), ".fxmind", "packs.lock.json"),
    path.join(path.resolve(root), ".fxmind", "packs.json"),
  ];
  for (const file of candidates) {
    const manifest = readJsonSafe(file);
    const entries = Array.isArray(manifest?.packs) ? manifest.packs : [];
    for (const entry of entries) {
      if (Array.isArray(entry.skills) && entry.skills.includes(name)) {
        return entry.id || entry.label || "pack";
      }
    }
  }
  return null;
}

function skillPathFor(root, name, disabled = false) {
  const safe = safeSkillName(name);
  if (!safe) return null;
  const roots = skillRoots(root);
  const base = disabled ? roots.disabledRoot : roots.activeRoot;
  const dir = path.join(base, safe);
  if (!isWithin(dir, base)) return null;
  return dir;
}

function skillRecord(root, name, dir, active) {
  return {
    name,
    path: path.resolve(dir).replace(/\\/g, "/"),
    active,
    origin: skillOrigin(root, name),
  };
}

function listSkills(root) {
  const roots = skillRoots(root);
  const byName = new Map();
  const manifestDisabled = isGlobalSkillsRoot(roots) ? readDisabledSkills(root) : new Set();
  if (fs.existsSync(roots.activeRoot)) {
    let entries = [];
    try {
      entries = fs.readdirSync(roots.activeRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const name = safeSkillName(entry.name);
      const dir = path.join(roots.activeRoot, entry.name);
      if (!name || !hasSkillFile(dir)) continue;
      byName.set(
        name,
        skillRecord(root, name, dir, !manifestDisabled.has(name)),
      );
    }
  }
  if (isGlobalSkillsRoot(roots)) {
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const [base, active] of [
    [roots.disabledRoot, false],
  ]) {
    if (!fs.existsSync(base)) continue;
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = safeSkillName(entry.name);
      const dir = path.join(base, entry.name);
      if (!name || !hasSkillFile(dir)) continue;
      if (!byName.has(name) || active) {
        byName.set(name, skillRecord(root, name, dir, active));
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findSkill(root, name) {
  const safe = safeSkillName(name);
  if (!safe) return { ok: false, status: 400, error: "invalid skill name" };
  const found = listSkills(root).find((skill) => skill.name === safe);
  if (!found) return { ok: false, status: 404, error: "skill not found" };
  return { ok: true, ...found, dir: path.resolve(found.path) };
}

function assertSkillFile(dir, projectRoot) {
  const roots = skillRoots(projectRoot);
  const activeBase = roots.activeRoot;
  const disabledBase = roots.disabledRoot;
  if (!isWithin(dir, activeBase) && !isWithin(dir, disabledBase)) {
    throw new Error("skill path is outside the managed skills directories");
  }
  if (!hasSkillFile(dir)) throw new Error("invalid skill (missing SKILL.md)");
  const file = path.join(dir, "SKILL.md");
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error("symlinked SKILL.md is not allowed");
  return file;
}

function readSkill(root, name) {
  const found = findSkill(root, name);
  if (!found.ok) return found;
  try {
    const file = assertSkillFile(found.dir, root);
    const stat = fs.statSync(file);
    if (stat.size > 2 * 1024 * 1024) {
      return { ok: false, status: 413, error: "SKILL.md is too large" };
    }
    return {
      ok: true,
      name: found.name,
      path: found.path,
      active: found.active,
      origin: found.origin,
      content: fs.readFileSync(file, "utf8"),
    };
  } catch (error) {
    return { ok: false, status: 400, error: String(error.message || error) };
  }
}

function updateSkill(root, name, content) {
  const found = findSkill(root, name);
  if (!found.ok) return found;
  const body = String(content ?? "");
  if (Buffer.byteLength(body, "utf8") > 2 * 1024 * 1024) {
    return { ok: false, status: 413, error: "SKILL.md is too large" };
  }
  try {
    const file = assertSkillFile(found.dir, root);
    fs.writeFileSync(file, body, "utf8");
    return readSkill(root, name);
  } catch (error) {
    return { ok: false, status: 400, error: String(error.message || error) };
  }
}

function toggleSkill(root, name, active) {
  const found = findSkill(root, name);
  if (!found.ok) return found;
  const roots = skillRoots(root);
  const targetActive = active === true;
  if (found.active === targetActive) return readSkill(root, name);
  if (isGlobalSkillsRoot(roots)) {
    const disabled = readDisabledSkills(root);
    if (targetActive) disabled.delete(found.name);
    else disabled.add(found.name);
    try {
      writeDisabledSkills(root, disabled);
      return {
        ...skillRecord(root, found.name, found.dir, targetActive),
        ok: true,
      };
    } catch (error) {
      return { ok: false, status: 400, error: String(error.message || error) };
    }
  }
  const from = path.resolve(found.dir);
  const base = targetActive ? roots.activeRoot : roots.disabledRoot;
  const to = path.join(base, found.name);
  if (!isWithin(from, targetActive ? roots.disabledRoot : roots.activeRoot) || !isWithin(to, base)) {
    return { ok: false, status: 400, error: "unsafe skill path" };
  }
  try {
    assertSkillFile(from, root);
    fs.mkdirSync(base, { recursive: true });
    if (fs.existsSync(to)) return { ok: false, status: 409, error: "target skill already exists" };
    fs.renameSync(from, to);
    return {
      ok: true,
      name: found.name,
      path: path.resolve(to).replace(/\\/g, "/"),
      active: targetActive,
      origin: found.origin,
    };
  } catch (error) {
    return { ok: false, status: 400, error: String(error.message || error) };
  }
}

function containsSymlink(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return true;
    if (entry.isDirectory() && containsSymlink(child)) return true;
  }
  return false;
}

function installSkillFromLocal(root, sourcePath, name = null) {
  const roots = skillRoots(root);
  const source = path.resolve(String(sourcePath || ""));
  if (!fs.existsSync(source) || !hasSkillFile(source)) {
    return { ok: false, status: 400, error: "local skill must be a directory containing SKILL.md" };
  }
  const skillName = safeSkillName(name || path.basename(source));
  if (!skillName) return { ok: false, status: 400, error: "invalid skill name" };
  try {
    if (fs.lstatSync(source).isSymbolicLink() || containsSymlink(source)) {
      return { ok: false, status: 400, error: "symlinked skill files are not allowed" };
    }
    fs.mkdirSync(roots.activeRoot, { recursive: true });
    const destination = skillPathFor(root, skillName);
    if (!destination || !isWithin(destination, roots.activeRoot)) {
      return { ok: false, status: 400, error: "unsafe skill destination" };
    }
    if (fs.existsSync(destination)) {
      return { ok: false, status: 409, error: "skill already installed" };
    }
    fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
    return {
      ok: true,
      name: skillName,
      path: destination.replace(/\\/g, "/"),
      active: true,
      origin: "local",
    };
  } catch (error) {
    return { ok: false, status: 400, error: String(error.message || error) };
  }
}

function installSkillFromCatalog(root, source, name = null) {
  const requested = String(source || "").trim().replace(/^catalog:/i, "");
  if (!requested) return { ok: false, status: 400, error: "catalog skill is required" };

  let packId = null;
  let skillName = String(name || "").trim();
  const separator = requested.includes("/") ? "/" : requested.includes(":") ? ":" : null;
  if (separator) {
    const parts = requested.split(separator).filter(Boolean);
    if (parts.length >= 2 && listPacks().some((pack) => pack.id === parts[0])) {
      packId = parts.shift();
      if (!skillName) skillName = parts.join("-");
    }
  }
  if (!skillName) skillName = requested;
  if (!safeSkillName(skillName)) {
    return { ok: false, status: 400, error: "invalid catalog skill name" };
  }

  const packs = packId ? [getPack(packId)] : listPacks();
  const matches = [];
  for (const pack of packs) {
    if (!pack) continue;
    try {
      const skillsDir = resolvePackSkillsDir(pack.id);
      const candidate = path.join(skillsDir, skillName);
      if (hasSkillFile(candidate)) matches.push({ pack, candidate });
    } catch {
      // An unavailable remote pack is skipped; other catalog sources may still match.
    }
  }
  if (!matches.length) {
    return { ok: false, status: 404, error: `catalog skill not found: ${requested}` };
  }
  if (matches.length > 1 && !packId) {
    return {
      ok: false,
      status: 409,
      error: `catalog skill is ambiguous; use pack/${skillName}`,
    };
  }
  const result = installSkillFromLocal(root, matches[0].candidate, skillName);
  if (result.ok) result.origin = matches[0].pack.id;
  return result;
}

function buildSkillInstallPrompt(source, name = "") {
  const requested = String(source || "").trim();
  const label = String(name || "").trim();
  return [
    "This is an explicitly requested skill-install task.",
    "Install the requested skill only after inspecting it and ensuring it contains a safe SKILL.md.",
    "Do not execute code from the skill repository.",
    `Source: ${requested}`,
    label ? `Skill name: ${label}` : "",
  ].filter(Boolean).join("\n");
}

function getSetupStatus(root) {
  const projectRoot = path.resolve(root);
  const fxmindDir = path.join(projectRoot, ".fxmind");
  const hasFxmind = fs.existsSync(fxmindDir);
  const manifest = readJsonSafe(path.join(fxmindDir, "packs.json"));
  const lock = readJsonSafe(path.join(fxmindDir, "packs.lock.json"));
  const packs = (manifest?.packs || lock?.packs || [])
    .map((pack) => (typeof pack === "string" ? pack : pack?.id))
    .filter(Boolean);
  const graphPath = path.join(fxmindDir, "graph", "knowledge-graph.json");

  let hooks = null;
  try {
    hooks = hooksStatus(projectRoot);
  } catch {
    hooks = null;
  }

  return {
    ok: true,
    hasFxmind,
    projectRoot,
    packs,
    agents: manifest?.agents || [],
    skills: listInstalledSkills(projectRoot),
    hooks,
    mcp: mcpPanelStatus(projectRoot),
    graphBuilt: fs.existsSync(graphPath),
    layoutVersion: readJsonSafe(path.join(fxmindDir, "layout.json"))?.version || null,
  };
}

function listAvailablePacks() {
  const packs = listPacks().map((p) => {
    let skills = [];
    try {
      const dir = resolvePackSkillsDir(p.id);
      if (dir && fs.existsSync(dir)) {
        skills = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort();
      }
    } catch {
      skills = p.defaultSkills || [];
    }
    return {
      id: p.id,
      label: p.label || p.id,
      description: p.description || "",
      defaultSkills: p.defaultSkills || [],
      skills,
    };
  });

  const agents = Object.entries(AGENTS).map(([id, spec]) => ({
    id,
    label: spec.label || id,
  }));

  return { ok: true, packs, agents };
}

function runInstall(targetRoot, options = {}) {
  const projectRoot = path.resolve(targetRoot);
  const args = [
    path.join(PACKAGE_ROOT, "scripts", "install.js"),
    "--target",
    projectRoot,
    "-y",
    "--no-self-update",
  ];

  if (options.update) args.push("--update");
  if (options.packs?.length) args.push("--pack", options.packs.join(","));
  if (options.agents?.length) args.push("--agent", options.agents.join(","));
  if (options.skills?.length) args.push("--skills", options.skills.join(","));
  if (options.globalStore) args.push("--global-store");
  if (options.replaceAgents) args.push("--replace-agents");
  if (options.noHooks) args.push("--no-hooks");
  if (options.noMcp) args.push("--no-mcp");

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: PACKAGE_ROOT,
      env: { ...process.env },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code ?? 1,
        log: stdout + (stderr ? `\n${stderr}` : ""),
        setup: getSetupStatus(projectRoot),
      });
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        exitCode: 1,
        log: String(err.message || err),
        setup: getSetupStatus(projectRoot),
      });
    });
  });
}

function buildProjectGraph(root) {
  const projectRoot = path.resolve(root);
  if (!fs.existsSync(path.join(projectRoot, ".fxmind"))) {
    return { ok: false, status: 400, error: "no .fxmind in project" };
  }
  try {
    const data = buildGraphData(projectRoot, { noHtml: false });
    const written = writeGraph(projectRoot, data, { noHtml: false });
    return {
      ok: true,
      nodes: data.nodes?.length ?? 0,
      edges: data.edges?.length ?? 0,
      written,
    };
  } catch (err) {
    return { ok: false, status: 500, error: String(err.message || err) };
  }
}

module.exports = {
  getSetupStatus,
  listSkills,
  readSkill,
  updateSkill,
  toggleSkill,
  installSkillFromLocal,
  installSkillFromCatalog,
  buildSkillInstallPrompt,
  listAvailablePacks,
  runInstall,
  buildProjectGraph,
  mcpPanelStatus,
};
