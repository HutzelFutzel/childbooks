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
import { quoteUnitIds } from "../core/billing/generationQuote";
import { getBookLanguage } from "../core/config/bookLanguages";
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
import { journeyEntry, openAskedFacts, readyToDraft, type BookViewId } from "../core/guide/journey";
import { classifyOpeningText } from "../core/guide/manuscript";
import { applyGuidePatch, guidePatchContext } from "../core/guide/patch";
import { authoringOf, withAuthoring, withFactMarks } from "../core/guide/projectState";
import {
  appendGuideMessage,
  createGuideSession,
  guideMessage,
  guideTranscriptWindow,
  rewoundGuideSession,
  type GuideMessage,
  type GuideReceipt,
  type GuideSession,
} from "../core/guide/session";
import { GUIDE_SLOTS, type GuideSlotId } from "../core/guide/slots";
import { acceptGuideQuestion, arbitrateGuideLines, needsGuideSpeech, type GuideLineCandidate } from "../core/guide/speech";
import { resolveGuideTarget, type GuideTarget, type TargetPerson } from "../core/guide/target";
import { currentPortrait } from "../core/guide/portrait";
import {
  briefOf,
  isBriefReady,
  namedCast,
  storyBriefSignature,
  withGuidedBriefIfMissing,
  createDefaultStoryBrief,
} from "../core/story/brief";
import type { GuideEntry, Project } from "../core/types";
import { guideAskNextRemote, guideSpeakRemote, reportGuideTurnOutcomeRemote, storyDraftRemote } from "../platform/aiClient";
import { useGuidePreference } from "../ui/guide/guidePreference";
import { useAppConfigStore } from "./appConfigStore";
import { quoteFor } from "./chatGeneration";
import { sendGuideTurn } from "./guideTurn";
import { useProjectsStore } from "./projectsStore";
import { startStoryRevision } from "../platform/storyRevisions";
import { getRepos } from "./repos";

const TRANSCRIPT_WINDOW = 8;
/** A quote closer than this to expiry is renewed before a job is started against it. */
const QUOTE_START_MARGIN_MS = 10 * 60_000;

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
  pendingTarget: PendingTarget | null;
  redraw: RedrawRequest | null;
  quotes: Record<string, QuoteSlot>;
  /** Quote key whose paid action is being started. */
  starting: string | null;
  /** The reopen summary, shown once per open when something changed. */
  away: string | null;
  /** The first blocking print problem, reported by the book pane's preflight. */
  printIssue: { unitId: string; page: number | null; message: string } | null;
  /** Story analysis (who is in it) is running for the text on screen. */
  analysisRunning: boolean;
  /** Own-words cast extraction is running. */
  extractionRunning: boolean;
  /** Last own-words extraction failure. Kept visible until retry or story change. */
  extractionError: string | null;
  /** A message that might be a story or an idea, waiting for the reader to say. */
  pendingManuscript: string | null;
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
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  undo: (messageId: string) => Promise<void>;
  skipFact: (fact: GuideFactId) => Promise<void>;
  retryStory: () => Promise<void>;
  say: (candidates: GuideLineCandidate[], extra?: { marks?: string[]; receipt?: GuideReceipt }) => string | undefined;
  /** Whether a line (or a marker saved with one) was already said on this book. */
  said: (mark: string) => boolean;
  setView: (view: BookViewId | null) => void;
  setChip: (target: GuideTarget | null) => void;
  setFocus: (focus: boolean) => void;
  chooseTargetPerson: (person: TargetPerson) => Promise<void>;
  clearRedraw: () => void;
  ensureQuote: (key: string, purpose: GenerationQuote["purpose"], units: GenerationQuoteUnit[]) => Promise<void>;
  /** Tap a paid button: start exactly the quoted batch, once. */
  confirm: (key: string, start: (quote: GenerationQuote) => Promise<boolean | void>) => Promise<void>;
  setChatLocale: (locale: string) => Promise<void>;
  /** Own words: the reader asked the guide for something, so the composer shows. */
  askGuide: () => Promise<void>;
  dismissAway: () => void;
}

