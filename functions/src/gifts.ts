/**
 * Gift Sparks — a buyer pays for a Spark pack that someone ELSE redeems with a
 * claim code. The gift is created only after Stripe confirms payment (webhook);
 * claiming grants the Sparks to the claimant as a PAID lot (it's real revenue).
 *
 * Data: `sparkGifts/{code}` → { sparks, usdPerSpark, buyerUid, recipientEmail?,
 * message?, paymentId, status: "pending" | "claimed", claimedBy?, claimedAt? }.
 */
import { randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { grantSparks } from "./sparks";
import { sendGiftClaimedEmail } from "./email/triggers";

function db() {
  ensureAdmin();
  return getFirestore();
}

export function newGiftCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out; // e.g. "K3ZQ-8MHW-P2XA"
}

/** Persist a paid gift so it can be claimed. Idempotent on the payment id. */
export async function createPaidGift(args: {
  code: string;
  sparks: number;
  usdPerSpark: number | null;
  buyerUid: string;
  recipientEmail?: string | null;
  message?: string | null;
  paymentId: string;
}): Promise<void> {
  const ref = db().doc(`sparkGifts/${args.code}`);
  try {
    await ref.create({
      sparks: args.sparks,
      usdPerSpark: args.usdPerSpark,
      buyerUid: args.buyerUid,
      recipientEmail: args.recipientEmail ?? null,
      message: args.message ?? null,
      paymentId: args.paymentId,
      status: "pending",
      createdAt: Date.now(),
    });
  } catch (err) {
    const codeNum = (err as { code?: number }).code;
    if (codeNum === 6) return; // already created (webhook retry)
    throw err;
  }
}

export interface GiftSummary {
  code: string;
  sparks: number;
  status: "pending" | "claimed";
  recipientEmail: string | null;
  message: string | null;
  createdAt: number;
  claimedAt: number | null;
}

/** The gifts a user has BOUGHT (so the buyer can copy/share the claim codes). */
export async function listGiftsBought(uid: string): Promise<GiftSummary[]> {
  const snap = await db().collection("sparkGifts").where("buyerUid", "==", uid).limit(50).get();
  return snap.docs
    .map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      return {
        code: doc.id,
        sparks: (d.sparks as number) ?? 0,
        status: d.status === "claimed" ? ("claimed" as const) : ("pending" as const),
        recipientEmail: (d.recipientEmail as string) ?? null,
        message: (d.message as string) ?? null,
        createdAt: (d.createdAt as number) ?? 0,
        claimedAt: (d.claimedAt as number) ?? null,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Redeem a gift code for the calling user. Atomically flips the gift to
 * `claimed`, then grants the Sparks (idempotent on the gift code, so a crash
 * between the two steps self-heals on retry). Returns the Sparks granted.
 */
export async function claimGift(uid: string, code: string): Promise<number> {
  const clean = code.trim().toUpperCase();
  if (!clean) throw new Error("Enter a gift code.");
  const ref = db().doc(`sparkGifts/${clean}`);
  const gift = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("That gift code doesn't exist.");
    const d = snap.data() as Record<string, unknown>;
    const status = d.status as string;
    if (status === "claimed") {
      // Idempotent for the SAME claimant (crash recovery); an error for others.
      if ((d.claimedBy as string) === uid) {
        return { sparks: (d.sparks as number) ?? 0, usdPerSpark: (d.usdPerSpark as number) ?? null };
      }
      throw new Error("This gift has already been claimed.");
    }
    tx.set(ref, { status: "claimed", claimedBy: uid, claimedAt: Date.now() }, { merge: true });
    return { sparks: (d.sparks as number) ?? 0, usdPerSpark: (d.usdPerSpark as number) ?? null };
  });

  if (gift.sparks > 0) {
    await grantSparks({
      uid,
      amount: gift.sparks,
      type: "purchase",
      reason: "gift",
      source: "gift",
      usdPerSpark: gift.usdPerSpark,
      ref: `gift_${clean}`,
    });
    // Confirm the redemption to the claimant (best-effort, deduped on the code).
    await sendGiftClaimedEmail({ uid, sparks: gift.sparks, code: clean });
  }
  return gift.sparks;
}
