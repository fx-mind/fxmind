#!/usr/bin/env node
/**
 * fxmind learn-prompt — Cursor stop hook.
 *
 * If a fxmind task is active (`.fxmind/state/fxmind-gates.json` taskActive=true) and Gates
 * A & B are complete but Gate C is not, emit a follow-up message reminding the
 * agent to finish post-task learning (Gate C) and suggest /fxmind graph.
 *
 * Never auto-continue when the user aborted/paused, or after the first reminder
 * (stop-hook follow-ups otherwise loop: reminder → agent work → stop → reminder).
 *
 * Fail-open: any error → no follow-up.
 */
const fs = require("fs");
const path = require("path");
const { shouldFollowup, lastUserTextFromPayload } = require("./lib/stop-followup.js");

const { writeLocal, fxmindDir } = require("./lib/layout.js");

const PROJECT_ROOT = process.cwd();
const GATES_FILE = writeLocal(PROJECT_ROOT, "gates");
const V2_GATES_FILE = path.join(fxmindDir(PROJECT_ROOT), "fxmind-gates.json");
const LEGACY_GATES_FILE = path.join(PROJECT_ROOT, ".fxmind-gates.json");

function readStdin(ms = 2000) {
  return new Promise((resolve) => {
    let data = "";
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };
    const timer = setTimeout(() => finish(data), ms);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      finish(data);
    });
    if (process.stdin.isTTY) {
      clearTimeout(timer);
      finish("");
    }
  });
}

function migrateLegacyGates() {
  if (fs.existsSync(GATES_FILE)) {
    return;
  }
  const source = fs.existsSync(V2_GATES_FILE)
    ? V2_GATES_FILE
    : fs.existsSync(LEGACY_GATES_FILE)
      ? LEGACY_GATES_FILE
      : null;
  if (!source) {
    return;
  }
  fs.mkdirSync(path.dirname(GATES_FILE), { recursive: true });
  fs.copyFileSync(source, GATES_FILE);
  fs.unlinkSync(source);
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

const GATE_V_REMINDER =
  "fxmind: Gate V (verify by observation) is still pending before Gate C. If the user asked to stop/pause, stay stopped — no edits, no tools, no gates. Otherwise re-run the Done check from Gate A (ensure+console_tail / tests / lint as applicable). If you fixed a defect, search for twins and include TWINS: searched <pattern> — found: <files|none>. Then call fxmind_record_gate gate=V. After V, finish Gate C (learn or \"mudança pontual\"). Never Write the gates JSON.";

const GATE_C_REMINDER =
  "fxmind: Gate C (post-task learning) is still pending. If the user asked to stop/pause, stay stopped — no edits, no tools, no gates. Otherwise, if the user corrected your work, ask (AskQuestion) whether to save: memory Pitfalls, skill correction (.fxmind/corrections via fxmind_record_correction), both, or neither. Decide reusable knowledge: if yes, update .fxmind/memory/<topic>.md then call fxmind_validate_memories and fxmind_record_gate gate=C; if not, state \"mudança pontual\" and call fxmind_record_gate gate=C. Never Write the gates JSON. Suggest fxmind_graph if memory changed.";

async function main() {
  try {
    const { cleanupFxmindTmp } = require("./lib/cleanup-tmp.js");
    cleanupFxmindTmp(PROJECT_ROOT);
  } catch {
    // fail-open
  }

  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const gates = readGates();
  if (!gates || !gates.taskActive) {
    noop();
  }
  const a = gates.gates && gates.gates.A && gates.gates.A.complete;
  const b = gates.gates && gates.gates.B && gates.gates.B.complete;
  const v = gates.gates && gates.gates.V && gates.gates.V.complete;
  const c = gates.gates && gates.gates.C && gates.gates.C.complete;

  if (!a || !b) {
    noop();
  }

  if (c) {
    noop();
  }

  const lastUserText = lastUserTextFromPayload(payload);
  if (
    !shouldFollowup({
      status: payload.status,
      loop_count: payload.loop_count ?? payload.loopCount,
      lastUserText,
    })
  ) {
    noop();
  }

  if (!v) {
    followup(GATE_V_REMINDER);
  }

  followup(GATE_C_REMINDER);
}

main().catch(() => noop());
