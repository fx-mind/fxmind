/**
 * FiveM local RCON — Quake3-style **UDP** (FXServer docs: "FXServer RCon uses UDP").
 *
 * Packet: 0xFF 0xFF 0xFF 0xFF + "rcon <password> <command>"
 *
 * Env (optional — password can also come from server.cfg / dev.cfg):
 *   FXMIND_TARGET / CLAUDE_PROJECT_DIR / cwd  project root
 *   FXMIND_RCON_HOST       default 127.0.0.1
 *   FXMIND_RCON_PORT       default from endpoint_add_udp/tcp or 30120
 *   FXMIND_RCON_PASSWORD   overrides cfg
 *   FXMIND_FIVEM_LOG       default .fxmind/state/fivem-console.log (RCON activity log)
 *   FXMIND_RCON_TIMEOUT_MS default 3000
 *
 * The activity log is written by execRcon itself — do NOT tee FXServer stdout
 * in the IDE task (that breaks interactive console typing).
 */

const dgram = require("dgram");
const fs = require("fs");
const path = require("path");
const { resolveLocal, writeLocal, ensureDirFor, projectRel, REL } = require("./lib/layout");

const ALLOWED_COMMANDS = new Set([
  "ensure",
  "start",
  "stop",
  "restart",
  "refresh",
  "status",
  "resmon",
  "fxmind_nui_dump",
]);

const RESOURCE_RE = /^[a-zA-Z0-9_\[\]\-]+$/;

const EXEC_CFG_DEV = "dev/dev.cfg";

const CFG_CANDIDATES = [
  EXEC_CFG_DEV,
  "server.cfg",
  "cfg/server.cfg",
  "dev.cfg",
];

const INSTALL_REQUIRED_ERROR =
  "fxmind fivem install not run for this project — run it once (dev only) before using RCON";

const NO_REPLY_ERROR =
  "RCON no reply — FXServer console not running (start the fivem-start task)";

const UDP_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);

function installMarkerPath(root) {
  return resolveLocal(root, "rcon");
}

function installMarkerWritePath(root) {
  return writeLocal(root, "rcon");
}

function isFivemInstalled(root) {
  const marker = installMarkerPath(root);
  if (!fs.existsSync(marker)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(marker, "utf8"));
    return Boolean(data.installedAt || data.execCfg);
  } catch {
    return false;
  }
}

