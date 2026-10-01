/**
 * The Chat studio's conversation.
 *
 * Holds one book's transcript and the few things that are genuinely the
 * conversation's rather than the book's: which view the reader is looking at,
 * the context chip, a change waiting for its target, and the quotes behind the
 * paid buttons. Where the book is comes from `deriveJourney` against the live
 * project every time, so a render landing, a second tab or an edit on the book
 * moves the conversation without this store being told.
 *
 * The book is written only through `projectsStore.patchCurrent` — the
 * interpreter's proposals via `sendGuideTurn`, and the trusted actions here.
 * The transcript is stored beside the book (`repos.guide`), never in it.
 */
"use client";

import { create } from "zustand";
import type { GenerationQuote, GenerationQuoteUnit } from "../core/billing/generationQuote";
import { getBookLanguage } from "../core/config/bookLanguages";
import { resolveAudienceProfile } from "../core/config/audience";
import { describeError } from "../core/errors";
import { guideCopy, joinGuideNames, type GuideCopyVars, type GuideLineKey } from "../core/guide/copy";
import {
  GUIDE_FACTS,
  broadFacts,
  factsToConfirm,
  missingGuideFacts,
  type GuideFactId,
  type GuideFactPolicies,
} from "../core/guide/factPolicy";
import type { GuideComponentId } from "../core/guide/components";
import {
  audienceQuestion,
  journeyEntry,
  openAskedFacts,
  readyToDraft,
  storyBriefWell,
  type BookViewId,
  type PrintIssue,
} from "../core/guide/journey";
import {
  audienceAnswerMarks,
  ownAudienceQuestion,
  readingAgeAskLine,
  readingAgeExpectation,
  readingAgeSource,
  suggestedAudience,
  withChosenAudience,
  withLinkedAudience,
} from "../core/guide/readingAge";
import { briefStage, detailQuestion } from "../core/guide/briefPolicy";
import type { DetailPatch, StoryDetailId } from "../core/guide/storyDetails";
import { classifyOpeningText } from "../core/guide/manuscript";
import { storyHandedOver } from "../core/guide/ownWords";
import { applyGuidePatch, guidePatchContext } from "../core/guide/patch";
import { authoringOf, withAuthoring, withFactMarks } from "../core/guide/projectState";
import type { StoryFocus } from "../core/guide/attention";
import {
  appendGuideMessage,
  createGuideSession,
  guideMessage,
  guideTranscriptWindow,
  rewoundGuideSession,
  GUIDE_RESTORE_MAX_CHARS,
  type GuideMessage,
  type GuideReceipt,
  type GuideSession,
} from "../core/guide/session";
import { GUIDE_SLOTS, type GuideSlotId } from "../core/guide/slots";
import { acceptGuideQuestion, arbitrateGuideLines, needsGuideSpeech, type GuideLineCandidate } from "../core/guide/speech";
import { asksForEarlierPicture, pictureSubject } from "../core/guide/history";
import { asksForNewPicture, isBareRestart, type RedrawMode } from "../core/guide/redrawMode";
import { chipForView, resolveGuideTarget, targetHomeView, type GuideTarget, type TargetPerson } from "../core/guide/target";
import { currentPortrait } from "../core/guide/portrait";
import { CAST_KIND_SPECS, castKindOf, missingDetails } from "../core/story/castKinds";
import {
  briefOf,
  PICTURE_NOTES_MAX,
  isBriefReady,
  namedCast,
  storyBriefSignature,
  withGuidedBriefIfMissing,
  createDefaultStoryBrief,
} from "../core/story/brief";
import type { GuideEntry, Project } from "../core/types";
import { guideAskNextRemote, guideSpeakRemote, reportGuideTurnOutcomeRemote, storyDraftRemote } from "../platform/aiClient";
import { peopleNeedingStatedAge } from "../core/guide/agent/requirements";
import { updateCastMember } from "../ui/guide/bookActions";
import { useGuidePreference } from "../ui/guide/guidePreference";
import { useAppConfigStore } from "./appConfigStore";
import { quoteFor } from "./chatGeneration";
import { sendGuideTurn } from "./guideTurn";
import { rememberThumbs } from "./messageThumbs";
import { markExcerpt, type StoryMark } from "../core/story/storyMark";
import { takeMark } from "./storyMark";
import { useProjectsStore } from "./projectsStore";
import { startStoryRevision } from "../platform/storyRevisions";
import { getRepos } from "./repos";
import {
  agentConfig,
  agentWellTopic,
  applyRestore,
  composeUtterance,
  confirmAgentCalls,
  executeAgentCalls,
  skipPersonAsk,
  snapshot,
  utteranceFor,
  type AgentPending,
  type AgentTurn,
  type AgentWell,
} from "./guideAgent";
import { floorIsOpen, wellForKeys } from "../core/guide/conversation";
import { nextChatLocale } from "../core/guide/agent/language";
import { validateComposed } from "../core/guide/agent/compose";
import type { AskOption, Beat, CommandArgs, CommandCall } from "../core/guide/agent/types";
import { beat } from "../core/guide/agent/commands/shared";
import { guideAnswerRemote } from "../platform/aiClient";

const TRANSCRIPT_WINDOW = 8;
/** Longest a line waits for its phrasing before the configured sentence is shown instead. */
const REVEAL_BUDGET_MS = 3500;
/** A quote closer than this to expiry is renewed before a job is started against it. */
const QUOTE_START_MARGIN_MS = 10 * 60_000;

/** A short agreement, in the languages the Chat speaks. */
const AGREES =
  /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|right|correct|exactly|agreed?|fine|perfect|sounds good|that's right|ja|jo|jep|klar|genau|stimmt|richtig|passt|gut|einverstanden|oui|sí|si)\b/i;

/** Components the interpreter may decline, and the fact each one stands for. */
const SKIP_FACT: Partial<Record<GuideComponentId, GuideFactId>> = {
  "story-idea": "idea",
  audience: "readingAge",
};

export type QuoteSlot =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; quote: GenerationQuote }
  | { key: string; status: "error"; error: string };

/** A typed change that names nobody while several people are in view. */
export interface PendingTarget {
  instruction: string;
  people: TargetPerson[];
}

/** A typed change with exactly one target, waiting for its scoped redraw tap. */
export interface RedrawRequest {
  target: GuideTarget;
  instruction: string;
  /** "new" when the reader asked for a new picture; absent edits the picture that is there. */
  mode?: RedrawMode;
}

export interface SayExtra {
  marks?: string[];
  receipt?: GuideReceipt;
  /** The well this line introduces. Lines in `WELL_INTRO_LINES` carry theirs already. */
  well?: string;
  /** Said because the book moved on, not in reply: waits for the turn, and is quiet while the guide waits on the reader. */
  unprompted?: boolean;
  /** A model is rewording this line (`refineNextLine`): it is held back until then. */
  refine?: boolean;
}

interface ChatStudioState {
  projectId: string | null;
  session: GuideSession;
  loaded: boolean;
  sending: boolean;
  error: string | null;
  /** The view the reader chose. Null follows the guide. */
  view: BookViewId | null;
  chip: GuideTarget | null;
  focus: boolean;
  /**
   * What the reader is doing on the Story tab. While they type in the
   * manuscript or weigh a proposed change, the chat holds back choices that
   * can wait (`core/guide/attention.ts`), so the book and the chat never ask
   * for attention at once.
   */
  storyFocus: StoryFocus | null;
  /** Bumped to move the cursor to the composer (the story's hint row does). */
  composerFocus: number;
  pendingTarget: PendingTarget | null;
  redraw: RedrawRequest | null;
  quotes: Record<string, QuoteSlot>;
  /** Quote key whose paid action is being started. */
  starting: string | null;
  /** The reopen summary, shown once per open when something changed. */
  away: string | null;
  /** The first blocking print problem, reported by the book pane's preflight. */
  printIssue: PrintIssue | null;
  /** Story analysis (who is in it) is running for the text on screen. */
  analysisRunning: boolean;
  /** Own-words cast extraction is running. */
  extractionRunning: boolean;
  /** Last own-words extraction failure. Kept visible until retry or story change. */
  extractionError: string | null;
  /** A message that might be a story or an idea, waiting for the reader to say. */
  pendingManuscript: string | null;
  /** Chat skills: a confirmation, a question, a remedy or an offer the reader asked for. */
  agentWell: AgentWell | null;
  /** Chat skills: the follow-up the guide just asked, for the next short reply. */
  agentPending: AgentPending | null;
  /** Tap on a confirmation card: run it (with a choice's args), or say it went stale. */
  confirmAgent: (choice: CommandArgs | null) => Promise<void>;
  cancelAgent: () => void;
  /** Tap on an option the guide offered for a missing argument. */
  answerAgentAsk: (option: AskOption) => Promise<void>;
  /** Run one skill from a button (a remedy, a suggestion). */
  runSkill: (
    call: Omit<CommandCall, "source" | "evidence" | "confidence">,
    /** The passage marked when the reader tapped. Without it the skill works on the whole book. */
    options?: { mark?: StoryMark | null },
  ) => Promise<void>;
  clearAgentWell: () => void;
  setPrintIssue: (issue: ChatStudioState["printIssue"]) => void;
  setAnalysisRunning: (running: boolean) => void;
  setExtractionRunning: (running: boolean) => void;
  setExtractionError: (error: string | null) => void;
  retryExtraction: () => Promise<void>;
  /** Save the reader's words as the manuscript. Never drafts over them. */
  keepManuscript: (text: string) => Promise<void>;
  /** The pending message is a brief, so the guide may write from it. */
  useManuscriptAsIdea: () => Promise<void>;

