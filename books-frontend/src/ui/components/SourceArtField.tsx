"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import type { SourceArtRef } from "../../core/types";
import { SOURCE_ART_MAX } from "../../core/book/sourceArt";
import { canAddSourceArt, uploadSourceArt } from "../../platform/sourceArt";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { Button } from "./Button";

export function SourceArtField({
  images,
  subjectName,
  hint,
  onChange,
  disabled = false,
  className,
}: {
  images: SourceArtRef[];
  subjectName: string;
  hint: string;
  onChange: (images: SourceArtRef[]) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const [working, setWorking] = useState(false);
  const canAdd = canAddSourceArt(images);

  async function select(files: FileList | null) {
    if (!files?.length || working || disabled) return;
    const current = imagesRef.current;
    const remaining = SOURCE_ART_MAX - current.length;
    if (remaining <= 0) {
      notify.info("That’s enough", "You can add up to 3 pictures for one character.");
      return;
    }
    setWorking(true);
    try {
      const next = [...current];
      for (const file of Array.from(files).slice(0, remaining)) {
        const uploaded = await uploadSourceArt(file);
        next.push(uploaded.ref);
        imagesRef.current = next;
      }
      await onChange(next);
    } catch (err) {
      notify.error(err);
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(index: number) {
    if (working || disabled) return;
    const next = imagesRef.current.filter((_, i) => i !== index);
    imagesRef.current = next;
    void onChange(next);
  }

  return (
    <div className={cn("rounded-xl border border-ink-100 bg-ink-50/60 p-3", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        className="sr-only"
        disabled={disabled || working || !canAdd}
        onChange={(event) => void select(event.target.files)}
      />

      <div className="flex items-start gap-3">
        <div className="flex flex-wrap gap-1.5">
          {images.map((image, index) => (
            <SourceArtThumb
              key={image.blobId}
              blobId={image.blobId}
              label={`${subjectName} drawing ${index + 1}`}
              disabled={disabled || working}
              onRemove={() => removeAt(index)}
            />
          ))}
          {canAdd && (
            <button
              type="button"
              disabled={disabled || working}
              onClick={() => inputRef.current?.click()}
              aria-label={`Add artwork for ${subjectName}`}
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-2xs ring-1 ring-ink-200 transition hover:ring-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {working ? (
                <Loader2 className="size-4 animate-spin" />
              ) : images.length === 0 ? (
                <ImagePlus className="size-5" />
              ) : (
                <Plus className="size-4" />
              )}
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink-700">
            {working
              ? "Adding artwork…"
              : images.length > 0
                ? "Character artwork added"
                : "Use existing artwork"}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{hint}</p>
        </div>

        {images.length === 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || working}
            onClick={() => inputRef.current?.click()}
            className="h-8 shrink-0 text-xs"
          >
            Add
          </Button>
        )}
      </div>
    </div>
  );
}

function SourceArtThumb({
  blobId,
  label,
  disabled,
  onRemove,
}: {
  blobId: string;
  label: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { url, status } = useBlobUrlState(blobId);
  return (
    <span className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-white shadow-2xs ring-1 ring-ink-200">
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <span
          className={cn(
            "block size-full",
            status === "loading" ? "animate-pulse bg-ink-100" : "bg-ink-50",
          )}
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        title="Remove picture"
        aria-label={`Remove ${label}`}
        className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-md bg-white/95 text-ink-400 shadow-2xs ring-1 ring-ink-200 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        <Trash2 className="size-2.5" />
      </button>
    </span>
  );
}