function writeInstallMarker(root, { execCfg, password, port, host }) {
  const data = {
    installedAt: new Date().toISOString(),
    execCfg,
    password,
  };
  if (port) data.port = port;
  if (host) data.host = host;
  fs.mkdirSync(path.dirname(installMarkerWritePath(root)), { recursive: true });
  fs.writeFileSync(installMarkerWritePath(root), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function projectRoot(overrides = {}) {
  return path.resolve(
    overrides.root ||
      process.env.FXMIND_TARGET ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
}

function readPasswordFromCfgFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  // set rcon_password "secret" | rcon_password 'secret' | rcon_password secret
  const match = text.match(
    /^\s*(?:set\s+)?rcon_password\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/im,
  );
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function readPortFromCfgFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  const udp = text.match(/endpoint_add_udp\s+"[^"]*:(\d+)"/i);
  if (udp) return Number(udp[1]);
  const tcp = text.match(/endpoint_add_tcp\s+"[^"]*:(\d+)"/i);
  if (tcp) return Number(tcp[1]);
  return null;
}

function resolveFromProjectCfg(root) {
  let password = null;
  let port = null;
  let source = null;
  for (const rel of CFG_CANDIDATES) {
    const abs = path.join(root, rel);
    if (!password) {
      const pw = readPasswordFromCfgFile(abs);
      if (pw) {
        password = pw;
        source = rel;
      }
    }
    if (!port) {
      const p = readPortFromCfgFile(abs);
      if (p) port = p;
    }
  }
  // Optional local override file (gitignored)
  const localJson = resolveLocal(root, "rcon");
  if (fs.existsSync(localJson)) {
    try {
      const data = JSON.parse(fs.readFileSync(localJson, "utf8"));
      if (data.password) {
        password = String(data.password);
        source = projectRel(REL.rcon);
      }
      if (data.port) port = Number(data.port);
      if (data.host) {
        return { password, port, host: String(data.host), source };
      }
    } catch {
      // ignore invalid json
    }
  }
  return { password, port, host: null, source };
}

function rconConfig(overrides = {}) {
  const root = projectRoot(overrides);
  const fromCfg = resolveFromProjectCfg(root);

  const host = String(
    overrides.host || process.env.FXMIND_RCON_HOST || fromCfg.host || "127.0.0.1",
  ).trim();

  const port = Number(
    overrides.port ||
      process.env.FXMIND_RCON_PORT ||
      fromCfg.port ||
      30120,
  );

  const password = String(
    overrides.password !== undefined
      ? overrides.password
      : process.env.FXMIND_RCON_PASSWORD || fromCfg.password || "",
  );

  const timeoutMs = Number(overrides.timeoutMs || process.env.FXMIND_RCON_TIMEOUT_MS || 3000);
  let logPath = String(
    overrides.logPath || process.env.FXMIND_FIVEM_LOG || "",
  ).trim();
  if (!logPath) {
    logPath = writeLocal(root, "fivemLog");
  }
  return {
    host,
    port,
    password,
    timeoutMs,
    logPath,
    root,
    passwordSource: password
      ? process.env.FXMIND_RCON_PASSWORD
        ? "env:FXMIND_RCON_PASSWORD"
        : fromCfg.source || "override"
      : null,
  };
}

function isConfigured(config = rconConfig()) {
  return Boolean(config.password) && isFivemInstalled(config.root);
}

/**
 * Normalize and validate a console command. Returns { ok, command } or { ok:false, error }.
 */
function sanitizeCommand(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return { ok: false, error: "empty command" };
  }
  if (/[\r\n\0]/.test(text)) {
    return { ok: false, error: "newlines not allowed" };
  }
  if (text.length > 200) {
    return { ok: false, error: "command too long" };
  }

  const parts = text.split(" ");
  const verb = parts[0].toLowerCase();
  if (!ALLOWED_COMMANDS.has(verb)) {
    return {
      ok: false,
      error: `command not allowed: ${parts[0]} — use: ${[...ALLOWED_COMMANDS].join(", ")}`,
    };
  }

  if (verb === "fxmind_nui_dump") {
    if (parts.length === 1) {
      return { ok: true, command: "fxmind_nui_dump" };
    }
    if (parts.length === 2 && RESOURCE_RE.test(parts[1]) && !parts[1].includes("..")) {
      return { ok: true, command: `fxmind_nui_dump ${parts[1]}` };
    }
    return {
      ok: false,
      error: "fxmind_nui_dump takes optional resource name — e.g. fxmind_nui_dump or fxmind_nui_dump my_nui",
    };
  }

  if (verb === "refresh" || verb === "status" || verb === "resmon") {
    if (parts.length > 1 && verb !== "resmon") {
      return { ok: false, error: `${verb} takes no arguments` };
    }
    return { ok: true, command: verb === "resmon" && parts[1] ? `resmon ${parts[1]}` : verb };
  }

  if (parts.length < 2) {
    return { ok: false, error: `${verb} requires a resource name` };
  }
  if (parts.length !== 2 || !RESOURCE_RE.test(parts[1]) || parts[1].includes("..")) {
    return {
      ok: false,
      error: `invalid resource name — use one token like my_resource or [local]_foo`,
    };
  }
  return { ok: true, command: `${verb} ${parts[1]}` };
}

function decodeUdpResponse(msg) {
  let buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xff && buf[2] === 0xff && buf[3] === 0xff) {
    buf = buf.slice(4);
  }
  let text = buf.toString("utf8");
  text = text.replace(/^print\s*/i, "");
  return text;
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Append an RCON exchange to the project log (no FXServer stdout tee needed).
 * This is what `fxmind fivem tail` / fxmind_fivem_console_tail reads.
 */
function appendRconLog(config, entry) {
  if (!config?.logPath || !entry?.command) return;
  const logPath = path.resolve(config.logPath);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const lines = [`==== rcon ${new Date().toISOString()} ====`, `> ${entry.command}`];
    if (entry.error) lines.push(`! ${entry.error}`);
    const body = stripAnsi(entry.response || "").trim();
    if (body) {
      for (const line of body.split(/\r?\n/)) {
        if (line.length) lines.push(line);
      }
    } else if (entry.note) {
      lines.push(`(${entry.note})`);
    } else if (entry.ok) {
      lines.push("(ok)");
    }
    lines.push("");
    fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf8");

    const st = fs.statSync(logPath);
    if (st.size > 512 * 1024) {
      const text = fs.readFileSync(logPath, "utf8");
      fs.writeFileSync(logPath, text.slice(-200 * 1024), "utf8");
    }
  } catch {
    // logging must never break RCON
  }
}

