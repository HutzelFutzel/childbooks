"use client";

import { motion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";

export interface BookMockupProps {
  /** Front-cover blob id (the user's real art). */
  blobId?: string;
  /** Fallback cover URL (e.g. the branded default) used when no blob resolves. */
  fallbackUrl?: string;
  /** Optional title, overlaid only when showing the fallback/placeholder so a
   *  book stays recognizable before it has its own cover art. */
  title?: string;
  /** Cover width / height aspect ratio. */
  aspect: number;
  /** Front-cover width in px (height derives from the aspect). Default 160. */
  width?: number;
  className?: string;
}

/** Book depth in px — a subtle edge that reads as a hardcover without a slab-like spine. */
const DEPTH = 14;

/**
 * A lightweight CSS-3D hardcover mockup built from the user's real cover art —
 * the "hold it in your hands" moment on the Order stage. Angled slightly open
 * with a printed spine and a paper block; straightens a touch on hover.
 */
export function BookMockup({ blobId, fallbackUrl, title, aspect, width = 160, className }: BookMockupProps) {
  const blobUrl = useBlobUrl(blobId);
  // The real cover (blob) wins; otherwise fall back to the branded default.
  const url = blobUrl ?? fallbackUrl ?? null;
  // Only stamp the title when there's no real cover art — a generated cover
  // already carries the book's identity.
  const showTitle = !!title && !blobUrl;

  return (
    <div className={cn("mx-auto", className)} style={{ perspective: "1100px" }}>
      <motion.div
        className="relative"
        style={{ width, transformStyle: "preserve-3d", aspectRatio: String(aspect) }}
        initial={{ rotateY: -18 }}
        whileHover={{ rotateY: -10 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
      >
        {/* Paper block (right edge) */}
        <div
          aria-hidden
          className="absolute right-0 top-[1.5%] h-[97%] rounded-r-sm bg-linear-to-r from-ink-100 via-white to-ink-100"
          style={{
            width: DEPTH,
            transform: `rotateY(90deg) translateZ(${DEPTH / 2}px)`,
            transformOrigin: "right center",
          }}
        />
        {/* Spine (left edge) — a neutral printed board edge, not a colored slab. */}
        <div
          aria-hidden
          className="absolute left-0 top-0 h-full rounded-l-sm bg-linear-to-b from-ink-700 to-ink-900"
          style={{
            width: DEPTH,
            transform: `rotateY(-90deg) translateZ(${DEPTH / 2}px)`,
            transformOrigin: "left center",
          }}
        />
        {/* Front cover */}
        <div
          className="absolute inset-0 overflow-hidden rounded-r-md rounded-l-sm bg-ink-100 shadow-lifted ring-1 ring-black/10"
          style={{ transform: `translateZ(${DEPTH / 2}px)` }}
        >
          {url ? (
            <img src={url} alt="Front cover" className="size-full object-cover" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 text-ink-300">
              <BookOpen className="size-6" />
              <span className="text-[10px] font-medium text-ink-400">No cover yet</span>
            </div>
          )}
          {/* Title stamp over the default/placeholder cover so drafts stay
              distinguishable before real cover art exists. */}
          {showTitle && (
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-linear-to-b from-black/35 to-transparent p-2.5 pb-6">
              <span
                className="line-clamp-3 text-center font-display text-[13px] font-bold leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/45%)]"
                style={{ paddingLeft: DEPTH / 2 }}
              >
                {title}
              </span>
            </div>
          )}
          {/* Hardcover hinge highlight — a soft shadow along the gutter. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-linear-to-r from-black/15 to-transparent"
          />
        </div>
        {/* Back cover (visible only as depth) */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-l-sm rounded-r-md bg-ink-200"
          style={{ transform: `translateZ(${-DEPTH / 2}px)` }}
        />
      </motion.div>
      {/* Ground shadow */}
      <div
        aria-hidden
        className="mx-auto mt-2 h-3 rounded-[100%] bg-ink-900/15 blur-md"
        style={{ width: width * 0.8 }}
      />
    </div>
  );
}
