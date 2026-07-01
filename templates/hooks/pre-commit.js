#!/usr/bin/env node
/**
 * fxmind pre-commit — git hook: block commits when staged code files break
 * topic memories (paths[] in .fxmind/memory/*.md reference a file that no longer exists).
 *
 * Stale-candidate (file exists but memory may be outdated) prints warnings only.
 * Set FXMIND_PRECOMMIT_STRICT=1 to also block on stale-candidate hits.
 *
 * Installed to .git/hooks/pre-commit by `fxmind hooks install-git`.
 * Requires .cursor/hooks/pre-commit.js (copied by `fxmind hooks install`).
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { driftForStagedFiles } = require("./lib/memory-drift.js");

const PROJECT_ROOT = process.cwd();
const FXMIND_DIR = path.join(PROJECT_ROOT, ".fxmind");

function getStagedFiles() {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"],
      { cwd: PROJECT_ROOT, stdio: ["pipe", "pipe", "pipe"] },
    )
      .toString()
      .trim();
    if (!out) return [];
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  if (!fs.existsSync(FXMIND_DIR)) {
    process.exit(0);
  }

  const memoryDir = path.join(FXMIND_DIR, "memory");
  if (!fs.existsSync(memoryDir)) {
    process.exit(0);
  }

  const staged = getStagedFiles();
  if (staged.length === 0) {
    process.exit(0);
  }

  const blockStale = process.env.FXMIND_PRECOMMIT_STRICT === "1";
  const { broken, stale, block } = driftForStagedFiles(PROJECT_ROOT, staged, { blockStale });

  if (broken.length === 0 && stale.length === 0) {
    process.exit(0);
  }

  console.error("\nfxmind pre-commit: memory drift detected in staged files\n");

  for (const hit of broken) {
    console.error(
      `  BROKEN  ${hit.memoryFile} → ${hit.referencedPath} (file missing) — run /fxmind learn ${hit.slug}`,
    );
  }
  for (const hit of stale) {
    console.error(
      `  STALE   ${hit.memoryFile} → ${hit.referencedPath} — consider /fxmind learn ${hit.slug}`,
    );
  }

  if (block) {
    console.error(
      "\nCommit blocked. Fix broken memories or update paths before committing.",
    );
    console.error("Override: git commit --no-verify\n");
    process.exit(1);
  }

  console.error("\nWarnings only (commit allowed). Set FXMIND_PRECOMMIT_STRICT=1 to block stale hits.\n");
  process.exit(0);
}

main();
