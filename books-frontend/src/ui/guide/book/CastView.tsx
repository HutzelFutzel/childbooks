"use client";

/**
 * The people, as plates. Each plate is the person's portrait (or their
 * initial until it is drawn), their name and age, and where their look comes
 * from: a photo, a drawing, a few words, or invented from the story. Editing a
 * plate never draws anything; the well offers the portrait when it is out of
 * date.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import { lookSourceOf, currentPortrait, portraitStatus } from "../../../core/guide/portrait";
import { briefOf } from "../../../core/story/brief";
import type { LookSource, Project, StoryCastMember } from "../../../core/types";
import { canAddSourceArt, uploadSourceArt } from "../../../platform/sourceArt";
import { useChatStudio } from "../../../state/chatStudio";
import { LikenessPhotoField } from "../../components/LikenessPhotoField";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { cn } from "../../lib/cn";
import { addCastMember, removeCastMember, updateCastMember } from "../bookActions";
import { useGuideT } from "../intl";
import { crossfade, lineRise } from "../motion";
import { UnitStatus } from "./UnitStatus";

const SOURCES: LookSource[] = ["photo", "drawing", "describe", "invent"];

export function CastView({ project, locked }: { project: Project; locked: boolean }) {
  const t = useGuideT("plate");
  const chrome = useGuideT("chrome");
  const cast = (briefOf(project.config).cast ?? []).filter((m) => m.name.trim() || !locked);
  const places = (project.anchors ?? []).filter((anchor) => anchor.include && anchor.type === "place");
  const [fresh, setFresh] = useState<string | null>(null);

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-8">
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
              <Plate project={project} member={member} locked={locked} autoFocus={fresh === member.id} />
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
              <li key={place.id} className="rounded-2xl bg-white px-4 py-3 shadow-soft ring-1 ring-ink-900/5">
                <p className="text-sm font-medium text-ink-900">{place.name}</p>
                {place.description && <p className="mt-1 text-sm leading-relaxed text-ink-500">{place.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Plate({
  project,
  member,
  locked,
  autoFocus,
}: {
  project: Project;
  member: StoryCastMember;
  locked: boolean;
  autoFocus: boolean;
}) {
  const t = useGuideT("plate");
  const chip = useChatStudio((s) => s.chip);
  const setChip = useChatStudio((s) => s.setChip);
  const portrait = currentPortrait(project, member.id);
  const status = portraitStatus(project, member.id);
  const url = useBlobUrl(portrait?.blobId);
  const source = member.lookSource ?? lookSourceOf(member);
  const name = member.name.trim();
  const selected = chip?.kind === "person" && chip.castId === member.id;

  return (
    <article className="group/plate relative flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-soft ring-1 ring-ink-900/5">
      <button
        type="button"
        disabled={!portrait || !name}
        onClick={() => setChip(selected ? null : { kind: "person", castId: member.id, name })}
        className={cn(
          "relative block aspect-4/5 w-full overflow-hidden rounded-xl bg-ink-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-500",
          selected && "ring-2 ring-inset ring-ink-900",
        )}
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
              className="size-full object-cover"
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
        <UnitStatus unitId={member.id} stale={status === "stale"} />
      </button>

      <div className="flex items-baseline gap-2 px-1">
        <PlateInput
          value={member.name}
          placeholder={t("name")}
          disabled={locked}
          autoFocus={autoFocus}
          onCommit={(value) => void updateCastMember(member.id, { name: value })}
          className="min-w-0 flex-1 font-display text-lg font-medium text-ink-900"
        />
        <PlateInput
          value={member.age != null ? String(member.age) : ""}
          placeholder={
            member.visualAge
              ? t("estimatedAge", { age: member.visualAge.years })
              : t("age")
          }
          disabled={locked}
          inputMode="numeric"
          onCommit={(value) => {
            const age = Number.parseInt(value, 10);
            void updateCastMember(member.id, { age: Number.isFinite(age) && age >= 0 && age < 120 ? age : undefined });
          }}
          className="w-12 text-right text-sm text-ink-500"
        />
      </div>

      {!locked && (
        <>
          <div className="flex rounded-full bg-ink-50 p-0.5" role="radiogroup">
            {SOURCES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={source === option}
                onClick={() => void updateCastMember(member.id, { lookSource: option })}
                className={cn(
                  "relative flex-1 rounded-full px-2 py-1 text-xs font-medium transition-colors",
                  source === option ? "text-ink-900" : "text-ink-500 hover:text-ink-800",
                )}
              >
                {source === option && (
                  <motion.span
                    layoutId={`plate-source-${member.id}`}
                    className="absolute inset-0 rounded-full bg-white shadow-soft ring-1 ring-ink-900/5"
                    transition={{ duration: 0.2 }}
                  />
                )}
                <span className="relative">{t(option)}</span>
              </button>
            ))}
          </div>
          <SourceBody project={project} member={member} source={source} />
          <button
            type="button"
            onClick={() => void removeCastMember(member.id)}
            aria-label={`${t("remove")} ${name}`}
            className="absolute top-5 right-5 flex size-7 items-center justify-center rounded-full bg-white/90 text-ink-500 opacity-0 shadow-soft transition group-hover/plate:opacity-100 hover:text-ink-900 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
    </article>
  );
}

function SourceBody({ project, member, source }: { project: Project; member: StoryCastMember; source: LookSource }) {
  const t = useGuideT("plate");
  const name = member.name.trim() || "this person";
  if (source === "photo") {
    return (
      <div className="flex flex-col gap-2">
        <LikenessPhotoField
          photo={member.likenessPhoto}
          projectId={project.id}
          subjectId={member.id}
          subjectName={name}
          onChange={(photo) =>
            updateCastMember(member.id, { likenessPhoto: photo, sourceArt: photo ? undefined : member.sourceArt })
          }
          className="border-0 bg-ink-50/70"
        />
        <p className="px-1 text-[11px] leading-snug text-ink-400">
          {member.likenessPhoto ? t("consentAfter", { name }) : t("consent", { name })}
        </p>
      </div>
    );
  }
  if (source === "drawing") return <DrawingField member={member} />;
  if (source === "describe") {
    return (
      <PlateInput
        multiline
        value={member.appearance ?? ""}
        placeholder={t("describePlaceholder")}
        onCommit={(value) => void updateCastMember(member.id, { appearance: value || undefined })}
        className="min-h-16 rounded-xl bg-ink-50/70 px-3 py-2 text-sm text-ink-800"
      />
    );
  }
  return <p className="px-1 text-xs text-ink-400">{t("inventNote")}</p>;
}

function DrawingField({ member }: { member: StoryCastMember }) {
  const t = useGuideT("plate");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const first = member.sourceArt?.[0];
  const url = useBlobUrl(first?.blobId);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    try {
      const { ref } = await uploadSourceArt(file);
      const art = canAddSourceArt(member.sourceArt) ? [...(member.sourceArt ?? []), ref] : [ref];
      await updateCastMember(member.id, { sourceArt: art, likenessPhoto: undefined, lookSource: "drawing" });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-xl bg-ink-50/70 p-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-ink-500 ring-1 ring-ink-200 transition hover:ring-ink-400"
        aria-label={t("drawing")}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-contain" />
        ) : (
          <ImagePlus className="size-4" />
        )}
      </button>
      <p className="text-xs leading-snug text-ink-500">{failed ? t("uploadFailed") : t("drawingWins")}</p>
    </div>
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
  onCommit: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
  inputMode?: "numeric";
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value.trim()) onCommit(draft.trim());
  };
  const shared = {
    value: draft,
    disabled,
    autoFocus,
    placeholder,
    "aria-label": placeholder,
    onBlur: commit,
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
