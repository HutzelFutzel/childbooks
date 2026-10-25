/**
 * Keeping a project mirror's structure honest. Pure (types only), so the cost
 * invariants can run it without Firestore.
 */
import type { Project } from "../../books-frontend/src/core/types";
import type { ProjectDerived } from "./projects";

/**
 * Fold a freshly derived structure into the one already stored, without letting
 * a thin snapshot erase what a fuller one established.
 *
 * Backend requests carry a SLIMMED project (`slimProjectForRender`): a text-only
 * call has no screenplay at all, and a render call only carries the trees it
 * targets. Deriving from those used to overwrite the book's page count with 0 and
 * its illustrated count with one, which silently broke every per-page figure (cost
 * per page divides by this). So:
 *   - no screenplay in the snapshot → the page count and screenplay revision
 *     count are unknown, not zero: keep what we had;
 *   - illustrations are only ever a LOWER bound in a slim snapshot: keep the
 *     larger of the two (a book rarely loses pictures, and when it does the
 *     mirror lagging by a few is far cheaper than a wrong denominator).
 */
export function mergeDerived(
  existing: ProjectDerived | undefined,
  next: ProjectDerived,
  snapshot: Pick<Project, "screenplay">,
): ProjectDerived {
  if (!existing) return next;
  const hasScreenplay = Boolean(snapshot.screenplay);
  return {
    ...next,
    pageCount: hasScreenplay ? next.pageCount : Math.max(existing.pageCount ?? 0, next.pageCount),
    screenplayVersions: hasScreenplay
      ? next.screenplayVersions
      : Math.max(existing.screenplayVersions ?? 0, next.screenplayVersions),
    illustratedCount: Math.max(existing.illustratedCount ?? 0, next.illustratedCount),
    illustrationVersions: Math.max(existing.illustrationVersions ?? 0, next.illustrationVersions),
  };
}
