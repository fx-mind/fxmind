/**
 * Local CLI agents for the web panel (OpenDesigner-style).
 */

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { writeContextTemp, buildJudgeContextFile, normalizeTaskMode } = require("./panel-context");
const { readPanelConfig, writePanelConfig, keyPrefix } = require("./panel-api");
const threads = require("./panel-threads");
const demandQueue = require("./panel-demand-queue");
const stream = require("./panel-cli-stream");
const panelRuns = require("./panel-runs");
const { PACKAGE_ROOT } = require("../resolve-packs");
const gitDiff = require("./panel-git-diff");
const taskGit = require("./panel-task-git");
const tools = require("../fxmind-tools");
const { scheduleGraphRebuildBackground } = require("./graph-freshness");
const { readPanelSubagentDefaults } = require("./panel-subagents");

const scheduledThreads = new Set();
const activeThreads = new Set();
const RUN_WATCHDOG_MS = 30_000;
const RUN_GRACE_MS = 2 * 60 * 1000;
const RUN_MAX_IDLE_MS = 12 * 60 * 1000;
const GREP_STALL_MS = 90 * 1000;

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

function pumpScheduler() {
  if (activeThreads.size >= concurrencyLimit()) return;
  for (const thread of threads.listThreads()) {
    if (activeThreads.size >= concurrencyLimit()) break;
    if (thread.status !== "queued" || scheduledThreads.has(thread.id)) continue;
    scheduleThread(thread.id).catch(() => {});
  }
}

function reconcileOrphanedRuns() {
  for (const summary of threads.listThreads()) {
    if (summary.status !== "running") continue;
    const raw = threads.getThreadRaw(summary.id);
    if (!raw || raw._child) continue;
    activeThreads.delete(summary.id);
    scheduledThreads.delete(summary.id);
    threads.finishAssistant(summary.id, {
      error:
        "Execução perdida ao reiniciar o painel. Envie a mensagem de novo para continuar.",
    });
  }
}

function startRunWatchdog(threadId) {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const raw = threads.getThreadRaw(threadId);
    if (!raw || raw.status !== "running") {
      clearInterval(timer);
      return;
    }
    const now = Date.now();
    const lastActivity = raw._lastActivityAt || startedAt;
    const child = raw._child;
    const activity = threads.getThread(threadId).thread?.activity || [];
    const grepRunning = activity.find(
      (item) =>
        item.status === "running" &&
        /\bgrep\b|\brg\b|select-string/i.test(String(item.detail || item.label || "")),
    );
    if (grepRunning && child) {
      const grepAt = Date.parse(grepRunning.at || "") || startedAt;
      if (now - grepAt > GREP_STALL_MS) {
        clearInterval(timer);
        terminateCliProcess(child);
        cleanup(null, raw);
        finalizeRun(threadId, raw.worktree?.path || raw.projectRoot);
        threads.finishAssistant(threadId, {
          error:
            "Busca manual (grep) travou — use fxmind_query e as memórias do contexto. Reenvie a mensagem.",
        });
        notifyThreadDone(threadId);
        return;
      }
    }
    if (child && child.exitCode != null && !raw._stopFinalized && !raw._pauseFinalized) {
      clearInterval(timer);
      cleanup(null, raw);
      finalizeRun(threadId, raw.worktree?.path || raw.projectRoot);
      const snapshot = threads.getThread(threadId).thread;
      const hasAssistant = (snapshot?.messages || []).some(
        (m) => m.role === "assistant" && String(m.content || "").trim(),
      );
      if (!hasAssistant) {
        threads.finishAssistant(threadId, {
          error:
            "O processo do agente encerrou sem resposta. Tente enviar de novo ou mude o modelo.",
        });
        notifyThreadDone(threadId);
      }
      return;
    }
    if (!child && now - startedAt > 30_000) {
      clearInterval(timer);
      cleanup(null, raw);
      finalizeRun(threadId, raw.worktree?.path || raw.projectRoot);
      threads.finishAssistant(threadId, {
        error:
          "O processo do agente encerrou sem resposta. Tente enviar de novo ou mude o modelo.",
      });
      notifyThreadDone(threadId);
      return;
    }
    if (now - startedAt > RUN_GRACE_MS && now - lastActivity > RUN_MAX_IDLE_MS) {
      clearInterval(timer);
      if (child) terminateCliProcess(child);
      cleanup(null, raw);
      finalizeRun(threadId, raw.worktree?.path || raw.projectRoot);
      threads.finishAssistant(threadId, {
        error:
          "O agente não respondeu a tempo (sem atividade por vários minutos). Tente de novo.",
      });
      notifyThreadDone(threadId);
    }
  }, RUN_WATCHDOG_MS);
  return () => clearInterval(timer);
}

function notifyThreadDone(threadId) {
  const raw = threads.getThreadRaw(threadId);
  const root = raw?.worktree?.path || raw?.projectRoot;
  if (raw && root && raw.status !== "paused" && raw.status !== "waiting") {
    finalizeRun(threadId, root);
  }
  demandQueue.onThreadFinished(threadId, threads, (id) => {
    dispatchThread(id).catch(() => {});
  });
  pumpScheduler();
  maybeTriggerJudge(threadId, raw);
}

/**
 * Auto-judge: only when the user explicitly configured it (never for
 * "manual", which is the default and only fires from the "Pedir revisão"
 * button). Never runs for query-mode threads (no real execution happened)
 * or for a run that ended in error (nothing to review yet).
 */
function maybeTriggerJudge(threadId, raw) {
  if (!raw || raw.mode === "query" || raw.status !== "done") return;
  const judge = getJudgeSettings();
  if (!judge.enabled || judge.trigger === "manual") return;
  if (judge.trigger === "on_diff" && !visibleDiffFiles(raw.diff).length) return;
  runJudge(threadId, { cliId: judge.cliId }).catch(() => {});
}

function usesHostCursorAgent(cliId = null) {
  const config = readPanelConfig();
  const id = cliId || config.agent?.cliId;
  if (id !== "cursor-agent") return false;
  if (canRunCursorAgentCli()) return false;
  return cursorHostModeAvailable();
}

async function dispatchThread(threadId, options = {}) {
  const raw = threads.getThreadRaw(threadId);
  if (raw?.mode === "query") {
    // Never touches the scheduler/concurrency slots or spawns a process —
    // answered straight from the knowledge graph.
    return answerFromGraph(threadId, options);
  }
  if (usesHostCursorAgent(options.cliId)) {
    const raw = threads.getThreadRaw(threadId);
    const host = threads.hostStatus();
    if (!host.connected) {
      const message =
        "Nenhum chat Cursor conectado ao painel. Abra com `/fxmind painel` neste chat do Cursor, ou adicione CURSOR_API_KEY em Settings → Execução.";
      threads.appendAssistantDelta(threadId, message);
      threads.finishAssistant(threadId, { error: "host_not_connected" });
      notifyThreadDone(threadId);
      return { ok: false, error: "host_not_connected" };
    }
    return {
      ok: true,
      mode: "host",
      root: raw?.worktree?.path || raw?.projectRoot || process.cwd(),
    };
  }
  return scheduleThread(threadId, options);
}

const CLI_CATALOG = [
  {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    docs: "https://opencode.ai/docs/cli/",
    order: 1,
  },
  {
    id: "codex",
    name: "Codex",
    bin: "codex",
    docs: "https://developers.openai.com/codex",
    order: 2,
  },
  {
    id: "claude",
    name: "Claude Code",
    bin: "claude",
    docs: "https://docs.anthropic.com/en/docs/claude-code",
    order: 3,
  },
  {
    id: "hermes",
    name: "Hermes",
    bin: "hermes",
    docs: null,
    order: 4,
  },
  {
    id: "cursor-agent",
    name: "Cursor Agent",
    bin: null,
    docs: "https://cursor.com/docs/agent/cli",
    order: 5,
  },
];

const DEFAULT_ORDER = ["opencode", "codex", "claude", "hermes", "cursor-agent"];
const CODEX_FALLBACK_MODELS = [
  "gpt-5.4",
  "gpt-5.4-fast",
  "gpt-5.4-codex",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "o3",
  "o4-mini",
];

const CODEX_REASONING_EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"];

const EFFORT_BY_CLI = {
  opencode: { modes: ["default", "fast"], opencodeVariant: { fast: "minimal" } },
  codex: { modes: ["default", ...CODEX_REASONING_EFFORT_ORDER] },
  claude: { modes: ["default", "low", "medium", "high", "max"], cliFlag: true },
  "cursor-agent": { modes: ["default", "fast"], modelSuffix: true },
  hermes: { modes: ["default"] },
};

function isFastVariantId(modelId) {
  return String(modelId || "").endsWith("-fast");
}

function fastCompanionId(modelId, allIds) {
  const fast = `${modelId}-fast`;
  return allIds.has(fast) ? fast : null;
}

