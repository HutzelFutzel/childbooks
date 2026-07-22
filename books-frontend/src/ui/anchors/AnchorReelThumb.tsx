import { motion } from "framer-motion";
import type { Anchor } from "../../core/types";
import { currentAnchorImage } from "../../state/ai";
import { BlobThumbnail } from "../components/BlobThumbnail";
import { GenerationOverlay } from "../generation/GenerationOverlay";
import { cn } from "../lib/cn";
import { ANCHOR_TYPE_ICON } from "./AnchorCard";

export interface AnchorReelThumbProps {
  anchor: Anchor;
  /** The real, persisted selection — survives leaving the reel. */
  committed: boolean;
  /** Merely hovered — shown on the stage for now, but reverts the instant
   *  the cursor leaves the reel without a click. Gets a visibly lighter
   *  treatment than `committed` so it never reads as "this is now picked". */
  previewing?: boolean;
  generating?: boolean;
  /** Click / tap / keyboard focus — always commits the selection. */
  onSelect: () => void;
  /** Pointer entered the thumb — the caller decides whether/when this should
   *  preview it on the stage (desktop-only, debounced). */
  onMouseEnter?: () => void;
}

/**
 * A single compact "casting reel" thumbnail — small enough to fit a whole
 * cast across the top of the stage. Just the portrait, its name, and its
 * type (character/place/object) as plain text — no icon chrome to decode.
 * Hovering it (via the parent's debounced handler) already shows the real
 * thing on the stage below (a light "previewing" look); clicking/tapping
 * commits that as the real selection (the bolder "committed" look) — the
 * two intentionally look different so a careless hover never reads as an
 * actual pick.
 */
export function AnchorReelThumb({
  anchor,
  committed,
  previewing = false,
  generating = false,
  onSelect,
  onMouseEnter,
}: AnchorReelThumbProps) {
  const image = currentAnchorImage(anchor);
  const Icon = ANCHOR_TYPE_ICON[anchor.type];
  const ready = Boolean(image);
  // Only one can visually "win" — a click always immediately clears the
  // preview (see `commitSelect`), but guard order here too just in case.
  const spotlighted = committed || previewing;

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      onClick={onSelect}
      onFocus={onSelect}
      onMouseEnter={onMouseEnter}
      title={anchor.name}
      className="group flex shrink-0 flex-col items-center gap-1.5 rounded-xl"
    >
      {/* The portrait scales up smoothly when spotlighted — a separate
          `motion` element from the outer button so this "pop" and the reel's
          own add/remove animation never fight each other. Committed gets the
          full pop; a mere preview gets a noticeably smaller one, so the
          motion itself hints "not settled yet". */}
      <motion.span
        animate={{ scale: committed ? 1.09 : previewing ? 1.04 : 1 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className={cn(
          "relative block h-24 w-20 overflow-hidden rounded-2xl bg-ink-100 ring-2 transition-shadow",
          committed
            ? "shadow-lifted ring-brand-400"
            : previewing
              ? "ring-brand-200"
              : ready
                ? "ring-transparent group-hover:ring-brand-200"
                : "ring-1 ring-dashed ring-ink-200 group-hover:ring-brand-200",
        )}
      >
        {generating ? (
          <GenerationOverlay action="anchorImage" compact />
        ) : (
          <BlobThumbnail
            blobId={image?.blobId}
            alt={anchor.name}
            instant
            className="absolute inset-0 size-full rounded-none"
            fallback={<Icon className="size-6 text-ink-300" />}
          />
        )}
      </motion.span>

      {/* Name + type — outside the overflow-hidden portrait so they can
          actually show, instead of living only in a hover title tooltip or a
          tiny (and hard to tell apart) icon badge. Brand color is reserved
          for "actually picked" — a preview keeps the neutral hover color so
          it doesn't look final. */}
      <span className="flex flex-col items-center">
        <span
          className={cn(
            "max-w-20 truncate text-[11px] font-medium transition-colors",
            committed
              ? "text-brand-600"
              : spotlighted
                ? "text-ink-700"
                : "text-ink-500 group-hover:text-ink-700",
          )}
        >
          {anchor.name}
        </span>
        <span className="text-[10px] capitalize leading-tight text-ink-400">{anchor.type}</span>
      </span>
    </motion.button>
  );
}
