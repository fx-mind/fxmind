#!/usr/bin/env node
"use strict";

/**
 * MSYS2/Git Bash-safe MCP launcher for fxmind.
 *
 * Avoids `npx` / `npx.cmd` on Windows — those wrappers spawn cmd.exe with
 * backslash paths, which uv_spawn rejects under MSYS2 (ENOENT).
 *
 * Strategy:
 *   1. Sibling scripts/mcp-server.js (local dev beside this file)
 *   2. Global `fxmind-mcp` on PATH (no cmd.exe wrapper when invoked by name)
 *   3. `node` + npm's npx-cli.js (pure Node, no cmd.exe)
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const GITHUB_PKG = "github:fx-mind/fxmind";
const MCP_BIN = "fxmind-mcp";

function findNpxCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  try {
    candidates.push(require.resolve("npm/bin/npx-cli.js"));
  } catch {
    // npm not resolvable from this Node install
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findSiblingServer() {
  const sibling = path.join(__dirname, "mcp-server.js");
  return fs.existsSync(sibling) ? sibling : null;
}

function findGlobalServer() {
  const roots = [];
  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "npm", "node_modules"));
  }
  if (process.env.NVM_SYMLINK) {
    roots.push(path.join(process.env.NVM_SYMLINK, "node_modules"));
  }
  try {
    const { execFileSync } = require("child_process");
    const prefix = execFileSync(process.execPath, ["-p", "process.env.npm_config_prefix || ''"], {
      encoding: "utf8",
    }).trim();
    if (prefix) {
      roots.push(path.join(prefix, "node_modules"));
    }
  } catch {
    // ignore
  }

  for (const root of roots) {
    const server = path.join(root, "fxmind", "scripts", "mcp-server.js");
    if (fs.existsSync(server)) {
      return server;
    }
  }
  return null;
}

function runServerScript(scriptPath) {
  require(scriptPath);
}

function tryDirectBin() {
  const result = spawnSync(MCP_BIN, [], { stdio: "inherit", env: process.env });
  if (result.error?.code === "ENOENT") {
    return false;
  }
  process.exit(result.status === null ? 1 : result.status);
}

function runViaNpxCli() {
  const npxCli = findNpxCli();
  if (!npxCli) {
    return false;
  }
  const result = spawnSync(
    process.execPath,
    [npxCli, "-y", "-p", GITHUB_PKG, MCP_BIN],
    { stdio: "inherit", env: process.env },
  );
  process.exit(result.status === null ? 1 : result.status);
}

function main() {
  const sibling = findSiblingServer();
  if (sibling) {
    runServerScript(sibling);
    return;
  }

  const globalServer = findGlobalServer();
  if (globalServer) {
    runServerScript(globalServer);
    return;
  }

  if (tryDirectBin()) {
    return;
  }

  if (!runViaNpxCli()) {
    console.error(
      "fxmind MCP: could not start the server.\n" +
        "  • Install Node.js with npm, or\n" +
        "  • Run: npm install -g github:fx-mind/fxmind\n" +
        "  • Then re-run: fxmind hooks install",
    );
    process.exit(1);
  }
}

main();