function isModelEnabled(prefs, cliId, modelId) {
  const cliPrefs = prefs?.[cliId];
  if (!cliPrefs || cliPrefs[modelId] === undefined) return true;
  return cliPrefs[modelId].enabled !== false;
}

function modelId(entry) {
  return typeof entry === "string" ? entry : entry?.id || entry?.model || "";
}

function enrichModels(cliId, rawModels, prefs = {}) {
  const entries = rawModels
    .map((entry) => ({ entry, id: String(modelId(entry)).trim() }))
    .filter(({ id }) => id);
  const set = new Set(entries.map(({ id }) => id));
  return entries.map(({ entry, id }) => {
    const enabled = isModelEnabled(prefs, cliId, id);
    const isFastVariant = isFastVariantId(id);
    const baseId = isFastVariant ? id.slice(0, -5) : null;
    const fastId = !isFastVariant ? fastCompanionId(id, set) : null;
    const model = {
      id,
      enabled,
      isFastVariant,
      baseId,
      fastId,
      hasFast: Boolean(fastId),
    };
    if (Array.isArray(entry?.reasoningEfforts) && entry.reasoningEfforts.length) {
      model.reasoningEfforts = entry.reasoningEfforts;
    }
    if (entry?.defaultReasoningEffort) {
      model.defaultReasoningEffort = entry.defaultReasoningEffort;
    }
    return model;
  });
}

function pickerModels(enriched) {
  const set = new Set(enriched.map((m) => m.id));
  return enriched.filter((m) => {
    if (!m.enabled) return false;
    if (m.isFastVariant && m.baseId && set.has(m.baseId)) return false;
    return true;
  });
}

function effortSupport(cliId, enriched, current, selectedModel = null) {
  const spec = EFFORT_BY_CLI[cliId] || { modes: ["default"] };
  if (cliId === "codex") {
    const selected = enriched.find((model) => model.id === selectedModel);
    const available = selected?.reasoningEfforts?.length
      ? selected.reasoningEfforts
      : enriched.flatMap((model) => model.reasoningEfforts || []);
    const supported = new Set(available);
    const modes = [
      "default",
      ...CODEX_REASONING_EFFORT_ORDER.filter((mode) => supported.has(mode)),
    ];
    const fallbackModes = modes.length > 1 ? modes : spec.modes;
    return {
      supported: fallbackModes.length > 1,
      modes: fallbackModes,
      current: current || "default",
      fastAvailable: false,
    };
  }
  const hasFast = enriched.some((m) => m.hasFast && m.enabled);
  const modes = hasFast
    ? spec.modes
    : spec.modes.filter((m) => m !== "fast");
  return {
    supported: modes.length > 1,
    modes,
    current: current || "default",
    fastAvailable: hasFast,
  };
}

function resolveExecution(cliId, model, effort) {
  const config = readPanelConfig();
  const prefs = config.agent?.modelPrefs || {};
  const eff = effort || config.agent?.effort || "default";
  let resolvedModel = model || config.agent?.model || null;

  if (eff === "fast" && resolvedModel && !isFastVariantId(resolvedModel)) {
    const fastId = `${resolvedModel}-fast`;
    if (isModelEnabled(prefs, cliId, fastId)) {
      resolvedModel = fastId;
    }
  }

  const spec = EFFORT_BY_CLI[cliId] || {};
  let variant = null;
  if (eff === "fast" && spec.opencodeVariant?.fast) {
    variant = spec.opencodeVariant.fast;
  }

  let claudeEffort = null;
  if (cliId === "claude" && eff && eff !== "default" && eff !== "fast") {
    claudeEffort = eff;
  }

  return { model: resolvedModel, effort: eff, variant, claudeEffort };
}

function fetchRawModels(cliId, bin) {
  const runList = (args, timeout = 20_000) => {
    const out = execCliSync(bin, args, timeout);
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  };

  if (cliId === "opencode") return runList(["models"]);
  if (cliId === "claude") {
    return [
      "sonnet",
      "opus",
      "haiku",
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "claude-haiku-4-5",
    ];
  }
  if (cliId === "codex") return CODEX_FALLBACK_MODELS;
  if (cliId === "cursor-agent") {
    return [
      "auto",
      "composer-2.5",
      "composer-2.5-fast",
      "gpt-5.6",
      "gpt-5.6-fast",
      "claude-opus-4-6",
    ];
  }
  return [];
}

function normalizeCodexModels(entries) {
  return entries
    .filter((entry) => typeof entry === "string" || !entry?.hidden)
    .map((entry) => {
      if (typeof entry === "string") return String(entry).trim();
      const id = String(entry.model || entry.id || "").trim();
      const reasoningEfforts = Array.isArray(entry.supportedReasoningEfforts)
        ? entry.supportedReasoningEfforts
            .map((item) =>
              typeof item === "string" ? item : item?.reasoningEffort,
            )
            .map((mode) => String(mode || "").trim())
            .filter(Boolean)
        : [];
      return {
        id,
        reasoningEfforts,
        defaultReasoningEffort: entry.defaultReasoningEffort || null,
      };
    })
    .filter((entry) => (typeof entry === "string" ? entry : entry.id));
}

function fetchCodexModels(bin, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawnCli(
      bin,
      ["app-server", "--stdio"],
      process.cwd(),
      buildEnv(),
      ["pipe", "pipe", "pipe"],
    );
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Codex app-server timeout")), timeout);

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        terminateCliProcess(child);
        reject(error);
      } else {
        terminateCliProcess(child);
        resolve(value);
      }
    };

    child.on("error", (error) => finish(error));
    child.stdin?.on("error", (error) => finish(error));
    child.on("close", () => {
      if (!settled) finish(new Error("Codex app-server closed before returning models"));
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id !== 2) continue;
          const models = message.result?.data;
          if (!Array.isArray(models)) {
            finish(new Error("Codex app-server returned no model list"));
            return;
          }
          finish(null, models);
          return;
        } catch {
          // Ignore non-JSON diagnostics and wait for the JSON-RPC response.
        }
      }
    });

    child.stdin?.write(
      `${JSON.stringify({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: { name: "fxmind", version: "1.0.0" },
          capabilities: {},
        },
      })}\n`,
    );
    child.stdin?.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    child.stdin?.write(`${JSON.stringify({ method: "model/list", id: 2, params: {} })}\n`);
  });
}

function cursorAgentPath() {
  const localApp = process.env.LOCALAPPDATA || "";
  const candidates = [
    path.join(localApp, "cursor-agent", "agent.cmd"),
    path.join(localApp, "cursor-agent", "cursor-agent.cmd"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function resolveCursorAgentBin() {
  return cursorAgentPath() || whichBin("agent") || whichBin("cursor-agent");
}

function cursorHostModeAvailable() {
  return !cursorApiKey();
}

function cursorAuthPath() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Cursor", "auth.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "auth.json");
  }
  return path.join(os.homedir(), ".config", "cursor", "auth.json");
}

function cursorSessionAuth() {
  if (cursorApiKey()) return null;
  try {
    const authPath = cursorAuthPath();
    if (!fs.existsSync(authPath)) return null;
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const token = String(auth.accessToken || "").trim();
    return token || null;
  } catch {
    return null;
  }
}

function canRunCursorAgentCli() {
  if (!resolveCursorAgentBin()) return false;
  if (cursorApiKey()) return true;
  return Boolean(cursorSessionAuth());
}

function cursorAgentAvailable() {
  return canRunCursorAgentCli() || cursorHostModeAvailable();
}

function formatCursorCliError(stderr = "") {
  const text = String(stderr || "").trim();
  if (/Authentication required|CURSOR_API_KEY|agent login|invalid auth/i.test(text)) {
    return [
      "Cursor Agent não autenticou no painel.",
      "Rode `agent login` no terminal (fora do Git Bash se `agent` não estiver no PATH),",
      "ou adicione CURSOR_API_KEY em Settings → Execução.",
    ].join(" ");
  }
  return text || "CLI falhou. Verifique Settings → Execução e modelo.";
}

