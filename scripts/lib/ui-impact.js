"use strict";

const { execFileSync } = require("child_process");

function uiFile(value) {
  const file = String(value).replace(/\\/g, "/").toLowerCase();
  return !/(?:\.test|\.spec)\.[^/]+$/.test(file) &&
    (/\.(?:tsx|jsx|vue|svelte|html|css|scss|sass|less)$/.test(file) ||
      /(?:^|\/)(?:ui|nui|components|pages)\/.*\.(?:js|ts)$/.test(file));
}

function uiImpact(root, files, evidence = {}, session = {}) {
  if (evidence.ui !== undefined) {
    const assessment = evidence.ui;
    if (!assessment || typeof assessment.changed !== "boolean" ||
        typeof assessment.reason !== "string" || !assessment.reason.trim()) {
      throw new Error("UI impact requires ui.changed (boolean) and ui.reason explaining the actual diff.");
    }
    // Semantic claims (e.g. comment-only edits in TSX) are checked by the independent reviewer.
    return { changed: assessment.changed, reason: assessment.reason.trim() };
  }
  const candidates = (files || []).filter(uiFile);
  let affected = candidates;
  if (candidates.length) {
    try {
      const git = (args) => execFileSync("git", args, {
        cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      }).split("\0").filter(Boolean);
      const changed = new Set([
        ...git(["diff", "--relative", "--name-only", "-z", "--"]),
        ...git(["diff", "--relative", "--cached", "--name-only", "-z", "--"]),
        ...git(["ls-files", "--others", "--exclude-standard", "-z"]),
      ]);
      affected = candidates.filter((file) => changed.has(file));
    } catch (error) {
      if (!/not a git repository/i.test(String(error.stderr || ""))) throw error;
      // No Git diff is available: keep the existing conservative fallback.
    }
  }
  const changed = Boolean(affected.length || session?.ui || evidence.browser?.required);
  return {
    changed,
    reason: affected.length ? `Changed UI source: ${affected.join(", ")}` :
      changed ? "UI behavior was declared by the task/evidence; confirm against the actual diff." :
        "No changed UI source or declared visual/interaction impact in this task.",
  };
}

module.exports = { uiFile, uiImpact };
