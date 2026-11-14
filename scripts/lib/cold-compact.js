/**
 * cold-compact — compact a cold, large Claude Code session before resuming it.
 *
 * When a session sat idle past the prompt-cache TTL, the next message re-sends
 * the whole context uncached. Orchestrators that wake big sessions after a
 * quota reset pay that cost (and risk hitting the limit again) on every one.
 *
 * Two entry points:
 * - `fxmind claude-send --session <id> "<msg>"`: runs `claude -p --resume <id>
 *   /compact` first when the session is cold and large, then sends the message.
 *   Fully automatic; meant for orchestrators.
 * - `fxmind cold-compact --hook`: Claude Code UserPromptSubmit guard. A hook
 *   cannot trigger /compact inside the running process, so it blocks the
 *   prompt and asks for `/compact` + resend. Fail-open on any error.
 *
 * Env: FXMIND_COLD_COMPACT=0 disables; FXMIND_COLD_MINUTES (default 60);
 * FXMIND_COLD_TOKENS (default 80000).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_COLD_MINUTES = 60;
const DEFAULT_COLD_TOKENS = 80000;
const HOOK_COMMAND = "fxmind cold-compact --hook";
const TAIL_BYTES = 512 * 1024;

function thresholds(env = process.env) {
  const minutes = Number(env.FXMIND_COLD_MINUTES);
  const tokens = Number(env.FXMIND_COLD_TOKENS);
  return {
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_COLD_MINUTES,
    tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : DEFAULT_COLD_TOKENS,
  };
}

function readTail(file, bytes = TAIL_BYTES) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    // Drop the partial first line when the read started mid-file.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Context size and last activity from a transcript (.jsonl).
 * Context = last main-chain assistant usage (input + cache read + cache write);
 * a compact boundary after it resets the size to 0.
 */
function analyzeTranscript(file) {
  const lines = readTail(file).split("\n");
  let lastAt = 0;
  let tokens = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isSidechain) continue;
    if (!lastAt && entry.timestamp && (entry.type === "user" || entry.type === "assistant")) {
      lastAt = Date.parse(entry.timestamp) || 0;
    }
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      tokens = tokens ?? 0;
      break;
    }
    const usage = entry.type === "assistant" ? entry.message?.usage : null;
    if (usage && tokens === null) {
      tokens =
        (usage.input_tokens || 0) +
        (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0);
    }
    if (lastAt && tokens !== null) break;
  }
  return { lastAt, tokens: tokens || 0 };
}

function evaluate(file, options = {}) {
  const now = options.now ?? Date.now();
  const limits = options.thresholds || thresholds(options.env);
  const { lastAt, tokens } = analyzeTranscript(file);
  const idleMinutes = lastAt ? (now - lastAt) / 60000 : 0;
  return {
    lastAt,
    tokens,
    idleMinutes,
    cold: Boolean(lastAt) && idleMinutes >= limits.minutes,
    large: tokens >= limits.tokens,
    shouldCompact: Boolean(lastAt) && idleMinutes >= limits.minutes && tokens >= limits.tokens,
  };
}

function claudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/** Locate <config>/projects/<encoded cwd>/<sessionId>.jsonl. */
function findTranscript(sessionId, options = {}) {
  if (!/^[\w-]+$/.test(String(sessionId || ""))) return null;
  const projects = path.join(claudeConfigDir(options.env), "projects");
  if (options.cwd) {
    const encoded = path.resolve(options.cwd).replace(/[^a-zA-Z0-9]/g, "-");
    const direct = path.join(projects, encoded, `${sessionId}.jsonl`);
    if (fs.existsSync(direct)) return direct;
  }
  let dirs = [];
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const file = path.join(projects, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function describe(result) {
  return `${Math.round(result.tokens / 1000)}k tokens, ociosa há ${Math.round(result.idleMinutes)} min`;
}

/** UserPromptSubmit hook output object, or null to let the prompt through. */
function hookDecision(payload, env = process.env) {
  if (env.FXMIND_COLD_COMPACT === "0") return null;
  const prompt = String(payload?.prompt || "").trim();
  if (prompt.startsWith("/")) return null; // /compact, /clear, ... pass through
  const file = payload?.transcript_path;
  if (!file || !fs.existsSync(file)) return null;
  const result = evaluate(file, { env });
  if (!result.shouldCompact) return null;
  return {
    decision: "block",
    reason:
      `fxmind: sessão fria com contexto grande (${describe(result)}). ` +
      "Rode /compact e reenvie a mensagem — ou use `fxmind claude-send --session <id>` para fazer isso automaticamente.",
  };
}

function readStdin(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function runHook(env = process.env) {
  try {
    const payload = JSON.parse((await readStdin()) || "{}");
    const decision = hookDecision(payload, env);
    if (decision) process.stdout.write(JSON.stringify(decision));
  } catch {
    // Fail-open.
  }
  return 0;
}

function runClaude(bin, args, { input, env, cwd, stdout = "inherit" } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: [input === undefined ? "ignore" : "pipe", stdout, "inherit"],
      shell: process.platform === "win32",
    });
    child.on("error", (err) => {
      process.stderr.write(`fxmind: falha ao executar ${bin}: ${err.message}\n`);
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 1));
    if (input !== undefined) child.stdin.end(input);
  });
}

