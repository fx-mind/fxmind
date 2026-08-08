/**
 * FiveM NUI state dump — read/trigger `.fxmind/nui-dump.json` for MCP agents.
 *
 * Agent lifecycle:
 *   1) fxmind_fivem_nui_wire   — auto-patch fxmanifest + inject DOM probe into ui_page
 *   2) fxmind_fivem_nui_dump   — capture structured state
 *   3) fxmind_fivem_nui_unwire — remove probe / markers (mandatory after debug)
 */

const fs = require("fs");
const path = require("path");
const fivemRcon = require("./fivem-rcon");

const DUMP_REL = path.join(".fxmind", "nui-dump.json");
const WIRE_REL = path.join(".fxmind", "nui-wire.json");
const BRIDGE_NAME = "fxmind-nui-bridge";
const DEFAULT_TIMEOUT_MS = 3000;
const POLL_MS = 120;
const PROBE_FILE = "fxmind-nui-probe.js";

const LUA_MARK_START = "-- FXMIND-NUI-DUMP-START";
const LUA_MARK_END = "-- FXMIND-NUI-DUMP-END";
const HTML_MARK_START = "<!-- FXMIND-NUI-DUMP-START -->";
const HTML_MARK_END = "<!-- FXMIND-NUI-DUMP-END -->";
const HOOK_LINE = 'client_script "@fxmind-nui-bridge/client-hook.lua"';
const RESOURCE_NAME_RE = /^[a-zA-Z0-9_\[\]\-]+$/;