/**
 * Execute one allowlisted command over FiveM UDP RCON (Quake3-style).
 */
function execRcon(command, overrides = {}) {
  const config = rconConfig(overrides);
  const sanitized = sanitizeCommand(command);
  if (!sanitized.ok) {
    return Promise.resolve({ ok: false, error: sanitized.error, config: publicConfig(config) });
  }
  if (!isFivemInstalled(config.root)) {
    return Promise.resolve({
      ok: false,
      error: INSTALL_REQUIRED_ERROR,
      config: publicConfig(config),
    });
  }
  if (!config.password) {
    return Promise.resolve({
      ok: false,
      error:
        "RCON password not found — run fxmind fivem install (writes dev/dev.cfg and .fxmind/state/rcon.json)",
      config: publicConfig(config),
    });
  }

  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const chunks = [];
    let idleTimer = null;
    let sent = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      appendRconLog(config, result);
      resolve(result);
    };

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const response = chunks.join("").trim();
        if (!response) {
          finish({
            ok: false,
            error: NO_REPLY_ERROR,
            command: sanitized.command,
            response,
            transport: "udp",
            config: publicConfig(config),
          });
          return;
        }
        const badAuth = /bad rcon|invalid rcon|rcon bad/i.test(response);
        const unset =
          /must set rcon_password|rcon_password to be able/i.test(response);
        finish({
          ok: !badAuth && !unset,
          error: unset
            ? "FXServer has no rcon_password loaded — restart the server after setting it in dev/dev.cfg"
            : badAuth
              ? "RCON auth failed — check rcon_password"
              : undefined,
          command: sanitized.command,
          response,
          transport: "udp",
          config: publicConfig(config),
        });
      }, 200);
    };

    const hardTimer = setTimeout(() => {
      if (!sent) {
        finish({
          ok: false,
          error: `RCON UDP send timeout — is FXServer running on ${config.host}:${config.port}?`,
          command: sanitized.command,
          transport: "udp",
          config: publicConfig(config),
        });
        return;
      }
      const response = chunks.join("").trim();
      if (!response) {
        finish({
          ok: false,
          error: NO_REPLY_ERROR,
          command: sanitized.command,
          response,
          transport: "udp",
          config: publicConfig(config),
        });
        return;
      }
      finish({
        ok: true,
        command: sanitized.command,
        response,
        transport: "udp",
        config: publicConfig(config),
      });
    }, config.timeoutMs);

    socket.on("message", (msg) => {
      chunks.push(decodeUdpResponse(msg));
      armIdle();
    });

    socket.on("error", (err) => {
      finish({
        ok: false,
        error: `RCON UDP error: ${err.message}`,
        command: sanitized.command,
        transport: "udp",
        config: publicConfig(config),
      });
    });

    const body = Buffer.from(`rcon ${config.password} ${sanitized.command}`, "utf8");
    const packet = Buffer.concat([UDP_HEADER, body]);

    socket.send(packet, config.port, config.host, (err) => {
      if (err) {
        finish({
          ok: false,
          error: `RCON UDP send failed: ${err.message}`,
          command: sanitized.command,
          transport: "udp",
          config: publicConfig(config),
        });
        return;
      }
      sent = true;
    });
  });
}

function publicConfig(config) {
  const installed = config.root ? isFivemInstalled(config.root) : false;
  return {
    host: config.host,
    port: config.port,
    installed,
    passwordSet: Boolean(config.password) && installed,
    passwordSource: config.passwordSource || null,
    logPath: config.logPath || null,
    root: config.root || null,
    transport: "udp",
  };
}

/**
 * Tail .fxmind/state/fivem-console.log (RCON exchanges) and optional server-debug.log.
 */
