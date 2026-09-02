/**
 * Parallel task sessions — per-agent gates + file leases under .fxmind/state/sessions/.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { writeLocal, fxmindDir } = require("./layout");
const { withFileLock } = require("./fs-lock");

const SCHEMA_VERSION = 2;
const SESSIONS_INDEX = "sessions.json";
const SESSIONS_SUBDIR = "sessions";

function sessionsRoot(targetRoot) {
  return path.join(fxmindDir(targetRoot), "state", SESSIONS_SUBDIR);
}

function sessionsIndexPath(targetRoot) {
  return path.join(fxmindDir(targetRoot), "state", SESSIONS_INDEX);
}

function sessionFilePath(targetRoot, sessionId) {
  return path.join(sessionsRoot(targetRoot), `${sessionId}.json`);
}

function legacyGatesPath(targetRoot) {
  return writeLocal(targetRoot, "gates");
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeRelPath(value, targetRoot) {
  const root = path.resolve(targetRoot);
  const raw = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
  if (!raw) return "";
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  return path.relative(root, abs).replace(/\\/g, "/");
}

function safeSessionId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  return id.toLowerCase();
}

function withSessionsLock(targetRoot, fn) {
  return withFileLock(path.resolve(targetRoot), "task-sessions-index", fn);
}

function readIndex(targetRoot) {
  const data = readJson(sessionsIndexPath(targetRoot), {
    schemaVersion: SCHEMA_VERSION,
    active: [],
    updatedAt: null,
  });
  if (!Array.isArray(data.active)) {
    data.active = [];
  }
  return data;
}

function writeIndex(targetRoot, index) {
  index.schemaVersion = SCHEMA_VERSION;
  index.updatedAt = new Date().toISOString();
  writeJson(sessionsIndexPath(targetRoot), index);
}

function readSession(targetRoot, sessionId) {
  const id = safeSessionId(sessionId);
  if (!id) return null;
  return readJson(sessionFilePath(targetRoot, id), null);
}

function writeSession(targetRoot, session) {
  if (!session?.sessionId) {
    throw new Error("sessionId required");
  }
  writeJson(sessionFilePath(targetRoot, session.sessionId), session);
}

function mirrorLegacyGates(targetRoot, session) {
  if (!session) return;
  const mirror = {
    schemaVersion: session.schemaVersion || SCHEMA_VERSION,
    sessionId: session.sessionId,
    taskActive: Boolean(session.taskActive),
    session: session.session || session.startedAt || new Date().toISOString(),
    autoStarted: Boolean(session.autoStarted),
    trivial: Boolean(session.trivial),
    gates: session.gates || {},
    note: session.note || undefined,
  };
  writeJson(legacyGatesPath(targetRoot), mirror);
}

function migrateLegacyGatesToSession(targetRoot) {
  const legacy = readJson(legacyGatesPath(targetRoot), null);
  if (!legacy || !legacy.taskActive) {
    return null;
  }
  if (legacy.sessionId && readSession(targetRoot, legacy.sessionId)) {
    return legacy.sessionId;
  }
  const sessionId = safeSessionId(legacy.sessionId) || crypto.randomUUID();
  const session = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    taskActive: true,
    session: legacy.session || new Date().toISOString(),
    startedAt: legacy.startedAt || legacy.session || new Date().toISOString(),
    autoStarted: Boolean(legacy.autoStarted),
    trivial: Boolean(legacy.trivial),
    gates: legacy.gates || {},
    claimedPaths: Array.isArray(legacy.claimedPaths) ? legacy.claimedPaths : [],
    conversationId: legacy.conversationId || null,
    note: legacy.note || "",
  };
  writeSession(targetRoot, session);
  const index = readIndex(targetRoot);
  if (!index.active.includes(sessionId)) {
    index.active.push(sessionId);
  }
  writeIndex(targetRoot, index);
  mirrorLegacyGates(targetRoot, session);
  return sessionId;
}

function listActiveSessionIds(targetRoot) {
  migrateLegacyGatesToSession(targetRoot);
  const index = readIndex(targetRoot);
  return index.active.filter((id) => {
    const session = readSession(targetRoot, id);
    return session && session.taskActive;
  });
}

function activeSessionCount(targetRoot) {
  return listActiveSessionIds(targetRoot).length;
}

function multiSessionMode(targetRoot) {
  return activeSessionCount(targetRoot) >= 2;
}

function sessionRequiresId(targetRoot) {
  return multiSessionMode(targetRoot);
}

function resolveSessionIdError(targetRoot) {
  const active = listActiveSessionIds(targetRoot).map((id) => {
    const session = readSession(targetRoot, id);
    return {
      sessionId: id,
      note: session?.note || "",
      claimedPaths: session?.claimedPaths?.length || 0,
      conversationId: session?.conversationId || null,
    };
  });
  return {
    ok: false,
    error: "multiple_active_sessions",
    message:
      "Multiple Task sessions are active. Pass sessionId from fxmind_start_task on every fxmind_record_gate / fxmind_claim_paths call.",
    activeSessions: active,
  };
}

function resolveSession(targetRoot, sessionId, options = {}) {
  migrateLegacyGatesToSession(targetRoot);
  const explicit = safeSessionId(sessionId || options.sessionId);
  if (explicit) {
    const session = readSession(targetRoot, explicit);
    if (!session) {
      throw new Error(`Unknown sessionId: ${explicit}`);
    }
    return session;
  }

  const activeIds = listActiveSessionIds(targetRoot);
  if (activeIds.length === 0) {
    const legacy = readJson(legacyGatesPath(targetRoot), {
      schemaVersion: SCHEMA_VERSION,
      taskActive: false,
      gates: {},
    });
    if (!legacy.sessionId) {
      legacy.sessionId = null;
    }
    return legacy;
  }
  if (activeIds.length === 1) {
    return readSession(targetRoot, activeIds[0]);
  }
  if (options.allowMultiWithoutId) {
    return null;
  }
  throw Object.assign(new Error("sessionId required"), { code: "MULTI_SESSION" });
}

function publicSession(session) {
  if (!session) return null;
  return {
    schemaVersion: session.schemaVersion || SCHEMA_VERSION,
    sessionId: session.sessionId || null,
    taskActive: Boolean(session.taskActive),
    session: session.session || session.startedAt || null,
    autoStarted: Boolean(session.autoStarted),
    trivial: Boolean(session.trivial),
    gates: session.gates || {},
    claimedPaths: Array.isArray(session.claimedPaths) ? [...session.claimedPaths] : [],
    conversationId: session.conversationId || null,
    note: session.note || "",
    completedAt: session.completedAt || null,
  };
}

function startSession(targetRoot, extra = {}) {
  return withSessionsLock(targetRoot, () => {
    migrateLegacyGatesToSession(targetRoot);
    const now = new Date().toISOString();
    const sessionId = safeSessionId(extra.sessionId) || crypto.randomUUID();
    const existing = readSession(targetRoot, sessionId);
    if (existing && existing.taskActive) {
      mirrorLegacyGates(targetRoot, existing);
      return publicSession(existing);
    }

    const trivial = Boolean(extra.trivial);
    const session = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      taskActive: true,
      session: now,
      startedAt: now,
      autoStarted: Boolean(extra.autoStarted),
      trivial,
      gates: {},
      claimedPaths: [],
      conversationId: extra.conversationId ? String(extra.conversationId) : null,
      note: extra.note ? String(extra.note) : "",
    };

    if (trivial) {
      const note = extra.note ? `trivial: ${extra.note}` : "trivial";
      session.gates.A = { complete: true, at: now, note };
      session.gates.B = { complete: true, at: now, note };
    }

    writeSession(targetRoot, session);
    const index = readIndex(targetRoot);
    if (!index.active.includes(sessionId)) {
      index.active.push(sessionId);
    }
    writeIndex(targetRoot, index);
    mirrorLegacyGates(targetRoot, session);
    return publicSession(session);
  });
}

function updateSession(targetRoot, sessionId, mutator) {
  return withSessionsLock(targetRoot, () => {
    const session = resolveSession(targetRoot, sessionId);
    if (!session?.sessionId) {
      throw new Error("Cannot update legacy-only gates without sessionId");
    }
    mutator(session);
    writeSession(targetRoot, session);
    if (session.taskActive) {
      mirrorLegacyGates(targetRoot, session);
    }
    return publicSession(session);
  });
}

function recordSessionGate(targetRoot, gate, value, extra = {}) {
  const letter = String(gate || "").toUpperCase();
  if (letter === "START" || letter === "0") {
    return startSession(targetRoot, extra);
  }
  if (!["A", "B", "V", "C"].includes(letter)) {
    throw new Error(`Invalid gate: ${gate} (use START, A, B, V, or C)`);
  }

  return withSessionsLock(targetRoot, () => {
    let session;
    try {
      session = resolveSession(targetRoot, extra.sessionId);
    } catch (err) {
      if (err.code === "MULTI_SESSION") {
        return resolveSessionIdError(targetRoot);
      }
      throw err;
    }

    if (!session.sessionId) {
      session = startSession(targetRoot, {
        sessionId: extra.sessionId,
        note: extra.note || "",
        conversationId: extra.conversationId,
      });
    }

    if (!session.taskActive) {
      session.taskActive = true;
      session.session = session.session || new Date().toISOString();
    }
    session.gates = session.gates || {};

    if (letter === "C" && value) {
      const vDone = session.gates.V && session.gates.V.complete;
      if (!vDone) {
        throw new Error(
          "Gate C requires Gate V first. Call fxmind_record_gate with gate=V after verify-by-observation, then gate=C.",
        );
      }
    }

    session.gates[letter] = {
      complete: Boolean(value),
      at: new Date().toISOString(),
      ...(extra.note ? { note: extra.note } : {}),
    };

    if (letter === "C" && value) {
      session.taskActive = false;
      session.completedAt = new Date().toISOString();
      session.claimedPaths = [];
      const index = readIndex(targetRoot);
      index.active = index.active.filter((id) => id !== session.sessionId);
      writeIndex(targetRoot, index);
    }

    writeSession(targetRoot, session);
    if (session.taskActive) {
      mirrorLegacyGates(targetRoot, session);
    }
    return publicSession(session);
  });
}

function getSessionStatus(targetRoot, extra = {}) {
  migrateLegacyGatesToSession(targetRoot);
  if (sessionRequiresId(targetRoot) && !safeSessionId(extra.sessionId)) {
    return resolveSessionIdError(targetRoot);
  }
  try {
    const session = resolveSession(targetRoot, extra.sessionId);
    return publicSession(session);
  } catch (err) {
    if (err.code === "MULTI_SESSION") {
      return resolveSessionIdError(targetRoot);
    }
    throw err;
  }
}

function listSessionsStatus(targetRoot) {
  migrateLegacyGatesToSession(targetRoot);
  const ids = listActiveSessionIds(targetRoot);
  return {
    ok: true,
    multiSession: ids.length >= 2,
    activeCount: ids.length,
    sessions: ids.map((id) => publicSession(readSession(targetRoot, id))),
  };
}

function pathHolder(targetRoot, relPath) {
  const normalized = normalizeRelPath(relPath, targetRoot);
  if (!normalized) return null;
  for (const id of listActiveSessionIds(targetRoot)) {
    const session = readSession(targetRoot, id);
    if (!session?.claimedPaths?.includes(normalized)) continue;
    return { sessionId: id, conversationId: session.conversationId || null };
  }
  return null;
}

function isPathClaimed(targetRoot, relPath) {
  return Boolean(pathHolder(targetRoot, relPath));
}

function claimPaths(targetRoot, paths, extra = {}) {
  return withSessionsLock(targetRoot, () => {
    if (sessionRequiresId(targetRoot) && !safeSessionId(extra.sessionId)) {
      return resolveSessionIdError(targetRoot);
    }

    let session;
    try {
      session = resolveSession(targetRoot, extra.sessionId);
    } catch (err) {
      if (err.code === "MULTI_SESSION") {
        return resolveSessionIdError(targetRoot);
      }
      throw err;
    }

    if (!session?.sessionId || !session.taskActive) {
      return {
        ok: false,
        error: "no_active_session",
        message: "Call fxmind_start_task before fxmind_claim_paths.",
      };
    }

    const normalized = [...new Set((paths || []).map((p) => normalizeRelPath(p, targetRoot)).filter(Boolean))];
    const conflicts = [];
    for (const rel of normalized) {
      const holder = pathHolder(targetRoot, rel);
      if (holder && holder.sessionId !== session.sessionId) {
        conflicts.push({ path: rel, sessionId: holder.sessionId, conversationId: holder.conversationId });
      }
    }
    if (conflicts.length) {
      return { ok: false, error: "path_conflict", conflicts };
    }

    const set = new Set(session.claimedPaths || []);
    for (const rel of normalized) {
      set.add(rel);
    }
    session.claimedPaths = [...set];
    if (extra.conversationId && !session.conversationId) {
      session.conversationId = String(extra.conversationId);
    }
    writeSession(targetRoot, session);
    mirrorLegacyGates(targetRoot, session);
    return { ok: true, sessionId: session.sessionId, claimed: normalized, claimedPaths: session.claimedPaths };
  });
}

function releasePaths(targetRoot, paths, extra = {}) {
  return withSessionsLock(targetRoot, () => {
    if (sessionRequiresId(targetRoot) && !safeSessionId(extra.sessionId)) {
      return resolveSessionIdError(targetRoot);
    }
    const session = resolveSession(targetRoot, extra.sessionId);
    if (!session?.sessionId) {
      return { ok: false, error: "no_session" };
    }
    const drop = new Set((paths || []).map((p) => normalizeRelPath(p, targetRoot)).filter(Boolean));
    session.claimedPaths = (session.claimedPaths || []).filter((p) => !drop.has(p));
    writeSession(targetRoot, session);
    mirrorLegacyGates(targetRoot, session);
    return { ok: true, sessionId: session.sessionId, claimedPaths: session.claimedPaths };
  });
}

function resetSessions(targetRoot) {
  return withSessionsLock(targetRoot, () => {
    const index = readIndex(targetRoot);
    for (const id of index.active) {
      try {
        fs.unlinkSync(sessionFilePath(targetRoot, id));
      } catch {
        /* ignore */
      }
    }
    writeIndex(targetRoot, { schemaVersion: SCHEMA_VERSION, active: [] });
    const empty = {
      schemaVersion: SCHEMA_VERSION,
      taskActive: false,
      gates: {},
      session: new Date().toISOString(),
      sessionId: null,
    };
    writeJson(legacyGatesPath(targetRoot), empty);
    return empty;
  });
}

