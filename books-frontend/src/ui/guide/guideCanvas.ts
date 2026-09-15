/**
 * The guide's canvas, as a wizard destination.
 *
 * The artifact pane is driven by `component.canvas` — the guide's own word for what
 * the reader is looking at — rather than by `legacyDestination`, which says the same
 * thing in the wizard's vocabulary. Both exist today and this is the translation
 * between them.
 *
 * Doing it this way round is the point. `legacyDestination` is scaffolding and is
 * deleted with the wizard (see docs/LEGACY-GUIDE.md); `canvas` is permanent. Having
 * the pane read the permanent field now means phase 9 deletes a map, not a
 * behaviour. `scripts/guide-widget-invariants.ts` pins the two against each other so
 * the swap is provably not a change — with one intended exception, `page-plan`, where
 * the wizard holds on Cast while the screenplay drafts because it has no surface for
 * the wait and the guide would rather show the reader the pages being planned.
 *
 * It stays in the UI layer rather than in `core/guide` because `StudioDestination` is
 * the old UI's type, and core should not learn about it on the way out.
 */
import type { GuideCanvasKind } from "../../core/guide/components";
import type { StudioDestination } from "../studio/studioRoutes";

const CANVAS_DESTINATION: Record<GuideCanvasKind, StudioDestination> = {
  // Nothing to show yet: the earliest questions are about who the book is for, and
  // the manuscript is the least wrong thing to have open behind that conversation.
  none: "story",
  manuscript: "story",
  style: "style",
  cast: "cast",
  pages: "pages",
  preview: "order",
};

export function canvasDestination(canvas: GuideCanvasKind): StudioDestination {
  return CANVAS_DESTINATION[canvas];
}

export { CANVAS_DESTINATION };
