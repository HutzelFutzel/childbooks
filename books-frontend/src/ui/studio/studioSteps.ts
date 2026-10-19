/**
 * How far along a book is: story, cast references, pages, order. Cast
 * references are required before the pages open so every recurring character and
 * place has a consistent look before page art is created. The Chat studio reads
 * this for the order button's guard.
 */
import type { Project } from "../../core/types";
// Imported from core rather than through the `state/` re-exports these used to
// come from: both are pure functions, and routing on them from core only lets
// the offline checker bundle this module without dragging in Firebase.
import { currentAnchorImage } from "../../core/pipeline/provenance";
import { illustrationUnits } from "../../core/book/units";
import { unitIsDone } from "../../core/book/pageCompletion";

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

/**
 * Derive per-step progress from the live project. Kept pure so every surface
 * shares exactly the same view of "what's done".
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
  const pagesReady = units.filter((u) => unitIsDone(project, u)).length;
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
      // Reveal Review only once the reader has actually reached their pages
      // (`designReady`). Purchasing performs the stricter per-page readiness
      // check inside the order stage.
      unlocked: pages.unlocked && project.config.designReady === true,
      done: false,
      ratio: 0,
    },
    anchorsTotal,
    anchorsReady,
    pagesTotal,
    pagesReady,
  };
}