function projectRoot(overrides = {}) {
  return path.resolve(
    overrides.root ||
      process.env.FXMIND_TARGET ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
}

function dumpPath(root) {
  return path.join(path.resolve(root), DUMP_REL);
}

function findBridgeDumpFallbacks(root) {
  const base = path.resolve(root);
  const candidates = [
    path.join(base, "resources", "[local]", BRIDGE_NAME, "last-dump.json"),
    path.join(base, "resources", "[fxmind]", BRIDGE_NAME, "last-dump.json"),
    path.join(base, "resources", BRIDGE_NAME, "last-dump.json"),
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return { ok: true, data: JSON.parse(raw), raw, path: filePath };
  } catch (error) {
    return { ok: false, error: `invalid JSON in ${filePath}: ${error.message}`, path: filePath };
  }
}

function mtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the latest dump without triggering a new capture.
 */
function readNuiDump(options = {}) {
  const root = projectRoot(options);
  const primary = dumpPath(root);

  if (fs.existsSync(primary)) {
    const parsed = readJsonFile(primary);
    if (!parsed.ok) return { ok: false, error: parsed.error, path: DUMP_REL };
    return {
      ok: true,
      path: DUMP_REL,
      absPath: primary,
      stale: false,
      dump: parsed.data,
      ageMs: Date.now() - mtimeMs(primary),
    };
  }

  for (const fallback of findBridgeDumpFallbacks(root)) {
    const parsed = readJsonFile(fallback);
    if (!parsed.ok) continue;
    return {
      ok: true,
      path: path.relative(root, fallback).replace(/\\/g, "/"),
      absPath: fallback,
      stale: false,
      dump: parsed.data,
      ageMs: Date.now() - mtimeMs(fallback),
      note: "read bridge last-dump.json fallback — prefer fxmind_nui_dump_path convar",
    };
  }

  return {
    ok: false,
    error:
      "no NUI dump yet — wire @fxmind-nui-bridge/client-hook.lua + registerFxmindNuiDump, ensure fxmind-nui-bridge, then trigger (MCP trigger:true or /fxmind_nui_push in-game)",
    path: DUMP_REL,
    hint: {
      install: "fxmind fivem install",
      ensure: "ensure fxmind-nui-bridge",
      wire: 'client_script "@fxmind-nui-bridge/client-hook.lua"',
    },
  };
}

/**
 * Trigger dump via RCON and wait for file update.
 * @param {{ root?: string, resource?: string, trigger?: boolean, timeoutMs?: number }} options
 */
async function nuiDump(options = {}) {
  const root = projectRoot(options);
  const trigger = options.trigger !== false;
  const resource =
    options.resource && String(options.resource).trim()
      ? String(options.resource).trim()
      : "";
  const timeoutMs = Math.min(
    Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 500),
    15000,
  );

  if (!fivemRcon.isFivemInstalled(root)) {
    return {
      ok: false,
      error: "fxmind fivem install not run for this project — run it once (dev only)",
    };
  }

  if (!trigger) {
    return readNuiDump({ root });
  }

  const primary = dumpPath(root);
  const before = mtimeMs(primary);
  const command = resource ? `fxmind_nui_dump ${resource}` : "fxmind_nui_dump";

  const rcon = await fivemRcon.execRcon(command, { root });
  if (!rcon.ok) {
    return {
      ok: false,
      error: rcon.error || "RCON trigger failed",
      trigger: { command, rcon },
      fallback: readNuiDump({ root }),
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const after = mtimeMs(primary);
    if (after > before) {
      const result = readNuiDump({ root });
      return {
        ...result,
        triggered: true,
        command,
        waitedMs: timeoutMs - (deadline - Date.now()),
      };
    }
    // Also accept bridge fallback update if primary missing
    if (!fs.existsSync(primary)) {
      for (const fallback of findBridgeDumpFallbacks(root)) {
        if (mtimeMs(fallback) > before) {
          const result = readNuiDump({ root });
          return {
            ...result,
            triggered: true,
            command,
          };
        }
      }
    }
    await sleep(POLL_MS);
  }

  const latest = readNuiDump({ root });
  if (latest.ok) {
    return {
      ...latest,
      ok: true,
      triggered: true,
      command,
      stale: true,
      warning: `dump file did not update within ${timeoutMs}ms — returning latest on disk (may be stale). Is a player in-game with NUI wired?`,
    };
  }

  return {
    ok: false,
    error: `triggered ${command} but no dump arrived within ${timeoutMs}ms`,
    command,
    rconPreview: rcon.response ? String(rcon.response).slice(0, 300) : null,
    hint: {
      ensureBridge: "ensure fxmind-nui-bridge",
      wire: 'client_script "@fxmind-nui-bridge/client-hook.lua" + registerFxmindNuiDump(getState)',
      inGame: "open the NUI, then retry (or /fxmind_nui_push)",
    },
  };
}

function wireStatePath(root) {
  return path.join(path.resolve(root), WIRE_REL);
}

function readWireState(root) {
  const file = wireStatePath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeWireState(root, state) {
  const file = wireStatePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function clearWireState(root) {
  const file = wireStatePath(root);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function findResourceDir(root, resourceName) {
  const name = String(resourceName || "").trim();
  if (!name || !RESOURCE_NAME_RE.test(name) || name.includes("..")) {
    return { ok: false, error: "invalid resource name" };
  }
  const resourcesDir = path.join(path.resolve(root), "resources");
  if (!fs.existsSync(resourcesDir)) {
    return { ok: false, error: "resources/ folder not found" };
  }

  const stack = [resourcesDir];
  let depthGuard = 0;
  while (stack.length && depthGuard < 5000) {
    depthGuard += 1;
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "cache") continue;
      const full = path.join(dir, ent.name);
      if (ent.name === name) {
        const manifest = ["fxmanifest.lua", "__resource.lua"].find((f) =>
          fs.existsSync(path.join(full, f)),
        );
        if (manifest) {
          return {
            ok: true,
            abs: full,
            rel: path.relative(path.resolve(root), full).replace(/\\/g, "/"),
            manifest,
          };
        }
      }
      stack.push(full);
    }
  }
  return { ok: false, error: `resource not found under resources/: ${name}` };
}

function parseUiPage(manifestText) {
  const match = String(manifestText).match(
    /^\s*ui_page\s+(?:\[\[([\s\S]*?)\]\]|"([^"]+)"|'([^']+)')\s*/im,
  );
  if (!match) return null;
  return (match[1] || match[2] || match[3] || "").trim() || null;
}

function probeTemplatePath() {
  return path.join(
    __dirname,
    "..",
    "templates",
    "resources",
    BRIDGE_NAME,
    "snippets",
    PROBE_FILE,
  );
}

function stripMarkedBlock(text, startMark, endMark) {
  const re = new RegExp(
    `${startMark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${endMark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`,
    "g",
  );
  return String(text).replace(re, "");
}

function ensureManifestHook(manifestAbs) {
  let text = fs.readFileSync(manifestAbs, "utf8");
  const hadMarked = text.includes(LUA_MARK_START);
  const hadHook = text.includes("@fxmind-nui-bridge/client-hook.lua");

  if (hadMarked) {
    return { action: "kept-marked", addedHook: false, text };
  }

  if (hadHook) {
    // Wrap existing hook so unwire can remove only if we own it — leave as-is, track addedHook=false
    return { action: "kept-existing", addedHook: false, text };
  }

  const block = `\n${LUA_MARK_START}\n${HOOK_LINE}\n${LUA_MARK_END}\n`;
  if (!text.endsWith("\n")) text += "\n";
  text += block;
  fs.writeFileSync(manifestAbs, text, "utf8");
  return { action: "added", addedHook: true, text };
}

function injectHtmlProbe(indexAbs, probeSrcAttr) {
  let html = fs.readFileSync(indexAbs, "utf8");
  if (html.includes(HTML_MARK_START)) {
    return { action: "kept", addedScriptTag: false };
  }

  const tag = `${HTML_MARK_START}\n<script src="${probeSrcAttr}"></script>\n${HTML_MARK_END}`;
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${tag}\n</body>`);
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${tag}\n</head>`);
  } else {
    html = `${html.trimEnd()}\n${tag}\n`;
  }
  fs.writeFileSync(indexAbs, html, "utf8");
  return { action: "added", addedScriptTag: true };
}