function consoleTail(options = {}) {
  const config = rconConfig(options);
  if (!isFivemInstalled(config.root)) {
    return {
      ok: false,
      error: INSTALL_REQUIRED_ERROR,
      config: publicConfig(config),
    };
  }
  const lines = Math.min(Math.max(Number(options.lines) || 80, 1), 500);
  const terminalLog = path.resolve(config.logPath);
  const debugLog = resolveLocal(config.root, "serverDebugLog");

  const parts = [];
  for (const filePath of [terminalLog, debugLog]) {
    if (!fs.existsSync(filePath)) continue;
    let content = stripAnsi(fs.readFileSync(filePath, "utf8"));
    const startMarks = [...content.matchAll(/^==== fivem-start .*$/gm)];
    if (startMarks.length) {
      content = content.slice(startMarks[startMarks.length - 1].index);
    }
    const label = path.basename(filePath);
    const body = content
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .filter(
        (line) =>
          !/ensure\s*rconlogensure/i.test(line) && !/^ensure\s+ensure\s+/i.test(line),
      );
    const useful = body.filter((line) => !/^==== fivem-start\b/.test(line));
    if (useful.length) {
      parts.push(`---- ${label} ----`, ...body);
    }
  }

  if (!parts.length) {
    return {
      ok: false,
      empty: true,
      error:
        "sem linhas ainda — inicie fivem-start e use RCON (fxmind fivem ensure / MCP fxmind_fivem_cmd); opcional: .fxmind/server-debug.log",
      config: publicConfig(config),
      path: terminalLog,
    };
  }

  const slice = parts.slice(-lines);
  return {
    ok: true,
    path: terminalLog,
    lines: slice.length,
    content: slice.join("\n"),
    source: "terminal-log",
    config: publicConfig(config),
  };
}

function status() {
  const config = rconConfig();
  const installed = isFivemInstalled(config.root);
  return {
    ok: true,
    installed,
    configured: isConfigured(config),
    allowedCommands: [...ALLOWED_COMMANDS],
    config: publicConfig(config),
  };
}

function statusReason({ installed, configured, serverReachable, probeError }) {
  if (!installed) {
    return "run fxmind fivem install first (dev only)";
  }
  if (!configured) {
    return "RCON not configured — run fxmind fivem install (or fxmind_fivem_install), then restart fivem-start";
  }
  if (!serverReachable) {
    if (/no reply|not running/i.test(probeError || "")) {
      return "FXServer console not answering — start the fivem-start task, then retry";
    }
    if (/timeout|FXServer running/i.test(probeError || "")) {
      return "FXServer not running or RCON unreachable — start the fivem-start task, then retry";
    }
    if (/auth failed|bad rcon/i.test(probeError || "")) {
      return "RCON auth failed — check rcon_password matches dev/dev.cfg and restart FXServer";
    }
    if (/no rcon_password loaded/i.test(probeError || "")) {
      return "FXServer has no rcon_password loaded — restart fivem-start after install";
    }
    return probeError || "FXServer not reachable via RCON";
  }
  return null;
}

/**
 * Config check + lightweight RCON probe (`status`). Used by MCP before ensure/tail.
 */
async function statusProbe(overrides = {}) {
  const config = rconConfig(overrides);
  const installed = isFivemInstalled(config.root);
  const configured = isConfigured(config);
  const base = {
    ok: true,
    installed,
    configured,
    allowedCommands: [...ALLOWED_COMMANDS],
    config: publicConfig(config),
  };

  if (!installed) {
    return {
      ...base,
      serverReachable: false,
      available: false,
      reason: statusReason({
        installed: false,
        configured: false,
        serverReachable: false,
      }),
    };
  }

  if (!configured) {
    return {
      ...base,
      serverReachable: false,
      available: false,
      reason: statusReason({ installed: true, configured: false, serverReachable: false }),
    };
  }

  const probe = await execRcon("status", overrides);
  const probeError = probe.error || null;
  const responseText = probe.response ? String(probe.response).trim() : "";
  const serverReachable = probe.ok && Boolean(responseText);

  return {
    ...base,
    serverReachable,
    available: serverReachable,
    reason: statusReason({ installed, configured, serverReachable, probeError }),
    probe: {
      ok: probe.ok,
      error: probeError,
      responsePreview: probe.response ? String(probe.response).slice(0, 200) : null,
    },
  };
}

const DEFAULT_LOCAL_PASSWORD = "fxmind-local-dev";
const FIVEM_START_TASK_LABEL = "fivem-start";

function detectExecCfg(root) {
  for (const rel of CFG_CANDIDATES) {
    if (fs.existsSync(path.join(root, rel))) return rel;
  }
  return "dev/dev.cfg";
}

