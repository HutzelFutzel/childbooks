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
  MousePointer2,
  Search,
  Sparkles,
} from "lucide-react";
import { resolveArtStyles, type ArtStyleDefinition } from "../../../core/config/artStyles";
import { enabledAudienceProfiles, resolveAudienceProfile } from "../../../core/config/audience";
import type { AudienceProfile } from "../../../core/config/audienceCatalog";
import { ART_STYLE_PRESETS } from "../../../core/config/options";
import type { GenerationQuote, GenerationQuoteUnit } from "../../../core/billing/generationQuote";
import type { GuideLineCandidate } from "../../../core/guide/speech";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAuthStore } from "../../../state/authStore";
import {
  bookDrawDuration,
  drawBookUnits,
  anchorRetryUnits,
  illustrationActionFor,
  pageRetryUnits,
  portraitUnits,
  redrawUnits,
  startDrawBook,
  startBookUpdate,
  startAnchorRetry,
  startPageRetry,
  startPortraits,
  startRedraw,
} from "../../../state/chatGeneration";
import { quoteKey, useChatStudio, type RedrawRequest } from "../../../state/chatStudio";
import { redrawInstructions, redrawNames, redrawQuoteParts } from "../../../state/typedPictures";
import { chooseAndStartPortraits, styleChoiceStartUnits } from "../../../state/portraitAutoStart";
import { cn } from "../../lib/cn";
import {
  addCastMemberManually,
  assignStagedDrawing,
  chooseStyle,
  confirmCastMembers,
  decideHardcover,
  decideTwinsLook,
  keepOldLook,
  keepStagedDrawingForStyleOnly,
  makeStagedDrawingNewCast,
} from "../bookActions";
import { useGuideLabel, useGuideList, useGuideT } from "../intl";
import { bookProductForConfig } from "../../../core/book";
import { briefOf, namedCast, PICTURE_NOTES_MAX } from "../../../core/story/brief";
import { isPerson } from "../../../core/story/castKinds";
import { formatMoney } from "../../../core/i18n/format";
import { useProjectsStore } from "../../../state/projectsStore";
import {
  trimKey,
  useOfferableFormats,
} from "../../hooks/useOfferableFormats";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { useStylePreviewUrls, useStyleStrip } from "../../hooks/useStylePreviews";
import { wellIn } from "../motion";
import { lookDecided } from "../../../core/guide/portrait";
import type { BookViewId } from "../../../core/guide/journey";
import { cardId } from "../../../core/guide/cardDeck";
import type { ChatWell } from "../useChatJourney";
import type { GuideTarget } from "../../../core/guide/target";
import type { PreflightCode } from "../../../core/print/preflight";
import { insetPageText } from "../../design/designInit";
import { useStudio } from "../../studio/StudioContext";
import { CharacterAvatar } from "../book/CharacterAvatar";
import { CastAgesWell } from "./CastAgesWell";
import { PaidAction } from "./PaidAction";
import { AgentWellBody, agentWellTitle, isAgentWellItem } from "./AgentWells";
import { StoryBriefWell } from "./StoryBriefWell";
import { CastLooksWell } from "./CastLooksWell";
import { CastSwitcher } from "./CastSwitcher";
import { CoverWordsWell } from "./CoverWordsWell";
import { useHandOverStory } from "../useHandOverStory";
import { PortraitAgeRow } from "./PortraitAgeRow";
import {
  BookFormatChoice,
  BookSetupSummary,
  PageLayoutChoice,
} from "../book/BookSetupChoices";

