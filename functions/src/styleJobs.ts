/**
 * Scheduled upkeep for saved custom art styles.
 *
 * A style is first saved as a candidate when drawings are read, before the
 * reader has chosen the look. A candidate no book ever drew with is removed
 * after {@link CANDIDATE_TTL_MS}, together with its pictures and covers.
 * Nothing a book needs is lost: it keeps its own wording and drawing, and a
 * pointer to a removed style simply resolves to nothing.
 */
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { deleteBlobById, ensureAdmin } from "./storage";
import { CANDIDATE_TTL_MS } from "./customStyles";
import { deleteShowcase, showcaseBlobIds } from "./styleShowcase";
import type { CustomArtStyle, CustomArtStyleRevision } from "../../books-frontend/src/core/config/customArtStyles";

export async function reapUnusedCandidates(now = Date.now(), limit = 200): Promise<number> {
  ensureAdmin();
  const cutoff = now - CANDIDATE_TTL_MS;
  const snap = await getFirestore()
    .collectionGroup("artStyles")
    .where("status", "==", "candidate")
    .where("updatedAt", "<", cutoff)
    .limit(limit)
    .get();
  let removed = 0;
  for (const doc of snap.docs) {
    const style = doc.data() as CustomArtStyle;
    // Re-checked on the document itself: only a candidate no book has used.
    if (style.status !== "candidate" || (style.projectIds?.length ?? 0) > 0 || !style.uid) continue;
    try {
      const revisions = await doc.ref.collection("revisions").get();
      const blobIds = new Set<string>(await showcaseBlobIds(style.uid, style.id));
      for (const revision of revisions.docs) {
        for (const image of (revision.data() as CustomArtStyleRevision).sourceArt ?? []) blobIds.add(image.blobId);
      }
      if (style.portraitReference) blobIds.add(style.portraitReference.blobId);
      await Promise.all([...blobIds].map((blobId) => deleteBlobById(style.uid, blobId)));
      await deleteShowcase(style.uid, style.id);
      await Promise.all(revisions.docs.map((revision) => revision.ref.delete()));
      await doc.ref.delete();
      removed += 1;
    } catch (error) {
      logger.warn("[styles] could not remove an unused candidate", { styleId: style.id, error: String(error) });
    }
  }
  return removed;
}

export const cleanupStyleCandidates = onSchedule(
  { schedule: "every 24 hours", timeoutSeconds: 300, memory: "512MiB", retryCount: 0 },
  async () => {
    const removed = await reapUnusedCandidates();
    if (removed > 0) logger.info("[styles] removed unused candidates", { removed });
  },
);
