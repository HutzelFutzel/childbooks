/** @legacy guide-v2 L1 — deleted with the Steps shell. See docs/LEGACY-GUIDE.md. */
/** Steps-only hand-off cache around the shared drawing-to-style decision. */
import type { ArtworkLookDecision } from "../../core/guide/artworkLook";
export {
  decideArtworkLook,
  decideFromExtract,
  type ArtworkLookDecision,
  type ArtworkLookOption,
} from "../../core/guide/artworkLook";

let pending: { projectId: string; decision: ArtworkLookDecision } | null = null;

export function stashArtworkLook(projectId: string, decision: ArtworkLookDecision): void {
  pending = { projectId, decision };
}

export function peekArtworkLook(projectId: string): ArtworkLookDecision | null {
  return pending?.projectId === projectId ? pending.decision : null;
}

export function clearArtworkLook(projectId: string): void {
  if (pending?.projectId === projectId) pending = null;
}