export function ComposerWell({
  well,
  cardKey,
  person = true,
  project,
  onView,
  onOpenUnit,
  onOrder,
  onDefault,
}: {
  well: ChatWell | null;
  /** Who the card is (`cardId`): the same card keeps its place whatever it shows. */
  cardKey?: string | null;
  /** This card carries the face the reader selected. */
  person?: boolean;
  project: Project;
  onView: (view: BookViewId) => void;
  onOpenUnit: (unitId: string) => void;
  onOrder: () => void;
  onDefault: (run: (() => void) | null) => void;
}) {
  const chip = useChatStudio((s) => s.chip);
  const selected = person ? selectedPerson(project, chip) : null;
  const shown = well?.kind === "castLooks" && selected
    ? { ...well, castId: selected.id, name: selected.name.trim() }
    : well;
  const id = shown ? cardKey ?? cardId(shown) : selected ? `person:${selected.id}` : null;
  const initial = useArrival(project.id, id);
  if (!shown && !selected) return null;
  const closePerson = () => useChatStudio.getState().setChip(null);
  // The face they clicked. Beside another step it only edits; it does not replace that step.
  const personEditor = selected && shown?.kind !== "castLooks" ? (
    <CastLooksWell
      key={selected.id}
      project={project}
      castId={selected.id}
      name={selected.name.trim()}
      quiet={Boolean(shown) || personLookDecided(project, selected.id)}
      showTitle
      onClose={closePerson}
      onDefault={onDefault}
    />
  ) : null;
  if (!shown) {
    return (
      <motion.section
        key={`person:${selected!.id}`}
        variants={wellIn}
        initial={initial}
        animate="show"
        exit="exit"
        className="w-full rounded-2xl bg-white p-3.5 shadow-soft ring-1 ring-ink-900/8 sm:p-4"
      >
        {personEditor}
      </motion.section>
    );
  }
  // Ordering is the way out of the conversation, not a question in it: one quiet line with one button,
  // no card, so it never stands between the reader and the field. The book pane keeps its own Order button.
  if (shown.kind === "order" && !personEditor) {
    return (
      <motion.div
        key={id ?? undefined}
        variants={wellIn}
        initial={initial}
        animate="show"
        exit="exit"
        className="flex w-full items-center justify-start px-1"
      >
        <OrderAction onOrder={onOrder} onDefault={onDefault} quiet />
      </motion.div>
    );
  }
  return (
    <motion.section
      key={id ?? undefined}
      variants={wellIn}
      initial={initial}
      animate="show"
      exit="exit"
      className="w-full rounded-2xl bg-white p-3.5 shadow-soft ring-1 ring-ink-900/8 sm:p-4"
    >
      <TaskHeader well={shown} />
      <div className="mt-3 flex flex-col gap-3">
        {personEditor}
        {shown.kind === "storyBrief" ? (
          <StoryBriefWell project={project} focus={shown.focus} onDefault={onDefault} />
        ) : shown.kind === "castLooks" ? (
          <>
            <CastSwitcher
              project={project}
              currentId={shown.castId}
              offeredId={well?.kind === "castLooks" ? well.castId : shown.castId}
            />
            <CastLooksWell
              key={shown.castId}
              project={project}
              castId={shown.castId}
              name={shown.name}
              quiet={personLookDecided(project, shown.castId)}
              onClose={selected ? closePerson : undefined}
              onDefault={onDefault}
            />
          </>
        ) : shown.kind === "coverWords" ? (
          <CoverWordsWell project={project} onDefault={onDefault} />
        ) : (
          <WellBody
            well={shown}
            project={project}
            selected={selected}
            onView={onView}
            onOpenUnit={onOpenUnit}
            onOrder={onOrder}
            onDefault={onDefault}
          />
        )}
      </div>
    </motion.section>
  );
}

/**
 * Cards already seen on this book don't slide in again when the layout around
 * them changes: the same card is still there, not a new one.
 */
const seenCards = new Set<string>();
function useArrival(projectId: string, id: string | null): "hidden" | false {
  const key = id ? `${projectId}:${id}` : null;
  const seen = key !== null && seenCards.has(key);
  useEffect(() => {
    if (key) seenCards.add(key);
  }, [key]);
  return seen ? false : "hidden";
}

function TaskHeader({ well }: { well: ChatWell }) {
  const t = useGuideT("chrome");
  const tAgent = useGuideT("agent");
  const tBrief = useGuideT("brief");
  const tLooks = useGuideT("looks");
  const agentTitle = isAgentWellItem(well)
    ? agentWellTitle(well, tAgent)
    : well.kind === "storyBrief"
      ? tBrief("title")
      : well.kind === "castLooks"
        ? tLooks("title", { name: well.name })
        : "";
  const optional = well.kind === "storyBrief" || well.kind === "coverWords" || well.kind === "pictureNotes";
  const attention = [
    "agentBlocked",
    "agentConfirm",
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
  const title = agentTitle
    ? agentTitle
    : well.kind === "styleChoice"
      ? t("taskBookLook")
      : well.kind === "formatChoice"
        ? t("taskBookFormat")
        : well.kind === "layoutChoice"
          ? t("taskPageLayout")
          : well.kind === "coverWords"
            ? t("taskCoverWords")
          : well.kind === "storyDone"
            ? t("taskYourStory")
          : well.kind === "pictureNotes"
            ? t("taskPictureNotes")
          : well.kind === "hardcoverChoice"
            ? t("taskHardcover")
          : well.kind === "lookAlike"
            ? t("taskLookAlike")
          : well.kind === "audienceConfirm"
            ? t("taskAudience")
          : well.kind === "castAges"
            ? t("taskAges")
          : well.kind === "portraits"
            ? t(well.stale ? "taskRedrawPortraits" : "taskPortraits")
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
          well.kind === "layoutChoice" ||
          well.kind === "hardcoverChoice" ||
          well.kind === "lookAlike" ||
          well.kind === "audienceConfirm" ||
          well.kind === "castAges"
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
            : well.kind === "coverWords" || well.kind === "pictureNotes" || (well.kind === "audienceConfirm" && well.optional)
              ? t("statusOptional")
              : well.kind === "storyDone"
                ? t("statusWhenReady")
              : optional
                ? tBrief("status")
                : t("statusChooseOne")}
      </span>
    </header>
  );
}

