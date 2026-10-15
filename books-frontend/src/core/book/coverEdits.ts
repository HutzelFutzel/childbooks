/**
 * Pure edits to the cover's words, shared by the stores and the Chat's skills.
 *
 * The title, subtitle and author each live in several places (the project name,
 * the cover spec, the reader's choice in the Chat and the linked text box on the
 * front cover). These write every one of them, so whichever studio wrote the
 * words, `coverLinesOf` reads the same.
 */
import type { CoverSpec, Project, ScreenplayDoc } from "../types";
import { COVER_FRONT_ID } from "../types";
import { textFromParagraphs, wordParagraphs } from "../design";
import { authoringOf, withAuthoring } from "../guide/projectState";
import { getCursor, updateNodeContent } from "../versioning";
import { coverLinesOf } from "./coverLines";

/**
 * Apply a new book title across every linked surface: the project name, the
 * front-cover spec title, and the front-cover title text box. The project always
 * keeps a non-empty name, but the cover title may be blank.
 */
export function applyBookTitle(p: Project, rawTitle: string): Project {
  const clean = rawTitle.trim();
  // The project must keep a name; only overwrite it with a non-empty value.
  let next: Project = clean ? { ...p, title: clean } : p;

  if (p.screenplay) {
    const tree = p.screenplay;
    const doc = getCursor(tree).content;
    const prevTitle = doc.frontCover?.title ?? "";
    const base: CoverSpec =
      doc.frontCover ?? { title: "", subtitle: "", illustration: "", anchorIds: [] };
    const nextDoc: ScreenplayDoc = { ...doc, frontCover: { ...base, title: rawTitle } };
    next = { ...next, screenplay: updateNodeContent(tree, tree.cursorId, nextDoc) };
    next = syncCoverRoleBox(next, "book-title", prevTitle, rawTitle);
  }
  return next;
}

/**
 * Apply a front-cover subtitle or author line everywhere it is kept — the cover
 * spec, the reader's choice in the Chat, and the linked canvas box — so
 * {@link coverLinesOf} reads the same words whichever studio wrote them.
 */
export function applyCoverLine(p: Project, line: "subtitle" | "author", raw: string): Project {
  const prev = coverLinesOf(p)[line];
  let next = withAuthoring(p, { cover: { ...authoringOf(p).cover, [line]: raw } });
  if (next.screenplay) {
    const tree = next.screenplay;
    const doc = getCursor(tree).content;
    const base: CoverSpec =
      doc.frontCover ?? { title: "", subtitle: "", illustration: "", anchorIds: [] };
    const nextDoc: ScreenplayDoc = { ...doc, frontCover: { ...base, [line]: raw } };
    next = { ...next, screenplay: updateNodeContent(tree, tree.cursorId, nextDoc) };
  }
  return syncCoverRoleBox(next, line === "subtitle" ? "book-subtitle" : "book-author", prev, raw);
}

/**
 * Mirror a cover field into its linked overlay text box, but only when that box
 * still shows the previous value — so a canvas edit in flight is never
 * clobbered by an edit made in the toolbox (and vice versa once the canvas
 * already holds the new text).
 */
function syncCoverRoleBox(
  p: Project,
  role: "book-title" | "book-subtitle" | "book-author",
  prevValue: string,
  nextValue: string,
): Project {
  const design = p.design;
  const page = design?.pages[COVER_FRONT_ID];
  if (!design || !page) return p;

  let changed = false;
  const textBoxes = page.textBoxes.map((b) => {
    if (b.role !== role) return b;
    const current = textFromParagraphs(b.paragraphs);
    // Already shows the new value, or was customized away from the old one.
    if (current === nextValue) return b;
    if (current !== prevValue && current.trim() !== "") return b;
    changed = true;
    return { ...b, paragraphs: wordParagraphs(nextValue) };
  });
  if (!changed) return p;

  return {
    ...p,
    design: {
      ...design,
      pages: { ...design.pages, [COVER_FRONT_ID]: { ...page, textBoxes } },
    },
  };
}
