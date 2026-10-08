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
    ui: Boolean(session?.ui),
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

function installedSkillRouters(root) {
  const base = path.join(root, ".fxmind", "skills");
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return [];
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = path.join(".fxmind", "skills", entry.name, "SKILL.md");
    const hit = safeRead(root, rel, 1200);
    if (hit) out.push(hit);
  }
  return out;
}

function reviewGuidance(root, files) {
  const normalized = (files || []).map((file) => String(file).replace(/\\/g, "/").toLowerCase());
  const isLua = normalized.some((file) => /\.lua$/.test(file));
  const isUi = normalized.some((file) =>
    /\.(?:tsx|jsx|vue|svelte|html|css|scss|sass|less|js|ts)$/.test(file) &&
    /(?:ui|nui|web|html|react|components|pages)/.test(file),
  );
  const isVrp = normalized.some((file) => /(?:^|\/)vrp(?:\/|$)|modules\/|tunnel|proxy/.test(file));
  const candidates = [];

  const policy = safeRead(root, ".fxmind/policy/fivem-principles.md", 3200);
  if (policy) candidates.push(policy);
  const index = safeRead(root, ".fxmind/skills/_index.md", 1200);
  if (index) candidates.push(index);
  candidates.push(...installedSkillRouters(root));
  const fivemSkill = safeRead(root, ".fxmind/skills/fivem-development/SKILL.md", 2200);
  if (fivemSkill) candidates.push(fivemSkill);
  const gates = safeRead(root, ".fxmind/skills/fivem-development/quality-gates.md", 3200);
  if (gates) candidates.push(gates);

  if (isLua || policy) {
    for (const rel of [
      ".fxmind/skills/fivem-development/style.md",
      ".fxmind/skills/fivem-development/architecture.md",
      ".fxmind/skills/fivem-development/security.md",
    ]) {
      const hit = safeRead(root, rel, 1800);
      if (hit) candidates.push(hit);
    }
  }

  if (isVrp) {
    for (const rel of [
      ".fxmind/skills/vrp-framework/SKILL.md",
      ".fxmind/skills/vrp-framework/patterns.md",
    ]) {
      const hit = safeRead(root, rel, 2000);
      if (hit) candidates.push(hit);
    }
  }

  if (isUi) {
    const hit = safeRead(root, ".fxmind/skills/fivem-react-nui/SKILL.md", 2200);
    if (hit) candidates.push(hit);
  }

  const seen = new Set();
  let budget = 10500;
  const sections = [];
  for (const item of candidates) {
    if (!item || seen.has(item.path) || budget <= 0) continue;
    seen.add(item.path);
    const body = item.body.slice(0, budget);
    sections.push("### " + item.path + "\n" + body);
    budget -= body.length;
  }
  return sections.join("\n\n");
}

function buildPrompt(root, session, files, evidence = {}) {
  const goal = session && session.gates && session.gates.A && session.gates.A.note
    ? session.gates.A.note
    : (session && session.note ? session.note : "(goal not recorded)");
  const guidance = reviewGuidance(root, files);
  const lines = [
    "Review this candidate change independently. You did not implement it.",
    "This review IS Gate V: treat it as the final adversarial validation before completion.",
    "Do not trust or request the executor's explanation, reasoning or completion report. Work from the original goal, current source, git diff/status, real evidence and the project rules below.",
    "This is READ-ONLY: do not edit files and do not record FxMind gates.",
    "",
    "Original goal / Gate A: " + goal,
    "Task kind: " + ((session && session.kind) || "unknown"),
    "Files under review:",
  ];
  for (const file of files || []) lines.push("- " + file);
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : [];
  if (checks.length) {
    lines.push("", "## Executor observations (claims; verify independently)");
    for (const check of checks.slice(0, 12)) {
      lines.push(
        "- " + [check.kind, check.target, check.status, check.observed].filter(Boolean).join(" | "),
      );
    }
  }
  if (evidence?.browser) {
    lines.push(
      "- browser | " + [
        evidence.browser.status,
        evidence.browser.url,
        evidence.browser.visual,
        evidence.browser.console,
      ].filter(Boolean).join(" | "),
    );
  }
  lines.push(
    "",
    "Inspect the actual diff and relevant callers. Try to falsify the change: requirement gaps, lexical/scope errors, accidental globals, wrong function order, missed twins, stale assumptions, edge cases, security/performance regressions, scope creep and unsupported verification claims.",
    "For Lua, explicitly check that every local callee is lexically visible to its callers and that a later local declaration did not turn an earlier reference into a global lookup.",
  );
  if (guidance) {
    lines.push(
      "",
      "## Binding/relevant review guidance",
      "Apply these project/pack rules as the review rubric. Inspect the referenced current source files when an excerpt points to a relevant section.",
      guidance,
    );
  }
  lines.push(
    "",
    "End with exactly one final line:",
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
    schemaVersion: 2,
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

function assertVerifiedFresh(root, session, files) {
  if (!requiresIndependentReview(session, files)) return null;
  const record = readReview(root, session.sessionId);
  if (!record) {
    throw new Error("Gate V requires its automatic independent reviewer to finish first.");
  }
  if (record.schemaVersion !== 2 || !record.reviewId || record.reviewer?.agent !== "reviewer") {
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