function selectedPerson(project: Project, chip: GuideTarget | null) {
  if (chip?.kind !== "person") return null;
  return namedCast(briefOf(project.config)).find((member) => member.id === chip.castId) ?? null;
}

function personLookDecided(project: Project, castId: string): boolean {
  const member = namedCast(briefOf(project.config)).find((item) => item.id === castId);
  return Boolean(member && lookDecided(project, member));
}

function WellBody({
  well,
  project,
  selected,
  onView,
  onOpenUnit,
  onOrder,
  onDefault,
}: {
  well: ChatWell;
  project: Project;
  selected: ReturnType<typeof selectedPerson>;
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
  const tap = useChatStudio((s) => s.tap);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const choose = (text: string, apply: () => Promise<unknown>) => void tap(text, apply, { undoable: true });

  switch (well.kind) {
    case "storyDone":
      return <StoryDoneWell onDefault={onDefault} />;
    case "pictureNotes":
      return <PictureNotesWell onDefault={onDefault} />;
    case "styleChoice":
      return <StyleChoiceWell project={project} />;
    case "drawingAssign":
      return <DrawingAssignWell project={project} people={well.people} onView={onView} />;
    case "extractionRetry":
      return (
        <div className="flex w-full flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            <Quiet onClick={() => void tap(t("tryReadingStory"), retryExtraction)} onDefault={onDefault}>
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
          <Quiet
            subtle
            onClick={() =>
              void tap(t("peopleAreRight"), confirmCastMembers, {
                undoable: true,
                reply: [{ key: "castConfirmed", priority: "result" }],
              })
            }
          >
            {t("peopleAreRight")}
          </Quiet>
        </div>
      );
    case "storyRetry":
      return (
        <Quiet onClick={() => void tap(label("tryStoryAgain"), retryStory)} onDefault={onDefault}>
          {label("tryStoryAgain")}
        </Quiet>
      );
    case "skipFact":
      return (
        <Quiet onClick={() => void tap(label("skip"), () => skipFact(well.fact))} onDefault={onDefault}>
          {label("skip")}
        </Quiet>
      );
    case "account":
      return <Quiet onClick={() => openAuthDialog("drawBook")} onDefault={onDefault}>{label("createAccount")}</Quiet>;
    case "portraits":
      return (
        <div className="flex w-full flex-col gap-3">
          <PortraitsAction
            project={project}
            castIds={well.castIds}
            label={label(well.stale ? "redrawTarget" : "drawPortraits", { names: well.names })}
            onDefault={onDefault}
          />
          {well.canKeepLook && (
            <Quiet
              subtle
              onClick={() =>
                void tap(t("keepOldLook"), keepOldLook, {
                  undoable: true,
                  reply: [{ key: "oldLookKept", priority: "result", vars: { names: well.names } }],
                })
              }
            >
              {t("keepOldLook")}
            </Quiet>
          )}
        </div>
      );
    case "manuscriptChoice":
      return <ManuscriptChoice onDefault={onDefault} />;
    case "formatChoice":
      return <BookFormatChoice project={project} showPrompt={false} onChoose={choose} />;
    case "layoutChoice":
      return <PageLayoutChoice project={project} showPrompt={false} onChoose={choose} />;
    case "audienceConfirm":
      return (
        <AudienceConfirm
          bandId={well.bandId}
          optional={well.optional}
          differ={well.differ}
          onDefault={onDefault}
        />
      );
    case "castAges":
      return <CastAgesWell people={well.people} />;
    case "hardcoverChoice":
      return <HardcoverChoice pages={well.pages} min={well.min} onChoose={choose} onDefault={onDefault} />;
    case "lookAlike":
      return (
        <div className="flex flex-wrap gap-2">
          {(["identical", "different"] as const).map((choice) => {
            const text = label(choice === "identical" ? "lookAlikeYes" : "lookAlikeNo");
            return (
              <Quiet
                key={choice}
                subtle={choice === "different"}
                onClick={() =>
                  void tap(text, () => decideTwinsLook(well.ids, choice), {
                    undoable: true,
                    reply: [{ key: "lookNoted", priority: "result", vars: { names: well.names } }],
                  })
                }
              >
                {text}
              </Quiet>
            );
          })}
        </div>
      );
    case "drawBook": {
      return (
        <div className="flex w-full flex-col items-start gap-3">
          <BookLookRow project={project} onChange={() => onView("style")} />
          <PeopleRow
            project={project}
            selectedId={selected?.id ?? null}
            onSelect={(member) => {
              const store = useChatStudio.getState();
              const name = member.name.trim();
              store.setChip(selected?.id === member.id ? null : { kind: "person", castId: member.id, name });
              store.setView("cast");
            }}
            onReview={() => onView("cast")}
          />
          <BookSetupSummary project={project} />
          <div className="w-full border-t border-ink-100 pt-3">
            <DrawBookAction
              project={project}
              label={label("createIllustratedBook")}
              onDefault={onDefault}
            />
          </div>
        </div>
      );
    }
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
          {/* Always a way forward. A run the server gave up on (`settled`) still
              leaves pictures undrawn, and the reader must be able to ask again;
              only what comes out is ever charged. */}
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
        <PrintFixAction
          unitId={well.unitId}
          page={well.page}
          code={well.code}
          onOpenUnit={onOpenUnit}
          onDefault={onDefault}
        />
      );
    case "order":
      return <OrderAction onOrder={onOrder} onDefault={onDefault} />;
    case "whichName":
      return (
        <div className="flex flex-wrap gap-2">
          {well.pending.people.map((person) => (
            <Quiet key={person.id} onClick={() => void tap(person.name, () => chooseTargetPerson(person))}>
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
    case "agentConfirm":
    case "agentAsk":
    case "agentBlocked":
    case "sparksOffer":
    case "undoConflict":
      return <AgentWellBody well={well} onView={onView} onDefault={onDefault} />;
  }
}

const STYLE_SWATCH = new Map(ART_STYLE_PRESETS.map((preset) => [preset.id, preset.swatch]));

function StyleChoiceWell({ project }: { project: Project }) {
  const t = useGuideT("chrome");
  const list = useGuideList();
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const styles = useMemo(() => resolveArtStyles(artStyles), [artStyles]);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return styles;
    return styles.filter((style) =>
      `${style.label} ${style.description}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, styles]);
  // The style tap starts the portraits at this quote, so it is shown before the tap.
  const mayUseGenerationReference = styles.some((style) => style.generationReference);
  const start = useMemo(
    () => styleChoiceStartUnits(project, { mayUseGenerationReference }),
    [mayUseGenerationReference, project],
  );
  const units = useStableUnits(start.units);
  const key = units.length > 0 ? quoteKey("portraits", units) : null;
  const ensureQuote = useChatStudio((s) => s.ensureQuote);
  const slot = useChatStudio((s) => (key ? s.quotes[key] : undefined));
  useEffect(() => {
    if (key) void ensureQuote(key, "portraits", units);
    // `units` is folded into `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ensureQuote]);
  const quote = slot?.status === "ready" ? slot.quote : null;
  const pick = (id: string, name: string) =>
    void useChatStudio.getState().tap(
      name,
      () => chooseAndStartPortraits(() => chooseStyle(id), quote ? quote.maximumSparks : null),
      {
        undoable: true,
        reply: [{ key: "styleChanged", priority: "result", vars: { what: name } }],
      },
    );

  return (
    <section className="flex w-full min-w-0 basis-full flex-col gap-3">
      {start.names.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-600">
          <Sparkles className="size-3 text-ink-400" aria-hidden />
          <span>{t("styleStartsPortraits", { names: list(start.names) })}</span>
          <span className="font-medium text-ink-800">
            {quote ? t("sparks", { sparks: quote.maximumSparks }) : t("estimating")}
          </span>
        </p>
      )}
      {styles.length > 8 && (
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
          <span className="sr-only">{t("searchStyles")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchStyles")}
            className="h-10 w-full rounded-xl bg-ink-50 pr-3 pl-10 text-sm text-ink-900 ring-1 ring-ink-200 outline-none placeholder:text-ink-400 focus:bg-white focus:ring-2 focus:ring-ink-400"
          />
        </label>
      )}
      <div className="max-h-[min(34rem,62vh)] overflow-y-auto overscroll-contain pr-0.5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((style) => {
            const swatch = STYLE_SWATCH.get(style.id) ?? "from-violet-200 via-fuchsia-100 to-pink-200";
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => pick(style.id, style.label)}
                className="group min-w-0 text-left focus-visible:outline-none"
              >
                <StylePlate style={style} swatch={swatch} />
                <span className="mt-1.5 block truncate px-0.5 font-display text-[13px] font-medium text-ink-900">
                  {style.label}
                </span>
                <span className="line-clamp-2 px-0.5 text-[11px] leading-snug text-ink-500">
                  {style.description}
                </span>
              </button>
            );
          })}
        </div>
        {shown.length === 0 && (
          <p className="px-0.5 py-6 text-center text-sm text-ink-500">{t("noStyleMatches")}</p>
        )}
      </div>
    </section>
  );
}

