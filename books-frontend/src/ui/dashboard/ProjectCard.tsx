import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { BookOpen, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Project } from "../../core/types";
import { COVER_FRONT_ID } from "../../core/types";
import { bookProductForConfig } from "../../core/book";
import { defaultCoverAsset } from "../../core/config/branding";
import { currentIllustration } from "../../state/ai";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useProjectsStore } from "../../state/projectsStore";
import { Badge } from "../components/Badge";
import { BookMockup } from "../components/BookMockup";
import { Popover } from "../components/Popover";
import { notify } from "../lib/notify";

/** A friendly status derived from how far the book has actually been built. */
function projectStatus(p: Project): { label: string; tone: "brand" | "accent" | "success" | "neutral" } {
  if (p.stage === "setup") return { label: "Draft", tone: "neutral" };
  const illustrated = p.illustrations ? Object.keys(p.illustrations).length : 0;
  if (illustrated > 0) return { label: "Illustrated", tone: "success" };
  if (p.screenplay) return { label: "Screenplay ready", tone: "accent" };
  if (p.anchors && p.anchors.length > 0) return { label: "Cast ready", tone: "brand" };
  return { label: "In studio", tone: "brand" };
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export interface ProjectCardProps {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}

export function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps) {
  const branding = useAppConfigStore((s) => s.branding);
  const renameProject = useProjectsStore((s) => s.renameProject);
  const duplicateProject = useProjectsStore((s) => s.duplicateProject);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.title);
  const [duplicating, setDuplicating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRenameValue(project.title);
  }, [project.title]);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const aspect = bookProductForConfig(project.config).aspect;
  const coverBlobId = currentIllustration(project, COVER_FRONT_ID)?.blobId;
  const fallbackUrl = coverBlobId
    ? undefined
    : defaultCoverAsset(branding, aspect, "front")?.imageUrl;

  const status = projectStatus(project);

  const handleSaveRename = async () => {
    const trimmed = renameValue.trim();
    setIsRenaming(false);
    if (trimmed && trimmed !== project.title) {
      await renameProject(project.id, trimmed);
      notify.success("Title updated");
    } else {
      setRenameValue(project.title);
    }
  };

  const handleDuplicate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (duplicating) return;
    setDuplicating(true);
    try {
      const newId = await duplicateProject(project.id);
      if (newId) {
        notify.success("Storybook duplicated", "A copy was added to your library.");
      }
    } catch {
      notify.error("Could not duplicate storybook");
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 350, damping: 26 }}
      onClick={isRenaming ? undefined : onOpen}
      onKeyDown={(e) => {
        if (!isRenaming && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open storybook: ${project.title}`}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-soft transition-all duration-200 hover:border-brand-200 hover:shadow-lifted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {/* Cover Showcase Area */}
      <div className="relative flex h-52 w-full items-center justify-center overflow-hidden bg-linear-to-b from-ink-50/80 via-ink-50/40 to-white px-4 pt-6 pb-4 sm:h-56">
        {/* Soft atmospheric background glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-6 bottom-4 rounded-full bg-brand-200/0 blur-2xl transition-all duration-300 group-hover:bg-brand-200/40"
        />

        {/* Book Cover Preview */}
        <div className="relative transition-transform duration-300 group-hover:scale-[1.03]">
          <BookMockup
            blobId={coverBlobId}
            fallbackUrl={fallbackUrl}
            title={coverBlobId ? undefined : project.title}
            pageDesign={project.design?.pages[COVER_FRONT_ID]}
            aspect={aspect}
            width={136}
            variant="flat"
          />
        </div>

        {/* Hover quick-open pill */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-900/80 px-3 py-1 text-xs font-semibold text-white shadow-lifted backdrop-blur-sm">
            <BookOpen className="size-3.5" />
            Open storybook
          </span>
        </div>

        {/* Top-right floating actions menu */}
        <div
          className="absolute right-3 top-3 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <Popover
            align="end"
            panelClassName="w-48 p-1.5"
            trigger={(open) => (
              <span
                className={`flex size-8 items-center justify-center rounded-xl border border-ink-200/70 bg-white/90 text-ink-600 shadow-soft backdrop-blur-sm transition hover:bg-white hover:text-ink-900 ${
                  open ? "ring-2 ring-brand-400 text-ink-900" : "opacity-80 group-hover:opacity-100"
                }`}
                title="Storybook options"
              >
                <MoreHorizontal className="size-4" />
              </span>
            )}
          >
            {(close) => (
              <div className="flex flex-col gap-0.5 text-xs font-medium text-ink-700">
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onOpen();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-ink-50 hover:text-ink-900 transition-colors"
                >
                  <BookOpen className="size-3.5 text-ink-500" />
                  Open book
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setIsRenaming(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-ink-50 hover:text-ink-900 transition-colors"
                >
                  <Pencil className="size-3.5 text-ink-500" />
                  Rename
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    close();
                    void handleDuplicate(e);
                  }}
                  disabled={duplicating}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-ink-50 hover:text-ink-900 transition-colors disabled:opacity-50"
                >
                  <Copy className="size-3.5 text-ink-500" />
                  Duplicate
                </button>
                <div className="my-1 h-px bg-ink-100" />
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
                >
                  <Trash2 className="size-3.5 text-red-500" />
                  Delete
                </button>
              </div>
            )}
          </Popover>
        </div>
      </div>

      {/* Card Info Details */}
      <div className="flex flex-1 flex-col justify-between border-t border-ink-100/70 p-4">
        <div>
          {isRenaming ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveRename();
                  if (e.key === "Escape") {
                    setIsRenaming(false);
                    setRenameValue(project.title);
                  }
                }}
                className="w-full rounded-lg border border-brand-300 bg-brand-50/40 px-2 py-1 text-sm font-bold text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          ) : (
            <h3
              className="line-clamp-1 font-display text-[15px] font-bold text-ink-900 transition-colors group-hover:text-brand-600"
              title={project.title}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsRenaming(true);
              }}
            >
              {project.title}
            </h3>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-ink-400 font-medium">{timeAgo(project.updatedAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}
