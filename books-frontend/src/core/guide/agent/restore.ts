/**
 * What "Undo" puts back after a skill changed the book, and whether it can.
 *
 * A skill turn keeps a snapshot of these top-level fields on the reader's
 * message. The planner reads the same numbers to know whether a change is
 * safe to run without asking: if Undo will bring it back, a confirmation card
 * only gets in the way.
 */
import type { Project } from "../../types";
import { GUIDE_RESTORE_MAX_CHARS } from "../session";

/** The book fields an undo snapshot holds. */
export const RESTORE_FIELDS = ["title", "config", "anchors", "authoringState"] as const;

/** The book's undoable fields, as JSON. */
export function snapshotJson(project: Project): string {
  const out: Record<string, unknown> = {};
  for (const key of RESTORE_FIELDS) out[key] = (project as unknown as Record<string, unknown>)[key] ?? null;
  return JSON.stringify(out);
}

/** Whether a snapshot of this book fits on the message, so Undo will be there. */
export function canUndo(project: Project): boolean {
  return snapshotJson(project).length <= GUIDE_RESTORE_MAX_CHARS;
}
