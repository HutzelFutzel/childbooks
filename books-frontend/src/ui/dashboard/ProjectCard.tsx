import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import type { Project } from "../../core/types";
import { COVER_FRONT_ID } from "../../core/types";
import { bookProductForConfig } from "../../core/book";
import { defaultCoverAsset } from "../../core/config/branding";
import { currentIllustration } from "../../state/ai";
import { useAppConfigStore } from "../../state/appConfigStore";
import { Badge } from "../components/Badge";
import { BookMockup } from "../components/BookMockup";

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
  const branding = useAppConfigStore((s) => s.branding);

  // Cover-forward: show the book's real front cover as a 3D mockup, or the
  // branded default (matched to the book's format) with the title stamped on it
  // so brand-new drafts stay recognizable.
  const aspect = bookProductForConfig(project.config).aspect;
  const coverBlobId = currentIllustration(project, COVER_FRONT_ID)?.blobId;
  const fallbackUrl = coverBlobId
    ? undefined
    : defaultCoverAsset(branding, aspect, "front")?.imageUrl;

  const status = projectStatus(project);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      whileHover="hover"
      className="group relative flex cursor-pointer flex-col items-center gap-3 rounded-3xl px-3 pb-3 pt-4"
      onClick={onOpen}
    >
      {/* Soft glow that blooms behind the book on hover — gives the shelf depth
          without a boxy card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-4 bottom-16 rounded-4xl bg-brand-100/0 blur-2xl transition-colors duration-300 group-hover:bg-brand-100/60"
      />

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute right-1 top-1 z-10 rounded-full bg-white/80 p-1.5 text-ink-400 opacity-0 shadow-soft backdrop-blur transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
        aria-label="Delete project"
      >
        <Trash2 className="size-4" />
      </button>

      <motion.div
        className="relative"
        variants={{ hover: { y: -6 } }}
        transition={{ type: "spring", stiffness: 380, damping: 26 }}
      >
        <BookMockup
          blobId={coverBlobId}
          fallbackUrl={fallbackUrl}
          title={coverBlobId ? undefined : project.title}
          aspect={aspect}
          width={176}
        />
      </motion.div>

      <div className="relative w-full text-center">
        <h3 className="line-clamp-1 font-display text-[15px] font-bold text-ink-900">{project.title}</h3>
        <div className="mt-1.5 flex items-center justify-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-xs text-ink-400">{timeAgo(project.updatedAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}
