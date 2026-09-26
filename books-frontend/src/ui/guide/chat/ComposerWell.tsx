"use client";

/**
 * The composer well: one short live choice directly above the field. The
 * guide's line carries the reason; the well carries only the buttons. Its
 * content crossfades as the book moves, and it is empty far more often than
 * not.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ImagePlus,
  Loader2,
  MousePointer2,
  Sparkles,
} from "lucide-react";
import { resolveArtStyles } from "../../../core/config/artStyles";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAuthStore } from "../../../state/authStore";
import {
  drawBookUnits,
  anchorRetryUnits,
  illustrationActionFor,
  portraitUnits,
  redrawUnits,
  startDrawBook,
  startBookUpdate,
  startAnchorRetry,
  startPageRetry,
  startPortraits,
  startRedraw,
} from "../../../state/chatGeneration";
import { useChatStudio } from "../../../state/chatStudio";
import { cn } from "../../lib/cn";
import {
  addCastMemberManually,
  assignStagedDrawing,
  chooseDerivedStyle,
  chooseStyle,
  confirmCastMembers,
  decideHardcover,
  keepStagedDrawingForStyleOnly,
  makeStagedDrawingNewCast,
  stageDrawingForStyle,
  updateCastMember,
} from "../bookActions";
import { useGuideLabel, useGuideT } from "../intl";
import { bookProductForConfig } from "../../../core/book";
import { briefOf, namedCast } from "../../../core/story/brief";
import { formatMoney } from "../../../core/i18n/format";
import { useProjectsStore } from "../../../state/projectsStore";
import {
  trimKey,
  useOfferableFormats,
} from "../../hooks/useOfferableFormats";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { wellIn } from "../motion";
import type { BookViewId } from "../../../core/guide/journey";
import type { ChatWell } from "../useChatJourney";
import type { GuideTarget } from "../../../core/guide/target";
import { decideArtworkLook } from "../../../core/guide/artworkLook";
import { uploadSourceArt } from "../../../platform/sourceArt";
import { CharacterAvatar } from "../book/CharacterAvatar";
import { PaidAction } from "./PaidAction";
import {
  BookFormatChoice,
  BookSetupSummary,
  PageLayoutChoice,
} from "../book/BookSetupChoices";

export function ComposerWell({
  well,
  project,
  onView,
  onOpenUnit,
  onOrder,
  onDefault,
}: {
  well: ChatWell | null;
  project: Project;
  onView: (view: BookViewId) => void;
  onOpenUnit: (unitId: string) => void;
  onOrder: () => void;
  onDefault: (run: (() => void) | null) => void;
}) {
  if (!well) return null;
  return (
    <motion.section
      key={wellKey(well)}
      variants={wellIn}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full rounded-2xl bg-white p-3.5 shadow-soft ring-1 ring-ink-900/8 sm:p-4"
    >
      <TaskHeader well={well} />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <WellBody well={well} project={project} onView={onView} onOpenUnit={onOpenUnit} onOrder={onOrder} onDefault={onDefault} />
      </div>
    </motion.section>
  );
}

function TaskHeader({ well }: { well: ChatWell }) {
  const t = useGuideT("chrome");
  const attention = [
    "extractionRetry",
    "storyRetry",
    "bookPrepFix",
    "pageFix",
    "printFix",
    "bookFinish",
  ].includes(well.kind);
  const ready = [
    "portraits",
    "drawBook",
    "bookUpdate",
    "account",
    "order",
  ].includes(well.kind);
  const title =
    well.kind === "styleChoice"
      ? t("taskBookLook")
      : well.kind === "formatChoice"
        ? t("taskBookFormat")
        : well.kind === "layoutChoice"
          ? t("taskPageLayout")
          : well.kind === "portraits"
            ? t("taskPortraits")
            : well.kind === "castFix" || well.kind === "drawingAssign"
              ? t("taskPeople")
              : well.kind === "drawBook"
                ? t("taskCreateBook")
                : well.kind === "order"
                  ? t("taskPrintBook")
                  : attention
                    ? t("taskNeedsAttention")
                    : t("taskNext");
  const Icon = attention
    ? AlertCircle
    : ready
      ? CheckCircle2
      : well.kind === "styleChoice" ||
          well.kind === "formatChoice" ||
          well.kind === "layoutChoice"
        ? MousePointer2
        : Sparkles;
  return (
    <header className="flex items-center justify-between gap-3 border-b border-ink-100 pb-2.5">
      <span className="font-display text-sm font-semibold text-ink-900">
        {title}
      </span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide",
          attention
            ? "bg-amber-50 text-amber-800"
            : ready
              ? "bg-emerald-50 text-emerald-700"
              : "bg-magic-50 text-magic-700",
        )}
      >
        <Icon className="size-3" aria-hidden />
        {attention
          ? t("statusNeedsAttention")
          : ready
            ? t("statusReady")
            : t("statusChooseOne")}
      </span>
    </header>
  );
}

function wellKey(well: ChatWell): string {
  switch (well.kind) {
    case "portraits":
      return `portraits:${well.castIds.join(",")}`;
    case "bookPrepFix":
      return `book-prep:${well.unitIds.join(",")}`;
    case "pageFix":
    case "printFix":
      return `${well.kind}:${well.unitId}`;
    case "skipFact":
      return `skip:${well.fact}`;
    case "redraw":
      return `redraw:${JSON.stringify(well.request.target)}`;
    case "manuscriptChoice":
      return well.kind;
    default:
      return well.kind;
  }
}

function WellBody({
  well,
  project,
  onView,
  onOpenUnit,
  onOrder,
  onDefault,
}: {
  well: ChatWell;
  project: Project;
  onView: (view: BookViewId) => void;
  onOpenUnit: (unitId: string) => void;
  onOrder: () => void;
  onDefault: (run: (() => void) | null) => void;
}) {
  const label = useGuideLabel();
  const t = useGuideT("chrome");
  const skipFact = useChatStudio((s) => s.skipFact);
  const retryStory = useChatStudio((s) => s.retryStory);
  const retryExtraction = useChatStudio((s) => s.retryExtraction);
  const chooseTargetPerson = useChatStudio((s) => s.chooseTargetPerson);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);

  switch (well.kind) {
    case "styleChoice":
      return <StyleChoiceWell project={project} onView={onView} />;
    case "drawingAssign":
      return <DrawingAssignWell project={project} people={well.people} onView={onView} />;
    case "extractionRetry":
      return (
        <div className="flex w-full flex-col items-start gap-2">
          <p className="px-1 text-sm leading-snug text-ink-600">{t("storyReadFailed")}</p>
          <div className="flex flex-wrap gap-2">
            <Quiet onClick={() => void retryExtraction()} onDefault={onDefault}>
              {t("tryReadingStory")}
            </Quiet>
            <Quiet
              subtle
              onClick={() => {
                const hasCast = (briefOf(project.config).cast?.length ?? 0) > 0;
                if (hasCast) onView("cast");
                else void addCastMemberManually().then(() => onView("cast"));
              }}
            >
              {(briefOf(project.config).cast?.length ?? 0) > 0
                ? label("reviewPeople")
                : t("addPeopleManually")}
            </Quiet>
          </div>
        </div>
      );
    case "castFix":
      return (
        <div className="flex flex-wrap gap-2">
          <Quiet onClick={() => onView("cast")} onDefault={onDefault}>
            {label("editPeople")}
          </Quiet>
          <Quiet subtle onClick={() => void confirmCastMembers()}>
            {t("peopleAreRight")}
          </Quiet>
        </div>
      );
    case "storyRetry":
      return <Quiet onClick={() => void retryStory()} onDefault={onDefault}>{label("tryStoryAgain")}</Quiet>;
    case "skipFact":
      return <Quiet onClick={() => void skipFact(well.fact)} onDefault={onDefault}>{label("skip")}</Quiet>;
    case "account":
      return <Quiet onClick={() => openAuthDialog("drawBook")} onDefault={onDefault}>{label("createAccount")}</Quiet>;
    case "portraits":
      return (
        <PortraitsAction
          project={project}
          castIds={well.castIds}
          label={label("drawPortraits", { names: well.names })}
          onDefault={onDefault}
        />
      );
    case "manuscriptChoice":
      return <ManuscriptChoice onDefault={onDefault} />;
    case "formatChoice":
      return <BookFormatChoice project={project} />;
    case "layoutChoice":
      return <PageLayoutChoice project={project} />;
    case "drawBook":
      return (
        <div className="flex w-full flex-col items-start gap-3">
          <BookLookRow project={project} onChange={() => onView("style")} />
          <PeopleRow project={project} onReview={() => onView("cast")} />
          <BookSetupSummary project={project} />
          {well.spreadOffer ? (
            <div className="flex flex-wrap gap-2">
              <Quiet onClick={() => void decideHardcover("thin")} onDefault={onDefault}>{label("spreadIt")}</Quiet>
              <Quiet onClick={() => void decideHardcover("keep")} subtle>{label("keepShort")}</Quiet>
            </div>
          ) : (
            <div className="w-full border-t border-ink-100 pt-3">
              <DrawBookAction
                project={project}
                label={label("createIllustratedBook")}
                onDefault={onDefault}
              />
            </div>
          )}
        </div>
      );
    case "bookUpdate":
      return (
        <div className="flex w-full flex-col items-start gap-2">
          <p className="px-1 text-sm leading-snug text-ink-600">
            {well.names.length > 0
              ? t("characterLookChanged", { names: well.names.join(", ") })
              : t("bookNeedsUpdate")}
          </p>
          <BookUpdateAction
            project={project}
            label={t("updateThroughoutBook")}
            onDefault={onDefault}
          />
        </div>
      );
    case "bookFinish":
      return (
        <div className="flex w-full flex-col items-start gap-2">
          <p className="px-1 text-sm leading-snug text-ink-600">
            {well.error
              ? t("bookRefused", { error: well.error })
              : t("bookMissing", { count: well.missing })}
          </p>
          <BookUpdateAction project={project} label={t("finishBook")} onDefault={onDefault} />
        </div>
      );
    case "pageFix":
      return <PageRetryAction unitId={well.unitId} label={label("tryAgain")} onDefault={onDefault} />;
    case "bookPrepFix":
      return (
        <div className="flex w-full flex-col items-start gap-2">
          <p className="px-1 text-sm leading-snug text-ink-600">
            {t("preparationFailed", {
              names: well.names.join(", ") || t("bookPreparation"),
            })}
          </p>
          <BookPrepRetryAction
            unitIds={well.unitIds}
            label={label("tryAgain")}
            onDefault={onDefault}
          />
        </div>
      );
    case "printFix":
      return (
        <Quiet onClick={() => onOpenUnit(well.unitId)} onDefault={onDefault}>
          {well.page ? `${label("redrawPage")}` : label("tryAgain")}
        </Quiet>
      );
    case "order":
      return <OrderAction onOrder={onOrder} onDefault={onDefault} />;
    case "whichName":
      return (
        <div className="flex flex-wrap gap-2">
          {well.pending.people.map((person) => (
            <Quiet key={person.id} onClick={() => void chooseTargetPerson(person)}>
              <CharacterAvatar
                project={project}
                characterId={person.id}
                name={person.name}
                className="size-7 text-[10px]"
              />
              {person.name}
            </Quiet>
          ))}
        </div>
      );
    case "redraw":
      return <RedrawAction request={well.request} onDefault={onDefault} />;
  }
}

function StyleChoiceWell({
  project,
  onView,
}: {
  project: Project;
  onView: (view: BookViewId) => void;
}) {
  const t = useGuideT("chrome");
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const styles = useMemo(
    () => resolveArtStyles(artStyles).slice(0, 4),
    [artStyles],
  );
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const pickDrawing = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { ref } = await uploadSourceArt(file);
      await stageDrawingForStyle(ref);
      const current = useProjectsStore.getState().current();
      if (!current) throw new Error("Book unavailable");
      const decision = await decideArtworkLook(current);
      if (decision.status !== "resolved") throw new Error(decision.status === "failed" ? decision.message : "Choose one art style.");
      await chooseDerivedStyle(decision.style);
      useChatStudio.getState().say(
        [{ key: "lookReady", priority: "result" }],
        {
          receipt: {
            parts: [],
            thumb: { blobId: ref.blobId, unitId: "style", view: "style" },
          },
        },
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <section className="flex w-full flex-col gap-2.5">
      <p className="px-1 text-sm leading-snug text-ink-600">{t("chooseBookLook")}</p>
      <div className="grid grid-cols-2 gap-2.5 p-0.5">
        {styles.map((style) => {
          const image = style.examples[0]?.imageUrl;
          return (
            <button
              key={style.id}
              type="button"
              disabled={busy}
              onClick={() => void chooseStyle(style.id)}
              className="group min-w-0 text-left focus-visible:outline-none disabled:opacity-50"
            >
              <span
                className={cn(
                  "block aspect-4/5 overflow-hidden rounded-xl bg-linear-to-br shadow-soft ring-1 ring-ink-900/10 transition group-hover:-translate-y-0.5 group-hover:shadow-lifted group-hover:ring-ink-400 group-focus-visible:ring-2 group-focus-visible:ring-ink-500",
                  !image && style.id === "watercolor" && "from-sky-200 via-rose-100 to-amber-100",
                  !image && style.id === "papercut" && "from-emerald-200 via-teal-100 to-cyan-200",
                  !image && style.id === "crayon" && "from-orange-200 via-yellow-100 to-lime-200",
                  !image && !["watercolor", "papercut", "crayon"].includes(style.id) && "from-violet-200 via-fuchsia-100 to-pink-200",
                )}
              >
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="size-full object-cover" />
                )}
              </span>
              <span className="mt-1.5 block truncate px-0.5 text-xs font-medium text-ink-800">{style.label}</span>
            </button>
          );
        })}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => void pickDrawing(event.target.files?.[0])}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="group min-w-0 text-left focus-visible:outline-none disabled:opacity-60"
        >
          <span className="flex aspect-4/5 flex-col items-center justify-center gap-2 rounded-xl bg-ink-50 text-ink-500 shadow-soft ring-1 ring-ink-200 transition group-hover:-translate-y-0.5 group-hover:bg-white group-hover:shadow-lifted group-hover:ring-ink-400 group-focus-visible:ring-2 group-focus-visible:ring-ink-500">
            {busy ? <Loader2 className="size-7 animate-spin" /> : <ImagePlus className="size-7" />}
            <span className="max-w-28 text-center text-xs font-medium leading-snug">
              {t("useCharacterDrawing")}
            </span>
          </span>
        </button>
      </div>
      <div className="flex items-center gap-3 px-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => onView("style")}
          className="text-xs font-medium text-ink-600 underline decoration-ink-300 underline-offset-2 hover:text-ink-900 disabled:opacity-50"
        >
          {t("seeAllStyles")}
        </button>
        {failed && <span className="text-xs text-red-600">{t("styleDrawingFailed")}</span>}
      </div>
    </section>
  );
}

function DrawingAssignWell({
  project,
  people,
  onView,
}: {
  project: Project;
  people: { id: string; name: string }[];
  onView: (view: BookViewId) => void;
}) {
  const t = useGuideT("chrome");
  return (
    <div className="flex w-full flex-col items-start gap-2">
      <p className="px-1 text-sm leading-snug text-ink-600">{t("whoseDrawing")}</p>
      <div className="flex flex-wrap gap-2">
        {people.map((person) => (
          <Quiet key={person.id} onClick={() => void assignStagedDrawing(person.id)}>
            <CharacterAvatar
              project={project}
              characterId={person.id}
              name={person.name}
              className="size-7 text-[10px]"
            />
            {person.name}
          </Quiet>
        ))}
        <Quiet
          onClick={() => {
            void makeStagedDrawingNewCast().then(() => onView("cast"));
          }}
        >
          {t("someoneElse")}
        </Quiet>
        <Quiet subtle onClick={() => void keepStagedDrawingForStyleOnly()}>
          {t("styleOnly")}
        </Quiet>
      </div>
    </div>
  );
}

/** A secondary choice: white, ink ring. Coral is kept for the paid action. */
function Quiet({
  onClick,
  children,
  subtle,
  onDefault,
}: {
  onClick: () => void;
  children: React.ReactNode;
  subtle?: boolean;
  onDefault?: (run: (() => void) | null) => void;
}) {
  useDefault(onDefault, onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2",
        subtle
          ? "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
          : "bg-white text-ink-900 ring-1 ring-ink-200 shadow-soft hover:ring-ink-400",
      )}
    >
      {children}
    </button>
  );
}