function removeHtmlProbe(indexAbs) {
  if (!fs.existsSync(indexAbs)) return { action: "missing" };
  const before = fs.readFileSync(indexAbs, "utf8");
  const after = stripMarkedBlock(before, HTML_MARK_START, HTML_MARK_END);
  if (after === before) return { action: "noop" };
  fs.writeFileSync(indexAbs, after, "utf8");
  return { action: "removed" };
}

function removeManifestHook(manifestAbs, { forceExisting = false } = {}) {
  if (!fs.existsSync(manifestAbs)) return { action: "missing" };
  let text = fs.readFileSync(manifestAbs, "utf8");
  const before = text;
  text = stripMarkedBlock(text, LUA_MARK_START, LUA_MARK_END);
  // Only strip bare hook line when we added it (forceExisting) — default: markers only
  if (forceExisting) {
    text = text.replace(
      /^\s*client_script\s+["']@fxmind-nui-bridge\/client-hook\.lua["']\s*\r?\n?/gim,
      "",
    );
  }
  if (text === before) return { action: "noop" };
  fs.writeFileSync(manifestAbs, text, "utf8");
  return { action: "removed" };
}

/**
 * Auto-configure a resource so the agent can dump NUI state.
 * Writes markers + temporary probe; track in .fxmind/nui-wire.json.
 */
function wireNuiDump(options = {}) {
  const root = projectRoot(options);
  const resource = String(options.resource || "").trim();
  if (!resource) {
    return { ok: false, error: "resource is required" };
  }

  const found = findResourceDir(root, resource);
  if (!found.ok) return found;

  const existing = readWireState(root);
  if (existing?.resource && existing.resource !== resource) {
    return {
      ok: false,
      error: `another resource is wired: ${existing.resource} — call fxmind_fivem_nui_unwire first`,
      wired: existing,
    };
  }
  if (existing?.resource === resource) {
    return {
      ok: true,
      alreadyWired: true,
      resource,
      resourceRel: existing.resourceRel,
      note: "already wired — use fxmind_fivem_nui_dump, then fxmind_fivem_nui_unwire when done",
      wired: existing,
    };
  }

  const bridge = fivemRcon.copyNuiBridgeResource(root);
  const cfgCandidates = ["dev/dev.cfg", "server.cfg", "cfg/server.cfg", "dev.cfg"];
  let cfgStep = null;
  for (const rel of cfgCandidates) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) {
      cfgStep = fivemRcon.ensureNuiDumpCfg(abs, root);
      break;
    }
  }

  const manifestAbs = path.join(found.abs, found.manifest);
  const manifestText = fs.readFileSync(manifestAbs, "utf8");
  const uiPage = parseUiPage(manifestText);
  if (!uiPage) {
    return {
      ok: false,
      error: `no ui_page in ${found.rel}/${found.manifest} — resource has no NUI page to probe`,
      resourceRel: found.rel,
    };
  }

  const indexAbs = path.join(found.abs, uiPage);
  if (!fs.existsSync(indexAbs)) {
    return {
      ok: false,
      error: `ui_page file missing: ${found.rel}/${uiPage}`,
      resourceRel: found.rel,
    };
  }

  const probeSrc = probeTemplatePath();
  if (!fs.existsSync(probeSrc)) {
    return { ok: false, error: `probe template missing: ${PROBE_FILE}` };
  }

  const probeAbs = path.join(path.dirname(indexAbs), PROBE_FILE);
  fs.copyFileSync(probeSrc, probeAbs);

  const hook = ensureManifestHook(manifestAbs);
  const script = injectHtmlProbe(indexAbs, `./${PROBE_FILE}`);

  const state = {
    resource,
    resourceRel: found.rel,
    wiredAt: new Date().toISOString(),
    manifest: found.manifest,
    uiPage,
    probeRel: path.relative(found.abs, probeAbs).replace(/\\/g, "/"),
    addedHook: hook.addedHook,
    addedScriptTag: script.addedScriptTag,
    createdProbe: true,
    bridgePath: bridge.path || null,
  };
  writeWireState(root, state);

  return {
    ok: true,
    resource,
    resourceRel: found.rel,
    uiPage,
    steps: {
      bridge: bridge.action,
      cfg: cfgStep?.action || "skipped",
      manifest: hook.action,
      html: script.action,
      probe: "copied",
    },
    next: [
      "ensure fxmind-nui-bridge (and restart/ensure the target resource)",
      "open the NUI in-game",
      "call fxmind_fivem_nui_dump",
      "call fxmind_fivem_nui_unwire when finished (mandatory cleanup)",
    ],
    wired: state,
  };
}

