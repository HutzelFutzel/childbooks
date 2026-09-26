/**
 * The Chat studio's journey: where this book is, derived from the book.
 *
 * Code owns the order — the look, the plates, the story, then the pages and the
 * order button. Nothing here is stored: the Project and its durable jobs decide
 * where a reopened book resumes, so a book begun in Steps opens in Chat at its
 * current state, never at intake merely because Chat has no transcript.
 *
 * The primary cursor is the one question or action that is live; everything
 * that runs alongside it (portraits while the facts conversation continues, the
 * page plan while the reader reads) is a background track, reported but never
 * the cursor.
 *
 * Pure and total, so `scripts/guide-journey-invariants.ts` can walk it.
 */
import { illustrationUnits } from "../book/units";
import { unitIsDone } from "../book/pageCompletion";
import { anchorsToPrepare } from "../book/anchorFreshness";
import { briefOf, namedCast } from "../story/brief";
import type { GuideEntry, Project, StoryCastMember } from "../types";
import { GUIDE_FACT_IDS, GUIDE_FACTS, missingGuideFacts, type GuideFactId, type GuideFactPolicies } from "./factPolicy";
import type { HardcoverCheck } from "./hardcover";
import { ownWordsStatus } from "./ownWords";
import { portraitsToDraw } from "./portrait";
import { composerForChoice } from "./activity";
import { authoringOf } from "./projectState";

export const BOOK_VIEWS = [
  "cover",
  "style",
  "design",
  "story",
  "cast",
  "pages",
] as const;
export type BookViewId = (typeof BOOK_VIEWS)[number];

export type JourneyPhase = "opening" | "intake" | "story" | "pages" | "order";

/** What the composer well holds. One live item at a time. */
export type WellItem =
  | { kind: "castFix"; names: string[] }
  | { kind: "storyRetry"; error?: string }
  | { kind: "portraits"; castIds: string[]; names: string[]; foundCast: boolean }
  | { kind: "skipFact"; fact: GuideFactId }
  | { kind: "account"; for: "drawBook" }
  | { kind: "formatChoice" }
  | { kind: "layoutChoice" }
  | { kind: "drawBook"; pages: number; spreadOffer: boolean }
  | { kind: "bookUpdate"; names: string[] }
  /** A finished or refused run left pictures undrawn: one action draws all of them. */
  | { kind: "bookFinish"; missing: number; error?: string }
  | { kind: "bookPrepFix"; unitIds: string[]; names: string[]; error: string }
  | { kind: "pageFix"; unitId: string; page: number; error: string }
  | { kind: "printFix"; unitId: string; page: number | null; message: string }
  | { kind: "order" };

export type StoryStatus = "none" | "running" | "failed" | "ready";

export interface JourneySignals {
  /** Unit ids a live job is working on (cast member, anchor, spread or cover ids). */
  activeUnitIds?: ReadonlySet<string>;
  /** Units whose latest attempt failed. */
  failedUnits?: Readonly<Record<string, { error: string }>>;
  /** Spread ids whose art no longer matches the book. */
  stalePages?: readonly string[];
  /** The page plan is being (re)made. */
  planRunning?: boolean;
  /** The visible page plan matches the explicitly reviewed format and layout. */
  planReady?: boolean;
  /** The story analysis (cast extraction) is running. */
  analysisRunning?: boolean;
  /** An interpreter clarification or identity assignment is still open. */
  clarificationOpen?: boolean;
  /** Guests need a durable account before Draw the book. */
  guest?: boolean;
  hardcover?: HardcoverCheck | null;
  /** First blocking print problem, when the book would otherwise be orderable. */
  printIssue?: { unitId: string; page: number | null; message: string } | null;
  /** Draw the book is in this phase. Cast and pages point the pane there. */
  drawPhase?: "cast" | "pages" | "done" | null;
}