/** A look's plate: the admin's picture, else the reader's own first cover in that look, else a swatch. */
function StylePlate({ style, swatch }: { style: ArtStyleDefinition; swatch: string }) {
  const strip = useStyleStrip({ key: style.id, adminExamples: style.examples, limit: 1 });
  const [image] = useStylePreviewUrls(strip);
  return (
    <span
      className={cn(
        "block aspect-4/5 overflow-hidden rounded-xl bg-linear-to-br shadow-soft ring-1 ring-ink-900/10 transition group-hover:-translate-y-0.5 group-hover:shadow-lifted group-hover:ring-ink-400 group-focus-visible:ring-2 group-focus-visible:ring-ink-500",
        !image && swatch,
      )}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-full object-cover" />
      )}
    </span>
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
  const tap = useChatStudio((s) => s.tap);
  const choose = (text: string, apply: () => Promise<unknown>) => void tap(text, apply, { undoable: true });
  return (
    <div className="flex w-full flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {people.map((person) => (
          <Quiet key={person.id} onClick={() => choose(person.name, () => assignStagedDrawing(person.id))}>
            <CharacterAvatar
              project={project}
              characterId={person.id}
              name={person.name}
              className="size-7 text-[10px]"
            />
            {person.name}
          </Quiet>
        ))}
        <Quiet onClick={() => choose(t("someoneElse"), () => makeStagedDrawingNewCast().then(() => onView("cast")))}>
          {t("someoneElse")}
        </Quiet>
        <Quiet subtle onClick={() => choose(t("styleOnly"), keepStagedDrawingForStyleOnly)}>
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

