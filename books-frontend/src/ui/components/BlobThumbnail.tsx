import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ImageIcon, ImageOff } from "lucide-react";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";
import { paintIn } from "../lib/motion";

export interface BlobThumbnailProps {
  /** Stored blob id. When unset, the `fallback` (or a neutral icon) shows. */
  blobId?: string;
  alt?: string;
  /** width / height aspect ratio. Defaults to 1 (square). */
  aspect?: number;
  className?: string;
  /** Custom empty state (e.g. a type icon). Defaults to a neutral image icon. */
  fallback?: ReactNode;
  /** Skip the paint-in reveal (for dense strips where it would be noisy). */
  instant?: boolean;
}

/**
 * The one shared "blob id → image tile" primitive: resolves the blob, shows a
 * shimmer while it loads, paints the image in with the house `paintIn` reveal,
 * and renders a fallback when there is no image. Small/static contexts (grids,
 * strips, sidebars) compose this; rich editor previews use `ImagePreview`.
 */
export function BlobThumbnail({
  blobId,
  alt = "",
  aspect = 1,
  className,
  fallback,
  instant = false,
}: BlobThumbnailProps) {
  const { url, status } = useBlobUrlState(blobId);
  // Only an in-flight fetch shimmers. A blob that is missing or that failed to
  // download resolves to the empty state instead, so a broken bucket reads as
  // "no image" rather than as "still working".
  const failed = status === "error" || status === "missing";

  return (
    <div
      className={cn("relative overflow-hidden rounded-xl bg-ink-100", className)}
      style={{ aspectRatio: String(aspect) }}
    >
      {status === "loading" ? (
        <div className="shimmer absolute inset-0" aria-hidden />
      ) : url ? (
        <motion.img
          src={url}
          alt={alt}
          className="size-full object-cover"
          variants={paintIn}
          initial={instant ? false : "hidden"}
          animate="visible"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center text-ink-300"
          title={failed ? "This image couldn't be loaded." : undefined}
        >
          {failed ? <ImageOff className="size-6" /> : (fallback ?? <ImageIcon className="size-6" />)}
        </div>
      )}
    </div>
  );
}
