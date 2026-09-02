"use client";

import { motion } from "framer-motion";
import { BookOpen } from "lucide-react";
import type { PageDesign } from "../../core/types";
import { CompositedPage, pageDesignHasContent } from "../design/CompositedPage";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";

export interface BookMockupProps {
  /** Front-cover blob id (the user's real art). */
  blobId?: string;
  /** Fallback cover URL (e.g. the branded default) used when no blob resolves. */
  fallbackUrl?: string;
  /** Optional title, overlaid only when showing the fallback/placeholder so a
   *  book stays recognizable before it has its own cover art. */
  title?: string;
  /**
   * Front-cover page design (text boxes, shapes, …). When present with content,
   * the cover face is composited exactly as printed.
   */
  pageDesign?: PageDesign;
  /** Cover width / height aspect ratio. */
  aspect: number;
  /** Front-cover width in px (height derives from the aspect). Default 160. */
  width?: number;
  /** Mockup presentation style: flat facing (default), dynamic 3d angled, or shelf. */
  variant?: "flat" | "3d" | "shelf";
  className?: string;
}

/**
 * A beautiful, tactile hardcover book mockup built from the user's real cover art.
 * Features realistic hardcover binding anatomy:
 * - Hardcover board with rounded outer edges and overhang ("squares")
 * - 3D cylindrical spine wrap with edge highlight
 * - Embossed/debossed hinge crease (gutter joint) with specular catch
 * - Visible cream-colored paper page block with page-edge texture
 * - Satin laminate surface sheen & natural layered ambient occlusion
 */
