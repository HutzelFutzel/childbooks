"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import type { LikenessPhotoRef } from "../../core/types";
import { legalUrlByRole } from "../../core/config/legal";
import {
  deleteLikenessPhoto,
  getLikenessPhotoBlob,
  likenessPhotoExpired,
  uploadLikenessPhoto,
} from "../../platform/likeness";
import { useAppConfigStore } from "../../state/appConfigStore";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { Button } from "./Button";

export function useLikenessPhotoUrl(
  projectId: string,
  subjectId: string,
  photo: LikenessPhotoRef | undefined,
): {
  url: string | null;
  loading: boolean;
} {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>({
    url: null,
    loading: Boolean(photo),
  });

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    if (!photo) {
      setState({ url: null, loading: false });
      return;
    }
    setState({ url: null, loading: true });
    void getLikenessPhotoBlob({
      projectId,
      subjectId,
      createdAt: photo.createdAt,
    })
      .then((blob) => {
        if (!active) return;
        created = blob ? URL.createObjectURL(blob) : null;
        setState({ url: created, loading: false });
      })
      .catch(() => {
        if (active) setState({ url: null, loading: false });
      });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [photo?.createdAt, projectId, subjectId]);

  return state;
}

export function LikenessPhotoField({
  photo,
  projectId,
  subjectId,
  subjectName,
  onChange,
  disabled = false,
  className,
}: {
  photo?: LikenessPhotoRef;
  projectId: string;
  subjectId: string;
  subjectName: string;
  onChange: (photo: LikenessPhotoRef | undefined) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const legal = useAppConfigStore((state) => state.legal);
  const privacyUrl = legalUrlByRole(legal, "privacy");
  const inputRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const { url: storedPreview, loading } = useLikenessPhotoUrl(
    projectId,
    subjectId,
    photo,
  );
  const expired = likenessPhotoExpired(photo);
  const preview = localPreview ?? storedPreview;

  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  async function select(file: File | undefined) {
    if (!file || working) return;
    setWorking(true);
    try {
      const uploaded = await uploadLikenessPhoto({ projectId, subjectId, file });
      const nextPreview = URL.createObjectURL(uploaded.preview);
      setLocalPreview((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextPreview;
      });
      await onChange(uploaded.ref);
    } catch (err) {
      notify.error(err);
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove() {
    if (!photo || working) return;
    const createdAt = photo.createdAt;
    setLocalPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    void onChange(undefined);
    void deleteLikenessPhoto({ projectId, subjectId, createdAt }).catch(() => {
      // It is already detached from the book; the server's hard expiry remains
      // the deletion backstop if this best-effort request was interrupted.
    });
  }

  const hasUsablePhoto = Boolean(photo && !expired);

  return (
    <div
      className={cn(
        "rounded-xl border border-ink-100 bg-ink-50/60 p-3",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        disabled={disabled || working}
        onChange={(event) => void select(event.target.files?.[0])}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || working}
          onClick={() => inputRef.current?.click()}
          aria-label={hasUsablePhoto ? `Replace photo for ${subjectName}` : `Add photo for ${subjectName}`}
          className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-brand-600 shadow-2xs ring-1 ring-ink-200 transition hover:ring-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {preview && hasUsablePhoto ? (
            <img src={preview} alt="" className="size-full object-cover" />
          ) : working || (loading && hasUsablePhoto) ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Camera className="size-5" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
            {working ? (
              <>
                <Loader2 className="size-3.5 animate-spin text-brand-600" />
                Preparing photo…
              </>
            ) : hasUsablePhoto ? (
              <>
                <Check className="size-3.5 text-emerald-600" />
                <span className="truncate">Photo added for {subjectName}</span>
              </>
            ) : expired ? (
              "Photo expired"
            ) : (
              "Create from a photo"
            )}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
            {expired
              ? "Add it again, or create this character from the written details."
              : hasUsablePhoto
                ? `Used once to create ${subjectName} in your chosen style.`
                : "Add one to guide the illustrated look."}
          </p>
        </div>

        {hasUsablePhoto ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || working}
              onClick={() => inputRef.current?.click()}
              className="h-8 px-2 text-xs"
            >
              Change
            </Button>
            <button
              type="button"
              onClick={remove}
              disabled={disabled || working}
              title="Remove photo"
              aria-label={`Remove photo for ${subjectName}`}
              className="flex size-8 items-center justify-center rounded-lg text-ink-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || working}
            onClick={() => inputRef.current?.click()}
            leftIcon={!working ? <Camera className="size-3.5" /> : undefined}
            className="h-8 shrink-0 text-xs"
          >
            {expired ? "Add again" : "Add photo"}
          </Button>
        )}
      </div>

      <p className="mt-2 flex items-start gap-1.5 border-t border-ink-100 pt-2 text-[10px] leading-relaxed text-ink-400">
        <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-600" />
        <span>
          {hasUsablePhoto
            ? `Deleted after ${subjectName}’s illustrated look is created, or within 24 hours.`
            : "By adding a photo, you confirm you’re an adult and have permission to use it. The source is deleted after the character is created, or within 24 hours."}
          {privacyUrl && (
            <>
              {" "}
              <a
                href={privacyUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-ink-600"
              >
                Privacy
              </a>
            </>
          )}
        </span>
      </p>
    </div>
  );
}