export interface Journey {
  entry: GuideEntry | null;
  phase: JourneyPhase;
  storyStatus: StoryStatus;
  /** The pages have started: the look, cast, story, cover text, shape and count are locked. */
  locked: boolean;
  views: BookViewId[];
  hasBook: boolean;
  /** Where the guide would point the book pane right now. */
  suggestedView: BookViewId | null;
  well: WellItem | null;
  /** Whether the composer is shown. Absent while a whole-task choice is live. */
  composer: boolean;
  /** Something is running: the violet trace. */
  working: boolean;
  /** Required facts still to ask, in order. */
  missing: GuideFactId[];
  /** The story can start: every required fact resolved and nothing open. */
  readyToDraft: boolean;
  /** Pages done / total, once the pages have started. */
  pages: { done: number; total: number; failed: string[] };
}

/** The entry the reader chose, or the one a book begun elsewhere implies. */
export function journeyEntry(project: Project): GuideEntry | null {
  const state = authoringOf(project);
  if (state.entry) return state.entry;
  if (!project.config.storyText.trim()) return null;
  return briefOf(project.config).mode === "own" ? "own" : "guided";
}

export function pagesStarted(project: Project): boolean {
  if (authoringOf(project).lockedAt) return true;
  return Object.values(project.illustrations ?? {}).some((tree) => tree && Object.keys(tree.nodes ?? {}).length > 0);
}

export function storyStatus(project: Project): StoryStatus {
  const run = authoringOf(project).storyRun;
  if (run?.status === "running") return "running";
  if (project.config.storyText.trim()) return "ready";
  if (run?.status === "failed") return "failed";
  return "none";
}

/** Optional facts the guide asked and the reader has not yet answered or skipped. */
export function openAskedFacts(project: Project): GuideFactId[] {
  const state = authoringOf(project);
  const resolved = new Set([...(state.answeredFacts ?? []), ...(state.skippedFacts ?? [])]);
  return GUIDE_FACT_IDS.filter(
    (id) => state.askedFacts?.includes(id) && !resolved.has(id) && !GUIDE_FACTS[id].has(project),
  );
}

/**
 * Whether the story may start now. Evaluated on the patch that resolves the
 * last item — never on silence, inactivity or a timeout.
 */
export function readyToDraft(
  project: Project,
  policies: GuideFactPolicies,
  signals: Pick<JourneySignals, "clarificationOpen"> = {},
): boolean {
  if (journeyEntry(project) !== "guided") return false;
  if (project.config.storyText.trim()) return false;
  if (authoringOf(project).storyRun?.status === "running") return false;
  if (signals.clarificationOpen) return false;
  if (!authoringOf(project).askedFacts?.length && namedCast(briefOf(project.config)).length === 0) return false;
  if (missingGuideFacts(project, policies).length > 0) return false;
  return openAskedFacts(project).length === 0;
}

/** Whether the book pane has something to show. */
export function bookVisible(project: Project): boolean {
  const entry = journeyEntry(project);
  // A generated placeholder title is not a book artifact. Until the reader has
  // started one of the two authoring paths, the opening remains one calm canvas.
  if (!entry) return false;
  const cast = namedCast(briefOf(project.config));
  return (
    cast.length > 0 ||
    Boolean(project.title?.trim()) ||
    Boolean(project.config.storyText.trim()) ||
    entry === "own" ||
    storyStatus(project) === "running" ||
    pagesStarted(project) ||
    project.config.styleReady === true
  );
}

function castNames(cast: readonly StoryCastMember[]): string[] {
  return cast.map((m) => m.name.trim()).filter(Boolean);
}

