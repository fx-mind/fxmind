const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const stream = require("./panel-cli-stream");
const gitDiff = require("./panel-git-diff");

describe("panel-cli-stream", () => {
  it("extracts OpenCode assistant text", () => {
    const events = stream.parseLine(
      JSON.stringify({ type: "assistant", text: "Olá mundo" }),
      "opencode",
    );
    assert.equal(events[0].kind, "text");
    assert.equal(events[0].text, "Olá mundo");
  });

  it("maps tool events to activity labels", () => {
    const events = stream.parseLine(
      JSON.stringify({ type: "tool_use", name: "read", input: { path: "client.lua" } }),
      "opencode",
    );
    const tool = events.find((e) => e.kind === "tool");
    assert.ok(tool);
    assert.match(tool.label, /Leu/);
  });

  it("maps OpenCode tool_use part.state to a labeled tool event", () => {
    const events = stream.parseLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_x",
        part: {
          type: "tool",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "ls src" },
            title: "List files",
            output: "App.tsx\n",
          },
        },
      }),
      "opencode",
    );
    const tool = events.find((e) => e.kind === "tool");
    assert.ok(tool);
    assert.match(tool.label, /Rodou/);
    assert.match(tool.detail, /ls src/);
    assert.equal(tool.status, "done");
    assert.match(String(tool.output || ""), /App/);
  });

  it("maps OpenCode step_start to CLI activity", () => {
    const events = stream.parseLine(
      JSON.stringify({
        type: "step_start",
        sessionID: "ses_x",
        part: { type: "step-start" },
      }),
      "opencode",
    );
    assert.ok(events.some((e) => e.kind === "cli" && /passo/i.test(e.label)));
  });

  it("parses Codex agent_message completion", () => {
    const events = stream.parseLine(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "feito" },
      }),
      "codex",
    );
    assert.equal(events[0].kind, "text");
    assert.equal(events[0].text, "feito");
  });

  it("shows Codex MCP calls as fxmind activity", () => {
    const started = stream.parseLine(
      JSON.stringify({
        type: "item.started",
        item: {
          type: "mcp_tool_call",
          server: "fxmind",
          tool: "fxmind_query",
          arguments: { question: "Como funciona o graph?" },
        },
      }),
      "codex",
    );
    const startedTool = started.find((event) => event.kind === "mcp");
    assert.ok(startedTool);
    assert.equal(startedTool.server, "fxmind");
    assert.equal(startedTool.label, "fxmind_query");
    assert.match(startedTool.detail, /Como funciona/);
    assert.equal(startedTool.status, "running");

    const completed = stream.parseLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "fxmind",
          tool: "fxmind_query",
          arguments: { question: "Como funciona o graph?" },
          result: { ok: true, answer: "Encontrado" },
        },
      }),
      "codex",
    );
    const completedTool = completed.find((event) => event.kind === "mcp");
    assert.ok(completedTool);
    assert.equal(completedTool.status, "done");
    assert.match(completedTool.output, /Encontrado/);
  });

  it("ignores OpenCode log permission evaluations", () => {
    const events = stream.eventsFromOpencodeLogLine(
      'timestamp=2026-08-29T16:25:34.886Z level=INFO run=1ed65d84 message=evaluated permission=bash pattern="ls src" action.permission=* action.action=allow',
    );
    assert.deepEqual(events, []);
  });

  it("maps OpenCode touching file log lines", () => {
    const events = stream.eventsFromOpencodeLogLine(
      'timestamp=2026-08-29T16:26:14.253Z level=INFO run=1ed65d84 message="touching file" file="F:\\\\proj\\\\migrations\\\\a.sql"',
    );
    assert.equal(events.length, 1);
    assert.match(events[0].label, /Editou/);
  });

  it("extracts GATE markers and todos from text", () => {
    const events = stream.parseLineEnriched(
      "🛑 GATE A COMPLETE — CLASS: task\n- [ ] ler safezone\n- [x] achar rádio",
    );
    assert.ok(events.some((e) => e.kind === "text"));
    assert.ok(events.some((e) => e.kind === "gates" && e.gates[0].id === "A"));
    const todos = events.find((e) => e.kind === "todos");
    assert.equal(todos.todos.length, 2);
    assert.equal(todos.todos[1].status, "done");
  });

  it("parses a tolerant fxmind-ask fenced block", () => {
    const events = stream.parseLineEnriched(
      'work continues\n  ``` fxmind-ask  \n  {"question":"Choose a target","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"multi":true}\n  ```',
    );
    const ask = events.find((event) => event.kind === "ask");
    assert.deepEqual(ask, {
      kind: "ask",
      question: "Choose a target",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      multi: true,
    });
  });

  it("keeps structured ask blocks out of visible assistant text", () => {
    const events = stream.parseLine(
      'Antes\n```fxmind-ask\n{"question":"Choose","options":[{"id":"a","label":"A"}]}\n```\nDepois',
    );
    assert.equal(events.filter((event) => event.kind === "ask").length, 1);
    const text = events.find((event) => event.kind === "text");
    assert.equal(text.text.includes("fxmind-ask"), false);
    assert.match(text.text, /Antes/);
    assert.match(text.text, /Depois/);
  });

  it("ignores malformed ask payloads without throwing", () => {
    assert.equal(
      stream.parseAskFromText("```fxmind-ask\n{not json}\n```"),
      null,
    );
  });
});

describe("panel-git-diff", () => {
  it("parses unified patches into files", () => {
    const files = gitDiff.parsePatch(
      [
        "diff --git a/a.lua b/a.lua",
        "--- a/a.lua",
        "+++ b/a.lua",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    );
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "a.lua");
    assert.equal(files[0].additions, 1);
    assert.equal(files[0].deletions, 1);
  });

  it("hides fxmind tooling paths from the task diff", () => {
    assert.equal(gitDiff.isFxmindNoisePath(".fxmind/modes/painel.md"), true);
    assert.equal(gitDiff.isFxmindNoisePath(".agents/skills/fxmind/SKILL.md"), true);
    assert.equal(gitDiff.isFxmindNoisePath("opencode.json"), true);
    assert.equal(gitDiff.isFxmindNoisePath("resources/radio/client.lua"), false);
    const files = gitDiff.filterTaskFiles([
      { path: "opencode.json", status: "untracked", additions: 0, deletions: 0, patch: "" },
      { path: "resources/radio/client.lua", status: "modified", additions: 2, deletions: 1, patch: "" },
    ]);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "resources/radio/client.lua");
  });
});
