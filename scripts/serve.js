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
const panelCli = require("./lib/panel-cli");
const demandQueue = require("./lib/panel-demand-queue");
const panelInstall = require("./lib/panel-install");
const panelTaskGit = require("./lib/panel-task-git");
const panelTrello = require("./lib/panel-trello");
const panelBuild = require("./lib/panel-build");
const panelSubagents = require("./lib/panel-subagents");

let workspaceRoot = panel.bindWorkspaceRoot(process.env.FXMIND_TARGET || process.cwd(), { exact: true });
let workspaceIsExplicit = true;

const PACKAGE_ROOT = path.join(__dirname, "..");
const WEB_DIST = path.join(PACKAGE_ROOT, "web", "dist");
const DEFAULT_PORT = 3847;
let apiOnlyMode = false;

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
    cwd: null,
    apiOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--open") options.open = true;
    else if (arg === "--api-only") options.apiOnly = true;
    else if (arg === "--port" && argv[i + 1]) {
      options.port = Number(argv[++i]);
    } else if (arg === "--cwd" && argv[i + 1]) {
      options.cwd = argv[++i];
    } else if (arg === "--path" && argv[i + 1]) {
      const p = argv[++i];
      options.path = p.startsWith("/") ? p : `/${p}`;
    } else if (/^\d+$/.test(arg)) {
      options.port = Number(arg);
    }
  }

  return options;
}

function buildPainelArgs(argv = []) {
  const args = [...argv];
  if (!args.includes("--open")) args.unshift("--open");
  const pathIdx = args.indexOf("--path");
  if (pathIdx === -1 || !args[pathIdx + 1]) {
    args.push("--path", "/chat");
  }
  return args;
}

function printHelp() {
  console.log(`
fxmind painel — painel web local (UI + API em localhost)

Usage:
  fxmind painel [--port 3847] [--path /chat] [--cwd <dir>]

Options:
  --port <n>   Porta (padrão ${DEFAULT_PORT}, só 127.0.0.1)
  --open       Abrir navegador (padrão em fxmind painel)
  --path <p>   Rota inicial (padrão /chat)
  --cwd <dir>  Projeto inicial (padrão: .fxmind mais próximo do cwd)
  -h, --help   Ajuda

Dev (monorepo, UI via Vite):
  fxmind serve --api-only
  npm run dev

The build is generated automatically during install/update.
Manual rebuild (workspace):
  npm run build:web
`);
}

