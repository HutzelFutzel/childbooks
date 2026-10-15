/**
 * Is a picture of this book being drawn right now?
 *
 * The printed book is rendered from the saved book, so ordering while a page or
 * the cover is being redrawn could print the picture that is about to be
 * replaced. The studio blocks the order screen for the same reason, but its view
 * is the open tab's; this is the binding check, for a redraw started on another
 * device or a stale tab.
 *
 * Jobs the server has stopped working on do not count (see `core/jobs/liveness`):
 * a job that went quiet is not going to deliver, and must not hold a book hostage.
 */
import { getFirestore } from "firebase-admin/firestore";
import { STALL_MS, pastDeadline } from "../../books-frontend/src/core/jobs/liveness";
import { ensureAdmin } from "./storage";

/** Jobs that change what is on a printed page. The page plan changes no picture. */
const DRAWING_KINDS = new Set(["image", "refresh", "anchors", "portrait", "book"]);

export async function bookIsBeingDrawn(uid: string, projectId: string, now = Date.now()): Promise<boolean> {
  if (!projectId) return false;
  ensureAdmin();
  const snap = await getFirestore()
    .collection(`users/${uid}/jobs`)
    .where("projectId", "==", projectId)
    .where("status", "in", ["pending", "running"])
    .limit(20)
    .get();
  return snap.docs.some((doc) => {
    const job = doc.data() as { kind?: string; status: "pending" | "running"; createdAt: number; updatedAt: number; deadlineAt?: number };
    if (!job.kind || !DRAWING_KINDS.has(job.kind)) return false;
    if (pastDeadline({ id: doc.id, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, deadlineAt: job.deadlineAt }, now)) return false;
    return now - (job.updatedAt ?? 0) <= STALL_MS;
  });
}