/**
 * Remove agent-injected NUI dump wiring (markers, probe, wire state).
 */
function unwireNuiDump(options = {}) {
  const root = projectRoot(options);
  const state = readWireState(root);
  const resource = String(options.resource || state?.resource || "").trim();

  if (!resource && !state) {
    return { ok: true, alreadyClean: true, note: "nothing wired" };
  }

  if (state?.resource && resource && state.resource !== resource) {
    return {
      ok: false,
      error: `wire state is for ${state.resource}, not ${resource} — pass the wired resource or omit resource`,
      wired: state,
    };
  }

  const targetName = state?.resource || resource;
  const found = findResourceDir(root, targetName);
  const removed = [];
  const warnings = [];

  if (!found.ok) {
    warnings.push(found.error);
    clearWireState(root);
    return {
      ok: true,
      resource: targetName,
      removed,
      warnings,
      note: "cleared wire state; resource folder missing (manual cleanup may remain)",
    };
  }

  const manifestAbs = path.join(found.abs, state?.manifest || found.manifest);
  const hookResult = removeManifestHook(manifestAbs, {
    forceExisting: Boolean(state?.addedHook),
  });
  removed.push({ file: state?.manifest || found.manifest, action: hookResult.action });

  const uiPage = state?.uiPage || parseUiPage(fs.readFileSync(manifestAbs, "utf8"));
  if (uiPage) {
    const indexAbs = path.join(found.abs, uiPage);
    const htmlResult = removeHtmlProbe(indexAbs);
    removed.push({ file: uiPage, action: htmlResult.action });

    const probeAbs = path.join(
      found.abs,
      state?.probeRel || path.join(path.dirname(uiPage), PROBE_FILE),
    );
    if (fs.existsSync(probeAbs)) {
      fs.unlinkSync(probeAbs);
      removed.push({
        file: path.relative(found.abs, probeAbs).replace(/\\/g, "/"),
        action: "deleted",
      });
    }
  }

  const dumpAbs = dumpPath(root);
  if (options.clearDump !== false && fs.existsSync(dumpAbs)) {
    fs.unlinkSync(dumpAbs);
    removed.push({ file: DUMP_REL.replace(/\\/g, "/"), action: "deleted" });
  }

  clearWireState(root);
  removed.push({ file: WIRE_REL.replace(/\\/g, "/"), action: "deleted" });

  return {
    ok: true,
    resource: targetName,
    resourceRel: found.rel,
    removed,
    warnings,
    note: "NUI dump wiring removed — restart/ensure the resource if it was running",
  };
}

function wireStatus(options = {}) {
  const root = projectRoot(options);
  const wired = readWireState(root);
  return {
    ok: true,
    wired: Boolean(wired),
    state: wired,
    dumpExists: fs.existsSync(dumpPath(root)),
  };
}

module.exports = {
  DUMP_REL,
  WIRE_REL,
  BRIDGE_NAME,
  dumpPath,
  readNuiDump,
  nuiDump,
  wireNuiDump,
  unwireNuiDump,
  wireStatus,
  findResourceDir,
  parseUiPage,
};