  open: (projectId: string) => Promise<void>;
  close: () => void;
  chooseEntry: (entry: GuideEntry) => Promise<void>;
  /**
   * Send a typed message. The story passage the reader has marked goes with it,
   * taken now; `options.mark` replaces that for a retry.
   */
  send: (text: string, options?: { mark?: StoryMark | null }) => Promise<void>;
  retry: () => Promise<void>;
  undo: (messageId: string) => Promise<void>;
  skipFact: (fact: GuideFactId) => Promise<void>;
  retryStory: () => Promise<void>;
  /** "Write the story": the reader is done shaping it. */
  startStory: () => Promise<void>;
  /** Record the go-ahead without running the turn's follow-up (the caller does). */
  markStoryStart: () => Promise<void>;
  /** A tap on the story card: set, change or clear one story detail. */
  setStoryDetail: (id: StoryDetailId, patch: DetailPatch | null) => Promise<void>;
  /** The answer to "is it for 3-year-olds?": this age group, then the next step. */
  chooseAudience: (ageRangeId: string) => Promise<void>;
  /** Own words: skip the optional age-group question and keep the current one. */
  skipOwnAudience: () => Promise<void>;
  /** Own words: keep the chosen age group when a stated age points somewhere else. */
  keepOwnAudience: () => Promise<void>;
  /** Write stated ages for people the story left undated, then move on. */
  confirmCastAges: (ages: { id: string; years: number }[]) => Promise<void>;
  say: (candidates: GuideLineCandidate[], extra?: SayExtra) => string | undefined;
  /**
   * Turns in progress. While one runs, lines nobody asked for (a job finished)
   * wait, and the wells hold still, so the reply is what the reader sees next.
   */
  floor: number;
  /**
   * Record a tap as the reader's line, then run it. With `undoable`, the line's
   * undo puts the book back, unless the run reports it spent Sparks
   * ({@link TapOutcome}); its reply lines follow `reply`.
   */
  tap: (
    label: string,
    run: () => Promise<unknown>,
    options?: {
      undoable?: boolean;
      reply?: GuideLineCandidate[];
      /** Object URLs of the pictures the reader chose, shown in their line for this visit. */
      thumbs?: string[];
      /** The marked passage this tap acts on, quoted in the reader's line. */
      mark?: StoryMark | null;
    },
  ) => Promise<void>;
  /** Whether a line (or a marker saved with one) was already said on this book. */
  said: (mark: string) => boolean;
  setView: (view: BookViewId | null) => void;
  setChip: (target: GuideTarget | null) => void;
  setFocus: (focus: boolean) => void;
  setStoryFocus: (focus: StoryFocus | null) => void;
  /** Put the cursor in the message field, showing it first when an own-words book keeps it away. */
  focusComposer: () => Promise<void>;
  chooseTargetPerson: (person: TargetPerson) => Promise<void>;
  clearRedraw: () => void;
  ensureQuote: (key: string, purpose: GenerationQuote["purpose"], units: GenerationQuoteUnit[]) => Promise<void>;
  /** Tap a paid button: start exactly the quoted batch, once. */
  confirm: (key: string, start: (quote: GenerationQuote) => Promise<boolean | void>) => Promise<void>;
  setChatLocale: (locale: string) => Promise<void>;
  /** Own words: the reader asked the guide for something, so the composer shows. */
  askGuide: () => Promise<void>;
  /** Own words: the story is done. The guide reads it and the book carries on from here. */
  finishManuscript: () => Promise<void>;
  /** Own words: what the pictures should show that the text doesn't say. Empty: skipped. */
  savePictureNotes: (text: string) => Promise<void>;
  dismissAway: () => void;
}

// --- Book-side helpers --------------------------------------------------------

function policies(): GuideFactPolicies {
  return useAppConfigStore.getState().guide.facts;
}

function wording() {
  return useAppConfigStore.getState().guide.wording;
}

function briefConfig() {
  return useAppConfigStore.getState().guide.brief;
}

function audienceConfig() {
  return useAppConfigStore.getState().audience;
}

function patchContext() {
  const { audience, artStyles, storyCraft } = useAppConfigStore.getState();
  return guidePatchContext({ audience, artStyles, storyCraft });
}

/** A bare go-ahead typed while the story card is open. Anything longer goes to the interpreter. */
const TYPED_START =
  /^(?:(?:ok(?:ay)?|yes|sure|great|perfect|fine)[,!. ]*)?(?:just |please )?(?:go(?: ahead)?|write it|start|surprise (?:me|us)|let'?s go|do it|los(?: geht'?s)?|schreib(?: sie| es)?(?: los)?|fang an|leg los)[.! ]*(?:please|bitte)?[.! ]*$/i;

function live(): Project | null {
  return useProjectsStore.getState().current();
}

function patchBook(mutator: (project: Project) => Project): Promise<void> {
  return useProjectsStore.getState().patchCurrent(mutator);
}

/** The chat language: stored, else the book language the book was created with. */
export function chatLocaleOf(project: Project): string {
  return authoringOf(project).chatLocale ?? project.config.contentLocale ?? "en-US";
}

function languageName(id: string | undefined): string {
  return getBookLanguage(id).endonym;
}

function castNames(project: Project): string[] {
  return namedCast(briefOf(project.config)).map((m) => m.name.trim());
}

/** People who still have no age. A same-age group is listed together. */
function ageQuestionNames(project: Project): string[] {
  const missing = namedCast(briefOf(project.config))
    .filter((m) => missingDetails(m).includes("age"))
    .map((m) => m.name.trim());
  const missingKeys = new Set(missing.map((name) => name.toLowerCase()));
  const used = new Set<string>();
  const out: string[] = [];
  for (const group of authoringOf(project).sameAge ?? []) {
    for (const name of group) {
      const key = name.trim().toLowerCase();
      if (!missingKeys.has(key) || used.has(key)) continue;
      used.add(key);
      out.push(name.trim());
    }
  }
  for (const name of missing) {
    if (used.has(name.toLowerCase())) continue;
    out.push(name);
  }
  return out;
}

/** The first animal, toy or creature nobody has said the kind of, with its kind noun. */
function kindQuestion(project: Project): { name: string; what: string } | null {
  const member = namedCast(briefOf(project.config)).find((m) => missingDetails(m).includes("species"));
  return member ? { name: member.name.trim(), what: CAST_KIND_SPECS[castKindOf(member)].noun } : null;
}

function describeOpenFacts(project: Project, missing: readonly GuideFactId[]): string {
  return missing
    .map((id) => {
      if (id !== "ages") return `- ${id}: ${GUIDE_FACTS[id].label}. ${GUIDE_FACTS[id].help}`;
      const names = joinGuideNames(ageQuestionNames(project));
      const groups = (authoringOf(project).sameAge ?? []).map((group) => group.join(" and ")).join("; ");
      const kinds = namedCast(briefOf(project.config))
        .filter((m) => missingDetails(m).includes("species"))
        .map((m) => `what kind of ${CAST_KIND_SPECS[castKindOf(m)].noun} ${m.name.trim()} is`);
      const parts = [
        ...(names ? [`an age for ${names}${groups ? `. Same age: ${groups}` : ""}`] : []),
        ...kinds,
      ];
      return `- ages: still need ${parts.join("; ") || "an age for the children"}`;
    })
    .join("\n");
}

/** The one-row receipt for what a turn changed, read from the book after the patch. */
function receiptFor(project: Project, applied: readonly GuideSlotId[]): GuideReceipt | undefined {
  const parts: GuideReceipt["parts"] = [];
  for (const slot of applied) {
    if (slot === "storyText") continue;
    const value = GUIDE_SLOTS[slot].describe(project);
    if (!value) continue;
    const inferred = slot === "audience" && project.config.audienceFromCast !== "custom";
    parts.push({ value, ...(inferred ? { inferred: true } : {}) });
  }
  return parts.length > 0 ? { parts } : undefined;
}

/** Facts a set of applied or restated slots resolves. */
function factsOf(slots: readonly GuideSlotId[]): GuideFactId[] {
  return (Object.keys(GUIDE_FACTS) as GuideFactId[]).filter(
    (id) => slots.includes(GUIDE_FACTS[id].slot) || (id === "ages" && slots.includes("castKinds")),
  );
}

// --- Story draft ------------------------------------------------------------

/**
 * The run whose result may still land. A newer detail starts a newer run;
 * the older one is dropped when it finishes, however late.
 */
let storyToken = 0;

async function draftStory(): Promise<void> {
  let project = live();
  if (!project) return;
  const brief = briefOf(project.config);
  // A pasted manuscript is the story. Drafting would replace the reader's words.
  if (journeyEntry(project) === "own" || brief.mode === "own") return;
  if (!isBriefReady(brief)) return;
  // Until the reader picks an age group, the story is written for the first child's.
  if (withLinkedAudience(project, audienceConfig()) !== project) {
    await patchBook((p) => withLinkedAudience(p, audienceConfig()));
    project = live() ?? project;
  }
  const token = ++storyToken;
  const { ageRangeId, readingModeId, contentLocale } = project.config;
  const signature = storyBriefSignature(brief, ageRangeId, readingModeId, contentLocale);
  const startedAt = Date.now();
  await patchBook((p) => withAuthoring(p, { storyRun: { signature, startedAt, status: "running" } }));
  try {
    const draft = await storyDraftRemote(project, brief);
    if (token !== storyToken) return;
    const current = live();
    if (!current || current.id !== project.id || authoringOf(current).storyRun?.startedAt !== startedAt) return;
    // A newer detail landed while this was writing: its run replaces this one.
    const now = briefOf(current.config);
    const nowSignature = storyBriefSignature(now, current.config.ageRangeId, current.config.readingModeId, current.config.contentLocale);
    if (nowSignature !== signature) return;
    await patchBook((p) =>
      withAuthoring(
        {
          ...p,
          config: {
            ...p.config,
            storyText: draft.story,
            storyBrief: {
              ...briefOf(p.config),
              generatedAt: Date.now(),
              generatedSignature: signature,
              generatedForAge: ageRangeId,
              generatedForLocale: contentLocale,
            },
          },
          ...(draft.title && !authoringOf(p).cover?.titleEdited ? { title: draft.title } : {}),
        },
        {
          storyRun: { signature, startedAt, status: "done" },
          // A new story brings new subtitle ideas, and its cover words are asked about again.
          cover: {
            ...authoringOf(p).cover,
            subtitleIdeas: draft.subtitles?.length ? draft.subtitles : undefined,
            confirmedAt: undefined,
          },
        },
      ),
    );
    useChatStudio.getState().say([{ key: "storyReady", priority: "result" }], { unprompted: true });
  } catch (err) {
    if (token !== storyToken) return;
    await patchBook((p) =>
      authoringOf(p).storyRun?.startedAt === startedAt
        ? withAuthoring(p, { storyRun: { signature, startedAt, status: "failed", error: describeError(err) } })
        : p,
    );
    useChatStudio.getState().say([{ key: "storyFailed", priority: "blocking" }], { unprompted: true });
  }
}

