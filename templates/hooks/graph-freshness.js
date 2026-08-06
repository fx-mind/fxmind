#!/usr/bin/env node
/**
 * fxmind graph-freshness — Cursor sessionStart hook.
 * Rebuilds knowledge-graph.json + memory-index when memories are newer than the graph.
 * Fail-open: any error → empty JSON.
 */
const { spawnSync } = require("child_process");

const PROJECT_ROOT = process.cwd();

function respond(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function main() {
  try {
    const disable =
      process.env.FXMIND_GRAPH_NO_AUTO &&
      process.env.FXMIND_GRAPH_NO_AUTO !== "0" &&
      process.env.FXMIND_GRAPH_NO_AUTO.toLowerCase() !== "false";
    if (disable) {
      respond({});
      return;
    }

    const bin = process.env.FXMIND_BIN || "fxmind";
    spawnSync(bin, ["graph", "--no-open", "--no-html"], {
      cwd: PROJECT_ROOT,
      timeout: 12000,
      stdio: "ignore",
      shell: true,
    });
  } catch {
    // fail-open
  }
  respond({});
}

main();
