/**
 * Server-side usage quotas. Turns a plan's {@link PlanEntitlements.limits} into
 * enforced counters so capabilities like "max AI edits per book" actually cap.
 *
 * Counters live at `users/{uid}/quotaCounters/{quotaId}__{scopeId}` (the `__`
 * join avoids Firestore's ban on `/` in document ids). The flow at a chokepoint
 * is: {@link ensureWithinQuota} *before* the operation (throws when at the cap),
 * then {@link incrementQuota} *after* it succeeds — so failed attempts don't
 * burn the user's allowance. The check-then-increment is intentionally non-
 * atomic: a tiny overage under concurrent edits is fine for a soft product
 * limit (mirrors how Sparks tolerates a small negative buffer).
 *
 * When a quota resolves to `null` (unlimited / unconfigured) everything is a
 * no-op, so nothing changes until an admin sets a cap on a plan.
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { resolveActivePlan } from "./plans";
import { quotaLimit } from "../../books-frontend/src/core/config/entitlements";
import { quotaDef, type QuotaId } from "../../books-frontend/src/core/config/quotas";

/** Thrown when a user is already at their plan's cap for a quota. */
export class QuotaExceeded extends Error {
  constructor(
    public readonly quotaId: string,
    public readonly limit: number,
  ) {
    super("You've reached your plan's limit for this. Upgrade your plan to do more.");
    this.name = "QuotaExceeded";
  }
}

function db() {
  ensureAdmin();
  return getFirestore();
}

function counterRef(uid: string, quotaId: string, scopeId: string) {
  const id = `${quotaId}__${scopeId}`.replace(/\//g, "_");
  return db().doc(`users/${uid}/quotaCounters/${id}`);
}

/** Effective cap for a user's plan: a number, or `null` for unlimited. */
export async function resolveQuotaLimit(uid: string, quotaId: QuotaId): Promise<number | null> {
  const def = quotaDef(quotaId);
  const plan = await resolveActivePlan(uid);
  return quotaLimit(plan?.entitlements ?? null, quotaId, def?.defaultLimit ?? null);
}

/** Current counter value (0 when absent). */
export async function getQuotaCount(uid: string, quotaId: QuotaId, scopeId: string): Promise<number> {
  const snap = await counterRef(uid, quotaId, scopeId).get();
  const v = snap.exists ? (snap.get("count") as unknown) : 0;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Throw {@link QuotaExceeded} when already at/over the cap. No-op when unlimited. */
export async function ensureWithinQuota(
  uid: string,
  quotaId: QuotaId,
  scopeId: string,
): Promise<void> {
  const limit = await resolveQuotaLimit(uid, quotaId);
  if (limit == null) return;
  const count = await getQuotaCount(uid, quotaId, scopeId);
  if (count >= limit) throw new QuotaExceeded(quotaId, limit);
}

/** Increment a counter (call after the gated operation succeeds). */
export async function incrementQuota(
  uid: string,
  quotaId: QuotaId,
  scopeId: string,
  by = 1,
): Promise<void> {
  await counterRef(uid, quotaId, scopeId).set(
    { quotaId, scopeId, count: FieldValue.increment(by), updatedAt: Date.now() },
    { merge: true },
  );
}
