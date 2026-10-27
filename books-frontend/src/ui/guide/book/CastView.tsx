"use client";

/**
 * The people, as plates. Each plate is the portrait (or an initial until one
 * is drawn), the name, and the age, both read-only (renaming and changing an
 * age go through the chat, which carries them through the book; only a plate
 * nobody has named yet takes a name here). A photo, a drawing, or a description is
 * chosen in the chat: selecting the plate opens that person's section there.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, MessageCircle, Plus, X, ZoomIn } from "lucide-react";
import { normalizeAnchorName } from "../../../core/book/anchorRefs";
import { currentPortrait, lookSourceOf, portraitStatus } from "../../../core/guide/portrait";
import { PORTRAIT_ASPECT } from "../../../core/guide/portraitFrame";
import { briefOf } from "../../../core/story/brief";
import { isPerson } from "../../../core/story/castKinds";
import type { Anchor, Project, StoryCastMember } from "../../../core/types";
import { useChatStudio } from "../../../state/chatStudio";
import { useJobsStore } from "../../../state/jobsStore";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { Modal } from "../../components/Modal";
import { cn } from "../../lib/cn";
import { addCastMember, removeCastMember, renameCastMember, updateCastMember } from "../bookActions";
import { useGuideT } from "../intl";
import { crossfade, lineRise } from "../motion";
import { UnitStatus, useUnitWorking } from "./UnitStatus";
import { VersionPager } from "./VersionPager";

export function CastView({ project, locked }: { project: Project; locked: boolean }) {
  const t = useGuideT("plate");
  const chrome = useGuideT("chrome");
  const cast = (briefOf(project.config).cast ?? []).filter((m) => m.name.trim() || !locked);
  const places = (project.anchors ?? []).filter((anchor) => anchor.include && anchor.type === "place");
  const [fresh, setFresh] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const portraits = cast.filter((member) => currentPortrait(project, member.id));
  const previewAt = previewId ? portraits.findIndex((member) => member.id === previewId) : -1;
  const preview = previewAt >= 0 ? portraits[previewAt] : null;

  useEffect(() => {
    if (previewId && previewAt < 0) setPreviewId(null);
  }, [previewAt, previewId]);

  const stepPreview = (delta: -1 | 1) => {
    if (previewAt < 0 || portraits.length < 2) return;
    const next = (previewAt + delta + portraits.length) % portraits.length;
    setPreviewId(portraits[next]!.id);
  };

  return (
    <>
      <div className="h-full overflow-y-auto px-5 py-6 sm:px-8">
        {!locked && portraits.length > 0 && (
          <p className="mx-auto mb-4 flex max-w-4xl items-start gap-2 px-1 text-sm leading-snug text-ink-500">
            <MessageCircle className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
            {t("hint")}
          </p>
        )}
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {cast.map((member) => (
              <motion.div
                key={member.id}
                layout
                variants={lineRise}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
              >
                <Plate
                  project={project}
                  member={member}
                  locked={locked}
                  autoFocus={fresh === member.id}
                  onPreview={() => setPreviewId(member.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {!locked && (
            <motion.button
              layout
              type="button"
              onClick={() => void addCastMember().then(setFresh)}
              className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-200 text-sm font-medium text-ink-500 transition hover:border-ink-400 hover:bg-white hover:text-ink-800"
            >
              <Plus className="size-5" />
              {t("addPerson")}
            </motion.button>
          )}
        </div>
        {places.length > 0 && (
          <section className="mx-auto mt-8 max-w-4xl">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{chrome("places")}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {places.map((place) => (
                <PlaceItem key={place.id} place={place} />
              ))}
            </ul>
          </section>
        )}
      </div>
      {preview && (
        <PortraitPreview
          project={project}
          member={preview}
          position={previewAt + 1}
          total={portraits.length}
          onClose={() => setPreviewId(null)}
          onPrevious={() => stepPreview(-1)}
          onNext={() => stepPreview(1)}
        />
      )}
    </>
  );
}

function PlaceItem({ place }: { place: Anchor }) {
  const chrome = useGuideT("chrome");
  const active = useJobsStore((s) => s.activeUnitIds.has(place.id));
  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-2xl bg-white px-4 py-3 shadow-soft ring-1 transition",
        active ? "ring-magic-300" : "ring-ink-900/5",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 animate-[guide-sheen_2.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-magic-100/40 to-transparent motion-reduce:hidden"
        />
      )}
      <div className="relative flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink-900">{place.name}</p>
        {active && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-magic-100/80 px-2.5 py-0.5 text-[11px] font-medium text-magic-700">
            <span className="size-1.5 animate-ping rounded-full bg-magic-500 motion-reduce:animate-none" aria-hidden />
            {chrome("preparingUnit")}
          </span>
        )}
      </div>
      {place.description && <p className="relative mt-1 text-sm leading-relaxed text-ink-500">{place.description}</p>}
    </li>
  );
}

function Plate({
  project,
  member,
  locked,
  autoFocus,
  onPreview,
}: {
  project: Project;
  member: StoryCastMember;
  locked: boolean;
  autoFocus: boolean;
  onPreview: () => void;
}) {
  const t = useGuideT("plate");
  const chip = useChatStudio((s) => s.chip);
  const setChip = useChatStudio((s) => s.setChip);
  const portrait = currentPortrait(project, member.id);
  const status = portraitStatus(project, member.id);
  const url = useBlobUrl(portrait?.blobId);
  const name = member.name.trim();
  const characterAnchor =
    (project.anchors ?? []).find((anchor) => anchor.type === "character" && anchor.castId === member.id) ??
    (project.anchors ?? []).find(
      (anchor) =>
        anchor.type === "character" &&
        !anchor.castId &&
        normalizeAnchorName(anchor.name) === normalizeAnchorName(name),
    );
  const { working, preparing } = useUnitWorking(
    member.id,
    characterAnchor?.id,
    false,
    Boolean(url),
  );
  const source = lookSourceOf(member);
  const drawingTitle = preparing
    ? t("preparingPerson", { name: name || t("name") })
    : t("drawingPerson", { name: name || t("name") });
  const drawingSubtitle =
    source === "photo"
      ? t("drawingFromPhoto")
      : source === "drawing"
        ? t("drawingFromDrawing")
        : source === "describe"
          ? t("drawingFromDescription")
          : t("drawingFromStory");
  const selected = chip?.kind === "person" && chip.castId === member.id;
  const [nameProblem, setNameProblem] = useState<"taken" | "busy" | "unknown" | null>(null);
  // Selecting a face aims the chat at them: the cursor goes to the field too,
  // except on a touch screen where that would raise the keyboard over the card.
  const select = () => {
    if (selected) {
      setChip(null);
      return;
    }
    setChip({ kind: "person", castId: member.id, name });
    if (typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches) {
      useChatStudio.setState((state) => ({ composerFocus: state.composerFocus + 1 }));
    }
  };

  return (
    <article
      className={cn(
        "group/plate relative flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-soft ring-1 transition",
        selected
          ? "ring-ink-900"
          : working
            ? "ring-magic-300 shadow-lifted"
            : "ring-ink-900/5",
      )}
    >
      <button
        type="button"
        disabled={!name}
        aria-pressed={selected}
        onClick={select}
        className={cn(
          "relative block w-full overflow-hidden rounded-xl bg-ink-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-500",
        )}
        style={{ aspectRatio: PORTRAIT_ASPECT }}
        aria-label={name}
      >
        <AnimatePresence mode="popLayout">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <motion.img
              key={url}
              src={url}
              alt=""
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={crossfade}
              className="size-full object-cover object-top"
            />
          ) : (
            <motion.span
              key="initial"
              className="flex size-full items-center justify-center font-display text-5xl text-ink-300"
            >
              {name.charAt(0).toUpperCase() || "?"}
            </motion.span>
          )}
        </AnimatePresence>
        <UnitStatus
          unitId={member.id}
          extraUnitId={characterAnchor?.id}
          stale={status === "stale"}
          hasArt={Boolean(url)}
          title={drawingTitle}
          subtitle={drawingSubtitle}
        />
      </button>
      <VersionPager
        project={project}
        target={{ kind: "person", castId: member.id, name }}
        className="absolute top-5 left-5"
      />
      {url && (
        <button
          type="button"
          onClick={onPreview}
          aria-label={t("enlarge", { name })}
          className={cn(
            "absolute right-5 flex size-8 items-center justify-center rounded-full bg-white/90 text-ink-700 opacity-0 shadow-soft ring-1 ring-ink-900/5 transition hover:bg-white hover:text-ink-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-500 group-hover/plate:opacity-100 pointer-coarse:opacity-100",
            locked ? "top-5" : "top-14",
          )}
        >
          <ZoomIn className="size-4" aria-hidden />
        </button>
      )}

      <div className="flex items-baseline gap-2 px-1">
        {name ? (
          // A name is read, not edited here: renaming goes through the chat, which carries it through the whole book.
          <h3 className="min-w-0 flex-1 truncate font-display text-lg font-medium text-ink-900">{name}</h3>
        ) : (
          // Only a plate nobody has named yet takes a name here; there is nothing to carry through the book.
          <PlateInput
            value=""
            placeholder={t("name")}
            disabled={locked}
            autoFocus={autoFocus}
            onCommit={async (value) => {
              setNameProblem(null);
              if (!value) return;
              const outcome = await renameCastMember(member.id, value);
              if (outcome.ok) return true;
              if (outcome.reason === "taken" || outcome.reason === "busy" || outcome.reason === "unknown") {
                setNameProblem(outcome.reason);
              }
              return false;
            }}
            className="min-w-0 flex-1 font-display text-lg font-medium text-ink-900"
          />
        )}
        {isPerson(member) ? (
          <AgeTag member={member} />
        ) : (
          <PlateInput
            value={member.species ?? ""}
            placeholder={t("species")}
            disabled={locked}
            onCommit={(value) => void updateCastMember(member.id, { species: value.trim().slice(0, 80) || undefined })}
            className="w-28 text-right text-sm text-ink-500"
          />
        )}
      </div>
      {nameProblem && (
        <p role="alert" className="px-1 text-xs text-amber-700">
          {t(nameProblem === "busy" ? "nameBusy" : "nameTaken")}
        </p>
      )}

      {/* Changes are made in the chat; this says so, and is the way there. */}
      {!locked && name && (
        <button
          type="button"
          onClick={select}
          aria-pressed={selected}
          className={cn(
            "inline-flex min-h-8 items-center gap-1.5 self-start rounded-full px-2.5 text-xs font-medium ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
            selected
              ? "bg-ink-900 text-white ring-ink-900"
              : "bg-white text-ink-700 ring-ink-200 hover:ring-ink-400 hover:text-ink-900",
          )}
        >
          <MessageCircle className="size-3.5" aria-hidden />
          {selected ? t("changeLookActive", { name }) : t("changeLook")}
        </button>
      )}

      {!locked && (
        <button
          type="button"
          onClick={() => void removeCastMember(member.id)}
          aria-label={`${t("remove")} ${name}`}
          className="absolute top-5 right-5 flex size-7 items-center justify-center rounded-full bg-white/90 text-ink-500 opacity-0 shadow-soft transition group-hover/plate:opacity-100 hover:text-ink-900 focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </article>
  );
}