export function availableViews(project: Project): BookViewId[] {
  if (!bookVisible(project)) return [];
  const entry = journeyEntry(project);
  const brief = briefOf(project.config);
  const cast = namedCast(brief);
  const hasCastPlates = (brief.cast ?? []).length > 0;
  const out: BookViewId[] = [];
  if (cast.length > 0 || project.title?.trim()) out.push("cover");
  // A chosen style, a name, a manuscript or started pages. "Guide me" alone is
  // not a book: the chat stays centered and the look stays in the composer well.
  if (bookVisible(project)) out.push("style");
  if (bookVisible(project)) out.push("design");
  if (project.config.storyText.trim() || entry === "own" || storyStatus(project) === "running") out.push("story");
  if (hasCastPlates) out.push("cast");
  if (project.screenplay && pagesStarted(project)) out.push("pages");
  return out;
}

export function deriveJourney(
  project: Project,
  policies: GuideFactPolicies,
  signals: JourneySignals = {},
): Journey {
  const entry = journeyEntry(project);
  const locked = pagesStarted(project);
  const story = storyStatus(project);
  const views = availableViews(project);
  const cast = namedCast(briefOf(project.config));
  const active = signals.activeUnitIds ?? new Set<string>();
  const failed = signals.failedUnits ?? {};
  const missing = entry === "guided" && story === "none" ? missingGuideFacts(project, policies) : [];
  const draftable = readyToDraft(project, policies, signals);

  const units = locked ? illustrationUnits(project) : [];
  const pendingAnchors = locked ? anchorsToPrepare(project) : [];
  const stale = new Set(signals.stalePages ?? []);
  const done = units.filter((u) => unitIsDone(project, u) && !stale.has(u.id)).length;
  const failedPages = units.filter((u) => failed[u.id] && !active.has(u.id)).map((u) => u.id);
  const pagesComplete = locked && units.length > 0 && done === units.length && failedPages.length === 0;

  const portraitsRunning = cast.some((m) => active.has(m.id));
  const working =
    story === "running" ||
    portraitsRunning ||
    Boolean(signals.planRunning) ||
    Boolean(signals.analysisRunning) ||
    pendingAnchors.some((anchor) => active.has(anchor.id)) ||
    units.some((u) => active.has(u.id));

  let phase: JourneyPhase;
  if (!entry) phase = "opening";
  else if (locked) {
    phase =
      pagesComplete && pendingAnchors.length === 0 && !signals.printIssue
        ? "order"
        : "pages";
  }
  else if (story === "ready") phase = "story";
  else phase = "intake";

  const own = entry === "own" ? ownWordsStatus(project) : null;
  const needsCastFix = Boolean(own?.read && own.unresolved.length > 0);
  const setup = authoringOf(project).bookSetup;
  const formatReady = locked || Boolean(setup?.formatConfirmedAt);
  const layoutReady = locked || Boolean(setup?.layoutConfirmedAt);
  const styleSaved = project.config.styleReady !== false && Boolean(project.config.artStyle);
  const toDraw = !locked && styleSaved && !needsCastFix && (entry === "guided" || own?.read) ? portraitsToDraw(project) : [];
  const portraitAction: WellItem | null =
    toDraw.length > 0 && !portraitsRunning
      ? {
          kind: "portraits",
          castIds: toDraw.map((m) => m.id),
          names: castNames(toDraw),
          foundCast: entry === "own",
        }
      : null;

  let well: WellItem | null = null;
  if (phase === "intake") {
    const openOptional = openAskedFacts(project).find((id) => !policies[id].required);
    const readyForPortraitAction = missing.length === 0 && !openOptional;
    well =
      (needsCastFix ? { kind: "castFix", names: own!.unresolved } : null) ??
      (story === "failed" ? { kind: "storyRetry", error: authoringOf(project).storyRun?.error } : null) ??
      (openOptional ? { kind: "skipFact", fact: openOptional } : null) ??
      (readyForPortraitAction ? portraitAction : null);
  } else if (phase === "story") {
    const planReady =
      formatReady &&
      layoutReady &&
      (signals.planReady ?? Boolean(project.screenplay)) &&
      !signals.planRunning &&
      !signals.analysisRunning;
    const portraitsReady = toDraw.length === 0 && !portraitsRunning;
    const hc = signals.hardcover;
    const drawBook: WellItem | null =
      planReady &&
      portraitsReady &&
      !needsCastFix &&
      (!hc || hc.printable || hc.case === "short")
        ? signals.guest
          ? { kind: "account", for: "drawBook" }
          : { kind: "drawBook", pages: hc?.pages ?? 0, spreadOffer: hc?.case === "short" && !authoringOf(project).hardcover }
        : null;
    well =
      (needsCastFix ? { kind: "castFix", names: own!.unresolved } : null) ??
      portraitAction ??
      (!formatReady ? { kind: "formatChoice" } : null) ??
      (!layoutReady ? { kind: "layoutChoice" } : null) ??
      drawBook;
  } else if (phase === "pages") {
    const failedAnchors = pendingAnchors.filter(
      (anchor) => failed[anchor.id] && !active.has(anchor.id),
    );
    const drawingNow = signals.drawPhase === "cast" || signals.drawPhase === "pages";
    const undrawn = units.filter((u) => !unitIsDone(project, u) && !active.has(u.id));
    // A failed redraw of a page that was already drawn keeps its own retry.
    const firstFailed = failedPages.find((id) => {
      const unit = units.find((u) => u.id === id);
      return unit ? unitIsDone(project, unit) : false;
    });
    const page = firstFailed ? units.findIndex((u) => u.id === firstFailed) + 1 : 0;
    const runError = authoringOf(project).drawBook?.error;
    if (!drawingNow && !working && (failedAnchors.length > 0 || undrawn.length > 0)) {
      well = {
        kind: "bookFinish",
        missing: failedAnchors.length + undrawn.length,
        ...(runError ? { error: runError } : {}),
      };
    } else if (signals.drawPhase === "cast" && failedAnchors.length > 0) {
      well = {
        kind: "bookPrepFix",
        unitIds: failedAnchors.map((anchor) => anchor.id),
        names: failedAnchors.map((anchor) => anchor.name.trim()).filter(Boolean),
        error: failed[failedAnchors[0]!.id]!.error,
      };
    } else {
      well = firstFailed
        ? { kind: "pageFix", unitId: firstFailed, page, error: failed[firstFailed]!.error }
        : signals.drawPhase !== "cast" &&
            signals.drawPhase !== "pages" &&
            (pendingAnchors.length > 0 || stale.size > 0)
          ? {
              kind: "bookUpdate",
              names: pendingAnchors
                .filter((anchor) => anchor.type === "character")
                .map((anchor) => anchor.name.trim())
                .filter(Boolean),
            }
        : pagesComplete && signals.printIssue
          ? { kind: "printFix", ...signals.printIssue }
          : null;
    }
  } else if (phase === "order") {
    well = { kind: "order" };
  }

  let suggestedView: BookViewId | null = null;
  if (signals.drawPhase === "cast" && views.includes("cast")) suggestedView = "cast";
  else if (signals.drawPhase === "pages" || phase === "pages") suggestedView = "pages";
  else if (phase === "intake") {
    if (entry === "own" || story === "running") suggestedView = "story";
    else suggestedView = cast.length > 0 ? "cast" : null;
  } else if (phase === "story") suggestedView = "story";
  else if (phase === "order") suggestedView = "cover";
  if (suggestedView && !views.includes(suggestedView)) suggestedView = views[0] ?? null;

  const drawing = signals.drawPhase === "cast" || signals.drawPhase === "pages";
  const composer = composerForChoice({
    entry,
    ownComposer: authoringOf(project).ownComposer === true,
    wellKind: well?.kind,
    storyRunning: story === "running",
    drawing,
  });

  return {
    entry,
    phase,
    storyStatus: story,
    locked,
    views,
    hasBook: views.length > 0,
    suggestedView,
    well,
    composer,
    working,
    missing,
    readyToDraft: draftable,
    pages: { done, total: units.length, failed: failedPages },
  };
}
