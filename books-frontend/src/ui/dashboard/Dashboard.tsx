import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2, Palette, PenLine, Plus, Sparkles } from "lucide-react";
import { defaultCoverAsset } from "../../core/config/branding";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useProjectsStore } from "../../state/projectsStore";
import { useSettingsStore } from "../../state/settingsStore";
import { useAuthStore } from "../../state/authStore";
import { BookMockup } from "../components/BookMockup";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Skeleton } from "../components/Skeleton";
import { breathe, fadeRise, spring } from "../lib/motion";
import { notify } from "../lib/notify";
import { ProjectCard } from "./ProjectCard";

const EMPTY_STEPS = [
  { icon: PenLine, label: "Tell your story" },
  { icon: Palette, label: "Pick an art style" },
  { icon: Sparkles, label: "Watch it come to life" },
] as const;

/** Soft blank cover when branding hasn't published a default image yet. */
function EmptyBookFace() {
  return (
    <div className="relative mx-auto" style={{ perspective: "1100px", width: 148 }}>
      <motion.div
        className="relative"
        style={{ width: 148, aspectRatio: "1", transformStyle: "preserve-3d" }}
        initial={{ rotateY: -16 }}
        whileHover={{ rotateY: -8 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
      >
        <div
          aria-hidden
          className="absolute right-0 top-[1.5%] h-[97%] rounded-r-sm bg-linear-to-r from-ink-100 via-white to-ink-100"
          style={{
            width: 14,
            transform: "rotateY(90deg) translateZ(7px)",
            transformOrigin: "right center",
          }}
        />
        <div
          aria-hidden
          className="absolute left-0 top-0 h-full rounded-l-sm bg-linear-to-b from-ink-700 to-ink-900"
          style={{
            width: 14,
            transform: "rotateY(-90deg) translateZ(7px)",
            transformOrigin: "left center",
          }}
        />
        <div
          className="absolute inset-0 overflow-hidden rounded-r-md rounded-l-sm bg-linear-to-br from-brand-100 via-white to-accent-100 shadow-lifted ring-1 ring-black/10"
          style={{ transform: "translateZ(7px)" }}
        >
          <div
            aria-hidden
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle at 30% 28%, color-mix(in srgb, var(--color-magic-300) 55%, transparent), transparent 42%), radial-gradient(circle at 78% 72%, color-mix(in srgb, var(--color-accent-300) 45%, transparent), transparent 46%)",
            }}
          />
          <div className="absolute inset-x-0 top-0 bg-linear-to-b from-black/25 to-transparent px-3 pb-8 pt-3">
            <p className="text-center font-display text-[13px] font-bold leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/40%)]">
              Your story
            </p>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/70 text-brand-600 shadow-soft backdrop-blur-sm">
              <Sparkles className="size-6" />
            </span>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-linear-to-r from-black/15 to-transparent"
          />
        </div>
      </motion.div>
      <div
        aria-hidden
        className="mx-auto mt-2 h-3 rounded-[100%] bg-ink-900/15 blur-md"
        style={{ width: 118 }}
      />
    </div>
  );
}

function DashboardEmpty({
  creating,
  onCreate,
}: {
  creating: boolean;
  onCreate: () => void;
}) {
  const branding = useAppConfigStore((s) => s.branding);
  const aspect = 1;
  const coverUrl = defaultCoverAsset(branding, aspect, "front")?.imageUrl;

  return (
    <motion.div
      variants={fadeRise}
      initial="hidden"
      animate="show"
      className="relative overflow-hidden rounded-4xl bg-aurora px-6 py-14 text-center shadow-soft ring-1 ring-ink-100/80 sm:px-10 sm:py-16"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-8 h-64 w-64 -translate-x-1/2 rounded-full bg-brand-200/35 blur-3xl"
      />

      <motion.div
        className="relative mx-auto w-fit"
        animate={breathe.animate}
        transition={breathe.transition}
      >
        {coverUrl ? (
          <BookMockup fallbackUrl={coverUrl} title="Your story" aspect={aspect} width={148} />
        ) : (
          <EmptyBookFace />
        )}
      </motion.div>

      <div className="relative mx-auto mt-8 max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
          Every great book starts blank
        </p>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-[2.15rem]">
          Your first storybook is a few clicks away
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-500">
          Paste or write a tale, choose an art style, and the studio does the rest — consistent
          characters, beautiful pages, and illustrations made just for your story.
        </p>
      </div>

      <div className="relative mt-7">
        <Button
          size="lg"
          leftIcon={creating ? undefined : <Plus className="size-5" />}
          onClick={onCreate}
          loading={creating}
        >
          Create your storybook
        </Button>
      </div>

      <ul className="relative mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-0">
        {EMPTY_STEPS.map(({ icon: Icon, label }, i) => (
          <li key={label} className="flex items-center sm:contents">
            {i > 0 && (
              <span aria-hidden className="mx-3 hidden h-px w-8 bg-ink-200/90 sm:inline-block" />
            )}
            <motion.span
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.12 + i * 0.06 }}
              className="inline-flex items-center gap-2 text-sm text-ink-600"
            >
              <span className="flex size-8 items-center justify-center rounded-xl bg-white/80 text-brand-600 shadow-soft ring-1 ring-ink-100/80">
                <Icon className="size-3.5" strokeWidth={2.25} />
              </span>
              {label}
            </motion.span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

export function Dashboard() {
  const projects = useProjectsStore((s) => s.projects);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const createProject = useProjectsStore((s) => s.createProject);
  const openProject = useProjectsStore((s) => s.openProject);
  const deleteProject = useProjectsStore((s) => s.deleteProject);
  const hasAnyKey = useSettingsStore((s) => s.hasAnyKey());
  const isGuest = useAuthStore((s) => s.accessLevel === "guest");
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Guest-first: everyone creates and opens projects immediately. Guests get
  // nudged (not blocked) to create an account so their work survives.
  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createProject();
    } finally {
      setCreating(false);
    }
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
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
            Your storybooks
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Every book you create lives here — pick one up to keep writing, illustrating, or
            order a printed copy.
          </p>
        </div>
        <Button
          size="lg"
          leftIcon={<Plus className="size-5" />}
          onClick={handleCreate}
          loading={creating}
          disabled={!projectsLoaded}
        >
          New storybook
        </Button>
      </div>

      {isGuest && projects.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <span className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0" />
            You're creating as a guest — save your storybooks to a free account so they're never
            lost, on any device.
          </span>
          <Button size="sm" variant="secondary" onClick={() => openAuthDialog()} className="shrink-0">
            Save my storybooks
          </Button>
        </div>
      )}

      {!isGuest && !hasAnyKey && (
        <div className="mb-6 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="size-4 shrink-0" />
          We're finishing setup on our end — illustrations will be ready to generate shortly.
        </div>
      )}

      {!projectsLoaded ? (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label="Loading storybooks"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-3 rounded-3xl px-3 pb-3 pt-4">
              <Skeleton className="h-44 w-36" rounded="2xl" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
          <span className="sr-only">
            <Loader2 className="size-4 animate-spin" /> Loading your storybooks…
          </span>
        </div>
      ) : projects.length === 0 ? (
        <DashboardEmpty creating={creating} onCreate={handleCreate} />
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
              Keep it
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete forever
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          Its story, characters, and every illustration will be gone for good — there's no getting
          this one back.
        </p>
      </Modal>
    </div>
  );
}
