/**
 * The guided four-step flow that structures the whole studio:
 *
 *   1. Story   — write the story and pick style / audience / size
 *   2. Anchors — review characters & places and generate their references
 *   3. Edit    — lay out pages, generate art, refine text & design
 *   4. Order   — print at home or order a professionally printed book
 *
 * The rail navigation, the per-step center stage, and the sidebar/inspector all
 * read from this single model so the flow stays obvious and consistent.
 */
import type { Project } from "../../core/types";
import { currentAnchorImage, currentIllustration } from "../../state/ai";
import { illustrationUnits } from "../../state/bookUnits";

export type StudioStep = "story" | "anchors" | "edit" | "order";

export const STUDIO_STEPS: StudioStep[] = ["story", "anchors", "edit", "order"];

/** Status of a single step, used to render the rail. */
export type StepStatus = "locked" | "todo" | "active" | "in-progress" | "done";

export interface StepProgress {
  /** Whether the step can be opened yet (earlier prerequisites met). */
  unlocked: boolean;
  /** Whether the step's work is complete. */
  done: boolean;
  /** Short progress detail, e.g. "3 / 5". */
  detail?: string;
  /** 0..1 completion for the connecting progress bar. */
  ratio: number;
}

export interface StudioProgress {
  story: StepProgress;
  anchors: StepProgress;
  edit: StepProgress;
  order: StepProgress;
  /** Convenience counts reused by several surfaces. */
  anchorsTotal: number;
  anchorsReady: number;
  pagesTotal: number;
  pagesReady: number;
}

/**
 * Derive per-step progress from the live project. Kept pure so both the rail and
 * the stages can share exactly the same view of "what's done".
 */
export function computeProgress(project: Project): StudioProgress {
  const setupDone = project.stage === "studio";

  const anchors = (project.anchors ?? []).filter((a) => a.include);
  const anchorsTotal = anchors.length;
  const anchorsReady = anchors.filter((a) => currentAnchorImage(a)).length;
  // With no anchors at all, the step is trivially satisfied once analysis ran.
  const anchorsDone =
    setupDone && Boolean(project.analysis) && (anchorsTotal === 0 || anchorsReady === anchorsTotal);

  const units = illustrationUnits(project);
  const pagesTotal = units.length;
  const pagesReady = units.filter((u) => currentIllustration(project, u.id)).length;
  const hasScreenplay = Boolean(project.screenplay);
  const editDone = hasScreenplay && pagesTotal > 0 && pagesReady === pagesTotal;

  return {
    story: {
      unlocked: true,
      done: setupDone,
      ratio: setupDone ? 1 : 0,
    },
    anchors: {
      unlocked: setupDone,
      done: anchorsDone,
      detail: anchorsTotal > 0 ? `${anchorsReady} / ${anchorsTotal}` : undefined,
      ratio: anchorsTotal > 0 ? anchorsReady / anchorsTotal : anchorsDone ? 1 : 0,
    },
    edit: {
      unlocked: setupDone && hasScreenplay,
      done: editDone,
      detail: pagesTotal > 0 ? `${pagesReady} / ${pagesTotal}` : undefined,
      ratio: pagesTotal > 0 ? pagesReady / pagesTotal : 0,
    },
    order: {
      unlocked: editDone,
      done: false,
      ratio: 0,
    },
    anchorsTotal,
    anchorsReady,
    pagesTotal,
    pagesReady,
  };
}

/** The step the studio should open on for a given project state. */
export function initialStep(project: Project): StudioStep {
  if (project.stage === "setup") return "story";
  return "edit";
}
