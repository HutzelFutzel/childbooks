/**
 * Add / remove / move / duplicate content pages. These edit the screenplay's
 * `spreads` array (the source of truth for the page list) via the version tree,
 * and clean up the matching design overlay so deleted pages leave nothing behind.
 */
import { getCursor, updateNodeContent } from "../../core/versioning";
import type { ScreenplayDoc, ScreenplaySpread, SpreadKind } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";

function spreadUid(): string {
  return `sp_${Math.random().toString(36).slice(2, 10)}`;
}

interface NewSpreadOpts {
  kind?: SpreadKind;
  blankCanvas?: boolean;
}

function newSpread(opts: NewSpreadOpts = {}): ScreenplaySpread {
  return {
    id: spreadUid(),
    kind: opts.kind ?? "single",
    text: "",
    illustration: "",
    layoutNote: "",
    anchorIds: [],
    blankCanvas: opts.blankCanvas,
  };
}

function writeSpreads(transform: (spreads: ScreenplaySpread[]) => ScreenplaySpread[]): void {
  const store = useProjectsStore.getState();
  const p = store.current();
  if (!p?.screenplay) return;
  const tree = p.screenplay;
  const doc = structuredClone(getCursor(tree).content) as ScreenplayDoc;
  doc.spreads = transform(doc.spreads);
  void store.setScreenplay(updateNodeContent(tree, tree.cursorId, doc));
}

/** Insert a new (optionally blank) page at the given index in `spreads`. */
export function insertSpreadAt(docIndex: number, opts: NewSpreadOpts = {}): string {
  const s = newSpread(opts);
  writeSpreads((spreads) => {
    const next = [...spreads];
    next.splice(Math.max(0, Math.min(docIndex, next.length)), 0, s);
    return next;
  });
  return s.id;
}

/** Remove a page and drop its design overlay. */
export function removeSpread(spreadId: string): void {
  writeSpreads((spreads) => spreads.filter((s) => s.id !== spreadId));
  const store = useProjectsStore.getState();
  const p = store.current();
  if (p?.design && p.design.pages[spreadId]) {
    const pages = { ...p.design.pages };
    delete pages[spreadId];
    void store.setDesign({ ...p.design, pages });
  }
}

export function moveSpread(spreadId: string, dir: -1 | 1): void {
  writeSpreads((spreads) => {
    const i = spreads.findIndex((s) => s.id === spreadId);
    if (i < 0) return spreads;
    const j = i + dir;
    if (j < 0 || j >= spreads.length) return spreads;
    const next = [...spreads];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/**
 * Drag-and-drop reorder: pull one or more spreads out and reinsert them
 * immediately before `beforeId` (or at the end when `beforeId` is null). Used by
 * the grid view to let whole page-units be dragged into a new position.
 */
export function moveSpreadBefore(draggedIds: string[], beforeId: string | null): void {
  const set = new Set(draggedIds);
  writeSpreads((spreads) => {
    const moving = spreads.filter((s) => set.has(s.id));
    if (moving.length === 0) return spreads;
    const rest = spreads.filter((s) => !set.has(s.id));
    const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : rest.length;
    const insertAt = at < 0 ? rest.length : at;
    return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  });
}

/** Duplicate a page (text/brief + design overlay), placing the copy right after. */
export function duplicateSpread(spreadId: string): string {
  const id = spreadUid();
  writeSpreads((spreads) => {
    const i = spreads.findIndex((s) => s.id === spreadId);
    if (i < 0) return spreads;
    const copy: ScreenplaySpread = { ...structuredClone(spreads[i]), id };
    const next = [...spreads];
    next.splice(i + 1, 0, copy);
    return next;
  });
  const store = useProjectsStore.getState();
  const p = store.current();
  const srcDesign = p?.design?.pages[spreadId];
  if (p?.design && srcDesign) {
    void store.setDesign({
      ...p.design,
      pages: { ...p.design.pages, [id]: structuredClone(srcDesign) },
    });
  }
  return id;
}