function useDefault(onDefault: ((run: (() => void) | null) => void) | undefined, run: () => void) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!onDefault) return;
    onDefault(() => latest.current());
    return () => onDefault(null);
  }, [onDefault]);
}

function PortraitsAction({
  project,
  castIds,
  label,
  onDefault,
}: {
  project: Project;
  castIds: string[];
  label: string;
  onDefault: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("chrome");
  const units = useMemo(() => portraitUnits(castIds), [castIds]);
  const cast = namedCast(briefOf(project.config)).filter((member) =>
    castIds.includes(member.id),
  );
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="rounded-xl border border-ink-100 bg-white/80 p-3 shadow-xs">
        <p className="mb-2.5 text-[10px] font-semibold tracking-[0.12em] text-ink-400 uppercase">
          {t("ageForPortrait")}
        </p>
        <div className="flex flex-col gap-2">
          {cast.map((member) => (
            <PortraitAgeRow key={member.id} project={project} member={member} />
          ))}
        </div>
      </div>
      <PaidAction
        purpose="portraits"
        units={units}
        label={label}
        start={startPortraits}
        onDefault={onDefault}
      />
    </div>
  );
}

function PortraitAgeRow({
  project,
  member,
}: {
  project: Project;
  member: ReturnType<typeof namedCast>[number];
}) {
  const t = useGuideT("chrome");
  const months =
    member.ageMonths !== undefined &&
    member.ageMonths < 24 &&
    member.age === undefined;
  const value = months
    ? member.ageMonths
    : member.age ?? member.visualAge?.years;
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));

  useEffect(() => {
    setDraft(value === undefined ? "" : String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > (months ? 36 : 120)) {
      setDraft(value === undefined ? "" : String(value));
      return;
    }
    void updateCastMember(
      member.id,
      months
        ? { ageMonths: parsed, age: undefined, visualAge: undefined }
        : { age: parsed, ageMonths: undefined, visualAge: undefined },
    );
  };

  return (
    <div className="flex items-center gap-2.5">
      <CharacterAvatar
        project={project}
        characterId={member.id}
        name={member.name}
        className="size-9 text-xs"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">
        {member.name}
      </span>
      {member.visualAge && member.age === undefined && member.ageMonths === undefined && (
        <span className="rounded-full bg-magic-50 px-2 py-1 text-[10px] font-medium text-magic-700">
          {t("estimated")}
        </span>
      )}
      <label className="flex items-center rounded-lg border border-ink-200 bg-white px-2 py-1 shadow-xs focus-within:border-ink-400 focus-within:ring-2 focus-within:ring-ink-200">
        <span className="sr-only">{t("ageFor", { name: member.name })}</span>
        <input
          type="number"
          min={0}
          max={months ? 36 : 120}
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-8 bg-transparent text-right text-sm font-semibold tabular-nums text-ink-900 outline-none"
        />
        <span className="ml-1 text-[10px] text-ink-400">
          {months ? t("monthsShort") : t("yearsShort")}
        </span>
      </label>
    </div>
  );
}

