"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { installPlugin, usage } = require("./plugin-cli");

const SOURCE = path.resolve(__dirname, "..");

function temporaryHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-plugin-cli-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test("CLI plugin entry supports help and rejects invalid clients", () => {
  assert.match(usage(), /fxmind plugin cursor\|claude\|codex/);
  const help = spawnSync(process.execPath, [path.join(__dirname, "install.js"), "plugin", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Claude\/Codex/);
  const error = spawnSync(process.execPath, [path.join(__dirname, "install.js"), "plugin", "unknown"], { encoding: "utf8" });
  assert.equal(error.status, 1);
});

test("Cursor installs a native discoverable, skills-only plugin and updates idempotently", (t) => {
  const home = temporaryHome(t);
  const log = () => {};
  const result = installPlugin("cursor", { home, sourceRoot: SOURCE, log });
  assert.equal(result.version, "1.5.0");
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.dest, "plugin.json"), "utf8")).name, "fxmind");
  for (const skill of ["fxmind", "fxmind-setup"]) {
    assert.ok(fs.existsSync(path.join(result.dest, "skills", skill, "SKILL.md")));
  }
  assert.equal(fs.existsSync(path.join(result.dest, "mcp.json")), false);
  assert.equal(fs.existsSync(path.join(result.dest, ".mcp.json")), false);
  installPlugin("cursor", { home, sourceRoot: SOURCE, log });
  assert.ok(fs.existsSync(path.join(result.dest, "plugin.json")));
});

test("Cursor protects foreign installations and bundled MCP files", (t) => {
  const home = temporaryHome(t);
  const dest = path.join(home, ".cursor", "plugins", "local", "fxmind");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "other.txt"), "preserve");
  assert.throws(() => installPlugin("cursor", { home, sourceRoot: SOURCE, log() {} }), /nao gerenciado/);
  assert.equal(fs.readFileSync(path.join(dest, "other.txt"), "utf8"), "preserve");
});

test("Cursor refuses an existing FXMIND plugin that would duplicate MCP", (t) => {
  const home = temporaryHome(t);
  const result = installPlugin("cursor", { home, sourceRoot: SOURCE, log() {} });
  const foreignMcp = path.join(result.dest, "mcp.json");
  fs.writeFileSync(foreignMcp, "{\"mcpServers\":{}}");
  assert.throws(() => installPlugin("cursor", { home, sourceRoot: SOURCE, log() {} }), /duplicada/);
  assert.ok(fs.existsSync(foreignMcp));
});

test("Claude installs through official marketplace CLI and updates existing install", (t) => {
  const home = temporaryHome(t);
  let marketplace = false;
  let installed = false;
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] !== "plugin") throw new Error("unexpected CLI");
    if (args[1] === "marketplace" && args[2] === "list") {
      return JSON.stringify(marketplace ? [{ name: "fxmind-local", source: "directory", path: path.join(home, ".fxmind", "plugin-cli", "marketplace") }] : []);
    }
    if (args[1] === "marketplace" && args[2] === "add") {
      marketplace = true;
      return "";
    }
    if (args[1] === "list") {
      return JSON.stringify(installed ? [{ id: "fxmind@fxmind-local", scope: "user" }] : []);
    }
    if (args[1] === "install") {
      installed = true;
      return "";
    }
    if (args[1] === "update") return "";
    throw new Error("unexpected " + args.join(" "));
  };
  const result = installPlugin("claude", { home, sourceRoot: SOURCE, run, log() {} });
  assert.ok(calls.some((entry) => entry[1] === "plugin" && entry[2] === "install"));
  assert.equal(fs.existsSync(path.join(result.marketplace, "plugins", "fxmind", ".mcp.json")), false);
  const doc = JSON.parse(fs.readFileSync(path.join(result.marketplace, ".claude-plugin", "marketplace.json")));
  assert.equal(doc.name, "fxmind-local");
  installPlugin("claude", { home, sourceRoot: SOURCE, run, log() {} });
  assert.ok(calls.some((entry) => entry[2] === "update"));
});

test("Codex installs via marketplace and skips an identical existing version", (t) => {
  const home = temporaryHome(t);
  let marketplace = false;
  let installed = false;
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] !== "plugin") throw new Error("unexpected CLI");
    if (args[1] === "marketplace" && args[2] === "list") {
      return JSON.stringify({ marketplaces: marketplace ? [{ name: "fxmind-local", root: path.join(home, ".fxmind", "plugin-cli", "marketplace") }] : [] });
    }
    if (args[1] === "marketplace" && args[2] === "add") {
      marketplace = true;
      return "{}";
    }
    if (args[1] === "list") {
      return JSON.stringify({ installed: installed ? [{
        pluginId: "fxmind@fxmind-local", installed: true, version: "1.5.0",
      }] : [] });
    }
    if (args[1] === "add") {
      installed = true;
      return "{}";
    }
    throw new Error("unexpected " + args.join(" "));
  };
  const result = installPlugin("codex", { home, sourceRoot: SOURCE, run, log() {} });
  assert.ok(calls.some((entry) => entry[2] === "add"));
  const config = JSON.parse(fs.readFileSync(path.join(result.marketplace, ".agents", "plugins", "marketplace.json")));
  assert.equal(config.plugins[0].source.path, "./plugins/fxmind");
  assert.equal(fs.existsSync(path.join(result.marketplace, "plugins", "fxmind", "mcp.json")), false);
  const count = calls.filter((entry) => entry[2] === "add").length;
  installPlugin("codex", { home, sourceRoot: SOURCE, run, log() {} });
  assert.equal(calls.filter((entry) => entry[2] === "add").length, count);
});
