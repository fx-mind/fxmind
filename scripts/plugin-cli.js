/**
 * User-scoped FXMIND Agent Plugin installer.
 * Keeps the full FXMIND MCP registered per project, not a second plugin MCP.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const MARKETPLACE = "fxmind-local";
const PLUGIN_ID = "fxmind@" + MARKETPLACE;
const CLIENTS = new Set(["cursor", "claude", "codex"]);
const FILES = [
  ["plugin.json", "plugin.json"],
  ["skills/fxmind/SKILL.md", "skills/fxmind/SKILL.md"],
  ["skills/fxmind-setup/SKILL.md", "skills/fxmind-setup/SKILL.md"],
  [".claude-plugin/plugin.json", ".claude-plugin/plugin.json"],
];

function usage() {
  return [
    "Usage: fxmind plugin cursor|claude|codex",
    "",
    "Instala/atualiza o FXMIND Agent Plugin no perfil do usuario.",
    "Preserva .fxmind/, hooks e MCP ja configurados nos projetos.",
    "Cursor: plugin local (Customize > Plugins; recarregue a janela).",
    "Claude/Codex: instala via marketplace local e gerenciador nativo.",
    "Requer CLI claude ou codex no PATH para esses respectivos clientes.",
  ].join("\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDirectory(folder) {
  if (fs.existsSync(folder) && (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink())) {
    throw new Error("Pasta de plugin invalida ou link simbolico: " + folder);
  }
  fs.mkdirSync(folder, { recursive: true });
}

function checkOwnedBundle(dest, expectedRepository) {
  if (!fs.existsSync(dest)) return;
  if (!fs.lstatSync(dest).isDirectory() || fs.lstatSync(dest).isSymbolicLink()) {
    throw new Error("Destino de plugin nao e uma pasta segura: " + dest);
  }
  const manifestPath = path.join(dest, "plugin.json");
  if (!fs.existsSync(manifestPath)) {
    if (fs.readdirSync(dest).length) throw new Error("Destino de plugin ocupado e nao gerenciado: " + dest);
    return;
  }
  const manifest = readJson(manifestPath);
  if (manifest.name !== "fxmind" || manifest.repository !== expectedRepository) {
    throw new Error("Plugin existente nao pertence ao FXMIND: " + dest);
  }
  for (const name of ["mcp.json", ".mcp.json", ".cursor-plugin"]) {
    if (fs.existsSync(path.join(dest, name))) {
      throw new Error("Plugin existente tem MCP/adapter proprio; recuso criar conexao duplicada: " + dest);
    }
  }
}

function copySkillOnlyBundle(sourceRoot, dest) {
  const manifest = readJson(path.join(sourceRoot, "plugin.json"));
  if (manifest.name !== "fxmind") throw new Error("Manifesto de origem nao e FXMIND.");
  for (const [src] of FILES) {
    if (!fs.existsSync(path.join(sourceRoot, src))) throw new Error("Arquivo do plugin ausente: " + src);
  }
  checkOwnedBundle(dest, manifest.repository);
  ensureDirectory(dest);
  for (const [sourceRel, destRel] of FILES) {
    const out = path.join(dest, destRel);
    ensureDirectory(path.dirname(out));
    if (fs.existsSync(out) && fs.lstatSync(out).isSymbolicLink()) {
      throw new Error("Arquivo do plugin nao pode ser um link: " + out);
    }
    fs.copyFileSync(path.join(sourceRoot, sourceRel), out);
  }
  return manifest.version;
}

function putMarketplaceJson(filename, contents) {
  ensureDirectory(path.dirname(filename));
  if (fs.existsSync(filename)) {
    const previous = readJson(filename);
    if (previous.name !== MARKETPLACE ||
        !Array.isArray(previous.plugins) ||
        previous.plugins.length !== 1 ||
        previous.plugins[0].name !== "fxmind" ||
        JSON.stringify(previous.plugins[0].source) !== JSON.stringify(contents.plugins[0].source)) {
      throw new Error("Marketplace existente nao pertence ao FXMIND: " + filename);
    }
  }
  fs.writeFileSync(filename, JSON.stringify(contents, null, 2) + "\n", "utf8");
}

function installCatalog(sourceRoot, home) {
  const root = path.join(home, ".fxmind", "plugin-cli", "marketplace");
  const bundle = path.join(root, "plugins", "fxmind");
  const version = copySkillOnlyBundle(sourceRoot, bundle);
  putMarketplaceJson(path.join(root, ".claude-plugin", "marketplace.json"), {
    name: MARKETPLACE,
    owner: { name: "FXMIND" },
    plugins: [{ name: "fxmind", source: "./plugins/fxmind", description: "Shared project memory skills for coding agents" }],
  });
  putMarketplaceJson(path.join(root, ".agents", "plugins", "marketplace.json"), {
    name: MARKETPLACE,
    plugins: [{
      name: "fxmind",
      source: { source: "local", path: "./plugins/fxmind" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    }],
  });
  return { root, version };
}

function runNative(command, args) {
  const proc = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (proc.error) {
    throw new Error(command + " nao encontrado ou nao executavel: " + proc.error.message);
  }
  if (proc.status !== 0) {
    throw new Error(command + " " + args.slice(0, 3).join(" ") + " falhou: " +
      (proc.stderr || proc.stdout || "codigo " + proc.status).trim());
  }
  return (proc.stdout || "").trim();
}

function runJson(run, program, args) {
  const output = run(program, args);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Resposta JSON invalida de " + program + " " + args.join(" "));
  }
}

function installPlugin(client, options = {}) {
  if (!CLIENTS.has(client)) throw new Error("Cliente invalido: " + client);
  const home = options.home || os.homedir();
  const sourceRoot = options.sourceRoot || path.resolve(__dirname, "..");
  const run = options.run || runNative;
  const log = options.log || console.log;
  if (!fs.existsSync(path.join(sourceRoot, "plugin.json"))) {
    throw new Error("Esta instalacao do FXMIND nao inclui plugin.json; atualize o CLI.");
  }

  if (client === "cursor") {
    const dest = path.join(home, ".cursor", "plugins", "local", "fxmind");
    const version = copySkillOnlyBundle(sourceRoot, dest);
    log("FXMIND Plugin " + version + " instalado/atualizado no Cursor: " + dest);
    log("Recarregue o Cursor: Developer: Reload Window > Customize > Plugins.");
    log("MCP do projeto mantido; plugin nao cria segundo servidor MCP.");
    return { client, dest, version };
  }

  const { root, version } = installCatalog(sourceRoot, home);
  if (client === "claude") {
    const marketplaces = runJson(run, "claude", ["plugin", "marketplace", "list", "--json"]);
    if (!Array.isArray(marketplaces)) throw new Error("Lista de marketplaces Claude invalida.");
    const existingMarketplace = marketplaces.find((entry) => entry.name === MARKETPLACE);
    if (existingMarketplace &&
        (existingMarketplace.source !== "directory" ||
         path.resolve(existingMarketplace.path || existingMarketplace.installLocation || "") !== path.resolve(root))) {
      throw new Error("Marketplace Claude com nome fxmind-local aponta para outra origem.");
    }
    if (!existingMarketplace) {
      run("claude", ["plugin", "marketplace", "add", root]);
    }
    const plugins = runJson(run, "claude", ["plugin", "list", "--json"]);
    if (!Array.isArray(plugins)) throw new Error("Lista de plugins Claude invalida.");
    if (plugins.some((entry) => entry.id === PLUGIN_ID && entry.scope === "user")) {
      run("claude", ["plugin", "update", PLUGIN_ID, "--scope", "user"]);
    } else {
      run("claude", ["plugin", "install", PLUGIN_ID, "--scope", "user"]);
    }
  } else {
    const data = runJson(run, "codex", ["plugin", "marketplace", "list", "--json"]);
    if (!data || !Array.isArray(data.marketplaces)) throw new Error("Lista de marketplaces Codex invalida.");
    const existingMarketplace = data.marketplaces.find((entry) => entry.name === MARKETPLACE);
    if (existingMarketplace && path.resolve(existingMarketplace.root || "") !== path.resolve(root)) {
      throw new Error("Marketplace Codex com nome fxmind-local aponta para outra origem.");
    }
    if (!existingMarketplace) {
      run("codex", ["plugin", "marketplace", "add", root, "--json"]);
    }
    const plugins = runJson(run, "codex", ["plugin", "list", "--marketplace", MARKETPLACE, "--json"]);
    if (!plugins || !Array.isArray(plugins.installed)) throw new Error("Lista de plugins Codex invalida.");
    const installed = plugins.installed.find((entry) => entry.pluginId === PLUGIN_ID && entry.installed);
    if (!installed) {
      run("codex", ["plugin", "add", PLUGIN_ID, "--json"]);
    } else if (installed.version !== version) {
      // Codex has no non-destructive update subcommand for installed local plugins.
      throw new Error("Codex tem FXMIND " + installed.version + "; atualizacao exige reinstalacao explicita. " +
        "Use 'codex plugin remove " + PLUGIN_ID + "' e depois 'fxmind plugin codex'.");
    }
  }
  log("FXMIND Plugin " + version + " instalado/atualizado no " + client + ".");
  log("Plugin somente com skills: MCP e memorias do projeto preservados.");
  return { client, marketplace: root, version };
}

function runPluginCli(argv) {
  if (!argv.length || (argv.length === 1 && ["-h", "--help", "help"].includes(argv[0]))) {
    console.log(usage());
    return 0;
  }
  if (argv.length !== 1 || !CLIENTS.has(argv[0])) {
    console.error(usage());
    return 1;
  }
  try {
    installPlugin(argv[0]);
    return 0;
  } catch (error) {
    console.error("Erro ao instalar FXMIND Plugin: " + error.message);
    return 1;
  }
}

module.exports = { installPlugin, runPluginCli, copySkillOnlyBundle, installCatalog, usage };
