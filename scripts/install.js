#!/usr/bin/env node

/**
 * fxmind installer — CLI entry point.
 * Orchestrates the install/update flow; logic lives under scripts/install/.
 */
const fs = require("fs");

const { npxInstall } = require("./constants");
const { runHooksCli } = require("./hooks");
const { maybeSelfUpdateAndReexec } = require("./self-update");
const { runPackCli } = require("./pack-new");
const { isGlobalStore } = require("./global-store");

const { AGENTS, DEFAULT_AGENTS } = require("./install/config");
const state = require("./install/state");
const {
  printVersion,
  printHelp,
  parseArgs,
  wantsInteractive,
  ensureNonInteractiveChoice,
  promptSelections,
} = require("./install/cli");
const {
  getManagedSkillNames,
  cleanUnselectedAgents,
  migrateLegacyMemories,
  cleanLegacyAgentMemories,
  migrateAndCleanLegacyAgentArtifacts,
  migrateLegacySharedDir,
  refreshSharedAuditLayout,
  printLegacyAuditLayoutWarning,
} = require("./install/legacy");
const {
  resolveAgents,
  resolveInstallAgentIds,
  resolveUpdateOptions,
  installAgentsLayer,
} = require("./install/agents");
const {
  listAllSkills,
  installPackSkillsLayer,
  resolvePackOptions,
} = require("./install/skills");
const {
  installSharedFxmind,
  writePacksManifest,
  cleanLegacyAgentFivemTemplates,
  applyGlobalStore,
  printGlobalStoreWarnings,
  writeProjectLockfile,
  printLockSummary,
} = require("./install/shared");
const {
  shouldInstallHooks,
  shouldInstallMcp,
  shouldRefreshFivem,
  installProjectCursorIntegration,
} = require("./install/integrations");
const {
  runCorrectionsCli,
  runFivemCli,
  runDbCli,
  runMigrateCli,
} = require("./install/subcommands");

function formatAgentKind(kind) {
  const labels = {
    skill: "skill   ",
    command: "command ",
    subagent: "agent   ",
    instruction: "instr   ",
  };
  return labels[kind] || `${kind} `;
}