function detectFxServer(root) {
  const candidates = [
    path.join(root, "artifacts", "FXServer.exe"),
    path.join(root, "FXServer.exe"),
    path.join(root, "artifacts", "FXServer"),
    path.join(root, "FXServer"),
  ];
  for (const abs of candidates) {
    if (fs.existsSync(abs)) {
      return { found: true, path: abs, rel: path.relative(root, abs) };
    }
  }
  return { found: false, path: null, rel: "artifacts/FXServer.exe" };
}

function ensureRconInCfg(cfgAbs, password) {
  const existing = readPasswordFromCfgFile(cfgAbs);
  if (existing) {
    return { changed: false, password: existing, action: "kept" };
  }
  const block = [
    "",
    "# Local RCON for fxmind MCP / IDE agents (never use a real password in production)",
    `set rcon_password "${password}"`,
    'set fxmind_log ".fxmind/server-debug.log"',
    "",
  ].join("\n");
  fs.appendFileSync(cfgAbs, block, "utf8");
  return { changed: true, password, action: "added" };
}

const NUI_BRIDGE_NAME = "fxmind-nui-bridge";

function nuiBridgeTemplateDir() {
  return path.join(__dirname, "..", "templates", "resources", NUI_BRIDGE_NAME);
}

function detectNuiBridgeDest(root) {
  const localDir = path.join(root, "resources", "[local]");
  if (fs.existsSync(localDir) && fs.statSync(localDir).isDirectory()) {
    return {
      abs: path.join(localDir, NUI_BRIDGE_NAME),
      rel: `resources/[local]/${NUI_BRIDGE_NAME}`,
    };
  }
  const fxmindDir = path.join(root, "resources", "[fxmind]");
  if (fs.existsSync(fxmindDir) && fs.statSync(fxmindDir).isDirectory()) {
    return {
      abs: path.join(fxmindDir, NUI_BRIDGE_NAME),
      rel: `resources/[fxmind]/${NUI_BRIDGE_NAME}`,
    };
  }
  const resourcesDir = path.join(root, "resources");
  if (fs.existsSync(resourcesDir) && fs.statSync(resourcesDir).isDirectory()) {
    return {
      abs: path.join(resourcesDir, NUI_BRIDGE_NAME),
      rel: `resources/${NUI_BRIDGE_NAME}`,
    };
  }
  return {
    abs: path.join(root, "resources", "[local]", NUI_BRIDGE_NAME),
    rel: `resources/[local]/${NUI_BRIDGE_NAME}`,
  };
}

function copyNuiBridgeResource(root) {
  const src = nuiBridgeTemplateDir();
  if (!fs.existsSync(src)) {
    return { ok: false, action: "missing-template", path: null };
  }
  const dest = detectNuiBridgeDest(root);
  fs.mkdirSync(dest.abs, { recursive: true });

  const skipNames = new Set(["last-dump.json"]);
  /** @type {string[]} */
  const copied = [];

  function walk(fromDir, toDir) {
    for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
      if (skipNames.has(entry.name)) continue;
      const from = path.join(fromDir, entry.name);
      const to = path.join(toDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        walk(from, to);
      } else {
        fs.copyFileSync(from, to);
        copied.push(path.relative(dest.abs, to).replace(/\\/g, "/"));
      }
    }
  }

  walk(src, dest.abs);
  return {
    ok: true,
    action: copied.length ? "synced" : "empty",
    path: dest.rel,
    files: copied,
  };
}

function ensureNuiDumpCfg(cfgAbs, root) {
  let text = fs.existsSync(cfgAbs) ? fs.readFileSync(cfgAbs, "utf8") : "";
  const dumpAbs = writeLocal(root, "nuiDump").replace(/\\/g, "/");
  const changes = [];

  if (!/^\s*ensure\s+fxmind-nui-bridge\s*$/im.test(text)) {
    const block = [
      "",
      "# fxmind NUI dump bridge (dev agents)",
      "ensure fxmind-nui-bridge",
      "",
    ].join("\n");
    text += block;
    changes.push("ensure");
  }

  const pathLine = `set fxmind_nui_dump_path "${dumpAbs}"`;
  if (/^\s*(?:set\s+)?fxmind_nui_dump_path\s+/im.test(text)) {
    const next = text.replace(
      /^\s*(?:set\s+)?fxmind_nui_dump_path\s+(?:"[^"]*"|'[^']*'|\S+)\s*$/im,
      pathLine,
    );
    if (next !== text) {
      text = next;
      changes.push("path-updated");
    }
  } else {
    if (!text.endsWith("\n")) text += "\n";
    text += `${pathLine}\n`;
    changes.push("path");
  }

  if (changes.length) {
    fs.mkdirSync(path.dirname(cfgAbs), { recursive: true });
    fs.writeFileSync(cfgAbs, text, "utf8");
  }

  return {
    ok: true,
    action: changes.length ? changes.join("+") : "kept",
    dumpPath: dumpAbs,
  };
}

