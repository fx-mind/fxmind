"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

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

function uiFile(file) {
  return !/(?:\.test|\.spec)\.[^/]+$/.test(file) &&
    (/\.(?:tsx|jsx|vue|svelte|html|css|scss|sass|less)$/.test(file) ||
      /(?:^|\/)(?:ui|nui|components|pages)\/.*\.(?:js|ts)$/.test(file));
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function verify(root, evidence, session) {
  if (!evidence || !Array.isArray(evidence.files) || !evidence.files.length ||
      !text(evidence.review) || !Array.isArray(evidence.checks) || !evidence.checks.length) {
    throw new Error("Gate V requires evidence: files[], review, checks[{kind, target, expected, observed, status}]. UI changes also require browser evidence; read task-verify.md.");
  }
  const claimed = session.claimedPaths || [];
  const files = [...new Set([...evidence.files, ...(claimed.length ? claimed : changedFiles(root))]
    .map((file) => repoPath(root, file)))].sort();
  const checks = evidence.checks;
  if (checks.some((check) => !check || !["test", "build", "runtime", "manual"].includes(check.kind) ||
      !["passed", "failed", "blocked"].includes(check.status) ||
      !text(check.target) || !text(check.expected) || !text(check.observed))) {
    throw new Error("Each verification check needs kind, target, expected, observed and status (passed/failed/blocked).");
  }
  const uiRequired = Boolean(session.ui || evidence.browser?.required || files.some(uiFile));
  let browser = evidence.browser;
  if (uiRequired) {
    if (!browser || !["passed", "failed", "blocked"].includes(browser.status)) {
      throw new Error("UI changes require browser evidence. A build alone cannot pass Gate V. If browser/runtime is unavailable, record browser.status=blocked with reason.");
    }
    if (browser.status === "passed") {
      if (!text(browser.url) || !text(browser.visual) || !text(browser.console) ||
          !Array.isArray(browser.interactions) || !browser.interactions.length ||
          !browser.interactions.every(text) || !text(browser.artifact)) {
        throw new Error("Browser evidence requires url, interactions[], visual, console, artifact (screenshot/trace path).");
      }
      const artifact = path.resolve(root, browser.artifact);
      const stat = fs.statSync(artifact);
      if (!stat.isFile() || stat.size === 0) throw new Error("Browser artifact must be a non-empty file.");
      browser = { ...browser, artifact };
    } else if (!text(browser.reason)) {
      throw new Error("Failed/blocked browser verification requires a reason.");
    }
  }
  const complete = checks.every((check) => check.status === "passed") &&
    (!uiRequired || browser.status === "passed");
  return {
    complete,
    // This validates the contract, not the truth of agent-authored observations.
    evidence: { files, review: evidence.review, checks, ...(uiRequired ? { browser } : {}) },
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

module.exports = { verify, assertFresh, uiFile };
