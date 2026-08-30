/**
 * Normalize OpenCode / Codex / plain CLI stdout into chat events.
 */

const GATE_RE = /🛑\s*GATE\s+([ABVC])\s+COMPLETE[^\n]*/gi;
const TODO_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;
const ASK_FENCE_RE =
  /(?:^|\r?\n)[ \t]*```[ \t]*fxmind-ask[ \t]*\r?\n([\s\S]*?)[ \t]*```(?=$|\r?\n)/gi;

function isMcpTool(name, server) {
  const key = String(name || "").toLowerCase();
  return Boolean(server) || key.startsWith("fxmind_") || key.startsWith("mcp");
}

function toolLabel(name, detail, kind = "") {
  const key = String(name || "").toLowerCase();
  const hint = String(detail || "").trim();
  const pathHint = hint && !/\s/.test(hint.slice(0, 80)) ? hint : "";
  if (kind === "mcp" || isMcpTool(name, "")) {
    return name ? String(name) : "ferramenta MCP";
  }
  if (/read|readfile/.test(key)) return pathHint ? `Leu ${pathHint}` : hint ? `Leu ${hint.slice(0, 80)}` : "Leu arquivo";
  if (/write|edit|strreplace|applypatch/.test(key)) {
    return pathHint ? `Editou ${pathHint}` : hint ? `Editou ${hint.slice(0, 80)}` : "Editou arquivo";
  }
  if (/grep|search|rg/.test(key)) return hint ? `Buscou ${hint.slice(0, 80)}` : "Buscou no código";
  if (/glob|list/.test(key)) return hint ? `Listou ${hint.slice(0, 80)}` : "Listou arquivos";
  if (/bash|shell|exec|command/.test(key)) return hint ? `Rodou ${hint.slice(0, 80)}` : "Rodou comando";
  if (name) return hint ? `${name} · ${hint.slice(0, 60)}` : String(name);
  return "Usou ferramenta";
}

function extractPath(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/(?:^|[\\/])[^\s"'`]+\.\w{1,8}\b/);
    return m ? m[0].replace(/^[/\\]/, "") : value.slice(0, 120);
  }
  if (typeof value === "object") {
    return (
      value.path ||
      value.file ||
      value.filePath ||
      value.target ||
      value.command ||
      value.query ||
      extractPath(value.input) ||
      extractPath(value.state) ||
      ""
    );
  }
  return "";
}

function extractDetail(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 160);
  if (typeof value !== "object") return "";
  const state = value.state && typeof value.state === "object" ? value.state : {};
  const parseInput = (candidate) => {
    if (candidate && typeof candidate === "object") return candidate;
    if (typeof candidate === "string") {
      try {
        const parsed = JSON.parse(candidate);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  };
  const input =
    parseInput(state.input) ||
    parseInput(value.input) ||
    parseInput(value.arguments) ||
    {};
  const command = input.command || value.command || "";
  const file = input.path || input.filePath || input.file || input.target || value.path || "";
  const query =
    input.question ||
    input.query ||
    input.pattern ||
    input.glob ||
    value.question ||
    value.query ||
    "";
  const gate = input.gate || value.gate || "";
  const title = state.title || value.title || input.description || "";
  if (command) return String(command).slice(0, 160);
  if (file) return String(file).slice(0, 160);
  if (query) return String(query).slice(0, 160);
  if (gate) return `Gate ${String(gate).slice(0, 40)}`;
  if (title) return String(title).slice(0, 160);
  return String(extractPath(value) || "").slice(0, 160);
}

function extractOutput(value) {
  if (!value || typeof value !== "object") return "";
  const state = value.state && typeof value.state === "object" ? value.state : value;
  const raw = state.output || state.result || value.output || "";
  if (typeof raw === "string") return raw.trim().slice(0, 800);
  try {
    return JSON.stringify(raw).slice(0, 800);
  } catch {
    return "";
  }
}

function collectText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collectText).filter(Boolean).join("");
  if (typeof node !== "object") return "";
  if (typeof node.text === "string") return node.text;
  if (typeof node.delta === "string") return node.delta;
  if (typeof node.content === "string") return node.content;
  if (Array.isArray(node.content)) return collectText(node.content);
  return "";
}

