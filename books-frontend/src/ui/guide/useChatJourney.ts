"use client";

/**
 * Where this book is, and what the composer well holds, from the book and its
 * live jobs. Nothing here is stored: a refresh, a second device or a job that
 * finished while the page was closed all land in the same place.
 */
import { useMemo } from "react";
import { authoringOf } from "../../core/guide/projectState";
import { deriveJourney, type Journey, type WellItem } from "../../core/guide/journey";
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
import { useJobsStore } from "../../state/jobsStore";

/** Everything the well can hold: the journey's item, or a change waiting on the reader. */
export type ChatWell =
  | WellItem
  | { kind: "extractionRetry"; error: string }
  | { kind: "styleChoice" }
  | { kind: "drawingAssign"; people: { id: string; name: string }[] }
  | { kind: "whichName"; pending: PendingTarget }
  | { kind: "redraw"; request: RedrawRequest }
  | { kind: "manuscriptChoice" };

export interface ChatJourney extends Journey {
  hardcover: HardcoverCheck | null;
  planRunning: boolean;
  chatWell: ChatWell | null;
  activeUnitIds: ReadonlySet<string>;
  failedUnits: Readonly<Record<string, { error: string }>>;
  stalePages: readonly string[];
}

export function useChatJourney(project: Project): ChatJourney {
  const policies = useAppConfigStore((s) => s.guide.facts);
  const activeUnitIds = useJobsStore((s) => s.activeUnitIds);
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
    const castFix = journey.well?.kind === "castFix" ? journey.well : null;
    const chatWell: ChatWell | null = pendingManuscript
      ? { kind: "manuscriptChoice" }
      : pendingTarget
        ? { kind: "whichName", pending: pendingTarget }
        : redraw
          ? { kind: "redraw", request: redraw }
          : pipelineError && !journey.locked
            ? { kind: "extractionRetry", error: pipelineError }
            : castFix ??
              drawingAssign ??
              (project.config.styleReady === false && !journey.locked
                ? { kind: "styleChoice" }
                : journey.well);
    const composer =
      pendingManuscript || pendingTarget || redraw || pipelineError || starting
        ? false
        : journey.composer;
    return { ...journey, composer, hardcover, planRunning: running, chatWell, activeUnitIds, failedUnits, stalePages };
    // screenplayJob is read inside planRunning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, policies, activeUnitIds, failedUnits, screenplayJob, accessLevel, pendingTarget, redraw, printIssue, extractionRunning, analysisRunning, extractionError, pendingManuscript, starting]);
}