function printServeHelp() {
  console.log(`
fxmind serve — API local (sem UI estática; uso em dev)

Usage:
  fxmind serve --api-only [--port 3847] [--cwd <dir>]

Em produção use fxmind painel (abre UI + API).

Options:
  --port <n>   Listen port (default ${DEFAULT_PORT}, localhost only)
  --cwd <dir>  Bind to this project (default: nearest .fxmind from cwd)
  --api-only   Required — API only (pair with Vite: npm run dev)
  -h, --help   Show this help
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

function currentProjects() {
  return panel.listProjects(workspaceRoot, { exact: workspaceIsExplicit });
}

function bindWorkspace(root, exact = false) {
  workspaceRoot = panel.bindWorkspaceRoot(root || process.env.FXMIND_TARGET || process.cwd(), {
    exact,
  });
  workspaceIsExplicit = exact;
  return currentProjects();
}

function selectProject(projectId) {
  const selected = panel.selectProjectRoot(projectId, workspaceRoot, {
    exact: workspaceIsExplicit,
  });
  if (!selected.ok) return selected;
  workspaceRoot = selected.root;
  workspaceIsExplicit = true;
  return { ok: true, ...currentProjects() };
}

function startCli(threadId) {
  // Return the created thread to the browser before CLI discovery and startup.
  // This keeps the conversation visible immediately instead of waiting for
  // provider checks and process initialization.
  setImmediate(() => {
    panelCli.dispatchThread(threadId).catch(() => {});
  });
}

function startDemandQueue() {
  const listed = currentProjects();
  return demandQueue.startQueue(
    workspaceRoot,
    listed.workspaceId,
    listed.workspaceRoot,
    threads,
    startCli,
  );
}

function workspacePayload(options = {}) {
  const info = panel.getWorkspaceInfo(workspaceRoot, { exact: workspaceIsExplicit });
  const cli = panelCli.scanCli({ quick: options.quick === true });
  const agent = panelCli.getAgentSettings();
  const activeCli = cli.find((c) => c.id === agent.cliId) || cli.find((c) => c.installed);
  return {
    ok: true,
    workspaceRoot: info.workspaceRoot,
    workspaceId: info.workspaceId,
    gitBranch: info.gitBranch,
    memoryCount: info.memoryCount,
    hasFxmind: info.hasFxmind,
    recentRoots: info.recentRoots,
    cli: {
      activeId: activeCli?.id || null,
      activeName: activeCli?.name || null,
      installed: cli.filter((c) => c.installed).map((c) => c.id),
    },
    queuedThreads: threads.queuedCount(),
    runningThreads: threads.runningCount(),
  };
}

function resolveThreadProject(projectId) {
  if (!projectId) {
    const listed = currentProjects();
    return {
      ok: true,
      projectId: listed.workspaceId,
      projectRoot: listed.workspaceRoot,
    };
  }
  const resolved = panel.resolveProjectRoot(projectId, workspaceRoot, {
    exact: workspaceIsExplicit,
  });
  if (!resolved.ok) return resolved;
  return { ok: true, projectId, projectRoot: resolved.root };
}

function writeSse(res, event) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (typeof res.flush === "function") res.flush();
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    // Health is polled by the sidebar and must stay non-blocking by default.
    // Full CLI discovery (including auth/version checks) is only opt-in.
    const quick = url.searchParams.get("quick") !== "0";
    return sendJson(res, 200, {
      ...panel.getHealth(),
      ...workspacePayload({ quick }),
    });
  }

  if (req.method === "GET" && pathname === "/api/workspace") {
    return sendJson(res, 200, { ...workspacePayload({ quick: true }), ...currentProjects() });
  }

  if (req.method === "POST" && pathname === "/api/workspace/browse") {
    const picked = panel.browseFolderDialog();
    if (!picked) return sendJson(res, 200, { ok: false, cancelled: true });
    bindWorkspace(picked, true);
    return sendJson(res, 200, { ok: true, ...workspacePayload({ quick: true }), ...currentProjects() });
  }

  if (req.method === "PUT" && pathname === "/api/workspace") {
    try {
      const body = await readBody(req);
      const listed = bindWorkspace(body.root, true);
      return sendJson(res, 200, { ...workspacePayload({ quick: true }), ...listed });
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const selectProjectMatch = pathname.match(/^\/api\/projects\/([^/]+)\/select$/);
  if (selectProjectMatch && req.method === "POST") {
    const result = selectProject(selectProjectMatch[1]);
    if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
    return sendJson(res, 200, { ...workspacePayload({ quick: true }), ...result });
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    return sendJson(res, 200, currentProjects());
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

  if (req.method === "GET" && pathname === "/api/settings/agent") {
    const quick = url.searchParams.get("quick") !== "0";
    return sendJson(res, 200, {
      ...panelCli.getAgentSettings(),
      clis: panelCli.scanCli({ quick, forceAuth: !quick }),
      subagentSettings: panelSubagents.getSubagentSettings(workspaceRoot),
    });
  }

  if (req.method === "PUT" && pathname === "/api/settings/agent") {
    try {
      const body = await readBody(req);
      return sendJson(res, 200, {
        ...panelCli.putAgentSettings(body),
        clis: panelCli.scanCli({ quick: true }),
      });
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "GET" && pathname === "/api/settings/subagents") {
    return sendJson(res, 200, panelSubagents.getSubagentSettings(workspaceRoot));
  }

  if (req.method === "PUT" && pathname === "/api/settings/subagents") {
    try {
      const body = await readBody(req);
      const result = panelSubagents.putSubagentSettings(workspaceRoot, body);
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "GET" && pathname === "/api/cli/scan") {
    const quick = url.searchParams.get("quick") !== "0";
    return sendJson(res, 200, { clis: panelCli.scanCli({ quick, forceAuth: !quick }) });
  }

  if (req.method === "GET" && pathname === "/api/cli/models") {
    const cliId = url.searchParams.get("cliId") || "";
    const all = url.searchParams.get("all") === "1";
    return sendJson(res, 200, await panelCli.listCliModels(cliId, { all }));
  }

  if (req.method === "POST" && pathname === "/api/cli/test") {
    try {
      const body = await readBody(req);
      const result = await panelCli.testCli(body.cliId);
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "POST" && pathname === "/api/host/heartbeat") {
    return sendJson(res, 200, { ok: true, host: threads.heartbeat() });
  }

  if (req.method === "GET" && pathname === "/api/host/pending") {
    threads.heartbeat();
    return sendJson(res, 200, { ok: true, jobs: threads.pendingJobs(), host: threads.hostStatus() });
  }

  if (req.method === "GET" && pathname === "/api/host/wait") {
    const timeout = Number(url.searchParams.get("timeout")) || 20_000;
    const result = await threads.waitForJobs(timeout);
    return sendJson(res, 200, { ...result, host: threads.hostStatus() });
  }

  if (req.method === "POST" && pathname === "/api/host/claim") {
    try {
      const body = await readBody(req);
      threads.heartbeat();
      if (body.threadId) return sendJson(res, 200, threads.claimThread(body.threadId));
      return sendJson(res, 200, threads.claimAllQueued());
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "GET" && pathname === "/api/inbox") {
    const source = url.searchParams.get("source") || "all";
    const inbox = await panelTrello.fetchCombinedInbox(source);
    return sendJson(res, 200, inbox);
  }

  if (req.method === "GET" && pathname === "/api/setup/catalog") {
    return sendJson(res, 200, panelInstall.listAvailablePacks());
  }

  if (req.method === "GET" && pathname === "/api/settings/trello") {
    return sendJson(res, 200, panelTrello.getTrelloSettings());
  }

  if (req.method === "PUT" && pathname === "/api/settings/trello") {
    try {
      const body = await readBody(req);
      return sendJson(res, 200, panelTrello.putTrelloSettings(body));
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "GET" && pathname === "/api/trello/boards") {
    const result = await panelTrello.fetchTrelloBoards();
    if (!result.ok) {
      return sendJson(res, result.status || 502, {
        error: result.error,
        message: result.message,
      });
    }
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/demand-queue") {
    return sendJson(res, 200, demandQueue.getQueuePublic(workspaceRoot));
  }

  if (req.method === "PUT" && pathname === "/api/demand-queue") {
    try {
      const body = await readBody(req);
      const data = demandQueue.setItems(workspaceRoot, body.items || []);
      return sendJson(res, 200, data);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  if (req.method === "POST" && pathname === "/api/demand-queue/items") {
    try {
      const body = await readBody(req);
      const result = demandQueue.addItem(workspaceRoot, body);
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      return sendJson(res, 201, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const demandItemMatch = pathname.match(/^\/api\/demand-queue\/items\/([^/]+)$/);
  if (demandItemMatch && req.method === "DELETE") {
    return sendJson(res, 200, demandQueue.removeItem(workspaceRoot, demandItemMatch[1]));
  }

  if (req.method === "POST" && pathname === "/api/demand-queue/start") {
    const result = startDemandQueue();
    if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/demand-queue/stop") {
    return sendJson(res, 200, demandQueue.stopQueue(workspaceRoot));
  }

  if (req.method === "POST" && pathname === "/api/demand-queue/clear") {
    return sendJson(res, 200, demandQueue.clearQueue(workspaceRoot));
  }

  if (req.method === "GET" && pathname === "/api/threads") {
    const projectId = url.searchParams.get("projectId");
    if (projectId) {
      const resolved = resolveThreadProject(projectId);
      if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
      return sendJson(res, 200, {
        threads: threads.listThreads({
          projectId: resolved.projectId,
          projectRoot: resolved.projectRoot,
        }),
      });
    }
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
      startCli(created.thread.id);
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
        attachments: body.attachments,
        mode: body.mode,
      });
      if (body.content && body.run !== false) startCli(created.thread.id);
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
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (res.socket) res.socket.setNoDelay(true);
    writeSse(res, { type: "snapshot", thread: found.thread });
    const unsub = threads.subscribe(id, (event) => writeSse(res, event));
    const ping = setInterval(() => {
      if (res.writableEnded) return;
      res.write(": ping\n\n");
    }, 12000);
    req.on("close", () => {
      clearInterval(ping);
      unsub();
    });
    return;
  }

  const msgMatch = pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (msgMatch && req.method === "POST") {
    const id = msgMatch[1];
    try {
      const body = await readBody(req);
      const result = threads.addUserMessage(id, body.content, body.attachments, {
        mode: body.mode,
      });
      if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
      if (body.run !== false) startCli(id);
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const pauseMatch = pathname.match(/^\/api\/threads\/([^/]+)\/pause$/);
  if (pauseMatch && req.method === "POST") {
    const result = panelCli.pauseThread(pauseMatch[1]);
    if (!result.ok) return sendJson(res, result.status || 409, { error: result.error });
    return sendJson(res, 200, result);
  }

  const resumeMatch = pathname.match(/^\/api\/threads\/([^/]+)\/resume$/);
  if (resumeMatch && req.method === "POST") {
    let body = {};
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
    const result = panelCli.resumeThread(resumeMatch[1], body);
    if (!result.ok) return sendJson(res, result.status || 409, { error: result.error });
    return sendJson(res, 200, result);
  }

  const answerMatch = pathname.match(/^\/api\/threads\/([^/]+)\/answer$/);
  if (answerMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const result = threads.answerQuestion(answerMatch[1], body.selected);
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      startCli(answerMatch[1]);
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const discardMatch = pathname.match(/^\/api\/threads\/([^/]+)\/discard$/);
  if (discardMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const result = panelCli.discardThreadFile(discardMatch[1], body.path);
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const approveMatch = pathname.match(/^\/api\/threads\/([^/]+)\/approve$/);
  if (approveMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const result = panelCli.commitThread(approveMatch[1], {
        message: body.message,
        mergeToCurrent: body.mergeToCurrent === true,
      });
      if (!result.ok) return sendJson(res, result.status || 400, result);
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const pushMatch = pathname.match(/^\/api\/threads\/([^/]+)\/push$/);
  if (pushMatch && req.method === "POST") {
    const result = panelCli.pushThread(pushMatch[1]);
    if (!result.ok) return sendJson(res, result.status || 400, result);
    return sendJson(res, 200, result);
  }

  const judgeMatch = pathname.match(/^\/api\/threads\/([^/]+)\/judge$/);
  if (judgeMatch && req.method === "POST") {
    const id = judgeMatch[1];
    const found = threads.getThread(id);
    if (!found.ok) return sendJson(res, 404, { error: found.error });
    try {
      const body = await readBody(req);
      // Runs in the background: the client sees the new run appear over SSE
      // (thread.runs) rather than waiting on this request for the judge CLI.
      setImmediate(() => {
        panelCli.runJudge(id, { cliId: body.cliId }).catch(() => {});
      });
      return sendJson(res, 202, { ok: true, queued: true });
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const stopMatch = pathname.match(/^\/api\/threads\/([^/]+)\/stop$/);
  if (stopMatch && req.method === "POST") {
    const result = panelCli.stopThread(stopMatch[1]);
    if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
    return sendJson(res, 200, result);
  }

  const activityMatch = pathname.match(/^\/api\/threads\/([^/]+)\/activity$/);
  if (activityMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      if (body.kind !== "mcp") {
        return sendJson(res, 400, { error: "only MCP activity is accepted" });
      }
      const result = threads.hostMcpActivity(activityMatch[1], body);
      if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const replyMatch = pathname.match(/^\/api\/threads\/([^/]+)\/reply$/);
  if (replyMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const result = threads.hostReply(replyMatch[1], body.content);
      if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
      panelCli.onThreadCompleted(replyMatch[1]);
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const failMatch = pathname.match(/^\/api\/threads\/([^/]+)\/fail$/);
  if (failMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const result = threads.hostFail(failMatch[1], body.error);
      if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
      panelCli.onThreadCompleted(failMatch[1]);
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const threadMatch = pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (threadMatch && req.method === "GET") {
    panelCli.refreshThreadDiff(threadMatch[1]);
    const found = threads.getThread(threadMatch[1]);
    if (!found.ok) return sendJson(res, 404, { error: found.error });
    return sendJson(res, 200, found);
  }

  if (threadMatch && req.method === "DELETE") {
    const raw = threads.getThreadRaw(threadMatch[1]);
    panelCli.killThread(threadMatch[1]);
    const worktree = raw?.worktree?.path
      ? panelTaskGit.removeWorktree(raw.worktree.path)
      : { ok: true, removed: false };
    const result = await threads.disposeThread(threadMatch[1]);
    if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
    return sendJson(res, 200, { ...result, worktree });
  }

  const projectIconMatch = pathname.match(/^\/api\/projects\/([^/]+)\/icon$/);
  if (projectIconMatch && req.method === "GET") {
    const result = panel.getProjectIcon(projectIconMatch[1], workspaceRoot, {
      exact: workspaceIsExplicit,
    });
    if (!result.ok) return sendJson(res, result.status || 404, { error: result.error });
    res.writeHead(200, {
      "Content-Type": result.contentType,
      "Content-Length": result.data.length,
      "Cache-Control": "no-cache",
    });
    res.end(result.data);
    return;
  }

  const skillsInstallMatch = pathname.match(/^\/api\/projects\/([^/]+)\/skills\/install$/);
  if (skillsInstallMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const resolved = panel.resolveProjectRoot(skillsInstallMatch[1], workspaceRoot, {
        exact: workspaceIsExplicit,
      });
      if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
      const source = String(body.source || body.path || body.url || "").trim();
      if (!source) return sendJson(res, 400, { error: "skill source is required" });
      if (/^(https?|git@|ssh:\/\/|git:\/\/)/i.test(source)) {
        const label = String(body.name || source.split(/[/:]/).filter(Boolean).pop() || "remote").trim();
        const created = threads.createThread({
          title: `[skill-install] ${label}`.slice(0, 120),
          taskType: "skill-install",
          projectId: resolved.projectId,
          projectRoot: resolved.root,
          content: panelInstall.buildSkillInstallPrompt(source, body.name),
        });
        if (!created.ok) return sendJson(res, 400, { error: created.error });
        panelCli.dispatchThread(created.thread.id).catch(() => {});
        return sendJson(res, 202, {
          ok: true,
          queued: true,
          thread: created.thread,
          source,
        });
      }
      const localSource = path.isAbsolute(source) ? source : path.resolve(resolved.root, source);
      const result = fs.existsSync(localSource)
        ? panelInstall.installSkillFromLocal(resolved.root, localSource, body.name)
        : panelInstall.installSkillFromCatalog(resolved.root, source, body.name);
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      return sendJson(res, 201, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const skillsListMatch = pathname.match(/^\/api\/projects\/([^/]+)\/skills$/);
  if (skillsListMatch && req.method === "GET") {
    const resolved = panel.resolveProjectRoot(skillsListMatch[1], workspaceRoot, {
      exact: workspaceIsExplicit,
    });
    if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
    return sendJson(res, 200, { ok: true, skills: panelInstall.listSkills(resolved.root) });
  }

  const skillToggleMatch = pathname.match(/^\/api\/projects\/([^/]+)\/skills\/([^/]+)\/toggle$/);
  if (skillToggleMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const resolved = panel.resolveProjectRoot(skillToggleMatch[1], workspaceRoot, {
        exact: workspaceIsExplicit,
      });
      if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
      if (typeof body.active !== "boolean") {
        return sendJson(res, 400, { error: "active must be boolean" });
      }
      const result = panelInstall.toggleSkill(
        resolved.root,
        decodeURIComponent(skillToggleMatch[2]),
        body.active,
      );
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const skillMatch = pathname.match(/^\/api\/projects\/([^/]+)\/skills\/([^/]+)$/);
  if (skillMatch && (req.method === "GET" || req.method === "PUT")) {
    const resolved = panel.resolveProjectRoot(skillMatch[1], workspaceRoot, {
      exact: workspaceIsExplicit,
    });
    if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
    const name = decodeURIComponent(skillMatch[2]);
    if (req.method === "GET") {
      const result = panelInstall.readSkill(resolved.root, name);
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      return sendJson(res, 200, result);
    }
    try {
      const body = await readBody(req);
      const result = panelInstall.updateSkill(resolved.root, name, body.content);
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      return sendJson(res, 200, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const projectMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/(memories|gates|corrections|setup)$/,
  );
  if (projectMatch && req.method === "GET") {
    const [, projectId, resource] = projectMatch;
    let result;
    if (resource === "memories") {
      result = panel.getProjectMemories(projectId, workspaceRoot, { exact: workspaceIsExplicit });
    } else if (resource === "gates") {
      result = panel.getProjectGates(projectId, workspaceRoot, { exact: workspaceIsExplicit });
    }
    else if (resource === "corrections") {
      result = panel.getProjectCorrections(projectId, workspaceRoot, { exact: workspaceIsExplicit });
    } else {
      const resolved = panel.resolveProjectRoot(projectId, workspaceRoot, {
        exact: workspaceIsExplicit,
      });
      if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
      result = panelInstall.getSetupStatus(resolved.root);
    }

    if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
    return sendJson(res, 200, result);
  }

  const installMatch = pathname.match(/^\/api\/projects\/([^/]+)\/install$/);
  if (installMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const resolved = panel.resolveProjectRoot(installMatch[1], workspaceRoot, {
        exact: workspaceIsExplicit,
      });
      if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
      const result = await panelInstall.runInstall(resolved.root, body);
      return sendJson(res, result.ok ? 200 : 500, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const graphMatch = pathname.match(/^\/api\/projects\/([^/]+)\/graph$/);
  if (graphMatch && req.method === "GET") {
    const result = panel.getProjectGraph(graphMatch[1], workspaceRoot, {
      exact: workspaceIsExplicit,
    });
    if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
    return sendJson(res, 200, result);
  }

  if (graphMatch && req.method === "POST") {
    const resolved = panel.resolveProjectRoot(graphMatch[1], workspaceRoot, {
      exact: workspaceIsExplicit,
    });
    if (!resolved.ok) return sendJson(res, resolved.status || 400, { error: resolved.error });
    const result = panelInstall.buildProjectGraph(resolved.root);
    if (!result.ok) return sendJson(res, result.status || 500, { error: result.error });
    return sendJson(res, 200, result);
  }

  const memorySlugMatch = pathname.match(/^\/api\/projects\/([^/]+)\/memories\/([^/]+)$/);
  if (memorySlugMatch && req.method === "GET") {
    const [, projectId, slug] = memorySlugMatch;
    const result = panel.getProjectMemoryContent(projectId, slug, workspaceRoot, {
      exact: workspaceIsExplicit,
    });
    if (!result.ok) return sendJson(res, result.status || 404, { error: result.error });
    return sendJson(res, 200, result);
  }

  const correctionsPostMatch = pathname.match(/^\/api\/projects\/([^/]+)\/corrections$/);
  if (correctionsPostMatch && req.method === "POST") {
    try {
      const body = await readBody(req);
      const result = panel.addProjectCorrection(
        correctionsPostMatch[1],
        body,
        workspaceRoot,
        { exact: workspaceIsExplicit },
      );
      if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
      return sendJson(res, 201, result);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
  }

  const promoteMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/corrections\/([^/]+)\/promote$/,
  );
  if (promoteMatch && req.method === "POST") {
    const result = panel.promoteProjectCorrection(
      promoteMatch[1],
      promoteMatch[2],
      workspaceRoot,
      { exact: workspaceIsExplicit },
    );
    if (!result.ok) return sendJson(res, result.status || 400, { error: result.error });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname.match(/^\/api\/projects\/[^/]+\/memories\/validate$/)) {
    const projectId = pathname.split("/")[3];
    const result = panel.validateProjectMemories(projectId, workspaceRoot, {
      exact: workspaceIsExplicit,
    });
    if (!result.ok && result.error) {
      return sendJson(res, result.status || 500, { error: result.error });
    }
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname.match(/^\/api\/projects\/[^/]+\/query$/)) {
    const projectId = pathname.split("/")[3];
    try {
      const body = await readBody(req);
      const result = panel.queryProject(projectId, body, workspaceRoot, {
        exact: workspaceIsExplicit,
      });
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

    if (apiOnlyMode) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("UI em modo dev — use npm run dev (Vite)");
      return;
    }

    serveStatic(req, res, url);
  });
}

async function attachWorkspace(port, root) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspace`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root }),
      signal: AbortSignal.timeout(2000),
    });
    return await res.json();
  } catch {
    return null;
  }
}