function parseTodosFromText(text) {
  const todos = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(TODO_RE);
    if (!m) continue;
    todos.push({
      content: m[2].trim(),
      status: m[1].trim() ? "done" : "pending",
    });
  }
  return todos;
}

function parseGatesFromText(text) {
  const gates = [];
  const re = new RegExp(GATE_RE.source, "gi");
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    gates.push({
      id: m[1].toUpperCase(),
      note: m[0].replace(/^🛑\s*/, "").trim(),
    });
  }
  return gates;
}

const VERDICT_RE = /VERDICT:\s*(VERIFIED WITH CAVEATS|VERIFIED|REFUTED)/i;
const VERDICT_MAP = {
  verified: "verified",
  "verified with caveats": "verified_with_caveats",
  refuted: "refuted",
};

/** Extracts a judge run's verdict line ("VERDICT: ...") plus a trailing summary. */
function parseVerdictFromText(text = "") {
  const str = String(text || "");
  const match = str.match(VERDICT_RE);
  const verdict = match ? VERDICT_MAP[match[1].toLowerCase()] || "unverifiable" : "unverifiable";
  const summary = str.trim().slice(-2000) || "O revisor não retornou texto.";
  return { verdict, summary };
}

function normalizeAskPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const question = String(payload.question || "").trim();
  if (!question || !Array.isArray(payload.options)) return null;

  const options = [];
  const seen = new Set();
  for (const option of payload.options.slice(0, 32)) {
    if (!option || typeof option !== "object") continue;
    const id = String(option.id || "").trim();
    const label = String(option.label || "").trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  if (!options.length) return null;

  const result = {
    kind: "ask",
    question,
    options,
    multi: payload.multi === true,
  };
  const id = String(payload.id || "").trim();
  if (id) result.id = id.slice(0, 120);
  return result;
}

function parseAskEventsFromText(text) {
  const events = [];
  const re = new RegExp(ASK_FENCE_RE.source, "gi");
  let match;
  while ((match = re.exec(String(text || ""))) !== null) {
    try {
      const payload = JSON.parse(String(match[1] || "").trim());
      const event = normalizeAskPayload(payload);
      if (event) events.push(event);
    } catch {
      // A malformed fenced payload is ordinary assistant text.
    }
  }
  return events;
}

function parseAskFromText(text) {
  return parseAskEventsFromText(text)[0] || null;
}

function visibleTextWithoutAsk(text) {
  const source = String(text || "");
  return source.replace(ASK_FENCE_RE, (full, body) => {
    try {
      return normalizeAskPayload(JSON.parse(String(body || "").trim())) ? "" : full;
    } catch {
      return full;
    }
  });
}

function textAndAskEvents(text) {
  const askEvents = parseAskEventsFromText(text);
  const visible = visibleTextWithoutAsk(text);
  return [
    ...(visible.trim() ? [{ kind: "text", text: visible }] : []),
    ...askEvents,
  ];
}

function toolEvent(name, detail, status = "running", output = "", metadata = {}) {
  const server = String(metadata.server || "").trim();
  const kind = metadata.kind || (isMcpTool(name, server) ? "mcp" : "tool");
  const label = toolLabel(name, detail, kind);
  return {
    kind,
    name: name || "tool",
    detail: detail ? String(detail).slice(0, 240) : "",
    output: output ? String(output).slice(0, 800) : "",
    label,
    status,
    ...(server ? { server } : {}),
  };
}

function fromPart(part, statusHint) {
  if (!part || typeof part !== "object") return [];
  const type = String(part.type || part.kind || "").toLowerCase();
  if (type === "text" || type === "output_text") {
    const text = collectText(part);
    return text ? [{ kind: "text", text }] : [];
  }
  if (type === "reasoning" || type === "think") {
    const text = collectText(part);
    return text ? [{ kind: "think", text }] : [];
  }
  if (
    type === "tool" ||
    type === "tool_use" ||
    type === "tool-call" ||
    type === "tool_call" ||
    type === "mcp_tool_call" ||
    type === "mcp-tool-call"
  ) {
    const name = part.tool || part.name || part.toolName || "tool";
    const detail = extractDetail(part);
    const status =
      part.status === "completed" ||
      part.status === "done" ||
      part.status === "error" ||
      part.state?.status === "completed" ||
      part.state?.status === "done" ||
      part.state?.status === "error" ||
      statusHint === "done"
        ? "done"
        : "running";
    return [
      toolEvent(name, detail, status, extractOutput(part), {
        kind: type.includes("mcp") ? "mcp" : undefined,
        server: part.server || part.serverName || part.mcpServer,
      }),
    ];
  }
  if (type === "step-start" || type === "step_start") {
    return [{ kind: "cli", label: "CLI: iniciou um passo", detail: "", status: "running" }];
  }
  if (type === "step-finish" || type === "step_finish") {
    const reason = String(part.reason || "").toLowerCase();
    if (reason === "tool-calls") {
      return [{ kind: "cli", label: "CLI: chamando ferramentas", detail: "", status: "running" }];
    }
    return [{ kind: "cli", label: "CLI: passo concluído", detail: reason, status: "done" }];
  }
  return [];
}

