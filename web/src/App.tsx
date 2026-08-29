import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ProjectProvider } from "./context/project";
import { ChatPage } from "./pages/ChatPage";
import { InboxPage } from "./pages/InboxPage";
import { MemoriesPage } from "./pages/MemoriesPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { QueryPage } from "./pages/QueryPage";
import { SessionPage } from "./pages/SessionPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <ProjectProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="memories" element={<MemoriesPage />} />
          <Route path="query" element={<QueryPage />} />
          <Route path="session" element={<SessionPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </ProjectProvider>
  );
}
