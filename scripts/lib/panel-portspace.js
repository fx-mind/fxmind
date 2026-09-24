/**
 * PortSpace card lifecycle for demand threads.
 *
 * The inbox (GET /external/fxmind/inbox) lives in panel-api. This module
 * closes the loop: claim the card when a demand thread starts, complete it
 * with the pushed commit, and release it when the thread is deleted before
 * a push. Every call uses the personal integration key, so PortSpace applies
 * the key owner's board permissions.
 */

const { execFileSync } = require("child_process");
const { readPanelConfig } = require("./panel-api");

const REQUEST_TIMEOUT_MS = 15_000;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

function portspaceCreds(config = null) {
  const portspace = (config || readPanelConfig()).portspace || {};
  return {
    baseUrl: String(portspace.baseUrl || "").trim().replace(/\/+$/, ""),
    integrationKey: String(portspace.integrationKey || "").trim(),
  };
}

function isPortspaceCard(item = {}) {
  return item?.source === "portspace" && Boolean(String(item.cardId || "").trim());
}

async function portspaceRequest(method, pathname, body = undefined) {
  const { baseUrl, integrationKey } = portspaceCreds();
  if (!baseUrl || !integrationKey) {
    return { ok: false, error: "not_configured", message: "PortSpace não está configurado" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        "x-integration-key": integrationKey,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message = Array.isArray(data?.message)
        ? data.message.join("; ")
        : data?.message || text.slice(0, 200) || res.statusText;
      return { ok: false, status: res.status, error: "upstream_error", message: String(message) };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "timeout" : "network_error",
      message: aborted ? "PortSpace não respondeu a tempo" : String(err?.message || err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function cardPath(cardId, action) {
  return `/external/fxmind/cards/${encodeURIComponent(String(cardId))}/${action}`;
}

function claimCard(cardId) {
  return portspaceRequest("POST", cardPath(cardId, "claim"));
}

function releaseCard(cardId) {
  return portspaceRequest("POST", cardPath(cardId, "release"));
}

function completeCard(cardId, payload = {}) {
  return portspaceRequest("POST", cardPath(cardId, "complete"), payload);
}

function gitOutput(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** Only http(s) remotes without embedded credentials; ssh remotes become https. */
function publicRepoUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const scp = value.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  const candidate = scp ? `https://${scp[1]}/${scp[2]}` : value;
  try {
    const url = new URL(candidate);
    if (url.protocol === "ssh:") url.protocol = "https:";
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\.git\/?$/, "").replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Payload for /complete after a push. The push may rebase the task branch, so
 * the pushed HEAD wins over the hash recorded at commit time.
 */
function buildCompletePayload(thread, push = {}) {
  const root = thread?.worktree?.path || thread?.projectRoot;
  const commits = Array.isArray(thread?.commits) ? thread.commits : [];
  const last = commits[commits.length - 1] || {};
  const head = root ? gitOutput(["rev-parse", "HEAD"], root) : "";
  const commitSha = SHA_RE.test(head) ? head : String(last.hash || "");
  const remote = push.remote || "origin";
  const repoUrl = root ? publicRepoUrl(gitOutput(["remote", "get-url", remote], root)) : null;
  return {
    commitSha,
    commitMessage: String(last.message || thread?.title || "").slice(0, 500) || undefined,
    branch: String(push.branch || thread?.worktree?.branch || last.branch || "") || undefined,
    repoUrl: repoUrl || undefined,
  };
}

function syncResult(action, result) {
  return {
    action,
    ok: Boolean(result?.ok),
    status: result?.status ?? null,
    error: result?.ok ? null : result?.message || result?.error || "erro desconhecido",
    at: new Date().toISOString(),
  };
}

async function completeThreadCard(thread, push = {}) {
  if (!isPortspaceCard({ source: thread?.cardSource, cardId: thread?.cardId })) return null;
  const payload = buildCompletePayload(thread, push);
  if (!SHA_RE.test(payload.commitSha)) {
    return syncResult("complete", { ok: false, message: "commit do push não encontrado" });
  }
  return syncResult("complete", await completeCard(thread.cardId, payload));
}

async function releaseThreadCard(thread) {
  if (!isPortspaceCard({ source: thread?.cardSource, cardId: thread?.cardId })) return null;
  // Already delivered: the card belongs to the test column now.
  if (thread.phase === "pushed") return null;
  return syncResult("release", await releaseCard(thread.cardId));
}

module.exports = {
  isPortspaceCard,
  claimCard,
  releaseCard,
  completeCard,
  publicRepoUrl,
  buildCompletePayload,
  completeThreadCard,
  releaseThreadCard,
  syncResult,
};
