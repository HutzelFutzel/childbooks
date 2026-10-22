/**
 * What "Undo" puts back after a skill changed the book, and whether it can.
 *
 * A skill turn keeps a snapshot of these top-level fields on the reader's
 * message. The planner reads the same numbers to know whether a change is
 * safe to run without asking: if Undo will bring it back, a confirmation card
 * only gets in the way.
 *
 * The page design is not in that snapshot: it is large, and a typed change
 * touches a page or two. A turn that changed it keeps the earlier version of
 * just the pages it changed (`designPages`, `null` for a page that did not
 * exist) and of the book-wide type settings (`designBase`), so Undo is as small
 * as the change was.
 */
import type { BookDesign } from "../../design";
import type { Project } from "../../types";
import { castSnapshot, pagesWithCastChange, restoreCast } from "../../book/pageCast";
import { GUIDE_RESTORE_MAX_CHARS } from "../session";
import { withLanguageRemembered } from "../storyVersions";

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

/**
 * The snapshot for a turn whose page-design changes are kept in the book's
 * change log (`core/book/changeLog.ts`): only the usual fields, and only when
 * the turn changed one of them. A turn that touched nothing but the pages needs
 * no snapshot at all, so Undo can never put back more than it changed.
 */
export function snapshotForFields(before: Project, after: Project): string | null {
  const changed = RESTORE_FIELDS.some(
    (key) =>
      JSON.stringify((before as unknown as Record<string, unknown>)[key] ?? null) !==
      JSON.stringify((after as unknown as Record<string, unknown>)[key] ?? null),
  );
  const cast = pagesWithCastChange(before, after);
  if (!changed && cast.length === 0) return null;
  const out = JSON.parse(snapshotJson(before)) as Record<string, unknown>;
  // Who is on a page lives in the page plan: a turn that put somebody on a page keeps the earlier list.
  if (cast.length > 0) out.castBack = castSnapshot(before, cast);
  return JSON.stringify(out);
}

type DesignBase = Omit<BookDesign, "pages">;

function designBaseOf(design: BookDesign): DesignBase {
  const { pages: _pages, ...base } = design;
  return base;
}

const sameJson = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The snapshot for a turn that went from `before` to `after`: the usual fields,
 * plus the earlier version of whatever part of the design the turn changed.
 */
export function snapshotForChange(before: Project, after: Project): string {
  const out = JSON.parse(snapshotJson(before)) as Record<string, unknown>;
  const cast = pagesWithCastChange(before, after);
  if (cast.length > 0) out.castBack = castSnapshot(before, cast);
  const was = before.design;
  const now = after.design;
  if (was && now && was !== now) {
    const pages: Record<string, unknown> = {};
    for (const id of new Set([...Object.keys(was.pages ?? {}), ...Object.keys(now.pages ?? {})])) {
      if (!sameJson(was.pages?.[id], now.pages?.[id])) pages[id] = was.pages?.[id] ?? null;
    }
    if (Object.keys(pages).length > 0) out.designPages = pages;
    if (!sameJson(designBaseOf(was), designBaseOf(now))) out.designBase = designBaseOf(was);
  }
  return JSON.stringify(out);
}

/** Put the earlier design pages and book-wide type settings of a snapshot back. */
export function restoreDesign(project: Project, saved: Record<string, unknown>): Project {
  const design = project.design;
  if (!design) return project;
  const pageBack = saved.designPages as Record<string, unknown> | undefined;
  const baseBack = saved.designBase as DesignBase | undefined;
  if (!pageBack && !baseBack) return project;
  const pages = { ...(design.pages ?? {}) } as Record<string, unknown>;
  for (const [id, page] of Object.entries(pageBack ?? {})) {
    if (page === null) delete pages[id];
    else pages[id] = page;
  }
  // The book-wide settings come back whole, so one that did not exist yet goes away too.
  return { ...project, design: { ...(baseBack ?? designBaseOf(design)), pages } as BookDesign };
}

/** Put the earlier list of who is on a page back, for a turn that changed it. */
export function restoreCastOf(project: Project, saved: Record<string, unknown>): Project {
  const back = saved.castBack as Parameters<typeof restoreCast>[1] | undefined;
  return back ? restoreCast(project, back) : project;
}

/** Put back the fields a skill turn changed. Fields that did not exist come back as absent. */
export function applyRestore(project: Project, restore: string): Project {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(restore) as Record<string, unknown>;
  } catch {
    return project;
  }
  // Keep the story that was on the book for its language before the earlier fields come back.
  const remembered = withLanguageRemembered(project);
  const next = { ...remembered } as unknown as Record<string, unknown>;
  for (const key of RESTORE_FIELDS) {
    if (!(key in saved)) continue;
    if (saved[key] === null) delete next[key];
    else next[key] = saved[key];
  }
  return restoreCastOf(restoreDesign(next as unknown as Project, saved), saved);
}