function ensureGitignoreLines(root) {
  const gitignorePath = path.join(root, ".gitignore");
  const lines = [
    ".fxmind/state/",
    ".fxmind/state/fivem-console.log",
    ".fxmind/server-debug.log",
    ".fxmind/state/nui-dump.json",
    ".fxmind/state/nui-wire.json",
    ".fxmind/state/rcon.json",
  ];
  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const added = [];
  for (const line of lines) {
    const re = new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
    if (re.test(content)) continue;
    if (content.length && !content.endsWith("\n")) content += "\n";
    if (!content.includes("# fxmind session")) {
      content += "\n# fxmind session (do not commit)\n";
    }
    content += `${line}\n`;
    added.push(line);
  }
  if (added.length) {
    fs.writeFileSync(gitignorePath, content, "utf8");
  }
  return { path: ".gitignore", added };
}

const LEGACY_BROKEN_TEE_RE = /2>&1\s*\|\s*ForEach-Object/;

function renderFivemStartPs1(execCfg) {
  const templatePath = path.join(__dirname, "..", "templates", "vscode", "fivem-start.ps1");
  if (!fs.existsSync(templatePath)) return null;
  return fs.readFileSync(templatePath, "utf8").replace(/__FXMIND_EXEC_CFG__/g, execCfg);
}

