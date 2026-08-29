const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

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

  it("injectDemand creates a user message thread", () => {
    const { thread } = threads.injectDemand({
      projectId: "abc",
      projectRoot: "/tmp/proj",
      item: { title: "Loja", cardId: "c9" },
    });
    assert.equal(thread.title, "Loja");
    assert.equal(thread.cardId, "c9");
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
});
