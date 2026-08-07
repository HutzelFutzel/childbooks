"use client";

/**
 * The wallet's offers panel: what's on right now, and what's already been earned.
 *
 * Two lists, and the split matters more than it looks. **Earned** things are
 * concrete — a discount waiting at checkout, Sparks already added — so they lead,
 * with their expiry, because an unused reward that lapses silently is worse than
 * never having been offered one. **Running** offers come second and are phrased as
 * conditions ("when your order is complete"), because that's what they are.
 *
 * Every sentence here is generated server-side from the campaign's own rules, and
 * the caveats come with it. The alternative — a headline here and the caps in the
 * terms page — is how "get your Sparks back" becomes a chargeback.
 *
 * Renders nothing at all when there's nothing to say. An empty "Offers" heading in
 * a wallet is worse than no heading.
 */
import { useEffect, useState } from "react";
import { BadgePercent, Clock, Sparkles } from "lucide-react";
import {
  fetchOffers,
  type OfferView,
  type OffersOverview,
  type RedemptionView,
} from "../../platform/offers";

export function OffersBlock({ open }: { open: boolean }) {
  const [overview, setOverview] = useState<OffersOverview | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Deliberately re-fetched on every open rather than cached: reading this
    // enrolls the caller, and a stale list could show an offer that has since
    // closed or hide a reward that has since landed.
    void fetchOffers().then((next) => {
      if (!cancelled) setOverview(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!overview?.enabled) return null;

  // Held-for-review payouts are shown (a customer who earned something should
  // know it's coming) but voided ones aren't — there's nothing useful to say
  // about a reward that will never arrive.
  const earned = overview.redemptions.filter(
    (r) => (r.status === "granted" && !r.used) || r.status === "review",
  );
  const running = overview.offers.filter((o) => o.blockedReason === null);

  if (earned.length === 0 && running.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        Offers
      </div>

      {earned.map((redemption) => (
        <EarnedRow key={redemption.id} redemption={redemption} />
      ))}

      {running.map((offer) => (
        <OfferRow key={offer.campaignId} offer={offer} />
      ))}
    </div>
  );
}

function EarnedRow({ redemption }: { redemption: RedemptionView }) {
  const pending = redemption.status === "review";
  return (
    <div
      className={
        pending
          ? "rounded-lg bg-ink-50/70 px-3 py-2 text-[11px] text-ink-600"
          : "rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800"
      }
    >
      <div className="flex items-start gap-1.5">
        {pending ? (
          <Clock className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <BadgePercent className="mt-0.5 size-3.5 shrink-0" />
        )}
        <div className="min-w-0">
          <span className="font-semibold">{redemption.summary}</span>
          {pending ? (
            <span className="block text-ink-500">
              On its way — we check these by hand, so give it a day or two.
            </span>
          ) : (
            <span className="block text-emerald-700/80">
              Applies automatically at checkout — there&apos;s no code to enter.
              {redemption.expiresAt
                ? ` Use it by ${new Date(redemption.expiresAt).toLocaleDateString()}.`
                : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function OfferRow({ offer }: { offer: OfferView }) {
  return (
    <div className="rounded-lg bg-brand-50/70 px-3 py-2 text-[11px] text-brand-900">
      <div className="flex items-start gap-1.5">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
        <div className="min-w-0">
          <span className="font-semibold">
            {offer.headline || offer.summary}
          </span>
          {offer.headline &&
            offer.summary &&
            offer.headline !== offer.summary && (
              <span className="block text-brand-800/80">{offer.summary}</span>
            )}
          {offer.subline && (
            <span className="block text-brand-800/70">{offer.subline}</span>
          )}
          {offer.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-brand-800/60">
              {offer.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          )}
          {offer.endsAt > 0 && (
            <span className="mt-1 block text-brand-800/60">
              Ends {new Date(offer.endsAt).toLocaleDateString()}.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
