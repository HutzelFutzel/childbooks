/**
 * Blob-reference accounting for safe, scoped garbage collection.
 *
 * Generated images are stored as immutable blobs (a fresh id per render). They
 * are referenced from three places:
 *   1. version-tree nodes  — every anchor / illustration version's `blobId`
 *      (project-exclusive: a blob id is minted for exactly one render in one
 *       project's tree, so it is never shared across projects),
 *   2. Final Design image elements — `PageDesign.images[].blobId` (kind "asset"),
 *      which point at GLOBAL, user-uploaded assets in `settings.assets`,
 *   3. `settings.assets[].blobId` — global uploaded assets, shared across every
 *      project.
 *
 * GC must therefore only ever delete category (1) blobs, and only after
 * confirming they are not referenced anywhere else (belt-and-suspenders, since
 * they are project-exclusive by construction) and are not a global asset. These
 * pure helpers enumerate the reference sets so callers never guess.
 */
import type { Project } from "../types";
import { allVersions } from "../versioning";

/**
 * Every version-tree blob id owned by a project (all anchor image versions +
 * all illustration versions, across the full history — not just the cursors).
 * These are the ONLY blobs a scoped GC may delete.
 */
export function collectProjectImageBlobIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const anchor of project.anchors ?? []) {
    if (!anchor.versions) continue;
    for (const n of allVersions(anchor.versions)) {
      if (n.content.blobId) ids.add(n.content.blobId);
    }
  }
  for (const tree of Object.values(project.illustrations ?? {})) {
    for (const n of allVersions(tree)) {
      if (n.content.blobId) ids.add(n.content.blobId);
    }
  }
  return ids;
}

/** Global uploaded-asset blob ids referenced by a project's design layer. */
export function collectProjectDesignAssetBlobIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const page of Object.values(project.design?.pages ?? {})) {
    for (const img of page.images ?? []) {
      if (img.kind === "asset" && img.blobId) ids.add(img.blobId);
    }
  }
  return ids;
}
