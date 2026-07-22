import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AlertTriangle, Plus, Sparkles } from "lucide-react";
import { useProjectsStore } from "../../state/projectsStore";
import { useSettingsStore } from "../../state/settingsStore";
import { useAuthStore } from "../../state/authStore";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { notify } from "../lib/notify";
import { ProjectCard } from "./ProjectCard";

export function Dashboard() {
  const projects = useProjectsStore((s) => s.projects);
  const createProject = useProjectsStore((s) => s.createProject);
  const openProject = useProjectsStore((s) => s.openProject);
  const deleteProject = useProjectsStore((s) => s.deleteProject);
  const hasAnyKey = useSettingsStore((s) => s.hasAnyKey());
  const isGuest = useAuthStore((s) => s.accessLevel === "guest");
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Guest-first: everyone creates and opens projects immediately. Guests get
  // nudged (not blocked) to create an account so their work survives.
  const handleCreate = async () => {
    await createProject();
  };

  const handleOpen = (id: string) => {
    openProject(id);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await deleteProject(pendingDelete);
    setPendingDelete(null);
    notify.success("Project deleted");
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Your storybooks</h1>
          <p className="mt-1 text-sm text-ink-500">
            Turn a children's story into a beautifully illustrated picture book.
          </p>
        </div>
        <Button size="lg" leftIcon={<Plus className="size-5" />} onClick={handleCreate}>
          New storybook
        </Button>
      </div>

      {isGuest && projects.length > 0 && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 shrink-0" />
            You're creating as a guest — make a free account so your storybooks are saved to you,
            not this browser.
          </span>
          <Button size="sm" variant="secondary" onClick={openAuthDialog}>
            Create free account
          </Button>
        </div>
      )}

      {!isGuest && !hasAnyKey && (
        <div className="mb-6 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="size-4 shrink-0" />
          AI generation is being set up on the server — it'll be ready soon.
        </div>
      )}

      {projects.length === 0 ? (
        <button
          onClick={handleCreate}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-ink-200 bg-white/50 py-20 text-center transition hover:border-brand-300 hover:bg-white"
        >
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
            <Sparkles className="size-7" />
          </span>
          <span className="text-base font-semibold text-ink-800">Create your first storybook</span>
          <span className="max-w-sm text-sm text-ink-500">
            Paste a story, choose a style, and the studio will craft references, a screenplay, and
            illustrations.
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => handleOpen(p.id)}
                onDelete={() => setPendingDelete(p.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this storybook?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This permanently deletes the storybook — its story, characters, and all generated
          artwork — from your account. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
