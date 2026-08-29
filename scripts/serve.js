#!/usr/bin/env node
/**
 * fxmind serve — local web panel (static SPA + /api on 127.0.0.1).
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");
const panel = require("./lib/panel-api");
const threads = require("./lib/panel-threads");
const agent = require("./lib/panel-agent");

const PACKAGE_ROOT = path.join(__dirname, "..");
const WEB_DIST = path.join(PACKAGE_ROOT, "web", "dist");
const DEFAULT_PORT = 3847;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    open: false,
    help: false,
    path: "/chat",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--open") options.open = true;
    else if (arg === "--port" && argv[i + 1]) {
      options.port = Number(argv[++i]);
    } else if (arg === "--path" && argv[i + 1]) {
      const p = argv[++i];
      options.path = p.startsWith("/") ? p : `/${p}`;
    } else if (/^\d+$/.test(arg)) {
      options.port = Number(arg);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
fxmind serve — local control plane (web panel)

Usage:
  fxmind serve [--port 3847] [--open] [--path /chat]

Options:
  --port <n>   Listen port (default ${DEFAULT_PORT}, localhost only)
  --open       Open browser after start (or if already running)
  --path <p>   Path to open (default /chat)
  -h, --help   Show this help

Build the UI first:
  npm run build:web
`);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function startAgent(threadId) {
  agent.runThread(threadId).catch(() => {});
}

function resolveThreadProject(projectId) {
  if (!projectId) {
    return { ok: true, projectId: null, projectRoot: process.cwd() };
  }
  const resolved = panel.resolveProjectRoot(projectId);
  if (!resolved.ok) return resolved;
  return { ok: true, projectId, projectRoot: resolved.root };
}

function writeSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ...panel.getHealth(),
      runningThreads: threads.runningCount(),
    });
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    return sendJson(res, 200, panel.listProjects());
  }

  if (req.method === "GET" && pathname === "/api/settings/portspace") {
    return sendJson(res, 200, panel.getPortspaceSettings());
  }

  if (req.method === "PUT" && pathname === "/api/settings/portspace") {
    try {
      const body = await readBody(req);
      return sendJson(res, 200, panel.putPortspaceSettings(body));
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "GET" && pathname === "/api/settings/cursor") {
    return sendJson(res, 200, panel.getCursorSettings());
  }

  if (req.method === "PUT" && pathname === "/api/settings/cursor") {
    try {
      const body = await readBody(req);
      return sendJson(res, 200, panel.putCursorSettings(body));
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "GET" && pathname === "/api/inbox") {
    const inbox = await panel.fetchPortspaceInbox();
    return sendJson(res, 200, inbox);
  }

  if (req.method === "GET" && pathname === "/api/threads") {
    return sendJson(res, 200, { threads: threads.listThreads() });
  }

  if (req.method === "POST" && pathname === "/api/threads/inject") {
    try {
      const body = await readBody(req);
      const resolved = resolveThreadProject(body.projectId);
      if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
      const created = threads.injectDemand({
        projectId: resolved.projectId,
        projectRoot: resolved.projectRoot,
        item: body.item || {},
      });
      startAgent(created.thread.id);
      return sendJson(res, 201, created);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "POST" && pathname === "/api/threads") {
    try {
      const body = await readBody(req);
      const resolved = resolveThreadProject(body.projectId);
      if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
      const created = threads.createThread({
        title: body.title,
        projectId: resolved.projectId,
        projectRoot: resolved.projectRoot,
        content: body.content,
      });
      if (body.content && body.run !== false) startAgent(created.thread.id);
      return sendJson(res, 201, created);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const eventsMatch = pathname.match(/^\/api\/threads\/([^/]+)\/events$/);
  if (eventsMatch && req.method === "GET") {
    const id = eventsMatch[1];
    const found = threads.getThread(id);
    if (!found.ok) return sendJson(res, 404, { error: found.error });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    writeSse(res, { type: "snapshot", thread: found.thread });
    const unsub = threads.subscribe(id, (event) => writeSse(res, event));
    req.on("close", unsub);
    return;
  }

  const msgMatch = pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (msgMatch && req.method === "POST") {
    const id = msgMatch[1];
    try {
      const body = await readBody(req);
      const result = threads.addUserMessage(id, body.content);
      if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
      if (body.run !== false) startAgent(id);
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const threadMatch = pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (threadMatch && req.method === "GET") {
    const found = threads.getThread(threadMatch[1]);
    if (!found.ok) return sendJson(res, 404, { error: found.error });
    return sendJson(res, 200, found);
  }

  if (threadMatch && req.method === "DELETE") {
    const result = await threads.disposeThread(threadMatch[1]);
    if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
    return sendJson(res, 200, result);
  }

  const projectMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/(memories|gates|corrections)$/,
  );
  if (projectMatch && req.method === "GET") {
    const [, projectId, resource] = projectMatch;
    let result;
    if (resource === "memories") result = panel.getProjectMemories(projectId);
    else if (resource === "gates") result = panel.getProjectGates(projectId);
    else result = panel.getProjectCorrections(projectId);

    if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname.match(/^\/api\/projects\/[^/]+\/memories\/validate$/)) {
    const projectId = pathname.split("/")[3];
    const result = panel.validateProjectMemories(projectId);
    if (!result.ok && result.error) {
      return sendJson(res, result.status || 500, { error: result.error });
    }
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname.match(/^\/api\/projects\/[^/]+\/query$/)) {
    const projectId = pathname.split("/")[3];
    try {
      const body = await readBody(req);
      const result = panel.queryProject(projectId, body);
      if (!result.ok && result.error) {
        return sendJson(res, result.status || 500, { error: result.error });
      }
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  return sendJson(res, 404, { error: "not found" });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel.includes("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const filePath = path.join(WEB_DIST, rel);
  if (!filePath.startsWith(WEB_DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let target = filePath;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(WEB_DIST, "index.html");
  }

  if (!fs.existsSync(target)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const data = fs.readFileSync(target);
  res.writeHead(200, { "Content-Type": type, "Content-Length": data.length });
  res.end(data);
}

function panelUrl(port, openPath = "/chat") {
  return `http://127.0.0.1:${port}${openPath}`;
}

function openBrowser(port, openPath = "/chat") {
  const url = panelUrl(port, openPath);
  if (process.platform === "win32") {
    execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true });
  } else if (process.platform === "darwin") {
    execFileSync("open", [url], { stdio: "ignore" });
  } else {
    execFileSync("xdg-open", [url], { stdio: "ignore" });
  }
}

async function isPanelUp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const data = await res.json();
    return data.service === "fxmind-panel";
  } catch {
    return false;
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    const host = req.headers.host || "127.0.0.1";
    let url;
    try {
      url = new URL(req.url || "/", `http://${host}`);
    } catch {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        await handleApi(req, res, url);
      } catch (err) {
        sendJson(res, 500, { error: String(err?.message || err) });
      }
      return;
    }

    serveStatic(req, res, url);
  });
}

function runServeCli(argv = []) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return 0;
  }

  if (!fs.existsSync(WEB_DIST)) {
    console.error("Error: web/dist not found. Run: npm run build:web");
    return 1;
  }

  const openPath = options.path || "/chat";

  isPanelUp(options.port).then((up) => {
    if (up) {
      console.log(`fxmind panel already running → ${panelUrl(options.port, openPath)}`);
      if (options.open) openBrowser(options.port, openPath);
      process.exit(0);
    }

    const server = createServer();
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        isPanelUp(options.port).then((alive) => {
          if (alive) {
            console.log(`fxmind panel already running → ${panelUrl(options.port, openPath)}`);
            openBrowser(options.port, openPath);
            process.exit(0);
          }
          console.error(`Error: port ${options.port} is in use`);
          process.exit(1);
        });
        return;
      }
      console.error(err);
      process.exit(1);
    });

    server.listen(options.port, "127.0.0.1", () => {
      console.log(`fxmind panel → ${panelUrl(options.port, openPath)}`);
      if (options.open) openBrowser(options.port, openPath);
    });
  });

  return 0;
}

if (require.main === module) {
  const code = runServeCli(process.argv.slice(2));
  if (code !== 0) process.exit(code);
}

module.exports = {
  runServeCli,
  createServer,
  WEB_DIST,
  DEFAULT_PORT,
  isPanelUp,
  parseArgs,
};
