const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const demandQueue = require("./panel-demand-queue");

function fakeThreads() {
  const created = [];
  const raw = new Map();
  return {
    created,
    injectDemand(input) {
      const thread = { id: `t${created.length + 1}`, status: "queued" };
      created.push(input);
      raw.set(thread.id, thread);
      return { ok: true, thread };
    },
    getThreadRaw(id) {
      return raw.get(id) || null;
    },
    finish(id, status = "done") {
      raw.get(id).status = status;
    },
  };
}

function fakeCardClient(refused = new Set()) {
  const calls = [];
  return {
    calls,
    async claimCard(cardId) {
      calls.push(["claim", cardId]);
      if (refused.has(cardId)) {
        return { ok: false, status: 409, message: "Este card já foi assumido por outra pessoa" };
      }
      return { ok: true, status: 200, data: { ok: true } };
    },
    async releaseCard(cardId) {
      calls.push(["release", cardId]);
      return { ok: true };
    },
  };
}

describe("panel-demand-queue", () => {
  let tmpHome;
  let originalHome;
  const root = "/tmp/fx-demand-root";

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxdemand-"));
    originalHome = process.env.USERPROFILE || process.env.HOME;
    if (process.platform === "win32") process.env.USERPROFILE = tmpHome;
    else process.env.HOME = tmpHome;
    demandQueue._resetForTests();
  });

  afterEach(() => {
    demandQueue._resetForTests();
    if (process.platform === "win32") process.env.USERPROFILE = originalHome;
    else process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("keeps PortSpace card metadata on queued items", () => {
    const queue = demandQueue.addItem(root, {
      title: "Corrigir login",
      cardId: "c1",
      source: "portspace",
      priority: "HIGH",
      column: { name: "Backlog IA", role: "TODO" },
    });
    assert.equal(queue.items[0].cardId, "c1");
    assert.equal(queue.items[0].source, "portspace");
  });

  it("claims the PortSpace card before creating the thread", async () => {
    const client = fakeCardClient();
    demandQueue._setCardClientForTests(client);
    const threads = fakeThreads();
    demandQueue.addItem(root, {
      title: "Corrigir login",
      cardId: "c1",
      source: "portspace",
      priority: "HIGH",
    });

    const result = await demandQueue.startQueue(root, "p1", root, threads, () => {});
    assert.equal(result.ok, true);
    assert.deepEqual(client.calls, [["claim", "c1"]]);
    assert.equal(threads.created.length, 1);
    assert.equal(threads.created[0].item.cardId, "c1");
    assert.equal(threads.created[0].item.source, "portspace");
    assert.equal(threads.created[0].item.priority, "HIGH");
    assert.equal(threads.created[0].cardSync.action, "claim");
    assert.equal(threads.created[0].cardSync.ok, true);
  });

  it("skips a refused card and starts the next demand", async () => {
    const client = fakeCardClient(new Set(["taken"]));
    demandQueue._setCardClientForTests(client);
    const threads = fakeThreads();
    demandQueue.addItem(root, { title: "Já pego", cardId: "taken", source: "portspace" });
    demandQueue.addItem(root, { title: "Livre", cardId: "free", source: "portspace" });

    const result = await demandQueue.startQueue(root, "p1", root, threads, () => {});
    assert.equal(result.ok, true);
    assert.equal(threads.created.length, 1);
    assert.equal(threads.created[0].item.title, "Livre");
    const queue = demandQueue.getQueuePublic(root);
    assert.equal(queue.items[0].status, "error");
    assert.match(queue.items[0].error, /já foi assumido/);
    assert.equal(queue.items[1].status, "running");
  });

  it("finishes the run when every card is refused", async () => {
    demandQueue._setCardClientForTests(fakeCardClient(new Set(["a"])));
    const threads = fakeThreads();
    demandQueue.addItem(root, { title: "A", cardId: "a", source: "portspace" });

    const result = await demandQueue.startQueue(root, "p1", root, threads, () => {});
    assert.equal(result.finished, true);
    assert.equal(result.active, false);
    assert.equal(threads.created.length, 0);
  });

  it("does not claim Trello or manual demands", async () => {
    const client = fakeCardClient();
    demandQueue._setCardClientForTests(client);
    const threads = fakeThreads();
    demandQueue.addItem(root, { title: "Trello", cardId: "t1", source: "trello" });

    await demandQueue.startQueue(root, "p1", root, threads, () => {});
    assert.equal(client.calls.length, 0);
    assert.equal(threads.created.length, 1);
    assert.equal(threads.created[0].cardSync, null);
  });

  it("claims the next card when a thread finishes", async () => {
    const client = fakeCardClient();
    demandQueue._setCardClientForTests(client);
    const threads = fakeThreads();
    demandQueue.addItem(root, { title: "A", cardId: "a", source: "portspace" });
    demandQueue.addItem(root, { title: "B", cardId: "b", source: "portspace" });

    const started = await demandQueue.startQueue(root, "p1", root, threads, () => {});
    threads.finish(started.thread.id);
    const next = await demandQueue.onThreadFinished(started.thread.id, threads, () => {});
    assert.equal(next.ok, true);
    assert.deepEqual(client.calls, [["claim", "a"], ["claim", "b"]]);
    assert.equal(demandQueue.getQueuePublic(root).items[0].status, "done");
  });
});
