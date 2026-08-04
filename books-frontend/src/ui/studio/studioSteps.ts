/**
 * The guided studio flow:
 *
 *   Primary:  Story → Design → Order
 *   Design:   Cast (characters & places) → Pages (layout & art)
 *
 * Cast and Pages are substeps under Design (not peer top-level steps). Pages
 * stays locked until cast references are complete. Internal `StudioStep` ids
 * stay `anchors` / `edit` so stage components and stores don't rename.
 */
import type { Project } from "../../core/types";
import { currentAnchorImage, currentIllustration } from "../../state/ai";
import { illustrationUnits } from "../../state/bookUnits";

/** Concrete stage shown in the workspace. */
export type StudioStep = "story" | "anchors" | "edit" | "order";

/** Top-level rail destinations. */
export type PrimaryStep = "story" | "design" | "order";

/** Substeps under Design. */
export type DesignSubstep = "cast" | "pages";

export const PRIMARY_STEPS: PrimaryStep[] = ["story", "design", "order"];

export const DESIGN_SUBSTEPS: DesignSubstep[] = ["cast", "pages"];

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
  /** Cast substep (characters & places). */
  anchors: StepProgress;
  /** Pages substep (layout & illustration). */
  edit: StepProgress;
  /** Aggregated Design primary (cast + pages). */
  design: StepProgress;
  order: StepProgress;
  /** Convenience counts reused by several surfaces. */
  anchorsTotal: number;
  anchorsReady: number;
  pagesTotal: number;
  pagesReady: number;
}

export function primaryOf(step: StudioStep): PrimaryStep {
  if (step === "anchors" || step === "edit") return "design";
  return step;
}

export function designSubstepOf(step: StudioStep): DesignSubstep | null {
  if (step === "anchors") return "cast";
  if (step === "edit") return "pages";
  return null;
}

export function stepForDesignSubstep(sub: DesignSubstep): StudioStep {
  return sub === "cast" ? "anchors" : "edit";
}

/** Where Design should open: Cast until references are done, then Pages. */
export function preferredDesignStep(project: Project): StudioStep {
  return computeProgress(project).anchors.done ? "edit" : "anchors";
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

  const cast: StepProgress = {
    unlocked: setupDone,
    done: anchorsDone,
    detail: anchorsTotal > 0 ? `${anchorsReady} / ${anchorsTotal}` : undefined,
    ratio: anchorsTotal > 0 ? anchorsReady / anchorsTotal : anchorsDone ? 1 : 0,
  };

  const pages: StepProgress = {
    // Pages stay locked until cast references are finished (and the screenplay exists).
    unlocked: setupDone && anchorsDone && hasScreenplay,
    done: editDone,
    detail: pagesTotal > 0 ? `${pagesReady} / ${pagesTotal}` : undefined,
    ratio: pagesTotal > 0 ? pagesReady / pagesTotal : 0,
  };

  const design: StepProgress = {
    unlocked: setupDone,
    done: editDone,
    detail: !anchorsDone && cast.detail ? cast.detail : pages.detail,
    ratio: (cast.ratio + pages.ratio) / 2,
  };

  return {
    story: {
      unlocked: true,
      done: setupDone,
      ratio: setupDone ? 1 : 0,
    },
    anchors: cast,
    edit: pages,
    design,
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
  // Don't skip past Cast: reopening a book whose references aren't finished
  // lands on Cast, not on a Pages canvas full of subjects with no look refs.
  return preferredDesignStep(project);
}
