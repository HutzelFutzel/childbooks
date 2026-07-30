import { useMemo } from "react";
import { ImageOff } from "lucide-react";
import type { Anchor } from "../../core/types";
import { cellAspect, layoutOf, sheetSpecFor } from "../../core/pipeline/anchorLayout";
import { currentAnchorImage } from "../../state/ai";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";

export interface AnchorCellViewProps {
  anchor: Anchor;
  /** Which cell to show: the whole-subject view or the head close-up. */
  cell?: "body" | "head";
  className?: string;
}

/**
 * Shows ONE cell of an anchor's reference sheet.
 *
 * Uses a CSS background window rather than a cropped blob: the sheet's grid is
 * recorded on the image, so the right cell can be framed with arithmetic alone
 * — no second stored image, and it stays correct when the user flips to an
 * older version with a different layout. Since the sheet background is
 * flattened to white, a cell on a white surface reads as a cut-out figure.
 *
 * Always renders a sized, visible box (loading shimmer / failure icon / the
 * windowed cell) rather than an empty tag when there's no image yet — an
 * invisible `<span>` with no fallback is indistinguishable from "still
 * working" and from a genuinely broken load, and gives a caller relying on
 * CSS sizing (percentage heights, etc.) nothing to see if that sizing is
 * ever wrong.
 */
export function AnchorCellView({ anchor, cell = "body", className }: AnchorCellViewProps) {
  const image = currentAnchorImage(anchor);
  const { url, status } = useBlobUrlState(image?.blobId);

  // Sheets predating the layout contract have no recorded grid; the spec for
  // the anchor's current shape is the best guess available, and a slightly
  // mis-framed cell still beats showing the whole sheet. Independent of the
  // blob load, so the aspect ratio (and therefore the box's size) is stable
  // even while the image itself is still loading or has failed.
  const layout = useMemo(
    () => image?.layout ?? layoutOf(sheetSpecFor(anchor)),
    [image?.layout, anchor],
  );
  const aspectRatio = String(cellAspect(layout));

  const style = useMemo(() => {
    if (!url) return undefined;
    const index = cell === "head" ? (layout.headCell ?? layout.bodyCell) : layout.bodyCell;
    const col = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    // With a percentage background-size, a percentage position interpolates
    // across the overflow, so cell k sits at k/(n-1) of the range.
    const px = layout.columns > 1 ? (col / (layout.columns - 1)) * 100 : 50;
    const py = layout.rows > 1 ? (row / (layout.rows - 1)) * 100 : 50;
    return {
      backgroundImage: `url(${url})`,
      backgroundSize: `${layout.columns * 100}% ${layout.rows * 100}%`,
      backgroundPosition: `${px}% ${py}%`,
      backgroundRepeat: "no-repeat",
      aspectRatio,
    } as const;
  }, [url, layout, cell, aspectRatio]);

  if (style) {
    return <span className={className} style={style} role="img" aria-label={anchor.name} />;
  }

  const failed = status === "error" || status === "missing";
  return (
    <span
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-md bg-ink-100",
        className,
      )}
      style={{ aspectRatio }}
      title={failed ? "This image couldn't be loaded." : undefined}
    >
      {status === "loading" && <span className="shimmer absolute inset-0" aria-hidden />}
      {failed && <ImageOff className="size-1/4 text-ink-300" />}
    </span>
  );
}
