"use client";

/**
 * Where this book is, and what the composer well holds, from the book and its
 * live jobs. Nothing here is stored: a refresh, a second device or a job that
 * finished while the page was closed all land in the same place.
 */
import { useMemo } from "react";
import { authoringOf } from "../../core/guide/projectState";
import { deriveJourney, styleChoiceOpen, type Journey, type WellItem } from "../../core/guide/journey";
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

export interface ChatJourney extends Journey {
  hardcover: HardcoverCheck | null;
  planRunning: boolean;
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

  return useMemo(() => {
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
    const storyFirst =
      journey.well && ["storyDone", "castFix", "storyRetry", "audienceConfirm", "castAges", "pictureNotes", "storyBrief", "lookAlike", "castLooks"].includes(journey.well.kind)
        ? journey.well
        : null;
    const lookOpen = styleChoiceOpen(project, journey);
    // "Skip" only ever sat under the broad opening question, where any reply answers it.
    // The portraits button waits while a choice decides whether it starts them itself.
    const journeyWell =
      journey.well?.kind === "skipFact" || (portraitsDeciding && journey.well?.kind === "portraits")
        ? null
        : journey.well;
    const chatWell: ChatWell | null = pendingManuscript
      ? { kind: "manuscriptChoice" }
      : pendingTarget
        ? { kind: "whichName", pending: pendingTarget }
        : agent
          ? agent
          : redraw
          ? { kind: "redraw", request: redraw }
          : pipelineError && !journey.locked
            ? { kind: "extractionRetry", error: pipelineError }
            : storyFirst ??
              drawingAssign ??
              (lookOpen ? { kind: "styleChoice" } : null) ??
              journeyWell;
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
      planRunning: running,
      chatWell,
      activeUnitIds,
      failedUnits,
      stalePages,
    };
    // screenplayJob is read inside planRunning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, policies, brief, audience, activeUnitIds, portraitsDeciding, failedUnits, screenplayJob, accessLevel, pendingTarget, redraw, printIssue, extractionRunning, analysisRunning, extractionError, pendingManuscript, starting, agentWell]);
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