function whichBin(name) {
  if (!name) return null;
  try {
    if (process.platform === "win32") {
      const out = execFileSync("cmd.exe", ["/d", "/s", "/c", "where", name], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      const lines = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const preferred =
        lines.find((line) => /\.exe$/i.test(line)) ||
        lines.find((line) => /\.cmd$/i.test(line)) ||
        lines.find((line) => /\.bat$/i.test(line)) ||
        lines[0];
      return preferred || null;
    }
    execFileSync("which", [name], { encoding: "utf8" });
    return name;
  } catch {
    return null;
  }
}

function execCliSync(bin, args, timeout = 8000, extra = {}) {
  const opts = {
    encoding: "utf8",
    timeout,
    windowsHide: true,
    stdio: extra.stdio || ["ignore", "pipe", "pipe"],
    ...extra,
  };
  if (process.platform === "win32") {
    opts.creationFlags = (opts.creationFlags || 0) | 0x08000000;
  }
  if (process.platform === "win32" && bin.toLowerCase().endsWith(".cmd")) {
    return execFileSync("cmd.exe", ["/d", "/s", "/c", bin, ...args], opts);
  }
  return execFileSync(bin, args, opts);
}

function runVersion(bin, args = ["--version"]) {
  try {
    const out = execCliSync(bin, args).trim();
    return out.split(/\r?\n/)[0].slice(0, 80);
  } catch {
    return null;
  }
}

function cursorApiKey() {
  const config = readPanelConfig();
  return String(process.env.CURSOR_API_KEY || config.byok?.cursor || "").trim() || null;
}

function testCursorAuth(bin) {
  if (cursorApiKey() || cursorSessionAuth()) return { ok: true };
  if (usesHostCursorAgent("cursor-agent")) {
    const host = threads.hostStatus();
    if (host.connected) return { ok: true };
    return {
      ok: false,
      needsLogin: true,
      message:
        "Sem CURSOR_API_KEY: use `/fxmind painel` neste chat do Cursor, ou adicione a chave em Settings → Execução.",
    };
  }
  try {
    execCliSync(bin, ["status"], 8000);
    return { ok: true };
  } catch (err) {
    const msg = String(err?.stderr || err?.stdout || err?.message || err);
    if (/login|auth|Authentication/i.test(msg)) {
      return {
        ok: false,
        needsLogin: true,
        message:
          "Adicione CURSOR_API_KEY em Settings → Execução, ou abra o painel com `/fxmind painel` neste chat.",
      };
    }
    return { ok: true };
  }
}

let codexAuthCache = { at: 0, result: null };
const CODEX_AUTH_TTL_MS = 5 * 60_000;

function testCodexAuth(bin, options = {}) {
  const force = options.force === true;
  if (
    !force &&
    codexAuthCache.result &&
    Date.now() - codexAuthCache.at < CODEX_AUTH_TTL_MS
  ) {
    return codexAuthCache.result;
  }

  const finish = (result) => {
    codexAuthCache = { at: Date.now(), result };
    return result;
  };

  try {
    const out = execCliSync(bin, ["login", "status"], 8000);
    if (/not logged|login required/i.test(out)) {
      return finish({ ok: false, needsLogin: true, message: "codex login required" });
    }
    return finish({ ok: true });
  } catch (err) {
    const msg = String(err?.stderr || err?.stdout || err?.message || err);
    if (/not logged|login|auth/i.test(msg)) {
      return finish({ ok: false, needsLogin: true, message: "codex login required" });
    }
    return finish({ ok: false, needsLogin: true, message: msg.slice(0, 200) });
  }
}

function resolveBin(entry) {
  if (entry.id === "cursor-agent") return resolveCursorAgentBin();
  return whichBin(entry.bin);
}

function scanCli(options = {}) {
  const quick = Boolean(options.quick);
  return CLI_CATALOG.map((entry) => {
    const bin = resolveBin(entry);
    const hasApiKey = entry.id === "cursor-agent" && Boolean(cursorApiKey());
    const sessionAuth = entry.id === "cursor-agent" && Boolean(cursorSessionAuth());
    const hostMode =
      entry.id === "cursor-agent" && cursorHostModeAvailable() && !hasApiKey && !sessionAuth && !bin;
    const available = Boolean(bin) || hasApiKey || sessionAuth || hostMode;
    let version = null;
    let needsLogin = false;
    let status = "not_installed";

    if (available) {
      status = hostMode && !bin ? "host" : "installed";
      if (!quick) {
        if (bin && entry.id === "opencode") version = runVersion(bin) || runVersion(bin, ["-v"]);
        else if (bin && entry.id === "codex") {
          version = runVersion(bin, ["--version"]) || runVersion(bin);
          const auth = testCodexAuth(bin, { force: options.forceAuth === true });
          if (!auth.ok && auth.needsLogin) {
            needsLogin = true;
            status = "needs_login";
          }
        } else if (bin && entry.id === "claude") version = runVersion(bin);
        else if (bin && entry.id === "cursor-agent") {
          version = runVersion(bin, ["--version"]) || "cursor-agent";
          // Host chat executa por padrão; CURSOR_API_KEY só habilita modo headless.
        } else if (hostMode && entry.id === "cursor-agent") {
          version = "chat host";
        } else if (bin) {
          version = runVersion(bin) || "installed";
        }
      } else {
        version = "…";
      }
    }

    return {
      id: entry.id,
      name: entry.name,
      docs: entry.docs,
      installed: available,
      status,
      version,
      needsLogin,
      bin: bin ? bin.replace(/\\/g, "/") : null,
    };
  }).sort((a, b) => {
    const ao = CLI_CATALOG.find((c) => c.id === a.id)?.order ?? 99;
    const bo = CLI_CATALOG.find((c) => c.id === b.id)?.order ?? 99;
    return ao - bo;
  });
}

function buildCliModels(cliId, rawIds, options = {}) {
  const config = readPanelConfig();
  const prefs = config.agent?.modelPrefs || {};
  const enriched = enrichModels(cliId, rawIds, prefs);
  const all = options.all === true;
  const models = all ? enriched : pickerModels(enriched);
  const effort = effortSupport(
    cliId,
    enriched,
    config.agent?.effort || "default",
    config.agent?.model || null,
  );

  const hints = {
    opencode: "Modelos do `opencode models`",
    codex: "Modelos do Codex app-server",
    claude: "Aliases do Claude Code",
    "cursor-agent": "Slugs do Cursor Agent",
  };

  return {
    ok: true,
    models,
    allModels: enriched,
    effort,
    hint: hints[cliId] || "Informe provider/modelo manualmente",
  };
}

function listCliModels(cliId, options = {}) {
  const entry = CLI_CATALOG.find((c) => c.id === cliId);
  if (!entry) return { ok: false, error: "unknown cli", models: [] };
  const bin = resolveBin(entry);
  if (cliId === "cursor-agent" && !bin && (cursorSessionAuth() || cursorApiKey())) {
    return buildCliModels(cliId, fetchRawModels(cliId, null), options);
  }
  if (cliId === "cursor-agent" && !bin && cursorHostModeAvailable()) {
    return buildCliModels(cliId, fetchRawModels(cliId, null), options);
  }
  if (!bin) return { ok: false, error: "not installed", models: [] };

  if (cliId === "codex") {
    return fetchCodexModels(bin)
      .then((entries) => {
        const models = normalizeCodexModels(entries);
        if (!models.length) throw new Error("Codex app-server returned no visible models");
        return buildCliModels(cliId, models, options);
      })
      .catch(() => buildCliModels(cliId, CODEX_FALLBACK_MODELS, options));
  }

  try {
    return buildCliModels(cliId, fetchRawModels(cliId, bin), options);
  } catch (err) {
    return { ok: false, error: String(err?.message || err), models: [] };
  }
}

function selectedExecution(cliId) {
  const config = readPanelConfig();
  return resolveExecution(cliId, config.agent?.model, config.agent?.effort);
}

const ACCESS_MODES = ["ask", "auto", "full"];

function normalizeAccessMode(mode) {
  const value = String(mode || "full").toLowerCase();
  return ACCESS_MODES.includes(value) ? value : "full";
}

function cliAccessArgs(cliId, accessMode) {
  const mode = normalizeAccessMode(accessMode);
  if (cliId === "codex") {
    if (mode === "full") {
      return ["--sandbox", "danger-full-access", "--dangerously-bypass-approvals-and-sandbox"];
    }
    if (mode === "auto") {
      return ["--sandbox", "workspace-write"];
    }
    return ["--sandbox", "read-only"];
  }
  if (cliId === "cursor-agent") {
    if (mode === "full") return ["--trust", "--approve-mcps"];
    if (mode === "auto") return ["--approve-mcps"];
    return [];
  }
  if (cliId === "opencode") {
    if (mode === "full") return ["--auto"];
    return [];
  }
  return [];
}

function normalizeJudgeTrigger(value) {
  return ["manual", "always", "on_diff"].includes(value) ? value : "manual";
}

function getJudgeSettings() {
  const config = readPanelConfig();
  const judge = config.agent?.judge || {};
  return {
    enabled: Boolean(judge.enabled),
    cliId: judge.cliId || null,
    model: judge.model || null,
    trigger: normalizeJudgeTrigger(judge.trigger),
  };
}

function getAgentSettings() {
  const config = readPanelConfig();
  const agent = config.agent || {};
  const panel = config.panel || {};
  const byok = config.byok || {};
  return {
    mode: agent.mode || "cli",
    cliId: agent.cliId || null,
    model: agent.model || null,
    effort: agent.effort || "default",
    taskMode: normalizeTaskMode(agent.taskMode),
    accessMode: normalizeAccessMode(agent.accessMode),
    modelPrefs: agent.modelPrefs || {},
    demandQueueParallel: Boolean(panel.demandQueueParallel),
    maxConcurrentTasks: concurrencyLimit(),
    subagents: readPanelSubagentDefaults(),
    judge: getJudgeSettings(),
    byok: {
      anthropic: Boolean(byok.anthropic || process.env.ANTHROPIC_API_KEY),
      openai: Boolean(byok.openai || process.env.OPENAI_API_KEY),
      cursor: Boolean(byok.cursor || process.env.CURSOR_API_KEY),
      anthropicPrefix: byok.anthropic ? keyPrefix(byok.anthropic) : "",
      openaiPrefix: byok.openai ? keyPrefix(byok.openai) : "",
      cursorPrefix: byok.cursor ? keyPrefix(byok.cursor) : "",
    },
    updatedAt: agent.updatedAt || null,
  };
}

function putAgentSettings(body = {}) {
  const config = readPanelConfig();
  const prev = config.agent || {};
  const prevPanel = config.panel || {};
  const prevByok = config.byok || {};

  config.agent = {
    mode: body.mode === "byok" ? "byok" : "cli",
    cliId: body.cliId !== undefined ? String(body.cliId || "") || null : prev.cliId || null,
    model: body.model !== undefined ? String(body.model || "") || null : prev.model || null,
    effort:
      body.effort !== undefined
        ? String(body.effort || "") || "default"
        : prev.effort || "default",
    taskMode:
      body.taskMode !== undefined
        ? normalizeTaskMode(body.taskMode)
        : normalizeTaskMode(prev.taskMode),
    accessMode:
      body.accessMode !== undefined
        ? normalizeAccessMode(body.accessMode)
        : normalizeAccessMode(prev.accessMode),
    modelPrefs:
      body.modelPrefs !== undefined
        ? body.modelPrefs
        : prev.modelPrefs || {},
    updatedAt: new Date().toISOString(),
  };

  if (body.subagents !== undefined && body.subagents && typeof body.subagents === "object") {
    config.agent.subagents = body.subagents;
  } else if (prev.subagents) {
    config.agent.subagents = prev.subagents;
  }
  if (body.judge !== undefined && body.judge && typeof body.judge === "object") {
    config.agent.judge = {
      enabled: Boolean(body.judge.enabled),
      cliId: body.judge.cliId !== undefined ? String(body.judge.cliId || "") || null : prev.judge?.cliId || null,
      model: body.judge.model !== undefined ? String(body.judge.model || "") || null : prev.judge?.model || null,
      trigger: normalizeJudgeTrigger(body.judge.trigger ?? prev.judge?.trigger),
    };
  } else if (prev.judge) {
    config.agent.judge = prev.judge;
  }
  if (prev.opencodeSession && body.opencodeSession === undefined) {
    config.agent.opencodeSession = prev.opencodeSession;
  }

  config.panel = { ...prevPanel };
  if (body.demandQueueParallel !== undefined) {
    config.panel.demandQueueParallel = Boolean(body.demandQueueParallel);
  }
  if (body.maxConcurrentTasks !== undefined) {
    const parsed = Number(body.maxConcurrentTasks);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.panel.maxConcurrentTasks = Math.min(Math.floor(parsed), 32);
    }
  }

  config.byok = { ...prevByok };
  if (body.anthropicKey !== undefined && String(body.anthropicKey).trim()) {
    config.byok.anthropic = String(body.anthropicKey).trim();
  }
  if (body.openaiKey !== undefined && String(body.openaiKey).trim()) {
    config.byok.openai = String(body.openaiKey).trim();
  }
  if (body.cursorKey !== undefined && String(body.cursorKey).trim()) {
    config.byok.cursor = String(body.cursorKey).trim();
  }
  if (body.clearAnthropic) delete config.byok.anthropic;
  if (body.clearOpenai) delete config.byok.openai;
  if (body.clearCursor) delete config.byok.cursor;

  writePanelConfig(config);
  return getAgentSettings();
}

