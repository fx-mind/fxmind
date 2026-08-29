import { useCallback, useEffect, useState } from "react";
import { Badge, Card, EmptyState, PageHeader } from "../components/ui";
import { useProject } from "../context/project";
import { panelApi, type GateState } from "../lib/api";

const GATE_ORDER = ["START", "A", "B", "V", "C"];

export function SessionPage() {
  const { activeProject } = useProject();
  const [gates, setGates] = useState<GateState | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const data = await panelApi.gates(activeProject.id);
      setGates(data.gates);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  if (!activeProject) {
    return <EmptyState title="Sem projeto" description="Selecione um projeto na barra lateral." />;
  }

  const gateMap = gates?.gates ?? {};

  return (
    <>
      <PageHeader
        title="Sessão"
        description="Estado local dos gates (fxmind-gates.json) — espelha o harness do agente, sem executar LLM."
        action={
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-white/[0.04]"
          >
            Atualizar
          </button>
        }
      />

      {loading && !gates && <p className="text-sm text-[var(--color-muted)]">Carregando…</p>}

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={gates?.taskActive ? "accent" : "default"}>
          {gates?.taskActive ? "Task ativa" : "Idle"}
        </Badge>
        {gates?.trivial && <Badge tone="warn">Trivial</Badge>}
        {gates?.session && (
          <Badge>Início {new Date(gates.session).toLocaleTimeString("pt-BR")}</Badge>
        )}
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-5">
          {GATE_ORDER.map((g) => {
            const done = Boolean(gateMap[g]);
            return (
              <div
                key={g}
                className={`rounded-xl border px-3 py-4 text-center ${
                  done
                    ? "border-[var(--color-learned)]/40 bg-[var(--color-learned)]/10"
                    : "border-[var(--color-border)] bg-black/20"
                }`}
              >
                <p className="text-lg font-semibold">{g}</p>
                <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                  {done ? "completo" : "pendente"}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-4 p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
          JSON bruto
        </h3>
        <pre className="max-h-64 overflow-auto font-mono text-[11px] text-[var(--color-muted)]">
          {JSON.stringify(gates, null, 2)}
        </pre>
      </Card>
    </>
  );
}
