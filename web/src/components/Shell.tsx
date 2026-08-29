import { NavLink, Outlet } from "react-router-dom";
import { useProject } from "../context/project";

const NAV = [
  { to: "/chat", label: "Chat", hint: "Agente + demandas" },
  { to: "/inbox", label: "Inbox", hint: "Demandas do dia" },
  { to: "/projects", label: "Projetos", hint: "Registry global" },
  { to: "/memories", label: "Memórias", hint: "Tópicos .fxmind" },
  { to: "/query", label: "Query", hint: "Grafo + budget" },
  { to: "/session", label: "Sessão", hint: "Gates A/B/V/C" },
  { to: "/settings", label: "Settings", hint: "PortSpace + Cursor" },
];

export function Shell() {
  const { activeProject, projects, setActiveProjectId, loading } = useProject();

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[272px_1fr]">
      <aside className="flex min-h-0 flex-col border-b border-[var(--color-border)] bg-[var(--color-panel)] md:border-b-0 md:border-r">
        <header className="border-b border-[var(--color-border)] px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent)]/15 text-sm font-bold text-[var(--color-accent)]">
              fx
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">FxMind</h1>
              <p className="truncate text-[11px] text-[var(--color-muted)]">Control plane</p>
            </div>
          </div>
        </header>

        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "group rounded-xl px-3 py-2.5 transition-colors",
                  isActive
                    ? "bg-[var(--color-accent)]/12 text-white"
                    : "text-[var(--color-muted)] hover:bg-white/[0.04] hover:text-white",
                ].join(" ")
              }
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="block text-[10px] opacity-70">{item.hint}</span>
            </NavLink>
          ))}
        </nav>

        <footer className="border-t border-[var(--color-border)] p-3">
          <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">
            Projeto ativo
          </label>
          <select
            className="w-full rounded-lg border border-[var(--color-border)] bg-black/40 px-2.5 py-2 text-xs text-white outline-none focus:border-[var(--color-accent)]/50"
            value={activeProject?.id ?? ""}
            disabled={loading || projects.length === 0}
            onChange={(e) => setActiveProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {activeProject && (
            <p className="mt-2 truncate font-mono text-[10px] text-[var(--color-muted)]" title={activeProject.root}>
              {activeProject.root}
            </p>
          )}
        </footer>
      </aside>

      <main className="min-h-0 overflow-y-auto bg-[var(--color-bg)] p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
