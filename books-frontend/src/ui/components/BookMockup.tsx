"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties } from "react";
import type { PageDesign } from "../../core/types";
import { CompositedPage, pageDesignHasContent } from "../design/CompositedPage";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";

export interface BookMockupProps {
  /** Front-cover blob id (the user's real art). */
  blobId?: string;
  /** Fallback cover URL (e.g. the branded default) used when no blob resolves. */
  fallbackUrl?: string;
  /**
   * Story title, typeset on the cloth board only when the book has no cover
   * art yet. A real or fallback image is left clean.
   */
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
  /** Standing product shot (default), turned to the page edge, or tipped on a shelf. */
  variant?: "flat" | "3d" | "shelf";
  className?: string;
}

interface Pose {
  yaw: number;
  pitch: number;
  /** Board thickness as a fraction of cover width, so the edge stays visible at card size. */
  depthRatio: number;
  lift: number;
  yawHover: number;
  pitchHover: number;
}

/** Product-photo poses. Negative yaw shows the left board; positive yaw shows the page edge. */
const POSES: Record<NonNullable<BookMockupProps["variant"]>, Pose> = {
  flat: { yaw: -20, pitch: 3, depthRatio: 0.18, lift: -8, yawHover: -6, pitchHover: 0 },
  "3d": { yaw: 32, pitch: 4, depthRatio: 0.22, lift: -10, yawHover: 16, pitchHover: 1 },
  shelf: { yaw: -8, pitch: 14, depthRatio: 0.16, lift: -4, yawHover: -3, pitchHover: 8 },
};

const CLOTH_FACE = [
  "radial-gradient(125% 95% at 50% 36%, transparent 46%, rgba(0,0,0,0.28) 100%)",
  "repeating-linear-gradient(38deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 3px)",
  "repeating-linear-gradient(-38deg, rgba(0,0,0,0.045) 0 1px, transparent 1px 4px)",
  "linear-gradient(165deg, color-mix(in srgb, var(--color-brand-700) 62%, var(--color-ink-900)), color-mix(in srgb, var(--color-brand-900) 40%, var(--color-ink-900)))",
].join(", ");

const CLOTH_SPINE =
  "linear-gradient(to right, rgba(255,255,255,0.22), transparent 22%, rgba(0,0,0,0.35)), linear-gradient(165deg, color-mix(in srgb, var(--color-brand-800) 48%, var(--color-ink-900)), color-mix(in srgb, var(--color-ink-900) 88%, black))";

const SPRING = { type: "spring" as const, stiffness: 260, damping: 24 };