function parseJsonEvent(ev) {
  if (Array.isArray(ev)) return ev.flatMap(parseJsonEvent);
  if (!ev || typeof ev !== "object") return [];
  const type = String(ev.type || "").toLowerCase();
  const out = [];

  const sessionId = ev.sessionId || ev.sessionID || ev.part?.sessionID || ev.properties?.sessionID;
  if (sessionId) out.push({ kind: "session", sessionId });

  if (type === "item.started" || type === "item.updated") {
    const item = ev.item || {};
    const itemType = String(item.type || "").toLowerCase();
    if (itemType === "command" || itemType === "mcp_tool_call" || itemType === "file_change") {
      out.push(
        toolEvent(
          item.tool || item.toolName || item.name || item.command || itemType,
          extractDetail(item),
          "running",
          extractOutput(item),
          {
            kind: itemType === "mcp_tool_call" ? "mcp" : undefined,
            server: item.server || item.serverName || item.mcpServer,
          },
        ),
      );
      return out;
    }
    if (itemType === "agent_message" || itemType === "reasoning") {
      const text = collectText(item);
      if (text) out.push({ kind: itemType === "reasoning" ? "think" : "text", text });
    }
    return out;
  }

  if (type === "item.completed") {
    const item = ev.item || {};
    const itemType = String(item.type || "").toLowerCase();
    if (itemType === "agent_message") {
      const text = item.text || collectText(item);
      if (text) out.push({ kind: "text", text });
      return out;
    }
    if (itemType === "command" || itemType === "mcp_tool_call" || itemType === "file_change") {
      out.push(
        toolEvent(
          item.tool || item.toolName || item.name || item.command || itemType,
          extractDetail(item),
          "done",
          extractOutput(item),
          {
            kind: itemType === "mcp_tool_call" ? "mcp" : undefined,
            server: item.server || item.serverName || item.mcpServer,
          },
        ),
      );
      return out;
    }
  }

  if (
    type === "assistant" ||
    type === "text" ||
    type === "content" ||
    type === "reasoning" ||
    type === "message.part.updated" ||
    type === "message.part.delta"
  ) {
    const part = ev.part || ev.properties?.part;
    if (part) out.push(...fromPart(part));
    const text = collectText(ev);
    if (text && !part) {
      out.push({ kind: type === "reasoning" ? "think" : "text", text });
    }
    if (Array.isArray(ev.message?.content)) {
      for (const block of ev.message.content) out.push(...fromPart(block));
    }
    return out;
  }

  if (type.includes("tool")) {
    const partEvents = fromPart(ev.part || ev, /result|completed|done|end/.test(type) ? "done" : undefined);
    if (partEvents.length) {
      out.push(...partEvents);
      return out;
    }
    out.push(
      toolEvent(
        ev.name || ev.tool || ev.part?.tool,
        extractDetail(ev.input || ev.arguments || ev.part || ev),
        /result|completed|done|end/.test(type) ? "done" : "running",
        extractOutput(ev.part || ev),
        {
          server: ev.server || ev.serverName || ev.mcpServer || ev.part?.server,
          kind: isMcpTool(ev.name || ev.tool || ev.part?.tool, ev.server) ? "mcp" : undefined,
        },
      ),
    );
    return out;
  }

  if (type === "error") {
    const msg = ev.error?.message || collectText(ev) || "erro na CLI";
    out.push({ kind: "cli", label: "Erro", detail: String(msg).slice(0, 240), status: "error" });
    return out;
  }

  const nested = fromPart(ev.part);
  if (nested.length) {
    out.push(...nested);
    return out;
  }

  if (type && type !== "session") {
    const detail = extractDetail(ev.part || ev) || collectText(ev);
    out.push({
      kind: "cli",
      label: `CLI: ${type.replace(/_/g, " ")}`,
      detail: String(detail || "").slice(0, 240),
      status: "running",
    });
  }
  return out;
}