function pickCliId(explicit) {
  const available = scanCli({ quick: true });
  if (explicit) {
    const hit = available.find((c) => c.id === explicit && c.installed);
    if (hit) return hit.id;
  }
  const config = readPanelConfig();
  const preferred = config.agent?.cliId;
  if (preferred) {
    const hit = available.find((c) => c.id === preferred && c.installed);
    if (hit) return hit.id;
  }
  for (const id of DEFAULT_ORDER) {
    const hit = available.find((c) => c.id === id && c.installed);
    if (hit) return hit.id;
  }
  return null;
}

function transcript(thread, options = {}) {
  const maxMessages = Number(options.maxMessages) || 8;
  const maxChars = Number(options.maxChars) || 8000;
  const messages = thread.messages || [];
  if (!messages.length) return "";

  const omitted = Math.max(0, messages.length - maxMessages);
  const slice = messages.slice(-maxMessages);
  let body = slice
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}:\n${m.content || ""}`)
    .join("\n\n");

  if (body.length > maxChars) {
    body = body.slice(body.length - maxChars);
    const firstBreak = body.indexOf("\n\n");
    if (firstBreak > 0 && firstBreak < 400) {
      body = body.slice(firstBreak + 2);
    }
    body = `[Earlier transcript truncated]\n\n${body}`;
  }

  if (omitted > 0) {
    return `${omitted} earlier message(s) omitted.\n\n${body}`;
  }
  return body;
}

function workspaceInstruction(root) {
  const literalRoot = String(root || "").replace(/'/g, "''");
  return [
    "You are working inside the selected repository below.",
    `Authoritative workspace: ${root}`,
    "The CLI process is started with this repository as its working directory.",
    "On Windows PowerShell, square brackets in a path are literal characters, not wildcards.",
    `Before the first file operation, run: Set-Location -LiteralPath '${literalRoot}'`,
    "Use -LiteralPath whenever passing this workspace path to PowerShell, then verify with Get-Location.",
    "Keep user-facing progress human: do not mention CLI, shell, process startup, or raw commands.",
    'Say "Consultando as memórias…" / "Utilizando o FxMind MCP" — never narrate grep or bash.',
    "MANDATORY: use fxmind MCP tools for discovery, gates, graph, FiveM, and DB — this project is optimized for them.",
    "Read the attached FxMind context file (preloaded fxmind_query). Never repo-wide grep/rg/Select-String for Gate B.",
    "Pass repository-relative paths from FxMind memories/query to reader. Do not prefix the workspace root, use wildcard directory reads, or trigger external_directory for this repository.",
    "If fxmind MCP tools are missing from your tool list, stop and ask the user to enable fxmind MCP.",
  ].join("\n");
}

function spawnCli(bin, args, cwd, env = {}, stdio = ["ignore", "pipe", "pipe"]) {
  const opts = {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio,
  };
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    return spawn("cmd.exe", ["/d", "/s", "/c", bin, ...args], opts);
  }
  return spawn(bin, args, opts);
}

function buildEnv() {
  const config = readPanelConfig();
  const byok = config.byok || {};
  const env = {};
  if (byok.anthropic) env.ANTHROPIC_API_KEY = byok.anthropic;
  if (byok.openai) env.OPENAI_API_KEY = byok.openai;
  if (byok.cursor) env.CURSOR_API_KEY = byok.cursor;
  else if (process.env.CURSOR_API_KEY) env.CURSOR_API_KEY = process.env.CURSOR_API_KEY;
  if (!env.CURSOR_API_KEY) {
    const session = cursorSessionAuth();
    if (session) env.CURSOR_AUTH_TOKEN = session;
  }
  return env;
}

function gatesForCurrentRun(raw, gates) {
  if (!raw || !gates || typeof gates !== "object") return gates;
  const startedAt = raw._runStartedAtMs || Date.parse(raw.runStartedAt || "") || 0;
  const previousSession = String(raw._gateSession || "");
  const currentSession = String(gates.session || "");
  const newSession = Boolean(previousSession && currentSession && previousSession !== currentSession);
  const stored = gates.gates && typeof gates.gates === "object" ? gates.gates : {};
  const fresh = Object.fromEntries(
    Object.entries(stored).filter(([, value]) => {
      if (newSession) return true;
      const at = value && typeof value === "object" ? Date.parse(value.at || "") : NaN;
      return Number.isFinite(at) && (!startedAt || at >= startedAt);
    }),
  );
  const streamGates = raw.gates?.gates && typeof raw.gates.gates === "object" ? raw.gates.gates : {};
  const merged = { ...fresh, ...streamGates };
  return {
    ...gates,
    taskActive: newSession ? Boolean(gates.taskActive) : Boolean(gates.taskActive && Object.keys(merged).length),
    gates: merged,
  };
}

function refreshRunMeta(threadId, root, force = false) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw || !root) return;
  const now = Date.now();
  if (!force && raw._lastGatesAt && now - raw._lastGatesAt < 2000) return;
  raw._lastGatesAt = now;
  try {
    threads.setGates(threadId, gatesForCurrentRun(raw, tools.gateStatus(root)));
  } catch {
    /* ignore */
  }
}

function startOpencodeLogTail(threadId, root) {
  const logFile = path.join(os.homedir(), ".local", "share", "opencode", "log", "opencode.log");
  let offset = 0;
  try {
    offset = fs.statSync(logFile).size;
  } catch {
    return () => {};
  }
  const seen = new Set();
  const rootNorm = String(root || "").replace(/[\\/]+/g, "\\").toLowerCase();
  let runId = null;
  const timer = setInterval(() => {
    try {
      const size = fs.statSync(logFile).size;
      if (size <= offset) return;
      const readLen = Math.min(size - offset, 256 * 1024);
      const buf = Buffer.alloc(readLen);
      const fd = fs.openSync(logFile, "r");
      fs.readSync(fd, buf, 0, readLen, offset);
      fs.closeSync(fd);
      offset += readLen;
      const chunk = buf.toString("utf8");
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.includes("message=")) continue;
        const fields = stream.parseOpencodeLogLine(line);
        if (!fields) continue;
        if (fields.cwd) {
          const cwdNorm = String(fields.cwd).replace(/[\\/]+/g, "\\").toLowerCase();
          if (rootNorm && cwdNorm && cwdNorm !== rootNorm && !cwdNorm.endsWith(rootNorm) && !rootNorm.endsWith(cwdNorm)) {
            continue;
          }
          if (fields.run) runId = fields.run;
        }
        if (runId && fields.run && fields.run !== runId) continue;
        if (!runId && fields.run) runId = fields.run;
        const events = stream.eventsFromOpencodeLogLine(line);
        for (const event of events) {
          const key = `${event.kind}:${event.label}:${event.detail}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (seen.size > 400) seen.clear();
          threads.applyStreamEvent(threadId, event);
        }
      }
    } catch {
      /* ignore missing/locked log */
    }
  }, 400);
  return () => clearInterval(timer);
}

