import { useState } from "react";
import { motion } from "framer-motion";
import { ImageIcon, Loader2, ZoomIn } from "lucide-react";
import type { ImageActionId } from "../../core/ai/actions";
import { cn } from "../lib/cn";
import { Modal } from "./Modal";
import { GenerationOverlay } from "../generation/GenerationOverlay";

export interface ImagePreviewProps {
  src?: string | null;
  alt?: string;
  loading?: boolean;
  /** width / height aspect ratio. Defaults to 1. */
  aspect?: number;
  className?: string;
  /** Allow click-to-zoom in an in-app modal. */
  zoomable?: boolean;
  emptyLabel?: string;
  /** When set, the loading state shows the rich generation overlay (with a
   *  live time estimate + phases) instead of a plain spinner. */
  loadingAction?: ImageActionId;
  /** Reference count, to sharpen the time estimate. */
  refCount?: number;
}

export function ImagePreview({
  src,
  alt = "",
  loading = false,
  aspect = 1,
  className,
  zoomable = true,
  emptyLabel = "No image yet",
  loadingAction,
  refCount = 0,
}: ImagePreviewProps) {
  const [zoom, setZoom] = useState(false);
  const canZoom = zoomable && Boolean(src) && !loading;

  return (
    <>
      <div
        className={cn(
          "group relative overflow-hidden rounded-xl bg-ink-100 ring-1 ring-inset ring-ink-200",
          canZoom && "cursor-zoom-in",
          className,
        )}
        style={{ aspectRatio: String(aspect) }}
        onClick={() => canZoom && setZoom(true)}
      >
        {loading ? (
          loadingAction ? (
            <GenerationOverlay action={loadingAction} refCount={refCount} />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-400">
              <Loader2 className="size-6 animate-spin" />
              <span className="text-xs">Generating…</span>
            </div>
          )
        ) : src ? (
          <>
            <motion.img
              src={src}
              alt={alt}
              className="size-full object-cover"
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            />
            {canZoom && (
              <div className="absolute right-2 top-2 rounded-lg bg-ink-900/50 p-1.5 text-white opacity-0 transition group-hover:opacity-100">
                <ZoomIn className="size-4" />
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-400">
            <ImageIcon className="size-6" />
            <span className="text-xs">{emptyLabel}</span>
          </div>
        )}
      </div>

      {src && (
        <Modal open={zoom} onClose={() => setZoom(false)} size="max-w-3xl">
          <img src={src} alt={alt} className="mx-auto max-h-[75vh] rounded-lg object-contain" />
        </Modal>
      )}
    </>
  );
}
