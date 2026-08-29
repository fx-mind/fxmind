import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { panelApi, type Project } from "../lib/api";

const STORAGE_KEY = "fxmind-panel:active-project";

type ProjectContextValue = {
  projects: Project[];
  activeProject: Project | null;
  setActiveProjectId: (id: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await panelApi.projects();
      setProjects(data.projects);
      setActiveId((prev) => {
        if (prev && data.projects.some((p) => p.id === prev)) return prev;
        const next = data.projects[0]?.id ?? null;
        if (next) localStorage.setItem(STORAGE_KEY, next);
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveProjectId = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeId) ?? null,
    [projects, activeId],
  );

  const value = useMemo(
    () => ({
      projects,
      activeProject,
      setActiveProjectId,
      loading,
      refresh,
    }),
    [projects, activeProject, setActiveProjectId, loading, refresh],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
