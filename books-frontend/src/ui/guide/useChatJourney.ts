"use client";

/**
 * Where this book is, and what the composer well holds, from the book and its
 * live jobs. Nothing here is stored: a refresh, a second device or a job that
 * finished while the page was closed all land in the same place.
 */
import { useMemo } from "react";
import { authoringOf } from "../../core/guide/projectState";
import { BOOK_CHOICE_KINDS, deriveJourney, styleChoiceOpen, type Journey, type WellItem } from "../../core/guide/journey";
import { composerForChoice } from "../../core/guide/activity";
import type { HardcoverCheck } from "../../core/guide/hardcover";
import type { Project } from "../../core/types";
import { briefOf, namedCast } from "../../core/story/brief";
import { staleIllustrationSpreadIds } from "../../state/ai";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import {
  hardcoverFor,
  planIsCurrent,
  planRunning,
} from "../../state/chatPipeline";
import { useChatStudio, type PendingTarget, type RedrawRequest } from "../../state/chatStudio";
import type { AgentWell } from "../../state/guideAgent";
import { useJobsStore } from "../../state/jobsStore";
import { usePortraitStartStore } from "../../state/portraitAutoStart";
import type { AgentWellItem } from "./chat/AgentWells";

/** Everything the well can hold: the journey's item, or a change waiting on the reader. */
export type ChatWell =
  | WellItem
  | { kind: "extractionRetry"; error: string }
  | { kind: "styleChoice" }
  | { kind: "drawingAssign"; people: { id: string; name: string }[] }
  | { kind: "whichName"; pending: PendingTarget }
  | { kind: "redraw"; request: RedrawRequest }
  | { kind: "manuscriptChoice" }
  | AgentWellItem;

/** The story's own questions: asked before how anyone looks, and before the book's style. */
const STORY_FIRST: ReadonlySet<string> = new Set([
  "storyDone",
  "castFix",
  "storyRetry",
  "audienceConfirm",
  "castAges",
  "pictureNotes",
  "storyBrief",
  "lookAlike",
  "castLooks",
]);

/** The questions about the people. With the reader's own words they wait for the book's shape and cover words. */
const PEOPLE_QUESTIONS: ReadonlySet<string> = new Set([
  "castAges",
  "audienceConfirm",
  "pictureNotes",
  "lookAlike",
  "castLooks",
  "portraits",
]);

export interface ChatJourney extends Journey {
  hardcover: HardcoverCheck | null;
  /** Every question open now, in the order they are asked (`cardDeck.ts` picks the one on screen). */
  pool: ChatWell[];
  /** A card answering what the reader just did, or a failed reading: shown beside the one on screen. */
  reply: ChatWell | null;
  planRunning: boolean;
  /** The reply, else the first question in line. */
  chatWell: ChatWell | null;
  /** Whether the message field shows while this well (or none) is on screen. */
  composerFor: (wellKind: string | null) => boolean;
  activeUnitIds: ReadonlySet<string>;
  failedUnits: Readonly<Record<string, { error: string }>>;
  stalePages: readonly string[];
}

