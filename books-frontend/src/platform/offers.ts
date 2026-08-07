/**
 * Client access to marketing campaign offers.
 *
 * The server owns every decision: which campaigns exist, who qualifies, what each
 * one promises, what's already been earned. The client renders that and nothing
 * else — no client-side eligibility guessing, because a browser that decides a
 * customer qualifies is a browser that shows them a promise the server won't keep.
 *
 * Both calls soft-fail to empty. An offers panel is an extra on top of the wallet;
 * if it can't load, the wallet still has to work, and a customer who never sees an
 * offer is annoyed while one who sees a broken wallet is blocked.
 */
import { backendFetch } from "./backend";
import type { OfferPreview, OffersOverview } from "../core/config/campaigns";

export type {
  OfferPreview,
  OfferView,
  OffersOverview,
  RedemptionView,
} from "../core/config/campaigns";

const EMPTY: OffersOverview = { enabled: false, offers: [], redemptions: [] };

/**
 * Every offer the caller can see, plus what they've already earned.
 *
 * Reading this ENROLLS them in anything they now qualify for. That's deliberate:
 * enrollment freezes the terms, and the moment a promise is shown is the right
 * moment to freeze it — otherwise an admin edit between reading and acting would
 * change a promise the customer had already been given.
 */
export async function fetchOffers(): Promise<OffersOverview> {
  try {
    const res = await backendFetch("/account/offers");
    if (!res.ok) return EMPTY;
    return (await res.json()) as OffersOverview;
  } catch {
    return EMPTY;
  }
}

/** What a specific action is about to earn, asked BEFORE the action. */
export interface OfferPreviewRequest {
  /** Defaults to `purchase` server-side. */
  trigger?:
    | "purchase"
    | "subscription_started"
    | "subscription_renewed"
    | "survey_completed";
  itemType?: "print" | "ebook" | "pack" | "plan";
  /** Order value in the pricing base currency. */
  amount?: number;
  productId?: string;
  projectId?: string;
  /** For `survey_completed`: which question set is about to be answered. */
  surveyId?: string;
}

/**
 * Speculative preview: "if I buy this, what do I get?"
 *
 * Answered by the same evaluator that pays out, so the sentence shown next to a
 * buy button can't disagree with what lands afterwards. An offer a customer only
 * discovers after checkout isn't marketing, it's a surprise.
 */
export async function previewOffers(
  request: OfferPreviewRequest,
): Promise<OfferPreview[]> {
  try {
    const res = await backendFetch("/account/offers/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { previews?: OfferPreview[] };
    return json.previews ?? [];
  } catch {
    return [];
  }
}