/** Own words: the one button while the parent writes, and what happens after it. */
function StoryDoneWell({ onDefault }: { onDefault: (run: (() => void) | null) => void }) {
  const label = useGuideLabel();
  const t = useGuideT("chrome");
  const handOver = useHandOverStory();
  return (
    <div className="flex w-full flex-col items-start gap-2">
      <Quiet onClick={handOver} onDefault={onDefault}>
        {label("storyIsReady")}
        <ArrowRight className="size-4" aria-hidden />
      </Quiet>
      <span className="text-xs leading-snug text-ink-500">{t("storyDoneHint")}</span>
    </div>
  );
}

/** Own words, once: a note for the pictures in the parent's words, or Skip (the default). */
function PictureNotesWell({ onDefault }: { onDefault: (run: (() => void) | null) => void }) {
  const label = useGuideLabel();
  const t = useGuideT("chrome");
  const tap = useChatStudio((s) => s.tap);
  const savePictureNotes = useChatStudio((s) => s.savePictureNotes);
  const [text, setText] = useState("");
  const skip = () => void tap(label("skip"), () => savePictureNotes(""));
  useDefault(onDefault, skip);
  const keep = () => {
    const notes = text.trim();
    if (!notes) return;
    void tap(notes, () => savePictureNotes(notes), {
      undoable: true,
      reply: [{ key: "pictureNotesSaved", priority: "result" }],
    });
  };
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        keep();
      }}
    >
      <textarea
        value={text}
        rows={2}
        maxLength={PICTURE_NOTES_MAX}
        aria-label={t("taskPictureNotes")}
        placeholder={t("pictureNotesPlaceholder")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            keep();
          }
        }}
        className="w-full resize-none rounded-xl bg-white px-3 py-2 text-sm leading-snug text-ink-900 ring-1 ring-ink-200 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-ink-400"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!text.trim()}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2 disabled:opacity-40"
        >
          {label("keepPictureNotes")}
        </button>
        <Quiet subtle onClick={skip}>
          {label("skip")}
        </Quiet>
      </div>
    </form>
  );
}

