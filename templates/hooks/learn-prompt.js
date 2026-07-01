#!/usr/bin/env node
/**
 * fxmind learn-prompt — Cursor stop hook.
 *
 * If a fxmind task is active (`.fxmind-gates.json` taskActive=true) and Gates
 * A & B are complete but Gate C is not, emit a follow-up message reminding the
 * agent to finish post-task learning (Gate C) and suggest /fxmind graph.
 *
 * Fail-open: any error → no follow-up.
 */
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = process.cwd();
const GATES_FILE = path.join(PROJECT_ROOT, ".fxmind-gates.json");

function readGates() {
  try {
    if (!fs.existsSync(GATES_FILE)) return null;
    return JSON.parse(fs.readFileSync(GATES_FILE, "utf8"));
  } catch {
    return null;
  }
}

function followup(message) {
  process.stdout.write(JSON.stringify({ followup_message: message }));
  process.exit(0);
}

function noop() {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

function main() {
  const gates = readGates();
  if (!gates || !gates.taskActive) {
    noop();
  }
  const a = gates.gates && gates.gates.A && gates.gates.A.complete;
  const b = gates.gates && gates.gates.B && gates.gates.B.complete;
  const c = gates.gates && gates.gates.C && gates.gates.C.complete;

  if (!a || !b) {
    // Task wasn't properly gated — don't nag.
    noop();
  }

  if (c) {
    noop();
  }

  followup(
    "fxmind: Gate C (post-task learning) is still pending. If the user corrected your work during this task, you should have asked whether to save that correction to memory (Pitfalls / new topic / skip). Decide whether the work produced reusable knowledge: if yes, create/update the relevant .fxmind/memory/<topic>.md via /fxmind learn <topic> and record Gate C; if not, state \"mudança pontual\" and record Gate C. Then suggest /fxmind graph if memory changed. Finally, clear taskActive in .fxmind-gates.json.",
  );
}

main();
