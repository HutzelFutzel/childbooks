"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Check, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/cn";
import { useAppConfigStore } from "@/state/appConfigStore";
import type { SiteImageSlot } from "@/core/config/siteImages";
import { useEditMode } from "./editMode";
import { GraphicPlaceholder } from "./GraphicPlaceholder";

function readBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        base64: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || "image/png",
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * A remote image rendered at a fixed aspect ratio (next/image, contain-fit).
 * `object-contain` (not `cover`) so the full illustration is always visible —
 * uploaded art whose ratio doesn't exactly match `ratio` letterboxes instead of
 * cropping, which matters here since the art is transparent-background.
 */
function ImageFrame({
  url,
  alt,
  ratio,
  className,
  sizes,
}: {
  url: string;
  alt: string;
  ratio: string;
  className?: string;
  sizes: string;
}) {
  return (
    <div style={{ aspectRatio: ratio }} className={cn("relative w-full overflow-hidden rounded-2xl", className)}>
      <Image src={url} alt={alt} fill sizes={sizes} className="object-contain" />
    </div>
  );
}

/**
 * A landing-page illustration slot. For visitors it renders the admin-uploaded
 * image (or a {@link GraphicPlaceholder} when none is set). For a signed-in admin
 * in edit mode it becomes a drag-&-drop drop zone: drop (or click) an image to
 * preview it, then Accept to upload it to public storage or Cancel to discard.
 * The previous image is retained in version history (managed by the backend).
 */
export function EditableImage({
  slotId,
  label,
  ratio = "16/9",
  hint,
  className,
  serverUrl,
  alt,
  sizes = "(max-width: 1024px) 100vw, 600px",
}: {
  slotId: SiteImageSlot;
  label: string;
  ratio?: string;
  hint?: string;
  className?: string;
  /** URL resolved during SSR from `appConfig/siteImages` (may be undefined). */
  serverUrl?: string;
  alt?: string;
  sizes?: string;
}) {
  const editing = useEditMode((s) => s.enabled);
  const storeAsset = useAppConfigStore((s) => s.siteImages.images[slotId]);
  const upload = useAppConfigStore((s) => s.uploadSiteImage);

  const url = storeAsset?.imageUrl ?? serverUrl ?? null;
  const altText = storeAsset?.alt ?? alt ?? label;

  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ previewUrl: string; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Public (non-editing) render — identical to the original placeholder flow.
  if (!editing) {
    return url ? (
      <ImageFrame url={url} alt={altText} ratio={ratio} className={className} sizes={sizes} />
    ) : (
      <GraphicPlaceholder label={label} ratio={ratio} hint={hint} className={className} />
    );
  }

  const takeFile = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending({ previewUrl: URL.createObjectURL(file), file });
  };

  const cancel = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const accept = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await readBase64(pending.file);
      await upload(slotId, base64, mimeType, alt);
      toast.success(`${label} updated.`);
      URL.revokeObjectURL(pending.previewUrl);
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ aspectRatio: ratio }}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl ring-2 ring-dashed transition",
        dragOver ? "ring-brand-500 bg-brand-50/50" : "ring-brand-300/70",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        takeFile(e.dataTransfer.files?.[0]);
      }}
    >
      {pending ? (
        // Local preview of the dropped file (blob URL — not yet uploaded).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pending.previewUrl} alt="" className="absolute inset-0 size-full object-contain" />
      ) : url ? (
        <Image src={url} alt={altText} fill sizes={sizes} className="object-contain" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-brand-50/60 bg-grid p-6 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/80 text-brand-500 shadow-soft">
            <ImageIcon className="size-5" />
          </span>
          <span className="text-sm font-semibold text-brand-700">{label}</span>
          {hint && <span className="text-xs text-brand-400">{hint}</span>}
        </div>
      )}

      {/* Idle affordance: click anywhere (or drop) to choose a replacement. */}
      {!pending && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="absolute inset-0 flex items-center justify-center bg-ink-900/0 opacity-0 outline-none transition group-hover:bg-ink-900/40 group-hover:opacity-100 focus-visible:bg-ink-900/40 focus-visible:opacity-100"
          aria-label={`Replace ${label}`}
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-ink-800 shadow-soft">
            <Upload className="size-4" />
            Drop or click to replace
          </span>
        </button>
      )}

      {/* Confirmation bar while a dropped image is pending upload. */}
      {pending && (
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 px-3">
          <button
            type="button"
            onClick={() => void accept()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lifted transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {busy ? "Uploading…" : "Accept"}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-700 shadow-lifted transition hover:bg-ink-50 disabled:opacity-60"
          >
            <X className="size-4" />
            Cancel
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        className="hidden"
        onChange={(e) => takeFile(e.target.files?.[0])}
      />
    </div>
  );
}