function gatesForHook(targetRoot, options = {}) {
  migrateLegacyGatesToSession(targetRoot);
  const activeCount = activeSessionCount(targetRoot);
  const rel = normalizeRelPath(options.filePath, targetRoot);

  if (activeCount >= 2 && rel) {
    if (!isPathClaimed(targetRoot, rel)) {
      return {
        allow: false,
        reason: "unclaimed",
        message:
          "Multiple Task sessions active — call fxmind_claim_paths for this file before editing.",
      };
    }
  }

  let session = null;
  const convId =
    options.conversationId ||
    options.composerId ||
    options.composer_id ||
    options.conversation_id ||
    null;

  if (convId) {
    for (const id of listActiveSessionIds(targetRoot)) {
      const candidate = readSession(targetRoot, id);
      if (candidate?.conversationId === String(convId)) {
        session = candidate;
        break;
      }
    }
  }

  if (!session && rel) {
    const holder = pathHolder(targetRoot, rel);
    if (holder) {
      session = readSession(targetRoot, holder.sessionId);
    }
  }

  if (!session) {
    try {
      session = resolveSession(targetRoot, options.sessionId, { allowMultiWithoutId: activeCount >= 2 });
    } catch {
      session = null;
    }
  }

  if (!session && activeCount === 0) {
    session = readJson(legacyGatesPath(targetRoot), null);
  }

  if (!session?.taskActive) {
    if (activeCount >= 2) {
      return {
        allow: false,
        reason: "no_task",
        message: "Call fxmind_start_task before editing code (parallel sessions require MCP).",
      };
    }
    return { allow: null, session: session || { taskActive: false, gates: {} } };
  }

  return { allow: true, session, multiSession: activeCount >= 2 };
}

module.exports = {
  SCHEMA_VERSION,
  sessionsRoot,
  sessionsIndexPath,
  normalizeRelPath,
  safeSessionId,
  activeSessionCount,
  multiSessionMode,
  sessionRequiresId,
  listActiveSessionIds,
  startSession,
  recordSessionGate,
  getSessionStatus,
  listSessionsStatus,
  claimPaths,
  releasePaths,
  pathHolder,
  isPathClaimed,
  resetSessions,
  mirrorLegacyGates,
  migrateLegacyGatesToSession,
  resolveSession,
  publicSession,
  gatesForHook,
};
