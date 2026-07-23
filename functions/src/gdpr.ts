/**
 * GDPR data-subject operations — data EXPORT (right to access / portability) and
 * ERASURE (right to be forgotten). Admin-only: a user contacts support, an admin
 * looks them up here and runs the export and/or deletion.
 *
 * Erasure policy — **anonymize-and-keep financial records**:
 *   - HARD DELETE: the Firebase Auth user, the whole `users/{uid}/**` tree
 *     (profile, projects, jobs, usage, addresses, ledgers, subscriptions, the
 *     user-facing order/payment copies) and every Storage object under
 *     `users/{uid}/`.
 *   - ANONYMIZE (retain): the authoritative financial records outside the user
 *     tree — `orders/*`, `payments/*`, `subscriptions/*` owned by the uid — keep
 *     amounts/refs (required for tax/accounting law) but strip personal data
 *     (recipient name/address, email, raw provider payloads).
 *   - `analyticsEvents` for the uid are de-identified (uid tombstoned).
 * Every deletion writes an append-only audit record to `adminAudit/*`
 * (backend-only; denied to clients by the default rule).
 *
 * Mounted under `/admin` (see app.ts), so every handler assumes an admin caller.
 */
import express, { type Express, type Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { ensureAdmin, storageBucketName } from "./storage";
import type { AuthedRequest } from "./auth";

/** A trimmed, JSON-safe view of a Firebase Auth user for lookup/export. */
interface AuthSummary {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  disabled: boolean;
  providers: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
}

function authSummary(user: import("firebase-admin/auth").UserRecord): AuthSummary {
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    providers: (user.providerData ?? []).map((p) => p.providerId),
    createdAt: user.metadata?.creationTime ?? null,
    lastSignInAt: user.metadata?.lastSignInTime ?? null,
  };
}

/** PII field names scrubbed from retained financial records during erasure. */
const PII_FIELDS = [
  "recipient",
  "createRequest",
  "createResponse",
  "lastWebhookRaw",
  "shippingAddress",
  "customer",
  "billingDetails",
  "email",
  "receiptEmail",
  "name",
  "phone",
];

