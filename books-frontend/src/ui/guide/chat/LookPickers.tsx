"use client";

/**
 * The two ways to hand over a picture of someone: photos (up to three, for a
 * likeness) and one piece of artwork (for the design). Both show exactly what
 * was chosen, add and remove one at a time, and only start a portrait when the
 * reader confirms. In quiet mode (a person picked from the cast) every change
 * is saved on the spot and nothing is drawn.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ImageOff, Loader2, Plus, ShieldCheck, X } from "lucide-react";
import { legalUrlByRole } from "../../../core/config/legal";
import { decideArtworkLook } from "../../../core/guide/artworkLook";
import { currentPortrait, likenessPhotosOf, lookSourceOf } from "../../../core/guide/portrait";
import { briefOf } from "../../../core/story/brief";
import {
  LIKENESS_PHOTOS_MAX,
  type ArtStyleSelection,
  type LikenessPhotoRef,
  type Project,
  type SourceArtRef,
  type StoryCastMember,
} from "../../../core/types";
import { deleteLikenessPhoto, likenessPhotoExpired, uploadLikenessPhoto } from "../../../platform/likeness";
import { uploadSourceArt } from "../../../platform/sourceArt";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useChatStudio } from "../../../state/chatStudio";
import { chooseAndStartPortraits } from "../../../state/portraitAutoStart";
import { useProjectsStore } from "../../../state/projectsStore";
import { useLikenessPhotoUrl } from "../../components/LikenessPhotoField";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { cn } from "../../lib/cn";
import { chooseDerivedStyle, updateCastMember } from "../bookActions";
import { useGuideList, useGuideT } from "../intl";

export type StartEstimate = { names: string[]; maxSparks: number } | null;

export function StartNote({ estimate, className }: { estimate: StartEstimate; className?: string }) {
  const t = useGuideT("looks");
  const list = useGuideList();
  if (!estimate || estimate.names.length === 0) return null;
  return (
    <p className={cn("text-[11px] leading-snug text-ink-500", className)}>
      {t(estimate.names.length > 1 ? "startsNowMany" : "startsNow", { names: list(estimate.names) })}
      {estimate.maxSparks > 0 && (
        <>
          {" · "}
          <span className="font-medium text-ink-700">{t("upTo", { sparks: estimate.maxSparks })}</span>
        </>
      )}
    </p>
  );
}

export function PanelShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2.5 rounded-xl border border-ink-100 bg-ink-50/60 p-3">{children}</div>;
}

/** The portrait was drawn from photos that have since been deleted, as the consent promises. */
export function photoWasUsedUp(project: Project, member: StoryCastMember): boolean {
  return (
    member.lookSource === "photo" &&
    likenessPhotosOf(member).length === 0 &&
    Boolean(currentPortrait(project, member.id)?.inputs.sourceKey.startsWith('["photo"'))
  );
}

/** Why an upload failed, in the words the upload itself gave. */
function uploadError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "";
}

function UploadFailed({ reason }: { reason: string }) {
  const t = useGuideT("looks");
  return (
    <p role="alert" className="text-xs leading-snug text-red-600">
      {t("uploadFailed")}
      {reason && <span className="mt-0.5 block text-[11px] text-red-500">{reason}</span>}
    </p>
  );
}