// --- Book-side helpers --------------------------------------------------------

function policies(): GuideFactPolicies {
  return useAppConfigStore.getState().guide.facts;
}

function wording() {
  return useAppConfigStore.getState().guide.wording;
}

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

/** Children who still have no age. A same-age group is listed together. */
function ageQuestionNames(project: Project): string[] {
  const missing = namedCast(briefOf(project.config))
    .filter((m) => m.age === undefined && m.ageMonths === undefined)
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

function describeOpenFacts(project: Project, missing: readonly GuideFactId[]): string {
  return missing
    .map((id) => {
      if (id !== "ages") return `- ${id}: ${GUIDE_FACTS[id].label}. ${GUIDE_FACTS[id].help}`;
      const names = joinGuideNames(ageQuestionNames(project));
      const groups = (authoringOf(project).sameAge ?? []).map((group) => group.join(" and ")).join("; ");
      return `- ages: still need an age for ${names || "the children"}${groups ? `. Same age: ${groups}` : ""}`;
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
  return (Object.keys(GUIDE_FACTS) as GuideFactId[]).filter((id) => slots.includes(GUIDE_FACTS[id].slot));
}

// --- Story draft ------------------------------------------------------------

/**
 * The run whose result may still land. A newer detail starts a newer run;
 * the older one is dropped when it finishes, however late.
 */
let storyToken = 0;

async function draftStory(): Promise<void> {
  const project = live();
  if (!project) return;
  const brief = briefOf(project.config);
  // A pasted manuscript is the story. Drafting would replace the reader's words.
  if (journeyEntry(project) === "own" || brief.mode === "own") return;
  if (!isBriefReady(brief)) return;
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
        { storyRun: { signature, startedAt, status: "done" } },
      ),
    );
    useChatStudio.getState().say([{ key: "storyReady", priority: "result" }]);
  } catch (err) {
    if (token !== storyToken) return;
    await patchBook((p) =>
      authoringOf(p).storyRun?.startedAt === startedAt
        ? withAuthoring(p, { storyRun: { signature, startedAt, status: "failed", error: describeError(err) } })
        : p,
    );
    useChatStudio.getState().say([{ key: "storyFailed", priority: "blocking" }]);
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

  const localize = (messageId: string, meaning: string, names: string[]): void => {
    const project = live();
    if (!project) return;
    const locale = chatLocaleOf(project);
    if (!needsGuideSpeech(locale)) return;
    const language = `${getBookLanguage(locale).endonym} (${locale})`;
    void guideSpeakRemote({
      projectId: project.id,
      language,
      names,
      lines: [{ id: "line", meaning }],
      guidePreference: useGuidePreference.getState().preference,
    })
      .then(({ lines }) => {
        const text = lines.line?.trim();
        if (!text || text === meaning) return;
        set((state) => ({
          session: {
            ...state.session,
            messages: state.session.messages.map((m) =>
              m.id === messageId ? { ...m, localized: { locale, text } } : m,
            ),
          },
        }));
        persist();
      })
      .catch(() => {});
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

    if (storyRunSuperseded(project)) {
      void draftStory();
    } else if (readyToDraft(project, p, { clarificationOpen })) {
      // Confirm-once facts are said with the start of the work they confirm.
      for (const fact of factsToConfirm(project, p)) {
        if (fact === "readingAge") {
          const first = namedCast(briefOf(project.config))[0];
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
        lines.push({
          key: names.length > 1 ? "missingAgesMany" : "missingAges",
          priority: "question",
          vars: { names },
        });
        await patchBook((b) => withFactMarks(b, "askedFacts", ["ages"]));
      }
    } else if (
      journeyEntry(project) === "own" &&
      !project.config.storyText.trim() &&
      !get().said("ownWordsOpen")
    ) {
      lines.push({ key: "ownWordsOpen", priority: "question" });
    }
    const followUp = lines.some(
      (line) => line.key === "missingNames" || line.key === "missingAges" || line.key === "missingAgesMany",
    );
    const transcript = guideTranscriptWindow(get().session, 8)
      .map((turn) => `${turn.role === "reader" ? "Reader" : "Guide"}: ${turn.text}`)
      .join("\n");
    const learned = receipt?.parts.map((part) => part.value).join(" · ") ?? "";
    let messageId: string | undefined;
    if (lines.length > 0 || receipt) messageId = get().say(lines, { marks, ...(receipt ? { receipt } : {}) });
    if (messageId && followUp) refineNextLine(messageId, project, transcript, learned);
  };

  const refineNextLine = (messageId: string, project: Project, transcript: string, learned: string): void => {
    const p = policies();
    const missing = missingGuideFacts(project, p);
    const locale = chatLocaleOf(project);
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
        if (!current) return;
        const stillMissing = missingGuideFacts(current, policies());
        if (
          !acceptGuideQuestion({
            text: result.text,
            asks: result.asks,
            missing: stillMissing,
            requiredMissing: stillMissing.filter((id) => policies()[id].required),
            ageNames: ageQuestionNames(current),
            sameAgeGroups: authoringOf(current).sameAge ?? [],
          })
        ) {
          return;
        }
        set((state) => ({
          session: {
            ...state.session,
            messages: state.session.messages.map((message) =>
              message.id === messageId ? { ...message, text: result.text, localized: undefined } : message,
            ),
          },
        }));
        persist();
      })
      .catch(() => {});
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

    setPrintIssue: (issue) => {
      const current = get().printIssue;
      if (current?.unitId === issue?.unitId && current?.message === issue?.message) return;
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

    keepManuscript: async (text) => {
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
          { entry: "own", chatLocale: authoringOf(book).chatLocale ?? book.config.contentLocale },
        );
      });
      set({ pendingManuscript: null, view: "story", sending: false });
      get().say([{ key: "keptStory", priority: "result" }]);
    },

    useManuscriptAsIdea: async () => {
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
    },

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
        pendingTarget: null,
        redraw: null,
        quotes: {},
        starting: null,
        away: null,
        pendingManuscript: null,
        extractionRunning: false,
        extractionError: null,
        analysisRunning: false,
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
          if (!state.sparksNoticeAt) {
            append(guideMessage("guide", guideCopy(wording(), "sparksNotice"), { keys: ["sparksNotice"] }));
            await patchBook((b) => withAuthoring(b, { sparksNoticeAt: Date.now() }));
          }
          get().say([{ key: "opening", priority: "question" }], { marks: ["broadQuestion"] });
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
        pendingTarget: null,
        redraw: null,
        quotes: {},
        extractionError: null,
      });
    },

    chooseEntry: async (entry) => {
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
    },

    send: async (text) => {
      const message = text.trim();
      const { projectId, sending, loaded } = get();
      if (!projectId || !loaded || !message || sending) return;
      const project = live();
      if (!project) return;

      const history = guideTranscriptWindow(get().session, TRANSCRIPT_WINDOW);
      append(guideMessage("reader", message));
      set({ sending: true, error: null });

      const locked = Boolean(authoringOf(project).lockedAt);
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
        await interpretMessage(message, history, project, { cast });
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
    },

    retry: async () => {
      const { session } = get();
      const last = session.messages[session.messages.length - 1];
      if (!last || last.role !== "reader" || !last.failed) return;
      set((state) => ({ session: { ...state.session, messages: state.session.messages.slice(0, -1) }, error: null }));
      await get().send(last.text);
    },

    undo: async (messageId) => {
      const { session, sending } = get();
      if (sending) return;
      const target = session.messages.find((m) => m.id === messageId);
      if (!target) return;
      if (target.before) {
        const { audience, artStyles, storyCraft } = useAppConfigStore.getState();
        const context = guidePatchContext({ audience, artStyles, storyCraft });
        await patchBook((b) => applyGuidePatch(b, target.before!, context).project);
        set({ session: rewoundGuideSession(get().session, messageId) });
      } else {
        const index = session.messages.findIndex((m) => m.id === messageId);
        set({ session: { ...session, messages: session.messages.slice(0, Math.max(0, index)) } });
      }
      persist();
    },

    skipFact: async (fact) => {
      await patchBook((b) => withFactMarks(b, "skippedFacts", [fact]));
      await afterTurn(null);
    },

    retryStory: async () => {
      await draftStory();
    },

    say: (candidates, extra = {}) => {
      const utterance = arbitrateGuideLines(candidates, wording());
      if (!utterance && !extra.receipt) return;
      const marks = [...(utterance?.keys ?? []), ...(extra.marks ?? [])];
      const text =
        utterance?.meaning ??
        extra.receipt!.parts.map((part) => part.value).join(" · ");
      const message = guideMessage("guide", text, {
        keys: utterance ? marks : ["receipt", ...marks],
        ...(extra.receipt ? { receipt: extra.receipt } : {}),
      });
      append(message);
      if (utterance) localize(message.id, utterance.meaning, utterance.names);
      return message.id;
    },

    said: (mark) => get().session.messages.some((m) => m.role === "guide" && m.keys?.includes(mark)),

    setView: (view) => set({ view }),

    setChip: (target) => set({ chip: target, pendingTarget: null }),

    setFocus: (focus) => set({ focus }),

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
      set({ starting: key });
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
    },

    dismissAway: () => set({ away: null }),
  };

  async function interpretMessage(
    message: string,
    history: ReturnType<typeof guideTranscriptWindow>,
    project: Project,
    options: { forceBrief?: boolean; cast?: TargetPerson[] } = {},
  ): Promise<void> {
    const cast = options.cast ?? namedCast(briefOf(project.config)).map((m) => ({ id: m.id, name: m.name.trim() }));
    const firstTurn = !journeyEntry(project);
    let inferredEntry: GuideEntry | null = null;
    const outcome = await sendGuideTurn(message, history);
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
    await patchBook((b) =>
      withFactMarks(withFactMarks(b, "answeredFacts", [...answered, ...openOptional]), "skippedFacts", skipped),
    );

    if (outcome.applied.length > 0) {
      set((state) => {
        const messages = [...state.session.messages];
        const index = messages.findLastIndex((m) => m.role === "reader");
        if (index >= 0) messages[index] = { ...messages[index]!, before: outcome.before };
        return { session: { ...state.session, messages } };
      });
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

  async function routePictureChange(message: string, project: Project, cast: TargetPerson[]): Promise<void> {
    const chip = get().chip;
    const resolution = resolveGuideTarget({ sentence: message, chip, cast });
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
    if (target.kind === "person") {
      // The change belongs to that person's plate, so the portrait redraws
      // from it and every later picture of them follows.
      await patchBook((b) => {
        const brief = briefOf(b.config);
        const cast = (brief.cast ?? []).map((m) =>
          m.id === target.castId ? { ...m, portraitNote: [m.portraitNote, instruction].filter(Boolean).join("; ").slice(0, 400) } : m,
        );
        return { ...b, config: { ...b.config, storyBrief: { ...brief, cast } } };
      });
    }
    set({ redraw: { target, instruction } });
    get().say([{ key: "redrawReady", priority: "answer" }]);
    void project;
  }
});

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
export function quoteKey(purpose: string, units: readonly GenerationQuoteUnit[], extra = ""): string {
  return `${purpose}:${quoteUnitIds({ units: [...units] }).join(",")}${extra ? `:${extra}` : ""}`;
}

/** The line text for a message in the chat language, once phrased. */
export function messageText(message: GuideMessage, locale: string): string {
  return message.localized?.locale === locale ? message.localized.text : message.text;
}

export type { GuideLineKey, GuideCopyVars };
