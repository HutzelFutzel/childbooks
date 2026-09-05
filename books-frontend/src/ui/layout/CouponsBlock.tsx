"use client";

/**
 * The wallet's coupons panel: discounts this account is holding right now.
 *
 * This exists for one specific failure. A coupon granted automatically — by a QR
 * scan, a campaign audience, a support make-good — has no code, so there is
 * nothing for the customer to hold onto and no moment where they were told. A
 * discount nobody knows about doesn't change behaviour, which means the poster
 * that granted it bought nothing. So it's shown here, with its caveats and its
 * expiry, before checkout rather than inside a receipt.
 *
 * Two deliberate details:
 *
 *   - **The caveats travel with the promise.** "20% off" is not the offer; "20%
 *     off print, one use, ends Sunday" is. Splitting those across a wallet and a
 *     terms page is how a discount becomes a complaint.
 *   - **Spent coupons are listed as savings, not as coupons.** A used code in a
 *     list of available ones is a false promise; the same code under "you've
 *     saved" is a reason to come back.
 *
 * Renders nothing when there's nothing to say — an empty heading in a wallet is
 * worse than no heading.
 */
import { useEffect, useState } from "react";
import { BadgePercent, Tag } from "lucide-react";
import { fetchCoupons, type CouponHistoryEntry, type HeldCoupon } from "../../platform/coupons";

export function CouponsBlock({ open }: { open: boolean }) {
  const [wallet, setWallet] = useState<{
    coupons: HeldCoupon[];
    history: CouponHistoryEntry[];
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Re-fetched on every open, like the offers panel: a coupon can be granted
    // or spent between two openings of the same wallet, and a stale list here
    // either hides a discount or promises a spent one.
    void fetchCoupons().then((next) => {
      if (!cancelled) setWallet(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!wallet) return null;

  const usable = wallet.coupons.filter((c) => c.blockedReason === null);
  const saved = wallet.history.reduce((sum, h) => sum + h.discountAmount, 0);

  if (usable.length === 0 && wallet.history.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        Discounts
      </div>

      {usable.map((coupon) => (
        <CouponRow key={coupon.couponId} coupon={coupon} />
      ))}

      {wallet.history.length > 0 && (
        <p className="text-[11px] text-ink-400">
          You&apos;ve saved {money(saved, wallet.history[0]!.currency)} with{" "}
          {wallet.history.length === 1 ? "a discount" : `${wallet.history.length} discounts`} so far.
        </p>
      )}
    </div>
  );
}

function CouponRow({ coupon }: { coupon: HeldCoupon }) {
  return (
    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
      <div className="flex items-start gap-1.5">
        {coupon.automatic ? (
          <BadgePercent className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <Tag className="mt-0.5 size-3.5 shrink-0" />
        )}
        <div className="min-w-0">
          <span className="font-semibold">{coupon.summary}</span>
          <span className="block text-emerald-700/80">
            {coupon.automatic
              ? "Applies automatically at checkout — there's no code to enter."
              : `Enter ${coupon.code} at checkout.`}
            {coupon.endsAt > 0 ? ` Use it by ${new Date(coupon.endsAt).toLocaleDateString()}.` : ""}
          </span>
          {coupon.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-emerald-700/70">
              {coupon.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          )}
          {coupon.usesLeft !== null && coupon.usesLeft > 1 && (
            <span className="mt-1 block text-emerald-700/60">
              {coupon.usesLeft} uses left.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
