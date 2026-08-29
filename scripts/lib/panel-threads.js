/**
 * In-memory chat threads for the web panel.
 * One thread = one demanda (or a free chat). Several can run in parallel.
 */

const crypto = require("crypto");
const { EventEmitter } = require("events");

const threads = new Map();
const bus = new EventEmitter();
bus.setMaxListeners(50);

function publicThread(thread) {
  if (!thread) return null;
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    cardId: thread.cardId || null,
    status: thread.status,
    error: thread.error || null,
    runningCountHint: thread.status === "running" ? 1 : 0,
    messages: thread.messages,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function emit(threadId, event) {
  bus.emit(`thread:${threadId}`, event);
  bus.emit("threads", { type: "list", threads: listThreads() });
}

function listThreads() {
  return [...threads.values()]
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

function buildDemandPrompt(item = {}) {
  const lines = [
    "Implemente esta demanda no repositório do projeto ativo.",
    "Siga o pipeline fxmind (classificar → Gate A/B → implementar → V → C) se for mudança de código.",
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
  const thread = {
    id,
    title,
    projectId: input.projectId || null,
    projectRoot: input.projectRoot || null,
    cardId: input.cardId || null,
    status: "idle",
    error: null,
    messages: [],
    createdAt: now,
    updatedAt: now,
    _agent: null,
  };

  if (input.content) {
    thread.messages.push({
      role: "user",
      content: String(input.content),
      at: now,
    });
  }

  threads.set(id, thread);
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

function addUserMessage(id, content) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  const text = String(content || "").trim();
  if (!text) return { ok: false, status: 400, error: "content is required" };
  if (thread.status === "running") {
    return { ok: false, status: 409, error: "thread is already running" };
  }

  const now = new Date().toISOString();
  thread.messages.push({ role: "user", content: text, at: now });
  thread.updatedAt = now;
  emit(id, { type: "message", message: thread.messages.at(-1), thread: publicThread(thread) });
  return { ok: true, thread: publicThread(thread) };
}

function appendAssistantDelta(id, text) {
  const thread = threads.get(id);
  if (!thread) return;
  const last = thread.messages.at(-1);
  if (!last || last.role !== "assistant" || last.streaming !== true) {
    thread.messages.push({
      role: "assistant",
      content: text,
      at: new Date().toISOString(),
      streaming: true,
    });
  } else {
    last.content += text;
  }
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "delta", text, thread: publicThread(thread) });
}

function finishAssistant(id, extra = {}) {
  const thread = threads.get(id);
  if (!thread) return;
  const last = thread.messages.at(-1);
  if (last && last.role === "assistant") delete last.streaming;
  if (extra.error) {
    thread.status = "error";
    thread.error = extra.error;
    if (!last || last.role !== "assistant") {
      thread.messages.push({
        role: "assistant",
        content: extra.error,
        at: new Date().toISOString(),
      });
    }
  } else {
    thread.status = "done";
    thread.error = null;
  }
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "done", thread: publicThread(thread) });
}

function setRunning(id) {
  const thread = threads.get(id);
  if (!thread) return;
  thread.status = "running";
  thread.error = null;
  thread.updatedAt = new Date().toISOString();
  emit(id, { type: "status", thread: publicThread(thread) });
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

async function disposeThread(id) {
  const thread = threads.get(id);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };
  if (thread._agent && typeof thread._agent[Symbol.asyncDispose] === "function") {
    try {
      await thread._agent[Symbol.asyncDispose]();
    } catch {
      /* ignore */
    }
  }
  threads.delete(id);
  emit(id, { type: "deleted", id });
  return { ok: true };
}

function _resetForTests() {
  threads.clear();
}

module.exports = {
  publicThread,
  listThreads,
  getThread,
  getThreadRaw,
  buildDemandPrompt,
  createThread,
  injectDemand,
  addUserMessage,
  appendAssistantDelta,
  finishAssistant,
  setRunning,
  subscribe,
  subscribeAll,
  runningCount,
  disposeThread,
  _resetForTests,
};
