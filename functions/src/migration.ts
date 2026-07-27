/**
 * Guest-draft migration — copies selected storybooks from an anonymous guest
 * account into the account the user just signed into.
 *
 * A project is one Firestore KV doc (`users/{uid}/store/project%3A{id}`, JSON
 * payload) plus the Storage blobs it references (`users/{uid}/blobs/{blobId}`,
 * found by scanning the JSON for `blobId` fields — version trees, design
 * images and cover art all use that field name).
 *
 * Security: the caller is authenticated as the TARGET account; ownership of
 * the SOURCE guest account is proven by sending the guest session's ID token
 * in the body. The token is verified server-side and must belong to an
 * anonymous session — without this proof anyone could import another user's
 * drafts by guessing uids.
 */
import express, { type Express, type Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { blobBucket, blobPath, ensureAdmin } from "./storage";
import { isAnonymousToken, type AuthedRequest } from "./auth";

const MAX_PROJECTS = 100;

/** Firestore doc id for a project's KV key (mirrors the client's encoding). */
function projectDocId(projectId: string): string {
  return encodeURIComponent(`project:${projectId}`);
}

/** Recursively collect every string `blobId` field in a parsed project JSON. */
function collectBlobIds(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectBlobIds(v, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "blobId" && typeof v === "string" && v) out.add(v);
      else collectBlobIds(v, out);
    }
  }
  return out;
}

/**
 * Copy one blob between user spaces. Returns false when the copy failed, so the
 * caller can report how much art didn't come across instead of silently handing
 * the user a project full of blank pages.
 */
async function copyBlob(fromUid: string, toUid: string, blobId: string): Promise<boolean> {
  // Always the resolved bucket: `getStorage().bucket()` would use the app's
  // default, which can be the legacy `.appspot.com` bucket the client never
  // reads — copies would "succeed" into a bucket nobody looks at.
  const bucket = blobBucket();
  const src = bucket.file(blobPath(fromUid, blobId));
  try {
    await src.copy(bucket.file(blobPath(toUid, blobId)));
    return true;
  } catch (err) {
    // A missing blob (already GC'd, partial upload) shouldn't sink the project —
    // the affected image simply renders as absent, exactly as it did for the guest.
    console.warn(`[migration] blob copy skipped (${blobId}):`, (err as Error)?.message);
    return false;
  }
}

export function registerMigrationRoutes(app: Express): void {
  const json = express.json({ limit: "1mb" });

  // Import selected guest drafts into the signed-in account.
  app.post("/migrate/guest-drafts", json, async (req: AuthedRequest, res: Response) => {
    try {
      ensureAdmin();
      const uid = req.uid!;
      if (isAnonymousToken(req.authToken)) {
        res.status(403).json({ error: { message: "Sign in to a full account first." } });
        return;
      }
      const body = (req.body ?? {}) as { guestToken?: string; projectIds?: string[] };
      const projectIds = Array.isArray(body.projectIds)
        ? body.projectIds.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_PROJECTS)
        : [];
      if (!body.guestToken || projectIds.length === 0) {
        res.status(400).json({ error: { message: "Missing guest session or projects." } });
        return;
      }

      // Prove ownership of the source account: the guest token must verify and
      // must belong to an anonymous session (never a stolen full account).
      let fromUid: string;
      try {
        const decoded = await getAuth().verifyIdToken(body.guestToken);
        const provider = (decoded.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
        if (provider !== "anonymous") {
          res.status(403).json({ error: { message: "That isn't a guest session." } });
          return;
        }
        fromUid = decoded.uid;
      } catch {
        res.status(401).json({
          error: { message: "Your guest session has expired — the drafts couldn't be verified." },
        });
        return;
      }
      if (fromUid === uid) {
        // Same account (linked in place) — nothing to copy.
        res.json({ migrated: [], skipped: projectIds });
        return;
      }

      const db = getFirestore();
      const migrated: string[] = [];
      const skipped: string[] = [];
      /** Images that didn't come across — reported so the UI can warn. */
      let blobFailures = 0;
      for (const projectId of projectIds) {
        const docId = projectDocId(projectId);
        const srcSnap = await db.doc(`users/${fromUid}/store/${docId}`).get();
        if (!srcSnap.exists) {
          skipped.push(projectId);
          continue;
        }
        const dstRef = db.doc(`users/${uid}/store/${docId}`);
        if ((await dstRef.get()).exists) {
          // Already present on the target account — don't clobber it.
          skipped.push(projectId);
          continue;
        }
        const data = srcSnap.data() as { key: string; json: string; updatedAt: number };
        let blobIds: Set<string> = new Set();
        try {
          blobIds = collectBlobIds(JSON.parse(data.json));
        } catch {
          // Unparseable payload — copy the doc anyway; the client normalizes.
        }
        // Blobs first, then the doc, so the project never appears with missing art.
        const copies = await Promise.all([...blobIds].map((id) => copyBlob(fromUid, uid, id)));
        const failed = copies.filter((okCopy) => !okCopy).length;
        if (failed > 0) {
          blobFailures += failed;
          console.error(
            `[migration] ${failed}/${copies.length} blobs failed to copy for project ${projectId} ` +
              `(${fromUid} → ${uid}) in bucket ${blobBucket().name}`,
          );
        }
        await dstRef.set(data);
        migrated.push(projectId);
      }

      res.json({ migrated, skipped, blobFailures });
    } catch (err) {
      console.error("[migration] guest-draft import failed", err);
      res.status(500).json({ error: { message: "We couldn't import your drafts. Please try again." } });
    }
  });
}
