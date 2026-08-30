/**
 * Trello integration for panel inbox / demand queue.
 */

const { readPanelConfig, writePanelConfig, keyPrefix } = require("./panel-api");

const TRELLO_API = "https://api.trello.com/1";

function trelloCreds(config = null) {
  const cfg = config || readPanelConfig();
  const trello = cfg.trello || {};
  const apiKey = String(trello.apiKey || process.env.TRELLO_API_KEY || "").trim();
  const token = String(trello.token || process.env.TRELLO_TOKEN || "").trim();
  const boardId = String(trello.boardId || "").trim();
  return { apiKey, token, boardId };
}

function getTrelloSettings() {
  const { apiKey, token, boardId } = trelloCreds();
  const config = readPanelConfig();
  const stored = config.trello || {};
  return {
    hasKey: Boolean(apiKey),
    keyPrefix: stored.apiKey ? keyPrefix(stored.apiKey) : apiKey ? keyPrefix(apiKey) : "",
    hasToken: Boolean(token),
    tokenPrefix: stored.token ? keyPrefix(stored.token) : token ? keyPrefix(token) : "",
    boardId: boardId || stored.boardId || "",
    boardName: stored.boardName || "",
    updatedAt: stored.updatedAt || null,
  };
}

function putTrelloSettings(body = {}) {
  const config = readPanelConfig();
  const prev = config.trello || {};
  config.trello = { ...prev };

  if (body.apiKey !== undefined && String(body.apiKey).trim()) {
    config.trello.apiKey = String(body.apiKey).trim();
  }
  if (body.token !== undefined && String(body.token).trim()) {
    config.trello.token = String(body.token).trim();
  }
  if (body.boardId !== undefined) {
    config.trello.boardId = String(body.boardId || "").trim();
  }
  if (body.boardName !== undefined) {
    config.trello.boardName = String(body.boardName || "").trim();
  }
  if (body.clearKey) delete config.trello.apiKey;
  if (body.clearToken) delete config.trello.token;

  config.trello.updatedAt = new Date().toISOString();
  writePanelConfig(config);
  return getTrelloSettings();
}

async function trelloFetch(pathname, params = {}) {
  const { apiKey, token } = trelloCreds();
  if (!apiKey || !token) {
    return { ok: false, error: "not_configured", status: 400 };
  }

  const url = new URL(`${TRELLO_API}${pathname}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: "upstream_error",
        status: res.status,
        message: text.slice(0, 200) || res.statusText,
      };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "timeout" : "network_error",
      message: String(err?.message || err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTrelloBoards() {
  const result = await trelloFetch("/members/me/boards", {
    fields: "name,url",
    filter: "open",
  });
  if (!result.ok) return result;
  const boards = (result.data || []).map((b) => ({
    id: b.id,
    name: b.name,
    url: b.url,
  }));
  return { ok: true, boards };
}

function mapTrelloCard(card, listById, boardId) {
  const list = listById[card.idList];
  const due = card.due ? card.due.slice(0, 10) : null;
  const labels = Array.isArray(card.labels) ? card.labels : [];
  return {
    cardId: card.id,
    title: card.name || "Sem título",
    description: card.desc || null,
    priority: labels[0]?.name || null,
    category: labels[1]?.name || labels[0]?.name || null,
    dueDate: due,
    overdue: Boolean(due && new Date(`${due}T23:59:59`) < new Date()),
    column: list ? { name: list.name, role: null } : { name: "—", role: null },
    boardId,
    source: "trello",
  };
}

async function fetchTrelloInbox() {
  const { apiKey, token, boardId } = trelloCreds();
  if (!apiKey || !token) {
    return {
      configured: false,
      ok: false,
      source: "trello",
      items: [],
      date: new Date().toISOString().slice(0, 10),
    };
  }
  if (!boardId) {
    return {
      configured: true,
      ok: false,
      source: "trello",
      error: "no_board",
      message: "Selecione um board Trello nas configurações",
      items: [],
      date: new Date().toISOString().slice(0, 10),
    };
  }

  const listsResult = await trelloFetch(`/boards/${boardId}/lists`, { fields: "name" });
  if (!listsResult.ok) {
    return {
      configured: true,
      ok: false,
      source: "trello",
      error: listsResult.error,
      message: listsResult.message,
      items: [],
      date: new Date().toISOString().slice(0, 10),
    };
  }

  const cardsResult = await trelloFetch(`/boards/${boardId}/cards`, {
    fields: "name,desc,due,idList,labels,closed",
  });
  if (!cardsResult.ok) {
    return {
      configured: true,
      ok: false,
      source: "trello",
      error: cardsResult.error,
      message: cardsResult.message,
      items: [],
      date: new Date().toISOString().slice(0, 10),
    };
  }

  const listById = Object.fromEntries((listsResult.data || []).map((l) => [l.id, l]));
  const items = (cardsResult.data || [])
    .filter((c) => !c.closed)
    .map((c) => mapTrelloCard(c, listById, boardId));

  return {
    configured: true,
    ok: true,
    source: "trello",
    date: new Date().toISOString().slice(0, 10),
    items,
  };
}

async function fetchCombinedInbox(source = "all") {
  const panel = require("./panel-api");
  const date = new Date().toISOString().slice(0, 10);

  if (source === "portspace") {
    const inbox = await panel.fetchPortspaceInbox();
    return { ...inbox, sources: ["portspace"] };
  }
  if (source === "trello") {
    const inbox = await fetchTrelloInbox();
    return { ...inbox, sources: ["trello"] };
  }

  const [portspace, trello] = await Promise.all([
    panel.fetchPortspaceInbox(),
    fetchTrelloInbox(),
  ]);

  const configured = portspace.configured || trello.configured;
  const items = [
    ...(portspace.ok !== false ? portspace.items || [] : []),
    ...(trello.ok !== false ? trello.items || [] : []),
  ];

  return {
    configured,
    ok: portspace.ok !== false || trello.ok !== false,
    date,
    items,
    sources: {
      portspace: { configured: portspace.configured, ok: portspace.ok, count: portspace.items?.length || 0 },
      trello: { configured: trello.configured, ok: trello.ok, count: trello.items?.length || 0 },
    },
    errors: [portspace.message, trello.message].filter(Boolean),
  };
}

module.exports = {
  getTrelloSettings,
  putTrelloSettings,
  fetchTrelloBoards,
  fetchTrelloInbox,
  fetchCombinedInbox,
};
