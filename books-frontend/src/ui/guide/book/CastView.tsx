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
import { Plus, X } from "lucide-react";
import { currentPortrait, portraitStatus } from "../../../core/guide/portrait";
import { briefOf } from "../../../core/story/brief";
import { isPerson } from "../../../core/story/castKinds";
import type { Project, StoryCastMember } from "../../../core/types";
import { useChatStudio } from "../../../state/chatStudio";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { cn } from "../../lib/cn";
import { addCastMember, removeCastMember, renameCastMember, updateCastMember } from "../bookActions";
import { useGuideT } from "../intl";
import { crossfade, lineRise } from "../motion";
import { UnitStatus } from "./UnitStatus";
import { VersionPager } from "./VersionPager";

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
  const name = member.name.trim();
  const selected = chip?.kind === "person" && chip.castId === member.id;
  const [nameProblem, setNameProblem] = useState<"taken" | "busy" | "unknown" | null>(null);

  return (
    <article
      className={cn(
        "group/plate relative flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-soft ring-1",
        selected ? "ring-ink-900" : "ring-ink-900/5",
      )}
    >
      <button
        type="button"
        disabled={!name}
        aria-pressed={selected}
        onClick={() => setChip(selected ? null : { kind: "person", castId: member.id, name })}
        className={cn(
          "relative block aspect-4/5 w-full overflow-hidden rounded-xl bg-ink-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-500",
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
      <VersionPager
        project={project}
        target={{ kind: "person", castId: member.id, name }}
        className="absolute top-5 left-5"
      />

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