function ingestCliLine(line, threadId, cliId, root) {
  const events = stream.parseLineEnriched(line, cliId);
  for (const event of events) {
    if (event.kind === "session" && event.sessionId) {
      const raw = threads.getThreadRaw(threadId);
      if (raw && raw._cliSession !== event.sessionId) {
        raw._cliSession = event.sessionId;
        const config = readPanelConfig();
        config.agent = config.agent || {};
        if (config.agent.opencodeSession !== event.sessionId) {
          config.agent.opencodeSession = event.sessionId;
          writePanelConfig(config);
        }
      }
      continue;
    }
    threads.applyStreamEvent(threadId, event);
  }
  refreshRunMeta(threadId, root);
}

function visibleDiffFiles(diff) {
  return (diff?.files || []).filter((file) => !gitDiff.isFxmindNoisePath(file.path));
}

function promoteToReviewIfNeeded(threadId, diff) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw || raw.phase === "committed" || raw.phase === "pushed") return;
  if (!["done", "paused", "error"].includes(raw.status)) return;
  if (!visibleDiffFiles(diff).length) return;
  if (raw.phase !== "review") threads.setPhase(threadId, "review");
}

function collectThreadDiff(raw, root) {
  if (!raw || !root) return { ok: false, error: "no project root", files: [] };
  return raw.worktree?.path
    ? taskGit.collectTaskDiff(root, raw.worktree.baseBranch)
    : gitDiff.collect(root);
}

function refreshThreadDiff(threadId) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return null;
  if (["running", "queued", "waiting"].includes(raw.status)) return raw.diff || null;
  const root = raw.worktree?.path || raw.projectRoot;
  if (!root) return raw.diff || null;
  try {
    const diff = collectThreadDiff(raw, root);
    threads.setDiff(threadId, diff);
    promoteToReviewIfNeeded(threadId, diff);
    return diff;
  } catch {
    return raw.diff || null;
  }
}

function finalizeRun(threadId, root) {
  const raw = threads.getThreadRaw(threadId);
  try {
    const diff = collectThreadDiff(raw, root);
    threads.setDiff(threadId, diff);
    promoteToReviewIfNeeded(threadId, diff);
  } catch {
    /* ignore */
  }
  refreshRunMeta(threadId, root, true);
}

function formatQueryAnswer(result) {
  if (!result || !result.ok) {
    return `Não consegui responder a partir do grafo de conhecimento: ${
      result?.error || "erro desconhecido"
    }.`;
  }
  const memories = Array.isArray(result.memories) ? result.memories : [];
  if (!memories.length) {
    return result.note
      ? `Nenhuma memória relevante encontrada no grafo para essa pergunta.\n\n${result.note}`
      : "Nenhuma memória relevante encontrada no grafo para essa pergunta.";
  }
  const lines = [
    "_Resposta instantânea a partir do grafo de conhecimento — nenhum agente foi executado._",
    "",
  ];
  for (const mem of memories) {
    lines.push(`### ${mem.topic || mem.slug || "memória"}`);
    if (mem.content) lines.push(String(mem.content).slice(0, 2000));
    lines.push("");
  }
  if (result.graphStale) {
    lines.push("_(grafo desatualizado — uma reconstrução pode estar rodando em segundo plano)_");
  }
  return lines.join("\n").trim();
}

/**
 * Query mode's fast path: answers straight from the knowledge graph
 * (tools.queryGraph) without spawning any CLI. Mirrors what /api/projects/:id/query
 * already does for the standalone Query page, but delivered as a thread
 * message so it fits the same chat UI as task/plan runs.
 */
async function answerFromGraph(threadId, options = {}) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, error: "thread not found" };
  const root = raw.worktree?.path || raw.projectRoot || process.cwd();
  const prompt = threads.lastUserContent(raw);
  threads.setRunning(threadId, { cliId: null });
  let result;
  try {
    result = tools.queryGraph(root, prompt, { budget: Number(options.budget) || 1500 });
  } catch (err) {
    threads.finishAssistant(threadId, { error: String(err.message || err) });
    notifyThreadDone(threadId);
    return { ok: false, error: String(err.message || err) };
  }
  threads.appendAssistantDelta(threadId, formatQueryAnswer(result));
  threads.finishAssistant(threadId, {});
  notifyThreadDone(threadId);
  return { ok: true };
}

/**
 * Picks a provider for the judge that is, whenever possible, DIFFERENT from
 * the one that executed the task — the whole point is cross-provider review,
 * not the same model re-reading its own work (that's already covered by the
 * prompt-level `/fxmind judge` self-critique). Falls back to the primary
 * provider only if no other installed CLI is available, rather than skipping
 * the review entirely.
 */
function judgeCliCandidate(explicitCliId, primaryCliId) {
  const available = scanCli({ quick: true });
  if (explicitCliId) {
    const hit = available.find((c) => c.id === explicitCliId && c.installed);
    if (hit) return hit.id;
  }
  for (const id of DEFAULT_ORDER) {
    if (id === primaryCliId) continue;
    const hit = available.find((c) => c.id === id && c.installed);
    if (hit) return hit.id;
  }
  return pickCliId(primaryCliId);
}

/**
 * Generic "-p"/"exec"/"run" invocation shared by any secondary (non-primary)
 * CLI call on a thread's repo — used by both the judge run and the
 * cross-provider subagent runner, since both just need "spawn this provider
 * with a text body and get text back", not the full transcript/session
 * machinery of runThreadDirect.
 */
function buildJudgeArgs(cliId, { root, body, accessArgs, execOpts }) {
  const trimmed = body.slice(0, 12000);
  if (cliId === "opencode") {
    const args = ["run", "--dir", root, "--format", "json", ...accessArgs];
    if (execOpts.model) args.push("--model", execOpts.model);
    if (execOpts.variant) args.push("--variant", execOpts.variant);
    args.push(trimmed);
    return { args, stdinPrompt: null };
  }
  if (cliId === "codex") {
    return { args: ["exec", "--cd", root, "--json", ...accessArgs, "-"], stdinPrompt: trimmed };
  }
  if (cliId === "claude") {
    let args = ["-p", trimmed];
    if (execOpts.model) args = ["--model", execOpts.model, ...args];
    return { args, stdinPrompt: null };
  }
  if (cliId === "cursor-agent") {
    return { args: ["-p", ...accessArgs, "--workspace", root, trimmed], stdinPrompt: null };
  }
  return { args: ["-p", trimmed], stdinPrompt: null };
}

function cleanupJudgeFile(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* best effort */
  }
}

/**
 * Runs a second, read-only CLI pass reviewing the primary run's diff/report
 * on the same thread. Deliberately does not touch thread.status/messages —
 * lives entirely in raw.runs[] so it can't interfere with the primary run's
 * own state (composer, tabs, etc. only look at thread.status).
 */