/** The two answers to "spread it or keep it short?", and nothing else. */
function HardcoverChoice({
  pages,
  min,
  onChoose,
  onDefault,
}: {
  pages: number;
  min: number;
  onChoose: (text: string, apply: () => Promise<unknown>) => void;
  onDefault: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("chrome");
  const label = useGuideLabel();
  const spread = () => onChoose(label("spreadIt"), () => decideHardcover("thin"));
  useDefault(onDefault, spread);
  const options = [
    { id: "thin", title: label("spreadIt"), hint: t("spreadItHint", { pages: min }), run: spread },
    {
      id: "keep",
      title: label("keepShort"),
      hint: t("keepShortHint", { pages }),
      run: () => onChoose(label("keepShort"), () => decideHardcover("keep")),
    },
  ];
  return (
    <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={option.run}
          className="flex flex-col items-start rounded-xl border border-ink-200 bg-ink-50/40 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-ink-400 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          <span className="font-display text-sm font-semibold text-ink-900">{option.title}</span>
          <span className="mt-0.5 text-xs leading-snug text-ink-500">{option.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** "Is it for 3-year-olds?": yes, or another age group. Typing an age answers it too. */
function AudienceConfirm({
  bandId,
  optional,
  differ,
  onDefault,
}: {
  bandId: string;
  optional?: boolean;
  differ?: boolean;
  onDefault: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("chrome");
  const label = useGuideLabel();
  const tap = useChatStudio((s) => s.tap);
  const chooseAudience = useChatStudio((s) => s.chooseAudience);
  const skipOwnAudience = useChatStudio((s) => s.skipOwnAudience);
  const keepOwnAudience = useChatStudio((s) => s.keepOwnAudience);
  const currentId = useProjectsStore((s) => s.current()?.config.ageRangeId);
  const audience = useAppConfigStore((s) => s.audience);
  const bands = useMemo(() => enabledAudienceProfiles(audience), [audience]);
  const suggested = resolveAudienceProfile(bandId, audience);
  const bandText = (band: AudienceProfile): string => {
    if (band.maxMonths < 24) return t("bandMonths", { min: band.minMonths, max: band.maxMonths });
    const min = Math.floor(band.minMonths / 12);
    const max = Math.floor(band.maxMonths / 12);
    return min === max ? t("bandYear", { n: min }) : t("bandYears", { min, max });
  };
  const pick = (band: AudienceProfile, text: string) =>
    void tap(text, () => chooseAudience(band.id), { undoable: true });
  const yes = () => pick(suggested, t("audienceYes", { band: bandText(suggested) }));
  useDefault(onDefault, yes);
  const current = resolveAudienceProfile(currentId, audience);
  const others = bands.filter((band) => band.id !== suggested.id);
  return (
    <div className="flex w-full flex-col items-start gap-3">
      <div className="flex flex-wrap gap-2">
        <Quiet onClick={yes}>{t("audienceYes", { band: bandText(suggested) })}</Quiet>
        {differ ? (
          <Quiet subtle onClick={() => void tap(t("audienceKeep", { band: bandText(current) }), keepOwnAudience, { undoable: true })}>
            {t("audienceKeep", { band: bandText(current) })}
          </Quiet>
        ) : null}
        {optional ? (
          <Quiet subtle onClick={() => void tap(label("skip"), skipOwnAudience, { undoable: true })}>
            {label("skip")}
          </Quiet>
        ) : null}
      </div>
      {others.length > 0 ? (
        <div className="flex w-full flex-col items-start gap-1.5">
          <span className="px-1 text-xs text-ink-500">{t("audienceOther")}</span>
          <div className="flex flex-wrap gap-1.5">
            {others.map((band) => (
              <button
                key={band.id}
                type="button"
                onClick={() => pick(band, bandText(band))}
                className="inline-flex min-h-9 items-center rounded-full border border-ink-200 bg-white px-3 text-[13px] font-medium text-ink-700 transition hover:border-ink-400 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
              >
                {bandText(band)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A started job answers the skill's well; the journey's own well takes over from here. */
async function startedFromWell(started: Promise<boolean>): Promise<boolean> {
  const ok = await started;
  if (ok) useChatStudio.getState().clearAgentWell();
  return ok;
}

/** A paid button that started its job is the reader's answer, so it joins the conversation. */
function echoWhenStarted(
  label: string,
  start: (quote: GenerationQuote) => Promise<boolean | void>,
  reply?: (quote: GenerationQuote) => GuideLineCandidate[],
): (quote: GenerationQuote) => Promise<boolean | void> {
  return async (quote) => {
    const started = await start(quote);
    if (started !== false) {
      void useChatStudio.getState().tap(label, async () => {}, reply ? { reply: reply(quote) } : undefined);
    }
    return started;
  };
}

/** Said once drawing starts: how long, and that the email goes out on its own. */
function drawingStarted(): (quote: GenerationQuote) => GuideLineCandidate[] {
  return (quote) => [
    {
      key: "pagesStarted",
      priority: "result",
      vars: { what: bookDrawDuration(quote.units, useAppConfigStore.getState().latencyStats) },
    },
  ];
}

/** The same units keep the same array, so a book edit that doesn't change them doesn't re-quote. */
function useStableUnits(units: GenerationQuoteUnit[]): GenerationQuoteUnit[] {
  const key = units.map((unit) => `${unit.id}:${unit.action}:${unit.kind}:${unit.refs ?? ""}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => units, [key]);
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
  const units = useStableUnits(portraitUnits(project, castIds));
  const cast = namedCast(briefOf(project.config)).filter(
    (member) => castIds.includes(member.id) && isPerson(member),
  );
  return (
    <div className="flex w-full flex-col gap-3">
      {cast.length > 0 && <div className="rounded-xl border border-ink-100 bg-white/80 p-3 shadow-xs">
        <p className="mb-2.5 text-[10px] font-semibold tracking-[0.12em] text-ink-400 uppercase">
          {t("ageForPortrait")}
        </p>
        <div className="flex flex-col gap-2">
          {cast.map((member) => (
            <PortraitAgeRow key={member.id} project={project} member={member} />
          ))}
        </div>
      </div>}
      <PaidAction
        purpose="portraits"
        units={units}
        label={label}
        start={echoWhenStarted(label, (quote) => startedFromWell(startPortraits(quote)))}
        onDefault={onDefault}
      />
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
  onDefault?: (run: (() => void) | null) => void;
}) {
  const stable = useStableUnits(useMemo(() => drawBookUnits(project), [project]));
  return (
    <PaidAction
      purpose="book"
      units={stable}
      label={label}
      start={echoWhenStarted(label, (quote) => startedFromWell(startDrawBook(quote)), drawingStarted())}
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
  const stable = useStableUnits(useMemo(() => drawBookUnits(project), [project]));
  return (
    <PaidAction
      purpose="book"
      units={stable}
      extraKey="book-update"
      label={label}
      start={echoWhenStarted(label, startBookUpdate, drawingStarted())}
      onDefault={onDefault}
    />
  );
}

function ManuscriptChoice({ onDefault }: { onDefault: (run: (() => void) | null) => void }) {
  const label = useGuideLabel();
  const keep = useChatStudio((s) => s.keepManuscript);
  const asIdea = useChatStudio((s) => s.useManuscriptAsIdea);
  const pending = useChatStudio((s) => s.pendingManuscript);
  const tap = useChatStudio((s) => s.tap);
  return (
    <div className="flex flex-wrap gap-2">
      <Quiet onClick={() => void tap(label("useMyStory"), () => keep(pending ?? ""), { undoable: true })} onDefault={onDefault}>
        {label("useMyStory")}
      </Quiet>
      <Quiet onClick={() => void tap(label("useAsIdea"), asIdea, { undoable: true })} subtle>
        {label("useAsIdea")}
      </Quiet>
    </div>
  );
}

function PeopleRow({
  project,
  selectedId,
  onSelect,
  onReview,
}: {
  project: Project;
  selectedId: string | null;
  onSelect: (member: { id: string; name: string }) => void;
  onReview: () => void;
}) {
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
        {cast.map((member) => {
          const picked = selectedId === member.id;
          return (
            <button
              key={member.id}
              type="button"
              aria-pressed={picked}
              onClick={() => onSelect(member)}
              className={cn(
                "flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 text-xs font-medium text-ink-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                picked ? "bg-ink-900/5 ring-1 ring-ink-900" : "hover:bg-ink-50",
              )}
            >
              <CharacterAvatar
                project={project}
                characterId={member.id}
                name={member.name}
                className="size-9 text-xs"
              />
              <span className="max-w-24 truncate">{member.name}</span>
            </button>
          );
        })}
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
  // Without a drawing to show, the look's own picture: the admin's, or the first
  // cover this reader drew in it.
  const lookStrip = useStyleStrip({
    key: project.config.artStyle.customStyle?.id ?? project.config.artStyle.presetId,
    adminExamples: current?.examples,
    limit: 1,
  });
  const [lookUrl] = useStylePreviewUrls(lookStrip);
  const imageUrl = referenceUrl ?? lookUrl;
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
  const project = useProjectsStore((s) => s.current());
  const units = useStableUnits(project ? pageRetryUnits(project, unitId) : []);
  return (
    <PaidAction
      purpose="redraw"
      units={units}
      extraKey="retry"
      label={label}
      start={echoWhenStarted(label, startPageRetry)}
      onDefault={onDefault}
    />
  );
}

/**
 * A page that would print wrong, with its one fix: text near the edge moves
 * inward in place (free, nothing is redrawn); a page with nothing on it is drawn.
 */
function PrintFixAction({
  unitId,
  page,
  code,
  onOpenUnit,
  onDefault,
}: {
  unitId: string;
  page: number | null;
  code: PreflightCode;
  onOpenUnit: (unitId: string) => void;
  onDefault: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("chrome");
  const label = useGuideLabel();
  const tap = useChatStudio((s) => s.tap);
  const { pages, design } = useStudio();
  const setDesign = useProjectsStore((s) => s.setDesign);
  const where = page ? t("printPage", { n: page }) : t("printThisPage");

  if (code === "page-has-no-artwork") {
    return (
      <div className="flex w-full flex-col items-start gap-2">
        <p className="px-1 text-sm leading-snug text-ink-600">{t("printBlank", { where })}</p>
        <PageRetryAction unitId={unitId} label={t("drawThisPage")} onDefault={onDefault} />
      </div>
    );
  }

  const moveInward = async () => {
    const target = pages.find((p) => p.id === unitId);
    const current = design.pages[unitId];
    if (!target || !current) return;
    await setDesign({ ...design, pages: { ...design.pages, [unitId]: insetPageText(target, current, true) } });
  };
  return (
    <div className="flex w-full flex-col items-start gap-2">
      <p className="px-1 text-sm leading-snug text-ink-600">{t("printTextEdge", { where })}</p>
      <div className="flex flex-wrap gap-2">
        <Quiet
          onClick={() => void tap(t("moveTextInward"), moveInward, { undoable: true })}
          onDefault={onDefault}
        >
          {t("moveTextInward")}
        </Quiet>
        <Quiet subtle onClick={() => onOpenUnit(unitId)}>
          {label("showMe")}
        </Quiet>
      </div>
    </div>
  );
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
  const project = useProjectsStore((s) => s.current());
  const units = useStableUnits(project ? anchorRetryUnits(project, unitIds) : []);
  return (
    <PaidAction
      purpose="book"
      units={units}
      extraKey="preparation-retry"
      label={label}
      start={echoWhenStarted(label, startAnchorRetry)}
      onDefault={onDefault}
    />
  );
}

function RedrawAction({
  request,
  onDefault,
}: {
  request: RedrawRequest;
  onDefault: (run: (() => void) | null) => void;
}) {
  const label = useGuideLabel();
  const { target } = request;
  const project = useProjectsStore((s) => s.current());
  const parts = project ? redrawQuoteParts(project, request) : null;
  const units = useStableUnits(parts?.units ?? []);
  // One button for everyone the sentence named: one price, one tap.
  const text =
    target.kind === "person" || request.pages?.length ? label("redrawTarget", { names: redrawNames(request) }) : label("redrawPage");
  return (
    <PaidAction
      purpose="redraw"
      units={units}
      extraKey={parts?.extraKey ?? ""}
      label={text}
      start={echoWhenStarted(text, (quote) => startRedraw(quote, redrawInstructions(request), request.region))}
      onDefault={onDefault}
    />
  );
}

function OrderAction({
  onOrder,
  onDefault,
  quiet = false,
}: {
  onOrder: () => void;
  onDefault: (run: (() => void) | null) => void;
  quiet?: boolean;
}) {
  const label = useGuideLabel();
  const t = useGuideT("chrome");
  const price = useOrderPrice();
  useDefault(onDefault, onOrder);
  return (
    <button
      type="button"
      onClick={onOrder}
      className={cn(
        "inline-flex items-center gap-2 rounded-full transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
        quiet
          ? "min-h-9 bg-white px-4 text-sm font-medium text-ink-800 ring-1 ring-ink-200 hover:ring-ink-400"
          : "min-h-11 bg-brand-500 px-5 text-[15px] font-semibold text-white shadow-soft hover:bg-brand-600",
      )}
    >
      {label("orderBook")}
      {price && (
        <span className={quiet ? "font-normal text-ink-500" : "font-normal text-white/85"}>
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