function unescapeLogValue(value) {
  return String(value || "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseOpencodeLogLine(line) {
  const raw = String(line || "");
  if (!raw.includes("message=")) return null;
  const fields = {};
  const ts = raw.match(/^timestamp=(\S+)/);
  const run = raw.match(/\brun=(\S+)/);
  if (ts) fields.timestamp = ts[1];
  if (run) fields.run = run[1];
  const cwd = raw.match(/\bcwd="((?:\\.|[^"\\])*)"/);
  if (cwd) fields.cwd = unescapeLogValue(cwd[1]);
  const msgAt = raw.search(/\smessage=/);
  if (msgAt < 0) return fields;
  const rest = raw.slice(msgAt + " message=".length);
  if (rest.startsWith('"')) {
    let i = 1;
    let out = "";
    while (i < rest.length) {
      if (rest[i] === "\\" && i + 1 < rest.length) {
        out += rest[i + 1];
        i += 2;
        continue;
      }
      if (rest[i] === '"') break;
      out += rest[i];
      i += 1;
    }
    fields.message = out;
    const tail = rest.slice(i + 1);
    const file = tail.match(/\bfile="((?:\\.|[^"\\])*)"/);
    if (file) fields.file = unescapeLogValue(file[1]);
  } else {
    fields.message = rest;
    const perm = rest.match(/permission=(\S+)/);
    const pattern = rest.match(/pattern="((?:\\.|[^"\\])*)"/) || rest.match(/pattern=(\S+)/);
    const file = rest.match(/\bfile="((?:\\.|[^"\\])*)"/);
    if (perm) fields.permission = perm[1];
    if (pattern) fields.pattern = unescapeLogValue(pattern[1]);
    if (file) fields.file = unescapeLogValue(file[1]);
  }
  return fields;
}

function eventsFromOpencodeLogLine(line) {
  const fields = parseOpencodeLogLine(line);
  if (!fields) return [];
  const msg = String(fields.message || "");
  if (/evaluated permission=/i.test(msg) || fields.permission) {
    // OpenCode emits permission evaluations for internal policy checks. They
    // are not tool executions and have no completion event, so exposing them
    // as running activity makes the panel look stuck (especially for
    // external_directory).
    return [];
  }
  if (msg === "touching file" || /touching file/i.test(msg)) {
    const detail = fields.file || "";
    return [toolEvent("write", detail, "done")];
  }
  if (/^formatting file=/i.test(msg)) {
    const file = (msg.match(/file="?(.+?)"?$/) || [])[1] || "";
    return [toolEvent("write", file, "running")];
  }
  return [];
}

function parseLine(line, cliId = "") {
  const raw = String(line || "").trim();
  if (!raw) return [];
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const ev = JSON.parse(raw);
      const events = parseJsonEvent(ev);
      if (events.length) {
        return events.flatMap((event) =>
          event.kind === "text"
            ? textAndAskEvents(event.text)
            : [event],
        );
      }
      return [];
    } catch {
      if (cliId === "opencode" && raw.includes("File not found")) return [];
    }
  }
  const text = String(line);
  return textAndAskEvents(text);
}

function enrichText(event) {
  if (!event || event.kind !== "text") return [event];
  const extra = [];
  const gates = parseGatesFromText(event.text);
  const todos = parseTodosFromText(event.text);
  if (gates.length) extra.push({ kind: "gates", gates });
  if (todos.length) extra.push({ kind: "todos", todos });
  return [event, ...extra];
}

function parseLineEnriched(line, cliId = "") {
  return parseLine(line, cliId).flatMap((ev) => (ev.kind === "text" ? enrichText(ev) : [ev]));
}

module.exports = {
  toolLabel,
  parseLine,
  parseLineEnriched,
  parseTodosFromText,
  parseGatesFromText,
  parseVerdictFromText,
  parseAskFromText,
  parseAskEventsFromText,
  normalizeAskPayload,
  parseJsonEvent,
  extractDetail,
  parseOpencodeLogLine,
  eventsFromOpencodeLogLine,
};