async function runJudge(threadId, options = {}) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, error: "thread not found" };
  const root = raw.worktree?.path || raw.projectRoot || process.cwd();
  const primaryCliId = raw._cliId || raw.cliId || null;
  const judgeCliId = judgeCliCandidate(options.cliId, primaryCliId);
  if (!judgeCliId) return { ok: false, error: "no cli available for judge" };
  const entry = CLI_CATALOG.find((c) => c.id === judgeCliId);
  const bin = resolveBin(entry);
  if (!bin) return { ok: false, error: "judge cli not installed" };

  const lastUser = threads.lastUserContent(raw);
  const lastAssistant = [...(raw.messages || [])].reverse().find((m) => m.role === "assistant");
  const diffText = visibleDiffFiles(raw.diff)
    .map((f) => `${f.status} ${f.path}`)
    .join("\n");

  let contextFile;
  try {
    contextFile = buildJudgeContextFile(root, threadId, {
      userPrompt: lastUser,
      primaryOutput: lastAssistant?.content || "",
      diff: diffText,
    });
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }

  const run = panelRuns.createRun(raw, {
    kind: "judge",
    cliId: judgeCliId,
    accessMode: "ask",
  });
  threads.touchThread(threadId);

  const accessArgs = cliAccessArgs(judgeCliId, "ask");
  const execOpts = selectedExecution(judgeCliId);
  const body = fs.readFileSync(contextFile, "utf8");
  const { args, stdinPrompt } = buildJudgeArgs(judgeCliId, { root, body, accessArgs, execOpts });

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnCli(
        bin,
        args,
        root,
        buildEnv(),
        judgeCliId === "codex" ? ["pipe", "pipe", "pipe"] : undefined,
      );
    } catch (err) {
      cleanupJudgeFile(contextFile);
      panelRuns.updateRun(raw, run.id, {
        status: "error",
        endedAt: new Date().toISOString(),
        verdict: { verdict: "unverifiable", summary: String(err.message || err) },
      });
      threads.touchThread(threadId);
      resolve({ ok: false, error: String(err.message || err) });
      return;
    }

    let stdout = "";
    let textOut = "";
    if (child.stdout) child.stdout.setEncoding("utf8");
    if (child.stderr) child.stderr.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        try {
          for (const event of stream.parseLineEnriched(line, judgeCliId)) {
            if (event.kind === "text" && event.text) textOut += event.text;
          }
        } catch {
          /* not every line is structured JSON (claude/hermes stream plain text) */
        }
      }
    });
    child.stderr?.on("data", () => {});
    if (stdinPrompt && child.stdin) {
      child.stdin.write(stdinPrompt);
      child.stdin.end();
    }

    child.on("error", (err) => {
      cleanupJudgeFile(contextFile);
      panelRuns.updateRun(raw, run.id, {
        status: "error",
        endedAt: new Date().toISOString(),
        verdict: { verdict: "unverifiable", summary: String(err.message || err) },
      });
      threads.touchThread(threadId);
      resolve({ ok: false, error: String(err.message || err) });
    });

    child.on("close", () => {
      cleanupJudgeFile(contextFile);
      const finalText = (textOut || stdout).trim();
      const verdict = stream.parseVerdictFromText(finalText);
      panelRuns.updateRun(raw, run.id, {
        status: "done",
        endedAt: new Date().toISOString(),
        message: finalText ? { role: "assistant", content: finalText, at: new Date().toISOString() } : null,
        verdict,
      });
      threads.touchThread(threadId);
      resolve({ ok: true, verdict });
    });
  });
}

const SUBAGENT_TEMPLATE_DIR = path.join(PACKAGE_ROOT, "templates", "opencode", "agents");
const SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Reads a subagent's persona straight from the same templates OpenCode's own
 * native subagents install from (fxmind/templates/opencode/agents/<id>.md) —
 * one source of truth for what "explore"/"reader"/"general"/"scout" mean,
 * regardless of which CLI ends up running it. The OpenCode-specific
 * `permission:` YAML isn't understood by other providers, so we only read
 * the two flags that matter for access control (edit/bash deny) and the
 * markdown body (the actual instructions).
 */
function readSubagentPersona(agentId) {
  const file = path.join(SUBAGENT_TEMPLATE_DIR, `${agentId}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { denyEdit: false, denyBash: false, body: raw.trim() };
  const [, frontmatter, body] = match;
  return {
    denyEdit: /edit:\s*deny/.test(frontmatter),
    denyBash: /bash:\s*deny/.test(frontmatter),
    body: body.trim(),
  };
}

function subagentConfigFor(agentId) {
  const config = readPanelConfig();
  const entry = config.agent?.subagents?.[agentId] || {};
  return {
    cliId: entry.cliId || null,
    model: entry.model || null,
    variant: entry.variant || null,
  };
}

function buildSubagentBody(agentId, persona, { prompt, paths } = {}) {
  const lines = [
    `# FxMind subagent: ${agentId}`,
    "",
    persona?.body || `You are the "${agentId}" subagent. Perform the scoped task below and stop.`,
    "",
    "## Task",
    String(prompt || "").slice(0, 6000),
  ];
  if (Array.isArray(paths) && paths.length) {
    lines.push("", "## Known paths", paths.map((p) => `- ${p}`).join("\n"));
  }
  return lines.join("\n");
}

/**
 * Runs one scoped subagent task, synchronously, for the `fxmind_subagent_run`
 * MCP tool — the provider-agnostic replacement for OpenCode's own built-in
 * subagent delegation. Any CLI that can call an MCP tool (all of them, since
 * fxmind's whole toolset depends on it) can delegate through here, and the
 * subagent itself can run on a completely different provider than whichever
 * CLI made the call (configured per subagent id in Settings → Subagentes).
 * Read-only personas (explore/reader/scout, per their template's
 * `permission.edit/bash: deny`) are forced to read-only access regardless of
 * the panel's configured accessMode — same "server decides" rule used for
 * plan mode and judge runs.
 */
async function runSubagentTask(root, options = {}) {
  const agentId = String(options.agent || "").trim() || "general";
  const cfg = subagentConfigFor(agentId);
  const config = readPanelConfig();
  const cliId = judgeCliCandidate(cfg.cliId, null);
  if (!cliId) return { ok: false, error: "no cli available for subagent" };
  const entry = CLI_CATALOG.find((c) => c.id === cliId);
  const bin = resolveBin(entry);
  if (!bin) return { ok: false, error: `subagent cli "${cliId}" not installed` };

  const persona = readSubagentPersona(agentId);
  const forceReadOnly = Boolean(persona?.denyEdit || persona?.denyBash);
  const accessMode = forceReadOnly ? "ask" : normalizeAccessMode(config.agent?.accessMode);
  const accessArgs = cliAccessArgs(cliId, accessMode);
  const resolved = resolveExecution(cliId, cfg.model, null);
  const execOpts = { ...resolved, variant: cfg.variant || resolved.variant };
  const body = buildSubagentBody(agentId, persona, { prompt: options.prompt, paths: options.paths });
  const { args, stdinPrompt } = buildJudgeArgs(cliId, { root, body, accessArgs, execOpts });

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnCli(
        bin,
        args,
        root,
        buildEnv(),
        cliId === "codex" ? ["pipe", "pipe", "pipe"] : undefined,
      );
    } catch (err) {
      resolve({ ok: false, error: String(err.message || err) });
      return;
    }

    let settled = false;
    let stdout = "";
    let textOut = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      terminateCliProcess(child);
      finish({
        ok: false,
        error: `subagent "${agentId}" timed out after ${Math.round(SUBAGENT_TIMEOUT_MS / 1000)}s`,
      });
    }, SUBAGENT_TIMEOUT_MS);

    if (child.stdout) child.stdout.setEncoding("utf8");
    if (child.stderr) child.stderr.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        try {
          for (const event of stream.parseLineEnriched(line, cliId)) {
            if (event.kind === "text" && event.text) textOut += event.text;
          }
        } catch {
          /* plain-text CLIs (claude/hermes) don't emit structured JSON lines */
        }
      }
    });
    child.stderr?.on("data", () => {});
    if (stdinPrompt && child.stdin) {
      child.stdin.write(stdinPrompt);
      child.stdin.end();
    }

    child.on("error", (err) => finish({ ok: false, error: String(err.message || err) }));
    child.on("close", () => {
      const finalText = (textOut || stdout).trim();
      finish({
        ok: true,
        agent: agentId,
        cliId,
        output: finalText || "(subagent returned no text)",
      });
    });
  });
}

async function testCli(cliId) {
  const entry = CLI_CATALOG.find((c) => c.id === cliId);
  if (!entry) return { ok: false, error: "unknown cli" };
  const bin = resolveBin(entry);
  if (entry.id === "cursor-agent" && !bin && cursorHostModeAvailable()) {
    return { ok: true, version: "chat host" };
  }
  if (!bin) return { ok: false, error: "not installed" };
  if (entry.id === "cursor-agent") {
    const auth = testCursorAuth(bin);
    if (!auth.ok) return { ok: false, error: auth.message };
  }
  if (entry.id === "codex") {
    const auth = testCodexAuth(bin, { force: true });
    if (!auth.ok) return { ok: false, error: auth.message };
  }
  const version = runVersion(bin, entry.id === "cursor-agent" ? ["--version"] : ["--version"]);
  return { ok: true, version: version || "ok" };
}

