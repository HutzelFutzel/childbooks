/**
 * The front cover's words, kept the same wherever they are written.
 *
 * The title, subtitle and author each live in the project (and the reader's choice in the Chat), in the
 * cover's spec, and in one text box on the cover. `coverEdits` writes all of them when the words are
 * changed from a field or by the assistant. This is the same promise for a change made on the page itself
 * and for Undo and Redo: when a box's words changed in a write and the book does not say the same,
 * the box wins, because it is what prints, and the rest follow.
 *
 * It only ever acts on a box that changed in this write, so a cover someone arranged by hand is never
 * rearranged for them, and a book saved long ago is left as it is when it opens. A cover whose words
 * are painted into the art has no box and is left alone.
 */
import { textFromParagraphs, type PageDesign, type TextBox } from "../design";
import type { Project } from "../types";
import { COVER_FRONT_ID } from "../types";
import { applyBookTitle, applyCoverLine } from "./coverEdits";
import { coverLinesOf } from "./coverLines";

const LINES = [
  ["book-title", "title"],
  ["book-subtitle", "subtitle"],
  ["book-author", "author"],
] as const;

function boxFor(page: PageDesign | undefined, role: TextBox["role"]): TextBox | undefined {
  const boxes = (page?.textBoxes ?? []).filter((box) => box.role === role && !box.hidden);
  return boxes.length === 1 ? boxes[0] : undefined;
}

const wordsOf = (box: TextBox) => textFromParagraphs(box.paragraphs).trim();

export function reconcileCoverWords(before: Project | null, after: Project): Project {
  if (!before) return after;
  const page = after.design?.pages[COVER_FRONT_ID];
  const was = before.design?.pages[COVER_FRONT_ID];
  if (!page || !was || page === was) return after;
  let next = after;
  for (const [role, line] of LINES) {
    const box = boxFor(page, role);
    const earlier = boxFor(was, role);
    if (!box || !earlier) continue;
    const words = wordsOf(box);
    if (words === wordsOf(earlier) || words === coverLinesOf(next)[line]) continue;
    next = line === "title" ? applyBookTitle(next, words) : applyCoverLine(next, line, words);
  }
  return next;
}
