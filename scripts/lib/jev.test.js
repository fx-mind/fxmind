"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jev = require("./jev");
const playbooks = require("./playbooks");

const config = (overrides = {}) => ({
  enabled: true, apiKey: "fixture-key-only", minConfidence: 0.75,
  timeoutMs: 400, model: "jev-latest", ...overrides,
});
const response = (kind, confidence) => ({
  ok: true,
  json: async () => ({ answers: { taskKind: { type: "choice", choice: kind, confidence } } }),
});

describe("Jev opt-in decision layer", () => {
  it("reads disabled-by-default configuration and does not expose key in status", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-jev-"));
    try {
      fs.writeFileSync(path.join(root, ".env"), "FXMIND_JEV_ENABLED=true\nFXMIND_JEV_API_KEY=test-secret\n");
      const status = jev.jevStatus({}, root);
      assert.equal(status.active, true);
      assert.equal(status.configured, true);
      assert.doesNotMatch(JSON.stringify(status), /test-secret/);
      assert.equal(jev.jevStatus({ FXMIND_JEV_ENABLED: "false" }, root).active, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("never sends a request when disabled or when the key is missing", async () => {
    let calls = 0;
    const transport = async () => { calls++; throw new Error("Should not run"); };
    const local = playbooks.classifyKind("investigue as dependencias desta tela");
    assert.deepEqual(await jev.refineTaskKind("investigue as dependencias desta tela", local, {
      config: config({ enabled: false }), fetch: transport,
    }), local);
    assert.deepEqual(await jev.refineTaskKind("investigue as dependencias desta tela", local, {
      config: config({ apiKey: "" }), fetch: transport,
    }), local);
    assert.equal(calls, 0);
  });

  it("does not override a high-confidence heuristic", async () => {
    const local = playbooks.classifyKind("a garagem quebrou e da erro");
    assert.equal(local.confidence, "high");
    let calls = 0;
    const result = await jev.refineTaskKind("a garagem quebrou e da erro", local, {
      config: config(), fetch: async () => { calls++; return response("create", 0.99); },
    });
    assert.deepEqual(result, local);
    assert.equal(calls, 0);
  });

  it("routes ambiguous requests via bounded Jev choices and redacts no secrets into state", async () => {
    let request;
    const result = await jev.refineTaskKind("refatore o fluxo de login", playbooks.classifyKind("refatore o fluxo de login"), {
      config: config(),
      fetch: async (_url, options) => { request = options; return response("mechanic", 0.92); },
    });
    assert.equal(result.kind, "mechanic");
    assert.equal(result.confidence, "high");
    assert.equal(result.source, "jev");
    const sent = JSON.parse(request.body);
    assert.equal(sent.model, "jev-latest");
    assert.deepEqual(Object.keys(sent.questions.taskKind.criteria), ["config", "fix", "mechanic", "create", "unknown"]);
    assert.equal(sent.state.userRequest, "refatore o fluxo de login");
    assert.doesNotMatch(request.body, /fixture-key-only/);
  });

  it("low confidence, invalid answer, HTTP failure and network errors use local fallback", async () => {
    const local = playbooks.classifyKind("investigue quais arquivos mudam");
    for (const transport of [
      async () => response("create", 0.3),
      async () => response("surprise", 0.99),
      async () => ({ ok: false, status: 401 }),
      async () => { throw new Error("offline"); },
    ]) {
      assert.deepEqual(await jev.refineTaskKind("investigue quais arquivos mudam", local, {
        config: config(), fetch: transport,
      }), local);
    }
  });

  it("Jev can explicitly leave a question unclassified", async () => {
    const local = playbooks.classifyKind("investigue as alteracoes");
    const result = await jev.refineTaskKind("investigue as alteracoes", local, {
      config: config(), fetch: async () => response("unknown", 0.91),
    });
    assert.equal(result.kind, null);
    assert.equal(result.source, "jev");
  });

  it("preserves project playbook authority even with a Jev classified kind", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-jev-pb-"));
    try {
      const plan = await playbooks.planTaskAsync(projectRoot, "refatore a autenticacao", {
        jevOptions: { config: config(), fetch: async () => response("mechanic", 0.88) },
      });
      assert.equal(plan.kind, "mechanic");
      assert.equal(plan.source, "jev");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});


describe("Jev memory ordering", () => {
  const entries = [
    { slug: "garage", topic: "vehicle garage" },
    { slug: "bank", topic: "bank deposits" },
    { slug: "weapons", topic: "weapon skins" },
  ];
  it("does not send any content while memory feature is disabled", async () => {
    let calls = 0;
    const selected = await jev.prioritizeMemories("bank balance", entries, {
      config: { ...config(), memoryEnabled: false },
      fetch: async () => { calls++; throw Error("Unexpected request"); },
    });
    assert.strictEqual(selected, entries);
    assert.equal(calls, 0);
  });
  it("reorders existing lexical candidates using topic metadata only", async () => {
    let request;
    const selected = await jev.prioritizeMemories("bank balance", entries, {
      config: { ...config(), memoryEnabled: true },
      fetch: async (_url, options) => {
        request = JSON.parse(options.body);
        return { ok: true, json: async () => ({ answers: { bestMemory: { choice: "m1", confidence: 0.97 } } }) };
      },
    });
    assert.deepEqual(selected.map((m) => m.slug), ["bank", "garage", "weapons"]);
    assert.deepEqual(request.state.candidateTopics.map((t) => t.topic), entries.map((m) => m.topic));
    assert.doesNotMatch(JSON.stringify(request), /fixture-key-only/);
  });
  it("invalid memory labels and low confidence leave local order unchanged", async () => {
    for (const label of ["m42", "none", "m1"]) {
      const selected = await jev.prioritizeMemories("bank balance", entries, {
        config: { ...config(), memoryEnabled: true },
        fetch: async () => ({ ok: true, json: async () => ({ answers: { bestMemory: { choice: label, confidence: label === "m1" ? 0.4 : 0.99 } } }) }),
      });
      assert.strictEqual(selected, entries);
    }
  });
});

describe("Memory lexical lead guard", () => {
  it("skips remote reranking when the top lexical result is much stronger", async () => {
    const ranked = [{ slug: "group", topic: "VIP groups and Lanca bonuses", score: 19.11 }, { slug: "survival", topic: "respawn process", score: 6.73 }];
    let calls = 0;
    const actual = await jev.prioritizeMemories("mochila lança VIP", ranked, {
      config: { ...config(), memoryEnabled: true },
      fetch: async () => { calls++; throw new Error("should skip remote"); },
    });
    assert.strictEqual(actual, ranked);
    assert.equal(calls, 0);
  });
  it("still considers Jev when local scores are close", async () => {
    const ranked = [{ slug: "a", topic: "item consumable", score: 11 }, { slug: "b", topic: "inventory capacity", score: 10 }];
    let calls = 0;
    const actual = await jev.prioritizeMemories("Lanca capacity", ranked, {
      config: { ...config(), memoryEnabled: true },
      fetch: async () => {
        calls++;
        return { ok: true, json: async () => ({ answers: { bestMemory: { choice: "m1", confidence: 0.97 } } }) };
      },
    });
    assert.deepEqual(actual.map(x => x.slug), ["b", "a"]);
    assert.equal(calls, 1);
  });
});
