"use strict";

/**
 * Gate V always requires a real independent reviewer.
 * Cursor's headless CLI may fail before reading FxMind (TLS, quota, or MCP
 * approval). Retry at most once on an authenticated Codex CLI, still read-only.
 * A failed or missing verdict NEVER makes the review successful.
 */
async function runReviewerWithFallback(root, options, run) {
  const primary = await run(root, options);
  if (primary && primary.ok) return primary;
  if (options.preferredCliId === "codex") {
    return primary || { ok: false, error: "Independent reviewer failed without a result" };
  }

  const fallback = await run(root, { ...options, preferredCliId: "codex" });
  if (fallback && fallback.ok) return fallback;
  const original = String(primary?.error || "no reviewer output").slice(0, 180);
  const secondary = String(fallback?.error || "no reviewer output").slice(0, 180);
  return { ok: false, error: "Primary reviewer: " + original + "; Codex fallback: " + secondary };
}

module.exports = { runReviewerWithFallback };
