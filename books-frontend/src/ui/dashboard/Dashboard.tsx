import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpDown,
  BookOpen,
  Loader2,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { defaultCoverAsset } from "../../core/config/branding";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useProjectsStore } from "../../state/projectsStore";
import { useSettingsStore } from "../../state/settingsStore";
import { useAuthStore } from "../../state/authStore";
import { BookMockup } from "../components/BookMockup";
import { Button } from "../components/Button";
import { ConfirmModal } from "../components/ConfirmModal";
import { Skeleton } from "../components/Skeleton";
import { fadeRise } from "../lib/motion";
import { notify } from "../lib/notify";
import { ProjectCard } from "./ProjectCard";
import { defaultDestination, studioPath } from "../studio/studioRoutes";

type SortOption = "recent" | "title" | "created";

const QUICK_STARTERS = [
  "Bedtime Adventure",
  "The Lost Dinosaur",
  "Space Explorer",
  "The Magic Treehouse",
] as const;

function DashboardEmpty({
  creating,
  onCreate,
  onCreateStarter,
}: {
  creating: boolean;
  onCreate: () => void;
  onCreateStarter: (title: string) => void;
}) {
  const branding = useAppConfigStore((s) => s.branding);
  const aspect = 1;
  const coverUrl = defaultCoverAsset(branding, aspect, "front")?.imageUrl;

  return (
    <motion.div
      variants={fadeRise}
      initial="hidden"
      animate="show"
      className="relative mx-auto my-6 max-w-2xl overflow-hidden rounded-3xl border border-ink-100 bg-white p-8 text-center shadow-soft sm:p-12"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-4 h-48 w-48 -translate-x-1/2 rounded-full bg-brand-100/40 blur-3xl"
      />

      <div className="relative mx-auto w-fit">
        <BookMockup
          fallbackUrl={coverUrl}
          title="Your story"
          aspect={aspect}
          width={140}
          variant="flat"
        />
      </div>

      <div className="relative mx-auto mt-6 max-w-md">
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          Create your first storybook
        </h2>
        <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-ink-500">
          Turn any story idea into a personalized illustrated book in minutes.
        </p>
      </div>

      <div className="relative mt-6 flex justify-center">
        <Button
          size="lg"
          leftIcon={creating ? undefined : <Plus className="size-5" />}
          onClick={onCreate}
          loading={creating}
        >
          Create storybook
        </Button>
      </div>

      {/* Quick inspiration starters */}
      <div className="relative mt-8 border-t border-ink-100/80 pt-6">
        <p className="text-xs font-medium text-ink-400">Or start from an idea</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {QUICK_STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => onCreateStarter(starter)}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200/80 bg-ink-50/60 px-3.5 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 active:scale-95 disabled:opacity-50"
            >
              <Sparkles className="size-3 text-brand-500" />
              {starter}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function Dashboard() {
  const router = useRouter();
  const projects = useProjectsStore((s) => s.projects);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const createProject = useProjectsStore((s) => s.createProject);
  const deleteProject = useProjectsStore((s) => s.deleteProject);
  const hasAnyKey = useSettingsStore((s) => s.hasAnyKey());
  const isGuest = useAuthStore((s) => s.accessLevel === "guest");
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (title?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const projectId = await createProject(title, false);
      router.push(studioPath(projectId, "story"), { scroll: false });
    } finally {
      setCreating(false);
    }
  };

  const handleOpen = (id: string) => {
    const project = projects.find((candidate) => candidate.id === id);
    if (!project) return;
    router.push(studioPath(project.id, defaultDestination(project)), { scroll: false });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const targetId = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteProject(targetId);
      notify.success("Storybook deleted");
    } catch {
      notify.error("Could not delete storybook");
    }
  };

  const filteredAndSortedProjects = useMemo(() => {
    let result = [...projects];

    // Filter by search query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((p) => p.title.toLowerCase().includes(q));
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "created") {
        return b.createdAt - a.createdAt;
      }
      // default "recent"
      return b.updatedAt - a.updatedAt;
    });

    return result;
  }, [projects, searchQuery, sortBy]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header & Controls Toolbar */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            Storybooks
          </h1>
          {projectsLoaded && projects.length > 0 && (
            <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-600">
              {projects.length} {projects.length === 1 ? "book" : "books"}
            </span>
          )}
        </div>

        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Input */}
            <div className="relative min-w-48 flex-1 sm:w-64 sm:flex-initial">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                placeholder="Search books..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-xl border border-ink-200/80 bg-white pl-9 pr-8 text-sm text-ink-800 placeholder:text-ink-400 transition hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-ink-400 hover:text-ink-700"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Sort Selector */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="h-10 cursor-pointer appearance-none rounded-xl border border-ink-200/80 bg-white pl-3.5 pr-8 text-sm font-medium text-ink-700 transition hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20"
                aria-label="Sort books"
              >
                <option value="recent">Recently updated</option>
                <option value="title">Alphabetical (A-Z)</option>
                <option value="created">Newest first</option>
              </select>
              <ArrowUpDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            </div>

            {/* Primary Action Button */}
            <Button
              size="md"
              leftIcon={<Plus className="size-4" />}
              onClick={() => handleCreate()}
              loading={creating}
              disabled={!projectsLoaded}
            >
              New storybook
            </Button>
          </div>
        )}
      </div>

      {/* Guest Save Alert */}
      {isGuest && projects.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200/70 bg-brand-50/70 px-4 py-3 text-sm text-brand-900 shadow-xs">
          <span className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-brand-600" />
            <span>
              Guest mode: your books are saved on this browser. Create a free account to keep them safe on any device.
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openAuthDialog()}
            className="shrink-0"
          >
            Save my books
          </Button>
        </div>
      )}

      {/* API Setup Banner */}
      {!isGuest && !hasAnyKey && (
        <div className="mb-6 flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 shadow-xs">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          Setting up creative services. Illustrations will be ready shortly.
        </div>
      )}

      {/* Main Content Area */}
      {!projectsLoaded ? (
        <div
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-busy="true"
          aria-label="Loading storybooks"
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex flex-col overflow-hidden rounded-3xl border border-ink-100 bg-white p-4 shadow-soft"
            >
              <Skeleton className="h-48 w-full" rounded="2xl" />
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4.5 w-3/4" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-16" rounded="full" />
                  <Skeleton className="h-3 w-12" />
                </div>
              </div>
            </div>
          ))}
          <span className="sr-only">
            <Loader2 className="size-4 animate-spin" /> Loading your storybooks...
          </span>
        </div>
      ) : projects.length === 0 ? (
        <DashboardEmpty
          creating={creating}
          onCreate={() => handleCreate()}
          onCreateStarter={(starter) => handleCreate(starter)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* Quick "New Storybook" tile at position #1 */}
          <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ y: -3 }}
            transition={{ type: "spring", stiffness: 350, damping: 26 }}
            onClick={() => handleCreate()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void handleCreate();
              }
            }}
            tabIndex={0}
            role="button"
            aria-label="Create new storybook"
            className="group relative flex min-h-72 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-ink-200 bg-white/50 p-6 text-center shadow-soft transition-all duration-200 hover:border-brand-400 hover:bg-white hover:shadow-lifted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 shadow-soft transition-all duration-200 group-hover:scale-110 group-hover:bg-brand-500 group-hover:text-white">
              {creating ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <Plus className="size-7" strokeWidth={2.25} />
              )}
            </span>
            <p className="mt-4 font-display text-base font-bold text-ink-900 group-hover:text-brand-600">
              New storybook
            </p>
            <p className="mt-1 text-xs text-ink-400">
              Start with a blank canvas or an idea
            </p>
          </motion.div>

          {/* Existing Project Cards */}
          <AnimatePresence initial={false}>
            {filteredAndSortedProjects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => handleOpen(p.id)}
                onDelete={() => setPendingDelete(p.id)}
              />
            ))}
          </AnimatePresence>

          {/* Search Empty Result */}
          {filteredAndSortedProjects.length === 0 && searchQuery && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">
                <Search className="size-6" />
              </span>
              <p className="mt-3 font-display text-base font-semibold text-ink-800">
                No storybooks found matching "{searchQuery}"
              </p>
              <p className="mt-1 text-xs text-ink-400">
                Try searching for a different title or clear your search filter.
              </p>
              <div className="mt-4">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSearchQuery("")}
                >
                  Clear search
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Delete this storybook?"
        confirmLabel="Delete forever"
        cancelLabel="Keep it"
        danger
      >
        This story, its characters, and all generated illustrations will be permanently removed.
      </ConfirmModal>
    </div>
  );
}
