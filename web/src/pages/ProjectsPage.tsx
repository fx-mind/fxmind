import { PageHeader, Card, Badge } from "../components/ui";
import { useProject } from "../context/project";

export function ProjectsPage() {
  const { projects, activeProject, setActiveProjectId, loading, refresh } = useProject();

  return (
    <>
      <PageHeader
        title="Projetos"
        description="Registry global (~/.fxmind) e cwd atual. O projeto ativo alimenta memórias, query e gates."
        action={
          <button
            type="button"
            onClick={() => refresh()}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-white/[0.04]"
          >
            Atualizar
          </button>
        }
      />

      {loading && <p className="text-sm text-[var(--color-muted)]">Carregando…</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => {
          const active = p.id === activeProject?.id;
          return (
            <Card key={p.id} className={active ? "ring-1 ring-[var(--color-accent)]/40" : ""}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium">{p.name}</h3>
                  <Badge tone={p.source === "registry" ? "learned" : "default"}>
                    {p.source === "registry" ? "registry" : "cwd"}
                  </Badge>
                </div>
                <p className="mt-2 truncate font-mono text-[10px] text-[var(--color-muted)]" title={p.root}>
                  {p.root}
                </p>
                <p className="mt-1 font-mono text-[10px] text-[var(--color-muted)]">id {p.id}</p>
                {!active && (
                  <button
                    type="button"
                    onClick={() => setActiveProjectId(p.id)}
                    className="mt-3 text-xs text-[var(--color-accent)] hover:underline"
                  >
                    Usar como ativo
                  </button>
                )}
                {active && (
                  <p className="mt-3 text-xs text-[var(--color-learned)]">Projeto ativo</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
