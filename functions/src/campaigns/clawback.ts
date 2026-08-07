/**
 * Reversing campaign payouts whose qualifying purchase went away.
 *
 * If someone buys a print book, earns their Sparks back, and then refunds the
 * book, they've been paid for a sale that didn't happen. This is the other half
 * of every purchase-triggered effect, and it hangs off the same `charge.refunded`
 * handler the referral clawback does.
 *
 * Two rules make it safe to run automatically, both inherited from the referral
 * clawback because the reasoning is identical:
 *
 *   - It NEVER drives a balance below zero. Sparks already spent bought real
 *     provider work; clawing them back would leave a legitimate refunder unable
 *     to generate, which is a worse outcome than eating the loss.
 *   - It's idempotent on the redemption id, so a repeated refund webhook debits
 *     once.
 *
 * An unredeemed discount is revoked; a redeemed one is left alone, since the
 * margin is already gone and revoking it retroactively would mean re-billing a
 * customer who is in the middle of a refund.
 */
import { reverseGrantedSparks } from "../sparks";
import { unmarkRefunded } from "./refund";
import { db, listRedemptionsForQualifyingRef, REDEMPTIONS } from "./store";
import { bumpStat } from "./stats";

/**
 * Reverse every campaign payout that the given payment/invoice qualified.
 * Best-effort and safe to call for refs that earned nothing.
 */
export async function clawbackForRef(ref: string): Promise<void> {
  if (!ref) return;
  try {
    const redemptions = await listRedemptionsForQualifyingRef(ref);
    for (const redemption of redemptions) {
      if (redemption.status !== "granted") continue;
      const doc = db().doc(`${REDEMPTIONS}/${redemption.id}`);

      if (redemption.effect.kind === "sparks" || redemption.effect.kind === "spendRefund") {
        const recovered = await reverseGrantedSparks({
          uid: redemption.uid,
          amount: redemption.sparks,
          reason: `campaign clawback: ${redemption.campaignId}`,
          ref: `campaign_${redemption.id}`,
        });
        // The spend those Sparks were refunded against becomes claimable again —
        // the customer is back where they started, so their history should be too.
        if (redemption.effect.kind === "spendRefund") {
          await unmarkRefunded(redemption.uid, redemption.refundedEntryIds);
        }
        await doc.set(
          {
            status: "clawed_back",
            note:
              recovered >= redemption.sparks
                ? "The qualifying purchase was refunded, so the Sparks were taken back."
                : `The qualifying purchase was refunded. ${recovered} of ${redemption.sparks} Sparks were recovered — the rest had already been spent.`,
          },
          { merge: true },
        );
      } else if (redemption.effect.kind === "purchaseDiscount") {
        if (redemption.redeemedAt > 0) {
          await doc.set(
            { note: "The qualifying purchase was refunded, but this discount had already been used." },
            { merge: true },
          );
          continue;
        }
        await doc.set(
          { status: "clawed_back", note: "The qualifying purchase was refunded, so this discount was withdrawn." },
          { merge: true },
        );
      } else {
        continue;
      }

      await bumpStat(redemption.campaignId, "clawbacks");
    }
  } catch (err) {
    console.warn("[campaigns] clawback failed", ref, err);
  }
}
