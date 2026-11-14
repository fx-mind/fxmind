const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const cc = require("./cold-compact");

const HOUR = 3600 * 1000;

function line(obj) {
  return `${JSON.stringify(obj)}\n`;
}
function assistant(at, tokens, extra = {}) {
  return line({
    type: "assistant",
    timestamp: new Date(at).toISOString(),
    message: { usage: { input_tokens: 10, cache_read_input_tokens: tokens - 10, cache_creation_input_tokens: 0 } },
    ...extra,
  });
}

describe("cold-compact", () => {
  let dir;
  let file;
  let env;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxcold-"));
    fs.mkdirSync(path.join(dir, "projects", "-repo"), { recursive: true });
    file = path.join(dir, "projects", "-repo", "abc-123.jsonl");
    env = { FXMIND_PANEL_CONFIG: path.join(dir, "panel.json") };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("flags a cold, large session", () => {
    fs.writeFileSync(file, assistant(Date.now() - 2 * HOUR, 150000));
    const r = cc.evaluate(file, { env });
    assert.equal(r.tokens, 150000);
    assert.equal(r.shouldCompact, true);
  });

  it("ignores warm or small sessions", () => {
    fs.writeFileSync(file, assistant(Date.now() - 5 * 60000, 150000));
    assert.equal(cc.evaluate(file, { env }).shouldCompact, false);
    fs.writeFileSync(file, assistant(Date.now() - 2 * HOUR, 20000));
    assert.equal(cc.evaluate(file, { env }).shouldCompact, false);
  });

  it("treats a compact boundary as a reset and skips sidechains", () => {
    const old = Date.now() - 3 * HOUR;
    fs.writeFileSync(
      file,
      assistant(old, 150000) +
        line({ type: "system", subtype: "compact_boundary", timestamp: new Date(old).toISOString() }) +
        assistant(old, 900000, { isSidechain: true }),
    );
    assert.equal(cc.evaluate(file, { env }).tokens, 0);
  });

  it("hook blocks normal prompts but lets slash commands through", () => {
    fs.writeFileSync(file, assistant(Date.now() - 2 * HOUR, 150000));
    const out = cc.hookDecision({ prompt: "continue a tarefa", transcript_path: file }, env);
    assert.equal(out.decision, "block");
    assert.match(out.reason, /\/compact/);
    assert.equal(cc.hookDecision({ prompt: "/compact", transcript_path: file }, env), null);
    assert.equal(cc.hookDecision({ prompt: "oi", transcript_path: file }, { ...env, FXMIND_COLD_COMPACT: "0" }), null);
  });

  it("is on by default and follows the panel setting, env overriding it", () => {
    fs.writeFileSync(file, assistant(Date.now() - 2 * HOUR, 150000));
    assert.deepEqual(cc.thresholds(env), { enabled: true, minutes: 60, tokens: 80000 });
    fs.writeFileSync(env.FXMIND_PANEL_CONFIG, JSON.stringify({ panel: { coldCompact: { enabled: false } } }));
    assert.equal(cc.hookDecision({ prompt: "continue a tarefa", transcript_path: file }, env), null);
    assert.equal(cc.thresholds({ ...env, FXMIND_COLD_COMPACT: "1" }).enabled, true);
    fs.writeFileSync(env.FXMIND_PANEL_CONFIG, JSON.stringify({ panel: { coldCompact: { minutes: 180, tokens: 200000 } } }));
    assert.equal(cc.evaluate(file, { env }).shouldCompact, false);
    assert.equal(cc.thresholds({ ...env, FXMIND_COLD_TOKENS: "1000" }).tokens, 1000);
  });

  it("finds the transcript by session id", () => {
    fs.writeFileSync(file, "");
    assert.equal(cc.findTranscript("abc-123", { env: { CLAUDE_CONFIG_DIR: dir } }), file);
    assert.equal(cc.findTranscript("../x", { env: { CLAUDE_CONFIG_DIR: dir } }), null);
  });

  it("claude-send compacts first when cold, then sends the message", async () => {
    fs.writeFileSync(file, assistant(Date.now() - 2 * HOUR, 150000));
    const calls = [];
    const code = await cc.runSendCli(["--session", "abc-123", "segue", "o", "plano", "--", "--model", "opus"], {
      env: { ...env, CLAUDE_CONFIG_DIR: dir },
      runClaude: async (bin, args, opts) => {
        calls.push({ args, input: opts.input });
        return 0;
      },
    });
    assert.equal(code, 0);
    assert.deepEqual(calls[0].args, ["-p", "--resume", "abc-123", "--model", "opus", "/compact"]);
    assert.deepEqual(calls[1].args, ["-p", "--resume", "abc-123", "--model", "opus"]);
    assert.equal(calls[1].input, "segue o plano\n");
  });

  it("claude-send skips compact for a warm session", async () => {
    fs.writeFileSync(file, assistant(Date.now() - 60000, 150000));
    const calls = [];
    await cc.runSendCli(["-s", "abc-123", "oi"], {
      env: { ...env, CLAUDE_CONFIG_DIR: dir },
      runClaude: async (bin, args) => (calls.push(args), 0),
    });
    assert.equal(calls.length, 1);
  });
});
