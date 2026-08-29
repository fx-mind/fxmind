export type Project = {
  id: string;
  name: string;
  root: string;
  registeredAt?: string;
  updatedAt?: string;
  packs?: string[];
  source?: "registry" | "cwd";
};

export type Memory = {
  slug: string;
  file: string;
  topic: string;
  framework: string;
  updated: string;
  paths: string[];
  triggers: string[];
  bytes: number;
};

export type InboxItem = {
  cardId?: string;
  title: string;
  priority?: string | null;
  category?: string | null;
  dueDate?: string | null;
  overdue?: boolean;
  description?: string | null;
  column?: { name: string; role?: string | null };
  boardId?: string;
  assignee?: { id: number; name: string } | null;
  agentTask?: { id: string; status: string } | null;
};

export type InboxResponse = {
  configured: boolean;
  ok?: boolean;
  error?: string;
  message?: string;
  date?: string;
  items: InboxItem[];
};

export type PortspaceSettings = {
  baseUrl: string;
  hasKey: boolean;
  keyPrefix: string;
  updatedAt: string | null;
};

export type GateState = {
  schemaVersion?: number;
  taskActive?: boolean;
  session?: string;
  trivial?: boolean;
  gates?: Record<string, boolean | string>;
};

export type QueryResult = {
  ok: boolean;
  mode?: string;
  expanded?: string[];
  memories?: { slug: string; topic: string; content?: string }[];
  tokensUsed?: number;
  budget?: number;
};

export type Correction = {
  id: string;
  title: string;
  category: string;
  status: string;
  created: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const panelApi = {
  health: () => api<{ ok: boolean; service: string }>("/api/health"),
  projects: () => api<{ projects: Project[] }>("/api/projects"),
  memories: (projectId: string) =>
    api<{ memories: Memory[] }>(`/api/projects/${projectId}/memories`),
  validateMemories: (projectId: string) =>
    api<{ ok: boolean; checked: number; failed: number; results: unknown[] }>(
      `/api/projects/${projectId}/memories/validate`,
      { method: "POST" },
    ),
  query: (projectId: string, question: string, budget = 1500) =>
    api<QueryResult>(`/api/projects/${projectId}/query`, {
      method: "POST",
      body: JSON.stringify({ question, budget }),
    }),
  gates: (projectId: string) =>
    api<{ gates: GateState }>(`/api/projects/${projectId}/gates`),
  corrections: (projectId: string) =>
    api<{ corrections: Correction[] }>(`/api/projects/${projectId}/corrections`),
  portspaceSettings: () => api<PortspaceSettings>("/api/settings/portspace"),
  savePortspaceSettings: (body: {
    baseUrl?: string;
    integrationKey?: string;
    clearKey?: boolean;
  }) =>
    api<PortspaceSettings>("/api/settings/portspace", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  inbox: () => api<InboxResponse>("/api/inbox"),
  cursorSettings: () => api<CursorSettings>("/api/settings/cursor"),
  saveCursorSettings: (body: { apiKey?: string; clearKey?: boolean }) =>
    api<CursorSettings>("/api/settings/cursor", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  threads: () => api<{ threads: ChatThread[] }>("/api/threads"),
  thread: (id: string) => api<{ thread: ChatThread }>(`/api/threads/${id}`),
  createThread: (body: {
    projectId?: string;
    title?: string;
    content?: string;
    run?: boolean;
  }) =>
    api<{ thread: ChatThread }>("/api/threads", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  injectDemand: (projectId: string, item: InboxItem) =>
    api<{ thread: ChatThread }>("/api/threads/inject", {
      method: "POST",
      body: JSON.stringify({ projectId, item }),
    }),
  sendMessage: (id: string, content: string) =>
    api<{ thread: ChatThread }>(`/api/threads/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  deleteThread: (id: string) =>
    api<{ ok: boolean }>(`/api/threads/${id}`, { method: "DELETE" }),
};

export type CursorSettings = {
  hasKey: boolean;
  keyPrefix: string;
  fromEnv: boolean;
  updatedAt: string | null;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  at: string;
  streaming?: boolean;
};

export type ChatThread = {
  id: string;
  title: string;
  projectId: string | null;
  cardId: string | null;
  status: "idle" | "running" | "error" | "done";
  error: string | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};
