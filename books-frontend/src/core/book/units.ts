/**
 * The set of illustratable "units" in a book (covers + drawable spreads),
 * derived from the current screenplay. Platform-agnostic (depends only on core),
 * so both the client and the backend worker can resolve a task's spread by id.
 */
import type { CoverSpec, Project, ScreenplaySpread } from "../types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../types";
import { getCursor } from "../versioning";
import { coverLinesOf, paintsCoverLettering } from "./coverLines";

/** What a cover without painted words is told about its words: they go on later, as text. */
export const OVERLAY_COVER_NOTE = "Cover art. Leave clean space for the title text (added in design).";

/**
 * Build a generatable pseudo-spread for a cover spec. Given the book, the front
 * cover's words come from {@link coverLinesOf}, the one reading every surface shares.
 */
export function coverSpread(id: string, spec: CoverSpec, project?: Project): ScreenplaySpread {
  const lines =
    project && id === COVER_FRONT_ID
      ? coverLinesOf(project)
      : { title: (spec.title ?? "").trim(), subtitle: (spec.subtitle ?? "").trim(), author: (spec.author ?? "").trim() };
  const wanted = project && id === COVER_FRONT_ID ? paintsCoverLettering(project, spec) : Boolean(spec.bakeText);
  const bake = wanted && Boolean(lines.title);
  return {
    id,
    kind: "single",
    text: "",
    illustration: spec.illustration,
    layoutNote: bake
      ? "Cover art with the title typography integrated into the artwork."
      : OVERLAY_COVER_NOTE,
    anchorIds: spec.anchorIds,
    anchorNames: spec.anchorNames,
    textMode: bake ? "in-image" : "overlay",
    ...(bake
      ? {
          bakeText: true,
          coverTitle: lines.title,
          ...(lines.subtitle ? { coverSubtitle: lines.subtitle } : {}),
          ...(lines.author ? { coverAuthor: lines.author } : {}),
        }
      : {}),
  };
}

/** Every illustration unit in the book (covers + drawable spreads). */
export function illustrationUnits(project: Project): ScreenplaySpread[] {
  const tree = project.screenplay;
  const doc = tree ? getCursor(tree).content : null;
  if (!doc) return [];
  const covers: ScreenplaySpread[] = [
    ...(doc.frontCover ? [coverSpread(COVER_FRONT_ID, doc.frontCover, project)] : []),
    ...(doc.backCover ? [coverSpread(COVER_BACK_ID, doc.backCover, project)] : []),
  ];
  return [...covers, ...doc.spreads.filter((s) => !s.placeholder)];
}

/** Map of unit id → spread, for resolving a job task back to its spread. */
export function spreadsById(project: Project): Map<string, ScreenplaySpread> {
  return new Map(illustrationUnits(project).map((s) => [s.id, s]));
}