export function BookMockup({
  blobId,
  fallbackUrl,
  title,
  pageDesign,
  aspect,
  width = 160,
  variant = "flat",
  className,
}: BookMockupProps) {
  const { url: blobUrl, status: blobStatus } = useBlobUrlState(blobId);
  const blobLoading = Boolean(blobId) && blobStatus === "loading";
  const url = blobLoading ? null : blobUrl ?? fallbackUrl ?? null;
  const height = width / aspect;
  const composite = pageDesignHasContent(pageDesign);
  const showTitle = !!title && !blobUrl && !blobLoading && !composite;

  // Render the front cover artwork & printed elements
  const renderCoverFace = () => (
    <div className="relative size-full overflow-hidden bg-ink-100">
      {composite && pageDesign ? (
        <CompositedPage
          pageDesign={pageDesign}
          surfaceWidthPx={width}
          surfaceHeightPx={height}
          illustrationBlobId={blobId}
          illustrationUrl={url}
          illustrationFocus={{ x: 0.5, y: 0 }}
        />
      ) : blobLoading ? (
        <div className="shimmer size-full" aria-hidden />
      ) : url ? (
        <img
          src={url}
          alt="Front cover"
          className="size-full object-cover"
          style={{ objectPosition: "50% 0%" }}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-linear-to-br from-brand-50/70 via-white to-accent-50/70 text-ink-300">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-white/90 text-brand-600 shadow-soft ring-1 ring-ink-100">
            <BookOpen className="size-5" />
          </div>
          <span className="text-xs font-semibold text-ink-500">Your Storybook</span>
        </div>
      )}

      {/* Title overlay on placeholder/default covers */}
      {showTitle && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-linear-to-b from-black/55 via-black/25 to-transparent px-3 pb-8 pt-3">
          <span className="line-clamp-3 text-center font-display text-[13px] font-bold leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/60%)]">
            {title}
          </span>
        </div>
      )}

      {/* Satin Laminate Finish / Diagonal Cover Reflection */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-tr from-transparent via-white/10 to-white/20 opacity-80 mix-blend-overlay transition-opacity duration-300 group-hover:opacity-100"
      />

      {/* Hardcover Spine & Hinge Anatomy */}
      {/* 1. Leftmost spine roll highlight & shading */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-2.5 bg-linear-to-r from-black/25 via-white/15 to-transparent"
      />

      {/* 2. Debossed Hardcover Hinge Crease (Joint groove) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2.75 w-0.5 bg-black/30 shadow-[0_0_1px_rgba(0,0,0,0.5)]"
      />
      {/* 3. Specular highlight line right beside the groove */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3.25 w-px bg-white/35"
      />
      {/* 4. Soft shadow lifting off the hinge onto the front board */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3.5 w-4 bg-linear-to-r from-black/12 via-black/4 to-transparent"
      />

      {/* Subtle perimeter border bevel highlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/20"
      />
    </div>
  );

  // Flat Presentation: Realistic hardcover with visible page block and overhang
  if (variant === "flat") {
    return (
      <div
        className={cn("relative mx-auto select-none", className)}
        style={{ width, height }}
      >
        {/* Natural Hardcover Multi-Layer Drop Shadow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-1 bottom-0 h-4 rounded-[100%] bg-ink-900/15 blur-md transition-all duration-300 group-hover:h-6 group-hover:bg-ink-900/20 group-hover:blur-lg"
        />

        {/* Back Cover Board Lip & Page Block Behind Front Cover */}
        {/* Right page block (the visible paper edge) */}
        <div
          aria-hidden
          className="absolute inset-y-0.5 -right-1 w-1.75 rounded-r-xs border-r border-ink-200/80 bg-linear-to-r from-ink-100 via-[#fcfbfa] to-[#e8e4d8] shadow-xs"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, #fcfbfa 0px, #fcfbfa 2px, #e4e0d4 3px, #e4e0d4 4px)",
          }}
        />

        {/* Bottom page block edge */}
        <div
          aria-hidden
          className="absolute -bottom-0.75 inset-x-1.5 h-1 rounded-b-xs border-b border-ink-200/80 bg-linear-to-b from-ink-100 via-[#f8f6f0] to-[#dfdacb]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to right, #f8f6f0 0px, #f8f6f0 3px, #e2ddd0 4px, #e2ddd0 5px)",
          }}
        />

        {/* Rigid Back Cover Overhang Corner */}
        <div
          aria-hidden
          className="absolute -bottom-1 -right-1.25 size-3 rounded-br-sm bg-ink-700/80 shadow-xs"
        />

        {/* Front Hardcover Board */}
        <div
          className="relative size-full overflow-hidden rounded-r-lg rounded-l-xs ring-1 ring-black/15 shadow-[0_4px_12px_rgba(20,22,58,0.12),0_1px_3px_rgba(20,22,58,0.08)] transition-all duration-300 group-hover:shadow-[0_12px_28px_-4px_rgba(20,22,58,0.22),0_4px_8px_rgba(20,22,58,0.1)]"
        >
          {renderCoverFace()}
        </div>
      </div>
    );
  }

  // 3D Angled Presentation
  const DEPTH = 14;
  const rotateInitial = variant === "shelf" ? -8 : -16;
  const rotateHover = variant === "shelf" ? -3 : -8;

  return (
    <div className={cn("mx-auto select-none", className)} style={{ perspective: "1100px", width, height }}>
      <motion.div
        className="relative size-full"
        style={{ transformStyle: "preserve-3d" }}
        initial={{ rotateY: rotateInitial }}
        whileHover={{ rotateY: rotateHover }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
      >
        {/* 3D Paper Block (Right Edge) */}
        <div
          aria-hidden
          className="absolute right-0 top-0.5 h-[calc(100%-4px)] rounded-r-xs border-r border-ink-200 bg-linear-to-r from-[#f8f6f0] via-[#faf8f2] to-[#e4e0d4]"
          style={{
            width: DEPTH,
            transform: `rotateY(90deg) translateZ(${DEPTH / 2}px)`,
            transformOrigin: "right center",
            backgroundImage:
              "repeating-linear-gradient(to bottom, #faf8f2 0px, #faf8f2 2px, #e2ded0 3px, #e2ded0 4px)",
          }}
        />

        {/* 3D Spine (Left Edge) */}
        <div
          aria-hidden
          className="absolute left-0 top-0 h-full rounded-l-xs border-l border-ink-300 bg-linear-to-r from-ink-800 via-ink-600 to-ink-700 shadow-inner"
          style={{
            width: DEPTH,
            transform: `rotateY(-90deg) translateZ(${DEPTH / 2}px)`,
            transformOrigin: "left center",
          }}
        />

        {/* Front Cover Board */}
        <div
          className="absolute inset-0 overflow-hidden rounded-r-lg rounded-l-xs ring-1 ring-black/15 shadow-lifted"
          style={{ transform: `translateZ(${DEPTH / 2}px)` }}
        >
          {renderCoverFace()}
        </div>

        {/* Back Cover Board */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-l-xs rounded-r-lg bg-ink-800 ring-1 ring-black/20"
          style={{ transform: `translateZ(${-DEPTH / 2}px)` }}
        />
      </motion.div>

      {/* Ambient Ground Shadow */}
      <div
        aria-hidden
        className="mx-auto mt-2 h-3 rounded-[100%] bg-ink-900/15 blur-md"
        style={{ width: width * 0.85 }}
      />
    </div>
  );
}