function logPanel(port, openPath, options = {}) {
  const listed = panel.listProjects(workspaceRoot);
  if (options.apiOnly) {
    console.log(`fxmind API   → http://127.0.0.1:${port}/api/health`);
  } else {
    console.log(`fxmind painel → ${panelUrl(port, openPath)}`);
  }
  console.log(`workspace    → ${listed.workspaceRoot}`);
}

function runServeCli(argv = []) {
  const options = parseArgs(argv);
  apiOnlyMode = Boolean(options.apiOnly);

  if (options.help) {
    if (apiOnlyMode) printServeHelp();
    else printHelp();
    return 0;
  }

  if (!apiOnlyMode && !fs.existsSync(path.join(WEB_DIST, "index.html"))) {
    console.log("[Panel] web/dist missing; generating the build before startup...");
    const result = panelBuild.buildPanel({
      installDependencies: true,
      strict: false,
    });
    if (!result.ok || !fs.existsSync(path.join(WEB_DIST, "index.html"))) {
      console.error(
        `[Panel] ${result.error || "web/dist was not generated"}. ` +
          "Run the installer/update from the FXMIND workspace.",
      );
      return 1;
    }
  }

  const openPath = options.path || "/chat";
  bindWorkspace(options.cwd || process.env.FXMIND_TARGET || process.cwd(), true);
  panelCli.reconcileOrphanedRuns();

  if (apiOnlyMode && process.env.FXMIND_DEV_CHILD === "1") {
    const server = createServer();
    server.listen(options.port, "127.0.0.1", () => {
      logPanel(options.port, openPath, options);
    });
    server.on("error", (err) => {
      console.error(err);
      process.exit(1);
    });
    return 0;
  }

  isPanelUp(options.port).then(async (up) => {
    if (up) {
      const attached = await attachWorkspace(options.port, workspaceRoot);
      if (attached?.workspaceRoot) workspaceRoot = attached.workspaceRoot;
      logPanel(options.port, openPath, options);
      console.log("(reusing process)");
      if (options.open && !options.apiOnly) openBrowser(options.port, openPath);
      process.exit(0);
    }

    const server = createServer();
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        isPanelUp(options.port).then(async (alive) => {
          if (alive) {
            const attached = await attachWorkspace(options.port, workspaceRoot);
            if (attached?.workspaceRoot) workspaceRoot = attached.workspaceRoot;
            logPanel(options.port, openPath, options);
            console.log("(reusing process)");
            if (options.open && !options.apiOnly) openBrowser(options.port, openPath);
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
      logPanel(options.port, openPath, options);
      if (options.open && !options.apiOnly) openBrowser(options.port, openPath);
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
  buildPainelArgs,
  createServer,
  WEB_DIST,
  DEFAULT_PORT,
  isPanelUp,
  parseArgs,
};
