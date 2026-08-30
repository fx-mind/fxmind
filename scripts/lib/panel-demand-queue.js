/**
 * Local demand queue compatibility API.
 *
 * Task execution itself is scheduled by panel-cli. This queue preserves the
 * older PortSpace demand workflow and injects its items one at a time.
 */

const crypto = require("crypto");
const { readPanelConfig, writePanelConfig } = require("./panel-api");

const queues = new Map();

function queueKey(workspaceRoot) {
  return String(workspaceRoot || "").replace(/\\/g, "/").toLowerCase();
}

function isParallelEnabled() {
  try {
    return Boolean(readPanelConfig().panel?.demandQueueParallel);
  } catch {
    return false;
  }
}

function concurrencyLimit() {
  const config = readPanelConfig();
  const value =
    config.panel?.maxConcurrentTasks ??
    config.maxConcurrentTasks ??
    config.agent?.maxConcurrentTasks ??
    config.agent?.concurrency;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 32) : 3;
}

function countRunningItems(queue) {
  return queue.items.filter((item) => item.status === "running").length;
}

function normalizeItem(item = {}) {
  const title = String(item.title || "").trim();
  return {
    id: String(item.id || crypto.randomUUID()),
    title: title.slice(0, 240),
    description: String(item.description || "").trim().slice(0, 4000),
    status: ["pending", "running", "done", "error"].includes(item.status)
      ? item.status
      : "pending",
  };
}

function normalizeQueue(data = {}, workspaceRoot = null) {
  return {
    workspaceRoot: data.workspaceRoot || workspaceRoot || null,
    active: Boolean(data.active),
    currentThreadId: data.currentThreadId || null,
    items: Array.isArray(data.items)
      ? data.items.map(normalizeItem).filter((item) => item.title)
      : [],
  };
}

function loadFromConfig() {
  try {
    const stored = readPanelConfig().demandQueues || {};
    for (const [key, value] of Object.entries(stored)) {
      queues.set(key, normalizeQueue(value));
    }
  } catch {
    // A malformed panel config must not prevent the API from starting.
  }
}

function saveToConfig() {
  try {
    const config = readPanelConfig();
    config.demandQueues = Object.fromEntries(queues.entries());
    writePanelConfig(config);
  } catch {
    // The queue remains available in memory when config persistence fails.
  }
}

function getQueue(workspaceRoot) {
  const key = queueKey(workspaceRoot);
  if (!queues.has(key)) queues.set(key, normalizeQueue({}, workspaceRoot));
  const queue = queues.get(key);
  if (workspaceRoot && !queue.workspaceRoot) queue.workspaceRoot = workspaceRoot;
  return { key, queue };
}

function publicQueue(queue) {
  const items = queue.items.map(({ id, title, description, status }) => ({
    id,
    title,
    description,
    status,
  }));
  return {
    ok: true,
    active: queue.active,
    currentThreadId: queue.currentThreadId,
    items,
    pending: items.filter((item) => item.status === "pending").length,
    done: items.filter((item) => item.status === "done").length,
    total: items.length,
  };
}

function setItems(workspaceRoot, items = []) {
  const { key, queue } = getQueue(workspaceRoot);
  queue.items = Array.isArray(items)
    ? items.slice(0, 200).map(normalizeItem).filter((item) => item.title)
    : [];
  queues.set(key, queue);
  saveToConfig();
  return publicQueue(queue);
}

function addItem(workspaceRoot, body = {}) {
  const { key, queue } = getQueue(workspaceRoot);
  const item = normalizeItem(body);
  if (!item.title) return { ok: false, status: 400, error: "title is required" };
  queue.items.push(item);
  queues.set(key, queue);
  saveToConfig();
  return publicQueue(queue);
}

function removeItem(workspaceRoot, itemId) {
  const { key, queue } = getQueue(workspaceRoot);
  queue.items = queue.items.filter((item) => item.id !== String(itemId || ""));
  queues.set(key, queue);
  saveToConfig();
  return publicQueue(queue);
}