async function runThreadDirect(threadId, options = {}) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, error: "thread not found" };
  if (raw.status === "running") return { ok: false, error: "already running" };
  if (raw.status !== "queued") return { ok: false, error: "not queued" };

  // Defense in depth: query mode never spawns a CLI, no matter which path
  // reached here (normal dispatch already short-circuits before this call).
  if (raw.mode === "query") {
    return answerFromGraph(threadId);
  }

  if (usesHostCursorAgent(options.cliId)) {
    const host = threads.hostStatus();
    if (!host.connected) {
      const message =
        "Nenhum chat Cursor conectado ao painel. Abra com `/fxmind painel` neste chat do Cursor, ou adicione CURSOR_API_KEY em Settings → Execução.";
      threads.appendAssistantDelta(threadId, message);
      threads.finishAssistant(threadId, { error: "host_not_connected" });
      notifyThreadDone(threadId);
      return { ok: false, error: "host_not_connected" };
    }
    return {
      ok: true,
      mode: "host",
      root: raw.worktree?.path || raw.projectRoot || process.cwd(),
    };
  }

  const cliId = pickCliId(options.cliId);
  if (!cliId) {
    threads.setRunning(threadId, { cliId: null });
    threads.appendAssistantDelta(
      threadId,
      "Nenhuma CLI instalada. Abra Settings → Execução e modelo, instale OpenCode ou Claude Code, ou faça `agent login` para Cursor Agent.",
    );
    threads.finishAssistant(threadId, { error: "no_cli" });
    notifyThreadDone(threadId);
    return { ok: false, error: "no_cli" };
  }

  const entry = CLI_CATALOG.find((c) => c.id === cliId);
  const bin = resolveBin(entry);
  if (!bin) {
    threads.finishAssistant(threadId, { error: "cli missing" });
    notifyThreadDone(threadId);
    return { ok: false, error: "cli missing" };
  }

  const projectRoot = raw.projectRoot || process.cwd();
  // New conversations run in the selected repository directly. Existing
  // persisted threads with a worktree continue using their isolated path.
  const root = raw.worktree?.path || projectRoot;
  const lastMsg = threads.lastUserMessage(raw);
  const prompt = lastMsg?.content || threads.lastUserContent(raw);
  const imagePaths = threads.materializeAttachments(lastMsg?.attachments, threadId);
  const config = readPanelConfig();
  let contextFile;
  try {
    const taskMode = normalizeTaskMode(config.agent?.taskMode);
    contextFile = writeContextTemp(root, prompt, threadId, {
      imagePaths,
      taskMode,
      mode: raw.mode,
    });
    scheduleGraphRebuildBackground(root);
  } catch (err) {
    threads.finishAssistant(threadId, { error: String(err.message || err) });
    notifyThreadDone(threadId);
    return { ok: false, error: String(err.message) };
  }

  raw._runStartedAtMs = Date.now();
  try {
    raw._gateSession = String(tools.gateStatus(root).session || "");
  } catch {
    raw._gateSession = "";
  }
  threads.setRunning(threadId, { cliId });
  raw._cliId = cliId;
  raw._lastActivityAt = Date.now();
  raw._gitSnap = raw.worktree
    ? taskGit.collectTaskDiff(root, raw.worktree.baseBranch)
    : gitDiff.snapshot(root);
  threads.applyStreamEvent(threadId, {
    kind: "cli",
    label: `CLI: ${entry.name} iniciado`,
    detail: selectedExecution(cliId).model || "",
    status: "running",
  });

  if (cliId === "opencode" && !raw._cliSession) {
    if (config.agent?.opencodeSession) {
      raw._cliSession = config.agent.opencodeSession;
    }
  }

  // The server never trusts the client's saved access-mode preference for a
  // plan run: regardless of what accessMode is configured, plan mode is
  // always read-only. See fxmind/templates/fxmind/modes for the prompt side.
  const accessMode =
    raw.mode === "plan" ? "ask" : normalizeAccessMode(config.agent?.accessMode);
  const accessArgs = cliAccessArgs(cliId, accessMode);

  let args;
  let stdinPrompt = null;
  const execOpts = selectedExecution(cliId);
  if (cliId === "opencode") {
    const userMessage =
      `${workspaceInstruction(root)}\n\n${
        prompt || "Use the attached FxMind context file and help with this project."
      }`;
    args = ["run", "--dir", root, "--format", "json", ...accessArgs];
    if (execOpts.model) args.push("--model", execOpts.model);
    if (execOpts.variant) args.push("--variant", execOpts.variant);
    if (raw._cliSession) args.push("--session", raw._cliSession);
    // OpenCode treats positionals after --file as file paths; message must come first.
    args.push(
      `${userMessage}\n\n## Thread transcript\n${transcript(raw)}`,
      "--file",
      contextFile.replace(/\\/g, "/"),
    );
    for (const img of imagePaths) {
      args.push("--file", img.path.replace(/\\/g, "/"));
    }
  } else if (cliId === "claude") {
    const body = [
      workspaceInstruction(root),
      "",
      "Read the FxMind context file and respond to the latest user message.",
      "",
      fs.readFileSync(contextFile, "utf8"),
      "",
      "## Thread",
      transcript(raw),
    ].join("\n");
    args = ["-p", body.slice(0, 12000)];
    if (execOpts.model) args = ["--model", execOpts.model, ...args];
    if (execOpts.claudeEffort) args = ["--effort", execOpts.claudeEffort, ...args];
  } else if (cliId === "hermes") {
    args = [
      "-p",
      `${workspaceInstruction(root)}\n\n${fs.readFileSync(contextFile, "utf8")}\n\n${transcript(raw)}`.slice(
        0,
        12000,
      ),
    ];
  } else if (cliId === "codex") {
    const body = [
      workspaceInstruction(root),
      "",
      prompt || "Use the FxMind context and help with this project.",
      "",
      fs.readFileSync(contextFile, "utf8"),
      "",
      "## Thread",
      transcript(raw),
    ].join("\n");
    args = ["exec", "--cd", root, "--json", ...accessArgs];
    if (execOpts.model) args.push("-m", execOpts.model);
    if (execOpts.effort && execOpts.effort !== "default") {
      args.push("-c", `model_reasoning_effort=${JSON.stringify(execOpts.effort)}`);
    }
    // Codex accepts "-" as the prompt source. Sending the body through stdin
    // avoids Windows cmd.exe argument-length limits for context and history.
    args.push("-");
    stdinPrompt = body.slice(0, 12000);
  } else if (cliId === "cursor-agent") {
    args = [
      "-p",
      ...accessArgs,
      "--workspace",
      root,
    ];
    if (execOpts.model) args.push("--model", execOpts.model);
    args.push(`${workspaceInstruction(root)}\n\nRead ${contextFile} then complete the user request:\n${prompt}`);
  } else {
    args = [
      "-p",
      ...accessArgs,
      "--workspace",
      root,
      `${workspaceInstruction(root)}\n\nRead ${contextFile} then complete the user request:\n${prompt}`,
    ];
  }

  return new Promise((resolve) => {
    const stopWatchdog = startRunWatchdog(threadId);
    const child = spawnCli(
      bin,
      args,
      root,
      buildEnv(),
      cliId === "codex" ? ["pipe", "pipe", "pipe"] : undefined,
    );
    raw._child = child;
    let stderr = "";
    let stdoutBuf = "";
    const stopLogTail = cliId === "opencode" ? startOpencodeLogTail(threadId, root) : () => {};
    raw._stopLogTail = stopLogTail;

    if (child.stdout) child.stdout.setEncoding("utf8");
    if (child.stderr) child.stderr.setEncoding("utf8");
    child.stdout?.on("data", (buf) => {
      const text = String(buf);
      if (cliId === "opencode" || cliId === "codex") {
        stdoutBuf += text;
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          ingestCliLine(line, threadId, cliId, root);
        }
      } else if (text) {
        ingestCliLine(text, threadId, cliId, root);
      }
    });

    child.stderr?.on("data", (buf) => {
      stderr += String(buf);
      const chunk = String(buf);
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        threads.applyStreamEvent(threadId, {
          kind: "cli",
          label: "CLI",
          detail: line.slice(0, 240),
          status: "running",
        });
      }
    });

    if (stdinPrompt && child.stdin) {
      child.stdin.end(`${stdinPrompt}\n`);
    }

    child.on("error", (err) => {
      stopWatchdog();
      if (raw._pauseRequested) {
        raw._pauseFinalized = true;
        stopLogTail();
        cleanup(contextFile, raw);
        finalizeRun(threadId, root);
        threads.markPaused(threadId);
        notifyThreadDone(threadId);
        resolve({ ok: true, paused: true });
        return;
      }
      if (raw._stopRequested) {
        raw._stopFinalized = true;
        stopLogTail();
        cleanup(contextFile, raw);
        finalizeRun(threadId, root);
        if (threads.getThreadRaw(threadId)?.status === "running") {
          threads.cancelThread(threadId);
        }
        notifyThreadDone(threadId);
        resolve({ ok: false, error: "Execução interrompida pelo usuário." });
        return;
      }
      stopLogTail();
      cleanup(contextFile, raw);
      finalizeRun(threadId, root);
      threads.finishAssistant(threadId, { error: String(err.message || err) });
      notifyThreadDone(threadId);
      resolve({ ok: false, error: String(err.message || err) });
    });

    child.on("close", (code) => {
      stopWatchdog();
      if (raw._stopFinalized) return;
      if (raw._pauseFinalized) return;
      const wasStopped = raw._stopRequested;
      const wasPaused = raw._pauseRequested;
      stopLogTail();
      if (!wasStopped && (cliId === "opencode" || cliId === "codex") && stdoutBuf.trim()) {
        ingestCliLine(stdoutBuf.trim(), threadId, cliId, root);
      }
      cleanup(contextFile, raw);
      finalizeRun(threadId, root);
      if (wasPaused) {
        raw._pauseFinalized = true;
        threads.markPaused(threadId);
        notifyThreadDone(threadId);
        resolve({ ok: true, paused: true });
        return;
      }
      if (wasStopped) {
        raw._stopFinalized = true;
        threads.cancelThread(threadId);
        notifyThreadDone(threadId);
        resolve({ ok: false, error: "Execução interrompida pelo usuário." });
        return;
      }
      const snapshot = threads.getThread(threadId).thread;
      const hasAssistant = (snapshot?.messages || []).some(
        (m) => m.role === "assistant" && String(m.content || "").trim(),
      );
      if (code !== 0 && !hasAssistant) {
        const errText = formatCursorCliError(
          cliId === "cursor-agent" ? stderr.trim() : stderr.trim() ||
            "CLI falhou. Verifique login (Settings → Execução) ou instale a CLI escolhida.",
        );
        threads.finishAssistant(threadId, { error: errText });
        notifyThreadDone(threadId);
        resolve({ ok: false, error: errText });
        return;
      }
      threads.finishAssistant(threadId);
      notifyThreadDone(threadId);
      resolve({ ok: true, cliId });
    });
  });
}

