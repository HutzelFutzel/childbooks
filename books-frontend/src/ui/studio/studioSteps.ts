/**
 * The guided studio flow:
 *
 *   Story → Style → Book (with optional Cast refinement) → Order
 *
 * The book becomes available as soon as Story and Style are ready. Cast images
 * remain part of the generation pipeline, but they no longer block someone
 * from seeing the screenplay and page layout.
 */
import type { Project } from "../../core/types";
import { currentAnchorImage, currentIllustration } from "../../state/ai";
import { illustrationUnits } from "../../state/bookUnits";

/** Concrete stage shown in the workspace. */
export type StudioStep = "story" | "anchors" | "edit" | "order";

/** Top-level rail destinations. */
export type PrimaryStep = "story" | "design" | "order";

/** Focused creation sections represented by the underlying studio states. */
export type DesignChapter = "style" | "cast" | "pages";

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

/**
 * Active Design chapter from step + style gate.
 * `styleReady === false` forces Style; reopen uses `styleSetupOpen`.
 * Legacy projects with `styleReady === undefined` skip the style gate.
 */
export function designChapterOf(
  step: StudioStep,
  styleReady: boolean | undefined,
  styleSetupOpen: boolean,
): DesignChapter {
  if (styleReady === false || styleSetupOpen) return "style";
  if (step === "edit") return "pages";
  return "cast";
}

/** Pages are home once the required art-style choice has been made. */
export function preferredDesignStep(project: Project): StudioStep {
  if (project.config.styleReady === false) return "anchors";
  return "edit";
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
    detail:
      anchorsTotal > 0
        ? anchorsReady > 0
          ? `${anchorsReady} / ${anchorsTotal}`
          : `${anchorsTotal} to create`
        : undefined,
    ratio: anchorsTotal > 0 ? anchorsReady / anchorsTotal : anchorsDone ? 1 : 0,
  };

  const pages: StepProgress = {
    // Show the book immediately after Style. The canvas owns its screenplay
    // loading state, and batch generation creates references before page art.
    unlocked: setupDone && project.config.styleReady !== false,
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
      // Preview is useful before every illustration is complete. OrderStage
      // clearly identifies blank art and blocks only genuinely invalid print.
      unlocked: setupDone && hasScreenplay,
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
  // Returning readers land on their book, not on a setup checkpoint.
  return preferredDesignStep(project);
}
