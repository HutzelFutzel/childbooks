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
import { coverWordsSettled } from "./coverWords";
import { illustrationUnits } from "../book/units";
import { pageNumberOf } from "../book/pageRefs";
import { unitIsDone } from "../book/pageCompletion";
import { anchorsToPrepare } from "../book/anchorFreshness";
import { briefOf, namedCast } from "../story/brief";
import { isPerson } from "../story/castKinds";
import type { GuideEntry, Project, StoryCastMember } from "../types";
import type { AudienceConfig } from "../config/audience";
import {
  GUIDE_FACT_IDS,
  GUIDE_FACTS,
  factsToAsk,
  missingGuideFacts,
  type GuideFactId,
  type GuideFactPolicies,
} from "./factPolicy";
import { peopleNeedingStatedAge } from "./agent/requirements";
import { ownAudienceQuestion, readingAgeOf, readingAgeSource, suggestedAudience, turningFields } from "./readingAge";
import type { HardcoverCheck } from "./hardcover";
import { ownWordsStatus, storyHandedOver } from "./ownWords";
import {
  hasAnyPortrait,
  lookDecided,
  looksToDecide,
  portraitStatus,
  portraitSubjects,
  portraitsToDraw,
  styleRevert,
} from "./portrait";
import { twinGroups, twinsToAsk } from "../story/relations";
import { composerForChoice } from "./activity";
import { authoringOf } from "./projectState";
import { briefStage, type GuideBriefConfig } from "./briefPolicy";
import type { StoryDetailId } from "./storyDetails";
import type { PreflightCode } from "../print/preflight";

/**
 * The book pane's tabs. "pages" is the Book tab: the finished book, front
 * cover first. The title fields live with the story, and the shape and layout
 * are chosen in the chat, so neither has a tab of its own.
 */
export const BOOK_VIEWS = [
  "story",
  "style",
  "cast",
  "pages",
] as const;
export type BookViewId = (typeof BOOK_VIEWS)[number];

/** A view id stored or typed before the Cover and Design tabs were folded in. */
export function bookViewOf(value: unknown): BookViewId | null {
  if (value === "cover") return "pages";
  if (value === "design") return "story";
  return (BOOK_VIEWS as readonly unknown[]).includes(value) ? (value as BookViewId) : null;
}

export type JourneyPhase = "opening" | "intake" | "story" | "pages" | "order";

/** What the composer well holds. One live item at a time. */
export type WellItem =
  /** Own words, while the reader writes: the one button that says the story is done. */
  | { kind: "storyDone" }
  | { kind: "castFix"; names: string[] }
  | { kind: "storyRetry"; error?: string }
  /** Where one person's look comes from, asked before the art style. `remaining` counts them too. */
  | { kind: "castLooks"; castId: string; name: string; remaining: number }
  /** Twins the family hasn't said are alike or not. Asked before their looks. */
  | { kind: "lookAlike"; ids: string[]; names: string[] }
  | {
      kind: "portraits";
      castIds: string[];
      names: string[];
      foundCast: boolean;
      /** Drawn already, but no longer matching the book (a new look, a changed age). Redrawn, not drawn. */
      stale?: boolean;
      /** The look changed and the old one can come back for free. */
      canKeepLook?: boolean;
    }
  | { kind: "skipFact"; fact: GuideFactId }
  /** Who the story is written for, suggested from the first child's age. `age` is in months when `months`. */
  | {
      kind: "audienceConfirm";
      castId: string;
      name: string;
      age: number;
      months: boolean;
      /** The parent said the child is almost this age (`age` is the years completed). */
      turning?: number;
      /** The age group the child is about to enter, when it differs from `bandId`: offered next to the suggestion. */
      turningBandId?: string;
      bandId: string;
      bandLabel: string;
      /** Own words: about the pages, not the writing. */
      own?: boolean;
      /** No stated age to suggest from. Skip keeps the book's current group. */
      optional?: boolean;
      /** A stated age points at a different group than the one already chosen. */
      differ?: boolean;
    }
  /** People whose age the story never stated. Asked before any portrait. */
  /**
   * Everyone drawn as a person, in cast order. `years` is the age already known
   * or estimated; a person without one is who the guide asks about.
   */
  | { kind: "castAges"; people: { id: string; name: string; years?: number; mates?: string[] }[] }
  /** Before the draft: optional story details and "Write the story". `focus` is the detail just asked. */
  | { kind: "storyBrief"; focus: StoryDetailId | null }
  | { kind: "account"; for: "drawBook" }
  | { kind: "formatChoice" }
  | { kind: "layoutChoice" }
  /** What the front cover says: the story's title, and a subtitle and author if the reader wants them. */
  | { kind: "coverWords"; own?: boolean; fromStory?: boolean }
  /** Own words, once, optional: what the pictures should know that the text doesn't say. */
  | { kind: "pictureNotes" }
  /** Too short for a hardcover: spread it over `min` pages, or keep `pages` as a softcover. Asked alone, before Draw the book. */
  | { kind: "hardcoverChoice"; pages: number; min: number }
  | { kind: "drawBook"; pages: number }
  | { kind: "bookUpdate"; names: string[] }
  /**
   * A run left pictures undrawn. `settled` means the server already finished
   * trying: say so, and make clear nothing was charged for what is missing.
   * Either way the well offers a way to ask again (a refusal, `error`, because
   * nothing was drawn): a run must never end with pictures missing and no
   * button, and only what comes out is ever charged.
   */
  | { kind: "bookFinish"; missing: number; error?: string; settled?: boolean }
  | { kind: "bookPrepFix"; unitIds: string[]; names: string[]; error: string }
  | { kind: "pageFix"; unitId: string; page: number; error: string }
  | ({ kind: "printFix" } & PrintIssue)
  | { kind: "order" };

