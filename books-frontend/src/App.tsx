import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "./ui/components/Button";
import { Toaster } from "./ui/components/Toaster";
import { Dashboard } from "./ui/dashboard/Dashboard";
import { TopBar } from "./ui/layout/TopBar";
import { ProjectWorkspace } from "./ui/project/ProjectWorkspace";
import { SettingsPanel } from "./ui/settings/SettingsPanel";
import { useProjectsStore } from "./state/projectsStore";
import { useSettingsStore } from "./state/settingsStore";

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadProjects = useProjectsStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const currentId = useProjectsStore((s) => s.currentId);
  const closeProject = useProjectsStore((s) => s.closeProject);

  useEffect(() => {
    void loadProjects();
    void loadSettings();
  }, [loadProjects, loadSettings]);

  const inProject = currentId !== null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <TopBar
        onOpenSettings={() => setSettingsOpen(true)}
        left={
          inProject ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="size-4" />}
              onClick={() => closeProject()}
            >
              Library
            </Button>
          ) : null
        }
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-grid">
        {inProject ? (
          <ProjectWorkspace />
        ) : (
          <Dashboard onOpenSettings={() => setSettingsOpen(true)} />
        )}
      </main>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster />
    </div>
  );
}

export default App;
