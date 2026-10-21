"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const router = require("./tool-router");
const mcp = require("../mcp-server");

function config(overrides = {}) {
  return { enabled: true, toolRoutingEnabled: true, apiKey: "fixture-secret-key",
    minConfidence: 0.75, timeoutMs: 300, model: "jev-latest", ...overrides };
}
const answer = (choice, confidence = 0.95) => ({
  ok: true, json: async () => ({ answers: { nextTool: { choice, confidence } } }),
});

describe("Jev MCP tool router — local, bounded, advisory", () => {
  it("is read-only, available in core and read-only mode", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-tool-router-"));
    try {
      fs.mkdirSync(path.join(project, ".fxmind"));
      fs.writeFileSync(path.join(project, ".fxmind", "packs.json"), '{"packs":[]}');
      const standard = mcp.listTools(project, { FXMIND_MCP_TOOLS: "core" });
      const readonly = mcp.listTools(project, { FXMIND_MCP_READONLY: "1", FXMIND_MCP_TOOLS: "core" });
      assert.ok(standard.some((tool) => tool.name === "fxmind_route_tool"));
      assert.ok(readonly.some((tool) => tool.name === "fxmind_route_tool"));
      assert.equal(standard.find((tool) => tool.name === "fxmind_route_tool").annotations.readOnlyHint, true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("never recommends mutation tools, even if they appear in availableTools", async () => {
    const result = await router.routeTool("deploy faça commit push no servidor", {
      availableTools: ["fxmind_record_gate", "fxmind_fivem_cmd", "fxmind_db_query", "fxmind_query"],
      config: config(),
      fetch: async () => { throw Error("Unexpected network request"); },
    });
    assert.equal(result.tool, "fxmind_query");
    assert.equal(result.executed, false);
    assert.deepEqual(result.alternatives, ["fxmind_query"]);
  });

  it("high-confidence file hit recommends read_file, never calls Jev", async () => {
    let calls = 0;
    const result = await router.routeTool("leia o trecho da funcao", {
      availableTools: ["fxmind_query", "fxmind_search", "fxmind_read_file"],
      context: { hasFileHit: true },
      config: config(), fetch: async () => { calls++; throw Error("Must not call"); },
    });
    assert.equal(result.tool, "fxmind_read_file");
    assert.equal(result.source, "local");
    assert.equal(calls, 0);
  });

  it("verified playbook always overrides tool routing", async () => {
    const result = await router.routeTool("encontre essa função", {
      context: { hasPlaybook: true }, config: config(),
      fetch: async () => { throw Error("Must not call"); },
    });
    assert.equal(result.tool, null);
    assert.equal(result.source, "playbook");
  });

  it("suppresses duplicate memory discovery when already preloaded", async () => {
    const result = await router.routeTool("corrigir o bug do inventario", {
      availableTools: ["fxmind_query", "fxmind_search"],
      context: { memoriesPreloaded: true },
      config: config({ enabled: false }),
    });
    assert.equal(result.tool, "fxmind_search");
  });

  it("does not call Jev when tool routing is disabled or API key absent", async () => {
    let calls = 0;
    const request = "localizar erro";
    for (const cfg of [config({ toolRoutingEnabled: false }), config({ apiKey: "" }), config({ enabled: false })]) {
      const result = await router.routeTool(request, {
        availableTools: ["fxmind_query", "fxmind_search"],
        config: cfg,
        fetch: async () => { calls++; throw Error("Unexpected"); },
      });
      assert.equal(result.source, "local");
    }
    assert.equal(calls, 0);
  });

  it("chooses an allowed alternative for ambiguous requests and sends only whitelisted signals", async () => {
    let body;
    const result = await router.routeTool(
      "localizar erro C:\\Users\\secret\\db.env token=topsecret",
      {
        availableTools: ["fxmind_query", "fxmind_search", "fxmind_read_file"],
        config: config(),
        fetch: async (_url, options) => {
          body = JSON.parse(options.body);
          return answer("t1", 0.99);
        },
      },
    );
    assert.equal(result.source, "jev");
    assert.ok(["fxmind_query", "fxmind_search"].includes(result.tool));
    assert.equal(result.executed, false);
    assert.equal(body.model, "jev-latest");
    assert.deepEqual(Object.keys(body.state), ["taskSignals", "candidateTools"]);
    assert.ok(body.state.taskSignals.every((signal) => typeof signal === "string"));
    assert.ok(body.state.candidateTools.every((tool) => typeof tool.id === "string" && typeof tool.purpose === "string"));
    assert.doesNotMatch(JSON.stringify(body), /topsecret|secret\\|db\.env|fixture-secret-key/i);
  });

  it("falls back to local suggestion for invalid/low-confidence/failed HTTP or transport", async () => {
    const transports = [
      async () => answer("t1", 0.2),
      async () => answer("t17", 0.99),
      async () => answer("none", 0.99),
      async () => ({ ok: false, status: 429 }),
      async () => { throw Error("offline"); },
    ];
    for (const fetch of transports) {
      const result = await router.routeTool("localizar erro", {
        availableTools: ["fxmind_query", "fxmind_search"],
        config: config(), fetch,
      });
      assert.equal(result.source, "local");
      assert.equal(result.executed, false);
    }
  });

  it("only returns tools advertised to the actual caller", async () => {
    const result = await router.routeTool("arquivo erro", {
      availableTools: ["fxmind_query"],
      config: config(),
      fetch: async () => { throw Error("Unexpected network call"); },
    });
    assert.equal(result.tool, "fxmind_query");
    assert.deepEqual(result.alternatives, ["fxmind_query"]);
  });

  it("exposes an MCP tool that never executes the suggested action", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-router-mcp-"));
    try {
      fs.mkdirSync(path.join(root, ".fxmind"));
      fs.writeFileSync(path.join(root, ".fxmind", "packs.json"), '{"packs":[]}');
      const run = spawnSync(process.execPath, [path.join(__dirname, "..", "mcp-server.js")], {
        input: JSON.stringify({
          jsonrpc: "2.0", id: 4, method: "tools/call",
          params: { name: "fxmind_route_tool", arguments: { request: "arquivo da funcao" } },
        }) + "\n", encoding: "utf8", timeout: 20000,
        env: { ...process.env, FXMIND_TARGET: root, FXMIND_JEV_ENABLED: "false",
          FXMIND_JEV_TOOL_ROUTING_ENABLED: "false", FXMIND_MCP_READONLY: "1",
          FXMIND_MCP_TOOLS: "core" },
      });
      assert.equal(run.status, 0, run.stderr);
      const responses = run.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const parsed = JSON.parse(responses.find((line) => line.id === 4).result.content[0].text);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.executed, false);
      assert.ok(parsed.tool);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});


describe("Tool routing integration and high-confidence shortcuts", () => {
  it("chooses explicit memory listing and FXMIND update check locally", async () => {
    const configs = { config: config(), fetch: async () => { throw Error("Should not call Jev"); } };
    const memory = await router.routeTool("liste as memórias do projeto", configs);
    const update = await router.routeTool("verificar atualização do fxmind", configs);
    assert.equal(memory.tool, "fxmind_list_memories");
    assert.equal(update.tool, "fxmind_check_update");
    assert.equal(memory.source, "local");
    assert.equal(update.source, "local");
  });

  it("routes file reading to source search if no verified path was found", async () => {
    const result = await router.routeTool("leia arquivo do servidor", {
      config: config(), fetch: async () => { throw Error("Should not call Jev"); },
      availableTools: ["fxmind_search", "fxmind_read_file", "fxmind_query"],
    });
    assert.equal(result.tool, "fxmind_search");
  });

  it("automatically provides a bounded hint in panel context", async () => {
    const panel = require("./panel-context");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-panel-router-"));
    try {
      fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
      const body = await panel.buildContextFileAsync(root, "localizar erro", {
        toolRouterOptions: {
          config: config(),
          fetch: async () => answer("t0", 0.98),
        },
        availableTools: ["fxmind_query", "fxmind_search"],
      });
      assert.match(body, /Next FxMind MCP tool/);
      assert.match(body, /Recommended: fxmind_/);
      assert.match(body, /suggestion, not execution/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("the Claude prompt hook injects the next tool only with explicit opt-in", async () => {
    const promptContext = require("../prompt-context");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-hook-router-"));
    try {
      fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
      const result = await promptContext.buildPromptContextAsync(root, "localizar erro", {
        toolRouterOptions: {
          config: config(),
          fetch: async () => answer("t0", 0.96),
        },
      });
      assert.match(result, /FxMind recommended next tool/);
      assert.match(result, /MCP: fxmind_/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("the Jev configuration exposes an independent opt-in without exposing credentials", () => {
    const { jevStatus } = require("./jev");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-jev-router-env-"));
    try {
      const status = jevStatus({
        FXMIND_JEV_ENABLED: "true", FXMIND_JEV_TOOL_ROUTING_ENABLED: "true",
        FXMIND_JEV_API_KEY: "fixture-private",
      }, root);
      assert.equal(status.toolRoutingEnabled, true);
      assert.equal(status.active, true);
      assert.doesNotMatch(JSON.stringify(status), /fixture-private/);
      assert.equal(jevStatus({ FXMIND_JEV_ENABLED: "false" }, root).toolRoutingEnabled, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("MCP read-only annotations for noninteractive Gate V reviewer", () => {
  it("classifies memory retrieval as read-only, never gate mutations", () => {
    const tools = mcp.listTools(process.cwd(), { FXMIND_MCP_TOOLS: "all" });
    for (const name of ["fxmind_query", "fxmind_search", "fxmind_read_file", "fxmind_list_memories"]) {
      const item = tools.find(t => t.name === name);
      assert.ok(item, name);
      assert.equal(item.annotations.readOnlyHint, true, name);
      assert.equal(item.annotations.destructiveHint, false, name);
      assert.equal(item.annotations.openWorldHint, false, name);
    }
    for (const name of ["fxmind_record_gate", "fxmind_start_task", "fxmind_subagent_run"]) {
      const item = tools.find(t => t.name === name);
      if (item) assert.notEqual(item.annotations?.readOnlyHint, true, name);
    }
  });
  it("read-only MCP hides gate mutation tools while preserving memory retrieval", () => {
    const tools = mcp.listTools(process.cwd(), { FXMIND_MCP_READONLY: "1", FXMIND_MCP_TOOLS: "all" });
    assert.ok(tools.some(t => t.name === "fxmind_query" && t.annotations.readOnlyHint));
    assert.ok(!tools.some(t => t.name === "fxmind_record_gate"));
    assert.ok(!tools.some(t => t.name === "fxmind_start_task"));
  });
});