export function useChatJourney(project: Project): ChatJourney {
  const policies = useAppConfigStore((s) => s.guide.facts);
  const brief = useAppConfigStore((s) => s.guide.brief);
  const audience = useAppConfigStore((s) => s.audience);
  const jobUnitIds = useJobsStore((s) => s.activeUnitIds);
  const startedPortraits = usePortraitStartStore((s) => s.started);
  const portraitsDeciding = usePortraitStartStore((s) => s.deciding > 0);
  // A portrait started from a choice counts as drawing before its task arrives.
  const activeUnitIds = useMemo(() => {
    const started = Object.keys(startedPortraits);
    if (started.length === 0) return jobUnitIds;
    return new Set([...jobUnitIds, ...started]);
  }, [jobUnitIds, startedPortraits]);
  const failedUnits = useJobsStore((s) => s.failedUnits);
  const screenplayJob = useJobsStore((s) => s.screenplayJob);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const pendingTarget = useChatStudio((s) => s.pendingTarget);
  const redraw = useChatStudio((s) => s.redraw);
  const printIssue = useChatStudio((s) => s.printIssue);
  const extractionRunning = useChatStudio((s) => s.extractionRunning);
  const analysisRunning = useChatStudio((s) => s.analysisRunning);
  const extractionError = useChatStudio((s) => s.extractionError);
  const pendingManuscript = useChatStudio((s) => s.pendingManuscript);
  const starting = useChatStudio((s) => s.starting);
  const agentWell = useChatStudio((s) => s.agentWell);

  const result = useMemo(() => {
    const hardcover = hardcoverFor(project);
    const running = planRunning(project);
    const locked = Boolean(project.authoringState?.lockedAt);
    const stalePages = locked ? staleIllustrationSpreadIds(project) : [];
    const journey = deriveJourney(project, policies, {
      activeUnitIds,
      failedUnits,
      stalePages,
      planRunning: running,
      planReady: planIsCurrent(project),
      analysisRunning,
      clarificationOpen: Boolean(pendingTarget),
      guest: accessLevel === "guest",
      hardcover,
      printIssue,
      drawPhase: authoringOf(project).drawBook?.phase ?? null,
      brief,
      audience,
    });
    const authoring = authoringOf(project);
    const planError =
      screenplayJob?.status === "error" &&
      (!project.screenplay || authoring.planRequestedFor === screenplayJob.id)
        ? screenplayJob.error ?? "The page plan could not be prepared."
        : null;
    const pipelineError = extractionError ?? planError;
    const stagedDrawing = Boolean(authoring.styleSourceArt?.length);
    const drawingAssign =
      stagedDrawing &&
      !authoring.styleSourceOnly &&
      project.config.styleReady === true &&
      !extractionRunning &&
      !analysisRunning &&
      !journey.locked
        ? {
            kind: "drawingAssign" as const,
            people: namedCast(briefOf(project.config)).map((member) => ({
              id: member.id,
              name: member.name.trim(),
            })),
          }
        : null;
    const agent = agentWellItem(agentWell, journey.well, hardcover, accessLevel === "guest");
    // The story's own questions come first, then how each person looks, and
    // only then the book's style (see `styleChoiceOpen`).
    const lookOpen = styleChoiceOpen(project, journey);
    // "Skip" only ever sat under the broad opening question, where any reply answers it.
    // The portraits button waits while a choice decides whether it starts them itself.
    const bookChoicesOpen = journey.open.some((item) => BOOK_CHOICE_KINDS.has(item.kind));
    const open = journey.open.filter(
      (item) =>
        item.kind !== "skipFact" &&
        !(portraitsDeciding && item.kind === "portraits") &&
        // The people wait behind the book's shape and cover words, whatever
        // else moves: a question about them never takes a card's place.
        !(journey.entry === "own" && bookChoicesOpen && PEOPLE_QUESTIONS.has(item.kind)),
    );
    // The choices open now, in the order they are asked. The story's own
    // questions come first, then how each person looks, and only then the
    // book's style (see `styleChoiceOpen`). With the reader's own words, the
    // format, layout and cover words come before the people: they don't wait
    // for the reading.
    const leading = (item: ChatWell): boolean =>
      STORY_FIRST.has(item.kind) || (journey.entry === "own" && BOOK_CHOICE_KINDS.has(item.kind));
    const split = open.findIndex((item) => !leading(item));
    const at = split === -1 ? open.length : split;
    const pool: ChatWell[] = [
      ...open.slice(0, at),
      ...(drawingAssign ? [drawingAssign] : []),
      ...(lookOpen ? [{ kind: "styleChoice" as const }] : []),
      ...open.slice(at),
    ];
    // Cards that answer what the reader just did, or a reading that failed.
    // They show beside the card on screen, never in its place.
    const reply: ChatWell | null = pendingManuscript
      ? { kind: "manuscriptChoice" }
      : pendingTarget
        ? { kind: "whichName", pending: pendingTarget }
        : agent
          ? agent
          : redraw
            ? { kind: "redraw", request: redraw }
            : pipelineError && !journey.locked
              ? { kind: "extractionRetry", error: pipelineError }
              : null;
    const chatWell: ChatWell | null = reply ?? pool[0] ?? null;
    const composerFor = (wellKind: string | null): boolean =>
      !starting &&
      wellKind !== "extractionRetry" &&
      composerForChoice({
        entry: journey.entry,
        ownComposer: authoring.ownComposer === true,
        handedOver: journey.handedOver,
        wellKind,
      });
    return {
      ...journey,
      composer: composerFor(chatWell?.kind ?? null),
      composerFor,
      hardcover,
      pool,
      reply,
      planRunning: running,
      chatWell,
      activeUnitIds,
      failedUnits,
      stalePages,
    };
    // screenplayJob is read inside planRunning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, policies, brief, audience, activeUnitIds, portraitsDeciding, failedUnits, screenplayJob, accessLevel, pendingTarget, redraw, printIssue, extractionRunning, analysisRunning, extractionError, pendingManuscript, starting, agentWell]);
  return result;
}

/** A well the chat's skills asked for; paid steps reuse the journey's own wells and their quotes. */
function agentWellItem(
  well: AgentWell | null,
  journeyWell: WellItem | null,
  hardcover: HardcoverCheck | null,
  guest: boolean,
): ChatWell | null {
  if (!well) return null;
  switch (well.kind) {
    case "agentPortraits":
      return { kind: "portraits", castIds: well.castIds, names: well.names, foundCast: false };
    case "agentDrawBook":
      return journeyWell?.kind === "drawBook" || journeyWell?.kind === "hardcoverChoice"
        ? journeyWell
        : { kind: "drawBook", pages: hardcover?.pages ?? 0 };
    case "agentSignIn":
      return guest ? { kind: "account", for: "drawBook" } : null;
    default:
      return well;
  }
}
