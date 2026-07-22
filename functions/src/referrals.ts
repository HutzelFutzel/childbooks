/**
 * Referral Sparks — invite links that reward BOTH sides, but only once the
 * referred user makes their first real payment (print order, Spark pack, or
 * subscription invoice). Gating the reward on money movement makes the grant
 * un-farmable: fake accounts never pay, so they never mint Sparks.
 *
 * Data:
 *   - `users/{uid}.referralCode`        — the user's shareable code
 *   - `referralCodes/{code}` → { uid }  — reverse lookup
 *   - `users/{uid}.referredBy`          — set once, when a new user claims a code
 *   - `users/{uid}.referralRewardedAt`  — set when the first-payment reward fired
 */
import { randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getSparksConfig } from "./appConfig";
import { grantSparks } from "./sparks";
import { sendReferralRewardEmail } from "./email/triggers";
import { notifySlack } from "./notify";

function db() {
  ensureAdmin();
  return getFirestore();
}

/** How long after signup a referral code can still be claimed. */
const CLAIM_WINDOW_MS = 14 * 86_400_000;

function newCode(): string {
  // 8 chars, unambiguous alphabet — short enough for a link, big enough space.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Get (or lazily mint) the user's shareable referral code. */
export async function ensureReferralCode(uid: string): Promise<string> {
  const userRef = db().doc(`users/${uid}`);
  const snap = await userRef.get();
  const existing = snap.exists ? (snap.get("referralCode") as string | undefined) : undefined;
  if (existing) return existing;
  // Retry on the (astronomically unlikely) collision.
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const codeRef = db().doc(`referralCodes/${code}`);
    try {
      await codeRef.create({ uid, at: Date.now() });
      await userRef.set({ referralCode: code }, { merge: true });
      return code;
    } catch {
      // taken — try another
    }
  }
  throw new Error("Could not allocate a referral code.");
}

/**
 * Attach a referrer to a (new) account. Idempotent-ish: a second claim is a
 * no-op; self-referrals and stale accounts are rejected softly (return false).
 */
export async function claimReferralCode(uid: string, code: string): Promise<boolean> {
  const clean = code.trim().toLowerCase();
  if (!clean) return false;
  const codeSnap = await db().doc(`referralCodes/${clean}`).get();
  const referrerUid = codeSnap.exists ? (codeSnap.get("uid") as string) : null;
  if (!referrerUid || referrerUid === uid) return false;

  const userRef = db().doc(`users/${uid}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (snap.exists && snap.get("referredBy")) return false; // already attributed
    const createdAt = snap.exists ? (snap.get("createdAt") as number | undefined) : undefined;
    if (typeof createdAt === "number" && Date.now() - createdAt > CLAIM_WINDOW_MS) return false;
    tx.set(userRef, { referredBy: referrerUid, referredAt: Date.now() }, { merge: true });
    return true;
  });
}

/**
 * Fire the referral reward after `uid`'s FIRST successful payment, exactly once.
 * Called from the Stripe webhook on any captured revenue for the user. Safe to
 * call repeatedly (guarded by `referralRewardedAt` + idempotent grant refs).
 */
export async function maybeRewardReferral(uid: string): Promise<void> {
  try {
    const config = await getSparksConfig();
    if (!config.enabled || !config.referral.enabled) return;

    const userRef = db().doc(`users/${uid}`);
    // Atomically claim the "reward fired" flag so concurrent webhooks can't race.
    const claim = await db().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return null;
      const referredBy = snap.get("referredBy") as string | undefined;
      if (!referredBy || snap.get("referralRewardedAt")) return null;
      tx.set(userRef, { referralRewardedAt: Date.now() }, { merge: true });
      return referredBy;
    });
    if (!claim) return;

    if (config.referral.referredSparks > 0) {
      await grantSparks({
        uid,
        amount: config.referral.referredSparks,
        type: "grant",
        reason: "referral:referred",
        source: "referral",
        ref: `referral_${uid}`,
      });
    }
    if (config.referral.referrerSparks > 0) {
      await grantSparks({
        uid: claim,
        amount: config.referral.referrerSparks,
        type: "grant",
        reason: "referral:referrer",
        source: "referral",
        ref: `referral_${uid}`,
      });
    }

    // Notify both sides (best-effort; deduped on the referred user's id).
    if (config.referral.referredSparks > 0) {
      await sendReferralRewardEmail({
        uid,
        sparks: config.referral.referredSparks,
        kind: "referred",
        refUid: uid,
      });
    }
    if (config.referral.referrerSparks > 0) {
      await sendReferralRewardEmail({
        uid: claim,
        sparks: config.referral.referrerSparks,
        kind: "referrer",
        refUid: uid,
      });
    }

    // Growth ping — a referral only pays out after the referred user's first
    // payment, so this is a high-signal event. Deduped on the referred uid (the
    // reward itself is already claimed once via the transaction above).
    await notifySlack({
      channel: "growth",
      ref: `referral_${uid}`,
      text:
        `🤝 Referral paid out — +${config.referral.referredSparks} ✦ to the new user, ` +
        `+${config.referral.referrerSparks} ✦ to their referrer`,
    });
  } catch (err) {
    console.warn("[referrals] reward failed", uid, err);
  }
}