function DrawBookAction({
  project,
  label,
  onDefault,
}: {
  project: Project;
  label: string;
  onDefault: (run: (() => void) | null) => void;
}) {
  const units = useMemo(() => drawBookUnits(project), [project]);
  const key = units.map((u) => u.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => units, [key]);
  return (
    <PaidAction
      purpose="book"
      units={stable}
      label={label}
      start={startDrawBook}
      onDefault={onDefault}
    />
  );
}

function BookUpdateAction({
  project,
  label,
  onDefault,
}: {
  project: Project;
  label: string;
  onDefault: (run: (() => void) | null) => void;
}) {
  const units = useMemo(() => drawBookUnits(project), [project]);
  const key = units.map((unit) => `${unit.id}:${unit.action}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => units, [key]);
  return (
    <PaidAction
      purpose="book"
      units={stable}
      extraKey="book-update"
      label={label}
      start={startBookUpdate}
      onDefault={onDefault}
    />
  );
}

function ManuscriptChoice({ onDefault }: { onDefault: (run: (() => void) | null) => void }) {
  const label = useGuideLabel();
  const keep = useChatStudio((s) => s.keepManuscript);
  const asIdea = useChatStudio((s) => s.useManuscriptAsIdea);
  const pending = useChatStudio((s) => s.pendingManuscript);
  return (
    <div className="flex flex-wrap gap-2">
      <Quiet onClick={() => void keep(pending ?? "")} onDefault={onDefault}>
        {label("useMyStory")}
      </Quiet>
      <Quiet onClick={() => void asIdea()} subtle>
        {label("useAsIdea")}
      </Quiet>
    </div>
  );
}

function PeopleRow({ project, onReview }: { project: Project; onReview: () => void }) {
  const t = useGuideT("chrome");
  const label = useGuideLabel();
  const cast = namedCast(briefOf(project.config)).filter((member) => member.name.trim());
  if (cast.length === 0) return null;
  const places = (project.anchors ?? []).filter((anchor) => anchor.include && anchor.type === "place");
  return (
    <div className="flex w-full flex-col gap-2.5 rounded-xl border border-ink-100 bg-white/80 px-3 py-2.5 text-sm shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{t("people")}</span>
        <button
          type="button"
          onClick={onReview}
          className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-ink-600 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
        >
          {label("reviewPeople")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {cast.map((member) => (
          <span key={member.id} className="flex items-center gap-1.5 pr-1 text-xs font-medium text-ink-800">
            <CharacterAvatar
              project={project}
              characterId={member.id}
              name={member.name}
              className="size-9 text-xs"
            />
            <span className="max-w-24 truncate">{member.name}</span>
          </span>
        ))}
      </div>
      {places.length > 0 && (
        <span className="truncate text-ink-500">
          {t("places")}: <span className="font-medium text-ink-900">{places.map((place) => place.name).join(", ")}</span>
        </span>
      )}
    </div>
  );
}

function BookLookRow({ project, onChange }: { project: Project; onChange: () => void }) {
  const t = useGuideT("chrome");
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const styles = useMemo(() => resolveArtStyles(artStyles), [artStyles]);
  const current = styles.find((style) => style.id === project.config.artStyle.presetId);
  const referenceUrl = useBlobUrl(project.config.artStyle.referenceArt?.[0]?.blobId);
  const imageUrl = referenceUrl ?? current?.examples[0]?.imageUrl;
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white/80 p-2 shadow-xs">
      <span className="relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#eee8de] p-1.5">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={t("look")}
            className={cn(
              "size-full rounded-sm bg-white",
              referenceUrl ? "object-contain" : "object-cover",
            )}
          />
        ) : (
          <ImagePlus className="size-5 text-ink-400" aria-hidden />
        )}
      </span>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-ink-600 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
      >
        {t("changeLook")}
      </button>
    </div>
  );
}

function PageRetryAction({
  unitId,
  label,
  onDefault,
}: {
  unitId: string;
  label: string;
  onDefault: (run: (() => void) | null) => void;
}) {
  const units = useMemo(
    () => [{ id: unitId, action: illustrationActionFor(unitId), kind: "fresh" as const }],
    [unitId],
  );
  return <PaidAction purpose="redraw" units={units} extraKey="retry" label={label} start={startPageRetry} onDefault={onDefault} />;
}

function BookPrepRetryAction({
  unitIds,
  label,
  onDefault,
}: {
  unitIds: string[];
  label: string;
  onDefault: (run: (() => void) | null) => void;
}) {
  const key = unitIds.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const units = useMemo(() => anchorRetryUnits(unitIds), [key]);
  return (
    <PaidAction
      purpose="book"
      units={units}
      extraKey="preparation-retry"
      label={label}
      start={startAnchorRetry}
      onDefault={onDefault}
    />
  );
}

function RedrawAction({
  request,
  onDefault,
}: {
  request: { target: GuideTarget; instruction: string };
  onDefault: (run: (() => void) | null) => void;
}) {
  const label = useGuideLabel();
  const { target, instruction } = request;
  const units = useMemo(
    () =>
      target.kind === "person"
        ? redrawUnits(target.castId, "portrait")
        : redrawUnits(target.unitId, illustrationActionFor(target.unitId)),
    [target],
  );
  const text =
    target.kind === "person" ? label("redrawTarget", { names: [target.name] }) : label("redrawPage");
  return (
    <PaidAction
      purpose="redraw"
      units={units}
      extraKey={instruction.slice(0, 40)}
      label={text}
      start={(quote) => startRedraw(quote, instruction)}
      onDefault={onDefault}
    />
  );
}

function OrderAction({ onOrder, onDefault }: { onOrder: () => void; onDefault: (run: (() => void) | null) => void }) {
  const label = useGuideLabel();
  const t = useGuideT("chrome");
  const price = useOrderPrice();
  useDefault(onDefault, onOrder);
  return (
    <button
      type="button"
      onClick={onOrder}
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-500 px-5 text-[15px] font-semibold text-white shadow-soft transition hover:bg-brand-600 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
    >
      {label("orderBook")}
      {price && (
        <span className="font-normal text-white/85">
          · {price.exact ? price.text : t("orderFrom", { price: price.text })}
        </span>
      )}
      <ArrowRight className="size-4" />
    </button>
  );
}

/**
 * "from" the cheapest format printed at this book's size, until checkout knows
 * the binding. When only one format prints at this size, its price is exact.
 */
function useOrderPrice(): { text: string; exact: boolean } | null {
  const project = useProjectsStore((s) => s.current());
  const { sizes, currency } = useOfferableFormats();
  if (!project) return null;
  const size = sizes.find((option) => option.key === trimKey(bookProductForConfig(project.config)));
  if (!size || size.cheapest == null) return null;
  return {
    text: formatMoney(typeof navigator === "undefined" ? "en" : navigator.language, size.cheapest, currency),
    exact: size.formats.length === 1,
  };
}


