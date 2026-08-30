/**
 * HTTP client from the host agent (MCP) to the local panel process.
 */

function panelOrigin() {
  if (process.env.FXMIND_PANEL_URL) {
    return String(process.env.FXMIND_PANEL_URL).replace(/\/+$/, "");
  }
  const port = process.env.FXMIND_PANEL_PORT || "3847";
  return `http://127.0.0.1:${port}`;
}

async function panelFetch(pathname, opts = {}) {
  const timeout = opts.timeout ?? 8000;
  try {
    const res = await fetch(`${panelOrigin()}${pathname}`, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || res.statusText, status: res.status };
    }
    return data;
  } catch (err) {
    return {
      ok: false,
      error: "panel_offline",
      message: String(err?.message || err),
    };
  }
}

function heartbeat() {
  return panelFetch("/api/host/heartbeat", { method: "POST" });
}

function pending() {
  return panelFetch("/api/host/pending");
}

function wait(timeoutMs = 20_000) {
  const ms = Math.min(Math.max(Number(timeoutMs) || 20_000, 500), 25_000);
  return panelFetch(`/api/host/wait?timeout=${ms}`, { timeout: ms + 2000 });
}

function claim(threadId) {
  return panelFetch("/api/host/claim", {
    method: "POST",
    body: threadId ? { threadId } : { all: true },
  });
}

function reply(threadId, content) {
  return panelFetch(`/api/threads/${encodeURIComponent(threadId)}/reply`, {
    method: "POST",
    body: { content },
  });
}

function fail(threadId, error) {
  return panelFetch(`/api/threads/${encodeURIComponent(threadId)}/fail`, {
    method: "POST",
    body: { error },
  });
}

function activity(threadId, event) {
  return panelFetch(`/api/threads/${encodeURIComponent(threadId)}/activity`, {
    method: "POST",
    body: event,
  });
}

module.exports = {
  panelOrigin,
  panelFetch,
  heartbeat,
  pending,
  wait,
  claim,
  reply,
  fail,
  activity,
};
