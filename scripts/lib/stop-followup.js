/**
 * Decide whether the Cursor `stop` hook may auto-submit a Gate V/C reminder.
 *
 * Cursor submits `followup_message` as the next *user* message, so the text
 * must stay short and free of agent playbooks. User abort / "pare", an already
 * parked handoff, or a nag already sent for this task must not restart the agent.
 */

const fs = require("fs");
const path = require("path");

const MAX_FOLLOWUPS = 1;

const GATE_V_REMINDER =
  "fxmind: finish Gate V, then Gate C. Stay stopped if the user asked to pause.";
const GATE_C_REMINDER =
  "fxmind: finish Gate C. Stay stopped if the user asked to pause.";

const STOP_WHOLE = new Set([
  "pare",
  "parem",
  "parar",
  "para",
  "stop",
  "halt",
  "pause",
  "pausa",
  "pausar",
  "cancela",
  "cancelar",
  "cancel",
  "chega",
  "basta",
  "espera",
]);

const STOP_PREFIX =
  /^(?:(?:pode|please|pls)\s+)?(?:parar|pare|stop|pause|pausa|pausar|cancel(?:ar|a)?|halt)(?:\s+(?:generating|please|agora|j[aá]|a[íi]))?\s*$/i;

const USER_ROLES = new Set(["user", "human"]);
const ASSISTANT_ROLES = new Set(["assistant", "ai", "model", "bot"]);

const GATE_PENDING =
  /(?:gate\s*v|gate\s*c).{0,220}(?:blocked|blocker|incompleto|incomplete|pendente|pending|não fecha)|requires Gate V first|serverReachable:\s*false/i;
const ASK_USER =
  /\b(?:avise|avisa|tell me when|when you(?:'ve| have)|suba o (?:fx)?server|start(?: the)? fxserver|aguardando você|waiting (?:on|for) (?:you|the user)|quando estiver|let me know)\b/i;

function firstLine(text) {
  return String(text || "")
    .trim()
    .split(/\r?\n/)[0]
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, "");
}

function isUserStop(text) {
  const line = firstLine(text).replace(/[.!?…]+$/g, "").trim();
  if (!line) return false;
  const lower = line.toLowerCase();
  if (STOP_WHOLE.has(lower)) return true;
  if (/^para\s+(?:a[íi]|j[aá]|agora)\s*$/i.test(line)) return true;
  if (STOP_PREFIX.test(line)) return true;
  return false;
}

function isOwnFollowup(text) {
  const line = firstLine(text);
  return /^fxmind:/i.test(line) && /\bGate [VC]\b/i.test(line);
}

function isAgentHandoff(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  return GATE_PENDING.test(value) && ASK_USER.test(value);
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      if (part && typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function messageRole(msg) {
  return String(msg?.role || msg?.type || msg?.kind || "").toLowerCase();
}

function messageText(msg) {
  if (!msg || typeof msg !== "object") return "";
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.content === "string" || Array.isArray(msg.content)) {
    return textFromContent(msg.content);
  }
  if (msg.message) return messageText(msg.message);
  return "";
}

function lastTextFromParsed(parsed, roles) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed.role || parsed.type || parsed.kind)) {
    parsed = [parsed];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed?.messages || parsed?.conversation || parsed?.items || [];
  if (!Array.isArray(list) || list.length === 0) return "";
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (roles.has(messageRole(msg))) {
      return messageText(msg);
    }
  }
  return "";
}

function lastTextFromTranscript(raw, roles) {
  if (!raw || !String(raw).trim()) return "";
  const text = String(raw);
  try {
    return lastTextFromParsed(JSON.parse(text), roles);
  } catch {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const found = lastTextFromParsed(JSON.parse(lines[i]), roles);
        if (found) return found;
      } catch {
        // skip malformed jsonl
      }
    }
  }
  return "";
}

function transcriptPathFromPayload(payload = {}) {
  return (
    payload.transcript_path ||
    payload.transcriptPath ||
    process.env.CURSOR_TRANSCRIPT_PATH ||
    ""
  );
}

function lastUserTextFromTranscript(raw) {
  return lastTextFromTranscript(raw, USER_ROLES);
}

function lastAssistantTextFromTranscript(raw) {
  return lastTextFromTranscript(raw, ASSISTANT_ROLES);
}

function lastUserTextFromPayload(payload = {}) {
  const direct =
    payload.last_user_message ||
    payload.user_message ||
    payload.prompt ||
    payload.text;
  if (direct) return String(direct);

  const transcriptPath = transcriptPathFromPayload(payload);
  if (!transcriptPath) return "";
  try {
    return lastUserTextFromTranscript(fs.readFileSync(transcriptPath, "utf8"));
  } catch {
    return "";
  }
}

function lastAssistantTextFromPayload(payload = {}) {
  const direct =
    payload.last_assistant_message ||
    payload.assistant_message ||
    payload.completion;
  if (direct) return String(direct);

  const transcriptPath = transcriptPathFromPayload(payload);
  if (!transcriptPath) return "";
  try {
    return lastAssistantTextFromTranscript(fs.readFileSync(transcriptPath, "utf8"));
  } catch {
    return "";
  }
}

function nagStatePath(projectRoot) {
  return path.join(projectRoot, ".fxmind", "state", "stop-followup.json");
}

/**
 * Persist one visible nag per task session. Cursor's loop_count resets on each
 * real user turn, which would otherwise re-inject the reminder after every reply.
 */
function claimSessionNag(projectRoot, sessionId) {
  const id = String(sessionId || "legacy").trim() || "legacy";
  const file = nagStatePath(projectRoot);
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    state = {};
  }
  if (state.sessionId === id && state.sent) {
    return false;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ sessionId: id, sent: true, at: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch {
    // still nag this turn if we cannot persist
  }
  return true;
}

function shouldFollowup(input = {}) {
  const status = String(input.status || "completed").toLowerCase();
  if (status === "aborted" || status === "error" || status === "cancelled" || status === "canceled") {
    return false;
  }
  const loopCount = Number(input.loop_count ?? input.loopCount ?? 0);
  if (!Number.isFinite(loopCount) || loopCount >= MAX_FOLLOWUPS) {
    return false;
  }
  const lastUserText = input.lastUserText || lastUserTextFromPayload(input);
  if (isUserStop(lastUserText) || isOwnFollowup(lastUserText)) {
    return false;
  }
  const lastAssistantText = input.lastAssistantText || lastAssistantTextFromPayload(input);
  if (isAgentHandoff(lastAssistantText)) {
    return false;
  }
  return true;
}

module.exports = {
  MAX_FOLLOWUPS,
  GATE_V_REMINDER,
  GATE_C_REMINDER,
  isUserStop,
  isOwnFollowup,
  isAgentHandoff,
  lastUserTextFromTranscript,
  lastUserTextFromPayload,
  lastAssistantTextFromTranscript,
  lastAssistantTextFromPayload,
  claimSessionNag,
  nagStatePath,
  shouldFollowup,
};
