/**
 * The set of illustratable "units" in a book (covers + drawable spreads),
 * derived from the current screenplay. Platform-agnostic (depends only on core),
 * so both the client and the backend worker can resolve a task's spread by id.
 */
import type { CoverSpec, Project, ScreenplaySpread } from "../types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../types";
import { getCursor } from "../versioning";

/** Build a generatable pseudo-spread for a cover spec. */
export function coverSpread(id: string, spec: CoverSpec): ScreenplaySpread {
  return {
    id,
    kind: "single",
    text: "",
    illustration: spec.illustration,
    layoutNote: "Cover art. Leave clean space for the title text (added in design).",
    anchorIds: spec.anchorIds,
    anchorNames: spec.anchorNames,
    textMode: "overlay",
  };
}

/** Every illustration unit in the book (covers + drawable spreads). */
export function illustrationUnits(project: Project): ScreenplaySpread[] {
  const tree = project.screenplay;
  const doc = tree ? getCursor(tree).content : null;
  if (!doc) return [];
  const covers: ScreenplaySpread[] = [
    ...(doc.frontCover ? [coverSpread(COVER_FRONT_ID, doc.frontCover)] : []),
    ...(doc.backCover ? [coverSpread(COVER_BACK_ID, doc.backCover)] : []),
  ];
  return [...covers, ...doc.spreads.filter((s) => !s.placeholder)];
}

/** Map of unit id → spread, for resolving a job task back to its spread. */
export function spreadsById(project: Project): Map<string, ScreenplaySpread> {
  return new Map(illustrationUnits(project).map((s) => [s.id, s]));
}
