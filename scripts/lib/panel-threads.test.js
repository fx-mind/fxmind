const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const threads = require("./panel-threads");

describe("panel-threads", () => {
  beforeEach(() => {
    threads._resetForTests();
  });

  it("buildDemandPrompt includes title and card id", () => {
    const prompt = threads.buildDemandPrompt({
      title: "Fix garage",
      cardId: "card_1",
      priority: "Alta",
      column: { name: "Desenvolvendo" },
    });
    assert.match(prompt, /Fix garage/);
    assert.match(prompt, /card_1/);
    assert.match(prompt, /Alta/);
  });

  it("injectDemand creates a queued user message thread", () => {
    const { thread } = threads.injectDemand({
      projectId: "abc",
      projectRoot: "/tmp/proj",
      item: { title: "Loja", cardId: "c9" },
    });
    assert.equal(thread.title, "Loja");
    assert.equal(thread.cardId, "c9");
    assert.equal(thread.status, "queued");
    assert.equal(thread.messages[0].role, "user");
    assert.match(thread.messages[0].content, /Loja/);
  });

  it("allows several threads in parallel (independent status)", () => {
    const a = threads.injectDemand({ item: { title: "A" } }).thread;
    const b = threads.injectDemand({ item: { title: "B" } }).thread;
    threads.setRunning(a.id);
    assert.equal(threads.runningCount(), 1);
    threads.setRunning(b.id);
    assert.equal(threads.runningCount(), 2);
    assert.equal(threads.getThread(a.id).thread.status, "running");
    assert.equal(threads.getThread(b.id).thread.status, "running");
  });

  it("waitForJobs claims all queued threads for the host chat", async () => {
    threads.injectDemand({ item: { title: "A" } });
    threads.injectDemand({ item: { title: "B" } });
    const { jobs } = await threads.waitForJobs(50);
    assert.equal(jobs.length, 2);
    assert.equal(threads.queuedCount(), 0);
    assert.equal(threads.runningCount(), 2);
    const reply = threads.hostReply(jobs[0].id, "feito");
    assert.equal(reply.thread.status, "done");
    assert.match(reply.thread.messages.at(-1).content, /feito/);
  });

  it("starts a new assistant turn and splits tool vs text parts", () => {
    const { thread } = threads.injectDemand({ item: { title: "X" } });
    threads.setRunning(thread.id, { cliId: "opencode" });
    threads.applyStreamEvent(thread.id, { kind: "text", text: "primeiro" });
    threads.applyStreamEvent(thread.id, {
      kind: "tool",
      name: "read",
      label: "Leu client.lua",
      status: "running",
    });
    threads.applyStreamEvent(thread.id, { kind: "text", text: "segundo" });
    const snap = threads.getThread(thread.id).thread;
    const assistant = snap.messages.filter((m) => m.role === "assistant").at(-1);
    assert.equal(assistant.parts.length, 3);
    assert.equal(assistant.parts[0].type, "text");
    assert.equal(assistant.parts[1].type, "tool");
    assert.equal(assistant.parts[2].text, "segundo");
    assert.match(assistant.content, /primeiro/);
    assert.match(assistant.content, /segundo/);
    assert.ok(!assistant.content.includes("Leu client.lua"));
    assert.equal(snap.activity.filter((a) => a.kind === "tool").length, 1);
  });

  it("records CLI events on the thread activity feed", () => {
    const { thread } = threads.injectDemand({ item: { title: "Y" } });
    threads.setRunning(thread.id, { cliId: "opencode" });
    threads.applyStreamEvent(thread.id, {
      kind: "cli",
      label: "CLI: iniciou um passo",
      status: "running",
    });
    const snap = threads.getThread(thread.id).thread;
    assert.ok(snap.activity.some((a) => a.kind === "cli"));
    const assistant = snap.messages.filter((m) => m.role === "assistant").at(-1);
    assert.ok(assistant.parts.some((p) => p.type === "cli"));
  });

  it("records MCP events as distinct assistant parts and activity", () => {
    const { thread } = threads.injectDemand({ item: { title: "MCP" } });
    threads.setRunning(thread.id, { cliId: "codex" });
    threads.applyStreamEvent(thread.id, {
      kind: "mcp",
      name: "fxmind_query",
      server: "fxmind",
      label: "MCP · fxmind_query",
      detail: "Como funciona o graph?",
      status: "running",
    });
    threads.applyStreamEvent(thread.id, {
      kind: "mcp",
      name: "fxmind_query",
      server: "fxmind",
      label: "MCP · fxmind_query",
      detail: "Como funciona o graph?",
      output: "Encontrado",
      status: "done",
    });
    const snap = threads.getThread(thread.id).thread;
    const assistant = snap.messages.filter((m) => m.role === "assistant").at(-1);
    assert.equal(assistant.parts[0].type, "mcp");
    assert.equal(assistant.parts[0].status, "done");
    assert.equal(assistant.parts[0].server, "fxmind");
    assert.equal(snap.activity.filter((item) => item.kind === "mcp").length, 1);
    assert.equal(snap.activity[0].status, "done");
  });

  it("closes leftover running tool parts when the assistant finishes", () => {
    const { thread } = threads.injectDemand({ item: { title: "Hang" } });
    threads.setRunning(thread.id, { cliId: "opencode" });
    threads.applyStreamEvent(thread.id, {
      kind: "tool",
      name: "bash",
      label: "Rodou ls",
      detail: "ls -1 resources",
      status: "running",
    });
    threads.applyStreamEvent(thread.id, {
      kind: "tool",
      name: "bash",
      label: "Rodou grep",
      detail: "grep -R radio",
      status: "running",
    });
    threads.finishAssistant(thread.id);
    const snap = threads.getThread(thread.id).thread;
    const tools = snap.messages.at(-1).parts.filter((p) => p.type === "tool");
    assert.equal(tools.length, 2);
    assert.ok(tools.every((p) => p.status === "done"));
    assert.ok(snap.activity.filter((a) => a.kind === "tool").every((a) => a.status === "done"));
  });

  it("closes leftover running tool parts when the assistant finishes", () => {
    const { thread } = threads.injectDemand({ item: { title: "Hang" } });
    threads.setRunning(thread.id, { cliId: "opencode" });
    threads.applyStreamEvent(thread.id, {
      kind: "tool",
      name: "bash",
      label: "Rodou ls",
      detail: "ls -1 resources",
      status: "running",
    });
    threads.applyStreamEvent(thread.id, {
      kind: "tool",
      name: "bash",
      label: "Rodou grep",
      detail: "grep -R radio",
      status: "running",
    });
    threads.finishAssistant(thread.id);
    const snap = threads.getThread(thread.id).thread;
    const tools = snap.messages.at(-1).parts.filter((p) => p.type === "tool");
    assert.equal(tools.length, 2);
    assert.ok(tools.every((p) => p.status === "done"));
    assert.ok(snap.activity.filter((a) => a.kind === "tool").every((a) => a.status === "done"));
  });

  it("accepts MCP activity from the host agent", () => {
    const { thread } = threads.injectDemand({ item: { title: "Host MCP" } });
    threads.claimThread(thread.id);
    const result = threads.hostMcpActivity(thread.id, {
      name: "fxmind_gate_status",
      detail: "Gate A/B/V/C",
      status: "running",
    });
    assert.equal(result.ok, true);
    const snap = threads.getThread(thread.id).thread;
    assert.equal(snap.activity[0].kind, "mcp");
    assert.equal(snap.activity[0].server, "fxmind");
  });

  it("waits for and records an interactive answer", () => {
    const { thread } = threads.injectDemand({ item: { title: "Question" } });
    threads.setRunning(thread.id, { cliId: "codex" });
    threads.applyStreamEvent(thread.id, {
      kind: "ask",
      question: "Which mode?",
      options: [
        { id: "safe", label: "Safe" },
        { id: "fast", label: "Fast" },
      ],
      multi: false,
    });
    assert.equal(threads.getThread(thread.id).thread.status, "waiting");
    assert.equal(threads.getThread(thread.id).thread.question.options.length, 2);

    const answer = threads.answerQuestion(thread.id, ["fast"]);
    assert.equal(answer.ok, true);
    assert.equal(answer.thread.status, "queued");
    assert.equal(answer.thread.question, null);
    assert.deepEqual(answer.thread.messages.at(-1).answer.selected, ["fast"]);
  });

  it("pauses without converting a running thread into an error", () => {
    const { thread } = threads.injectDemand({ item: { title: "Pause" } });
    threads.setRunning(thread.id, { cliId: "codex" });
    const result = threads.markPaused(thread.id);
    assert.equal(result.ok, true);
    assert.equal(result.thread.status, "paused");
    assert.equal(result.thread.phase, "working");
    assert.equal(result.thread.error, null);
  });

  it("persists a debounced snapshot without internal process handles", async () => {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), "fxthreads-"));
    process.env.FXMIND_PANEL_DATA_DIR = store;
    try {
      threads._resetForTests({ persistence: true, cleanupPersistence: true });
      const { thread } = threads.injectDemand({ item: { title: "Persisted" } });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const file = path.join(store, thread.projectId || "unassigned", `${thread.id}.json`);
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(saved.title, "Persisted");
      assert.equal("_child" in saved, false);
    } finally {
      threads._resetForTests();
      delete process.env.FXMIND_PANEL_DATA_DIR;
      fs.rmSync(store, { recursive: true, force: true });
    }
  });

  it("listThreads filters by projectId and projectRoot", () => {
    const a = threads.injectDemand({
      projectId: "proj-a",
      projectRoot: "/tmp/a",
      item: { title: "A" },
    }).thread;
    const b = threads.injectDemand({
      projectId: "proj-b",
      projectRoot: "/tmp/b",
      item: { title: "B" },
    }).thread;

    const byId = threads.listThreads({ projectId: "proj-a" });
    assert.equal(byId.length, 1);
    assert.equal(byId[0].id, a.id);

    const byRoot = threads.listThreads({ projectRoot: "/tmp/b" });
    assert.equal(byRoot.length, 1);
    assert.equal(byRoot[0].id, b.id);
  });

  it("silent setDiff does not move a thread to the top of the list", () => {
    const older = threads.injectDemand({ item: { title: "Older" } }).thread;
    const newer = threads.injectDemand({ item: { title: "Newer" } }).thread;
    threads.getThreadRaw(older.id).updatedAt = "2026-01-01T00:00:00.000Z";
    threads.getThreadRaw(newer.id).updatedAt = "2026-08-01T00:00:00.000Z";
    assert.deepEqual(
      threads.listThreads().map((thread) => thread.id),
      [newer.id, older.id],
    );

    threads.setDiff(older.id, { ok: true, files: [] }, { silent: true });
    assert.equal(threads.getThreadRaw(older.id).updatedAt, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(
      threads.listThreads().map((thread) => thread.id),
      [newer.id, older.id],
    );
  });

  it("cancels a running thread and rejects late host replies", () => {
    const { thread } = threads.injectDemand({ item: { title: "Z" } });
    threads.setRunning(thread.id, { cliId: "cursor-agent" });
    const result = threads.cancelThread(thread.id);
    assert.equal(result.ok, true);
    assert.equal(result.thread.status, "error");
    assert.match(result.thread.error, /interrompida/i);
    assert.equal(threads.hostReply(thread.id, "cheguei").ok, false);
  });

  it("merges MCP start_task and record_gate snapshots onto the thread", () => {
    const { thread } = threads.injectDemand({ item: { title: "Gates" } });
    threads.setRunning(thread.id, { cliId: "opencode" });
    threads.applyStreamEvent(thread.id, {
      kind: "mcp",
      name: "fxmind_fxmind_start_task",
      label: "fxmind_fxmind_start_task",
      status: "done",
      output: JSON.stringify({
        ok: true,
        taskActive: true,
        session: "2026-08-31T00:48:42.709Z",
        gates: {},
      }),
    });
    threads.applyStreamEvent(thread.id, {
      kind: "mcp",
      name: "fxmind_fxmind_record_gate",
      label: "fxmind_fxmind_record_gate",
      detail: "Gate A",
      status: "done",
      output: JSON.stringify({
        ok: true,
        taskActive: true,
        session: "2026-08-31T00:48:42.709Z",
        gates: { A: { complete: true, at: "2026-08-31T00:48:52.092Z", note: "def" } },
      }),
    });
    threads.applyStreamEvent(thread.id, {
      kind: "mcp",
      name: "fxmind_fxmind_record_gate",
      label: "fxmind_fxmind_record_gate",
      detail: "Gate C",
      status: "done",
    });
    const snap = threads.getThread(thread.id).thread;
    assert.equal(snap.gates.taskActive, true);
    assert.equal(snap.gates.gates.A.complete, true);
    assert.equal(snap.gates.gates.C.complete, true);
  });
});
