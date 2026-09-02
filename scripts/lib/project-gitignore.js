/**
 * Keep topic memories in git, keep generated graph/session files out.
 *
 * Source of truth for sync: `.fxmind/memory/*.md` (and corrections).
 * Graph JSON/HTML, memory-index, cache, metrics and gates are rebuilt locally.
 */
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const {
  PROJECT_GITIGNORE_LINES,
  PROJECT_GITIGNORE_UNTRACK,
} = require("./layout");

function runGit(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 10_000,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function isGitWorkTree(root) {
  try {
    runGit(root, ["rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function untrackGeneratedFxmindFiles(targetRoot) {
  const root = path.resolve(targetRoot);
  if (!isGitWorkTree(root)) {
    return [];
  }

  let listed = "";
  try {
    listed = runGit(root, ["ls-files", "-z", "--", ...PROJECT_GITIGNORE_UNTRACK]);
  } catch {
    return [];
  }

  const tracked = listed
    .split("\0")
    .map((entry) => entry.replace(/\\/g, "/").trim())
    .filter(Boolean);
  if (tracked.length === 0) {
    return [];
  }

  try {
    runGit(
      root,
      ["rm", "-r", "--cached", "--ignore-unmatch", "-q", "--", ...PROJECT_GITIGNORE_UNTRACK],
      { stdio: "ignore", timeout: 15_000 },
    );
  } catch {
    return [];
  }

  return tracked;
}

function ensureProjectGitignore(targetRoot) {
  const gitignorePath = path.join(path.resolve(targetRoot), ".gitignore");
  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const added = [];
  for (const line of PROJECT_GITIGNORE_LINES) {
    const re = new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
    if (re.test(content)) continue;
    if (content.length && !content.endsWith("\n")) content += "\n";
    if (!content.includes("# fxmind session") && !content.includes("# fxmind generated")) {
      content += "\n# fxmind generated (rebuild from .fxmind/memory/; do not commit)\n";
    }
    content += `${line}\n`;
    added.push(line);
  }
  if (added.length) {
    fs.writeFileSync(gitignorePath, content, "utf8");
  }

  const untracked = untrackGeneratedFxmindFiles(targetRoot);
  return { path: ".gitignore", added, untracked };
}

module.exports = {
  ensureProjectGitignore,
  untrackGeneratedFxmindFiles,
};