function writeFivemStartPs1(root, execCfg, { force = false } = {}) {
  const dest = path.join(root, ".vscode", "fivem-start.ps1");
  const rendered = renderFivemStartPs1(execCfg);
  if (!rendered) {
    return { path: ".vscode/fivem-start.ps1", action: "missing-template", ok: false };
  }

  if (fs.existsSync(dest) && !force) {
    const current = fs.readFileSync(dest, "utf8");
    const hasBrokenTee = LEGACY_BROKEN_TEE_RE.test(current);
    const needsExecRefresh =
      current.includes("__FXMIND_EXEC_CFG__") || /\+exec',\s*'[^']+'/.test(current);

    if (!needsExecRefresh && !hasBrokenTee) {
      return { path: ".vscode/fivem-start.ps1", action: "kept", ok: true };
    }

    if (needsExecRefresh && !hasBrokenTee && !current.includes("__FXMIND_EXEC_CFG__")) {
      const updated = current.replace(/\+exec',\s*'[^']+'/, `+exec', '${execCfg}'`);
      fs.writeFileSync(dest, updated, "utf8");
      return { path: ".vscode/fivem-start.ps1", action: "updated-exec", ok: true };
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, rendered, "utf8");
    return {
      path: ".vscode/fivem-start.ps1",
      action: hasBrokenTee ? "fixed-interactive-console" : "updated-exec",
      ok: true,
    };
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, rendered, "utf8");
  return { path: ".vscode/fivem-start.ps1", action: force ? "replaced" : "created", ok: true };
}

function ensureFivemStartTask(root) {
  const tasksPath = path.join(root, ".vscode", "tasks.json");
  const task = {
    label: FIVEM_START_TASK_LABEL,
    type: "process",
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "${workspaceFolder}\\.vscode\\fivem-start.ps1",
    ],
    options: { cwd: "${workspaceFolder}" },
    group: { kind: "build", isDefault: true },
    presentation: { reveal: "always", panel: "dedicated", focus: true },
    problemMatcher: [],
  };

  let data = { version: "2.0.0", tasks: [] };
  let action = "created";
  if (fs.existsSync(tasksPath)) {
    try {
      data = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
      if (!Array.isArray(data.tasks)) data.tasks = [];
    } catch {
      data = { version: "2.0.0", tasks: [] };
      action = "recreated";
    }
  }
  const idx = data.tasks.findIndex((t) => t && t.label === FIVEM_START_TASK_LABEL);
  if (idx >= 0) {
    data.tasks[idx] = { ...data.tasks[idx], ...task };
    action = action === "recreated" ? action : "updated";
  } else {
    data.tasks.push(task);
    action = fs.existsSync(tasksPath) && action !== "recreated" ? "added" : action;
  }
  fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
  fs.writeFileSync(tasksPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { path: ".vscode/tasks.json", action, ok: true };
}

/**
 * Idempotent local FiveM RCON + IDE task setup for agents/humans.
 *   fxmind fivem install
 */
function installFivemDev(options = {}) {
  const root = projectRoot(options);
  const force = Boolean(options.force);
  const password =
    String(options.password || process.env.FXMIND_RCON_PASSWORD || DEFAULT_LOCAL_PASSWORD).trim() ||
    DEFAULT_LOCAL_PASSWORD;

  const steps = [];
  const warnings = [];

  fs.mkdirSync(path.join(root, ".fxmind"), { recursive: true });

  const execCfg = EXEC_CFG_DEV;
  const cfgAbs = path.join(root, execCfg);
  if (!fs.existsSync(cfgAbs)) {
    fs.mkdirSync(path.dirname(cfgAbs), { recursive: true });
    fs.writeFileSync(
      cfgAbs,
      [
        `# Created by fxmind fivem install`,
        `endpoint_add_tcp "0.0.0.0:30120"`,
        `endpoint_add_udp "0.0.0.0:30120"`,
        "",
      ].join("\n"),
      "utf8",
    );
    steps.push({ step: "cfg-create", path: execCfg, action: "created" });
  }

  const rcon = ensureRconInCfg(cfgAbs, password);
  steps.push({
    step: "rcon_password",
    path: execCfg,
    action: rcon.action,
    passwordSet: true,
  });

  const fx = detectFxServer(root);
  if (!fx.found) {
    warnings.push(`FXServer not found at ${fx.rel} — place artifacts then restart the fivem-start task`);
  } else {
    steps.push({ step: "fxserver", path: fx.rel, action: "found" });
  }

  steps.push({ step: "ps1", ...writeFivemStartPs1(root, execCfg, { force }) });
  steps.push({ step: "tasks", ...ensureFivemStartTask(root) });
  steps.push({ step: "gitignore", ...ensureGitignoreLines(root) });

  const bridge = copyNuiBridgeResource(root);
  steps.push({
    step: "nui-bridge",
    path: bridge.path,
    action: bridge.action,
    ok: bridge.ok !== false,
  });
  if (bridge.ok !== false) {
    const nuiCfg = ensureNuiDumpCfg(cfgAbs, root);
    steps.push({
      step: "nui-dump-cfg",
      path: execCfg,
      action: nuiCfg.action,
      dumpPath: nuiCfg.dumpPath,
    });
  } else {
    warnings.push("fxmind-nui-bridge template missing — NUI dump MCP will not work until pack is complete");
  }

  const port = readPortFromCfgFile(cfgAbs) || 30120;
  writeInstallMarker(root, {
    execCfg,
    password: rcon.password,
    port,
  });
  steps.push({ step: "install-marker", path: ".fxmind/state/rcon.json", action: "written" });

  const config = rconConfig({ root, password: rcon.password });
  const needsRestart = rcon.changed;

  return {
    ok: true,
    root,
    execCfg,
    installed: true,
    passwordSource: config.passwordSource,
    passwordSet: Boolean(rcon.password),
    needsServerRestart: needsRestart,
    note: needsRestart
      ? "rcon_password was added/changed — restart FXServer (fivem-start task) before ensure works"
      : "RCON already configured — ensure/restart via MCP is ready when FXServer is running",
    steps,
    warnings,
    config: publicConfig(config),
  };
}

module.exports = {
  ALLOWED_COMMANDS,
  EXEC_CFG_DEV,
  rconConfig,
  isConfigured,
  isFivemInstalled,
  sanitizeCommand,
  execRcon,
  appendRconLog,
  consoleTail,
  status,
  statusProbe,
  installFivemDev,
  copyNuiBridgeResource,
  ensureNuiDumpCfg,
  DEFAULT_LOCAL_PASSWORD,
  NUI_BRIDGE_NAME,
};