/**
 * Standing hardcover built from the user's cover. The left board, ground
 * shadow, and hover (lift, turn toward camera, one laminate sweep) stay
 * outside the artwork. With no art, the face is a cloth board and the title
 * is debossed into it.
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
  const reduce = useReducedMotion();
  const { url: blobUrl, status: blobStatus } = useBlobUrlState(blobId);
  const blobLoading = Boolean(blobId) && blobStatus === "loading";
  const url = blobLoading ? null : blobUrl ?? fallbackUrl ?? null;
  const height = width / aspect;
  const composite = pageDesignHasContent(pageDesign);
  const pose = POSES[variant];
  const depth = Math.max(8, Math.round(width * pose.depthRatio));
  const radius = Math.max(8, Math.round(width * 0.065));
  const coverTitle = title?.trim() || "Your story";

  return (
    <div
      className={cn("group/book relative mx-auto select-none", className)}
      style={{ width, height, perspective: 1400 }}
    >
      {/* Floor shadow follows the cover's rounded silhouette and falls
          downward, the way a book standing in the reference photo does. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[5%] top-[22%] -bottom-[4%] transition-transform duration-500 ease-out group-hover/book:translate-y-2 motion-reduce:transition-none"
        style={{ transform: `rotate(${pose.yaw * 0.4}deg)`, transformOrigin: "center bottom" }}
      >
        <div
          className="size-full bg-[#2a231c]/35 blur-[10px] transition-all duration-500 ease-out group-hover/book:bg-[#2a231c]/22 group-hover/book:blur-[16px] motion-reduce:transition-none"
          style={{ borderRadius: radius }}
        />
      </div>

      <motion.div
        className="relative size-full"
        style={{ transformStyle: "preserve-3d" }}
        initial="rest"
        animate="rest"
        whileHover={reduce ? undefined : "hover"}
        variants={{
          rest: { y: 0, rotateX: pose.pitch, rotateY: pose.yaw },
          hover: { y: pose.lift, rotateX: pose.pitchHover, rotateY: pose.yawHover },
        }}
        transition={SPRING}
      >
        {variant !== "3d" && (
          <div aria-hidden className="absolute overflow-hidden" style={faceStyle("left", width, height, depth, radius)}>
            {url ? (
              <img
                src={url}
                alt=""
                className="absolute inset-y-0 left-0 h-full max-w-none object-cover brightness-75"
                style={{ width }}
              />
            ) : (
              <div className="size-full" style={{ background: CLOTH_SPINE }} />
            )}
            <div className="absolute inset-0 bg-linear-to-r from-white/25 via-black/10 to-black/45" />
          </div>
        )}

        {variant === "3d" && (
          <div
            aria-hidden
            className="absolute overflow-hidden"
            style={{
              left: "calc(100% - 1px)",
              top: 5,
              width: Math.max(12, Math.round(width * 0.1)),
              height: "calc(100% - 10px)",
              transform: `translateZ(${depth / 2 + 1}px)`,
              borderRadius: `0 ${radius}px ${radius}px 0`,
              backgroundImage: "repeating-linear-gradient(#f4efe4 0 2px, #cbbfa6 2px 3px)",
              boxShadow: "inset -1px 0 0 rgba(255,255,255,0.7)",
            }}
          />
        )}

        {variant === "shelf" && (
          <div
            aria-hidden
            className="absolute"
            style={{
              ...faceStyle("top", width, height, depth, 2),
              background: "linear-gradient(#f4efe4, #ddd4c2)",
            }}
          />
        )}

        <div
          className="absolute inset-0 overflow-hidden bg-ink-100"
          style={{
            ...faceStyle("front", width, height, depth, radius, variant),
            boxShadow:
              "0 1px 1px rgba(28,22,16,0.28), 2px 6px 7px rgba(28,22,16,0.16), 6px 16px 18px rgba(28,22,16,0.1)",
          }}
        >
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
            <div
              className="shimmer size-full"
              style={{ backgroundColor: "color-mix(in srgb, var(--color-brand-800) 42%, var(--color-ink-900))" }}
              aria-hidden
            />
          ) : url ? (
            <img
              src={url}
              alt="Front cover"
              className="size-full object-cover"
              style={{ objectPosition: "50% 0%" }}
            />
          ) : (
            <ClothCover title={coverTitle} width={width} />
          )}

          {!reduce && !blobLoading && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-[42%] bg-linear-to-r from-transparent via-white to-transparent mix-blend-soft-light"
              variants={{
                rest: { x: "-180%", skewX: -16, opacity: 0, transition: { duration: 0.12 } },
                hover: {
                  x: ["-180%", "340%"],
                  skewX: -16,
                  opacity: [0, 0.8, 0],
                  transition: { duration: 0.72, ease: "easeOut" },
                },
              }}
            />
          )}

          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(0,0,0,0.1)",
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}

function ClothCover({ title, width }: { title: string; width: number }) {
  const fontSize = Math.max(12, Math.min(22, Math.round(width * 0.12)));
  return (
    <div
      className="flex size-full flex-col items-center justify-center px-[12%] text-center"
      style={{ background: CLOTH_FACE }}
    >
      <p
        className="line-clamp-3 font-display font-semibold leading-[1.12] text-[#f6f0e4]"
        style={{
          fontSize,
          textShadow: "0 1px 0 rgba(255,255,255,0.28), 0 -1px 0 rgba(0,0,0,0.45)",
        }}
      >
        {title}
      </p>
      <span aria-hidden className="mt-[9%] h-px w-[28%] bg-[#f3e6c4]/55" />
    </div>
  );
}

type Face = "front" | "left" | "top";

/**
 * Place a board face on a cover of `width`×`height` with `depth` thickness.
 * Side faces tuck a few pixels under the front so the rounded corner doesn't
 * open a gap. The hinge side of the front stays nearly square; the outer
 * corners carry the radius.
 */
function faceStyle(
  face: Face,
  width: number,
  height: number,
  depth: number,
  radius: number,
  variant?: BookMockupProps["variant"],
): CSSProperties {
  const hidden: CSSProperties = {
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  };
  const tuck = 3;
  if (face === "front") {
    const borderRadius =
      variant === "3d" ? `${radius}px 0 0 ${radius}px` : `0 ${radius}px ${radius}px 0`;
    return { ...hidden, borderRadius, transform: `translateZ(${depth / 2 + 1}px)` };
  }
  if (face === "top") {
    return {
      ...hidden,
      width: "100%",
      height: depth,
      left: 0,
      top: "50%",
      marginTop: -depth / 2,
      transform: `rotateX(90deg) translateZ(${height / 2 - 2}px)`,
    };
  }
  return {
    ...hidden,
    width: depth,
    height: "100%",
    left: "50%",
    top: 0,
    marginLeft: -depth / 2,
    borderRadius: `${radius}px 0 0 ${radius}px`,
    transform: `rotateY(-90deg) translateZ(${width / 2 - tuck}px)`,
  };
}
