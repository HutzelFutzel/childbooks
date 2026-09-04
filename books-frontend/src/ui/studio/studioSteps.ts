/**
 * The guided studio flow:
 *
 *   Story → Style → Cast → Book → Order
 *
 * Cast references are required before the book opens so every recurring
 * character and place has a consistent look before page art is created.
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

/** Open Cast until every required reference is ready, then open Pages. */
export function preferredDesignStep(project: Project): StudioStep {
  if (project.config.styleReady === false) return "anchors";
  const progress = computeProgress(project);
  return progress.anchors.done && Boolean(project.screenplay) ? "edit" : "anchors";
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
  // Cast is a real checkpoint, not just an image count. For legacy projects
  // only, infer confirmation when every non-empty cast entry already has art.
  const castConfirmed =
    project.config.castReady ??
    (anchorsTotal > 0 && anchorsReady === anchorsTotal);
  const anchorsDone =
    setupDone &&
    Boolean(project.analysis) &&
    castConfirmed &&
    (anchorsTotal === 0 || anchorsReady === anchorsTotal);

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
    // The screenplay and every required Cast reference must be ready first.
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
      // Preview can open before every page illustration is complete, but never
      // before the required Cast checkpoint.
      unlocked: setupDone && anchorsDone && hasScreenplay,
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
  // Do not skip an unfinished Cast when reopening a book.
  return preferredDesignStep(project);
}
