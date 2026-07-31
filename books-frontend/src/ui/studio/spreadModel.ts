/**
 * Pure spread/pagination data model — no React, no Konva. Groups reading-order
 * pages into facing "display spreads" (what the editor shows on screen: a true
 * double-page spread, two facing single pages with a fold, or a cover) and
 * answers side-aware questions about them (which page sits on the left/right).
 *
 * Kept dependency-free of `StudioContext` / `SpreadEditor` (both depend on this
 * module, not the other way around) so the provider itself can resolve "what's
 * currently on screen" for paste-in-place without a circular import.
 */
import type { ScreenplayDoc } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { paginate, type PageSlot } from "../../core/pipeline/pagination";
import type { DesignPage } from "../design/designInit";
import type { PageSubject } from "./PageEditorCard";

export interface Entry {
  page: DesignPage;
  subject: PageSubject;
}

/** Which cover a display spread represents (covers get a distinct treatment). */
export type CoverKind = "front" | "back";

/** One half of a facing spread. */
export type SpreadSide =
  | { kind: "page"; entry: Entry; label: string }
  | { kind: "filler"; label: string }
  | { kind: "edge" };

export type DisplaySpread =
  | { id: string; kind: "full"; label: string; entry: Entry; endInsertIndex: number; cover?: CoverKind }
  | {
      id: string;
      kind: "pair";
      label: string;
      left: SpreadSide;
      right: SpreadSide;
      endInsertIndex: number;
      cover?: CoverKind;
    };

/**
 * The editable (screenplay) spread ids a display unit stands for — covers and
 * blank fillers excluded. Drives drag-and-drop page reordering in the filmstrip.
 */
export function contentSpreadIds(disp: DisplaySpread): string[] {
  if (disp.cover) return [];
  if (disp.kind === "full") return [disp.entry.page.id];
  const ids: string[] = [];
  for (const side of [disp.left, disp.right]) {
    if (side.kind === "page" && side.entry.subject.kind === "spread") ids.push(side.entry.page.id);
  }
  return ids;
}

function sideFromSlot(slot: PageSlot | null, byId: Map<string, Entry>): SpreadSide {
  if (!slot) return { kind: "edge" };
  if (slot.spread.placeholder) return { kind: "filler", label: `Page ${slot.pageNumber}` };
  const entry = byId.get(slot.spread.id);
  return entry
    ? { kind: "page", entry, label: `Page ${slot.pageNumber}` }
    : { kind: "filler", label: `Page ${slot.pageNumber}` };
}

/** Group reading-order entries into facing spreads using physical pagination. */
export function buildDisplaySpreads(doc: ScreenplayDoc, entries: Entry[]): DisplaySpread[] {
  const byId = new Map<string, Entry>();
  for (const e of entries) if (e.subject.kind === "spread") byId.set(e.page.id, e);

  const docIndexById = new Map<string, number>();
  doc.spreads.forEach((s, i) => docIndexById.set(s.id, i));

  const front = entries.find((e) => e.page.id === COVER_FRONT_ID);
  const back = entries.find((e) => e.page.id === COVER_BACK_ID);

  const out: DisplaySpread[] = [];

  if (front) {
    out.push({
      id: "disp-front",
      kind: "pair",
      label: "Front cover",
      cover: "front",
      left: { kind: "edge" },
      right: { kind: "page", entry: front, label: "Front cover" },
      endInsertIndex: 0,
    });
  }

  const pag = paginate(doc);
  for (const pair of pag.pairs) {
    const { left, right } = pair;

    // A true double-page spread occupies both facing slots (same spread ref).
    if (left && right && left.spread === right.spread && left.spread.kind === "spread") {
      const entry = byId.get(left.spread.id);
      if (entry) {
        out.push({
          id: `disp-${left.spread.id}`,
          kind: "full",
          label: `Pages ${left.pageNumber}–${right.pageNumber}`,
          entry,
          endInsertIndex: (docIndexById.get(left.spread.id) ?? doc.spreads.length - 1) + 1,
        });
        continue;
      }
    }

    const leftSide = sideFromSlot(left, byId);
    const rightSide = sideFromSlot(right, byId);
    const trailingId = right?.spread.id ?? left?.spread.id;
    const endInsertIndex =
      trailingId !== undefined ? (docIndexById.get(trailingId) ?? doc.spreads.length - 1) + 1 : 0;

    out.push({
      id: `disp-${left?.pageNumber ?? "x"}-${right?.pageNumber ?? "x"}`,
      kind: "pair",
      label:
        left && right
          ? `Pages ${left.pageNumber}–${right.pageNumber}`
          : `Page ${(left ?? right)!.pageNumber}`,
      left: leftSide,
      right: rightSide,
      endInsertIndex,
    });
  }

  if (back) {
    out.push({
      id: "disp-back",
      kind: "pair",
      label: "Back cover",
      cover: "back",
      left: { kind: "page", entry: back, label: "Back cover" },
      right: { kind: "edge" },
      endInsertIndex: doc.spreads.length,
    });
  }

  return out;
}

export const FOLD_GRADIENT =
  "linear-gradient(to right, rgba(15,23,42,0) 0%, rgba(15,23,42,0.10) 42%, rgba(15,23,42,0.16) 50%, rgba(15,23,42,0.10) 58%, rgba(15,23,42,0) 100%)";

export function sideAspect(left: SpreadSide, right: SpreadSide): number {
  const fromPage = (s: SpreadSide) => (s.kind === "page" ? s.entry.page.aspect : undefined);
  return fromPage(left) ?? fromPage(right) ?? 1;
}

export const COVER_META: Record<CoverKind, { title: string; hint: string }> = {
  front: { title: "Front cover", hint: "The first thing readers see — title and headline art." },
  back: { title: "Back cover", hint: "The closing panel — blurb, and the back of the printed book." },
};

/** Pull the cover's page side (front sits on the right, back on the left). */
export function coverSideOf(disp: Extract<DisplaySpread, { kind: "pair" }>): SpreadSide | null {
  if (disp.left.kind === "page") return disp.left;
  if (disp.right.kind === "page") return disp.right;
  return null;
}

/** All live page entries a display unit shows, in reading order. */
export function displayEntries(disp: DisplaySpread): { entry: Entry; label: string }[] {
  if (disp.kind === "full") return [{ entry: disp.entry, label: disp.label }];
  const out: { entry: Entry; label: string }[] = [];
  for (const side of [disp.left, disp.right]) {
    if (side.kind === "page") out.push({ entry: side.entry, label: side.label });
  }
  return out;
}

export function isBlankEntry(entry: Entry): boolean {
  return entry.subject.kind === "spread" && !!entry.subject.spread.blankCanvas;
}

/**
 * True when a display spread is two independently-editable facing single
 * pages (not a true double-page-spread illustration, not a cover) — the case
 * where a live pair editor can merge both into one shared canvas.
 */
export function isPlainPagePair(
  disp: DisplaySpread,
): disp is Extract<DisplaySpread, { kind: "pair" }> & {
  left: { kind: "page"; entry: Entry; label: string };
  right: { kind: "page"; entry: Entry; label: string };
} {
  return (
    disp.kind === "pair" &&
    !disp.cover &&
    disp.left.kind === "page" &&
    disp.right.kind === "page" &&
    disp.left.entry.subject.kind === "spread" &&
    disp.right.entry.subject.kind === "spread"
  );
}