/** Recursively export every doc under a document's subcollections. */
async function exportSubcollections(
  docPath: string,
): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  const cols = await getFirestore().doc(docPath).listCollections();
  for (const col of cols) {
    const snap = await col.get();
    out[col.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return out;
}

/** Collect authoritative financial records owned by a uid (admin copies). */
async function financialRecordsFor(uid: string): Promise<{
  orders: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
}> {
  const db = getFirestore();
  const [orders, payments, subscriptions] = await Promise.all([
    db.collection("orders").where("ownerUid", "==", uid).get(),
    db.collection("payments").where("ownerUid", "==", uid).get(),
    db.collection("subscriptions").where("ownerUid", "==", uid).get(),
  ]);
  return {
    orders: orders.docs.map((d) => ({ id: d.id, ...d.data() })),
    payments: payments.docs.map((d) => ({ id: d.id, ...d.data() })),
    subscriptions: subscriptions.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

/** Build the full portable data bundle for a user (right to access). */
export async function exportUserData(uid: string): Promise<Record<string, unknown>> {
  ensureAdmin();
  const db = getFirestore();

  let auth: AuthSummary | null = null;
  try {
    auth = authSummary(await getAuth().getUser(uid));
  } catch {
    // Auth user may already be gone; export whatever Firestore has.
  }

  const profileSnap = await db.doc(`users/${uid}`).get();
  const profile = profileSnap.exists ? profileSnap.data() : null;
  const collections = await exportSubcollections(`users/${uid}`);
  const financial = await financialRecordsFor(uid);

  // Storage object inventory (paths only — the bytes are downloadable separately).
  let storageObjects: string[] = [];
  try {
    const [files] = await getStorage()
      .bucket(storageBucketName())
      .getFiles({ prefix: `users/${uid}/` });
    storageObjects = files.map((f) => f.name);
  } catch {
    // best-effort
  }

  return {
    exportedAt: new Date().toISOString(),
    uid,
    auth,
    profile,
    collections,
    financialRecords: financial,
    storageObjects,
  };
}

/** Scrub known PII fields from a retained financial doc, in place. */
function scrubPatch(): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    anonymizedAt: Date.now(),
    anonymized: true,
  };
  for (const f of PII_FIELDS) patch[f] = FieldValue.delete();
  return patch;
}

export interface EraseResult {
  uid: string;
  authDeleted: boolean;
  userTreeDeleted: boolean;
  storageDeleted: boolean;
  ordersAnonymized: number;
  paymentsAnonymized: number;
  subscriptionsAnonymized: number;
  analyticsEventsScrubbed: number;
  errors: string[];
}

/**
 * Erase a user: delete the auth account + the whole user tree + storage, and
 * anonymize (retain) the authoritative financial records. Best-effort per step
 * — a failure in one step is recorded but doesn't abort the others.
 */
export async function eraseUser(uid: string, byUid: string | undefined): Promise<EraseResult> {
  ensureAdmin();
  const db = getFirestore();
  const result: EraseResult = {
    uid,
    authDeleted: false,
    userTreeDeleted: false,
    storageDeleted: false,
    ordersAnonymized: 0,
    paymentsAnonymized: 0,
    subscriptionsAnonymized: 0,
    analyticsEventsScrubbed: 0,
    errors: [],
  };

  // Snapshot a minimal descriptor for the audit log BEFORE deletion.
  let auditEmail: string | null = null;
  try {
    auditEmail = (await getAuth().getUser(uid)).email ?? null;
  } catch {
    /* auth may already be gone */
  }

  // 1) Anonymize retained financial records (orders / payments / subscriptions).
  const patch = scrubPatch();
  for (const [col, key] of [
    ["orders", "ordersAnonymized"],
    ["payments", "paymentsAnonymized"],
    ["subscriptions", "subscriptionsAnonymized"],
  ] as const) {
    try {
      const snap = await db.collection(col).where("ownerUid", "==", uid).get();
      let n = 0;
      for (const chunk of chunkDocs(snap.docs, 400)) {
        const batch = db.batch();
        for (const d of chunk) {
          batch.set(d.ref, patch, { merge: true });
          n++;
        }
        await batch.commit();
      }
      result[key] = n;
    } catch (err) {
      result.errors.push(`${col}: ${errMsg(err)}`);
    }
  }

  // 2) De-identify analytics events for the uid (tombstone, keep counts).
  try {
    const snap = await db.collection("analyticsEvents").where("uid", "==", uid).get();
    let n = 0;
    for (const chunk of chunkDocs(snap.docs, 400)) {
      const batch = db.batch();
      for (const d of chunk) {
        batch.set(d.ref, { uid: "erased", erasedAt: Date.now() }, { merge: true });
        n++;
      }
      await batch.commit();
    }
    result.analyticsEventsScrubbed = n;
  } catch (err) {
    result.errors.push(`analyticsEvents: ${errMsg(err)}`);
  }

  // 3) Delete the whole user tree (profile doc + all subcollections).
  try {
    await db.recursiveDelete(db.doc(`users/${uid}`));
    result.userTreeDeleted = true;
  } catch (err) {
    result.errors.push(`userTree: ${errMsg(err)}`);
  }

  // 4) Delete all Storage objects under the user's prefix.
  try {
    await getStorage().bucket(storageBucketName()).deleteFiles({ prefix: `users/${uid}/` });
    result.storageDeleted = true;
  } catch (err) {
    result.errors.push(`storage: ${errMsg(err)}`);
  }

  // 5) Delete the Firebase Auth account last (so a mid-run failure is retryable).
  try {
    await getAuth().deleteUser(uid);
    result.authDeleted = true;
  } catch (err) {
    result.errors.push(`auth: ${errMsg(err)}`);
  }

  // 6) Append-only audit record (accountability, GDPR Art. 5(2)).
  try {
    await db.collection("adminAudit").add({
      action: "gdpr_erase",
      targetUid: uid,
      targetEmail: auditEmail,
      byUid: byUid ?? null,
      at: Date.now(),
      result: { ...result },
    });
  } catch (err) {
    result.errors.push(`audit: ${errMsg(err)}`);
  }

  return result;
}

function chunkDocs<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerGdprRoutes(app: Express): void {
  const json = express.json({ limit: "16kb" });

  // Look up a user by email (or uid) so the admin can confirm before acting.
  app.get("/admin/users/lookup", async (req: AuthedRequest, res: Response) => {
    try {
      ensureAdmin();
      const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
      const uid = typeof req.query.uid === "string" ? req.query.uid.trim() : "";
      if (!email && !uid) {
        res.status(400).json({ error: { message: "Provide an email or uid." } });
        return;
      }
      const user = uid ? await getAuth().getUser(uid) : await getAuth().getUserByEmail(email);
      res.json({ user: authSummary(user) });
    } catch (err) {
      // getUserByEmail throws when not found — return a clean 404.
      if ((err as { code?: string }).code === "auth/user-not-found") {
        res.status(404).json({ error: { message: "No account found for that email." } });
        return;
      }
      res.status(500).json({ error: { message: errMsg(err) } });
    }
  });

  // Full data export (right to access / portability). Returns a JSON bundle.
  app.get("/admin/users/:uid/export", async (req: AuthedRequest, res: Response) => {
    try {
      const uid = String(req.params.uid);
      const bundle = await exportUserData(uid);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="user-${uid}-export.json"`,
      );
      res.json(bundle);
    } catch (err) {
      res.status(500).json({ error: { message: errMsg(err) } });
    }
  });

  // Erase a user (right to be forgotten). Destructive — the client confirms.
  app.delete("/admin/users/:uid", json, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = String(req.params.uid);
      const result = await eraseUser(uid, req.uid);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { message: errMsg(err) } });
    }
  });
}
