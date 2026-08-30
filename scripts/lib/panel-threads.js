/**
 * In-memory chat threads for the web panel.
 * Work is done by the host agent chat that opened `/fxmind painel` — no API key.
 */

const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseGatesFromText,
  parseTodosFromText,
  normalizeAskPayload,
} = require("./panel-cli-stream");
const { readPanelConfig } = require("./panel-api");
const { normalizeTaskMode } = require("./panel-context");

const threads = new Map();
const bus = new EventEmitter();
bus.setMaxListeners(50);

const HOST_TTL_MS = 25_000;
const THREAD_STATUSES = new Set([
  "idle",
  "queued",
  "running",
  "waiting",
  "paused",
  "error",
  "done",
]);
const THREAD_PHASES = new Set(["working", "review", "committed", "pushed"]);
const TEST_PROCESS =
  process.env.NODE_ENV === "test" ||
  process.argv.includes("--test") ||
  process.argv.some((arg) => arg.startsWith("--test-name-pattern"));
let persistenceEnabled =
  !TEST_PROCESS && process.env.FXMIND_PANEL_DISABLE_PERSISTENCE !== "1";
const persistTimers = new Map();
let lastHeartbeatAt = 0;

function persistenceRoot() {
  return path.resolve(
    process.env.FXMIND_PANEL_DATA_DIR ||
      path.join(os.homedir(), ".fxmind", "panel", "threads"),
  );
}

function persistenceProjectId(thread) {
  const id = String(thread?.projectId || "unassigned").replace(/[^A-Za-z0-9._-]/g, "_");
  return id || "unassigned";
}

function persistencePath(thread) {
  return path.join(
    persistenceRoot(),
    persistenceProjectId(thread),
    `${String(thread.id).replace(/[^A-Za-z0-9._-]/g, "_")}.json`,
  );
}

function persistableMessage(message) {
  const copy = { ...message };
  if (Array.isArray(copy.attachments)) {
    copy.attachments = copy.attachments.map(({ id, name, mimeType }) => ({
      id,
      name,
      mimeType,
    }));
  }
  return copy;
}

