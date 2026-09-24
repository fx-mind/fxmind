/**
 * fxmind context — memory preload for agent prompts.
 *
 * `fxmind context --hook` is the Claude Code UserPromptSubmit hook: it reads
 * the hook payload from stdin, ranks project memories for the prompt and
 * prints them as additionalContext, so the agent starts with the relevant
 * memory instead of spending a turn on fxmind_query. No match → no output
 * (zero tokens). Always fail-open: errors never block the prompt.
 *
 * `fxmind context "<question>"` prints the same context for manual checks.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_BUDGET = 1200;
const MIN_PROMPT_CHARS = 8;
const CLAUDE_SETTINGS_REL = path.join(".claude", "settings.json");
const CLAUDE_HOOK_COMMAND = "fxmind context --hook";

function findProjectRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, ".fxmind", "memory"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function shouldSkipPrompt(prompt) {
  const text = String(prompt || "").trim();
  if (text.length < MIN_PROMPT_CHARS) return true;
  // Other slash commands carry their own instructions; /fxmind still benefits.
  return text.startsWith("/") && !/^\/fxmind\b/i.test(text);
}

function preloadBudget(env = process.env) {
  const value = Number(env.FXMIND_PRELOAD_BUDGET);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 4000) : DEFAULT_BUDGET;
}

/** Context text for a prompt, or "" when nothing relevant exists. */
function buildPromptContext(root, prompt, options = {}) {
  if (!root || shouldSkipPrompt(prompt)) return "";
  const tools = require("./fxmind-tools");
  const { formatQueryResult } = require("./lib/memory-retrieval");
  const result = tools.queryGraph(root, prompt, {
    budget: options.budget || DEFAULT_BUDGET,
    // Never rebuild on the prompt path; ranking reads memory files directly.
    rebuild: false,
  });
  if (!result.ok || !result.memories?.length) return "";
  return [
    "# fxmind — preloaded project memories",
    "Use these first and confirm against current source. Skip fxmind_query for these topics.",
    "",
    formatQueryResult(result),
  ].join("\n");
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
  if (env.FXMIND_PRELOAD === "0") return 0;
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {
    return 0;
  }
  try {
    const root = findProjectRoot(payload.cwd || env.CLAUDE_PROJECT_DIR || process.cwd());
    const context = buildPromptContext(root, payload.prompt, { budget: preloadBudget(env) });
    if (context) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
        }),
      );
    }
  } catch {
    // Fail-open: a broken memory must never block the user's prompt.
  }
  return 0;
}

async function runPromptContextCli(argv = []) {
  if (argv.includes("--hook")) return runHook();
  const question = argv.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (!question) {
    console.log('Usage: fxmind context "<question>"   |   fxmind context --hook (Claude Code UserPromptSubmit)');
    return 1;
  }
  const root = findProjectRoot(process.cwd());
  if (!root) {
    console.error("No .fxmind/memory found from the current directory.");
    return 1;
  }
  const context = buildPromptContext(root, question, { budget: preloadBudget() });
  console.log(context || "fxmind: no relevant memories for this prompt.");
  return 0;
}

/**
 * Register the hook in .claude/settings.json, keeping other hooks and
 * settings intact. Idempotent.
 */
function installClaudePromptHook(targetRoot) {
  const { writeJsonIfChanged } = require("./install/sync-files");
  const settingsPath = path.join(path.resolve(targetRoot), CLAUDE_SETTINGS_REL);
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      return { changed: false, error: `${CLAUDE_SETTINGS_REL} is not valid JSON` };
    }
  }
  settings.hooks = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  const groups = Array.isArray(settings.hooks.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
  const present = groups.some((group) =>
    (group?.hooks || []).some((hook) => hook?.command === CLAUDE_HOOK_COMMAND),
  );
  if (!present) {
    groups.push({ hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, timeout: 10 }] });
  }
  settings.hooks.UserPromptSubmit = groups;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const written = writeJsonIfChanged(settingsPath, settings);
  return { changed: Boolean(written?.changed), path: CLAUDE_SETTINGS_REL.replace(/\\/g, "/") };
}

module.exports = {
  CLAUDE_HOOK_COMMAND,
  findProjectRoot,
  shouldSkipPrompt,
  buildPromptContext,
  runPromptContextCli,
  installClaudePromptHook,
};
