/**
 * Assembling {@link UserFacts} — the flat bag of primitives every campaign
 * evaluation runs against.
 *
 * There is exactly one assembler because there must be exactly one answer. If
 * the pricing path decided "subscriber" one way and the payout path another, a
 * customer would be quoted an offer they then don't get, which is the single most
 * expensive class of bug in a promotions engine.
 *
 * Facts are cached per-instance for a few seconds: a single render quote can ask
 * for them several times, and none of these fields change within one request.
 */
import { getAuth } from "firebase-admin/auth";
import type { UserFacts } from "../../../books-frontend/src/core/config/campaigns";
import { normalizeBuyerProfile } from "../../../books-frontend/src/core/config/surveys";
import { hasActiveSubscription, resolveActivePlan } from "../plans";
import { db } from "./store";

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { value: UserFacts; at: number }>();

/** Drop a cached snapshot — call after anything that changes eligibility. */
export function invalidateFacts(uid: string): void {
  cache.delete(uid);
}

/**
 * Everything the evaluator needs about one account.
 *
 * Unknown fields are left null/0 rather than guessed. The evaluator treats
 * unknowns as condition FAILURES, so a missing country blocks a country-gated
 * offer instead of opening it to everyone — the safe direction to be wrong.
 */
export async function userFacts(uid: string): Promise<UserFacts> {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const [snap, authUser, subscriber, plan] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    getAuth()
      .getUser(uid)
      .catch(() => null),
    hasActiveSubscription(uid).catch(() => false),
    resolveActivePlan(uid).catch(() => null),
  ]);

  const data = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
  const lifetime = (data.lifetime ?? {}) as Record<string, unknown>;
  const meta = (data.meta ?? {}) as Record<string, unknown>;
  // Survey-derived targeting rides along on the profile read that was happening
  // anyway. Anything needing a second query would be unaffordable here: this
  // function runs on the quote path, several times per render.
  const buyer = normalizeBuyerProfile(data.surveyProfile);

  const value: UserFacts = {
    uid,
    // No Auth record at all is treated as a guest: it's the conservative read,
    // and guests are excluded from almost everything by default.
    anonymous: authUser ? authUser.providerData.length === 0 && !authUser.email : true,
    emailVerified: authUser?.emailVerified === true,
    createdAt: authUser?.metadata.creationTime
      ? Date.parse(authUser.metadata.creationTime)
      : num(meta.firstSeenAt),
    country: typeof data.country === "string" ? data.country : null,
    isSubscriber: subscriber,
    planId: plan?.id ?? null,
    purchaseCount: num(lifetime.purchases ?? data.purchaseCount),
    sparksSpent: num(lifetime.sparksSpent),
    buyerRole: buyer.latestRole,
    buyerRoles: buyer.roles,
    surveyAnswers: buyer.answered,
  };
  cache.set(uid, { value, at: Date.now() });
  return value;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
