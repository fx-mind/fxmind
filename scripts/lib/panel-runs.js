/**
 * Multi-run bookkeeping for a single thread.
 *
 * A thread historically mapped 1:1 to a single CLI execution (its top-level
 * cliId/runStartedAt/diff/etc — still true for the primary "execute" run).
 * This adds a lightweight `raw.runs[]` array so a thread can also carry
 * secondary runs — today only "judge" (a different provider reviewing the
 * primary run's diff/output), read-only and never touching the thread's own
 * status/messages. Operates directly on the raw thread object the same way
 * panel-cli.js already does (raw._cliId, raw._gitSnap, ...) rather than
 * keeping its own store, since threads are owned by panel-threads.js.
 */

const crypto = require("crypto");

function createRun(raw, { kind, cliId = null, model = null, effort = null, accessMode = null }) {
  if (!raw) return null;
  if (!Array.isArray(raw.runs)) raw.runs = [];
  const run = {
    id: crypto.randomUUID(),
    kind: kind === "judge" ? "judge" : "execute",
    cliId,
    model,
    effort,
    accessMode,
    status: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
    message: null,
    verdict: null,
  };
  raw.runs.push(run);
  return run;
}

function updateRun(raw, runId, patch = {}) {
  const run = (raw?.runs || []).find((r) => r.id === runId);
  if (!run) return null;
  Object.assign(run, patch);
  return run;
}

function listRuns(raw) {
  return Array.isArray(raw?.runs) ? raw.runs : [];
}

module.exports = { createRun, updateRun, listRuns };
