import type { Anchor, Project } from "../types";
import { artStyleKey } from "../prompts/style";
import { containedAnchorsFor } from "./anchorGraph";
import { anchorSignature, currentAnchorImage } from "../pipeline/provenance";

/** Whether a hidden consistency image still matches every input it was built from. */
export function anchorImageIsCurrent(
  project: Project,
  anchor: Anchor,
): boolean {
  const image = currentAnchorImage(anchor);
  if (!image) return false;
  if (
    image.artStyleKey !== undefined &&
    image.artStyleKey !== artStyleKey(project.config.artStyle)
  ) {
    return false;
  }

  const anchors = project.anchors ?? [];
  const byId = new Map(anchors.map((candidate) => [candidate.id, candidate]));
  const used = image.references ?? [];
  // Legacy images may have no authored-input receipt. Once a portrait or
  // reader drawing becomes an input, such an image cannot prove it used that
  // identity and must be prepared again.
  const selfReceipt = used.find(
    (reference) =>
      reference.anchorId === anchor.id &&
      reference.textOnly &&
      reference.signature !== undefined,
  );
  if ((anchor.sourceArt?.length ?? 0) > 0 && !selfReceipt) return false;
  for (const reference of used) {
    const current = byId.get(reference.anchorId);
    if (!current) return false;
    if (
      !reference.textOnly &&
      (current.versions?.cursorId ?? undefined) !== reference.versionId
    ) {
      return false;
    }
    if (
      reference.signature !== undefined &&
      reference.signature !== anchorSignature(current)
    ) {
      return false;
    }
  }

  const currentLinks = new Set(
    containedAnchorsFor(anchor, anchors).map((candidate) => candidate.id),
  );
  const recordedLinks = new Set(
    used
      .map((reference) => reference.anchorId)
      .filter((id) => id !== anchor.id && byId.has(id)),
  );
  return (
    currentLinks.size === recordedLinks.size &&
    [...currentLinks].every((id) => recordedLinks.has(id))
  );
}

export function staleAnchorIds(project: Project): string[] {
  return (project.anchors ?? [])
    .filter(
      (anchor) =>
        anchor.include &&
        currentAnchorImage(anchor) &&
        !anchorImageIsCurrent(project, anchor),
    )
    .map((anchor) => anchor.id);
}

/** Required hidden consistency images that are missing or out of date. */
export function anchorsToPrepare(project: Project): Anchor[] {
  return (project.anchors ?? []).filter(
    (anchor) => anchor.include && !anchorImageIsCurrent(project, anchor),
  );
}
