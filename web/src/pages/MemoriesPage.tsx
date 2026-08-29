import { useCallback, useEffect, useState } from "react";
import { Badge, Card, EmptyState, PageHeader } from "../components/ui";
import { useProject } from "../context/project";
import { panelApi, type Memory } from "../lib/api";

export function MemoriesPage() {
  const { activeProject } = useProject();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [validation, setValidation] = useState<{ ok: boolean; checked: number; failed: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);

  const load = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const data = await panelApi.memories(activeProject.id);
      setMemories(data.memories);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    load();
    setValidation(null);
  }, [load]);

  const validate = async () => {
    if (!activeProject) return;
    setValidating(true);
    try {
      const result = await panelApi.validateMemories(activeProject.id);
      setValidation({ ok: result.ok, checked: result.checked, failed: result.failed });
    } finally {
      setValidating(false);
    }
  };

  if (!activeProject) {
    return (
      <EmptyState title="Sem projeto" description="Selecione um projeto na barra lateral." />
    );
  }

  return (
    <>
      <PageHeader
        title="Memórias"
        description={`Tópicos em .fxmind/memory/ — ${activeProject.name}`}
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={validate}
              disabled={validating}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-white/[0.04]"
            >
              {validating ? "Validando…" : "Validar"}
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-white/[0.04]"
            >
              Atualizar
            </button>
          </div>
        }
      />

      {validation && (
        <div className="mb-4 flex gap-2">
          <Badge tone={validation.ok ? "learned" : "danger"}>
            {validation.ok ? "OK" : `${validation.failed} erro(s)`}
          </Badge>
          <Badge>{validation.checked} verificadas</Badge>
        </div>
      )}

      {loading && <p className="text-sm text-[var(--color-muted)]">Carregando…</p>}

      {!loading && memories.length === 0 && (
        <EmptyState
          title="Nenhuma memória"
          description="Rode /fxmind learn no agente ou crie arquivos em .fxmind/memory/."
        />
      )}

      <div className="grid gap-2">
        {memories.map((m) => (
          <Card key={m.slug}>
            <div className="flex flex-wrap items-start justify-between gap-2 p-4">
              <div className="min-w-0">
                <h3 className="font-medium">{m.topic}</h3>
                <p className="mt-1 font-mono text-[10px] text-[var(--color-muted)]">{m.file}</p>
                {m.triggers.length > 0 && (
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    triggers: {m.triggers.slice(0, 5).join(", ")}
                    {m.triggers.length > 5 ? "…" : ""}
                  </p>
                )}
              </div>
              <div className="text-right text-[10px] text-[var(--color-muted)]">
                <p>{m.updated || "—"}</p>
                <p>{Math.round(m.bytes / 1024)} KB</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
