/**
 * Decide whether the Cursor `stop` hook may auto-submit a Gate V/C reminder.
 * User abort / "pare" must not restart the agent.
 */

const fs = require("fs");

const MAX_FOLLOWUPS = 1;

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

function lastUserTextFromParsed(parsed) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed.role || parsed.type || parsed.kind)) {
    parsed = [parsed];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed?.messages || parsed?.conversation || parsed?.items || [];
  if (!Array.isArray(list) || list.length === 0) return "";
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    const role = messageRole(msg);
    if (role === "user" || role === "human") {
      return messageText(msg);
    }
  }
  return "";
}

function lastUserTextFromTranscript(raw) {
  if (!raw || !String(raw).trim()) return "";
  const text = String(raw);
  try {
    return lastUserTextFromParsed(JSON.parse(text));
  } catch {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const found = lastUserTextFromParsed(JSON.parse(lines[i]));
        if (found) return found;
      } catch {
        // skip malformed jsonl
      }
    }
  }
  return "";
}

function lastUserTextFromPayload(payload = {}) {
  const direct =
    payload.last_user_message ||
    payload.user_message ||
    payload.prompt ||
    payload.text;
  if (direct) return String(direct);

  const transcriptPath =
    payload.transcript_path ||
    payload.transcriptPath ||
    process.env.CURSOR_TRANSCRIPT_PATH;
  if (!transcriptPath) return "";
  try {
    const raw = fs.readFileSync(transcriptPath, "utf8");
    return lastUserTextFromTranscript(raw);
  } catch {
    return "";
  }
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
  if (isUserStop(input.lastUserText || lastUserTextFromPayload(input))) {
    return false;
  }
  return true;
}

module.exports = {
  MAX_FOLLOWUPS,
  isUserStop,
  lastUserTextFromTranscript,
  lastUserTextFromPayload,
  shouldFollowup,
};
