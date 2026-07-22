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
}: VersionThumbProps) {
  return (
    <div className={cn("group relative shrink-0", size === "md" ? "size-16" : "size-11")}>
      <button
        onClick={onClick}
        className={cn(
          "relative size-full overflow-hidden rounded-lg ring-2 transition",
          active ? "ring-brand-500" : "ring-transparent hover:ring-ink-200",
        )}
      >
        <BlobThumbnail blobId={blobId} alt={`Version ${index}`} className="size-full rounded-none" instant />
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
