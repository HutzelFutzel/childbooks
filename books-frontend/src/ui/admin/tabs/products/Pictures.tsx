"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, EyeOff, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import {
  activePhotosFor,
  fallbackKeyFor,
  isFallbackKey,
  parseCatalogMediaKey,
  photosFor,
  primaryPhotoFor,
  resolvedPhotosFor,
  type CatalogPhoto,
} from "../../../../core/config/catalogMedia";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { cn } from "../../../lib/cn";
import { fileToBase64 } from "./parts";

/**
 * Admin UI for catalog pictures — of a print option, a book, the digital edition
 * or a Spark pack. One manager serves all of them because the rules are the same
 * everywhere: upload, retire (which keeps the file as history), reinstate,
 * promote to thumbnail, delete for good.
 *
 * Two entry points, deliberately: a full row in the Product pictures section (to
 * work through a whole set in one sitting) and a bare thumbnail button next to a
 * choice in the product form (for the moment an admin wonders "what IS
 * casewrap?" — the same picture that answers them is the one the customer sees).
 */

/** Why the pictures under this key exist, in the admin's terms. */
function scopeNote(mediaKey: string): string {
  const scope = parseCatalogMediaKey(mediaKey)?.scope;
  if (scope === "option") {
    return "These belong to the option itself, so they appear for every product using it — and for customers choosing a print.";
  }
  if (scope === "ebook") {
    return "Every digital edition is a different book, so these stand for the product itself — the format, not the contents.";
  }
  if (isFallbackKey(mediaKey)) {
    return "These stand in wherever nothing more specific has been uploaded.";
  }
  return "These are shown wherever this item appears, in place of the default set.";
}

/** Small square preview: what a customer would see, default set included. */
export function PictureThumb({
  mediaKey,
  label,
  className,
}: {
  mediaKey: string | undefined;
  label: string;
  className?: string;
}) {
  const media = useAppConfigStore((s) => s.catalogMedia);
  const photo = primaryPhotoFor(media, mediaKey);
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md",
        photo ? "bg-ink-100" : "border border-dashed border-ink-200 bg-white",
        className,
      )}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.imageUrl} alt={photo.alt || label} className="size-full object-cover" />
      ) : (
        <Camera className="size-4 text-ink-300" />
      )}
    </span>
  );
}

/** How a key stands: its own pictures, or a borrowed default set, or nothing. */
function usePictureState(mediaKey: string) {
  const media = useAppConfigStore((s) => s.catalogMedia);
  const own = activePhotosFor(media, mediaKey).length;
  const shown = resolvedPhotosFor(media, mediaKey).length;
  return { own, inherited: own === 0 && shown > 0 };
}

function countLabel(own: number, inherited: boolean): string {
  if (own > 0) return `${own} picture${own === 1 ? "" : "s"}`;
  return inherited ? "Using the default set" : "No pictures yet";
}

/**
 * The thumbnail as a button that opens the manager. Rendered as a SIBLING of an
 * option's radio button (never nested inside it — a button within a button is
 * invalid and breaks keyboard use), so selecting the option and managing its
 * pictures stay separate actions.
 */
