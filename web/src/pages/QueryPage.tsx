import { useState } from "react";
import { Badge, Card, EmptyState, PageHeader } from "../components/ui";
import { useProject } from "../context/project";
import { panelApi, type QueryResult } from "../lib/api";

export function QueryPage() {
  const { activeProject } = useProject();
  const [question, setQuestion] = useState("");
  const [budget, setBudget] = useState(1500);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !question.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await panelApi.query(activeProject.id, question.trim(), budget));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  if (!activeProject) {
    return <EmptyState title="Sem projeto" description="Selecione um projeto na barra lateral." />;
  }

  return (
    <>
      <PageHeader
        title="Query"
        description="Busca no knowledge graph com budget de tokens — mesma lógica do MCP fxmind_query."
      />

      <Card className="mb-4 p-4">
        <form onSubmit={run} className="flex flex-col gap-3">
          <label className="text-xs text-[var(--color-muted)]">
            Pergunta
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Como funciona o craft?"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]/50"
            />
          </label>
          <label className="text-xs text-[var(--color-muted)]">
            Budget (tokens)
            <input
              type="number"
              min={200}
              max={8000}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="mt-1 w-32 rounded-lg border border-[var(--color-border)] bg-black/40 px-3 py-2 text-sm outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="w-fit rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Consultando…" : "Consultar grafo"}
          </button>
        </form>
      </Card>

      {error && <p className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>}

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="accent">{result.mode ?? "bfs"}</Badge>
            <Badge>
              {result.tokensUsed ?? 0} / {result.budget ?? budget} tokens
            </Badge>
          </div>

          {result.expanded && result.expanded.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
                Caminho
              </h3>
              <p className="font-mono text-xs text-[var(--color-learned)]">
                {result.expanded.join(" → ")}
              </p>
            </Card>
          )}

          {result.memories && result.memories.length > 0 && (
            <Card>
              <div className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
                Memórias carregadas
              </div>
              {result.memories.map((m) => (
                <div key={m.slug} className="border-b border-[var(--color-border)] px-4 py-3 last:border-b-0">
                  <p className="text-sm font-medium">{m.topic || m.slug}</p>
                  {m.content && (
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--color-muted)]">
                      {m.content.slice(0, 2000)}
                      {m.content.length > 2000 ? "…" : ""}
                    </pre>
                  )}
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