function persistableThread(thread) {
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    projectRoot: thread.projectRoot || null,
    cardId: thread.cardId || null,
    taskType: thread.taskType || "task",
    mode: thread.mode || "task",
    status: thread.status,
    phase: thread.phase,
    error: thread.error || null,
    messages: (thread.messages || []).map(persistableMessage),
    activity: thread.activity || [],
    gates: thread.gates || null,
    todos: thread.todos || [],
    diff: thread.diff || null,
    question: thread.question || null,
    worktree: thread.worktree || null,
    commits: thread.commits || [],
    runStartedAt: thread.runStartedAt || null,
    runEndedAt: thread.runEndedAt || null,
    cliId: thread.cliId || null,
    runs: Array.isArray(thread.runs) ? thread.runs : [],
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function schedulePersist(thread) {
  if (!persistenceEnabled || !thread) return;
  const id = thread.id;
  clearTimeout(persistTimers.get(id));
  persistTimers.set(
    id,
    setTimeout(() => {
      persistTimers.delete(id);
      try {
        const file = persistencePath(thread);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(persistableThread(thread), null, 2)}\n`, "utf8");
        fs.renameSync(temp, file);
      } catch {
        // Thread persistence is best-effort and must never break the panel.
      }
    }, 100),
  );
}

function loadPersistedThreads() {
  if (!persistenceEnabled) return;
  const root = persistenceRoot();
  if (!fs.existsSync(root)) return;
  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    let files;
    try {
      files = fs.readdirSync(path.join(root, project.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      try {
        const loaded = JSON.parse(
          fs.readFileSync(path.join(root, project.name, file.name), "utf8"),
        );
        if (!loaded || !loaded.id || threads.has(loaded.id)) continue;
        const thread = normalizeThread(loaded);
        if (thread) threads.set(thread.id, thread);
      } catch {
        // A corrupt snapshot is ignored; a later mutation can rewrite it.
      }
    }
  }
}

function normalizeQuestion(input) {
  if (!input || typeof input !== "object") return null;
  const normalized = normalizeAskPayload(input);
  if (!normalized) return null;
  return {
    id: String(input.id || crypto.randomUUID()).slice(0, 120),
    question: normalized.question,
    options: normalized.options,
    multi: normalized.multi,
  };
}

const OPERATION_MODES = new Set(["task", "plan", "query"]);

function normalizeOperationMode(value) {
  return OPERATION_MODES.has(value) ? value : "task";
}

function normalizeThread(input) {
  const id = String(input.id || "").trim();
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const status = THREAD_STATUSES.has(input.status) ? input.status : "idle";
  const phase = THREAD_PHASES.has(input.phase)
    ? input.phase
    : status === "done"
      ? "review"
      : "working";
  return {
    id,
    title: String(input.title || "Nova conversa").trim() || "Nova conversa",
    projectId: input.projectId || null,
    projectRoot: input.projectRoot || null,
    cardId: input.cardId || null,
    taskType: String(input.taskType || "task"),
    mode: normalizeOperationMode(input.mode),
    status: status === "running" ? "paused" : status,
    phase,
    error: input.error || null,
    messages: Array.isArray(input.messages) ? input.messages : [],
    activity: Array.isArray(input.activity) ? input.activity : [],
    gates: input.gates || null,
    todos: Array.isArray(input.todos) ? input.todos : [],
    diff: input.diff || null,
    question: normalizeQuestion(input.question),
    worktree:
      input.worktree && typeof input.worktree === "object"
        ? {
            path: input.worktree.path || null,
            branch: input.worktree.branch || null,
            baseBranch: input.worktree.baseBranch || null,
          }
        : null,
    commits: Array.isArray(input.commits) ? input.commits : [],
    runStartedAt: input.runStartedAt || null,
    runEndedAt: input.runEndedAt || null,
    cliId: input.cliId || null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function publicParts(message) {
  if (!message) return [];
  if (Array.isArray(message.parts) && message.parts.length) return message.parts;
  if (message.content) {
    return [{ id: "text", type: "text", text: message.content }];
  }
  return [];
}

function publicMessage(message) {
  if (!message) return null;
  return {
    role: message.role,
    content: message.content,
    at: message.at,
    streaming: message.streaming || false,
    attachments: message.attachments,
    answer: message.answer || null,
    parts: publicParts(message),
    mode: message.mode || null,
  };
}

function stampRunEnded(thread) {
  if (!thread?.runStartedAt) return;
  thread.runEndedAt = new Date().toISOString();
}

function settleRunningWork(thread, nextStatus = "done") {
  if (!thread) return;
  const status = nextStatus === "error" ? "error" : "done";
  for (const message of thread.messages || []) {
    for (const part of message.parts || []) {
      if (part.status === "running") part.status = status;
    }
  }
  for (const item of thread.activity || []) {
    if (item.status === "running") item.status = status;
  }
}

function publicThread(thread) {
  if (!thread) return null;
  if (thread.status !== "running" && thread.status !== "queued") {
    settleRunningWork(thread, thread.status === "error" ? "error" : "done");
  }
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    projectRoot: thread.projectRoot || null,
    cardId: thread.cardId || null,
    taskType: thread.taskType || "task",
    mode: thread.mode || "task",
    status: thread.status,
    phase: thread.phase || (thread.status === "done" ? "review" : "working"),
    error: thread.error || null,
    runningCountHint: thread.status === "running" ? 1 : 0,
    messages: (thread.messages || []).map(publicMessage),
    activity: thread.activity || [],
    gates: thread.gates || null,
    todos: thread.todos || [],
    diff: thread.diff || null,
    question: thread.question || null,
    worktree: thread.worktree || null,
    commits: thread.commits || [],
    runStartedAt: thread.runStartedAt || null,
    runEndedAt: thread.runEndedAt || null,
    cliId: thread.cliId || null,
    runs: Array.isArray(thread.runs) ? thread.runs : [],
    taskType: thread.taskType || "task",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function emit(threadId, event) {
  schedulePersist(threads.get(threadId));
  bus.emit(`thread:${threadId}`, event);
  bus.emit("threads", { type: "list", threads: listThreads() });
}

function listThreads(filter = {}) {
  const projectId = filter.projectId ? String(filter.projectId) : "";
  const projectRoot = filter.projectRoot ? String(filter.projectRoot) : "";
  return [...threads.values()]
    .filter((thread) => {
      if (!projectId && !projectRoot) return true;
      if (projectId && thread.projectId === projectId) return true;
      if (projectRoot && thread.projectRoot) {
        const left = thread.projectRoot.replace(/\\/g, "/").toLowerCase();
        const right = projectRoot.replace(/\\/g, "/").toLowerCase();
        if (left === right) return true;
      }
      return false;
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(publicThread);
}

function getThread(id) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  return { ok: true, thread: publicThread(thread) };
}

function getThreadRaw(id) {
  return threads.get(id) || null;
}

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 6;

function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_ATTACHMENTS; i += 1) {
    const item = raw[i] || {};
    const mimeType = String(item.mimeType || item.type || "").trim();
    const name = String(item.name || `imagem-${i + 1}`).trim() || `imagem-${i + 1}`;
    let data = String(item.data || item.dataUrl || "").trim();
    if (!mimeType.startsWith("image/") || !data) continue;
    if (!data.startsWith("data:")) {
      data = `data:${mimeType};base64,${data}`;
    }
    const base64 = data.split(",")[1] || "";
    const bytes = Math.ceil((base64.length * 3) / 4);
    if (bytes > MAX_ATTACHMENT_BYTES) continue;
    out.push({
      id: String(item.id || crypto.randomUUID()),
      name,
      mimeType,
      data,
    });
  }
  return out;
}

function materializeAttachments(attachments, threadId) {
  const os = require("os");
  const fs = require("fs");
  const path = require("path");
  const out = [];
  for (const att of normalizeAttachments(attachments)) {
    const match = att.data.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) continue;
    const ext = (match[1].split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
    const file = path.join(os.tmpdir(), `fxmind-img-${threadId}-${att.id}.${ext}`);
    fs.writeFileSync(file, Buffer.from(match[2], "base64"));
    out.push({ id: att.id, name: att.name, mimeType: att.mimeType, path: file });
  }
  return out;
}

function lastUserContent(thread) {
  const users = (thread.messages || []).filter((m) => m.role === "user");
  return users.at(-1)?.content || "";
}

function lastUserMessage(thread) {
  const users = (thread.messages || []).filter((m) => m.role === "user");
  return users.at(-1) || null;
}

function toJob(thread) {
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    projectRoot: thread.projectRoot,
    worktree: thread.worktree || null,
    cwd: thread.worktree?.path || thread.projectRoot,
    cardId: thread.cardId,
    prompt: lastUserContent(thread),
  };
}

function buildDemandPrompt(item = {}) {
  let taskMode = "full";
  try {
    taskMode = normalizeTaskMode(readPanelConfig().agent?.taskMode);
  } catch {
    /* ignore */
  }
  const toolsLine =
    "Use somente ferramentas MCP fxmind para descoberta, gates, grafo, FiveM e DB — não use grep nem busca manual no repo.";
  const pipelineLine =
    taskMode === "quick"
      ? "Modo rápido (PANEL_MODE: quick): fxmind_start_task trivial=true → implemente com paths do contexto → Gate V/C via MCP."
      : "Pipeline fxmind via MCP: classificar → fxmind_start_task → Gate A/B (fxmind_query) → implementar → V → C.";
  const lines = [
    "Implemente esta demanda no repositório do projeto ativo.",
    toolsLine,
    pipelineLine,
    "Não invente natives, APIs ou caminhos — verifique no código e nas memórias `.fxmind/`.",
    "",
    `**Título:** ${item.title || "Sem título"}`,
  ];
  if (item.priority) lines.push(`**Prioridade:** ${item.priority}`);
  if (item.category) lines.push(`**Categoria:** ${item.category}`);
  if (item.column?.name) lines.push(`**Coluna:** ${item.column.name}`);
  if (item.dueDate) lines.push(`**Prazo:** ${item.dueDate}`);
  if (item.overdue) lines.push("**Status:** atrasada");
  if (item.cardId) lines.push(`**Card PortSpace:** ${item.cardId}`);
  if (item.assignee?.name) lines.push(`**Assignee:** ${item.assignee.name}`);
  if (item.description) {
    lines.push("", "## Descrição", String(item.description));
  }
  return lines.join("\n");
}

function createThread(input = {}) {
  const id = crypto.randomUUID();
  const title = String(input.title || "Nova conversa").trim() || "Nova conversa";
  const now = new Date().toISOString();
  const hasContent = Boolean(input.content) || normalizeAttachments(input.attachments).length > 0;
  const thread = {
    id,
    title,
    projectId: input.projectId || null,
    projectRoot: input.projectRoot || null,
    cardId: input.cardId || null,
    status: hasContent ? "queued" : "idle",
    phase: "working",
    error: null,
    messages: [],
    activity: [],
    gates: null,
    todos: [],
    diff: null,
    question: null,
    worktree: null,
    commits: [],
    runStartedAt: null,
    runEndedAt: null,
    cliId: null,
    taskType: String(input.taskType || "task"),
    mode: normalizeOperationMode(input.mode),
    createdAt: now,
    updatedAt: now,
  };

  if (hasContent) {
    const attachments = normalizeAttachments(input.attachments);
    thread.messages.push({
      role: "user",
      content: String(input.content || ""),
      at: now,
      mode: thread.mode,
      ...(attachments.length ? { attachments } : {}),
    });
  }

  threads.set(id, normalizeThread(thread));
  emit(id, { type: "created", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function injectDemand(input = {}) {
  const item = input.item || {};
  const title = String(item.title || "Demanda").trim();
  return createThread({
    title,
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    cardId: item.cardId || null,
    content: buildDemandPrompt(item),
  });
}

function addUserMessage(id, content, attachments, options = {}) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  const text = String(content || "").trim();
  const imgs = normalizeAttachments(attachments);
  if (!text && !imgs.length) {
    return { ok: false, status: 400, error: "content or attachments required" };
  }
  if (thread.status === "running") {
    return { ok: false, status: 409, error: "thread is already running" };
  }
  if (thread.status === "waiting") {
    return { ok: false, status: 409, error: "answer the pending question first" };
  }

  if (options.mode !== undefined) thread.mode = normalizeOperationMode(options.mode);
  const now = new Date().toISOString();
  thread.messages.push({
    role: "user",
    content: text,
    at: now,
    mode: thread.mode,
    ...(imgs.length ? { attachments: imgs } : {}),
  });
  thread.status = "queued";
  thread.phase = "working";
  thread.question = null;
  thread.error = null;
  thread.updatedAt = now;
  emit(id, { type: "message", message: thread.messages.at(-1), thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function ensureStreamingAssistant(thread) {
  const last = thread.messages.at(-1);
  if (last && last.role === "assistant" && last.streaming === true) return last;
  const msg = {
    role: "assistant",
    content: "",
    at: new Date().toISOString(),
    streaming: true,
    parts: [],
  };
  thread.messages.push(msg);
  return msg;
}

function nextPartId(message) {
  return `p${(message.parts || []).length + 1}-${Date.now().toString(36)}`;
}

function syncMessageContent(message) {
  message.content = (message.parts || [])
    .filter((p) => p.type === "text" || p.type === "think")
    .map((p) => p.text || "")
    .join("\n\n");
}

function appendAssistantDelta(id, text) {
  applyStreamEvent(id, { kind: "text", text });
}

function applyStreamEvent(id, event) {
  const thread = threads.get(id);
  if (!thread || !event || thread.cancelled || thread.status === "paused") return;
  if (thread.status === "running") thread._lastActivityAt = Date.now();
  const now = new Date().toISOString();
  const message = ensureStreamingAssistant(thread);

  if (event.kind === "text" && event.text) {
    const lastPart = (message.parts || []).at(-1);
    if (lastPart && lastPart.type === "text") {
      lastPart.text += event.text;
    } else {
      message.parts = message.parts || [];
      message.parts.push({ id: nextPartId(message), type: "text", text: event.text });
    }
    syncMessageContent(message);
    mergeMarkerGates(thread, parseGatesFromText(event.text));
    mergeTodos(thread, parseTodosFromText(event.text));
  } else if (event.kind === "think" && event.text) {
    message.parts = message.parts || [];
    const lastPart = message.parts.at(-1);
    if (lastPart && lastPart.type === "think") lastPart.text += event.text;
    else message.parts.push({ id: nextPartId(message), type: "think", text: event.text });
  } else if (event.kind === "tool" || event.kind === "mcp") {
    message.parts = message.parts || [];
    const partType = event.kind === "mcp" ? "mcp" : "tool";
    const running = [...message.parts]
      .reverse()
      .find(
        (p) =>
          p.status === "running" &&
          p.type === partType &&
          (!event.name || p.name === event.name || event.status === "done"),
      );
    if (running && event.status === "done") {
      running.status = "done";
      running.detail = event.detail || running.detail;
      running.label = event.label || running.label;
      running.output = event.output || running.output;
      running.server = event.server || running.server;
    } else {
      message.parts.push({
        id: nextPartId(message),
        type: partType,
        name: event.name,
        label: event.label,
        detail: event.detail || "",
        output: event.output || "",
        server: event.server,
        status: event.status || "running",
      });
    }
    appendActivity(thread, {
      kind: event.kind,
      name: event.name,
      server: event.server,
      label: event.label,
      detail: event.detail || "",
      output: event.output || "",
      status: event.status || "running",
      at: now,
    });
  } else if (event.kind === "cli") {
    message.parts = message.parts || [];
    message.parts.push({
      id: nextPartId(message),
      type: "cli",
      label: event.label || "CLI",
      detail: event.detail || "",
      status: event.status || "done",
    });
    appendActivity(thread, {
      kind: "cli",
      label: event.label || "CLI",
      detail: event.detail || "",
      status: event.status || "done",
      at: now,
    });
  } else if (event.kind === "gates") {
    mergeMarkerGates(thread, event.gates);
  } else if (event.kind === "todos") {
    mergeTodos(thread, event.todos);
  } else if (event.kind === "ask") {
    const question = normalizeQuestion(event);
    if (question) {
      thread.question = question;
      thread.status = "waiting";
      thread.phase = "working";
      thread.error = null;
      appendActivity(thread, {
        kind: "question",
        label: "CLI aguarda uma resposta",
        detail: question.question,
        status: "waiting",
        at: now,
      });
    }
  }

  thread.updatedAt = now;
  emit(id, { type: "delta", thread: publicThread(thread) });
}

function hostMcpActivity(id, event = {}) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (thread.status !== "running") {
    return { ok: false, status: 409, error: "thread is not running" };
  }

  applyStreamEvent(id, {
    kind: "mcp",
    name: String(event.name || "tool").slice(0, 160),
    server: String(event.server || "fxmind").slice(0, 80),
    label: String(event.label || event.name || "ferramenta MCP").slice(0, 240),
    detail: String(event.detail || "").slice(0, 240),
    status: event.status === "done" || event.status === "error" ? event.status : "running",
  });
  return { ok: true, thread: publicThread(thread) };
}

function appendActivity(thread, item) {
  thread.activity = thread.activity || [];
  if ((item.kind === "tool" || item.kind === "mcp") && item.status === "done") {
    const prev = [...thread.activity]
      .reverse()
      .find(
        (a) =>
          a.kind === item.kind &&
          a.label === item.label &&
          a.status === "running",
      );
    if (prev) {
      prev.status = "done";
      prev.detail = item.detail || prev.detail;
      prev.output = item.output || prev.output;
      prev.name = item.name || prev.name;
      prev.server = item.server || prev.server;
      return;
    }
  }
  thread.activity.push({
    id: `a${thread.activity.length + 1}`,
    ...item,
  });
  if (thread.activity.length > 80) thread.activity = thread.activity.slice(-80);
}

function mergeTodos(thread, todos) {
  if (!Array.isArray(todos) || !todos.length) return;
  thread.todos = thread.todos || [];
  for (const todo of todos) {
    const content = String(todo.content || "").trim();
    if (!content) continue;
    const existing = thread.todos.find((t) => t.content === content);
    if (existing) existing.status = todo.status || existing.status;
    else {
      thread.todos.push({
        id: `t${thread.todos.length + 1}`,
        content,
        status: todo.status || "pending",
      });
    }
  }
}

function mergeMarkerGates(thread, gates) {
  if (!Array.isArray(gates) || !gates.length) return;
  thread.gates = thread.gates || { taskActive: true, gates: {} };
  thread.gates.gates = thread.gates.gates || {};
  for (const gate of gates) {
    thread.gates.gates[gate.id] = {
      complete: true,
      at: new Date().toISOString(),
      note: gate.note || "",
    };
  }
}

function setGates(id, gates) {
  const thread = threads.get(id);
  if (!thread || !gates) return;
  thread.gates = gates;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "gates", thread: publicThread(thread) });
}

function setDiff(id, diff) {
  const thread = threads.get(id);
  if (!thread) return;
  thread.diff = diff || null;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "diff", thread: publicThread(thread) });
}

/**
 * Re-broadcasts the thread's current state over SSE without touching its
 * status/messages/diff. Used by side-channel work that mutates the raw
 * thread object directly (e.g. panel-cli.js writing to raw.runs for a judge
 * run) and just needs the client to see the update.
 */
function touchThread(id) {
  const thread = threads.get(id);
  if (!thread) return null;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "status", thread: publicThread(thread) });
  return publicThread(thread);
}

function finishAssistant(id, extra = {}) {
  const thread = threads.get(id);
  if (!thread) return;
  const last = thread.messages.at(-1);
  if (last && last.role === "assistant") delete last.streaming;
  if (extra.error) {
    settleRunningWork(thread, "error");
    thread.status = "error";
    thread.phase = "working";
    thread.error = extra.error;
    stampRunEnded(thread);
    if (!last || last.role !== "assistant") {
      thread.messages.push({
        role: "assistant",
        content: extra.error,
        at: new Date().toISOString(),
        parts: [{ id: "error", type: "text", text: extra.error }],
      });
    }
  } else {
    if (thread.question) {
      settleRunningWork(thread, "done");
      thread.status = "waiting";
      thread.phase = "working";
      thread.error = null;
      stampRunEnded(thread);
      thread.updatedAt = new Date().toISOString();
      emit(id, { type: "waiting", thread: publicThread(thread) });
      return;
    }
    settleRunningWork(thread, "done");
    thread.status = "done";
    thread.phase = "review";
    thread.error = null;
    stampRunEnded(thread);
  }
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "done", thread: publicThread(thread) });
}

function cancelThread(id, message = "Execução interrompida pelo usuário.") {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (thread.status !== "running") {
    return { ok: false, status: 409, error: "thread is not running" };
  }
  thread.cancelled = true;
  finishAssistant(id, { error: message });
  return { ok: true, thread: publicThread(thread) };
}

function setRunning(id, meta = {}) {
  const thread = threads.get(id);
  if (!thread) return;
  delete thread.cancelled;
  delete thread._stopRequested;
  delete thread._stopFinalized;
  delete thread._pauseRequested;
  delete thread._pauseFinalized;
  thread.status = "running";
  thread.phase = "working";
  thread.question = null;
  thread.error = null;
  thread.runStartedAt = new Date().toISOString();
  thread.runEndedAt = null;
  thread.cliId = meta.cliId || thread.cliId || null;
  thread.activity = [];
  thread.gates = null;
  thread.todos = [];
  thread.diff = null;
  const last = thread.messages.at(-1);
  if (!last || last.role !== "assistant" || last.streaming !== true) {
    thread.messages.push({
      role: "assistant",
      content: "",
      at: new Date().toISOString(),
      streaming: true,
      parts: [],
    });
  }
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "status", thread: publicThread(thread) });
}

function setWorktree(id, worktree) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (!worktree?.path || !worktree?.branch || !worktree?.baseBranch) {
    return { ok: false, status: 400, error: "complete worktree metadata required" };
  }
  thread.worktree = {
    path: String(worktree.path),
    branch: String(worktree.branch),
    baseBranch: String(worktree.baseBranch),
  };
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "worktree", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function setQuestion(id, question) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  const normalized = normalizeQuestion(question);
  if (!normalized) return { ok: false, status: 400, error: "invalid question" };
  thread.question = normalized;
  thread.status = "waiting";
  thread.phase = "working";
  thread.error = null;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "waiting", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function answerQuestion(id, selected) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (thread.status !== "waiting" || !thread.question) {
    return { ok: false, status: 409, error: "thread has no pending question" };
  }
  if (!Array.isArray(selected)) {
    return { ok: false, status: 400, error: "selected must be an array" };
  }

  const allowed = new Map(thread.question.options.map((option) => [option.id, option]));
  const selectedIds = [...new Set(selected.map((value) => String(value || "").trim()))].filter(Boolean);
  if (!selectedIds.length) return { ok: false, status: 400, error: "select at least one option" };
  if (!thread.question.multi && selectedIds.length > 1) {
    return { ok: false, status: 400, error: "question accepts one option" };
  }
  if (selectedIds.some((optionId) => !allowed.has(optionId))) {
    return { ok: false, status: 400, error: "selected option is not available" };
  }

  const labels = selectedIds.map((optionId) => allowed.get(optionId).label);
  const now = new Date().toISOString();
  const content = `Resposta para: ${thread.question.question}\n${labels
    .map((label) => `- ${label}`)
    .join("\n")}`;
  thread.messages.push({
    role: "user",
    content,
    answer: { questionId: thread.question.id, selected: selectedIds },
    at: now,
  });
  thread.question = null;
  thread.status = "queued";
  thread.phase = "working";
  thread.error = null;
  thread.updatedAt = now;
  emit(id, { type: "answer", message: thread.messages.at(-1), thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function markPaused(id) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (!["running", "queued", "waiting"].includes(thread.status)) {
    return { ok: false, status: 409, error: "thread cannot be paused from its current state" };
  }
  const last = thread.messages.at(-1);
  if (last?.role === "assistant") delete last.streaming;
  thread.status = "paused";
  thread.phase = "working";
  thread.error = null;
  stampRunEnded(thread);
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "paused", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function resumeThread(id) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (thread.status !== "paused") {
    return { ok: false, status: 409, error: "thread is not paused" };
  }
  thread.status = "queued";
  thread.phase = "working";
  thread.error = null;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "status", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function setPhase(id, phase) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (!THREAD_PHASES.has(phase)) {
    return { ok: false, status: 400, error: "invalid thread phase" };
  }
  thread.phase = phase;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "phase", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function recordCommit(id, commit) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (!commit?.hash) return { ok: false, status: 400, error: "commit hash required" };
  thread.commits = thread.commits || [];
  thread.commits.push({
    hash: String(commit.hash),
    message: String(commit.message || ""),
    branch: String(commit.branch || thread.worktree?.branch || ""),
    at: commit.at || new Date().toISOString(),
  });
  thread.phase = "committed";
  thread.status = "done";
  thread.question = null;
  thread.error = null;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "commit", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function markPushed(id) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  thread.phase = "pushed";
  thread.status = "done";
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "push", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function queuedThreads() {
  return [...threads.values()].filter((t) => t.status === "queued");
}

function pendingJobs() {
  return queuedThreads().map(toJob);
}

function claimThread(id) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (thread.status !== "queued") {
    return { ok: false, status: 409, error: "thread is not queued" };
  }
  thread.status = "running";
  thread.phase = "working";
  thread.error = null;
  thread.runStartedAt = thread.runStartedAt || new Date().toISOString();
  thread.runEndedAt = null;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "status", thread: publicThread(thread) });
  return { ok: true, job: toJob(thread) };
}

function claimAllQueued() {
  const jobs = queuedThreads()
    .map((t) => claimThread(t.id))
    .filter((r) => r.ok)
    .map((r) => r.job);
  return { ok: true, jobs };
}

function waitForJobs(timeoutMs = 20_000) {
  heartbeat();
  const timeout = Math.min(Math.max(Number(timeoutMs) || 20_000, 500), 25_000);
  const immediate = claimAllQueued().jobs;
  if (immediate.length) return Promise.resolve({ ok: true, jobs: immediate });

  return new Promise((resolve) => {
    let done = false;
    const finish = (jobs) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      bus.off("threads", onEvent);
      resolve({ ok: true, jobs });
    };
    const onEvent = () => {
      const jobs = claimAllQueued().jobs;
      if (jobs.length) finish(jobs);
    };
    const timer = setTimeout(() => finish([]), timeout);
    bus.on("threads", onEvent);
  });
}

function hostReply(id, content) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (thread.cancelled) return { ok: false, status: 409, error: "thread was stopped" };
  const text = String(content || "").trim();
  if (!text) return { ok: false, status: 400, error: "content is required" };

  thread.messages.push({
    role: "assistant",
    content: text,
    at: new Date().toISOString(),
    parts: [{ id: "host", type: "text", text }],
  });
  thread.status = "done";
  thread.phase = "review";
  thread.question = null;
  thread.error = null;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "done", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function hostFail(id, error) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (thread.cancelled) return { ok: false, status: 409, error: "thread was stopped" };
  const message = String(error || "host failed").trim();
  thread.messages.push({
    role: "assistant",
    content: message,
    at: new Date().toISOString(),
    parts: [{ id: "host-error", type: "text", text: message }],
  });
  thread.status = "error";
  thread.phase = "working";
  thread.error = message;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "done", thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function heartbeat() {
  lastHeartbeatAt = Date.now();
  bus.emit("threads", { type: "host", host: hostStatus() });
  return hostStatus();
}

function hostStatus() {
  return {
    connected: lastHeartbeatAt > 0 && Date.now() - lastHeartbeatAt < HOST_TTL_MS,
    lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt).toISOString() : null,
  };
}

function subscribe(threadId, listener) {
  const event = `thread:${threadId}`;
  bus.on(event, listener);
  return () => bus.off(event, listener);
}

function subscribeAll(listener) {
  bus.on("threads", listener);
  return () => bus.off("threads", listener);
}

function runningCount() {
  return [...threads.values()].filter((t) => t.status === "running").length;
}

function queuedCount() {
  return queuedThreads().length;
}

async function disposeThread(id) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  clearTimeout(persistTimers.get(id));
  persistTimers.delete(id);
  threads.delete(id);
  if (persistenceEnabled) {
    try {
      fs.unlinkSync(persistencePath(thread));
    } catch {
      // The snapshot may not have been flushed yet.
    }
  }
  emit(id, { type: "deleted", id });
  return { ok: true };
}

function _resetForTests(options = {}) {
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
  threads.clear();
  lastHeartbeatAt = 0;
  persistenceEnabled = options.persistence === true;
  if (options.cleanupPersistence) {
    try {
      fs.rmSync(persistenceRoot(), { recursive: true, force: true });
    } catch {
      // Test cleanup is best-effort.
    }
  }
  if (persistenceEnabled) loadPersistedThreads();
}

loadPersistedThreads();

module.exports = {
  publicThread,
  listThreads,
  getThread,
  getThreadRaw,
  lastUserContent,
  lastUserMessage,
  normalizeAttachments,
  materializeAttachments,
  buildDemandPrompt,
  createThread,
  injectDemand,
  addUserMessage,
  appendAssistantDelta,
  applyStreamEvent,
  hostMcpActivity,
  normalizeQuestion,
  setGates,
  setDiff,
  touchThread,
  finishAssistant,
  cancelThread,
  setRunning,
  setWorktree,
  setQuestion,
  answerQuestion,
  markPaused,
  resumeThread,
  setPhase,
  recordCommit,
  markPushed,
  pendingJobs,
  claimThread,
  claimAllQueued,
  waitForJobs,
  hostReply,
  hostFail,
  heartbeat,
  hostStatus,
  subscribe,
  subscribeAll,
  runningCount,
  queuedCount,
  disposeThread,
  _resetForTests,
};
