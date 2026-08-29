import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Card } from "../components/ui";
import { useProject } from "../context/project";
import {
  panelApi,
  type ChatThread,
  type InboxItem,
  type InboxResponse,
} from "../lib/api";

function statusTone(status: ChatThread["status"]) {
  if (status === "running") return "accent" as const;
  if (status === "error") return "danger" as const;
  if (status === "done") return "learned" as const;
  return "default" as const;
}

function DemandRow({
  item,
  busy,
  onInject,
}: {
  item: InboxItem;
  busy: boolean;
  onInject: (item: InboxItem) => void;
}) {
  const due = item.dueDate
    ? new Date(item.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onInject(item)}
      className="w-full border-b border-[var(--color-border)] px-3 py-2.5 text-left last:border-b-0 hover:bg-white/[0.04] disabled:opacity-50"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="truncate text-sm font-medium">{item.title}</span>
        {item.overdue && <Badge tone="danger">Atrasada</Badge>}
        {item.priority && <Badge tone="warn">{item.priority}</Badge>}
      </span>
      <span className="mt-1 block text-[11px] text-[var(--color-muted)]">
        {item.column?.name ?? "—"}
        {due ? ` · ${due}` : ""}
      </span>
    </button>
  );
}

export function ChatPage() {
  const { activeProject } = useProject();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("thread");

  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [threadList, setThreadList] = useState<ChatThread[]>([]);
  const [active, setActive] = useState<ChatThread | null>(null);
  const [draft, setDraft] = useState("");
  const [injecting, setInjecting] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    try {
      setInbox(await panelApi.inbox());
    } catch {
      setInbox({ configured: false, items: [] });
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const data = await panelApi.threads();
      setThreadList(data.threads);
    } catch {
      /* serve down */
    }
  }, []);

  useEffect(() => {
    loadInbox();
    loadThreads();
    const id = setInterval(loadThreads, 2500);
    return () => clearInterval(id);
  }, [loadInbox, loadThreads]);

  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    let closed = false;
    const es = new EventSource(`/api/threads/${activeId}/events`);
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as { thread?: ChatThread };
        if (event.thread && !closed) setActive(event.thread);
      } catch {
        /* ignore */
      }
    };
    panelApi.thread(activeId).then((d) => {
      if (!closed) setActive(d.thread);
    }).catch(() => {
      if (!closed) setActive(null);
    });
    return () => {
      closed = true;
      es.close();
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, active?.status]);

  const running = useMemo(
    () => threadList.filter((t) => t.status === "running").length,
    [threadList],
  );

  const selectThread = (id: string) => {
    setParams({ thread: id });
  };

  const inject = async (item: InboxItem) => {
    if (!activeProject) return;
    setInjecting(true);
    try {
      const { thread } = await panelApi.injectDemand(activeProject.id, item);
      await loadThreads();
      selectThread(thread.id);
    } finally {
      setInjecting(false);
    }
  };

  const newChat = async () => {
    if (!activeProject) return;
    const { thread } = await panelApi.createThread({
      projectId: activeProject.id,
      title: "Nova conversa",
      run: false,
    });
    await loadThreads();
    selectThread(thread.id);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId || !draft.trim() || sending) return;
    setSending(true);
    try {
      await panelApi.sendMessage(activeId, draft.trim());
      setDraft("");
      await loadThreads();
    } finally {
      setSending(false);
    }
  };

  const items = inbox?.ok !== false && inbox?.configured ? inbox.items : [];

  return (
    <div className="grid h-[calc(100vh-2rem)] min-h-[28rem] grid-cols-1 gap-3 lg:grid-cols-[240px_220px_1fr]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
          <div>
            <h2 className="text-sm font-semibold">Demandas do dia</h2>
            <p className="text-[10px] text-[var(--color-muted)]">Clique para injetar no chat</p>
          </div>
          <button
            type="button"
            onClick={loadInbox}
            className="text-[10px] text-[var(--color-muted)] hover:text-white"
          >
            Atualizar
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!inbox?.configured && (
            <p className="px-3 py-4 text-xs text-[var(--color-muted)]">
              PortSpace não configurado.{" "}
              <Link to="/settings" className="text-[var(--color-accent)] hover:underline">
                Conectar
              </Link>
            </p>
          )}
          {inbox?.configured && inbox.ok === false && (
            <p className="px-3 py-4 text-xs text-[var(--color-muted)]">
              Inbox da API ainda indisponível. Você ainda pode abrir chats em paralelo.
            </p>
          )}
          {items.map((item, i) => (
            <DemandRow
              key={item.cardId ?? `${item.title}-${i}`}
              item={item}
              busy={injecting}
              onInject={inject}
            />
          ))}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
          <div>
            <h2 className="text-sm font-semibold">Agentes</h2>
            <p className="text-[10px] text-[var(--color-muted)]">
              {running} rodando em paralelo
            </p>
          </div>
          <button
            type="button"
            onClick={newChat}
            className="rounded-lg bg-[var(--color-accent)] px-2 py-1 text-[10px] font-medium"
          >
            Novo
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threadList.length === 0 && (
            <p className="px-3 py-4 text-xs text-[var(--color-muted)]">
              Nenhuma conversa. Clique numa demanda ou crie um chat.
            </p>
          )}
          {threadList.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectThread(t.id)}
              className={`w-full border-b border-[var(--color-border)] px-3 py-2.5 text-left last:border-b-0 ${
                t.id === activeId ? "bg-[var(--color-accent)]/12" : "hover:bg-white/[0.04]"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{t.title}</span>
                <Badge tone={statusTone(t.status)}>{t.status}</Badge>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {!active && (
          <div className="m-auto max-w-sm px-6 py-10 text-center">
            <h2 className="text-base font-medium">Chat do agente</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Cada demanda abre um agente. Várias podem correr ao mesmo tempo — escolha à esquerda.
            </p>
          </div>
        )}
        {active && (
          <>
            <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{active.title}</h2>
                <p className="text-[10px] text-[var(--color-muted)]">
                  {activeProject?.name ?? "projeto"} · {active.status}
                </p>
              </div>
              <Badge tone={statusTone(active.status)}>{active.status}</Badge>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {active.messages.map((m, i) => (
                <div
                  key={`${m.at}-${i}`}
                  className={m.role === "user" ? "ml-8" : "mr-8"}
                >
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    {m.role === "user" ? "você" : "agente"}
                  </p>
                  <Card className="p-3">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {m.content || (m.streaming ? "…" : "")}
                    </pre>
                  </Card>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="border-t border-[var(--color-border)] p-3">
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    active.status === "running"
                      ? "Agente trabalhando nesta demanda…"
                      : "Follow-up para este agente"
                  }
                  disabled={active.status === "running" || sending}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]/50 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={active.status === "running" || sending || !draft.trim()}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Enviar
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
