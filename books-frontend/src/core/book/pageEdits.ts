/**
 * Pure edits to the page list: add, remove, move and copy a page. They return
 * the new book and touch no store, so the page editor (`ui/studio/pageOps.ts`,
 * one studio undo step each) and the chat skills share them.
 */
import { getCursor, updateNodeContent } from "../versioning";
import type { Project, ScreenplayDoc, ScreenplaySpread, SpreadKind } from "../types";

function spreadUid(): string {
  return `sp_${Math.random().toString(36).slice(2, 10)}`;
}

export interface NewSpreadOpts {
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
    ...(opts.blankCanvas ? { blankCanvas: true, completion: "blank" as const } : {}),
  };
}

export function withSpreads(
  p: Project,
  transform: (spreads: ScreenplaySpread[]) => ScreenplaySpread[],
): Project {
  if (!p.screenplay) return p;
  const tree = p.screenplay;
  const doc = structuredClone(getCursor(tree).content) as ScreenplayDoc;
  doc.spreads = transform(doc.spreads);
  return { ...p, screenplay: updateNodeContent(tree, tree.cursorId, doc) };
}

/** The book with a new (optionally blank) page at the given index in `spreads`. Pure. */
export function insertSpreadProject(p: Project, docIndex: number, opts: NewSpreadOpts = {}): { project: Project; id: string } {
  const s = newSpread(opts);
  const project = withSpreads(p, (spreads) => {
    const next = [...spreads];
    next.splice(Math.max(0, Math.min(docIndex, next.length)), 0, s);
    return next;
  });
  return { project, id: s.id };
}

/** The book without a page, its design overlay and its picture history. Pure. */
export function removeSpreadProject(p: Project, spreadId: string): Project {
  {
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
  }
}

/** The book with a page swapped with its neighbor. Pure. */
export function moveSpreadProject(p: Project, spreadId: string, dir: -1 | 1): Project {
  return withSpreads(p, (spreads) => {
    const i = spreads.findIndex((s) => s.id === spreadId);
    if (i < 0) return spreads;
    const j = i + dir;
    if (j < 0 || j >= spreads.length) return spreads;
    const next = [...spreads];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/** The book with a copy of a page right after it. Pure. */
export function duplicateSpreadProject(p: Project, spreadId: string): { project: Project; id: string } {
  const id = spreadUid();
  const project = (() => {
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
  })();
  return { project, id };
}