export function PictureButton({
  mediaKey,
  label,
  hint,
  className,
}: {
  mediaKey: string | undefined;
  label: string;
  hint?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Hooks can't be called conditionally, so state is read before the early
  // return; the empty key it falls back to simply has no pictures.
  const { own, inherited } = usePictureState(mediaKey ?? "");

  if (!mediaKey) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${countLabel(own, inherited)} — ${label}`}
        aria-label={`Manage pictures of ${label}`}
        className={cn(
          "group relative rounded-md ring-offset-1 transition hover:ring-2 hover:ring-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
          className,
        )}
      >
        <PictureThumb mediaKey={mediaKey} label={label} />
        {own === 0 && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-white p-0.5 shadow-sm ring-1 ring-ink-200">
            <Plus className="size-2.5 text-ink-500" />
          </span>
        )}
        {own > 1 && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-ink-700 px-1 text-[9px] font-semibold text-white">
            {own}
          </span>
        )}
      </button>
      <PictureDialog
        open={open}
        onClose={() => setOpen(false)}
        mediaKey={mediaKey}
        label={label}
        hint={hint}
      />
    </>
  );
}

/**
 * A full row for the Product pictures section: preview, name, how it stands, and
 * one click to manage. Whole row is the target — a row of tiny icon buttons is
 * needlessly fiddly when there's only one thing to do here.
 */
export function PictureRow({
  mediaKey,
  label,
  hint,
  badge,
}: {
  mediaKey: string;
  label: string;
  hint?: string;
  /** Optional status chip, e.g. a product's draft/active state. */
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { own, inherited } = usePictureState(mediaKey);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-lg bg-white p-2 text-left ring-1 ring-inset ring-ink-100 transition hover:bg-ink-50/70 hover:ring-brand-200"
      >
        <PictureThumb mediaKey={mediaKey} label={label} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-ink-800">{label}</span>
            {badge}
          </span>
          {hint && <span className="mt-0.5 block truncate text-[11px] text-ink-500">{hint}</span>}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px]",
            own > 0 ? "font-medium text-ink-600" : inherited ? "text-amber-600" : "text-ink-400",
          )}
        >
          {countLabel(own, inherited)}
        </span>
      </button>
      <PictureDialog
        open={open}
        onClose={() => setOpen(false)}
        mediaKey={mediaKey}
        label={label}
        hint={hint}
      />
    </>
  );
}

function PictureDialog({
  open,
  onClose,
  mediaKey,
  label,
  hint,
}: {
  open: boolean;
  onClose: () => void;
  mediaKey: string;
  label: string;
  hint?: string;
}) {
  const media = useAppConfigStore((s) => s.catalogMedia);
  const all = photosFor(media, mediaKey);
  const active = all.filter((p) => p.active);
  const retired = all.filter((p) => !p.active);
  const fallback = fallbackKeyFor(mediaKey);
  const inherited =
    active.length === 0 && fallback != null && fallback !== mediaKey
      ? activePhotosFor(media, fallback)
      : [];

  return (
    <Modal open={open} onClose={onClose} title={`Pictures — ${label}`} size="max-w-2xl">
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-ink-500">
          {hint ? `${hint} ` : ""}
          {scopeNote(mediaKey)} Filed under{" "}
          <span className="font-mono text-[11px]">{mediaKey}</span>. Retiring one keeps it here so
          you can bring it back.
        </p>

        <UploadRow mediaKey={mediaKey} label={label} />

        <PictureList
          title={active.length > 0 ? "Shown to customers" : "Nothing of its own yet"}
          empty={
            inherited.length > 0
              ? "Falling back to the default set below. Upload one here to override it."
              : "Upload one above — the first picture becomes the thumbnail."
          }
          photos={active}
          mediaKey={mediaKey}
          primaryPath={active[0]?.storagePath}
        />

        {inherited.length > 0 && (
          <div className="space-y-2 rounded-lg bg-amber-50/60 p-2.5 ring-1 ring-inset ring-amber-100">
            <p className="text-xs font-semibold text-amber-800">
              Currently borrowed from the default set
            </p>
            <div className="flex flex-wrap gap-2">
              {inherited.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.storagePath}
                  src={p.imageUrl}
                  alt={p.alt}
                  title={p.alt}
                  className="size-14 rounded-md object-cover ring-1 ring-amber-200"
                />
              ))}
            </div>
            <p className="text-[11px] text-amber-700">
              Edit these under the <span className="font-medium">Default pictures</span> row — they
              stand in for every item without its own.
            </p>
          </div>
        )}

        {retired.length > 0 && (
          <PictureList
            title="Retired"
            empty=""
            photos={retired}
            mediaKey={mediaKey}
            primaryPath={undefined}
          />
        )}
      </div>
    </Modal>
  );
}

/** Pick a file, describe it, then upload — alt text is required, not an afterthought. */
function UploadRow({ mediaKey, label }: { mediaKey: string; label: string }) {
  const upload = useAppConfigStore((s) => s.uploadCatalogPhoto);
  const fileRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<{ file: File; preview: string } | null>(null);
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  // Object URLs leak until revoked; drop the last one whenever it's replaced.
  useEffect(() => () => { if (staged) URL.revokeObjectURL(staged.preview); }, [staged]);

  const reset = () => {
    setStaged(null);
    setAlt("");
    setCaption("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const onUpload = async () => {
    if (!staged || !alt.trim()) return;
    setBusy(true);
    try {
      const base64 = await fileToBase64(staged.file);
      await upload(mediaKey, base64, staged.file.type || "image/jpeg", alt.trim(), caption.trim() || undefined);
      toast.success(`Added a picture of ${label}.`);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg bg-ink-50/60 p-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setStaged({ file, preview: URL.createObjectURL(file) });
        }}
      />
      {!staged ? (
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Plus className="size-4" />}
          onClick={() => fileRef.current?.click()}
        >
          Add a picture
        </Button>
      ) : (
        <div className="flex gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={staged.preview}
            alt=""
            className="size-24 shrink-0 rounded-lg object-cover ring-1 ring-ink-100"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <Field label="Describe the picture (required)">
              <Input
                value={alt}
                autoFocus
                placeholder={`e.g. Close-up of a ${label.toLowerCase()} spine`}
                onChange={(e) => setAlt(e.target.value)}
              />
            </Field>
            <Field label="Caption (optional)">
              <Input
                value={caption}
                placeholder="Shown under the picture to customers"
                onChange={(e) => setCaption(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" loading={busy} disabled={!alt.trim()} onClick={() => void onUpload()}>
                Upload
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PictureList({
  title,
  empty,
  photos,
  mediaKey,
  primaryPath,
}: {
  title: string;
  empty: string;
  photos: CatalogPhoto[];
  mediaKey: string;
  primaryPath: string | undefined;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-ink-700">{title}</p>
      {photos.length === 0 ? (
        empty && <p className="text-xs text-ink-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {photos.map((p) => (
            <PictureRowItem
              key={p.storagePath}
              photo={p}
              mediaKey={mediaKey}
              isPrimary={p.storagePath === primaryPath}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PictureRowItem({
  photo,
  mediaKey,
  isPrimary,
}: {
  photo: CatalogPhoto;
  mediaKey: string;
  isPrimary: boolean;
}) {
  const patch = useAppConfigStore((s) => s.patchCatalogPhoto);
  const remove = useAppConfigStore((s) => s.deleteCatalogPhoto);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const run = async (fn: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-start gap-3 rounded-lg bg-white p-2 ring-1 ring-inset ring-ink-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.imageUrl}
        alt={photo.alt}
        className={cn(
          "size-16 shrink-0 rounded-md object-cover",
          !photo.active && "opacity-40 grayscale",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-700">{photo.alt || "(no description)"}</p>
        {photo.caption && <p className="truncate text-[11px] text-ink-500">{photo.caption}</p>}
        {isPrimary && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
            <Star className="size-2.5" /> Thumbnail
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {photo.active && !isPrimary && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            loading={busy}
            leftIcon={<Star className="size-3" />}
            onClick={() => void run(() => patch(mediaKey, photo.storagePath, { makePrimary: true }), "Could not promote.")}
          >
            Thumbnail
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          loading={busy}
          leftIcon={photo.active ? <EyeOff className="size-3" /> : <RotateCcw className="size-3" />}
          onClick={() =>
            void run(
              () => patch(mediaKey, photo.storagePath, { active: !photo.active }),
              "Could not update.",
            )
          }
        >
          {photo.active ? "Retire" : "Reinstate"}
        </Button>
        {confirming ? (
          <Button
            size="sm"
            variant="danger"
            className="h-7 px-2 text-[11px]"
            loading={busy}
            onClick={() => void run(() => remove(mediaKey, photo.storagePath), "Could not delete.")}
          >
            Delete for good
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-red-600"
            leftIcon={<Trash2 className="size-3" />}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}
