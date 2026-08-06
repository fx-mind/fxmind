#!/usr/bin/env node
/**
 * fxmind update-notifier — Cursor sessionStart hook.
 * Injects additional_context when a newer fxmind version or layout is available.
 * Fail-open: any error → empty JSON.
 */
const { checkForUpdate, buildAgentContext } = require("./lib/update-check.js");

function respond(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

async function main() {
  try {
    const result = await checkForUpdate({
      projectRoot: process.cwd(),
      markNotified: true,
    });
    const context = buildAgentContext(result);
    if (context) {
      respond({ additional_context: context });
    }
    respond({});
  } catch {
    respond({});
  }
}

main();
