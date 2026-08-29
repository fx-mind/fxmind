import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Card, EmptyState, PageHeader } from "../components/ui";
import { useProject } from "../context/project";
import { panelApi, type InboxItem, type InboxResponse } from "../lib/api";

function InboxRow({
  item,
  onOpen,
}: {
  item: InboxItem;
  onOpen: (item: InboxItem) => void;
}) {
  const due = item.dueDate
    ? new Date(item.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full items-start gap-3 border-b border-[var(--color-border)] px-4 py-3 text-left last:border-b-0 hover:bg-white/[0.04]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          {item.overdue && <Badge tone="danger">Atrasada</Badge>}
          {item.priority && <Badge tone="warn">{item.priority}</Badge>}
          {item.category && <Badge>{item.category}</Badge>}
        </div>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          {item.column?.name ?? "—"}
          {due ? ` · prazo ${due}` : ""}
          {item.assignee?.name ? ` · ${item.assignee.name}` : ""}
          <span className="ml-2 text-[var(--color-accent)]">Abrir no chat →</span>
        </p>
      </div>
      {item.agentTask && (
        <Badge tone="accent">{item.agentTask.status}</Badge>
      )}
    </button>
  );
}

export function InboxPage() {
  const { activeProject } = useProject();
  const navigate = useNavigate();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await panelApi.inbox());
    } catch {
      setData({
        configured: false,
        items: [],
        ok: false,
        error: "fetch_failed",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dateLabel = data?.date
    ? new Date(data.date + "T12:00:00").toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";

  const openInChat = async (item: InboxItem) => {
    if (!activeProject) return;
    const { thread } = await panelApi.injectDemand(activeProject.id, item);
    navigate(`/chat?thread=${thread.id}`);
  };

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Demandas do dia — clique para injetar no chat do agente (várias em paralelo)."
        action={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-white/[0.04] hover:text-white disabled:opacity-50"
          >
            Atualizar
          </button>
        }
      />

      {loading && (
        <p className="text-sm text-[var(--color-muted)]">Carregando inbox…</p>
      )}

      {!loading && data && !data.configured && (
        <EmptyState
          title="PortSpace não configurado"
          description="Informe a URL da API e a chave de integração nas configurações. O fxmind só lê cards dos boards que você autorizar no CRM."
          action={
            <Link
              to="/settings"
              className="inline-flex rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent)]/90"
            >
              Configurar PortSpace
            </Link>
          }
        />
      )}

      {!loading && data?.configured && data.ok === false && (
        <EmptyState
          title="API ainda não disponível"
          description={
            data.message ||
            "O endpoint /external/fxmind/inbox ainda não existe no PortSpace. Quando o CRM publicar a rota, as demandas aparecerão aqui."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Badge tone="warn">{data.error ?? "upstream"}</Badge>
              <Link to="/settings" className="text-xs text-[var(--color-accent)] underline-offset-2 hover:underline">
                Revisar conexão
              </Link>
            </div>
          }
        />
      )}

      {!loading && data?.configured && data.ok !== false && data.items.length === 0 && (
        <EmptyState
          title="Nada para hoje"
          description={`Nenhuma demanda com prazo ou em andamento para ${dateLabel || "hoje"}.`}
        />
      )}

      {!loading && data?.configured && data.ok !== false && data.items.length > 0 && (
        <Card>
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <p className="text-xs capitalize text-[var(--color-muted)]">{dateLabel}</p>
            <p className="text-sm font-medium">{data.items.length} demanda(s)</p>
          </div>
          {data.items.map((item, i) => (
            <InboxRow key={item.cardId ?? `${item.title}-${i}`} item={item} onOpen={openInChat} />
          ))}
        </Card>
      )}
    </>
  );
}