function PrimaryButton({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="inline-flex min-h-10 items-center gap-2 self-start rounded-full bg-ink-900 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2 disabled:opacity-50"
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const TILE = "relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl";

/** A local preview as an object URL that goes away with the tile. */
function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-ink-900/75 text-white transition hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

function EmptyTile({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-label={label}
      title={label}
      className={cn(
        TILE,
        "border border-dashed border-ink-300 bg-white/70 text-ink-500 transition",
        onClick && !disabled
          ? "hover:border-ink-500 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
          : "opacity-50",
      )}
    >
      <Plus className="size-5" aria-hidden />
    </button>
  );
}

type PhotoSlot = { ref: LikenessPhotoRef; preview?: Blob };

function PhotoTile({
  projectId,
  castId,
  slot,
  index,
  onRemove,
}: {
  projectId: string;
  castId: string;
  slot: PhotoSlot;
  index: number;
  onRemove: () => void;
}) {
  const t = useGuideT("looks");
  const local = useObjectUrl(slot.preview);
  const stored = useLikenessPhotoUrl(projectId, castId, slot.preview ? undefined : slot.ref);
  const url = local ?? stored.url;
  const expired = likenessPhotoExpired(slot.ref);
  return (
    <div className={cn(TILE, "bg-white ring-1 ring-ink-200")}>
      {url && !expired ? (
        <img src={url} alt={t("photoSlot", { n: index + 1 })} className="size-full object-cover" />
      ) : stored.loading && !expired ? (
        <Loader2 className="size-4 animate-spin text-ink-400" aria-hidden />
      ) : (
        <ImageOff className="size-4 text-ink-300" aria-hidden />
      )}
      <RemoveButton label={t("removePhoto", { n: index + 1 })} onClick={onRemove} />
    </div>
  );
}

export function PhotoPanel({
  project,
  member,
  name,
  cap,
  quiet,
}: {
  project: Project;
  member: StoryCastMember;
  name: string;
  cap: StartEstimate;
  quiet: boolean;
}) {
  const t = useGuideT("looks");
  const legal = useAppConfigStore((s) => s.legal);
  const privacyUrl = legalUrlByRole(legal, "privacy");
  const castId = member.id;
  const input = useRef<HTMLInputElement>(null);

  const saved = lookSourceOf(member) === "photo" ? likenessPhotosOf(member) : [];
  const savedKey = saved.map((photo) => photo.createdAt).join(",");
  const [slots, setSlotsState] = useState<PhotoSlot[]>(() => saved.map((ref) => ({ ref })));
  const slotsRef = useRef(slots);
  const setSlots = (next: PhotoSlot[]) => {
    slotsRef.current = next;
    setSlotsState(next);
  };
  const [pending, setPending] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usedUp = slots.length === 0 && photoWasUsedUp(project, member);

  // Saved photos can change underneath (used up by a finished portrait): follow them.
  useEffect(() => {
    if (!quiet || pending > 0) return;
    const known = slotsRef.current;
    if (known.map((slot) => slot.ref.createdAt).join(",") === savedKey) return;
    setSlots(saved.map((ref) => known.find((slot) => slot.ref.createdAt === ref.createdAt) ?? { ref }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, quiet, pending]);

  const persist = (list: PhotoSlot[]) => {
    const [first, ...rest] = list.map((slot) => slot.ref);
    return updateCastMember(castId, {
      likenessPhoto: first,
      moreLikenessPhotos: rest.length > 0 ? rest : undefined,
      ...(first ? { sourceArt: undefined, lookSource: "photo" as const } : {}),
    });
  };

  const room = LIKENESS_PHOTOS_MAX - slots.length - pending;

  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, Math.max(0, room));
    if (input.current) input.current.value = "";
    if (files.length === 0) return;
    setError(null);
    setPending(files.length);
    try {
      for (const file of files) {
        try {
          const { ref, preview } = await uploadLikenessPhoto({
            projectId: project.id,
            subjectId: castId,
            file,
            add: slotsRef.current.length > 0,
          });
          const next = [...slotsRef.current, { ref, preview }];
          setSlots(next);
          setPending((count) => Math.max(0, count - 1));
          if (quiet) await persist(next);
        } catch (err) {
          setError(uploadError(err));
          break;
        }
      }
    } finally {
      setPending(0);
    }
  };

  const remove = (slot: PhotoSlot) => {
    const next = slotsRef.current.filter((item) => item !== slot);
    setSlots(next);
    setError(null);
    if (quiet) void persist(next);
    void deleteLikenessPhoto({ projectId: project.id, subjectId: castId, createdAt: slot.ref.createdAt }).catch(() => {
      // Already detached from the book; the 24-hour expiry is the backstop.
    });
  };

  const confirm = async () => {
    const list = slotsRef.current;
    if (list.length === 0 || confirming) return;
    setConfirming(true);
    try {
      const thumbs = list.flatMap((slot) => (slot.preview ? [URL.createObjectURL(slot.preview)] : []));
      await useChatStudio.getState().tap(
        list.length > 1 ? t("photosAdded", { count: list.length, name }) : t("photoAdded", { name }),
        () => chooseAndStartPortraits(() => persist(list), cap?.maxSparks ?? null),
        {
          undoable: true,
          reply: [{ key: "lookPhotoAdded", priority: "result", vars: { names: name } }],
          thumbs,
        },
      );
    } catch (err) {
      setError(uploadError(err));
    } finally {
      setConfirming(false);
    }
  };

  const anyExpired = slots.some((slot) => likenessPhotoExpired(slot.ref));
  const tiles = Array.from({ length: LIKENESS_PHOTOS_MAX }, (_, i) => {
    const slot = slots[i];
    if (slot) {
      return (
        <PhotoTile key={slot.ref.createdAt} projectId={project.id} castId={castId} slot={slot} index={i} onRemove={() => remove(slot)} />
      );
    }
    if (i < slots.length + pending) {
      return (
        <div key={`wait-${i}`} className={cn(TILE, "border border-dashed border-ink-300 bg-white/70")} aria-busy>
          <Loader2 className="size-4 animate-spin text-ink-400" aria-hidden />
        </div>
      );
    }
    return (
      <EmptyTile
        key={`empty-${i}`}
        label={t("addPhotoSlot", { n: i + 1 })}
        onClick={room > 0 ? () => input.current?.click() : undefined}
      />
    );
  });

  return (
    <PanelShell>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-600">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
        <span>
          {t("consent", { name })}
          {privacyUrl && (
            <>
              {" "}
              <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink-900">
                {t("privacy")}
              </a>
            </>
          )}
        </span>
      </p>
      <p className="text-xs leading-relaxed text-ink-600">{t("photoTip")}</p>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={(event) => void pick(event.target.files)}
      />
      <div className="flex flex-wrap gap-2">{tiles}</div>
      <p className="flex items-center gap-1.5 text-xs text-ink-600" aria-live="polite">
        {pending > 0 ? (
          <>
            <Loader2 className="size-3.5 animate-spin text-ink-400" aria-hidden />
            {t("uploading")}
          </>
        ) : anyExpired ? (
          t("photoExpired")
        ) : slots.length > 0 ? (
          <>
            <Check className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
            {t("photoCount", { count: slots.length, max: LIKENESS_PHOTOS_MAX })}
            {room > 0 && <span className="text-ink-500">· {t("photoMore")}</span>}
          </>
        ) : (
          t("photoEmpty", { max: LIKENESS_PHOTOS_MAX })
        )}
      </p>
      {usedUp && <p className="text-xs leading-relaxed text-ink-600">{t("photoUsedUp", { name })}</p>}
      {error !== null && <UploadFailed reason={error} />}
      {!quiet && slots.length > 0 && (
        <div className="flex flex-col items-start gap-1">
          <PrimaryButton busy={confirming} disabled={pending > 0 || anyExpired} onClick={() => void confirm()}>
            {cap ? t("drawFromPhotos", { name, count: slots.length }) : t("usePhotos", { count: slots.length })}
          </PrimaryButton>
          <StartNote estimate={cap} />
        </div>
      )}
    </PanelShell>
  );
}

type Held = { ref: SourceArtRef; preview: Blob; style: ArtStyleSelection | null };

export function DrawingPanel({
  member,
  name,
  styled,
  estimate,
  quiet,
}: {
  member: StoryCastMember;
  name: string;
  styled: boolean;
  estimate: StartEstimate;
  quiet: boolean;
}) {
  const t = useGuideT("looks");
  const castId = member.id;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "style" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [styleUnread, setStyleUnread] = useState(false);

  const savedRef = lookSourceOf(member) === "drawing" ? member.sourceArt?.[0] : undefined;
  const savedUrl = useBlobUrl(held ? undefined : savedRef?.blobId);
  const heldUrl = useObjectUrl(held?.preview);
  const url = heldUrl ?? savedUrl;
  const has = Boolean(held || savedRef);

  const drawing = (ref: SourceArtRef) => ({
    sourceArt: [ref],
    likenessPhoto: undefined,
    moreLikenessPhotos: undefined,
    lookSource: "drawing" as const,
  });

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file || busy) return;
    setBusy("upload");
    setError(null);
    setStyleUnread(false);
    try {
      const { ref, preview } = await uploadSourceArt(file);
      // The first picture can set the whole book's look. Read it now, while the
      // card still shows progress; saving only writes what was read.
      const current = useProjectsStore.getState().current();
      let style: ArtStyleSelection | null = null;
      if (current && current.config.styleReady === false) {
        setBusy("style");
        const brief = briefOf(current.config);
        const withDrawing: Project = {
          ...current,
          config: {
            ...current.config,
            storyBrief: {
              ...brief,
              cast: (brief.cast ?? []).map((m) => (m.id === castId ? { ...m, ...drawing(ref) } : m)),
            },
          },
        };
        const decision = await decideArtworkLook(withDrawing);
        if (decision.status === "resolved") style = decision.style;
        else setStyleUnread(true);
      }
      if (quiet) {
        await updateCastMember(castId, drawing(ref));
        if (style) await chooseDerivedStyle(style);
        setHeld({ ref, preview, style });
      } else {
        setHeld({ ref, preview, style });
      }
    } catch (err) {
      setError(uploadError(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = () => {
    setHeld(null);
    setStyleUnread(false);
    setError(null);
    if (quiet && savedRef) void updateCastMember(castId, { sourceArt: undefined });
  };

  const confirm = async () => {
    if (!held || busy) return;
    setBusy("confirm");
    try {
      const { ref, preview, style } = held;
      const save = async () => {
        await updateCastMember(castId, drawing(ref));
        if (style) await chooseDerivedStyle(style);
      };
      await useChatStudio.getState().tap(
        t("drawingAdded", { name }),
        () => chooseAndStartPortraits(save, estimate?.maxSparks ?? null),
        {
          undoable: true,
          reply: [{ key: style ? "lookDrawingStyle" : "lookDrawingAdded", priority: "result", vars: { names: name } }],
          thumbs: [URL.createObjectURL(preview)],
        },
      );
    } catch (err) {
      setError(uploadError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <PanelShell>
      <p className="text-xs leading-relaxed text-ink-600">{t(styled ? "drawingNoteStyled" : "drawingNote", { name })}</p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-3">
        {has ? (
          <div className={cn(TILE, "size-24 bg-white ring-1 ring-ink-200")}>
            {url ? (
              <img src={url} alt={t("pictureAlt", { name })} className="size-full object-cover" />
            ) : (
              <Loader2 className="size-4 animate-spin text-ink-400" aria-hidden />
            )}
            {busy === null && <RemoveButton label={t("removePicture")} onClick={remove} />}
          </div>
        ) : busy ? (
          <div className={cn(TILE, "size-24 border border-dashed border-ink-300 bg-white/70")} aria-busy>
            <Loader2 className="size-4 animate-spin text-ink-400" aria-hidden />
          </div>
        ) : (
          <EmptyTile label={t("chooseDrawing")} onClick={() => input.current?.click()} />
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          <p className="text-xs text-ink-600" aria-live="polite">
            {busy === "upload" ? (
              t("uploading")
            ) : busy === "style" ? (
              t("readingDrawing")
            ) : has ? (
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                {t("pictureChosen", { name })}
              </span>
            ) : (
              t("pictureEmpty")
            )}
          </p>
          {has && busy === null && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="text-xs font-medium text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
            >
              {t("replacePicture")}
            </button>
          )}
        </div>
      </div>
      {styleUnread && <p className="text-xs leading-snug text-ink-600">{t("styleNotRead")}</p>}
      {error !== null && <UploadFailed reason={error} />}
      {!quiet && held && (
        <div className="flex flex-col items-start gap-1">
          <PrimaryButton busy={busy === "confirm"} disabled={busy !== null} onClick={() => void confirm()}>
            {styled ? t("drawFromPicture", { name }) : t("usePicture")}
          </PrimaryButton>
          {styled && <StartNote estimate={estimate} />}
        </div>
      )}
    </PanelShell>
  );
}
