"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function stateDir(root) {
  return path.join(path.resolve(root), ".fxmind", "state", "reviews");
}

function safeId(value) {
  return String(value || "").replace(/[^A-Za-z0-9._-]/g, "_");
}

function reviewPath(root, sessionId) {
  return path.join(stateDir(root), safeId(sessionId) + ".json");
}

function repoPath(root, value) {
  const rel = path.relative(path.resolve(root), path.resolve(root, value)).replace(/\\/g, "/");
  if (!rel || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    throw new Error("Independent review path must stay inside project: " + value);
  }
  return rel;
}

function changedFiles(root) {
  try {
    const git = (args) => execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).split("\0").filter(Boolean);
    return [...new Set([
      ...git(["diff", "--relative", "--name-only", "-z", "--"]),
      ...git(["diff", "--relative", "--cached", "--name-only", "-z", "--"]),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ])].filter((file) => !file.startsWith(".fxmind/")).sort();
  } catch (error) {
    if (/not a git repository/i.test(String(error.stderr || ""))) return [];
    throw error;
  }
}

function snapshot(root, files) {
  const out = {};
  for (const input of files || []) {
    const file = repoPath(root, input);
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      out[file] = "deleted";
      continue;
    }
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) continue;
    out[file] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
  }
  return out;
}

function fingerprint(snap) {
  return crypto.createHash("sha256").update(JSON.stringify(snap)).digest("hex");
}

function parseVerdict(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const finalLine = lines.at(-1) || "";
  if (/^VERDICT:\s*REFUTED$/i.test(finalLine)) return "refuted";
  if (/^VERDICT:\s*VERIFIED WITH CAVEATS$/i.test(finalLine)) return "verified_with_caveats";
  if (/^VERDICT:\s*VERIFIED$/i.test(finalLine)) return "verified";
  return "unverifiable";
}

function requiresIndependentReview(session, files) {
  if (!session || session.trivial) return false;
  const list = files || [];
  if (list.some((file) => /\.lua$/i.test(file))) return true;
  if (list.length > 1) return true;
  return ["fix", "mechanic", "create"].includes(String(session.kind || "").toLowerCase());
}

function buildPrompt(session, files) {
  const goal = session && session.gates && session.gates.A && session.gates.A.note
    ? session.gates.A.note
    : (session && session.note ? session.note : "(goal not recorded)");
  const lines = [
    "Review this candidate change independently. You did not implement it.",
    "Do not trust or request the executor's explanation. Work from the original goal, current source, git diff/status and real evidence.",
    "This is READ-ONLY: do not edit files and do not record FxMind gates.",
    "",
    "Original goal / Gate A: " + goal,
    "Task kind: " + ((session && session.kind) || "unknown"),
    "Files under review:",
  ];
  for (const file of files || []) lines.push("- " + file);
  lines.push(
    "",
    "Inspect the actual diff and relevant callers. Try to falsify the change: requirement gaps, lexical/scope errors, accidental globals, wrong function order, missed twins, stale assumptions, edge cases, security/performance regressions, scope creep and unsupported verification claims.",
    "For Lua, explicitly check that every local callee is lexically visible to its callers and that a later local declaration did not turn an earlier reference into a global lookup.",
    "",
    "End with exactly one line:",
    "VERDICT: VERIFIED",
    "VERDICT: VERIFIED WITH CAVEATS",
    "VERDICT: REFUTED"
  );
  return lines.join("\n");
}

function recordReview(root, options) {
  const sessionId = options && options.sessionId;
  if (!sessionId) throw new Error("Independent review requires sessionId.");
  const files = options && options.files ? options.files : [];
  const normalized = [...new Set(files.map((file) => repoPath(root, file)))].sort();
  const snap = snapshot(root, normalized);
  const record = {
    schemaVersion: 1,
    reviewId: crypto.randomUUID(),
    sessionId,
    at: new Date().toISOString(),
    reviewer: (options && options.reviewer) || {},
    verdict: parseVerdict(options && options.output),
    files: normalized,
    snapshot: snap,
    fingerprint: fingerprint(snap),
    output: String((options && options.output) || "").slice(0, 12000),
  };
  fs.mkdirSync(stateDir(root), { recursive: true });
  fs.writeFileSync(reviewPath(root, sessionId), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

function readReview(root, sessionId) {
  const file = reviewPath(root, sessionId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function assertVerifiedFresh(root, session, files) {
  if (!requiresIndependentReview(session, files)) return null;
  const record = readReview(root, session.sessionId);
  if (!record) {
    throw new Error("Gate V requires a fresh independent review. Run fxmind_independent_review before recording V.");
  }
  if (record.schemaVersion !== 1 || !record.reviewId || record.reviewer?.agent !== "reviewer") {
    throw new Error("Independent review artifact is invalid. Run fxmind_independent_review again.");
  }
  if (record.verdict !== "verified") {
    throw new Error("Independent review did not verify the change (verdict: " + record.verdict + "). Fix findings and run it again.");
  }
  const normalized = [...new Set((files || []).map((file) => repoPath(root, file)))].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(record.files || [])) {
    throw new Error("Independent review is stale: reviewed file set differs from Gate V files. Run it again.");
  }
  const current = snapshot(root, normalized);
  if (fingerprint(current) !== record.fingerprint) {
    throw new Error("Independent review is stale: code changed after review. Run it again.");
  }
  return {
    reviewId: record.reviewId,
    reviewer: record.reviewer,
    verdict: record.verdict,
    fingerprint: record.fingerprint,
  };
}

module.exports = {
  changedFiles,
  snapshot,
  fingerprint,
  parseVerdict,
  requiresIndependentReview,
  buildPrompt,
  recordReview,
  readReview,
  assertVerifiedFresh,
};
