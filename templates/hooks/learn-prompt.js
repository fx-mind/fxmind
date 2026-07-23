#!/usr/bin/env node
/**
 * fxmind learn-prompt — Cursor stop hook.
 *
 * If a fxmind task is active (`.fxmind/fxmind-gates.json` taskActive=true) and Gates
 * A & B are complete but Gate C is not, emit a follow-up message reminding the
 * agent to finish post-task learning (Gate C) and suggest /fxmind graph.
 *
 * Fail-open: any error → no follow-up.
 */
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = process.cwd();
const GATES_FILE = path.join(PROJECT_ROOT, ".fxmind", "fxmind-gates.json");
const LEGACY_GATES_FILE = path.join(PROJECT_ROOT, ".fxmind-gates.json");

function migrateLegacyGates() {
  if (fs.existsSync(GATES_FILE) || !fs.existsSync(LEGACY_GATES_FILE)) {
    return;
  }
  fs.mkdirSync(path.dirname(GATES_FILE), { recursive: true });
  fs.copyFileSync(LEGACY_GATES_FILE, GATES_FILE);
  fs.unlinkSync(LEGACY_GATES_FILE);
}

function readGates() {
  try {
    migrateLegacyGates();
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
  const v = gates.gates && gates.gates.V && gates.gates.V.complete;
  const c = gates.gates && gates.gates.C && gates.gates.C.complete;

  if (!a || !b) {
    // Task wasn't properly gated — don't nag.
    noop();
  }

  if (c) {
    noop();
  }

  if (!v) {
    followup(
      "fxmind: Gate V (verify by observation) is still pending before Gate C. Re-run the Done check from Gate A (ensure+console_tail / tests / lint as applicable). If you fixed a defect, search for twins and include TWINS: searched <pattern> — found: <files|none>. Then call fxmind_record_gate gate=V. After V, finish Gate C (learn or \"mudança pontual\"). Never Write the gates JSON.",
    );
  }

  followup(
    "fxmind: Gate C (post-task learning) is still pending. If the user corrected your work, ask (AskQuestion) whether to save: memory Pitfalls, skill correction (.fxmind/corrections via fxmind_record_correction), both, or neither. Decide reusable knowledge: if yes, update .fxmind/memory/<topic>.md then call fxmind_validate_memories and fxmind_record_gate gate=C; if not, state \"mudança pontual\" and call fxmind_record_gate gate=C. Never Write the gates JSON. Suggest fxmind_graph if memory changed.",
  );
}

main();