function parseSendArgs(argv) {
  const out = { session: null, cwd: null, force: false, message: [], passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      out.passthrough = argv.slice(i + 1);
      break;
    }
    if (arg === "--session" || arg === "-s") out.session = argv[++i];
    else if (arg === "--cwd") out.cwd = argv[++i];
    else if (arg === "--force-compact") out.force = true;
    else out.message.push(arg);
  }
  return out;
}

/**
 * fxmind claude-send --session <id> [--cwd dir] [--force-compact] "<msg>" [-- <claude args>]
 * Message from argv or stdin. Compacts first when cold + large.
 */
async function runSendCli(argv = [], deps = {}) {
  const env = deps.env || process.env;
  const opts = parseSendArgs(argv);
  if (!opts.session) {
    console.error('Uso: fxmind claude-send --session <id> [--cwd dir] [--force-compact] "<mensagem>" [-- <args do claude>]');
    return 1;
  }
  let message = opts.message.join(" ").trim();
  if (!message) message = String((await (deps.readStdin || readStdin)(5000)) || "").trim();
  if (!message) {
    console.error("fxmind claude-send: mensagem vazia (argv ou stdin).");
    return 1;
  }
  const bin = env.FXMIND_CLAUDE_BIN || "claude";
  const run = deps.runClaude || runClaude;
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const childEnv = { ...env, FXMIND_COLD_COMPACT: "0" };

  let compact = opts.force;
  if (!compact && env.FXMIND_COLD_COMPACT !== "0") {
    const file = findTranscript(opts.session, { cwd, env });
    if (file) {
      const result = evaluate(file, { env });
      if (result.shouldCompact) {
        process.stderr.write(`fxmind: sessão fria (${describe(result)}) — compactando antes de continuar…\n`);
        compact = true;
      }
    }
  }
  if (compact) {
    const code = await run(bin, ["-p", "--resume", opts.session, ...opts.passthrough, "/compact"], {
      env: childEnv,
      cwd,
      stdout: "ignore",
    });
    if (code !== 0) {
      process.stderr.write(`fxmind: /compact falhou (código ${code}); enviando a mensagem mesmo assim.\n`);
    }
  }
  return run(bin, ["-p", "--resume", opts.session, ...opts.passthrough], { input: `${message}\n`, env: childEnv, cwd });
}

async function runColdCompactCli(argv = []) {
  if (argv.includes("--hook")) return runHook();
  const file = argv[0] && fs.existsSync(argv[0]) ? argv[0] : findTranscript(argv[0]);
  if (!file) {
    console.log("Uso: fxmind cold-compact <session-id|transcript.jsonl>   |   fxmind cold-compact --hook");
    return 1;
  }
  const result = evaluate(file);
  console.log(`${describe(result)} → ${result.shouldCompact ? "compactar antes de retomar" : "ok"}`);
  return 0;
}

module.exports = {
  HOOK_COMMAND,
  thresholds,
  analyzeTranscript,
  evaluate,
  findTranscript,
  hookDecision,
  parseSendArgs,
  runSendCli,
  runColdCompactCli,
};
