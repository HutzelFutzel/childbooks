/**
 * Pure helpers for reference provenance — which anchor (and which version of it)
 * an image was generated from, and a stable signature of an anchor's text inputs
 * so staleness can be detected even when the image version id is unchanged.
 *
 * These are platform-agnostic (no store / no blob IO), so the orchestration can
 * run identically on the client and in the backend worker.
 */
import type { Anchor, AnchorImage, ReferenceUse } from "../types";
import { getCursor } from "../versioning";

/**
 * A stable signature of an anchor's text inputs (description / guidance / mode).
 * When this changes, a page using the anchor should be considered stale even if
 * the image version id did not change.
 */
export function anchorSignature(a: Anchor): string {
  return [a.description ?? "", a.userGuidance ?? "", a.mode ?? ""].join("\u0000");
}

/** Current image content for an anchor, if any. */
export function currentAnchorImage(anchor: Anchor): AnchorImage | null {
  if (!anchor.versions) return null;
  return getCursor(anchor.versions).content;
}

/**
 * Reference provenance an illustration's spread would currently use, so we can
 * record it and later detect when a reference changed. Records EVERY anchor on
 * the spread (even image-less ones) plus a signature of its text inputs.
 */
export function currentReferenceUses(
  anchors: Anchor[] | undefined,
  anchorIds: string[],
): ReferenceUse[] {
  const byId = new Map((anchors ?? []).map((a) => [a.id, a]));
  const uses: ReferenceUse[] = [];
  for (const id of anchorIds) {
    const a = byId.get(id);
    if (!a) continue;
    uses.push({
      anchorId: id,
      versionId: a.versions?.cursorId,
      signature: anchorSignature(a),
    });
  }
  return uses;
}
