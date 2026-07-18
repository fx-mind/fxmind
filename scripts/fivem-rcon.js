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
 *   FXMIND_FIVEM_LOG       default .fxmind/fivem-console.log (RCON activity log)
 *   FXMIND_RCON_TIMEOUT_MS default 3000
 *
 * The activity log is written by execRcon itself — do NOT tee FXServer stdout
 * in the IDE task (that breaks interactive console typing).
 */

const dgram = require("dgram");
const fs = require("fs");
const path = require("path");

const ALLOWED_COMMANDS = new Set([
  "ensure",
  "start",
  "stop",
  "restart",
  "refresh",
  "status",
  "resmon",
]);

const RESOURCE_RE = /^[a-zA-Z0-9_\[\]\-]+$/;

const CFG_CANDIDATES = [
  "dev/dev.cfg",
  "server.cfg",
  "cfg/server.cfg",
  "dev.cfg",
];

const UDP_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);

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
  const localJson = path.join(root, ".fxmind", "rcon.json");
  if (fs.existsSync(localJson)) {
    try {
      const data = JSON.parse(fs.readFileSync(localJson, "utf8"));
      if (data.password) {
        password = String(data.password);
        source = ".fxmind/rcon.json";
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
    logPath = path.join(root, ".fxmind", "fivem-console.log");
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
  return Boolean(config.password);
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
  if (!config.password) {
    return Promise.resolve({
      ok: false,
      error:
        "RCON password not found — set rcon_password in dev/dev.cfg (or server.cfg), or FXMIND_RCON_PASSWORD / .fxmind/rcon.json",
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
      finish({
        ok: true,
        command: sanitized.command,
        response: chunks.join("").trim(),
        note: chunks.length ? undefined : "no UDP reply (common for ensure/restart)",
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
  return {
    host: config.host,
    port: config.port,
    passwordSet: Boolean(config.password),
    passwordSource: config.passwordSource || null,
    logPath: config.logPath || null,
    root: config.root || null,
    transport: "udp",
  };
}

/**
 * Tail .fxmind/fivem-console.log — last lines of the FXServer terminal mirrored
 * by .vscode/fivem-start.ps1 (runs inside Cursor). Also merges server-debug.log if present.
 */
function consoleTail(options = {}) {
  const config = rconConfig(options);
  const lines = Math.min(Math.max(Number(options.lines) || 80, 1), 500);
  const terminalLog = path.resolve(config.logPath);
  const debugLog = path.resolve(config.root, ".fxmind", "server-debug.log");

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
        "sem linhas ainda — corre a task fivem-start no Cursor (.vscode/fivem-start.ps1 tees para .fxmind/fivem-console.log)",
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
  return {
    ok: true,
    configured: isConfigured(config),
    allowedCommands: [...ALLOWED_COMMANDS],
    config: publicConfig(config),
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

function ensureGitignoreLines(root) {
  const gitignorePath = path.join(root, ".gitignore");
  const lines = [
    ".fxmind/fivem-console.log",
    ".fxmind/server-debug.log",
    ".fxmind/rcon.json",
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

function writeFivemStartPs1(root, execCfg, { force = false } = {}) {
  const dest = path.join(root, ".vscode", "fivem-start.ps1");
  const templatePath = path.join(__dirname, "..", "templates", "vscode", "fivem-start.ps1");
  if (!fs.existsSync(templatePath)) {
    return { path: ".vscode/fivem-start.ps1", action: "missing-template", ok: false };
  }
  if (fs.existsSync(dest) && !force) {
    // Still refresh exec cfg placeholder if our marker is present
    let current = fs.readFileSync(dest, "utf8");
    if (current.includes("__FXMIND_EXEC_CFG__") || /\+exec',\s*'[^']+'/.test(current)) {
      current = current.replace("__FXMIND_EXEC_CFG__", execCfg);
      current = current.replace(/\+exec',\s*'[^']+'/, `+exec', '${execCfg}'`);
      fs.writeFileSync(dest, current, "utf8");
      return { path: ".vscode/fivem-start.ps1", action: "updated-exec", ok: true };
    }
    return { path: ".vscode/fivem-start.ps1", action: "kept", ok: true };
  }
  let body = fs.readFileSync(templatePath, "utf8").replace(/__FXMIND_EXEC_CFG__/g, execCfg);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body, "utf8");
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

  const execCfg = detectExecCfg(root);
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

  const config = rconConfig({ root, password: rcon.password });
  const needsRestart = rcon.changed;

  return {
    ok: true,
    root,
    execCfg,
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
  rconConfig,
  isConfigured,
  sanitizeCommand,
  execRcon,
  appendRconLog,
  consoleTail,
  status,
  installFivemDev,
  DEFAULT_LOCAL_PASSWORD,
};