/** A page that would print wrong. `message` is the preflight's English detail, for logs. */
export interface PrintIssue {
  unitId: string;
  page: number | null;
  code: PreflightCode;
  message: string;
}

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
  printIssue?: PrintIssue | null;
  /** Draw the book is in this phase. Cast and pages point the pane there. */
  drawPhase?: "cast" | "pages" | "done" | null;
  /**
   * The story-detail policy. Absent: the story starts as soon as the facts are
   * settled, as it did before story details existed.
   */
  brief?: GuideBriefConfig;
  /** The admin's age groups, for the reading-age suggestion. Absent: the shipped ones. */
  audience?: AudienceConfig | null;
}

export interface Journey {
  entry: GuideEntry | null;
  phase: JourneyPhase;
  storyStatus: StoryStatus;
  /** The pages have started: the look, cast, story, cover text, shape and count are locked. */
  locked: boolean;
  /** The story is the reader's to go on with: always for a draft, once they said so for their own words. */
  handedOver: boolean;
  views: BookViewId[];
  hasBook: boolean;
  /** Where the guide would point the book pane right now. */
  suggestedView: BookViewId | null;
  well: WellItem | null;
  /** Every choice open now, in the order they are asked. `well` is the first. */
  open: WellItem[];
  /**
   * The reader has answered everything they can and the book is still being
   * prepared: reading the story, or planning the pages. Something is coming.
   */
  waiting: "reading" | "planning" | null;
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

/** Answerable before the story is read: the book's shape and its cover words. */
export const BOOK_CHOICE_KINDS: ReadonlySet<string> = new Set(["formatChoice", "layoutChoice", "coverWords"]);

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

/** Whether the story is being written right now or has already been written. */
export function storyBegun(project: Project): boolean {
  const status = storyStatus(project);
  return status === "running" || status === "ready";
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
  signals: Pick<JourneySignals, "clarificationOpen" | "brief"> = {},
): boolean {
  if (!factsSettled(project, policies, signals)) return false;
  return !signals.brief || briefStage(project, signals.brief).kind === "go";
}

/** Everything the story needs is known, though a suggested value may still wait for its answer. */
function factsKnown(
  project: Project,
  policies: GuideFactPolicies,
  signals: Pick<JourneySignals, "clarificationOpen">,
): boolean {
  if (journeyEntry(project) !== "guided") return false;
  if (project.config.storyText.trim()) return false;
  if (authoringOf(project).storyRun?.status === "running") return false;
  if (signals.clarificationOpen) return false;
  if (!authoringOf(project).askedFacts?.length && namedCast(briefOf(project.config)).length === 0) return false;
  if (missingGuideFacts(project, policies).length > 0) return false;
  return openAskedFacts(project).length === 0;
}

/** Everything the story needs is known; only the story details and the go-ahead may remain. */
export function factsSettled(
  project: Project,
  policies: GuideFactPolicies,
  signals: Pick<JourneySignals, "clarificationOpen"> = {},
): boolean {
  return factsKnown(project, policies, signals) && factsToAsk(project, policies).length === 0;
}

/**
 * "Mila is 3, so I'll write for 3-year-olds. Right?" — asked once every other
 * fact is known, before the story details. A yes or another age answers it.
 */
export function audienceQuestion(
  project: Project,
  policies: GuideFactPolicies,
  signals: Pick<JourneySignals, "clarificationOpen" | "audience"> = {},
): Extract<WellItem, { kind: "audienceConfirm" }> | null {
  if (!factsKnown(project, policies, signals)) return null;
  if (!factsToAsk(project, policies).includes("readingAge")) return null;
  const hero = readingAgeSource(project);
  const age = hero ? readingAgeOf(hero) : null;
  if (!hero || !age) return null;
  const band = suggestedAudience(project, signals.audience);
  return {
    kind: "audienceConfirm",
    castId: hero.id,
    name: hero.name.trim(),
    age: age.n,
    months: age.months,
    ...turningFields(age.turning, band.id, signals.audience),
    bandId: band.id,
    bandLabel: band.label,
  };
}

/** The story card's state, when the book is between its facts and its draft. */
export function storyBriefWell(
  project: Project,
  policies: GuideFactPolicies,
  signals: Pick<JourneySignals, "clarificationOpen" | "brief">,
): Extract<WellItem, { kind: "storyBrief" }> | null {
  if (!signals.brief || storyStatus(project) !== "none") return null;
  if (!factsSettled(project, policies, signals)) return null;
  const stage = briefStage(project, signals.brief);
  if (stage.kind === "go") return null;
  return { kind: "storyBrief", focus: stage.kind === "review" ? null : stage.detail };
}

/**
 * Whether the chat asks for the book's style now: once the story is written
 * (or read) and everyone's look is settled. A drawing of someone can set the
 * style on its own, so the picker never asks what a drawing is about to answer.
 */
export function styleChoiceOpen(project: Project, journey: Pick<Journey, "locked" | "storyStatus" | "entry">): boolean {
  return (
    project.config.styleReady === false &&
    !journey.locked &&
    journey.storyStatus === "ready" &&
    (journey.entry !== "own" || ownWordsStatus(project).read) &&
    twinsToAsk(briefOf(project.config)).length === 0 &&
    looksToDecide(project).length === 0
  );
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

export function availableViews(
  project: Project,
  options: { portraitsRunning?: boolean } = {},
): BookViewId[] {
  if (!bookVisible(project)) return [];
  const entry = journeyEntry(project);
  const locked = pagesStarted(project);
  const own = entry === "own" ? ownWordsStatus(project) : null;
  const out: BookViewId[] = [];
  // A tab is the result of a choice, not a second copy of the question.
  // The chat asks; the tab arrives once that part of the book exists.
  if (project.config.storyText.trim() || entry === "own" || storyStatus(project) === "running") out.push("story");
  if (project.config.styleReady !== false) out.push("style");
  // The people arrive with their first picture (or while it is being drawn);
  // plates of bare initials before any portrait starts are not a result.
  // Names the guide couldn't sort out are fixed there, so they open it early.
  // So does a settled look (a photo, a drawing, a description, "from the
  // story"): the plate is where it is looked at again and changed, for any
  // person, before anyone is drawn.
  if (
    locked ||
    options.portraitsRunning ||
    hasAnyPortrait(project) ||
    portraitSubjects(project).some((member) => lookDecided(project, member)) ||
    Boolean(own?.read && own.unresolved.length > 0)
  ) {
    out.push("cast");
  }
  if (project.screenplay && locked) out.push("pages");
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
  const cast = namedCast(briefOf(project.config));
  const active = signals.activeUnitIds ?? new Set<string>();
  const portraitsRunning = cast.some((m) => active.has(m.id));
  const views = availableViews(project, { portraitsRunning });
  const failed = signals.failedUnits ?? {};
  const missing = entry === "guided" && story === "none" ? missingGuideFacts(project, policies) : [];
  const draftable = readyToDraft(project, policies, signals);
  const handedOver = storyHandedOver(project);

  const units = locked ? illustrationUnits(project) : [];
  const pendingAnchors = locked ? anchorsToPrepare(project) : [];
  const stale = new Set(signals.stalePages ?? []);
  // A picture that exists counts as done even when it is out of date. Stale is a
  // separate mark on the page; it does not hide Order.
  const done = units.filter((u) => unitIsDone(project, u)).length;
  const failedPages = units.filter((u) => failed[u.id] && !active.has(u.id)).map((u) => u.id);
  const pagesComplete = locked && units.length > 0 && done === units.length && failedPages.length === 0;

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
      // Something drawing means the book is not ready to print: what prints is the saved book.
      pagesComplete && pendingAnchors.length === 0 && !signals.printIssue && !working
        ? "order"
        : "pages";
  }
  else if (story === "ready" && handedOver) phase = "story";
  else phase = "intake";

  const own = entry === "own" ? ownWordsStatus(project) : null;
  const needsCastFix = Boolean(own?.read && own.unresolved.length > 0);
  const setup = authoringOf(project).bookSetup;
  const formatReady = locked || Boolean(setup?.formatConfirmedAt);
  const layoutReady = locked || Boolean(setup?.layoutConfirmedAt);
  const coverReady = locked || coverWordsSettled(project);
  const styleSaved = project.config.styleReady !== false && Boolean(project.config.artStyle);
  const toDraw = !locked && styleSaved && !needsCastFix && (entry === "guided" || own?.read) ? portraitsToDraw(project) : [];
  // A portrait that was never drawn is the step before the book. One that is
  // only out of date stays on its plate; it does not take the create button.
  const missingPortraits = toDraw.filter((member) => portraitStatus(project, member.id) === "none");
  // Asked before the look: a drawing can become the whole book's style.
  const undecided = !locked && !needsCastFix && (entry === "guided" || own?.read) ? looksToDecide(project) : [];
  const twins = !locked && !needsCastFix && (entry === "guided" || own?.read) ? twinsToAsk(briefOf(project.config)) : [];
  const byId = new Map(cast.map((member) => [member.id, member.name.trim()]));
  const lookAlikeWell: WellItem | null = twins[0]
    ? { kind: "lookAlike", ids: twins[0].ids, names: twins[0].ids.map((id) => byId.get(id) ?? "") }
    : null;
  // The next look is asked while earlier portraits draw: choosing it starts
  // that person's portrait too.
  // Nobody is drawn for a story that is still being worked around them: it decides who is on the pages.
  const storyOwes = Boolean(authoringOf(project).storyOwes);
  const looksWell: WellItem | null =
    undecided.length > 0 && !storyOwes
      ? { kind: "castLooks", castId: undecided[0]!.id, name: undecided[0]!.name.trim(), remaining: undecided.length }
      : null;
  // The fallback when a choice didn't start them (price, balance, age, an
  // unpriced or typed choice): only the people not already drawing.
  const idle = missingPortraits.filter((m) => !active.has(m.id));
  const portraitAction: WellItem | null =
    idle.length > 0 && !storyOwes
      ? {
          kind: "portraits",
          castIds: idle.map((m) => m.id),
          names: castNames(idle),
          foundCast: entry === "own",
        }
      : null;

  // Out of date is its own step, before the book: redrawing is what the reader
  // is deciding, and the book's button only comes once it's settled. While
  // they redraw, nothing is offered.
  const outOfDate = toDraw.filter((member) => portraitStatus(project, member.id) === "stale");
  const redrawIdle = outOfDate.filter((m) => !active.has(m.id));
  const redrawAction: WellItem | null =
    redrawIdle.length > 0
      ? {
          kind: "portraits",
          castIds: redrawIdle.map((m) => m.id),
          names: castNames(redrawIdle),
          foundCast: false,
          stale: true,
          ...(styleRevert(project) ? { canKeepLook: true } : {}),
        }
      : null;

  const castAges: WellItem | null = (() => {
    if (locked || needsCastFix || (entry !== "guided" && !own?.read)) return null;
    if (peopleNeedingStatedAge(project).length === 0) return null;
    // The whole cast is shown, so nobody looks forgotten: estimates are filled
    // in and can be changed, and the one without any is who is asked.
    const persons = cast.filter(isPerson);
    const stated = (member: StoryCastMember): number | undefined =>
      member.age ?? (member.ageMonths !== undefined ? Math.floor(member.ageMonths / 12) : undefined);
    const groups = [...twinGroups(briefOf(project.config)), ...(authoringOf(project).sameAge ?? [])].map(
      (group) => new Set(group.map((name) => name.trim().toLowerCase())),
    );
    const matesOf = (member: StoryCastMember): StoryCastMember[] => {
      const key = member.name.trim().toLowerCase();
      return persons.filter(
        (other) => other.id !== member.id && groups.some((group) => group.has(key) && group.has(other.name.trim().toLowerCase())),
      );
    };
    // Twins share an age: one with only an estimate shows the other's stated age.
    const people = persons.map((member) => {
      const mates = matesOf(member);
      const years =
        stated(member) ??
        mates.map(stated).find((value) => value !== undefined) ??
        member.visualAge?.years;
      return {
        id: member.id,
        name: member.name.trim(),
        ...(years !== undefined ? { years } : {}),
        ...(mates.length > 0 ? { mates: mates.map((mate) => mate.id) } : {}),
      };
    });
    return { kind: "castAges" as const, people };
  })();

  let well: WellItem | null = null;
  // Every choice open right now, in the order they are asked.
  let queue: WellItem[] | null = null;
  if (phase === "intake") {
    const openOptional = openAskedFacts(project).find((id) => !policies[id].required);
    const readyForPortraitAction = missing.length === 0 && !openOptional;
    const earlyAudience = entry === "own" && !handedOver ? ownAudienceQuestion(project, signals.audience) : null;
    well =
      earlyAudience ??
      (entry === "own" && story === "ready" && !handedOver ? { kind: "storyDone" } : null) ??
      (needsCastFix ? { kind: "castFix", names: own!.unresolved } : null) ??
      (story === "failed" ? { kind: "storyRetry", error: authoringOf(project).storyRun?.error } : null) ??
      (openOptional ? { kind: "skipFact", fact: openOptional } : null) ??
      audienceQuestion(project, policies, signals) ??
      storyBriefWell(project, policies, signals) ??
      (readyForPortraitAction ? portraitAction : null);
  } else if (phase === "story") {
    const planReady =
      formatReady &&
      layoutReady &&
      (signals.planReady ?? Boolean(project.screenplay)) &&
      !signals.planRunning &&
      !signals.analysisRunning;
    // Anyone still being drawn holds the book back, whether their portrait is missing, out of date
    // or current (a redraw of a portrait that is already right changes nothing until the new one lands).
    const portraitsReady = missingPortraits.length === 0 && outOfDate.length === 0 && !portraitsRunning;
    const hc = signals.hardcover;
    const bookReady = planReady && portraitsReady && !needsCastFix && (!hc || hc.printable || hc.case === "short");
    // The question stands alone: its two answers sit directly under it, and the
    // book's summary only follows once it is answered.
    const hardcoverOpen = bookReady && hc?.case === "short" && !authoringOf(project).hardcover;
    const drawBook: WellItem | null = !bookReady
      ? null
      : hardcoverOpen
        ? { kind: "hardcoverChoice", pages: hc!.softcoverPages ?? hc!.pages, min: hc!.hardcoverMin ?? hc!.pages }
        : signals.guest
          ? { kind: "account", for: "drawBook" }
          : { kind: "drawBook", pages: hc?.pages ?? 0 };
    // Own words: who the pages are for. Asked up front, and again only when a stated age disagrees.
    const ownAudience = own?.read && !needsCastFix ? ownAudienceQuestion(project, signals.audience) : null;
    const notesAsked = ["answeredFacts", "skippedFacts"].some((key) =>
      (authoringOf(project)[key as "answeredFacts" | "skippedFacts"] ?? []).includes("pictureNotes"),
    );
    // Still asked once the pages are planned: a note then plans them again.
    const pictureNotes: WellItem | null =
      own?.read && !needsCastFix && !notesAsked && !briefOf(project.config).pictureNotes?.trim()
        ? { kind: "pictureNotes" }
        : null;
    const bookChoices: (WellItem | null)[] = [
      !formatReady ? { kind: "formatChoice" } : null,
      !layoutReady ? { kind: "layoutChoice" } : null,
      !coverReady
        ? {
            kind: "coverWords",
            ...(entry === "own" ? { own: true } : {}),
            ...(entry === "own" && authoringOf(project).cover?.fromStory ? { fromStory: true } : {}),
          }
        : null,
    ];
    const castChoices: (WellItem | null)[] = [
      castAges,
      ownAudience,
      pictureNotes,
      lookAlikeWell,
      looksWell,
      portraitAction,
      redrawAction,
    ];
    // Own words: the people are found by reading the story, which is still
    // running when the format and layout are asked. What the reader can answer
    // now comes first, so a reading that finishes mid-answer adds to the end
    // of the list instead of cutting in. A story the guide wrote already knows
    // its people, so they keep their place.
    queue = [
      needsCastFix ? { kind: "castFix" as const, names: own!.unresolved } : null,
      ...(entry === "own" ? [...bookChoices, ...castChoices] : [...castChoices, ...bookChoices]),
      drawBook,
    ].filter((item): item is WellItem => item !== null);
    well = queue[0] ?? null;
  } else if (phase === "pages") {
    const failedAnchors = pendingAnchors.filter(
      (anchor) => failed[anchor.id] && !active.has(anchor.id),
    );
    const drawingNow = signals.drawPhase === "cast" || signals.drawPhase === "pages";
    // The server book job retries its own failures. Don't ask the reader to
    // pay for another go while that job is still the one drawing.
    const serverDrawing = Boolean(authoringOf(project).drawBook?.jobId) && drawingNow;
    const undrawn = units.filter((u) => !unitIsDone(project, u) && !active.has(u.id));
    // A failed redraw of a page that was already drawn keeps its own retry.
    const firstFailed = failedPages.find((id) => {
      const unit = units.find((u) => u.id === id);
      return unit ? unitIsDone(project, unit) : false;
    });
    // The number the book on the left shows: inside pages only, so a cover is 0.
    const page = firstFailed ? (pageNumberOf(project, firstFailed) ?? 0) : 0;
    const runError = authoringOf(project).drawBook?.error;
    if (!drawingNow && !working && (failedAnchors.length > 0 || undrawn.length > 0)) {
      well = {
        kind: "bookFinish",
        missing: failedAnchors.length + undrawn.length,
        ...(runError ? { error: runError } : { settled: true }),
      };
    } else if (!serverDrawing && signals.drawPhase === "cast" && failedAnchors.length > 0) {
      well = {
        kind: "bookPrepFix",
        unitIds: failedAnchors.map((anchor) => anchor.id),
        names: failedAnchors.map((anchor) => anchor.name.trim()).filter(Boolean),
        error: failed[failedAnchors[0]!.id]!.error,
      };
    } else {
      well = !serverDrawing && firstFailed
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
  const open: WellItem[] = queue ?? (well ? [well] : []);
  // Nothing left to ask, yet the book isn't ready: the story is being read or
  // the pages planned. The chat shows that as working, with no gap in between.
  const waiting: Journey["waiting"] =
    phase !== "story" || open.length > 0
      ? null
      : signals.analysisRunning || (entry === "own" && !own?.read)
        ? "reading"
        : signals.planRunning || (formatReady && layoutReady && !(signals.planReady ?? Boolean(project.screenplay)))
          ? "planning"
          : null;

  let suggestedView: BookViewId | null = null;
  if ((signals.drawPhase === "cast" || portraitsRunning) && views.includes("cast")) suggestedView = "cast";
  else if (signals.drawPhase === "pages" || phase === "pages") suggestedView = "pages";
  else if (phase === "intake") {
    if (entry === "own" || story === "running") suggestedView = "story";
  } else if (phase === "story") {
    // Once someone is drawn, the people are the book's newest result; the
    // story tab is where it was, not where it is.
    suggestedView = views.includes("cast") && hasAnyPortrait(project) ? "cast" : "story";
  } else if (phase === "order") suggestedView = "pages";
  if (suggestedView && !views.includes(suggestedView)) suggestedView = views[0] ?? null;

  const composer = composerForChoice({
    entry,
    ownComposer: authoringOf(project).ownComposer === true,
    handedOver,
    wellKind: well?.kind,
  });

  return {
    entry,
    phase,
    storyStatus: story,
    locked,
    handedOver,
    views,
    hasBook: views.length > 0,
    suggestedView,
    well,
    open,
    waiting,
    composer,
    working,
    missing,
    readyToDraft: draftable,
    pages: { done, total: units.length, failed: failedPages },
  };
}
