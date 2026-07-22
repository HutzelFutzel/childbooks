import { motion } from "framer-motion";
import { Box, Check, MapPin, User } from "lucide-react";
import type { Anchor, AnchorType } from "../../core/types";
import { currentAnchorImage } from "../../state/ai";
import { BlobThumbnail } from "../components/BlobThumbnail";
import { GenerationOverlay } from "../generation/GenerationOverlay";
import { cn } from "../lib/cn";

export const ANCHOR_TYPE_ICON: Record<AnchorType, typeof User> = {
  character: User,
  place: MapPin,
  object: Box,
};

export interface AnchorCardProps {
  anchor: Anchor;
  onClick: () => void;
  /** Highlight as the current selection (inspector focus). */
  active?: boolean;
  /** Show the compact generation overlay instead of the image. */
  generating?: boolean;
  /** Pick mode: when defined, a checkmark overlay reflects this state. */
  selected?: boolean;
  /** Corner readiness dot (green = has art). Hidden while generating. */
  showStatusDot?: boolean;
}

/**
 * The anchor grid card — portrait tile with the reference art (or a type-icon
 * empty state), a name footer, and optional selection/generation states.
 * Shared by the Characters stage gallery and the import-characters picker.
 */
export function AnchorCard({
  anchor,
  onClick,
  active = false,
  generating = false,
  selected,
  showStatusDot = false,
}: AnchorCardProps) {
  const image = currentAnchorImage(anchor);
  const Icon = ANCHOR_TYPE_ICON[anchor.type];
  const ringActive = active || selected === true;

  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
      onClick={onClick}
      className={cn(
        "group relative flex aspect-3/4 flex-col overflow-hidden rounded-2xl bg-ink-100 text-left ring-1 transition",
        ringActive ? "ring-2 ring-brand-400" : "ring-ink-200 hover:ring-brand-300",
      )}
    >
      <span className="relative flex flex-1 items-center justify-center overflow-hidden">
        {generating ? (
          <GenerationOverlay action="anchorImage" compact />
        ) : (
          <BlobThumbnail
            blobId={image?.blobId}
            alt={anchor.name}
            className="absolute inset-0 size-full rounded-none"
            fallback={
              <span className="flex flex-col items-center gap-1.5 text-ink-300">
                <Icon className="size-8" />
                <span className="text-[10px] font-medium text-ink-400">No art yet</span>
              </span>
            }
          />
        )}
        {selected === true && (
          <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-brand-600 text-(--color-brand-foreground) shadow-soft">
            <Check className="size-3" />
          </span>
        )}
        {showStatusDot && !generating && (
          <span
            className={cn(
              "absolute right-2 top-2 size-2.5 rounded-full ring-2 ring-white",
              image ? "bg-emerald-400" : "bg-ink-300",
            )}
          />
        )}
      </span>
      <span className="flex items-center gap-1.5 border-t border-white/40 bg-white/85 px-2.5 py-2 backdrop-blur">
        <Icon className="size-3.5 shrink-0 text-ink-400" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-800">
          {anchor.name}
        </span>
      </span>
    </motion.button>
  );
}
