/**
 * Batch generation orchestration for the unified Studio. Wraps the pure AI
 * pipelines (anchors → illustrations) with concurrency + progress reporting so a
 * single "Generate everything" button can fill in the whole book.
 */
import { GENERATION_CONCURRENCY, mapWithConcurrency } from "../../core/pipeline/concurrency";
import type { CoverSpec, Project, ScreenplaySpread } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { getCursor } from "../../core/versioning";
import {
  currentAnchorImage,
  currentIllustration,
  generateAnchorVersion,
  generateIllustrationVersion,
  orderAnchorsByDependency,
} from "../../state/ai";

type SetGen = (id: string, on: boolean) => void;

/** Build a generatable pseudo-spread for a cover spec. */
export function coverSpread(id: string, spec: CoverSpec): ScreenplaySpread {
  return {
    id,
    kind: "single",
    text: "",
    illustration: spec.illustration,
    layoutNote: "Cover art. Leave clean space for the title text (added in design).",
    anchorIds: spec.anchorIds,
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

/** Generate every not-yet-generated anchor reference, in dependency order. */
export async function generateAllAnchors(
  project: Project,
  setGen: SetGen,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const anchors = (project.anchors ?? []).filter((a) => a.include);
  const pending = anchors.filter((a) => !currentAnchorImage(a));
  if (pending.length === 0) return;
  pending.forEach((a) => setGen(a.id, true));
  try {
    const layers = orderAnchorsByDependency(pending);
    for (const layer of layers) {
      if (signal?.aborted) return;
      await mapWithConcurrency(
        layer,
        async (anchor) => {
          if (signal?.aborted) return;
          try {
            await generateAnchorVersion(anchor.id, { signal });
          } catch (err) {
            onError(err);
          } finally {
            setGen(anchor.id, false);
          }
        },
        { concurrency: GENERATION_CONCURRENCY },
      );
    }
  } finally {
    pending.forEach((a) => setGen(a.id, false));
  }
}

/** Generate every not-yet-generated page + cover illustration. */
export async function generateAllPages(
  project: Project,
  setGen: SetGen,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pending = illustrationUnits(project).filter((s) => !currentIllustration(project, s.id));
  if (pending.length === 0) return;
  pending.forEach((s) => setGen(s.id, true));
  try {
    await mapWithConcurrency(
      pending,
      async (spread) => {
        if (signal?.aborted) return;
        try {
          await generateIllustrationVersion(spread, { signal });
        } catch (err) {
          onError(err);
        } finally {
          setGen(spread.id, false);
        }
      },
      { concurrency: GENERATION_CONCURRENCY },
    );
  } finally {
    pending.forEach((s) => setGen(s.id, false));
  }
}
