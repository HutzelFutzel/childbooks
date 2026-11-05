/**
 * The page editor's edits to the covers' words, scene and people, each one studio undo step.
 *
 * They call the same pure functions the fields and the assistant use (`core/book/coverEdits.ts`), so the
 * title typed on the cover's card, on the cover itself and in the chat all come out the same. Editing is
 * free: nothing here draws.
 */
import { applyBookTitle, applyCoverLine, patchCoverSpec } from "../../core/book/coverEdits";
import { artCarriesLettering, frontCoverArt, paintsCoverLettering } from "../../core/book/coverLines";
import { cleanScene } from "../../core/book/pagePlan";
import { COVER_BACK_ID, COVER_FRONT_ID, type Project } from "../../core/types";
import { getCursor } from "../../core/versioning";
import { useProjectsStore } from "../../state/projectsStore";
import { coverLineBox } from "../design/designInit";
import { commitStudioProject } from "./studioUndo";

const where = (coverId: string) => (coverId === COVER_BACK_ID ? "the back cover" : "the front cover");

/** The book's title, printed on the front cover. */
export function editCoverTitle(text: string): void {
  commitStudioProject((p) => applyBookTitle(p, text), {
    label: `Changed the title on ${where(COVER_FRONT_ID)}`,
    cover: COVER_FRONT_ID,
  });
}

/**
 * A line the cover has no box for yet gets one the first time it is written, unless the title is painted into
 * the picture (then the picture carries the words and the card says so).
 */
function withLineBox(p: Project, line: "subtitle" | "author", text: string): Project {
  const role = line === "subtitle" ? "book-subtitle" : "book-author";
  const design = p.design;
  const page = design?.pages[COVER_FRONT_ID];
  if (!design || !page || !text.trim()) return p;
  if (page.textBoxes.some((box) => box.role === role)) return p;
  const spec = p.screenplay ? getCursor(p.screenplay).content.frontCover : undefined;
  if (paintsCoverLettering(p, spec) || artCarriesLettering(frontCoverArt(p))) return p;
  const z = Math.max(0, ...page.textBoxes.map((box) => box.z)) + 1;
  const textBoxes = [...page.textBoxes, coverLineBox(design, role, text, z)];
  return { ...p, design: { ...design, pages: { ...design.pages, [COVER_FRONT_ID]: { ...page, textBoxes } } } };
}

/** The line under the title, or the author line. */
export function editCoverLine(line: "subtitle" | "author", text: string): void {
  commitStudioProject((p) => withLineBox(applyCoverLine(p, line, text), line, text), {
    label: `Changed the ${line} on ${where(COVER_FRONT_ID)}`,
    cover: COVER_FRONT_ID,
  });
}

/** The words on the back cover. */
export function editBackBlurb(text: string): void {
  commitStudioProject((p) => patchCoverSpec(p, COVER_BACK_ID, { title: text }), {
    label: `Changed the words on ${where(COVER_BACK_ID)}`,
    cover: COVER_BACK_ID,
  });
}

/** What is happening on a cover. Anything in it that asks for another art style is taken out. */
export function editCoverScene(coverId: string, scene: string): void {
  commitStudioProject((p) => patchCoverSpec(p, coverId, { illustration: cleanScene(scene) }), {
    label: `Changed what's happening on ${where(coverId)}`,
    cover: coverId,
  });
}

/** Who is on a cover. */
export function editCoverCast(coverId: string, anchorIds: readonly string[]): void {
  const anchors = new Map((useProjectsStore.getState().current()?.anchors ?? []).map((anchor) => [anchor.id, anchor]));
  const ids = anchorIds.filter((id) => anchors.has(id));
  commitStudioProject(
    (p) => patchCoverSpec(p, coverId, { anchorIds: ids, anchorNames: ids.map((id) => anchors.get(id)?.name ?? "") }),
    { label: `Changed who is here on ${where(coverId)}`, cover: coverId },
  );
}
