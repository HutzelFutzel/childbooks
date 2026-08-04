/**
 * Bridge so page ops (and other non-React callers) can push onto the studio's
 * unified undo stack. StudioProvider registers the real implementation; outside
 * the studio, mutations fall back to a direct project patch with no history.
 */
import type {
  BookDesign,
  IllustrationImage,
  Project,
  ScreenplayDoc,
} from "../../core/types";
import type { VersionTree } from "../../core/versioning";
import { useProjectsStore } from "../../state/projectsStore";

/** Slice of the project that studio undo/redo restores together. */
export type StudioSnapshot = {
  design: BookDesign | undefined;
  screenplay: VersionTree<ScreenplayDoc> | undefined;
  illustrations: Record<string, VersionTree<IllustrationImage>> | undefined;
};

export function takeStudioSnapshot(p: Project): StudioSnapshot {
  return {
    design: p.design ? structuredClone(p.design) : undefined,
    screenplay: p.screenplay ? structuredClone(p.screenplay) : undefined,
    illustrations: p.illustrations ? structuredClone(p.illustrations) : undefined,
  };
}

export function applyStudioSnapshot(p: Project, snap: StudioSnapshot): Project {
  return {
    ...p,
    design: snap.design,
    screenplay: snap.screenplay,
    illustrations: snap.illustrations,
  };
}

type CommitProjectFn = (mutate: (p: Project) => Project) => void;

let commitProjectImpl: CommitProjectFn | null = null;

/** Called by StudioProvider; returns an unbind function for cleanup. */
export function bindStudioProjectCommit(fn: CommitProjectFn): () => void {
  commitProjectImpl = fn;
  return () => {
    if (commitProjectImpl === fn) commitProjectImpl = null;
  };
}

/**
 * Apply a project mutation as one undo step when the studio is mounted.
 * Falls back to a direct patch (no history) outside the studio.
 */
export function commitStudioProject(mutate: (p: Project) => Project): void {
  if (commitProjectImpl) {
    commitProjectImpl(mutate);
    return;
  }
  void useProjectsStore.getState().patchCurrent(mutate);
}