async function main() {
  const argv = process.argv.slice(2);

  if (
    argv.length === 1 &&
    (argv[0] === "-v" || argv[0] === "--version" || argv[0] === "version")
  ) {
    printVersion();
    process.exit(0);
  }

  if (argv[0] === "graph") {
    const { runGraphCli } = require("./build-graph");
    process.exit(runGraphCli(argv.slice(1)));
  }

  if (argv[0] === "global") {
    const { runGlobalCli } = require("./global-store");
    process.exit(runGlobalCli(argv.slice(1)));
  }

  if (argv[0] === "hooks") {
    process.exit(runHooksCli(argv.slice(1)));
  }

  if (argv[0] === "memory") {
    const sub = argv[1] || "validate";
    if (sub === "validate" || sub === "validate-memories") {
      process.exit(runHooksCli(["validate-memories", ...argv.slice(2)]));
    }
    console.error(`Unknown memory subcommand: ${sub}`);
    console.error("Usage: fxmind memory validate [--target <dir>] [--strict]");
    process.exit(1);
  }

  if (argv[0] === "corrections" || argv[0] === "correction") {
    process.exit(runCorrectionsCli(argv.slice(1)));
  }

  if (argv[0] === "fivem" || argv[0] === "rcon") {
    process.exitCode = 0;
    runFivemCli(argv.slice(1)).then((code) => process.exit(code));
    return;
  }

  if (argv[0] === "db" || argv[0] === "mysql") {
    process.exitCode = 0;
    runDbCli(argv.slice(1)).then((code) => process.exit(code));
    return;
  }

  if (argv[0] === "pack") {
    process.exit(runPackCli(argv.slice(1)));
  }

  if (argv[0] === "migrate") {
    process.exit(runMigrateCli(argv.slice(1)));
  }

  const options = parseArgs(argv);

  if (options.version) {
    printVersion();
    process.exit(0);
  }

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!fs.existsSync(options.target)) {
    console.error(`Error: target directory does not exist: ${options.target}`);
    process.exit(1);
  }

  if (options.update) {
    maybeSelfUpdateAndReexec(argv, options);

    if (options.interactive || options.allPacks || options.noPacks || options.explicitPacks) {
      console.error("Error: --update cannot be combined with pack selection flags.");
      process.exit(1);
    }

    try {
      resolveUpdateOptions(options);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }

    const skills = options.skills;
    const packs = options.packs;
    const agents = resolveAgents(options.agents);
    const manifestMeta = {
      agents: agents.map((agent) => agent.id),
      skills,
      command: options.command,
    };

    console.log(`\nUpdating: ${options.target}`);
    console.log(`Packs: ${packs.join(", ")}`);
    for (const packId of packs) {
      const source = [...state.SKILL_SOURCES.values()].find((entry) => entry.packId === packId);
      if (source) {
        console.log(`  ${packId} skills → ${source.skillsDir}`);
      }
    }
    console.log(`Skills: ${skills.length ? skills.join(", ") : "(none)"}`);
    console.log(
      `Agents: ${agents.map((agent) => agent.label).join(", ")}\n`,
    );

    const layoutRefresh = refreshSharedAuditLayout(options.target);
    if (layoutRefresh.length > 0) {
      console.log("[Layout]");
      for (const dest of layoutRefresh) {
        console.log(`  ✓ ${dest}`);
      }
      console.log("");
    }

    if (options.command) {
      console.log("[Shared .fxmind]");
      const shared = installSharedFxmind(options.target, packs, {
        preserveUserData: true,
        manifestMeta,
      });
      for (const dest of shared.installed) {
        console.log(`  ✓ template → ${dest}`);
      }

      const lockData = writeProjectLockfile(options.target, packs);
      if (lockData) {
        printLockSummary(lockData);
      }

      const packSkills = installPackSkillsLayer(
        options.target,
        skills,
        listAllSkills(),
        { globalStore: options.globalStore || isGlobalStore(options.target) },
      );
      for (const dest of packSkills.installed) {
        console.log(`  ✓ pack skill → ${dest}`);
      }
      if (packSkills.index) {
        console.log(`  ✓ index    → ${packSkills.index}`);
      }
      for (const dest of packSkills.removed) {
        console.log(`  ✓ cleanup  → ${dest} (removed from agent folder)`);
      }

      const globalStore = applyGlobalStore(
        options.target,
        packs,
        options.globalStore || isGlobalStore(options.target),
      );
      if (globalStore) {
        console.log(`  ✓ global   → ${globalStore.globalProjectDir}`);
        console.log(`  ✓ shared   → ${globalStore.sharedSkills}`);
      }
      printGlobalStoreWarnings(globalStore);
      console.log("");
    } else {
      writePacksManifest(options.target, packs, manifestMeta);
    }

    let lastAgentLabel = "";
    for (const entry of installAgentsLayer(options.target, agents, options)) {
      if (entry.agent !== lastAgentLabel) {
        if (lastAgentLabel) {
          console.log("");
        }
        console.log(`[${entry.agent}]`);
        lastAgentLabel = entry.agent;
      }
      console.log(`  ✓ ${formatAgentKind(entry.kind)} → ${entry.path}`);
    }
    if (lastAgentLabel) {
      console.log("");
    }

    if (shouldInstallHooks(options, agents) || shouldInstallMcp(options, agents) || shouldRefreshFivem(options, packs)) {
      installProjectCursorIntegration(options.target, options, agents, packs);
    }

    console.log("Update complete.");
    console.log("Refreshed: templates, skills, agent commands, hooks (Cursor), MCP, FiveM RCON/fivem-start (when applicable).");
    printLegacyAuditLayoutWarning(options.target);
    console.log("Restart your agent IDE/CLI or open a new session.");
    console.log(`Refresh again anytime: ${npxInstall("--update -y")}`);
    console.log("Gemini: run /commands reload after update.");
    return;
  }

  if (wantsInteractive(options)) {
    const selections = await promptSelections();

    if (!selections) {
      console.log("Installation cancelled.");
      process.exit(0);
    }

    options.packs = selections.packs;
    options.agents = selections.agents;
    options.skills = selections.skills;
    options.command = selections.command;
    state.SKILL_SOURCES = selections.packSources;

    console.log(
      `\nPacks: ${selections.packs.length ? selections.packs.join(", ") : "(core only)"}`,
    );
    console.log(
      `Agents: ${selections.agents.map((id) => AGENTS[id].label).join(", ")}`,
    );
    console.log(
      `Skills: ${selections.skills.length ? selections.skills.join(", ") : "(none)"}`,
    );
    console.log(`Helper /fxmind: ${selections.command ? "yes" : "no"}\n`);
  } else {
    ensureNonInteractiveChoice(options);

    if (!options.agents) {
      options.agents = [...DEFAULT_AGENTS];
    }

    try {
      resolvePackOptions(options);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  const skills = options.skills;
  const packs = options.packs;

  resolveInstallAgentIds(options.target, options);
  const agents = resolveAgents(options.agents);
  const managedSkills = getManagedSkillNames(skills, options.command);

  if (skills.length === 0 && !options.command) {
    console.error("Error: select at least one skill or keep /fxmind helper enabled.");
    process.exit(1);
  }

  if (options.replaceAgents) {
    cleanUnselectedAgents(
      options.target,
      agents.map((agent) => agent.id),
      managedSkills,
    );
  }

  console.log(`\nInstalling to: ${options.target}`);
  if (packs.length > 0) {
    console.log(`Packs: ${packs.join(", ")}`);
    for (const packId of packs) {
      const source = [...state.SKILL_SOURCES.values()].find((entry) => entry.packId === packId);
      if (source) {
        console.log(`  ${packId} skills → ${source.skillsDir}`);
      }
    }
  } else {
    console.log("Packs: (core only)");
  }
  console.log(
    `Agents: ${agents.map((agent) => agent.label).join(", ")}\n`,
  );

  if (options.command) {
    console.log("[Shared .fxmind]");

    const legacyShared = migrateLegacySharedDir(options.target);
    for (const action of legacyShared) {
      if (action.type === "migrated") {
        console.log(`  ✓ migrated → ${action.to} (from ${action.from})`);
      } else if (action.type === "removed") {
        console.log(`  ✓ removed  → ${action.path} (legacy shared dir)`);
      }
    }

    const shared = installSharedFxmind(options.target, packs, {
      manifestMeta: {
        agents: agents.map((agent) => agent.id),
        skills,
        command: options.command,
      },
    });
    for (const dest of shared.removed) {
      console.log(`  ✓ cleanup  → ${dest}`);
    }
    for (const dest of shared.installed) {
      console.log(`  ✓ template → ${dest}`);
    }

    const lockData = writeProjectLockfile(options.target, packs);
    if (lockData) {
      printLockSummary(lockData);
    }

    const migration = migrateLegacyMemories(options.target);
    for (const action of migration.actions) {
      if (action.type === "migrated") {
        console.log(`  ✓ migrated → ${action.to} (from ${action.from})`);
      } else if (action.type === "merged") {
        console.log(`  ✓ merged   → ${action.to} (kept newer from ${action.from})`);
      }
    }
    if (migration.mergedIndex) {
      console.log(`  ✓ index    → ${migration.mergedIndex} (merged legacy rows)`);
    }

    const legacyMemoryCleanup = cleanLegacyAgentMemories(options.target);
    for (const dest of legacyMemoryCleanup) {
      console.log(`  ✓ removed  → ${dest}`);
    }

    const legacyArtifacts = migrateAndCleanLegacyAgentArtifacts(options.target);
    for (const dest of legacyArtifacts.migrated) {
      console.log(`  ✓ artifact → ${dest} (from legacy agent folder)`);
    }
    for (const dest of legacyArtifacts.removed) {
      console.log(`  ✓ removed  → ${dest}`);
    }

    const legacyCleanup = cleanLegacyAgentFivemTemplates(options.target, packs);
    for (const dest of legacyCleanup) {
      console.log(`  ✓ legacy   → removed ${dest}`);
    }

    const packSkills = installPackSkillsLayer(
      options.target,
      skills,
      listAllSkills(),
      { globalStore: options.globalStore || isGlobalStore(options.target) },
    );
    for (const dest of packSkills.installed) {
      console.log(`  ✓ pack skill → ${dest}`);
    }
    if (packSkills.index) {
      console.log(`  ✓ index    → ${packSkills.index}`);
    }
    for (const dest of packSkills.removed) {
      console.log(`  ✓ cleanup  → ${dest} (removed from agent folder)`);
    }

    const globalStore = applyGlobalStore(
      options.target,
      packs,
      options.globalStore || isGlobalStore(options.target),
    );
    if (globalStore) {
      console.log(`  ✓ global   → ${globalStore.globalProjectDir}`);
      console.log(`  ✓ shared   → ${globalStore.sharedSkills}`);
    }
    printGlobalStoreWarnings(globalStore);

    console.log("");
  }

  let lastAgentLabel = "";
  for (const entry of installAgentsLayer(options.target, agents, options)) {
    if (entry.agent !== lastAgentLabel) {
      if (lastAgentLabel) {
        console.log("");
      }
      console.log(`[${entry.agent}]`);
      lastAgentLabel = entry.agent;
    }
    console.log(`  ✓ ${formatAgentKind(entry.kind)} → ${entry.path}`);
  }
  if (lastAgentLabel) {
    console.log("");
  }

  if (shouldInstallHooks(options, agents) || shouldInstallMcp(options, agents) || shouldRefreshFivem(options, packs)) {
    installProjectCursorIntegration(options.target, options, agents, packs);
  }

  console.log("Done.");
  console.log("Restart your agent IDE/CLI or open a new session.");
  console.log(`Update packs/skills: ${npxInstall("--update -y")}  (or after global: fxmind --update -y)`);
  console.log(`Reinstall from scratch: ${npxInstall("-y")}  (or after global: fxmind -y)`);
  console.log(
    "Cursor/Claude/OpenCode: /fxmind  |  Codex: $fxmind  |  Gemini: /fxmind, /fxmind:reference, /fxmind:audit, /fxmind:learn, /fxmind:memory, /fxmind:graph",
  );
  console.log("Gemini: run /commands reload after install.");
  console.log(
    "Run /fxmind reference (or /fxmind:reference) to generate reference.mdc at project root.",
  );
  console.log("Run /fxmind audit [scope] for security/perf/pattern audit + fix plan.");
  console.log(
    "Run /fxmind learn <topic> to scan the codebase and save compact English topic memory under .fxmind/memory/ (shared by all agents).",
  );
  console.log(
    "Run /fxmind memory health [fix] [topic] to verify memories vs codebase and optionally compact-rewrite stale topics.",
  );
  console.log(
    "Run fxmind graph (or /fxmind graph) to build a static 3D knowledge map and open it in the browser.",
  );
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