/** Whether the story was written from facts that have since changed. */
function storyRunSuperseded(project: Project): boolean {
  const run = authoringOf(project).storyRun;
  if (run?.status !== "running") return false;
  const c = project.config;
  return storyBriefSignature(briefOf(c), c.ageRangeId, c.readingModeId, c.contentLocale) !== run.signature;
}

// --- Store --------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** React Strict Mode and fast remounts may ask to open the same book twice. */
const openTasks = new Map<string, Promise<void>>();
/**
 * The marks of recent reader lines, for a retry of one that failed to send. Kept
 * for this visit only: after a reload the line still shows its quote, but the
 * exact span is gone and the reader marks it again.
 */
const failedMarks = new Map<string, StoryMark>();
function rememberMarkFor(messageId: string, mark: StoryMark): void {
  failedMarks.set(messageId, mark);
  while (failedMarks.size > 8) failedMarks.delete(failedMarks.keys().next().value as string);
}

export const useChatStudio = create<ChatStudioState>((set, get) => {
  const persist = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { projectId, session } = get();
      if (!projectId) return;
      void getRepos()
        .then((repos) => repos.guide.save(projectId, session))
        .catch(() => {});
    }, 300);
  };

  const append = (message: GuideMessage): void => {
    set((state) => ({ session: appendGuideMessage(state.session, message) }));
    persist();
  };

  const patchMessage = (messageId: string, patch: Partial<GuideMessage>): void => {
    set((state) => ({
      session: {
        ...state.session,
        messages: state.session.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      },
    }));
    persist();
  };

  // A line being phrased is held back (with everything after it) and revealed
  // once, so nothing the reader is already reading changes under them.
  const phrasing = new Map<string, number>();
  const refined = new Set<string>();
  const isPending = (messageId: string): boolean =>
    get().session.messages.some((m) => m.id === messageId && m.pending);
  const reveal = (messageId: string): void => {
    phrasing.delete(messageId);
    if (isPending(messageId)) patchMessage(messageId, { pending: undefined });
  };
  const holdLine = (messageId: string): void => {
    phrasing.set(messageId, (phrasing.get(messageId) ?? 0) + 1);
  };
  const releaseLine = (messageId: string, patch?: Partial<GuideMessage>): void => {
    // Late phrasing is dropped: the reader already has the configured line.
    if (!isPending(messageId)) return;
    if (patch) patchMessage(messageId, patch);
    const left = (phrasing.get(messageId) ?? 1) - 1;
    if (left <= 0) reveal(messageId);
    else phrasing.set(messageId, left);
  };
  const appendHeld = (message: GuideMessage, held: boolean): void => {
    append(held ? { ...message, pending: true } : message);
    if (held) setTimeout(() => reveal(message.id), REVEAL_BUDGET_MS);
  };

  // Lines nobody asked for wait while a turn is running, then follow its reply.
  const queued: (() => void)[] = [];
  const enterFloor = (): void => set((state) => ({ floor: state.floor + 1 }));
  const leaveFloor = (): void => {
    set((state) => ({ floor: Math.max(0, state.floor - 1) }));
    if (get().floor > 0) return;
    for (const run of queued.splice(0)) run();
  };
  const withFloor = async <T>(run: () => Promise<T>): Promise<T> => {
    enterFloor();
    try {
      return await run();
    } finally {
      leaveFloor();
    }
  };
  const whenFloorFree = (run: () => void): void => {
    if (get().floor > 0) queued.push(run);
    else run();
  };

  const localize = (messageId: string, meaning: string, names: string[]): void => {
    const project = live();
    if (!project) return;
    const locale = chatLocaleOf(project);
    if (!needsGuideSpeech(locale)) return;
    const language = `${getBookLanguage(locale).endonym} (${locale})`;
    holdLine(messageId);
    void guideSpeakRemote({
      projectId: project.id,
      language,
      names,
      lines: [{ id: "line", meaning }],
      guidePreference: useGuidePreference.getState().preference,
    })
      .then(({ lines }) => {
        const text = lines.line?.trim();
        const phrased = text && text !== meaning && !refined.has(messageId);
        releaseLine(messageId, phrased ? { localized: { locale, text } } : undefined);
      })
      .catch(() => releaseLine(messageId));
  };

  /**
   * After the reader's turn, or whenever the book moved on: start the story if
   * this patch resolved the last item; otherwise ask the one thing still missing.
   */
  const afterTurn = async (answer: GuideLineCandidate | null, receipt?: GuideReceipt): Promise<void> => {
    const project = live();
    if (!project) return;
    const lines: GuideLineCandidate[] = answer ? [answer] : [];
    const marks: string[] = [];
    const p = policies();
    const clarificationOpen = Boolean(get().pendingTarget);
    const brief = briefConfig();

    if (storyRunSuperseded(project)) {
      void draftStory();
    } else if (storyBriefWell(project, p, { clarificationOpen, brief })) {
      const stage = briefStage(project, brief);
      if (stage.kind === "ask") {
        const names = joinGuideNames(castNames(project));
        lines.push({ key: "briefAsk", priority: "question", vars: { what: detailQuestion(stage.detail, names) } });
        await patchBook((b) =>
          withAuthoring(b, { briefAsked: [...(authoringOf(b).briefAsked ?? []), stage.detail], briefOpen: stage.detail }),
        );
        set({ agentPending: { expects: `the story detail "${stage.detail}" (write it under storyIdea), or a go-ahead (draftStory)` } });
      } else if (stage.kind === "review") {
        if (!get().said("briefOffer")) lines.push({ key: "briefOffer", priority: "question" });
        else if (receipt?.parts.length) lines.push({ key: "briefMore", priority: "question" });
      }
    } else if (readyToDraft(project, p, { clarificationOpen, brief })) {
      // Confirm-once facts are said with the start of the work they confirm.
      for (const fact of factsToConfirm(project, p)) {
        if (fact === "readingAge") {
          const first = readingAgeSource(project);
          const age = first?.age;
          if (first && age !== undefined) {
            lines.push({ key: "readingAgeNote", priority: "confirm", vars: { names: first.name.trim(), n: age } });
          }
        }
      }
      const said = factsToConfirm(project, p);
      const chat = chatLocaleOf(project);
      const book = project.config.contentLocale;
      const noteLanguage = !authoringOf(project).languageSaid && book && book.slice(0, 2) !== chat.slice(0, 2);
      if (noteLanguage) lines.push({ key: "languageNote", priority: "confirm", vars: { language: languageName(book) } });
      lines.push({ key: "storyStarting", priority: "result" });
      await patchBook((b) =>
        withAuthoring(withFactMarks(b, "saidFacts", said), noteLanguage ? { languageSaid: true } : {}),
      );
      void draftStory();
    } else if (journeyEntry(project) === "guided" && !project.config.storyText.trim()) {
      const missing = missingGuideFacts(project, p);
      const askedBroad = get().said("broadQuestion");
      if (!askedBroad) {
        lines.push({ key: "broadQuestion", priority: "question" });
        await patchBook((b) => withFactMarks(b, "askedFacts", broadFacts(p)));
      } else if (missing.includes("names")) {
        lines.push({ key: "missingNames", priority: "question" });
        await patchBook((b) => withFactMarks(b, "askedFacts", ["names"]));
      } else if (missing.includes("ages")) {
        const names = ageQuestionNames(project);
        const kind = kindQuestion(project);
        if (names.length > 0) {
          lines.push({
            key: names.length > 1 ? "missingAgesMany" : "missingAges",
            priority: "question",
            vars: { names },
          });
        } else if (kind) {
          lines.push({ key: "missingKind", priority: "question", vars: { names: kind.name, what: kind.what } });
        }
        await patchBook((b) => withFactMarks(b, "askedFacts", ["ages"]));
      } else {
        const question = audienceQuestion(project, p, { clarificationOpen, audience: audienceConfig() });
        if (question) {
          // Asked once; after that the well holds it, and a turn that changed something repeats it.
          const asked = get().said("readingAgeAsk") || get().said("readingAgeAskMonths");
          if (!asked || receipt?.parts.length) lines.push(readingAgeAskLine(question));
          if (!asked) await patchBook((b) => withFactMarks(b, "askedFacts", ["readingAge"]));
          set({ agentPending: { expects: readingAgeExpectation(question) } });
        }
      }
    } else if (
      journeyEntry(project) === "own" &&
      !project.config.storyText.trim() &&
      !get().said("ownWordsOpen")
    ) {
      lines.push({ key: "ownWordsOpen", priority: "question" });
    }
    const followUp = lines.some(
      (line) =>
        line.key === "missingNames" ||
        line.key === "missingAges" ||
        line.key === "missingAgesMany" ||
        line.key === "missingKind",
    );
    const transcript = guideTranscriptWindow(get().session, 8)
      .map((turn) => `${turn.role === "reader" ? "Reader" : "Guide"}: ${turn.text}`)
      .join("\n");
    const learned = receipt?.parts.map((part) => part.value).join(" · ") ?? "";
    let messageId: string | undefined;
    if (lines.length > 0 || receipt) messageId = get().say(lines, { marks, refine: followUp, ...(receipt ? { receipt } : {}) });
    if (messageId && followUp) refineNextLine(messageId, project, transcript, learned);
  };

  const refineNextLine = (messageId: string, project: Project, transcript: string, learned: string): void => {
    const p = policies();
    const missing = missingGuideFacts(project, p);
    const locale = chatLocaleOf(project);
    holdLine(messageId);
    void guideAskNextRemote({
      projectId: project.id,
      language: `${getBookLanguage(locale).endonym} (${locale})`,
      names: [...new Set([...castNames(project), ...ageQuestionNames(project)])],
      learned,
      open: describeOpenFacts(project, missing),
      transcript,
      guidePreference: useGuidePreference.getState().preference,
    })
      .then((result) => {
        const current = live();
        if (!current) return releaseLine(messageId);
        const stillMissing = missingGuideFacts(current, policies());
        const accepted = acceptGuideQuestion({
          text: result.text,
          asks: result.asks,
          missing: stillMissing,
          requiredMissing: stillMissing.filter((id) => policies()[id].required),
          ageNames: [...ageQuestionNames(current), ...(kindQuestion(current) ? [kindQuestion(current)!.name] : [])],
          sameAgeGroups: authoringOf(current).sameAge ?? [],
        });
        if (accepted && isPending(messageId)) refined.add(messageId);
        releaseLine(messageId, accepted ? { text: result.text, localized: undefined } : undefined);
      })
      .catch(() => releaseLine(messageId));
  };

  return {
    projectId: null,
    session: createGuideSession(),
    loaded: false,
    sending: false,
    error: null,
    view: null,
    chip: null,
    focus: false,
    storyFocus: null,
    composerFocus: 0,
    pendingTarget: null,
    redraw: null,
    quotes: {},
    starting: null,
    away: null,
    printIssue: null,
    analysisRunning: false,
    extractionRunning: false,
    extractionError: null,
    pendingManuscript: null,
    agentWell: null,
    agentPending: null,

    floor: 0,

    tap: (label, run, options = {}) =>
      withFloor(async () => {
        const before = options.undoable ? live() : null;
        const restore = before ? snapshot(before) : null;
        const message = guideMessage("reader", label, {
          keys: ["tap"],
          ...(restore && restore.length <= GUIDE_RESTORE_MAX_CHARS ? { restore } : {}),
          ...(options.mark ? { quote: markExcerpt(options.mark.text, 240) } : {}),
        });
        append(message);
        if (options.thumbs?.length) rememberThumbs(message.id, options.thumbs);
        if (restore) trimRestores();
        const outcome = tapOutcomeOf(await run());
        // Work already paid for can't be taken back by putting the book back.
        if (outcome.spent && restore) dropRestore(message.id);
        const reply = [...(options.reply ?? []), ...(outcome.reply ?? [])];
        if (reply.length) get().say(reply);
      }),

    confirmAgent: (choice) =>
      withFloor(async () => {
        const well = get().agentWell;
        if (well?.kind !== "agentConfirm" || get().sending) return;
        set({ agentWell: null, sending: true, error: null });
        try {
          const turn = await confirmAgentCalls(well.confirm, choice, speakLater);
          if (!turn) {
            await speak([{ key: "confirmExpired", priority: "blocking" }]);
            return;
          }
          await finishAgentTurn(turn, undefined);
        } catch (err) {
          set({ error: describeError(err) });
        } finally {
          set({ sending: false });
        }
      }),

    cancelAgent: () => {
      if (get().agentWell?.kind !== "agentConfirm") {
        set({ agentWell: null });
        return;
      }
      set({ agentWell: null });
      void withFloor(() => speak([{ key: "confirmCancelled", priority: "result" }]));
    },

    answerAgentAsk: (option) =>
      withFloor(async () => {
        const well = get().agentWell;
        if (well?.kind !== "agentAsk" || get().sending) return;
        append(guideMessage("reader", option.label, { keys: ["tap"] }));
        set({ agentWell: null, sending: true, error: null });
        try {
          await runAgentCalls([{ ...well.call, args: { ...well.call.args, [well.arg]: option.id }, source: "tap" }], [], undefined);
        } catch (err) {
          set({ error: describeError(err) });
        } finally {
          set({ sending: false });
        }
      }),

    runSkill: (call, options = {}) =>
      withFloor(async () => {
        if (get().sending) return;
        set({ agentWell: null, sending: true, error: null });
        try {
          await runAgentCalls(
            [{ ...call, evidence: "", confidence: 1, source: "tap" }],
            [],
            undefined,
            null,
            options.mark ?? null,
          );
        } catch (err) {
          set({ error: describeError(err) });
        } finally {
          set({ sending: false });
        }
      }),

    clearAgentWell: () => set({ agentWell: null }),

    setPrintIssue: (issue) => {
      const current = get().printIssue;
      if (current?.unitId === issue?.unitId && current?.code === issue?.code) return;
      set({ printIssue: issue });
    },
    setAnalysisRunning: (running) => set({ analysisRunning: running }),
    setExtractionRunning: (running) => set({ extractionRunning: running }),
    setExtractionError: (error) => set({ extractionError: error }),
    retryExtraction: async () => {
      const projectId = get().projectId;
      if (!projectId || get().extractionRunning) return;
      set({ extractionError: null });
      const { advanceStoryPipeline } = await import("./chatPipeline");
      await advanceStoryPipeline(projectId, { retryPlan: true });
    },

    keepManuscript: (text) => withFloor(async () => {
      const story = text.trim();
      if (!story) return;
      await patchBook((book) => {
        const brief = book.config.storyBrief ?? createDefaultStoryBrief("own");
        return withAuthoring(
          {
            ...book,
            config: {
              ...book.config,
              storyText: story,
              storyBrief: { ...brief, mode: "own" as const },
              styleReady: book.config.styleReady ?? false,
            },
          },
          {
            entry: "own",
            chatLocale: authoringOf(book).chatLocale ?? book.config.contentLocale,
            // Pasted as the finished story: nothing left to wait for.
            manuscriptReadyAt: authoringOf(book).manuscriptReadyAt ?? Date.now(),
          },
        );
      });
      set({ pendingManuscript: null, view: "story", sending: false });
      get().say([{ key: "keptStory", priority: "result" }]);
    }),

    useManuscriptAsIdea: () => withFloor(async () => {
      const text = get().pendingManuscript?.trim();
      const project = live();
      if (!text || !project) {
        set({ pendingManuscript: null });
        return;
      }
      set({ pendingManuscript: null, sending: true, error: null });
      const history = guideTranscriptWindow(get().session, TRANSCRIPT_WINDOW);
      try {
        await interpretMessage(text, history, project, { forceBrief: true, cast: namedCast(briefOf(project.config)).map((m) => ({ id: m.id, name: m.name.trim() })) });
      } catch (err) {
        set({ sending: false, error: describeError(err) });
      }
    }),

    open: (projectId) => {
      if (get().projectId === projectId && get().loaded) return Promise.resolve();
      const pending = openTasks.get(projectId);
      if (get().projectId === projectId && pending) return pending;
      set({
        projectId,
        session: createGuideSession(),
        loaded: false,
        sending: false,
        error: null,
        view: null,
        chip: null,
        focus: false,
        storyFocus: null,
        pendingTarget: null,
        redraw: null,
            quotes: {},
        starting: null,
        away: null,
        pendingManuscript: null,
        extractionRunning: false,
        extractionError: null,
        analysisRunning: false,
        agentWell: null,
        agentPending: null,
      });
      if (pending) return pending;
      const task = (async () => {
        const repos = await getRepos();
        const session = await repos.guide.load(projectId).catch(() => createGuideSession());
        if (get().projectId !== projectId) return;
        set({ session, loaded: true });

        const project = live();
        if (!project || project.id !== projectId) return;
        const state = authoringOf(project);
        // A draft that was writing when the page closed has nobody waiting for
        // it. The story is text, so writing it again costs nothing.
        if (state.storyRun?.status === "running") void draftStory();

        if (!journeyEntry(project) && !get().said("opening")) {
          get().say([{ key: "opening", priority: "question" }], { marks: ["broadQuestion"] });
          if (!state.sparksNoticeAt) {
            append(guideMessage("guide", guideCopy(wording(), "sparksNotice"), { keys: ["sparksNotice"] }));
            await patchBook((b) => withAuthoring(b, { sparksNoticeAt: Date.now() }));
          }
          const openingSession = get().session;
          await patchBook((b) => withFactMarks(b, "askedFacts", broadFacts(policies())));
          // The opening is navigation, not a draft. Save it before another mount
          // can load the old empty transcript and say it again.
          if (saveTimer) clearTimeout(saveTimer);
          await repos.guide.save(projectId, openingSession).catch(() => {});
        }
        if (state.seenAt) set({ away: awaySummary(project, state.seenAt) });
        await patchBook((b) => (b.id === projectId ? withAuthoring(b, { seenAt: Date.now() }) : b));
      })();
      openTasks.set(projectId, task);
      return task.finally(() => {
        if (openTasks.get(projectId) === task) openTasks.delete(projectId);
      });
    },

    close: () => {
      if (saveTimer) clearTimeout(saveTimer);
      set({
        projectId: null,
        session: createGuideSession(),
        loaded: false,
        storyFocus: null,
        pendingTarget: null,
        redraw: null,
            quotes: {},
        extractionError: null,
        agentWell: null,
        agentPending: null,
      });
    },

    chooseEntry: (entry) => withFloor(async () => {
      const project = live();
      if (!project || authoringOf(project).lockedAt) return;
      const previous = journeyEntry(project);
      await patchBook((b) => {
        const brief = b.config.storyBrief ?? createDefaultStoryBrief(entry === "own" ? "own" : "guided");
        const withBrief =
          entry === "guided"
            ? withGuidedBriefIfMissing(b)
            : { ...b, config: { ...b.config, storyBrief: { ...brief, mode: "own" as const } } };
        const guided =
          entry === "guided" && withBrief.config.storyBrief?.mode === "own"
            ? { ...withBrief, config: { ...withBrief.config, storyBrief: { ...withBrief.config.storyBrief, mode: "guided" as const } } }
            : withBrief;
        return withAuthoring({
          ...guided,
          config: { ...guided.config, styleReady: guided.config.styleReady ?? false },
        }, {
          entry,
          chatLocale: authoringOf(b).chatLocale ?? b.config.contentLocale,
        });
      });
      set({ view: null });
      if (entry === "own") {
        if (previous !== "own") get().say([{ key: "ownWordsOpen", priority: "question" }]);
        return;
      }
      await afterTurn(null);
    }),

    send: (text, options) => withFloor(async () => {
      const message = text.trim();
      const { projectId, sending, loaded } = get();
      if (!projectId || !loaded || !message || sending) return;
      const project = live();
      if (!project) return;

      // The passage marked in the story goes with this message and no other.
      const mark = options?.mark !== undefined ? options.mark : takeMark();
      const history = guideTranscriptWindow(get().session, TRANSCRIPT_WINDOW);
      const openWell = get().agentWell;
      const line = guideMessage("reader", message, mark ? { quote: markExcerpt(mark.text, 240) } : {});
      if (mark) rememberMarkFor(line.id, mark);
      append(line);
      set({ sending: true, error: null, agentWell: null });

      // A typed answer to the one open confirmation card.
      if (openWell?.kind === "agentConfirm") {
        const typed = typedConfirmation(message);
        const reversible = openWell.confirm.impact.level !== "irreversible" && !openWell.confirm.choices;
        if (typed === "no") {
          set({ sending: false });
          await speak([{ key: "confirmCancelled", priority: "result" }]);
          return;
        }
        if (typed === "yes" && reversible && agentConfig().turn.typedYes) {
          set({ agentWell: openWell, sending: false });
          await get().confirmAgent(null);
          return;
        }
      }

      const locked = Boolean(authoringOf(project).lockedAt);
      if (
        TYPED_START.test(message) &&
        storyBriefWell(project, policies(), { clarificationOpen: Boolean(get().pendingTarget), brief: briefConfig() })
      ) {
        set({ sending: false });
        await get().startStory();
        return;
      }
      if (!locked && !project.config.storyText.trim()) {
        const kind = classifyOpeningText(message);
        if (kind === "manuscript") {
          await get().keepManuscript(message);
          return;
        }
        if (kind === "ambiguous") {
          set({ sending: false, pendingManuscript: message });
          get().say([{ key: "manuscriptAsk", priority: "question" }]);
          return;
        }
        if (kind === "ownIntent" && !journeyEntry(project)) {
          await patchBook((book) => {
            const brief = book.config.storyBrief ?? createDefaultStoryBrief("own");
            return withAuthoring(
              {
                ...book,
                config: {
                  ...book.config,
                  storyBrief: { ...brief, mode: "own" as const },
                  styleReady: book.config.styleReady ?? false,
                },
              },
              { entry: "own", chatLocale: authoringOf(book).chatLocale ?? book.config.contentLocale },
            );
          });
          get().say([{ key: "ownWordsOpen", priority: "question" }]);
          set({ sending: false });
          return;
        }
      }

      // A change to a picture: aimed with the chip, or named in the sentence
      // once there is something drawn to change.
      const chip = get().chip;
      const cast = namedCast(briefOf(project.config)).map((m) => ({ id: m.id, name: m.name.trim() }));
      if (chip || locked) {
        await routePictureChange(message, project, cast);
        set({ sending: false });
        return;
      }

      try {
        await interpretMessage(message, history, project, { cast, mark });
      } catch (err) {
        set((state) => ({
          sending: false,
          error: describeError(err),
          session: {
            ...state.session,
            messages: state.session.messages.map((entry, index) =>
              index === state.session.messages.length - 1 && entry.role === "reader" ? { ...entry, failed: true } : entry,
            ),
          },
        }));
        persist();
      }
    }),

    retry: async () => {
      const { session } = get();
      const last = session.messages[session.messages.length - 1];
      if (!last || last.role !== "reader" || !last.failed) return;
      // A message that was about a marked passage is sent again about that same
      // passage, or not at all: never as a request about the whole story.
      const mark = last.quote ? (failedMarks.get(last.id) ?? null) : null;
      if (last.quote && !mark) {
        set({ error: "The passage you marked isn't available any more. Mark it again and send your message." });
        return;
      }
      failedMarks.delete(last.id);
      set((state) => ({ session: { ...state.session, messages: state.session.messages.slice(0, -1) }, error: null }));
      await get().send(last.text, { mark: mark ?? null });
    },

    undo: async (messageId) => {
      const { session, sending } = get();
      if (sending) return;
      const target = session.messages.find((m) => m.id === messageId);
      if (!target) return;
      if (target.before || target.restore) {
        const { audience, artStyles, storyCraft } = useAppConfigStore.getState();
        const context = guidePatchContext({ audience, artStyles, storyCraft });
        await patchBook((b) => {
          const restored = target.restore ? applyRestore(b, target.restore) : b;
          return target.before ? applyGuidePatch(restored, target.before, context).project : restored;
        });
        set({ session: rewoundGuideSession(get().session, messageId), agentWell: null, agentPending: null });
      } else {
        const index = session.messages.findIndex((m) => m.id === messageId);
        set({ session: { ...session, messages: session.messages.slice(0, Math.max(0, index)) } });
      }
      persist();
    },

    savePictureNotes: (text) => withFloor(async () => {
      const notes = text.trim().slice(0, PICTURE_NOTES_MAX);
      if (!notes) {
        await patchBook((b) => withFactMarks(b, "skippedFacts", ["pictureNotes"]));
        await afterTurn(null);
        return;
      }
      await patchBook((b) =>
        withFactMarks(
          {
            ...b,
            config: { ...b.config, storyBrief: { ...briefOf(b.config), pictureNotes: notes } },
          },
          "answeredFacts",
          ["pictureNotes"],
        ),
      );
      await afterTurn(null);
    }),

    skipFact: (fact) => withFloor(async () => {
      await patchBook((b) => withFactMarks(b, "skippedFacts", [fact]));
      await afterTurn(null);
    }),

    retryStory: async () => {
      await draftStory();
    },

    markStoryStart: async () => {
      await patchBook((b) => withAuthoring(b, { briefStartAt: authoringOf(b).briefStartAt ?? Date.now(), briefOpen: undefined }));
    },

    startStory: () => withFloor(async () => {
      await get().markStoryStart();
      set({ agentPending: null });
      await afterTurn(null);
    }),

    setStoryDetail: (id, patch) => withFloor(async () => {
      const context = patchContext();
      let answeredOpen = false;
      await patchBook((b) => {
        const result = applyGuidePatch(b, { storyIdea: { [id]: patch } }, context);
        answeredOpen = authoringOf(b).briefOpen === id;
        return answeredOpen ? withAuthoring(result.project, { briefOpen: undefined }) : result.project;
      });
      if (answeredOpen) {
        set({ agentPending: null });
        await afterTurn(null);
      }
    }),

    chooseAudience: (ageRangeId) => withFloor(async () => {
      const before = live();
      if (!before) return;
      const kept = suggestedAudience(before, audienceConfig()).id === ageRangeId;
      const profile = resolveAudienceProfile(ageRangeId, audienceConfig());
      await patchBook((b) => withFactMarks(withChosenAudience(b, profile), "answeredFacts", audienceAnswerMarks(before)));
      set({ agentPending: null });
      await afterTurn({
        key: journeyEntry(before) === "own" ? "readingAgeSetOwn" : kept ? "readingAgeKept" : "readingAgeChanged",
        priority: "result",
        vars: { what: profile.label },
      });
    }),

    skipOwnAudience: () => withFloor(async () => {
      const before = live();
      if (!before) return;
      const label = resolveAudienceProfile(before.config.ageRangeId, audienceConfig()).label;
      await patchBook((b) => withFactMarks(b, "skippedFacts", ["readingAge"]));
      set({ agentPending: null });
      await afterTurn({ key: "readingAgeSkipOwn", priority: "result", vars: { what: label } });
    }),

    keepOwnAudience: () => withFloor(async () => {
      const before = live();
      if (!before) return;
      const profile = resolveAudienceProfile(before.config.ageRangeId, audienceConfig());
      await patchBook((b) =>
        withFactMarks(withChosenAudience(b, profile), "answeredFacts", ["readingAge", "readingAgeBand"]),
      );
      set({ agentPending: null });
      await afterTurn({ key: "readingAgeKeptOwn", priority: "result", vars: { what: profile.label } });
    }),

    confirmCastAges: (ages) => withFloor(async () => {
      const before = live();
      if (!before) return;
      const names: string[] = [];
      for (const item of ages) {
        if (!Number.isInteger(item.years) || item.years < 0 || item.years > 120) continue;
        const member = namedCast(briefOf(before.config)).find((person) => person.id === item.id);
        if (!member) continue;
        names.push(member.name.trim());
        await updateCastMember(item.id, { age: item.years, ageMonths: undefined });
      }
      set({ agentPending: null });
      const only = ages.length === 1 ? ages[0] : undefined;
      await afterTurn(
        only
          ? { key: "ageSet", priority: "result", vars: { names: names[0] ?? "", n: only.years } }
          : { key: "agesSet", priority: "result", vars: { names } },
      );
    }),

    say: (candidates, extra = {}) => {
      if (extra.unprompted && get().floor > 0) {
        queued.push(() => void get().say(candidates, extra));
        return;
      }
      const utterance = arbitrateGuideLines(candidates, wording());
      if (!utterance && !extra.receipt) return;
      const well = extra.well ?? (utterance ? wellForKeys(utterance.keys) : undefined);
      const project = live();
      const locale = project ? chatLocaleOf(project) : "en-US";
      // News while the guide waits on the reader is reported, not spoken over them.
      const quiet =
        Boolean(extra.unprompted) &&
        !well &&
        !candidates.some((c) => c.priority === "blocking") &&
        floorIsOpen(get().session.messages, locale);
      const marks = [...(utterance?.keys ?? []), ...(extra.marks ?? []), ...(quiet ? ["notice"] : [])];
      const text =
        utterance?.meaning ??
        extra.receipt!.parts.map((part) => part.value).join(" · ");
      const message = guideMessage("guide", text, {
        keys: utterance ? marks : ["receipt", ...marks],
        ...(extra.receipt ? { receipt: extra.receipt } : {}),
        ...(well ? { well } : {}),
      });
      appendHeld(message, Boolean(utterance) && (Boolean(extra.refine) || needsGuideSpeech(locale)));
      if (utterance) localize(message.id, utterance.meaning, utterance.names);
      if (project && well === "audienceConfirm") {
        const question =
          ownAudienceQuestion(project, audienceConfig()) ??
          audienceQuestion(project, policies(), { audience: audienceConfig() });
        if (question) set({ agentPending: { expects: readingAgeExpectation(question) } });
      } else if (project && well === "castAges") {
        const names = peopleNeedingStatedAge(project).map((member) => member.name.trim());
        set({ agentPending: { expects: `setPersonAge for ${names.join(", ")}` } });
      }
      return message.id;
    },

    said: (mark) => get().session.messages.some((m) => m.role === "guide" && m.keys?.includes(mark)),

    // Leaving the tab a chip belongs to closes the card it opened.
    setView: (view) => set((state) => ({ view, chip: chipForView(state.chip, view) })),

    // A chip is set from the tab it belongs to; keeping that tab open is what lets
    // setView know to close the card when the reader leaves it.
    setChip: (target) =>
      set({ chip: target, pendingTarget: null, ...(target ? { view: targetHomeView(target) } : {}) }),

    setFocus: (focus) => set({ focus }),

    setStoryFocus: (storyFocus) => {
      if (get().storyFocus !== storyFocus) set({ storyFocus });
    },

    focusComposer: async () => {
      const project = live();
      if (project && journeyEntry(project) === "own" && authoringOf(project).ownComposer !== true) {
        await patchBook((b) => withAuthoring(b, { ownComposer: true }));
      }
      set((state) => ({ composerFocus: state.composerFocus + 1 }));
    },

    chooseTargetPerson: async (person) => {
      const pending = get().pendingTarget;
      if (!pending) return;
      const target: GuideTarget = { kind: "person", castId: person.id, name: person.name };
      set({ pendingTarget: null, chip: target });
      const project = live();
      if (project) await commitRedraw(project, target, pending.instruction);
    },

    clearRedraw: () => set({ redraw: null }),

    ensureQuote: async (key, purpose, units) => {
      const existing = get().quotes[key];
      if (existing && existing.status !== "error") {
        if (existing.status === "loading") return;
        if (existing.quote.expiresAt > Date.now() + 60_000) return;
      }
      const project = live();
      if (!project || units.length === 0) return;
      const kept = keptQuote(project.id, key);
      if (kept) {
        set((state) => ({ quotes: { ...state.quotes, [key]: { key, status: "ready", quote: kept } } }));
        return;
      }
      set((state) => ({ quotes: { ...state.quotes, [key]: { key, status: "loading" } } }));
      try {
        const quote = await quoteFor(project, purpose, units);
        keepQuote(project.id, key, quote);
        set((state) => ({ quotes: { ...state.quotes, [key]: { key, status: "ready", quote } } }));
      } catch (err) {
        set((state) => ({ quotes: { ...state.quotes, [key]: { key, status: "error", error: describeError(err) } } }));
      }
    },

    confirm: async (key, start) => {
      const slot = get().quotes[key];
      if (get().starting || !slot || slot.status !== "ready") return;
      set({ starting: key, error: null });
      try {
        let quote = slot.quote;
        // The worker checks the quote when it picks the job up, which can be a
        // few minutes after the tap if its first trigger is lost.
        if (quote.expiresAt < Date.now() + QUOTE_START_MARGIN_MS) {
          const project = live();
          if (!project) return;
          const fresh = await quoteFor(project, quote.purpose, quote.units);
          keepQuote(project.id, key, fresh);
          set((state) => ({ quotes: { ...state.quotes, [key]: { key, status: "ready", quote: fresh } } }));
          // The price shown is the price charged: a different number waits for another tap.
          if (fresh.maximumSparks !== quote.maximumSparks) return;
          quote = fresh;
        }
        const started = await start(quote);
        if (started === false) {
          set({ error: "This book changed since the price was shown. Check it and try again." });
          keepQuote(quote.projectId, key, null);
          set((state) => {
            const quotes = { ...state.quotes };
            delete quotes[key];
            return { quotes };
          });
          return;
        }
        keepQuote(slot.quote.projectId, key, null);
        set((state) => {
          const quotes = { ...state.quotes };
          delete quotes[key];
          return { quotes, redraw: key.startsWith("redraw:") ? null : state.redraw };
        });
      } catch (err) {
        set({ error: describeError(err) });
      } finally {
        set({ starting: null });
      }
    },

    setChatLocale: async (locale) => {
      const project = live();
      if (!project) return;
      const state = authoringOf(project);
      // Before the story, the story is written in the chat language unless the
      // reader asked for another one.
      const followBook = !project.config.storyText.trim() && !state.languageSaid && !state.lockedAt;
      await patchBook((b) =>
        withAuthoring(
          followBook && getBookLanguage(locale).id === locale
            ? { ...b, config: { ...b.config, contentLocale: locale as typeof b.config.contentLocale } }
            : b,
          { chatLocale: locale },
        ),
      );
    },

    askGuide: async () => {
      await patchBook((b) => withAuthoring(b, { ownComposer: true }));
      set((state) => ({ composerFocus: state.composerFocus + 1 }));
    },

    finishManuscript: async () => {
      const project = live();
      if (!project || !project.config.storyText.trim() || storyHandedOver(project)) return;
      await patchBook((b) => withAuthoring(b, { manuscriptReadyAt: Date.now() }));
      // Not awaited: the thanks comes first, then what the reading found.
      const { advanceStoryPipeline } = await import("./chatPipeline");
      void advanceStoryPipeline(project.id);
    },

    dismissAway: () => set({ away: null }),
  };

  async function interpretMessage(
    message: string,
    history: ReturnType<typeof guideTranscriptWindow>,
    project: Project,
    options: { forceBrief?: boolean; cast?: TargetPerson[]; mark?: StoryMark | null } = {},
  ): Promise<void> {
    const cast = options.cast ?? namedCast(briefOf(project.config)).map((m) => ({ id: m.id, name: m.name.trim() }));
    const firstTurn = !journeyEntry(project);
    let inferredEntry: GuideEntry | null = null;
    const pendingBefore = get().agentPending;
    const outcome = await sendGuideTurn(message, history, undefined, pendingBefore?.expects, options.mark?.text);
    set({ agentPending: null });
    const agent = agentConfig();
    if (agent.enabled) {
      const locale = nextChatLocale({
        current: chatLocaleOf(project),
        detected: outcome.language,
        confidence: outcome.languageConfidence,
        message,
        rule: agent.language,
        bookLocale: project.config.contentLocale,
      });
      if (locale) await get().setChatLocale(locale);
    }
    let after = live() ?? project;
    if (options.forceBrief && outcome.applied.includes("storyText")) {
      await patchBook((book) => ({ ...book, config: { ...book.config, storyText: "" } }));
      after = live() ?? after;
    }
    if (firstTurn) {
      const entry: GuideEntry = options.forceBrief
        ? "guided"
        : outcome.route === "own" || briefOf(after.config).mode === "own"
          ? "own"
          : "guided";
      inferredEntry = entry;
      await patchBook((book) => {
        const brief = book.config.storyBrief ?? createDefaultStoryBrief(entry === "own" ? "own" : "guided");
        return withAuthoring(
          {
            ...book,
            config: {
              ...book.config,
              storyBrief: { ...brief, mode: entry === "own" ? "own" : "guided" },
              styleReady: book.config.styleReady ?? false,
            },
          },
          { entry, chatLocale: authoringOf(book).chatLocale ?? book.config.contentLocale },
        );
      });
      after = live() ?? after;
    }
    const answered = factsOf([...outcome.applied, ...outcome.unchanged]);
    const openOptional = openAskedFacts(after);
    const skipped = outcome.skip.map((id) => SKIP_FACT[id]).filter((f): f is GuideFactId => Boolean(f));
    await patchBook((b) => {
      const marked = withFactMarks(withFactMarks(b, "answeredFacts", [...answered, ...openOptional]), "skippedFacts", skipped);
      // Any reply answers the story question just asked, even "no idea": the next one follows.
      return authoringOf(marked).briefOpen ? withAuthoring(marked, { briefOpen: undefined }) : marked;
    });
    // A plain "yes" to the reading-age question keeps the suggestion, even when
    // the interpreter wrote nothing for it.
    const ageAsked = audienceQuestion(project, policies(), { audience: audienceConfig() });
    if (ageAsked && !answered.includes("readingAge") && outcome.applied.length === 0 && AGREES.test(message)) {
      await patchBook((b) =>
        withFactMarks(withChosenAudience(b, suggestedAudience(b, audienceConfig())), "answeredFacts", ["readingAge"]),
      );
    }

    if (outcome.applied.length > 0) {
      set((state) => {
        const messages = [...state.session.messages];
        const index = messages.findLastIndex((m) => m.role === "reader");
        if (index >= 0) messages[index] = { ...messages[index]!, before: outcome.before };
        return { session: { ...state.session, messages } };
      });
    }

    const report = (applied: string[]) => {
      if (!outcome.turnId) return;
      reportGuideTurnOutcomeRemote({
        turnId: outcome.turnId,
        applied,
        unchanged: outcome.unchanged,
        rejected: outcome.rejected.map((r) => ({ key: r.key, reason: r.reason })),
        admittedFailure: false,
      });
    };

    // Skills the reader asked for. The facts above are already saved; the
    // skills run after them, so "add Brian, he's 6" finds Brian's age written.
    if (agent.enabled && (outcome.commands.length > 0 || outcome.overflowCommands.length > 0)) {
      const receipt = receiptFor(live() ?? after, outcome.applied);
      await runAgentCalls(outcome.commands, outcome.overflowCommands, receipt, pendingBefore, options.mark ?? null);
      set({ sending: false });
      report([...outcome.applied, ...outcome.commands.map((call) => `skill:${call.id}`)]);
      return;
    }
    if (outcome.intent === "skip" && pendingBefore?.person && (await skipPersonAsk(pendingBefore))) {
      await speak([{ key: "skipped", priority: "result" }]);
      set({ sending: false });
      report(outcome.applied);
      return;
    }
    if (agent.enabled && agent.answers.enabled && outcome.intent === "question" && outcome.applied.length === 0) {
      await answerQuestion(message);
      await afterTurn(null);
      set({ sending: false });
      report(["answer"]);
      return;
    }

    const drawn = cast.filter((m) => currentPortrait(after, m.id));
    if (
      outcome.applied.length === 0 &&
      (outcome.intent === "revise" || outcome.intent === "other") &&
      resolveGuideTarget({ sentence: message, chip: null, cast: drawn }).kind === "target"
    ) {
      await routePictureChange(message, after, drawn);
      set({ sending: false });
      return;
    }

    if (
      outcome.applied.length === 0 &&
      outcome.intent === "revise" &&
      after.config.storyText.trim().length >= 20 &&
      !authoringOf(after).lockedAt
    ) {
      await startStoryRevision(after, message);
      set({ sending: false, view: "story" });
      if (outcome.turnId) {
        reportGuideTurnOutcomeRemote({
          turnId: outcome.turnId,
          applied: ["storyRevision"],
          unchanged: outcome.unchanged,
          rejected: outcome.rejected.map((item) => ({
            key: item.key,
            reason: item.reason,
          })),
          admittedFailure: false,
        });
      }
      return;
    }

    const receipt = receiptFor(live() ?? after, outcome.applied);
    if (agent.enabled && outcome.applied.includes("storyIdea") && (await offerRewrite(receipt))) {
      set({ sending: false });
      report(outcome.applied);
      return;
    }
    const needsAnswer =
      Boolean(outcome.confirm) ||
      (firstTurn && inferredEntry === "own") ||
      outcome.intent === "question" ||
      outcome.intent === "other" ||
      (outcome.applied.length === 0 && outcome.unchanged.length === 0);
    const answer: GuideLineCandidate | null = outcome.confirm
      ? { key: "reply", priority: "blocking", text: outcome.confirm }
      : needsAnswer && outcome.reply.trim()
        ? { key: "reply", priority: "answer", text: outcome.reply }
        : null;
    await afterTurn(answer, receipt);
    set({ sending: false });

    if (outcome.turnId) {
      reportGuideTurnOutcomeRemote({
        turnId: outcome.turnId,
        applied: outcome.applied,
        unchanged: outcome.unchanged,
        rejected: outcome.rejected.map((r) => ({ key: r.key, reason: r.reason })),
        admittedFailure: false,
      });
    }
  }

  /**
   * New story details after the story exists: offer to rewrite it with them.
   * Replacing a story always asks first, so this only ever shows the card.
   */
  async function offerRewrite(receipt: GuideReceipt | undefined): Promise<boolean> {
    const project = live();
    if (!project?.config.storyText.trim() || authoringOf(project).lockedAt || journeyEntry(project) !== "guided") return false;
    const call: CommandCall = { id: "draftStory", args: {}, evidence: "", confidence: 1, source: "tap" };
    const turn = await executeAgentCalls([call], { later: speakLater });
    if (turn.well?.kind !== "agentConfirm") return false;
    await finishAgentTurn({ ...turn, beats: [beat("briefRewriteOffer", undefined, { priority: "confirm" })] }, receipt);
    return true;
  }

  /** Say beats as one message, phrased in the persona when the composer is on. */
  async function speak(beats: readonly Beat[], receipt?: GuideReceipt, well?: string): Promise<void> {
    const project = live();
    if (!project) return;
    const utterance = utteranceFor(beats);
    const parts = [
      ...(receipt?.parts ?? []),
      ...(utterance?.receipt ?? []).map((value) => ({ value })),
    ].slice(0, 8);
    const fullReceipt = parts.length > 0 ? { parts } : undefined;
    if (!utterance) {
      if (fullReceipt) get().say([], { receipt: fullReceipt });
      return;
    }
    const locale = chatLocaleOf(project);
    const transcript = guideTranscriptWindow(get().session, 6)
      .map((turn) => `${turn.role === "reader" ? "Reader" : "Guide"}: ${turn.text}`)
      .join("\n");
    const { text, composed } = await composeUtterance(utterance, { projectId: project.id, locale, transcript });
    const introduces = well ?? wellForKeys(utterance.keys);
    const fit = beats.find((b) => b.fit && utterance.keys.includes(b.key))?.fit;
    const message = guideMessage("guide", text, {
      keys: utterance.keys,
      ...(fullReceipt ? { receipt: fullReceipt } : {}),
      ...(fit ? { fit } : {}),
      ...(introduces ? { well: introduces } : {}),
    });
    appendHeld(message, !composed && needsGuideSpeech(locale));
    if (!composed) localize(message.id, utterance.meaning, utterance.names);
  }

  /** A result that arrives after its turn (a story check) follows whatever turn is running now. */
  function speakLater(beats: Beat[]): void {
    whenFloorFree(() => void withFloor(() => speak(beats)));
  }

  /** Only the last few reader messages keep an undo snapshot. */
  function trimRestores(): void {
    set((state) => {
      const messages = [...state.session.messages];
      let kept = 0;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (!messages[i]!.restore) continue;
        kept += 1;
        if (kept > RESTORES_KEPT) messages[i] = { ...messages[i]!, restore: undefined };
      }
      return { session: { ...state.session, messages } };
    });
    persist();
  }

  function dropRestore(messageId: string): void {
    set((state) => ({
      session: {
        ...state.session,
        messages: state.session.messages.map((m) => (m.id === messageId ? { ...m, restore: undefined } : m)),
      },
    }));
    persist();
  }

  /** Keep the undo snapshot on the reader's message. */
  function attachRestore(restore: string): void {
    if (restore.length > GUIDE_RESTORE_MAX_CHARS) return;
    set((state) => {
      const messages = [...state.session.messages];
      const index = messages.findLastIndex((m) => m.role === "reader");
      if (index < 0) return state;
      const existing = messages[index]!.restore;
      // Two skill turns on one message (a confirmation after the ask) keep the first snapshot.
      messages[index] = { ...messages[index]!, restore: existing ?? restore };
      return { session: { ...state.session, messages } };
    });
    trimRestores();
  }

  async function runAgentCalls(
    calls: readonly CommandCall[],
    overflow: readonly CommandCall[],
    receipt: GuideReceipt | undefined,
    pendingBefore: AgentPending | null = null,
    mark: StoryMark | null = null,
  ): Promise<void> {
    const turn = await executeAgentCalls(calls, { overflow, later: speakLater, mark, chip: get().chip });
    await finishAgentTurn(turn, receipt, pendingBefore);
  }

  async function finishAgentTurn(
    turn: AgentTurn,
    receipt: GuideReceipt | undefined,
    pendingBefore: AgentPending | null = null,
  ): Promise<void> {
    if (turn.restore) attachRestore(turn.restore);
    const beats = [...turn.beats];
    if (turn.undo) {
      const undone = await undoLastSkillTurn();
      beats.push({ key: undone ? "undone" : "nothingToUndo", priority: "result" });
    }
    if (turn.skip && !(await skipPersonAsk(pendingBefore))) {
      const current = live();
      const open = current ? openAskedFacts(current) : [];
      if (open[0]) await patchBook((b) => withFactMarks(b, "skippedFacts", [open[0]!]));
    }
    if (turn.redraw) {
      const target: GuideTarget = { kind: "person", castId: turn.redraw.castId, name: turn.redraw.name };
      const key = await offerRedraw(target, turn.redraw.instruction, turn.redraw.mode);
      // The skill said "tap redraw when you're ready"; say what actually happened instead.
      const rest = beats.filter((b) => b.key !== "redrawReady");
      beats.length = 0;
      beats.push(...rest, redrawBeat(key, target, "result"));
      set({ chip: null });
    }
    set((state) => ({
      agentWell: turn.well,
      agentPending: turn.pending,
      ...(turn.view ? { view: turn.view, chip: chipForView(state.chip, turn.view) } : {}),
    }));
    await speak(beats, receipt, turn.well ? agentWellTopic(turn.well) : undefined);
    if (turn.entry) {
      await get().chooseEntry(turn.entry);
      return;
    }
    if (!turn.holdsFloor && !turn.undo) await afterTurn(null);
  }

  /** "Undo that": take back the newest reader turn that changed the book, before this one. */
  async function undoLastSkillTurn(): Promise<boolean> {
    const messages = get().session.messages;
    const last = messages.findLastIndex((m) => m.role === "reader");
    const target = messages.slice(0, Math.max(0, last)).findLast((m) => m.role === "reader" && (m.before || m.restore));
    if (!target) return false;
    set({ sending: false });
    await get().undo(target.id);
    return true;
  }

  async function answerQuestion(question: string): Promise<void> {
    const project = live();
    if (!project) return;
    const config = agentConfig();
    const locale = chatLocaleOf(project);
    const transcript = guideTranscriptWindow(get().session, 6)
      .map((turn) => `${turn.role === "reader" ? "Reader" : "Guide"}: ${turn.text}`)
      .join("\n");
    try {
      const answer = await guideAnswerRemote(project, {
        question,
        language: `${getBookLanguage(locale).endonym} (${locale})`,
        locale,
        transcript,
        guidePreference: useGuidePreference.getState().preference,
      });
      const problems = validateComposed(answer.text, {
        meaning: "",
        mustSay: [],
        question: false,
        style: config.style.answers,
        persona: config.persona,
        locale,
        kind: "answer",
      });
      if (answer.text.trim() && problems.length === 0) {
        append(guideMessage("guide", answer.text.trim(), { keys: [answer.grounded ? "answer" : "answerUnsure"] }));
        return;
      }
    } catch {
      // The fallback line below.
    }
    await speak([{ key: "answerFallback", priority: "answer" }]);
  }

  async function routePictureChange(message: string, project: Project, cast: TargetPerson[]): Promise<void> {
    const chip = get().chip;
    const resolution = resolveGuideTarget({ sentence: message, chip, cast });
    // "Go back to the earlier picture" is not a change to draw: it is a free
    // step through the history, so it never reaches the redraw below.
    if (asksForEarlierPicture(message)) {
      const person = resolution.kind === "target" && resolution.target.kind === "person" ? resolution.target.name : "";
      const call: CommandCall = {
        id: "restorePicture",
        args: person ? { person } : {},
        evidence: message,
        confidence: 1,
        source: "model",
      };
      await runAgentCalls([call], [], undefined);
      return;
    }
    if (resolution.kind === "ask") {
      set({ pendingTarget: { instruction: message, people: resolution.people } });
      get().say([{ key: "whichName", priority: "blocking" }]);
      return;
    }
    if (resolution.kind === "none") {
      get().say([{ key: "whichName", priority: "blocking" }]);
      return;
    }
    await commitRedraw(project, resolution.target, message);
  }

  async function commitRedraw(project: Project, target: GuideTarget, instruction: string): Promise<void> {
    // "Start over" asks for a new picture; anything else changes the one that is there.
    const mode: RedrawMode | undefined = asksForNewPicture(instruction) ? "new" : undefined;
    // A bare "start over" describes nothing, so nothing is kept on the person.
    const change = isBareRestart(instruction) ? "" : instruction;
    if (target.kind === "person" && change) {
      // The change belongs to that person's plate, so the portrait redraws
      // from it and every later picture of them follows.
      await patchBook((b) => {
        const brief = briefOf(b.config);
        const cast = (brief.cast ?? []).map((m) =>
          m.id === target.castId ? { ...m, portraitNote: [m.portraitNote, change].filter(Boolean).join("; ").slice(0, 400) } : m,
        );
        return { ...b, config: { ...b.config, storyBrief: { ...brief, cast } } };
      });
    }
    const key = await offerRedraw(target, change, mode);
    get().say([redrawBeat(key, target, "answer")]);
    void project;
  }

  /**
   * A picture change the reader typed: start it when it is cheap and affordable
   * (`typedPictures`), otherwise leave the priced button. Returns the line that
   * says which happened.
   */
  async function offerRedraw(target: GuideTarget, instruction: string, mode?: RedrawMode): Promise<GuideLineKey> {
    const { autoStartRedraw } = await import("./typedPictures");
    const request: RedrawRequest = { target, instruction, ...(mode ? { mode } : {}) };
    const outcome = await autoStartRedraw(request).catch(() => "declined" as const);
    if (outcome === "started") return "redrawStarting";
    set({ redraw: request });
    return outcome === "needsSparks" ? "redrawNeedSparks" : "redrawReady";
  }

  function redrawBeat(key: GuideLineKey, target: GuideTarget, priority: Beat["priority"]): Beat {
    const subject = pictureSubject(target);
    return { key, priority, vars: { names: subject }, ...(target.kind === "person" ? { mustSay: [target.name] } : {}) };
  }
});

