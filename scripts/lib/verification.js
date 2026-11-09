"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const luaScope = require("./lua-scope-check");
const independentReview = require("./independent-review");

function repoPath(root, value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Verification requires file paths.");
  const relative = path.relative(path.resolve(root), path.resolve(root, value)).replace(/\\/g, "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("Verification files must be inside the project.");
  }
  return relative;
}

function changedFiles(root) {
  try {
    const git = (args) => execFileSync("git", args, {
      cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    }).split("\0").filter(Boolean);
    return [...new Set([
      ...git(["diff", "--relative", "--name-only", "-z", "--"]),
      ...git(["diff", "--relative", "--cached", "--name-only", "-z", "--"]),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ])].filter((file) => !file.startsWith(".fxmind/") &&
      (!fs.existsSync(path.join(root, file)) || fs.lstatSync(path.join(root, file)).isFile()));
  } catch (error) {
    // Non-Git projects are supported; other errors must not silently hide changes.
    if (/not a git repository/i.test(String(error.stderr || ""))) return [];
    throw error;
  }
}

function snapshot(root, files) {
  return Object.fromEntries(files.map((file) => {
    const absolute = path.join(root, repoPath(root, file));
    if (!fs.existsSync(absolute)) return [file, "deleted"];
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024) {
      throw new Error(`Verification needs a regular file <=10 MiB: ${file}`);
    }
    return [file, crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")];
  }));
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function verificationFiles(root, evidence, session) {
  if (!evidence || !Array.isArray(evidence.files) || !evidence.files.length) {
    throw new Error("Gate V requires evidence.files[] before automatic review.");
  }
  const claimed = session.claimedPaths || [];
  return [...new Set([...evidence.files, ...(claimed.length ? claimed : changedFiles(root))]
    .map((file) => repoPath(root, file)))].sort();
}

function validateEvidence(evidence) {
  if (!evidence || !Array.isArray(evidence.files) || !evidence.files.length ||
      !text(evidence.review) || !Array.isArray(evidence.checks) || !evidence.checks.length) {
    throw new Error("Gate V requires evidence: files[], review, code checks[{kind, target, expected, observed, status}]; read task-verify.md.");
  }
  const checks = evidence.checks;
  if (checks.some((check) => !check || !["lint", "typecheck", "test", "build", "runtime", "manual"].includes(check.kind) ||
      !["passed", "failed", "blocked"].includes(check.status) ||
      !text(check.target) || !text(check.expected) || !text(check.observed))) {
    throw new Error("Each verification check needs kind, target, expected, observed and status (passed/failed/blocked).");
  }
  const codeChecks = checks.filter((check) => check.kind !== "runtime");
  if (!codeChecks.length) {
    throw new Error("Gate V requires at least one code check: lint/syntax, typecheck, focused test, build or manual source review. Runtime alone is insufficient.");
  }
  return codeChecks;
}

function verify(root, evidence, session) {
  const codeChecks = validateEvidence(evidence);
  const claimed = session.claimedPaths || [];
  const files = verificationFiles(root, evidence, session);
  const checks = evidence.checks;
  const luaCheck = luaScope.checkFiles(root, files);
  if (!luaCheck.ok) {
    const detail = luaCheck.issues.slice(0, 5).map((issue) => `${issue.file}:${issue.line} ${issue.symbol} (${issue.rule})`).join("; ");
    throw new Error(`Lua lexical-scope verification failed: ${detail}`);
  }

  const independent = independentReview.assertVerifiedFresh(root, session, files, evidence);
  // Legacy callers may still send runtime/browser results. They neither prove
  // nor block code verification; keep them separate from Gate V's checks.
  const complete = codeChecks.every((check) => check.status === "passed");
  return {
    complete,
    // This validates the contract, not the truth of agent-authored observations.
    evidence: {
      files,
      review: evidence.review,
      scope: "code",
      checks: codeChecks,
      ...(checks.some((check) => check.kind === "runtime") ? { runtimeChecks: checks.filter((check) => check.kind === "runtime") } : {}),
      automated: { luaScope: { status: "passed", files: luaCheck.filesChecked } },
      ...(independent ? { independentReview: independent } : {}),
    },
    snapshot: snapshot(root, files),
    scoped: claimed.length > 0,
  };
}

function assertFresh(root, gate) {
  if (!gate?.complete || !gate.snapshot) throw new Error("Gate C requires Gate V with passing evidence first.");
  const files = Object.keys(gate.snapshot);
  const current = snapshot(root, files);
  if (files.some((file) => current[file] !== gate.snapshot[file]) ||
      (!gate.scoped && changedFiles(root).some((file) => !files.includes(file)))) {
    throw new Error("Code changed after Gate V. Repeat affected checks and record fresh evidence before Gate C.");
  }
}

module.exports = { verify, assertFresh, verificationFiles, validateEvidence };
