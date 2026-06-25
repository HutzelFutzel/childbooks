import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import type { Project } from "../../core/types";
import { Badge } from "../components/Badge";

/** A friendly status derived from how far the book has actually been built. */
function projectStatus(p: Project): { label: string; tone: "brand" | "accent" | "success" | "neutral" } {
  if (p.stage === "setup") return { label: "Draft", tone: "neutral" };
  const illustrated = p.illustrations ? Object.keys(p.illustrations).length : 0;
  if (illustrated > 0) return { label: "Illustrated", tone: "success" };
  if (p.screenplay) return { label: "Screenplay ready", tone: "accent" };
  if (p.anchors && p.anchors.length > 0) return { label: "Characters ready", tone: "brand" };
  return { label: "In studio", tone: "brand" };
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export interface ProjectCardProps {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}

export function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps) {
  const preview = project.config.storyText.trim().slice(0, 140);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="group relative flex cursor-pointer flex-col rounded-2xl bg-white p-5 ring-1 ring-ink-100 shadow-soft hover:shadow-lifted"
      onClick={onOpen}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="line-clamp-1 text-base font-semibold text-ink-900">{project.title}</h3>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded-lg p-1.5 text-ink-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
          aria-label="Delete project"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <p className="line-clamp-3 min-h-15 text-sm text-ink-500">
        {preview || "No story text yet."}
      </p>
      <div className="mt-4 flex items-center justify-between">
        {(() => {
          const s = projectStatus(project);
          return <Badge tone={s.tone}>{s.label}</Badge>;
        })()}
        <span className="text-xs text-ink-400">{timeAgo(project.updatedAt)}</span>
      </div>
    </motion.div>
  );
}