/** Reader messages that keep an undo snapshot. Older ones keep only their fact patch. */
const RESTORES_KEPT = 5;

/** A typed yes or no to an open confirmation, in the languages the chat speaks most. */
export function typedConfirmation(message: string): "yes" | "no" | null {
  const text = message.trim().toLowerCase().replace(/[.!?,\s]+$/u, "");
  if (/^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|ja|jo|jap|klar|mach|mach das|mach es|ja bitte|oui|sí|si|sim|tak|evet|da)$/u.test(text)) {
    return "yes";
  }
  if (/^(no|nope|cancel|stop|don't|dont|nein|nee|abbrechen|lieber nicht|non|não|nao|nie|hayır)$/u.test(text)) return "no";
  return null;
}

/**
 * One short line when something changed or needs attention since the reader
 * last had the book open; null when nothing did.
 */
function awaySummary(project: Project, since: number): string | null {
  const w = wording();
  const parts: string[] = [];
  const brief = briefOf(project.config);
  if (project.config.storyText.trim() && (brief.generatedAt ?? 0) > since) parts.push(guideCopy(w, "awayStory"));
  const portraits = namedCast(brief).filter((m) => (currentPortrait(project, m.id)?.createdAt ?? 0) > since);
  if (portraits.length > 0) {
    parts.push(guideCopy(w, "awayPortraits", { names: portraits.map((m) => m.name.trim()) }));
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Quotes survive a round trip to buy Sparks or sign in (same tab), so the
 * reader comes back to the same estimate rather than a new one.
 */
function keptQuote(projectId: string, key: string): GenerationQuote | null {
  try {
    const raw = window.sessionStorage.getItem(`guide:quote:${projectId}:${key}`);
    if (!raw) return null;
    const quote = JSON.parse(raw) as GenerationQuote;
    return quote.projectId === projectId && quote.expiresAt > Date.now() + 60_000 ? quote : null;
  } catch {
    return null;
  }
}

function keepQuote(projectId: string, key: string, quote: GenerationQuote | null): void {
  try {
    const id = `guide:quote:${projectId}:${key}`;
    if (quote) window.sessionStorage.setItem(id, JSON.stringify(quote));
    else window.sessionStorage.removeItem(id);
  } catch {
    // Storage blocked: a fresh estimate is fetched instead.
  }
}

/**
 * The quote now held for checkout keeps its price longer; the kept copy has to
 * say so, or the return would fetch (and show) a fresh price instead.
 */
export function holdKeptQuote(key: string, quote: GenerationQuote, expiresAt: number): void {
  keepQuote(quote.projectId, key, { ...quote, expiresAt });
}

const RESUME_DRAW_KEY = "guide:resumeDraw";
const RESUME_DRAW_MS = 2 * 60 * 60_000;

/** A paid return from checkout: start the action this quote named once affordable. */
export function rememberResumeDraw(quoteId: string): void {
  try {
    window.sessionStorage.setItem(RESUME_DRAW_KEY, JSON.stringify({ quoteId, at: Date.now() }));
  } catch {
    // Storage blocked: the reader taps the button themselves.
  }
}

/** Whether this quote should start by itself now; consumed when it says yes. */
export function takeResumeDraw(quoteId: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(RESUME_DRAW_KEY);
    if (!raw) return false;
    const entry = JSON.parse(raw) as { quoteId?: string; at?: number };
    if (typeof entry.at !== "number" || Date.now() - entry.at > RESUME_DRAW_MS) {
      window.sessionStorage.removeItem(RESUME_DRAW_KEY);
      return false;
    }
    if (entry.quoteId !== quoteId) return false;
    window.sessionStorage.removeItem(RESUME_DRAW_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Quote key for a set of units: the button and its stored quote share it. */
/** What a tap's run may report: it started paid work, and what the guide adds about it. */
export interface TapOutcome {
  spent?: boolean;
  reply?: GuideLineCandidate[];
}

function tapOutcomeOf(value: unknown): TapOutcome {
  if (!value || typeof value !== "object") return {};
  const { spent, reply } = value as TapOutcome;
  return { spent: spent === true, reply: Array.isArray(reply) ? reply : undefined };
}

export function quoteKey(purpose: string, units: readonly GenerationQuoteUnit[], extra = ""): string {
  const ids = units.map((unit) => (unit.refs === undefined ? unit.id : `${unit.id}~${unit.refs}`));
  return `${purpose}:${ids.join(",")}${extra ? `:${extra}` : ""}`;
}

/** The line text for a message in the chat language, once phrased. */
export function messageText(message: GuideMessage, locale: string): string {
  return message.localized?.locale === locale ? message.localized.text : message.text;
}

export type { GuideLineKey, GuideCopyVars };
