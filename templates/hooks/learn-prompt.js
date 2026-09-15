#!/usr/bin/env node
/**
 * fxmind learn-prompt — Cursor stop hook.
 *
 * If a fxmind task is active and Gates A & B are complete but C is not, emit a
 * short follow-up so the agent finishes V/C. Cursor submits followup_message as
 * the next user message — never dump the gate playbook into chat.
 *
 * Skip when the user aborted/paused, the agent already handed off, or this task
 * session already received one nag (Cursor loop_count resets on each user turn).
 *
 * Fail-open: any error → no follow-up.
 */
const fs = require("fs");
const path = require("path");
const {
  shouldFollowup,
  lastUserTextFromPayload,
  lastAssistantTextFromPayload,
  claimSessionNag,
  GATE_V_REMINDER,
  GATE_C_REMINDER,
} = require("./lib/stop-followup.js");

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
  const lastAssistantText = lastAssistantTextFromPayload(payload);
  if (
    !shouldFollowup({
      status: payload.status,
      loop_count: payload.loop_count ?? payload.loopCount,
      lastUserText,
      lastAssistantText,
    })
  ) {
    noop();
  }

  if (!claimSessionNag(PROJECT_ROOT, gates.sessionId)) {
    noop();
  }

  if (!v) {
    followup(GATE_V_REMINDER);
  }

  followup(GATE_C_REMINDER);
}

main().catch(() => noop());
