/**
 * How a change to the book's structure (a page added, removed, moved, joined)
 * reaches the shared history (`state/bookHistory.ts`). It works with or without
 * the studio mounted, so the Chat can use the same page operations and its
 * changes sit in the same list as the editor's.
 */
import type { Project } from "../../core/types";
import { useBookHistory } from "../../state/bookHistory";
import { useProjectsStore } from "../../state/projectsStore";
import type { ChangeSource } from "../../core/book/changeLog";

/**
 * Apply a project mutation as one undo step. The book is changed first, then
 * the change is recorded from what the book actually holds, so Undo puts back
 * exactly what was there.
 */
export function commitStudioProject(
  mutate: (p: Project) => Project,
  meta: {
    label?: string;
    source?: ChangeSource;
    /** An edit to a page's words, scene, people or picture: kept property by property. */
    plan?: boolean;
    /** An edit to a cover's words, scene or people: the cover it is about. Kept whole, with the book's title. */
    cover?: string;
  } = {},
): void {
  const store = useProjectsStore.getState();
  const before = store.current();
  if (!before) return;
  // `patchCurrent` applies the mutator synchronously; only saving is awaited.
  void store.patchCurrent(mutate);
  const after = useProjectsStore.getState().current();
  if (!after || after === before) return;
  const history = useBookHistory.getState();
  const record = meta.plan ? history.recordPlan : history.recordStructural;
  record({
    projectId: before.id,
    source: meta.source ?? "editor",
    label: meta.label ?? "Page change",
    before,
    after,
    ...(meta.cover ? { pages: [meta.cover], cover: true } : {}),
  });
}
