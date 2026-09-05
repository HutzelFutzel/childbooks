/**
 * Client access to coupons.
 *
 * Two calls, and neither of them decides anything. The server owns which coupons
 * exist, who holds one, and whether a typed string is real — a browser that
 * decided a code was valid would be showing a discount the checkout is about to
 * refuse, which is worse than refusing it up front.
 *
 * The asymmetry in failure handling is deliberate:
 *
 *   - {@link fetchCoupons} soft-fails to empty. The wallet has to render even if
 *     this endpoint is down; a customer who can't see their coupon is annoyed,
 *     one who can't see their Sparks is blocked.
 *   - {@link checkCouponCode} soft-fails to a REFUSAL with an honest message. It
 *     runs while somebody is waiting with their finger on a button, and "we
 *     couldn't check that" is the truth, where silently accepting it would take
 *     them to a checkout that drops the discount without explanation.
 *
 * Note what isn't here: nothing applies a coupon. Applying happens inside the
 * checkout request itself, where the code is re-validated and reserved in the
 * same transaction that prices the order. A separate "apply" call would leave
 * the client holding a promise the server never made.
 */
import { backendFetch } from "./backend";
import type { CouponAcceptance, CouponRejectionReason } from "../core/config/coupons";

/** One discount the customer currently holds, as the server describes it. */
export interface HeldCoupon {
  couponId: string;
  /** Present only when there's a code they'd type. */
  code: string | null;
  summary: string;
  notes: string[];
  /** 0 = open-ended. */
  endsAt: number;
  /** Null = uncapped. */
  usesLeft: number | null;
  /** True when it applies itself with nothing to enter. */
  automatic: boolean;
  /** Set when it can't be used right now, phrased for them to read. */
  blockedReason: string | null;
}

/** One coupon they've already spent, for the "you saved…" list. */
export interface CouponHistoryEntry {
  couponName: string;
  summary: string;
  code: string | null;
  discountAmount: number;
  currency: string;
  at: number;
}

export interface CouponWallet {
  coupons: HeldCoupon[];
  history: CouponHistoryEntry[];
}

const EMPTY: CouponWallet = { coupons: [], history: [] };

/** Everything the signed-in customer holds, plus what they've already used. */
export async function fetchCoupons(): Promise<CouponWallet> {
  try {
    const res = await backendFetch("/account/coupons");
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as Partial<CouponWallet>;
    return { coupons: json.coupons ?? [], history: json.history ?? [] };
  } catch {
    return EMPTY;
  }
}

/**
 * A refusal, including the one reason that isn't a coupon rule: `throttled`,
 * returned when an account has tried too many codes in a short window.
 */
export interface CouponCheckRefused {
  ok: false;
  reason: CouponRejectionReason | "throttled";
  message: string;
}

/** The verdict, exactly as the evaluator produced it. */
export type CouponCheck = CouponAcceptance | CouponCheckRefused;

/**
 * Would this code work on this purchase, and what would it save?
 *
 * Quoted in money rather than a percentage, because "20% off" against a subtotal
 * the customer is still assembling is a promise they can't check. The subtotal
 * passed in must be the same one on screen.
 */
export async function checkCouponCode(input: {
  code: string;
  itemType: "print" | "ebook" | "pack" | "plan";
  subtotal: number;
  currency: string;
  productId?: string;
  country?: string;
}): Promise<CouponCheck> {
  try {
    const res = await backendFetch("/account/coupons/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => null)) as CouponCheck | null;
    if (!json || typeof json.ok !== "boolean") {
      return {
        ok: false,
        reason: "unknown_code",
        message: "We couldn't check that code just now. Please try again.",
      };
    }
    return json;
  } catch {
    return {
      ok: false,
      reason: "unknown_code",
      message: "We couldn't check that code just now. Please try again.",
    };
  }
}
