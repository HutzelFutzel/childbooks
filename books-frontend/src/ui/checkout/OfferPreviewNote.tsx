"use client";

/**
 * "If you buy this, here's what you also get" — shown next to a total, before the
 * button.
 *
 * This is the difference between marketing and a surprise. A campaign that
 * refunds Sparks on a print order is only persuasive if the customer knows about
 * it while they're deciding; discovering it in a receipt is a pleasant accident
 * that changed nobody's mind.
 *
 * The sentence comes from the server, computed by the same evaluator that will
 * actually pay out, so it cannot promise something the payout won't deliver. The
 * client contributes nothing but the question.
 *
 * Debounced, because the totals it keys off are re-quoted as the customer changes
 * copies and shipping, and each change would otherwise be a round trip. It renders
 * nothing while it waits: a flickering "you'll get…" line under a price that's
 * also moving is worse than a line that appears a moment late.
 */
import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import {
  previewOffers,
  type OfferPreview,
  type OfferPreviewRequest,
} from "../../platform/offers";
import { useAuthStore } from "../../state/authStore";

export function OfferPreviewNote({
  itemType,
  amount,
  productId,
  projectId,
  trigger = "purchase",
  className = "",
}: OfferPreviewRequest & { className?: string }) {
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const [previews, setPreviews] = useState<OfferPreview[]>([]);

  const canEarn = accessLevel === "full";

  useEffect(() => {
    if (!canEarn) {
      setPreviews([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewOffers({
        trigger,
        itemType,
        amount,
        productId,
        projectId,
      }).then((next) => {
        if (!cancelled) setPreviews(next);
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canEarn, trigger, itemType, amount, productId, projectId]);

  if (previews.length === 0) return null;

  return (
    <div
      className={`space-y-1 rounded-lg bg-emerald-50 px-2.5 py-2 ${className}`}
    >
      {previews.map((preview) => (
        <p
          key={preview.campaignId}
          className="flex items-start gap-1.5 text-xs text-emerald-800"
        >
          <Gift className="mt-0.5 size-3.5 shrink-0" />
          <span>{preview.message}</span>
        </p>
      ))}
    </div>
  );
}
