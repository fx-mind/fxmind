/**
 * Run Cursor SDK agents for panel chat threads (parallel-safe: one Agent per thread).
 */

const path = require("path");
const threads = require("./panel-threads");
const { getCursorApiKey } = require("./panel-api");

const PACKAGE_ROOT = path.join(__dirname, "../..");
const MCP_SERVER = path.join(PACKAGE_ROOT, "scripts", "mcp-server.js");

async function loadSdk() {
  try {
    return await import("@cursor/sdk");
  } catch {
    return null;
  }
}

function lastUserContent(thread) {
  const users = (thread.messages || []).filter((m) => m.role === "user");
  return users.at(-1)?.content || "";
}

async function runThread(threadId) {
  const raw = threads.getThreadRaw(threadId);
  if (!raw) return { ok: false, error: "thread not found" };
  if (raw.status === "running") return { ok: false, error: "already running" };

  const prompt = lastUserContent(raw);
  if (!prompt) return { ok: false, error: "no user message to send" };

  const apiKey = getCursorApiKey();
  if (!apiKey) {
    threads.setRunning(threadId);
    threads.appendAssistantDelta(
      threadId,
      "Configure a CURSOR_API_KEY em PortSpace/Settings (ou a env CURSOR_API_KEY) para o agente rodar daqui. A demanda já está injetada neste chat — salve a chave e envie de novo.",
    );
    threads.finishAssistant(threadId, {
      error: "missing_cursor_api_key",
    });
    return { ok: false, error: "missing_cursor_api_key" };
  }

  const sdk = await loadSdk();
  if (!sdk?.Agent) {
    threads.setRunning(threadId);
    threads.appendAssistantDelta(
      threadId,
      "Instale o runtime do agente neste pacote: `npm install @cursor/sdk` em `fxmind/`, depois reinicie `fxmind serve`.",
    );
    threads.finishAssistant(threadId, { error: "sdk_not_installed" });
    return { ok: false, error: "sdk_not_installed" };
  }

  const cwd = raw.projectRoot || process.cwd();
  threads.setRunning(threadId);

  try {
    if (!raw._agent) {
      raw._agent = await sdk.Agent.create({
        apiKey,
        model: { id: "composer-2.5" },
        local: { cwd },
        mcpServers: {
          fxmind: {
            type: "stdio",
            command: process.execPath,
            args: [MCP_SERVER],
            env: { FXMIND_TARGET: cwd },
          },
        },
      });
    }

    const run = await raw._agent.send(prompt);
    for await (const event of run.stream()) {
      if (event.type !== "assistant") continue;
      const content = event.message?.content || [];
      for (const block of content) {
        if (block.type === "text" && block.text) {
          threads.appendAssistantDelta(threadId, block.text);
        }
      }
    }
    await run.wait();
    threads.finishAssistant(threadId);
    return { ok: true };
  } catch (err) {
    const message = String(err?.message || err);
    threads.finishAssistant(threadId, { error: message });
    return { ok: false, error: message };
  }
}

module.exports = { runThread, loadSdk };
