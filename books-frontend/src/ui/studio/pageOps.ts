/**
 * Add / remove / move / duplicate content pages. These edit the screenplay's
 * `spreads` array (the source of truth for the page list) and the matching
 * design overlay together — each call is one studio undo step.
 */
import { getCursor, updateNodeContent } from "../../core/versioning";
import type { Project, ScreenplayDoc, ScreenplaySpread, SpreadKind } from "../../core/types";
import { commitStudioProject } from "./studioUndo";

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

function withSpreads(
  p: Project,
  transform: (spreads: ScreenplaySpread[]) => ScreenplaySpread[],
): Project {
  if (!p.screenplay) return p;
  const tree = p.screenplay;
  const doc = structuredClone(getCursor(tree).content) as ScreenplayDoc;
  doc.spreads = transform(doc.spreads);
  return { ...p, screenplay: updateNodeContent(tree, tree.cursorId, doc) };
}

/** Insert a new (optionally blank) page at the given index in `spreads`. */
export function insertSpreadAt(docIndex: number, opts: NewSpreadOpts = {}): string {
  const s = newSpread(opts);
  commitStudioProject((p) =>
    withSpreads(p, (spreads) => {
      const next = [...spreads];
      next.splice(Math.max(0, Math.min(docIndex, next.length)), 0, s);
      return next;
    }),
  );
  return s.id;
}

/** Remove a page and drop its design overlay (+ illustration history entry). */
export function removeSpread(spreadId: string): void {
  commitStudioProject((p) => {
    let next = withSpreads(p, (spreads) => spreads.filter((s) => s.id !== spreadId));
    if (next.design?.pages[spreadId]) {
      const pages = { ...next.design.pages };
      delete pages[spreadId];
      next = { ...next, design: { ...next.design, pages } };
    }
    if (next.illustrations?.[spreadId]) {
      const illustrations = { ...next.illustrations };
      delete illustrations[spreadId];
      next = { ...next, illustrations };
    }
    return next;
  });
}

export function moveSpread(spreadId: string, dir: -1 | 1): void {
  commitStudioProject((p) =>
    withSpreads(p, (spreads) => {
      const i = spreads.findIndex((s) => s.id === spreadId);
      if (i < 0) return spreads;
      const j = i + dir;
      if (j < 0 || j >= spreads.length) return spreads;
      const next = [...spreads];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }),
  );
}

/**
 * Drag-and-drop reorder: pull one or more spreads out and reinsert them
 * immediately before `beforeId` (or at the end when `beforeId` is null).
 */
export function moveSpreadBefore(draggedIds: string[], beforeId: string | null): void {
  const set = new Set(draggedIds);
  commitStudioProject((p) =>
    withSpreads(p, (spreads) => {
      const moving = spreads.filter((s) => set.has(s.id));
      if (moving.length === 0) return spreads;
      const rest = spreads.filter((s) => !set.has(s.id));
      const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : rest.length;
      const insertAt = at < 0 ? rest.length : at;
      return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
    }),
  );
}

/** Duplicate a page (text/brief + design overlay), placing the copy right after. */
export function duplicateSpread(spreadId: string): string {
  const id = spreadUid();
  commitStudioProject((p) => {
    let next = withSpreads(p, (spreads) => {
      const i = spreads.findIndex((s) => s.id === spreadId);
      if (i < 0) return spreads;
      const copy: ScreenplaySpread = { ...structuredClone(spreads[i]), id };
      const out = [...spreads];
      out.splice(i + 1, 0, copy);
      return out;
    });
    const srcDesign = next.design?.pages[spreadId];
    if (next.design && srcDesign) {
      next = {
        ...next,
        design: {
          ...next.design,
          pages: { ...next.design.pages, [id]: structuredClone(srcDesign) },
        },
      };
    }
    return next;
  });
  return id;
}