function PortraitPreview({
  project,
  member,
  position,
  total,
  onClose,
  onPrevious,
  onNext,
}: {
  project: Project;
  member: StoryCastMember;
  position: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const t = useGuideT("plate");
  const portrait = currentPortrait(project, member.id);
  const url = useBlobUrl(portrait?.blobId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNext, onPrevious]);

  return (
    <Modal open onClose={onClose} title={member.name.trim()} size="max-w-4xl">
      <div className="flex flex-col gap-3">
        <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-2xl bg-ink-50">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={t("portraitAlt", { name: member.name.trim() })} className="max-h-[72vh] w-auto object-contain" />
          )}
          {total > 1 && (
            <>
              <PreviewStep label={t("previousPortrait")} side="left" onClick={onPrevious}>
                <ChevronLeft className="size-5" />
              </PreviewStep>
              <PreviewStep label={t("nextPortrait")} side="right" onClick={onNext}>
                <ChevronRight className="size-5" />
              </PreviewStep>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-1">
          <AgeTag member={member} />
          {total > 1 && <span className="text-xs tabular-nums text-ink-400">{position} / {total}</span>}
        </div>
      </div>
    </Modal>
  );
}

function PreviewStep({
  label,
  side,
  onClick,
  children,
}: {
  label: string;
  side: "left" | "right";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink-700 shadow-soft ring-1 ring-ink-900/5 transition hover:bg-white hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-500",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The age, read-only, with its unit: a quiet "5 yrs" (a number alone could be
 * anything). An age the story or the picture suggested, rather than one the
 * author gave, reads "About 5 yrs". No age, nothing: the chat asks for it.
 */
function AgeTag({ member }: { member: StoryCastMember }) {
  const t = useGuideT("plate");
  const chrome = useGuideT("chrome");
  const given = member.age != null || member.ageMonths != null;
  const months = member.age == null && member.ageMonths != null;
  const n = member.age ?? member.ageMonths ?? member.visualAge?.years;
  if (n == null) return null;
  const short = months ? t("ageMonthsShort", { n }) : t(given ? "ageYearsShort" : "ageYearsAbout", { n });
  const full = months ? chrome("ageMonthsValue", { n }) : chrome("ageYearsValue", { n });
  return (
    <span
      className="shrink-0 text-sm tabular-nums text-ink-500"
      title={given ? full : t("ageEstimatedHint", { age: full })}
    >
      {short}
    </span>
  );
}

function PlateInput({
  value,
  onCommit,
  placeholder,
  disabled,
  autoFocus,
  multiline,
  inputMode,
  className,
}: {
  value: string;
  /** Resolve to false when the change was refused: the field then shows what the book still says. */
  onCommit: (value: string) => void | boolean | Promise<boolean | void>;
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
  inputMode?: "numeric";
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => {
    if (draft.trim() === value.trim()) return;
    if ((await onCommit(draft.trim())) === false) setDraft(value);
  };
  const shared = {
    value: draft,
    disabled,
    autoFocus,
    placeholder,
    "aria-label": placeholder,
    onBlur: () => void commit(),
    className: cn(
      "bg-transparent transition placeholder:text-ink-300 focus:outline-none disabled:opacity-100",
      className,
    ),
  };
  return multiline ? (
    <textarea {...shared} rows={2} onChange={(event) => setDraft(event.target.value)} className={cn(shared.className, "resize-none")} />
  ) : (
    <input
      {...shared}
      inputMode={inputMode}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