function injectOne(workspaceRoot, projectId, projectRoot, threads, startCli) {
  const { key, queue } = getQueue(workspaceRoot);
  if (!queue.active) return { ok: false, error: "queue not active" };

  const next = queue.items.find((item) => item.status === "pending");
  if (!next) {
    queue.active = false;
    queue.currentThreadId = null;
    queues.set(key, queue);
    saveToConfig();
    return { ok: true, finished: true, ...publicQueue(queue) };
  }

  next.status = "running";
  const created = threads.injectDemand({
    projectId,
    projectRoot,
    item: { title: next.title, description: next.description || undefined },
  });
  if (!created?.ok) {
    next.status = "error";
    return { ok: false, error: "could not create demand thread" };
  }

  queue.currentThreadId = created.thread.id;
  queues.set(key, queue);
  saveToConfig();
  const raw = threads.getThreadRaw(created.thread.id);
  if (raw) raw._demandItemId = next.id;
  if (typeof startCli === "function") startCli(created.thread.id);
  return { ok: true, finished: false, thread: created.thread, ...publicQueue(queue) };
}

function injectNext(workspaceRoot, projectId, projectRoot, threads, startCli) {
  if (isParallelEnabled()) {
    return injectUntilLimit(workspaceRoot, projectId, projectRoot, threads, startCli);
  }
  return injectOne(workspaceRoot, projectId, projectRoot, threads, startCli);
}

function injectUntilLimit(workspaceRoot, projectId, projectRoot, threads, startCli) {
  const { queue } = getQueue(workspaceRoot);
  if (!queue.active) return { ok: false, error: "queue not active" };

  const limit = concurrencyLimit();
  let lastResult = { ok: true, finished: false, ...publicQueue(queue) };
  while (queue.active && countRunningItems(queue) < limit) {
    const pending = queue.items.some((item) => item.status === "pending");
    if (!pending) break;
    lastResult = injectOne(workspaceRoot, projectId, projectRoot, threads, startCli);
    if (!lastResult.ok || lastResult.finished) break;
  }
  return lastResult;
}

function startQueue(workspaceRoot, projectId, projectRoot, threads, startCli) {
  const { queue } = getQueue(workspaceRoot);
  if (!queue.items.some((item) => item.status === "pending")) {
    return { ok: false, status: 400, error: "no pending demands" };
  }
  queue.active = true;
  queue.projectId = projectId || null;
  queue.projectRoot = projectRoot || workspaceRoot;
  queue.startCli = startCli;
  return injectNext(workspaceRoot, projectId, projectRoot, threads, startCli);
}

function onThreadFinished(threadId, threads, startCli) {
  for (const [key, queue] of queues.entries()) {
    const raw = threads.getThreadRaw(threadId);
    const item = queue.items.find((entry) => entry.id === raw?._demandItemId);
    const matches =
      queue.currentThreadId === threadId ||
      (isParallelEnabled() && item && item.status === "running");
    if (!matches) continue;

    if (raw?.status === "paused" || raw?.status === "waiting") {
      return publicQueue(queue);
    }
    if (item) item.status = raw?.status === "error" ? "error" : "done";
    if (queue.currentThreadId === threadId) {
      queue.currentThreadId = null;
    }
    queues.set(key, queue);
    saveToConfig();
    if (queue.active && queue.workspaceRoot) {
      const { workspaceRoot, projectId, projectRoot } = {
        workspaceRoot: queue.workspaceRoot,
        projectId: queue.projectId,
        projectRoot: queue.projectRoot,
      };
      return injectNext(
        workspaceRoot,
        projectId,
        projectRoot || workspaceRoot,
        threads,
        startCli || queue.startCli,
      );
    }
    return publicQueue(queue);
  }
  return null;
}

function getQueuePublic(workspaceRoot) {
  return publicQueue(getQueue(workspaceRoot).queue);
}

function stopQueue(workspaceRoot) {
  const { key, queue } = getQueue(workspaceRoot);
  queue.active = false;
  queue.currentThreadId = null;
  for (const item of queue.items) {
    if (item.status === "running") item.status = "pending";
  }
  queues.set(key, queue);
  saveToConfig();
  return publicQueue(queue);
}

function clearQueue(workspaceRoot) {
  const { key, queue } = getQueue(workspaceRoot);
  if (queue.active && queue.currentThreadId) {
    return { ok: false, status: 409, error: "demand queue is running" };
  }
  queues.set(key, normalizeQueue({ workspaceRoot: queue.workspaceRoot }));
  saveToConfig();
  return publicQueue(queues.get(key));
}

loadFromConfig();

module.exports = {
  getQueuePublic,
  setItems,
  addItem,
  removeItem,
  clearQueue,
  stopQueue,
  startQueue,
  onThreadFinished,
  _resetForTests() {
    queues.clear();
  },
};
