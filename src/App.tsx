import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ProjectView } from "./pages/ProjectView";
import { SessionView } from "./pages/SessionView";
import { HomeView } from "./pages/HomeView";
import { TerminalView } from "./pages/TerminalView";

export default function App() {
  return (
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<HomeView />} />
          <Route path="/projects/:slug" element={<ProjectView />} />
          <Route
            path="/projects/:slug/sessions/:id"
            element={<SessionView />}
          />
          <Route path="/terminal/:id" element={<TerminalView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
