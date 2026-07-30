import { Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import { BlobThumbnail } from "./BlobThumbnail";

export interface VersionThumbProps {
  blobId: string;
  /** 1-based version number. Shown as a corner badge unless `hideIndex`. */
  index: number;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
  /** `md` = 64px (editor history strip), `sm` = 44px (page card strip). */
  size?: "sm" | "md";
  hideIndex?: boolean;
  /**
   * Width / height of the underlying image. Defaults to 1 (square), which is
   * right for page illustrations but NOT for anchor sheets — pass the sheet's
   * own aspect (see `sheetAspect`) there so the thumb isn't cropped/stretched
   * to a shape the actual image was never rendered at.
   */
  aspect?: number;
}

/**
 * A selectable item in a version-history strip: thumbnail, active ring,
 * version-number badge, and delete-on-hover. Shared by the anchor editor and
 * the page editor so version strips look and behave identically everywhere.
 */
export function VersionThumb({
  blobId,
  index,
  active,
  onClick,
  onDelete,
  size = "md",
  hideIndex = false,
  aspect = 1,
}: VersionThumbProps) {
  return (
    <div
      className={cn("group relative shrink-0", size === "md" ? "h-16" : "h-11")}
      // A fixed HEIGHT + the image's own aspect ratio, rather than a fixed
      // square box: a non-square sheet (e.g. the landscape bipedal grid) then
      // keeps its real shape instead of being squashed/cropped into a square.
      style={{ aspectRatio: String(aspect) }}
    >
      <button
        onClick={onClick}
        className={cn(
          "relative size-full overflow-hidden rounded-lg ring-2 transition",
          active ? "ring-brand-500" : "ring-transparent hover:ring-ink-200",
        )}
      >
        <BlobThumbnail
          blobId={blobId}
          alt={`Version ${index}`}
          aspect={aspect}
          className="size-full rounded-none"
          instant
        />
        {!hideIndex && (
          <span className="absolute bottom-0 right-0 rounded-tl bg-ink-900/60 px-1 text-[10px] text-white">
            {index}
          </span>
        )}
      </button>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete this version"
          aria-label={`Delete version ${index}`}
          className="absolute -right-1 -top-1 hidden rounded-full bg-ink-900/80 p-0.5 text-white transition hover:bg-red-600 group-hover:block"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}