function scheduleThread(threadId, options = {}) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return Promise.resolve({ ok: false, error: "thread not found" });
  if (raw.status === "running") return Promise.resolve({ ok: false, error: "already running" });
  if (raw.status !== "queued") return Promise.resolve({ ok: false, error: "not queued" });
  if (scheduledThreads.has(threadId)) {
    return Promise.resolve({ ok: true, queued: true, duplicate: true });
  }
  if (activeThreads.size >= concurrencyLimit()) {
    return Promise.resolve({ ok: true, queued: true, limit: concurrencyLimit() });
  }

  scheduledThreads.add(threadId);
  activeThreads.add(threadId);
  return Promise.resolve(runThreadDirect(threadId, options)).finally(() => {
    scheduledThreads.delete(threadId);
    activeThreads.delete(threadId);
    pumpScheduler();
  });
}

function cleanup(contextFile, raw) {
  if (typeof raw._stopLogTail === "function") {
    try {
      raw._stopLogTail();
    } catch {
      /* ignore */
    }
    delete raw._stopLogTail;
  }
  delete raw._child;
  try {
    fs.unlinkSync(contextFile);
  } catch {
    /* ignore */
  }
}

function killThread(threadId) {
  const raw = threads.getThreadRaw(threadId);
  if (raw?._child && typeof raw._child.kill === "function") {
    try {
      terminateCliProcess(raw._child);
    } catch {
      /* ignore */
    }
  }
}

function terminateCliProcess(child) {
  if (process.platform === "win32" && child?.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {
      /* fall back to the child process handle */
    }
  }
  if (child && typeof child.kill === "function") child.kill();
}

function stopThread(threadId) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, status: 404, error: "thread not found" };
  if (raw.status !== "running") {
    return { ok: false, status: 409, error: "thread is not running" };
  }

  raw._stopRequested = true;
  const child = raw._child;
  if (child) {
    terminateCliProcess(child);
    return { ok: true, stopping: true, thread: threads.publicThread(raw) };
  }

  const result = threads.cancelThread(threadId);
  notifyThreadDone(threadId);
  return result;
}

function pauseThread(threadId) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, status: 404, error: "thread not found" };
  if (!["running", "queued", "waiting"].includes(raw.status)) {
    return { ok: false, status: 409, error: "thread cannot be paused" };
  }

  raw._pauseRequested = true;
  const result = threads.markPaused(threadId);
  const child = raw._child;
  if (child) {
    terminateCliProcess(child);
    return { ...result, pausing: true };
  }
  notifyThreadDone(threadId);
  return result;
}

function resumeThread(threadId, options = {}) {
  const result = threads.resumeThread(threadId);
  if (!result.ok) return result;
  setImmediate(() => {
    dispatchThread(threadId, options).catch(() => {});
  });
  return { ...result, scheduled: true };
}

function discardThreadFile(threadId, relPath) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, status: 404, error: "thread not found" };
  if (raw.status === "running" || raw.status === "waiting") {
    return { ok: false, status: 409, error: "thread is still running" };
  }
  const root = raw.worktree?.path || raw.projectRoot;
  if (!root) {
    return { ok: false, status: 400, error: "thread project root is unavailable" };
  }
  const discarded = gitDiff.discardPath(root, relPath);
  if (!discarded.ok) return discarded;
  const diff = raw.worktree?.path
    ? taskGit.collectTaskDiff(root, raw.worktree.baseBranch)
    : gitDiff.collect(root);
  threads.setDiff(threadId, diff);
  return { ok: true, discarded: discarded.discarded, thread: threads.publicThread(raw) };
}

function commitThread(threadId, options = {}) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, status: 404, error: "thread not found" };
  if (["running", "queued", "waiting"].includes(raw.status)) {
    return { ok: false, status: 409, error: "thread is not ready for approval" };
  }
  if (raw.phase === "pushed") {
    return { ok: false, status: 409, error: "thread already pushed" };
  }
  if (raw.phase === "committed") {
    return { ok: false, status: 409, error: "commit already created; use push" };
  }
  const root = raw.worktree?.path || raw.projectRoot;
  if (!root) {
    return { ok: false, status: 400, error: "thread project root is unavailable" };
  }
  if (raw.worktree?.path && !taskGit.isManagedWorktreePath(raw.projectRoot, raw.worktree.path)) {
    return { ok: false, status: 400, error: "thread worktree path is unsafe" };
  }

  const freshDiff = collectThreadDiff(raw, root);
  if (!freshDiff.ok) return freshDiff;
  if (!visibleDiffFiles(freshDiff).length) {
    return { ok: false, status: 409, error: "no changes to commit" };
  }
  threads.setDiff(threadId, freshDiff);
  promoteToReviewIfNeeded(threadId, freshDiff);
  const committed = taskGit.commitTask(root, options.message || raw.title || "FxMind task");
  if (!committed.ok) {
    return { ...committed, thread: threads.publicThread(raw) };
  }

  const recorded = threads.recordCommit(threadId, committed);
  if (!recorded.ok) return recorded;
  let merge = null;
  if (options.mergeToCurrent === true && raw.worktree?.branch) {
    merge = taskGit.mergeTaskToCurrent(raw.projectRoot, raw.worktree.branch);
    if (!merge.ok) {
      return {
        ok: false,
        status: 409,
        error: merge.error,
        committed: true,
        thread: recorded.thread,
      };
    }
  }
  return {
    ok: true,
    committed: true,
    merge,
    thread: recorded.thread,
  };
}

function pushThread(threadId) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, status: 404, error: "thread not found" };
  if (!raw.commits?.length || !["committed", "pushed"].includes(raw.phase)) {
    return { ok: false, status: 409, error: "thread must be committed before pushing" };
  }
  if (raw.phase === "pushed") return { ok: true, pushed: true, thread: threads.publicThread(raw) };
  const root = raw.worktree?.path || raw.projectRoot;
  if (!root) {
    return { ok: false, status: 400, error: "thread project root is unavailable" };
  }
  if (raw.worktree?.path && !taskGit.isManagedWorktreePath(raw.projectRoot, raw.worktree.path)) {
    return { ok: false, status: 400, error: "thread worktree path is unsafe" };
  }
  const pushed = taskGit.pushTask(root, raw.worktree?.branch || null);
  if (!pushed.ok) return pushed;
  const marked = threads.markPushed(threadId);
  return { ...pushed, pushed: true, thread: marked.thread };
}

module.exports = {
  CLI_CATALOG,
  scanCli,
  listCliModels,
  getAgentSettings,
  getJudgeSettings,
  runJudge,
  runSubagentTask,
  readSubagentPersona,
  subagentConfigFor,
  buildSubagentBody,
  normalizeAccessMode,
  cliAccessArgs,
  putAgentSettings,
  pickCliId,
  testCli,
  runThread: scheduleThread,
  dispatchThread,
  answerFromGraph,
  usesHostCursorAgent,
  onThreadCompleted: notifyThreadDone,
  reconcileOrphanedRuns,
  killThread,
  stopThread,
  pauseThread,
  resumeThread,
  discardThreadFile,
  commitThread,
  pushThread,
  refreshThreadDiff,
  cursorAgentPath,
  transcript,
};
