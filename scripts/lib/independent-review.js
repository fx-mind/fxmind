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

function reviewContext(session) {
  const goal = session?.gates?.A?.note || session?.note || "";
  return {
    goal: String(goal),
    kind: session?.kind || null,
    playbook: session?.playbook || null,
  };
}

function contextFingerprint(session) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(reviewContext(session)))
    .digest("hex");
}

function parseVerdict(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const finalLine = lines.at(-1) || "";
  if (/^VERDICT:\s*UNVERIFIABLE$/i.test(finalLine)) return "unverifiable";
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

function safeRead(root, rel, maxChars) {
  const absolute = path.join(root, rel);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  const body = fs.readFileSync(absolute, "utf8").trim();
  if (!body) return null;
  return {
    path: rel.replace(/\\/g, "/"),
    body: body.length > maxChars ? body.slice(0, maxChars) + "\n[excerpt truncated]" : body,
  };
}

function reviewGuidance(root, files) {
  const normalized = (files || []).map((file) => String(file).replace(/\\/g, "/").toLowerCase());
  const candidates = [];
  // Load code references only. Broad skill routers/quality gates can impose
  // browser, game-server and workflow requirements unrelated to code review.
  if (normalized.some((file) => /\.lua$/.test(file))) {
    candidates.push(".fxmind/skills/fivem-development/style.md");
    candidates.push(".fxmind/skills/fivem-development/security.md");
  }
  if (normalized.some((file) => /(?:^|\/)vrp(?:\/|$)|modules\/|tunnel|proxy/.test(file))) {
    candidates.push(".fxmind/skills/vrp-framework/patterns.md");
  }
  return candidates.map((rel) => safeRead(root, rel, 1800)).filter(Boolean)
    .map((item) => "### " + item.path + "\n" + item.body).join("\n\n");
}

function buildPrompt(root, session, files, evidence = {}) {
  const goal = session && session.gates && session.gates.A && session.gates.A.note
    ? session.gates.A.note
    : (session && session.note ? session.note : "(goal not recorded)");
  const guidance = reviewGuidance(root, files);
  const lines = [
    "Review this candidate change independently. You did not implement it.",
    "This review IS Gate V: code verification only (lint/syntax, types and broken logic).",
    "Do not trust or request the executor's explanation, reasoning or completion report. Work from the original goal, current source, git diff/status and code checks below.",
    "This is READ-ONLY: do not edit files and do not record FxMind gates.",
    "",
    "Original goal / Gate A: " + goal,
    "Task kind: " + ((session && session.kind) || "unknown"),
    "Inspect changed code and directly affected callers only. Check lint/syntax, applicable types, lexical scope, control flow, boundary conditions, data contracts and concrete security/performance regressions. Use existing static checks and focused automated tests where useful; do not introduce tooling just for review.",
    "Do not open a browser, start the application/game server, request screenshots, credentials or manual gameplay, or require runtime/visual proof. Those are separate from Gate V, even for frontend changes. A passing Gate V means code reviewed, not runtime behavior proven.",
    "Read source/diff directly with available file, search and Git tools. FxMind MCP/memory is optional for this review; its absence is not a code defect and must not prevent direct source inspection.",
    "Block only on a concrete code defect, with file:line and an explanation of the broken path. Missing runtime evidence, subjective style preferences, hypothetical refactors and unrelated existing issues are not blocking findings. Non-blocking suggestions may accompany VERIFIED.",
    "If source cannot be inspected or the reviewer/tools fail, return VERDICT: UNVERIFIABLE with the infrastructure reason, never REFUTED. Do not repeatedly retry unavailable infrastructure.",
    "Files under review:",
  ];
  for (const file of files || []) lines.push("- " + file);
  const checks = Array.isArray(evidence?.checks) ? evidence.checks.filter((check) => check.kind !== "runtime") : [];
  if (checks.length) {
    lines.push("", "## Executor observations (claims; verify independently)");
    for (const check of checks.slice(0, 12)) {
      lines.push(
        "- " + [check.kind, check.target, check.status, check.observed].filter(Boolean).join(" | "),
      );
    }
  }
  lines.push(
    "",
    "Inspect the actual diff and relevant callers. Look for broken logic: lexical/scope errors, accidental globals, wrong function order, incorrect conditions, missed equivalent defects and edge cases in the changed execution paths.",
    "Lean review (no extra gate): flag duplication or extra abstraction only when it causes a concrete logic defect in the changed code. Name the affected callers before flagging. Do NOT demand fewer lines when it removes security, validation, accessibility, error handling or essential tests. Do not invent savings.",
    "Use a focused regression test when it can expose a suspected code defect; do not demand new tests for every small edit. Verify existing tests and their assertions when relevant.",
    "For Lua, explicitly check that every local callee is lexically visible to its callers and that a later local declaration did not turn an earlier reference into a global lookup.",
  );
  if (guidance) {
    lines.push(
      "",
      "## Code references",
      "Use these references only to understand code semantics. They do not expand Gate V into runtime, UI, workflow or broad style validation.",
      guidance,
    );
  }
  lines.push(
    "",
    "End with exactly one final line:",
    "VERDICT: VERIFIED",
    "VERDICT: VERIFIED WITH CAVEATS",
    "VERDICT: REFUTED",
    "VERDICT: UNVERIFIABLE"
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
    schemaVersion: 3,
    scope: "code",
    reviewId: crypto.randomUUID(),
    sessionId,
    at: new Date().toISOString(),
    reviewer: (options && options.reviewer) || {},
    verdict: parseVerdict(options && options.output),
    files: normalized,
    snapshot: snap,
    fingerprint: fingerprint(snap),
    contextFingerprint: contextFingerprint(options?.session || {}),
    output: String((options && options.output) || "").slice(0, 16000),
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

function assertVerifiedFresh(root, session, files, evidence = {}) {
  if (!requiresIndependentReview(session, files)) return null;
  const record = readReview(root, session.sessionId);
  if (!record) {
    throw new Error("Gate V requires its automatic independent reviewer to finish first.");
  }
  if (record.schemaVersion !== 3 || record.scope !== "code" || !record.reviewId || record.reviewer?.agent !== "reviewer") {
    throw new Error("Gate V independent review artifact is invalid; run Gate V again.");
  }
  if (record.verdict !== "verified") {
    throw new Error("Gate V reviewer did not verify the change (verdict: " + record.verdict + "). Fix findings and run Gate V again.");
  }
  const normalized = [...new Set((files || []).map((file) => repoPath(root, file)))].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(record.files || [])) {
    throw new Error("Gate V review is stale: reviewed file set differs from current Gate V files. Run Gate V again.");
  }
  const current = snapshot(root, normalized);
  if (fingerprint(current) !== record.fingerprint) {
    throw new Error("Gate V review is stale: code changed after review. Run Gate V again.");
  }
  if (!record.contextFingerprint || record.contextFingerprint !== contextFingerprint(session)) {
    throw new Error("Gate V review is stale: task goal/kind/playbook changed after review. Run Gate V again.");
  }
  return {
    reviewId: record.reviewId,
    reviewer: record.reviewer,
    verdict: record.verdict,
    fingerprint: record.fingerprint,
    contextFingerprint: record.contextFingerprint,
  };
}

module.exports = {
  changedFiles,
  snapshot,
  fingerprint,
  reviewContext,
  contextFingerprint,
  parseVerdict,
  requiresIndependentReview,
  reviewGuidance,
  buildPrompt,
  recordReview,
  readReview,
  assertVerifiedFresh,
};
