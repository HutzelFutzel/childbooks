/**
 * **Coupons** — the typed-code half of the promotions story.
 *
 * Campaigns already hand out discounts that apply themselves at checkout with
 * nothing to type (see `campaigns.ts`). This module is for the other shape: a
 * code a human was given and enters, on a poster, in an email, in a podcast
 * read-out. The two are deliberately separate systems that meet in exactly one
 * place — the checkout discount resolver — because they fail differently. An
 * automatic discount that silently doesn't apply is invisible; a code somebody
 * typed that silently doesn't apply is a support ticket, so almost everything
 * here exists to produce an honest, showable REASON.
 *
 * Four ideas carry the design:
 *
 *   1. **Definition, code, grant and redemption are four different things.**
 *      A {@link Coupon} is the offer ("20% off print books"). A
 *      {@link CouponCodeRecord} is a string that unlocks it — there may be one
 *      shared code or ten thousand generated ones. A grant is "this account is
 *      entitled to it" (how an auto-applied coupon reaches someone who never
 *      typed anything). A redemption is one application to one payment. Collapsing
 *      any two of these is what makes coupon systems impossible to extend later.
 *
 *   2. **Percentages only, for now.** Every guardrail in this codebase is
 *      expressed as a percentage — `maxDiscountPct`, `breakEvenDiscountPct`,
 *      `safeMaxDiscountPct`, the whole `discountImpact` waterfall. A fixed-amount
 *      coupon needs a per-currency table, can exceed the item price, and has to
 *      respect `floorPrice`; free shipping isn't a price discount at all (shipping
 *      revenue offsets shipping cost in the margin model). Both are real features
 *      and both need their own cost model, so {@link CouponMechanic} is a union
 *      with one member rather than a bare number — the extension point is here,
 *      unimplemented on purpose.
 *
 *   3. **Every refusal has a machine reason AND a sentence.** {@link CouponRejection}
 *      carries a stable `reason` (so the admin report can say WHY codes are
 *      bouncing) and customer-facing copy (so the checkout can say it out loud).
 *      {@link describeRejection} is an exhaustive switch: a new reason without
 *      copy is a compile error.
 *
 *   4. **Terms are frozen on grant/reserve, never re-derived.** Same lesson the
 *      campaign engine already learned: editing a live coupon must not change
 *      what somebody has already been promised.
 *
 * SAFETY: coupons ship as an empty list behind a master switch, every coupon
 * starts as a `draft`, and the percentage is clamped again at checkout against
 * the catalog maximum and remaining break-even headroom.
 *
 * Pure module: no React, no Firebase, no Node APIs (imported by both the
 * dashboard and `functions/`).
 */
import { z } from "zod";
import { DISCOUNT_ITEM_LABELS, type DiscountItemType } from "./discountImpact";

/** Every item type a coupon can apply to, in admin-display order. */
export const COUPON_ITEM_TYPES: DiscountItemType[] = ["print", "ebook", "pack", "plan"];

// ---- Codes ------------------------------------------------------------------

/**
 * Characters generated codes are drawn from: upper-case alphanumerics with the
 * four shapes people mis-transcribe removed (`0`/`O`, `1`/`I`). A coupon code
 * gets read off a printed poster and typed by hand, so an unambiguous alphabet
 * is worth more than four extra characters of entropy.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Longest code we'll store or compare. */
export const MAX_COUPON_CODE_LENGTH = 32;

/**
 * Fold a typed code to its canonical form: upper-cased, with everything that
 * isn't alphanumeric dropped.
 *
 * Dropping separators rather than requiring them is what makes `welcome-20`,
 * `WELCOME 20` and `welcome20` the same code. Lookups are ALWAYS done on this
 * form — a coupon store keyed on raw input is a store where half your customers
 * can't redeem.
 */
export function normalizeCouponCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, MAX_COUPON_CODE_LENGTH);
}

/** Is this plausibly a code at all? Cheap pre-check before any lookup. */
export function isPlausibleCouponCode(input: string): boolean {
  const code = normalizeCouponCode(input);
  return code.length >= 4 && code.length <= MAX_COUPON_CODE_LENGTH;
}

/**
 * Group a code for DISPLAY (`K3ZQ8MHW` → `K3ZQ-8MHW`). Display only — never
 * store or compare this form.
 */
export function formatCouponCode(code: string, groupSize = 4): string {
  const normalized = normalizeCouponCode(code);
  if (normalized.length <= groupSize) return normalized;
  const groups: string[] = [];
  for (let i = 0; i < normalized.length; i += groupSize) {
    groups.push(normalized.slice(i, i + groupSize));
  }
  return groups.join("-");
}

/**
 * A single-use code, unguessable by construction.
 *
 * `randomInt` is injected so the backend can pass a CSPRNG and the invariant
 * script can pass a seeded generator. Generated codes must not be guessable:
 * one leaked-by-enumeration code is one free order.
 */
export function generateCouponCode(
  randomInt: (maxExclusive: number) => number,
  length = 10,
  prefix = "",
): string {
  const size = Math.max(6, Math.min(MAX_COUPON_CODE_LENGTH, length));
  let out = "";
  for (let i = 0; i < size; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return normalizeCouponCode(`${prefix}${out}`);
}

/**
 * Mask a code for anywhere it shouldn't be readable in full — an admin list of
 * personalized codes, a Slack ping, a log line. Keeps the tail so a support
 * conversation can still match "the one ending 8MHW".
 */
export function maskCouponCode(code: string): string {
  const normalized = normalizeCouponCode(code);
  if (normalized.length <= 4) return "••••";
  return `••••${normalized.slice(-4)}`;
}

// ---- Mechanic ---------------------------------------------------------------

/**
 * What the coupon takes off.
 *
 * A union with one member: see idea (2) in the module docstring. `fixedAmount`
 * and `freeShipping` belong here and are deliberately absent until they have a
 * cost model — adding them means teaching {@link couponDiscountPercent},
 * {@link describeMechanic} and the margin engine about them, and the compiler
 * will list every site.
 */
export interface PercentOffMechanic {
  kind: "percentOff";
  percentOff: number;
  /**
   * Optional ceiling on the money taken off, in the pricing base currency
   * (0 = none). This is what makes "20% off" safe to publish without knowing
   * what the customer will put in the basket.
   */
  maxDiscountAmount: number;
}

export type CouponMechanic = PercentOffMechanic;

export type CouponMechanicKind = CouponMechanic["kind"];

export const COUPON_MECHANIC_KINDS: CouponMechanicKind[] = ["percentOff"];

export const COUPON_MECHANIC_LABELS: Record<CouponMechanicKind, string> = {
  percentOff: "Percentage off",
};

export function createMechanic(kind: CouponMechanicKind = "percentOff"): CouponMechanic {
  switch (kind) {
    case "percentOff":
      return { kind, percentOff: 10, maxDiscountAmount: 0 };
  }
}

/** Plain-language description of the mechanic, for customer-facing copy. */
export function describeMechanic(mechanic: CouponMechanic, items: DiscountItemType[]): string {
  switch (mechanic.kind) {
    case "percentOff": {
      const scope = describeItemScope(items);
      const base = `${mechanic.percentOff}% off ${scope}`;
      return mechanic.maxDiscountAmount > 0
        ? `${base} (up to ${mechanic.maxDiscountAmount})`
        : base;
    }
  }
}

function describeItemScope(items: DiscountItemType[]): string {
  if (items.length === 0 || items.length >= COUPON_ITEM_TYPES.length) return "anything you buy";
  return joinList(items.map((t) => `${DISCOUNT_ITEM_LABELS[t].toLowerCase()}s`));
}

function joinList(parts: string[], conjunction = "and"): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} ${conjunction} ${parts[parts.length - 1]}`;
}

// ---- Issuance ---------------------------------------------------------------

/**
 * How a coupon REACHES a customer. Separating this from the mechanic is what
 * lets one offer be a poster QR, a printed fallback code and a support
 * make-good at the same time, reported together.
 *
 *   - `sharedCode`     one code everybody types (`WELCOME20`).
 *   - `generatedCodes` a batch of single-use codes, each its own record.
 *   - `autoGrant`      no code at all: an audience rule entitles the account and
 *                      the discount applies itself, exactly like a campaign
 *                      offer. This is the channel a QR-code arrival feeds.
 *   - `adminGrant`     an owner hands it to one named account (make-goods).
 */
export const COUPON_ISSUANCE_KINDS = [
  "sharedCode",
  "generatedCodes",
  "autoGrant",
  "adminGrant",
] as const;

export type CouponIssuanceKind = (typeof COUPON_ISSUANCE_KINDS)[number];

export const COUPON_ISSUANCE_LABELS: Record<CouponIssuanceKind, string> = {
  sharedCode: "One shared code",
  generatedCodes: "Generated single-use codes",
  autoGrant: "Applied automatically (no code)",
  adminGrant: "Granted by an owner",
};

export const COUPON_ISSUANCE_DESCRIPTIONS: Record<CouponIssuanceKind, string> = {
  sharedCode:
    "A single code anyone can type. Treat it as public the moment it's printed or posted — cap it per account and overall.",
  generatedCodes:
    "A batch of unguessable one-time codes. Use these when each code should belong to one person.",
  autoGrant:
    "No code. Accounts matching the audience below are entitled to it and it applies itself at checkout, the same way a campaign offer does.",
  adminGrant:
    "Nobody earns this automatically — an owner attaches it to one account, usually to make something right.",
};

/** True when this issuance channel involves a code a customer types. */
export function issuanceUsesCodes(kind: CouponIssuanceKind): boolean {
  return kind === "sharedCode" || kind === "generatedCodes";
}

/**
 * Who an `autoGrant` coupon is for.
 *
 * `arrivedVia` is the QR/link case: the account's recorded acquisition source
 * (see `core/profile/acquisition`) must match one of these tokens. Everything
 * else mirrors the campaign audience so the two engines agree about what a
 * "new account in Germany" means.
 */
export interface CouponAudience {
  /** Acquisition source tokens (QR ids, link tokens). Empty = any arrival. */
  arrivedVia: string[];
  /** Only accounts created in this window (0/0 = any). */
  signedUpFrom: number;
  signedUpTo: number;
  /** Only these accounts. The escape hatch for `adminGrant` and pilots. */
  allowlistUids: string[];
}

export function createAudience(): CouponAudience {
  return { arrivedVia: [], signedUpFrom: 0, signedUpTo: 0, allowlistUids: [] };
}

// ---- Restrictions -----------------------------------------------------------

/**
 * Everything that can stop a coupon applying.
 *
 * Flat and fully-populated rather than optional-everywhere: a restriction that
 * reads as absent when it's really unset is how a coupon comes to be honored
 * more widely than its author believed.
 */
export interface CouponRestrictions {
  /** Inclusive start, ms epoch (0 = as soon as it's active). */
  startsAt: number;
  /** Inclusive end, ms epoch (0 = open-ended). */
  endsAt: number;
  /** Item types it may be redeemed against (empty = all). */
  itemTypes: DiscountItemType[];
  /** Catalog product ids / plan ids / pack ids (empty = all). */
  productIds: string[];
  /** ISO-4217 currencies (empty = all). */
  currencies: string[];
  /** ISO-3166 alpha-2 billing/shipping countries (empty = anywhere). */
  countries: string[];
  /** Minimum eligible subtotal, in the CHARGED currency. 0 = no minimum. */
  minSubtotal: number;
  /** Redemptions across all accounts (0 = unlimited) — the "first 100" cap. */
  maxRedemptions: number;
  /** Redemptions per account (0 = unlimited). */
  maxPerAccount: number;
  /** Redemptions per individual code (0 = unlimited; 1 for single-use). */
  maxPerCode: number;
  /**
   * Discount spend ceiling for the coupon's whole life, in the pricing base
   * currency (0 = unlimited). The circuit breaker between a mispriced coupon
   * and an unbounded bill.
   */
  lifetimeBudget: number;
  /** Discount spend ceiling per UTC day (0 = unlimited). */
  dailyBudget: number;
  /** Their first ever purchase only. */
  firstPurchaseOnly: boolean;
  /** Require a verified email (strongly recommended). */
  requireVerified: boolean;
  /** Let anonymous guest sessions redeem. Almost always wrong. */
  allowGuests: boolean;
  /** Account age bounds in days (0 = unbounded on that side). */
  minAccountAgeDays: number;
  maxAccountAgeDays: number;
  /** `any` | members only | non-members only. */
  subscriberScope: "any" | "subscribers" | "nonSubscribers";
  /** Only these plan ids (empty = any plan). */
  planIds: string[];
  /**
   * Whether this coupon may combine with an EARNED discount (a referral reward
   * or campaign offer). False means the resolver picks exactly one — see
   * {@link resolveBestDiscount}.
   */
  stackable: boolean;
  /** Higher wins when two non-stackable offers collide. */
  priority: number;
  /**
   * What happens to a consumed redemption when the payment is refunded.
   *
   *   - `restoreOnFullRefund` — give the use back only if everything came back.
   *     Matches how referral/campaign clawback already behaves.
   *   - `restoreAlways`       — give it back on any refund, partial included.
   *   - `consume`             — spent is spent. The right answer for a make-good.
   */
  refundPolicy: "restoreOnFullRefund" | "restoreAlways" | "consume";
}

export function createRestrictions(): CouponRestrictions {
  return {
    startsAt: 0,
    endsAt: 0,
    itemTypes: [],
    productIds: [],
    currencies: [],
    countries: [],
    minSubtotal: 0,
    maxRedemptions: 0,
    maxPerAccount: 1,
    maxPerCode: 0,
    lifetimeBudget: 0,
    dailyBudget: 250,
    firstPurchaseOnly: false,
    requireVerified: true,
    allowGuests: false,
    minAccountAgeDays: 0,
    maxAccountAgeDays: 0,
    subscriberScope: "any",
    planIds: [],
    stackable: false,
    priority: 0,
    refundPolicy: "restoreOnFullRefund",
  };
}

/** Every caveat a restriction set implies, phrased for a customer to read. */
export function describeRestrictions(r: CouponRestrictions): string[] {
  const notes: string[] = [];
  if (r.minSubtotal > 0) notes.push(`on orders over ${r.minSubtotal}`);
  if (r.itemTypes.length > 0 && r.itemTypes.length < COUPON_ITEM_TYPES.length) {
    notes.push(`only on ${describeItemScope(r.itemTypes)}`);
  }
  if (r.productIds.length > 0) notes.push("on selected products only");
  if (r.firstPurchaseOnly) notes.push("on your first order only");
  if (r.countries.length > 0) notes.push(`in ${joinList(r.countries, "or")}`);
  if (r.subscriberScope === "subscribers") notes.push("for members only");
  if (r.subscriberScope === "nonSubscribers") notes.push("for non-members only");
  if (r.planIds.length > 0) notes.push(`on the ${joinList(r.planIds, "or")} plan`);
  if (r.requireVerified) notes.push("once your email is confirmed");
  if (r.maxPerAccount === 1) notes.push("one use per account");
  else if (r.maxPerAccount > 1) notes.push(`up to ${r.maxPerAccount} uses per account`);
  if (r.endsAt > 0) notes.push("while the offer lasts");
  if (!r.stackable) notes.push("can't be combined with another offer");
  return notes;
}

// ---- Coupon -----------------------------------------------------------------

/**
 * `draft` never validates. `active` validates and redeems. `paused` refuses new
 * redemptions but keeps existing grants readable. `ended` is the archive state,
 * set automatically once the window closes.
 */
export type CouponStatus = "draft" | "active" | "paused" | "ended";

export const COUPON_STATUS_LABELS: Record<CouponStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
};

export interface Coupon {
  id: string;
  /** Admin-facing name. Never shown to customers. */
  name: string;
  /** Admin-facing note: why this exists, where it's printed, who asked for it. */
  notes: string;
  status: CouponStatus;
  issuance: CouponIssuanceKind;
  /**
   * The shared code, for `sharedCode` issuance. Stored NORMALIZED. Empty for
   * every other channel.
   */
  sharedCode: string;
  mechanic: CouponMechanic;
  restrictions: CouponRestrictions;
  /** Who gets it automatically (`autoGrant`/`adminGrant` only). */
  audience: CouponAudience;
  /**
   * Customer-facing copy. Optional override — leave it empty and the headline is
   * generated from the mechanic, which is the version that can't drift out of
   * sync with what actually comes off the price.
   */
  presentation: { headline: string; subline: string };
  createdAt: number;
  updatedAt: number;
}

/** Hard cap, so validation on the checkout path stays a cheap in-memory scan. */
export const MAX_COUPONS = 200;

export function createCoupon(partial?: Partial<Coupon>): Coupon {
  const now = Date.now();
  return {
    id:
      typeof partial?.id === "string" && partial.id.trim()
        ? partial.id.trim()
        : `coupon-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: partial?.name ?? "Untitled coupon",
    notes: partial?.notes ?? "",
    status: partial?.status ?? "draft",
    issuance: partial?.issuance ?? "sharedCode",
    sharedCode: normalizeCouponCode(partial?.sharedCode ?? ""),
    mechanic: partial?.mechanic ?? createMechanic(),
    restrictions: partial?.restrictions ?? createRestrictions(),
    audience: partial?.audience ?? createAudience(),
    presentation: partial?.presentation ?? { headline: "", subline: "" },
    createdAt: partial?.createdAt ?? now,
    updatedAt: now,
  };
}

export interface CouponsConfig {
  version: 1;
  /** Master switch. Off ⇒ no code validates and nothing auto-grants. */
  enabled: boolean;
  coupons: Coupon[];
  updatedAt: number;
}

/** The engine ships on but empty — an empty list is a no-op everywhere. */
export function createDefaultCouponsConfig(): CouponsConfig {
  return { version: 1, enabled: false, coupons: [], updatedAt: 0 };
}

/** The one-sentence promise, generated unless an admin overrode it. */
export function couponSummary(coupon: Coupon): string {
  const headline = coupon.presentation.headline.trim();
  if (headline) return headline;
  const sentence = describeMechanic(coupon.mechanic, coupon.restrictions.itemTypes);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// ---- Frozen terms -----------------------------------------------------------

/**
 * The snapshot copied onto a grant or a redemption the moment it's created.
 *
 * A full denormalized copy rather than a pointer, for the same reason campaign
 * enrollments freeze their rules: editing a live coupon must never rewrite a
 * promise somebody has already been shown, and an audit has to be able to replay
 * what was offered after the coupon has been rewritten many times.
 */
export interface CouponTerms {
  couponId: string;
  couponName: string;
  mechanic: CouponMechanic;
  restrictions: CouponRestrictions;
  /** The promise, exactly as it read. */
  summary: string;
  notes: string[];
  at: number;
}

export function freezeCouponTerms(coupon: Coupon, at = Date.now()): CouponTerms {
  return {
    couponId: coupon.id,
    couponName: coupon.name,
    mechanic: { ...coupon.mechanic },
    restrictions: {
      ...coupon.restrictions,
      itemTypes: [...coupon.restrictions.itemTypes],
      productIds: [...coupon.restrictions.productIds],
      currencies: [...coupon.restrictions.currencies],
      countries: [...coupon.restrictions.countries],
      planIds: [...coupon.restrictions.planIds],
    },
    summary: couponSummary(coupon),
    notes: describeRestrictions(coupon.restrictions),
    at,
  };
}

// ---- Stored code + redemption shapes ---------------------------------------

/** One redeemable string. `sharedCode` coupons have exactly one of these. */
export interface CouponCodeRecord {
  /** Doc id: the NORMALIZED code. */
  code: string;
  couponId: string;
  /** Restrict to one account (personalized batches, admin grants). */
  boundUid: string | null;
  /** Uses already consumed by this code. */
  redeemedCount: number;
  /** Reservations currently held (in-flight checkouts). */
  reservedCount: number;
  /** An owner can kill one code without touching the coupon. */
  revoked: boolean;
  createdAt: number;
  /** Batch handle, so a generated run can be listed/exported/revoked together. */
  batchId: string | null;
}

/** Marker on the lookup document owned by a `sharedCode` coupon. */
export const SHARED_CODE_BATCH_ID = "__shared";

export interface SharedCodeWrite {
  code: string;
  couponId: string;
  /**
   * Keep redemption/reservation/revocation state when the same coupon still
   * owns the same code. A new code or an atomic transfer starts clean.
   */
  preserveState: boolean;
}

export interface SharedCodeReconciliation {
  writes: SharedCodeWrite[];
  deletes: string[];
}

function sharedCodeOwners(config: CouponsConfig): Map<string, string> {
  const owners = new Map<string, string>();
  for (const coupon of config.coupons) {
    if (coupon.issuance !== "sharedCode" || !coupon.sharedCode) continue;
    owners.set(normalizeCouponCode(coupon.sharedCode), coupon.id);
  }
  return owners;
}

/**
 * Plan the code-index changes that must commit with a coupon config save.
 *
 * Config validation already prevents two NEW coupons from naming the same
 * shared code. This function handles the other collision: a shared code
 * colliding with a generated code (possibly from another coupon) already in
 * Firestore. It also makes rename/delete/issuance changes explicit, so stale
 * public strings cannot continue resolving after the admin removed them.
 *
 * Pure so the expensive edge cases are covered by the invariant suite; the
 * backend applies the returned plan and both config documents in one Firestore
 * transaction.
 */
export function reconcileSharedCodes(
  previous: CouponsConfig,
  next: CouponsConfig,
  existing: ReadonlyMap<string, CouponCodeRecord>,
): SharedCodeReconciliation {
  const before = sharedCodeOwners(previous);
  const after = sharedCodeOwners(next);
  const writes: SharedCodeWrite[] = [];
  const deletes: string[] = [];

  for (const [code, couponId] of after) {
    const record = existing.get(code);
    if (!record) {
      writes.push({ code, couponId, preserveState: false });
      continue;
    }

    if (record.couponId === couponId) {
      // A generated code from this same coupon is still a collision. Without
      // this distinction, changing issuance would silently turn one code from a
      // batch into the public shared code while carrying its consumed state.
      const wasShared =
        record.batchId === SHARED_CODE_BATCH_ID ||
        (before.get(code) === couponId && record.batchId === null);
      if (!wasShared) {
        throw new Error(
          `"${code}" already exists as a generated code. Choose a different shared code.`,
        );
      }
      writes.push({ code, couponId, preserveState: true });
      continue;
    }

    // Allow an atomic hand-off only when the existing owner is the owner being
    // removed by THIS save. It starts with fresh counters; uses of the old
    // coupon must never count against the new one.
    if (
      before.get(code) === record.couponId &&
      (record.batchId === SHARED_CODE_BATCH_ID || record.batchId === null)
    ) {
      writes.push({ code, couponId, preserveState: false });
      continue;
    }

    throw new Error(
      `"${code}" is already assigned to another coupon. Choose a different shared code.`,
    );
  }

  for (const code of before.keys()) {
    if (after.has(code)) continue;
    const record = existing.get(code);
    // A missing doc is safe to delete idempotently. Never delete a generated
    // or foreign code just because a stale catalog happened to name it.
    if (
      !record ||
      (record.couponId === before.get(code) &&
        (record.batchId === SHARED_CODE_BATCH_ID || record.batchId === null))
    ) {
      deletes.push(code);
    }
  }

  return { writes, deletes };
}

export type CouponRedemptionStatus =
  /** Held for an in-flight checkout. */
  | "reserved"
  /** The payment settled; the use is spent. */
  | "redeemed"
  /** The checkout went away; the use went back. */
  | "released"
  /** A refund gave the use back. */
  | "restored"
  /** An owner cancelled it. */
  | "void";

export interface CouponRedemptionRecord {
  id: string;
  couponId: string;
  couponName: string;
  /** Null for `autoGrant`/`adminGrant` — there was no code. */
  code: string | null;
  uid: string;
  /** Our own payment id, or a Stripe invoice id for membership renewals. */
  paymentRef: string;
  status: CouponRedemptionStatus;
  itemType: DiscountItemType;
  /** Percentage actually applied AFTER every clamp. */
  percentOff: number;
  /** Money taken off, in `currency`. */
  discountAmount: number;
  /** Subtotal the discount was measured against, before it applied. */
  originalSubtotal: number;
  currency: string;
  /** Frozen at reserve time. */
  terms: CouponTerms;
  createdAt: number;
  settledAt: number | null;
  releasedAt: number | null;
  note: string | null;
}

/** One account's entitlement to an auto-applied coupon (no code involved). */
export interface CouponGrantRecord {
  id: string;
  couponId: string;
  uid: string;
  /** Frozen when the entitlement was created. */
  terms: CouponTerms;
  /** Why they got it — an acquisition token, or `admin`. */
  source: string;
  grantedAt: number;
  /** Uses consumed under this grant. */
  redeemedCount: number;
  revoked: boolean;
}

// ---- Validation -------------------------------------------------------------

/**
 * Why a coupon didn't apply. Stable machine values: the admin report counts
 * rejections by reason, which is the only way to tell "nobody has the code" from
 * "everybody has it and the cap is spent".
 */
export const COUPON_REJECTION_REASONS = [
  "engine_disabled",
  "unknown_code",
  "code_revoked",
  "code_bound_to_other_account",
  "not_active",
  "not_started",
  "expired",
  "code_exhausted",
  "coupon_exhausted",
  "per_account_limit",
  "budget_exhausted",
  "min_subtotal",
  "item_not_eligible",
  "product_not_eligible",
  "currency_not_eligible",
  "country_not_eligible",
  "first_purchase_only",
  "requires_verified_email",
  "guests_not_allowed",
  "account_too_new",
  "account_too_old",
  "subscribers_only",
  "non_subscribers_only",
  "plan_not_eligible",
  "not_allowlisted",
  "no_headroom",
  "better_offer_active",
  "already_applied",
] as const;

export type CouponRejectionReason = (typeof COUPON_REJECTION_REASONS)[number];

export interface CouponRejection {
  ok: false;
  reason: CouponRejectionReason;
  /** Phrased for the customer who just typed the code. */
  message: string;
}

export interface CouponAcceptance {
  ok: true;
  couponId: string;
  couponName: string;
  code: string | null;
  /** Percentage after the coupon's own ceiling, BEFORE checkout-level clamps. */
  percentOff: number;
  /** Money this takes off, in the quote currency. */
  discountAmount: number;
  /** The customer-facing promise, frozen. */
  summary: string;
  notes: string[];
  terms: CouponTerms;
  stackable: boolean;
  priority: number;
}

export type CouponVerdict = CouponAcceptance | CouponRejection;

/**
 * Customer-facing copy for every refusal. Exhaustive: a new reason without a
 * sentence is a compile error, because a code that bounces with no explanation
 * is the failure this whole module exists to prevent.
 *
 * Deliberately vague in two places. An unknown code and a revoked code read the
 * same, so the endpoint can't be used to enumerate which codes exist; and a
 * coupon restricted to accounts we didn't hand it to says "isn't available for
 * this account" rather than naming the allowlist.
 */
export function describeRejection(reason: CouponRejectionReason): string {
  switch (reason) {
    case "engine_disabled":
    case "unknown_code":
    case "code_revoked":
      return "That code isn't valid. Check it and try again.";
    case "code_bound_to_other_account":
      return "That code belongs to a different account.";
    case "not_active":
      return "That code isn't active right now.";
    case "not_started":
      return "That code isn't active yet.";
    case "expired":
      return "That code has expired.";
    case "code_exhausted":
      return "That code has already been used.";
    case "coupon_exhausted":
      return "This offer has been fully claimed.";
    case "per_account_limit":
      return "You've already used this offer.";
    case "budget_exhausted":
      return "This offer has been fully claimed.";
    case "min_subtotal":
      return "Your order is below the minimum for this code.";
    case "item_not_eligible":
      return "That code doesn't apply to this item.";
    case "product_not_eligible":
      return "That code doesn't apply to this product.";
    case "currency_not_eligible":
      return "That code can't be used in this currency.";
    case "country_not_eligible":
      return "That code isn't available in your country.";
    case "first_purchase_only":
      return "That code is for a first order only.";
    case "requires_verified_email":
      return "Confirm your email address to use this code.";
    case "guests_not_allowed":
      return "Create an account to use this code.";
    case "account_too_new":
      return "That code isn't available on your account yet.";
    case "account_too_old":
      return "That code is for newer accounts.";
    case "subscribers_only":
      return "That code is for members only.";
    case "non_subscribers_only":
      return "That code is for non-members only.";
    case "plan_not_eligible":
      return "That code doesn't apply to your plan.";
    case "not_allowlisted":
      return "That code isn't available for this account.";
    case "no_headroom":
      return "This order is already discounted as far as we can go.";
    case "better_offer_active":
      return "You already have a better offer on this order, so we've kept that one.";
    case "already_applied":
      return "That code is already applied to this order.";
  }
}

function reject(reason: CouponRejectionReason): CouponRejection {
  return { ok: false, reason, message: describeRejection(reason) };
}

/** Everything validation needs to know about the account. */
export interface CouponUserFacts {
  uid: string;
  anonymous: boolean;
  emailVerified: boolean;
  /** Account creation, ms epoch. */
  createdAt: number;
  /** ISO-2, from billing or geo. Null when unknown. */
  country: string | null;
  isSubscriber: boolean;
  planId: string | null;
  /** Lifetime count of cleared purchases. */
  purchaseCount: number;
  /** Acquisition tokens recorded for this account (QR ids, link tokens). */
  arrivedVia: string[];
}

/** Everything validation needs to know about the purchase being quoted. */
export interface CouponPurchaseFacts {
  itemType: DiscountItemType;
  /** Discountable subtotal in `currency` (shipping and tax excluded). */
  subtotal: number;
  currency: string;
  /** Catalog product / plan / pack id, when known. */
  productId?: string | null;
  /** Destination or billing country, when known. */
  country?: string | null;
}

/** Usage counters the caller looked up (0 when there's nothing recorded yet). */
export interface CouponUsageFacts {
  /** Redemptions of this coupon across all accounts. */
  totalRedeemed: number;
  /** Redemptions of this coupon by THIS account. */
  accountRedeemed: number;
  /** Redemptions of the specific code being used. */
  codeRedeemed: number;
  /** Discount already spent over this coupon's life, base currency. */
  lifetimeSpend: number;
  /** Discount already spent today, base currency. */
  todaySpend: number;
}

export function emptyUsage(): CouponUsageFacts {
  return { totalRedeemed: 0, accountRedeemed: 0, codeRedeemed: 0, lifetimeSpend: 0, todaySpend: 0 };
}

const DAY_MS = 86_400_000;

/**
 * The money a coupon takes off a subtotal, and the effective percentage that
 * represents.
 *
 * The percentage comes back as well as the amount because every downstream
 * guardrail in this codebase is a percentage — the checkout clamp, the
 * break-even headroom, the margin waterfall. A mechanic whose natural shape is
 * an amount (a future `fixedAmount`) still has to answer in percent HERE, so
 * that the clamps keep working without being rewritten.
 */
export function couponDiscountPercent(
  mechanic: CouponMechanic,
  subtotal: number,
): { percentOff: number; discountAmount: number } {
  switch (mechanic.kind) {
    case "percentOff": {
      const pct = clamp(mechanic.percentOff, 0, 100);
      if (subtotal <= 0) return { percentOff: pct, discountAmount: 0 };
      const raw = round2((subtotal * pct) / 100);
      if (mechanic.maxDiscountAmount > 0 && raw > mechanic.maxDiscountAmount) {
        const capped = mechanic.maxDiscountAmount;
        return { percentOff: round1((capped / subtotal) * 100), discountAmount: round2(capped) };
      }
      return { percentOff: pct, discountAmount: raw };
    }
  }
}

/**
 * Is this coupon usable, by this account, on this purchase, right now?
 *
 * Pure and total: the caller supplies the counters, so the same function runs on
 * the preview path (no reservation) and again inside the reserve transaction.
 * The two MUST agree or a customer is quoted a discount they don't get, so
 * there is deliberately no second copy of these rules anywhere.
 *
 * Order matters. Identity and window come first (cheap, and the honest reason),
 * caps next, then the purchase-shaped checks — so "your order is too small"
 * beats "this offer is fully claimed" when both are true, which is the more
 * actionable of the two.
 */
export function validateCoupon(args: {
  coupon: Coupon;
  /** The specific code record, when a code was typed. */
  codeRecord?: CouponCodeRecord | null;
  /** The account's grant, when this is an auto/admin-granted coupon. */
  grant?: CouponGrantRecord | null;
  user: CouponUserFacts;
  purchase: CouponPurchaseFacts;
  usage: CouponUsageFacts;
  enabled: boolean;
  at?: number;
}): CouponVerdict {
  const { coupon, codeRecord, grant, user, purchase, usage } = args;
  const at = args.at ?? Date.now();
  // Frozen terms win wherever they exist: a grant made a promise, and the live
  // coupon may have moved on since.
  const terms = grant?.terms ?? freezeCouponTerms(coupon, at);
  const r = terms.restrictions;

  if (!args.enabled) return reject("engine_disabled");
  if (coupon.status === "draft" || coupon.status === "ended") return reject("not_active");
  if (coupon.status === "paused") return reject("not_active");

  if (codeRecord) {
    if (codeRecord.revoked) return reject("code_revoked");
    if (codeRecord.couponId !== coupon.id) return reject("unknown_code");
    if (codeRecord.boundUid && codeRecord.boundUid !== user.uid) {
      return reject("code_bound_to_other_account");
    }
  }
  // An auto/admin-granted coupon can only be used by someone holding a grant.
  if (!issuanceUsesCodes(coupon.issuance)) {
    if (!grant || grant.revoked) return reject("not_allowlisted");
  }

  if (r.startsAt > 0 && at < r.startsAt) return reject("not_started");
  if (r.endsAt > 0 && at > r.endsAt) return reject("expired");

  if (user.anonymous && !r.allowGuests) return reject("guests_not_allowed");
  if (r.requireVerified && !user.emailVerified) return reject("requires_verified_email");

  if (
    coupon.audience.allowlistUids.length > 0 &&
    !coupon.audience.allowlistUids.includes(user.uid)
  ) {
    return reject("not_allowlisted");
  }

  const ageDays = Math.floor((at - user.createdAt) / DAY_MS);
  if (r.minAccountAgeDays > 0 && ageDays < r.minAccountAgeDays) return reject("account_too_new");
  if (r.maxAccountAgeDays > 0 && ageDays > r.maxAccountAgeDays) return reject("account_too_old");

  if (r.firstPurchaseOnly && user.purchaseCount > 0) return reject("first_purchase_only");
  if (r.subscriberScope === "subscribers" && !user.isSubscriber) return reject("subscribers_only");
  if (r.subscriberScope === "nonSubscribers" && user.isSubscriber) {
    return reject("non_subscribers_only");
  }
  if (r.planIds.length > 0 && !(user.planId && r.planIds.includes(user.planId))) {
    return reject("plan_not_eligible");
  }

  // Caps. Checked against counters the caller read, so the reserve transaction
  // can re-run this with fresh numbers and reach the same verdict.
  if (r.maxPerCode > 0 && codeRecord && usage.codeRedeemed >= r.maxPerCode) {
    return reject("code_exhausted");
  }
  if (r.maxRedemptions > 0 && usage.totalRedeemed >= r.maxRedemptions) {
    return reject("coupon_exhausted");
  }
  if (r.maxPerAccount > 0 && usage.accountRedeemed >= r.maxPerAccount) {
    return reject("per_account_limit");
  }
  if (r.lifetimeBudget > 0 && usage.lifetimeSpend >= r.lifetimeBudget) {
    return reject("budget_exhausted");
  }
  if (r.dailyBudget > 0 && usage.todaySpend >= r.dailyBudget) return reject("budget_exhausted");

  // Purchase shape.
  if (r.itemTypes.length > 0 && !r.itemTypes.includes(purchase.itemType)) {
    return reject("item_not_eligible");
  }
  if (r.productIds.length > 0) {
    if (!purchase.productId) return reject("product_not_eligible");
    if (!r.productIds.includes(purchase.productId)) return reject("product_not_eligible");
  }
  if (r.currencies.length > 0 && !r.currencies.includes(purchase.currency.toUpperCase())) {
    return reject("currency_not_eligible");
  }
  if (r.countries.length > 0) {
    const country = (purchase.country ?? user.country ?? "").toUpperCase();
    // Unknown country FAILS a country-gated coupon: honoring it because we
    // couldn't tell is the expensive direction to be wrong.
    if (!country || !r.countries.includes(country)) return reject("country_not_eligible");
  }
  if (r.minSubtotal > 0 && purchase.subtotal < r.minSubtotal) return reject("min_subtotal");

  const { percentOff, discountAmount } = couponDiscountPercent(terms.mechanic, purchase.subtotal);
  if (percentOff <= 0 || discountAmount <= 0) return reject("no_headroom");

  return {
    ok: true,
    couponId: coupon.id,
    couponName: coupon.name,
    code: codeRecord?.code ?? null,
    percentOff,
    discountAmount,
    summary: terms.summary,
    notes: terms.notes,
    terms,
    stackable: r.stackable,
    priority: r.priority,
  };
}

// ---- The one place stacking is decided --------------------------------------

/** An earned (referral or campaign) discount, as the resolver sees it. */
export interface EarnedDiscountCandidate {
  source: "referral" | "campaign";
  percentOff: number;
  summary: string;
  /** Opaque handle the caller reserves against. */
  handle: string;
  stackable: boolean;
  priority: number;
}

export interface CouponDiscountCandidate {
  source: "coupon";
  percentOff: number;
  summary: string;
  handle: string;
  stackable: boolean;
  priority: number;
}

export type DiscountCandidate = EarnedDiscountCandidate | CouponDiscountCandidate;

export interface DiscountResolution {
  /** The candidates that actually apply, best first. */
  applied: DiscountCandidate[];
  /** Combined percentage after clamping. */
  percentOff: number;
  /** Candidates that lost, with the reason to show if one was a typed code. */
  rejected: { candidate: DiscountCandidate; reason: CouponRejectionReason }[];
}

/**
 * Decide which discounts apply to one purchase, and to what total percentage.
 *
 * This is the ONE place stacking is decided, for the same reason `earnedDiscount`
 * was before it: a customer holding a referral perk, a campaign offer and a
 * typed code must experience exactly one set of rules, and a promotion that
 * accidentally sells below cost is almost always a stacking bug.
 *
 * Rules:
 *   - Best for the customer wins on percentage, then priority. A customer
 *     offered 20% and charged 10% experiences a bug, whatever the config says.
 *   - Two candidates only combine if BOTH opt into stacking.
 *   - The total is clamped to the catalog maximum and to whatever break-even
 *     headroom is left after discounts already in the price (a plan perk).
 *   - A candidate clamped to nothing is REJECTED rather than applied at 0, so
 *     the caller doesn't consume a single-use code for no benefit.
 */
export function resolveBestDiscount(args: {
  candidates: DiscountCandidate[];
  /** Catalog-wide ceiling (`PricingSettings.maxDiscountPct`). */
  maxDiscountPct: number;
  /** Discount already in the quoted price (a plan perk), in percent. */
  appliedPct?: number;
  /** Deepest TOTAL discount that still breaks even (100 = unbounded). */
  breakEvenPct?: number;
}): DiscountResolution {
  const headroom = Math.max(0, (args.breakEvenPct ?? 100) - (args.appliedPct ?? 0));
  const ceiling = Math.max(0, Math.min(args.maxDiscountPct, headroom));

  const ranked = [...args.candidates]
    .filter((c) => c.percentOff > 0)
    .sort((a, b) => b.percentOff - a.percentOff || b.priority - a.priority);

  const rejected: DiscountResolution["rejected"] = [];
  if (ceiling <= 0) {
    return {
      applied: [],
      percentOff: 0,
      rejected: ranked.map((candidate) => ({ candidate, reason: "no_headroom" as const })),
    };
  }

  const applied: DiscountCandidate[] = [];
  let total = 0;
  for (const candidate of ranked) {
    if (applied.length === 0) {
      applied.push(candidate);
      total = Math.min(candidate.percentOff, ceiling);
      continue;
    }
    // Past the winner, only a mutually-stackable candidate gets a look in.
    const stackable = candidate.stackable && applied.every((a) => a.stackable);
    if (!stackable) {
      rejected.push({ candidate, reason: "better_offer_active" });
      continue;
    }
    const next = Math.min(total + candidate.percentOff, ceiling);
    if (next <= total) {
      // The ceiling is already reached — taking the code would consume it for
      // nothing, so leave it for a purchase that can carry it.
      rejected.push({ candidate, reason: "no_headroom" });
      continue;
    }
    applied.push(candidate);
    total = next;
  }

  return { applied, percentOff: round1(total), rejected };
}

/** Apply a percentage to a major-unit amount, rounded to cents. */
export function discountedAmount(amount: number, percentOff: number): number {
  if (percentOff <= 0) return amount;
  return round2(amount * (1 - percentOff / 100));
}

// ---- Admin report shapes ----------------------------------------------------

/** One coupon's counters for one UTC day. Written with `FieldValue.increment`. */
export interface CouponDayStats {
  /** UTC day key, `YYYY-MM-DD`. */
  day: string;
  /** Codes accepted at preview time (intent, not money). */
  accepted: number;
  /** Codes refused at preview time. */
  rejected: number;
  /** Reservations that settled into a real redemption. */
  redemptions: number;
  /** Reservations released (abandoned checkouts). */
  released: number;
  /** Uses handed back by a refund. */
  restored: number;
  /** Discount given away, base currency. */
  discount: number;
  /** Revenue on orders that carried this coupon, base currency. */
  revenue: number;
  /** Orders that carried it. */
  orders: number;
  /** Orders from accounts with no prior purchase. */
  newCustomers: number;
}

export type CouponStatField = Exclude<keyof CouponDayStats, "day">;

export function emptyCouponDayStats(day = ""): CouponDayStats {
  return {
    day,
    accepted: 0,
    rejected: 0,
    redemptions: 0,
    released: 0,
    restored: 0,
    discount: 0,
    revenue: 0,
    orders: 0,
    newCustomers: 0,
  };
}

export function normalizeCouponDayStats(day: string, raw: unknown): CouponDayStats {
  const d = (raw ?? {}) as Record<string, unknown>;
  const empty = emptyCouponDayStats(day);
  const out = { ...empty };
  for (const key of Object.keys(empty) as (keyof CouponDayStats)[]) {
    if (key === "day") continue;
    out[key] = num(d[key], 0);
  }
  return out;
}

export function totalCouponDayStats(series: CouponDayStats[], day = "total"): CouponDayStats {
  const total = emptyCouponDayStats(day);
  for (const stats of series) {
    for (const key of Object.keys(total) as (keyof CouponDayStats)[]) {
      if (key === "day") continue;
      total[key] += stats[key];
    }
  }
  return total;
}

export interface CouponRates {
  /** Share of attempts that were accepted, %. */
  acceptRatePct: number;
  /** Average discount per redemption, base currency. */
  discountPerRedemption: number;
  /** Average order value on coupon orders, base currency. */
  averageOrderValue: number;
  /** Revenue earned per unit of discount given away. Null when nothing spent. */
  returnOnDiscount: number | null;
  /** Share of coupon orders that came from a first-time buyer, %. */
  newCustomerPct: number;
  /** Share of reservations that never settled, %. */
  abandonRatePct: number;
}

export function couponRates(t: CouponDayStats): CouponRates {
  const share = (numerator: number, denominator: number) =>
    denominator > 0 ? round1((numerator / denominator) * 100) : 0;
  const attempts = t.accepted + t.rejected;
  const reservations = t.redemptions + t.released;
  return {
    acceptRatePct: share(t.accepted, attempts),
    discountPerRedemption: t.redemptions > 0 ? round2(t.discount / t.redemptions) : 0,
    averageOrderValue: t.orders > 0 ? round2(t.revenue / t.orders) : 0,
    returnOnDiscount: t.discount > 0 ? round2(t.revenue / t.discount) : null,
    newCustomerPct: share(t.newCustomers, t.orders),
    abandonRatePct: share(t.released, reservations),
  };
}

/** One row of the admin Coupons list: the coupon plus its live counters. */
export interface CouponRow {
  coupon: Coupon;
  redeemed: number;
  discount: number;
  revenue: number;
  codeCount: number;
  /** Codes neither revoked nor spent — what's actually still out there working. */
  liveCodeCount: number;
  /** The shared code, formatted for display. Null for every other channel. */
  sharedCode: string | null;
}

/** One code in the admin list. The string itself is always MASKED. */
export interface CouponCodeRow {
  code: string;
  redeemedCount: number;
  reservedCount: number;
  revoked: boolean;
  batchId: string | null;
  boundUid: string | null;
  createdAt: number;
}

/**
 * One holder in the admin grant list.
 *
 * `email` is resolved from the auth directory at read time and may be null — a
 * grant stores only a uid, so this is a convenience for the operator rather
 * than a field anything else should rely on.
 */
export interface CouponGrantRow {
  id: string;
  uid: string;
  email: string | null;
  couponId: string;
  terms: CouponTerms;
  source: string;
  grantedAt: number;
  redeemedCount: number;
  revoked: boolean;
}

/** One redemption in the admin activity list. */
export interface CouponRedemptionRow {
  id: string;
  couponId: string;
  couponName: string;
  code: string | null;
  uid: string;
  status: CouponRedemptionStatus;
  itemType: DiscountItemType;
  percentOff: number;
  discountAmount: number;
  originalSubtotal: number;
  currency: string;
  createdAt: number;
  settledAt: number | null;
  note: string | null;
}

export interface CouponReport {
  couponId: string;
  from: number;
  to: number;
  totals: CouponDayStats;
  series: CouponDayStats[];
  rates: CouponRates;
  /** Why codes bounced, most common first. */
  rejections: { reason: CouponRejectionReason; count: number; label: string }[];
  /** Uses left before a cap is hit (null when uncapped). */
  remainingRedemptions: number | null;
  /** Budget left (null when uncapped). */
  remainingBudget: number | null;
}

// ---- Normalization ----------------------------------------------------------

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function nonNegative(v: unknown, fallback: number): number {
  const n = num(v, fallback);
  return n >= 0 ? n : fallback;
}
function pct(v: unknown, fallback: number): number {
  return Math.min(100, Math.max(0, num(v, fallback)));
}
function str(v: unknown, fallback: string, max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}
function stringList(v: unknown, allowed?: readonly string[], max = 200): string[] {
  if (!Array.isArray(v)) return [];
  const out = v
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .map((x) => x.trim())
    .filter((x) => !allowed || allowed.includes(x));
  return Array.from(new Set(out)).slice(0, max);
}
function itemList(v: unknown): DiscountItemType[] {
  return stringList(v, COUPON_ITEM_TYPES).filter((t): t is DiscountItemType =>
    COUPON_ITEM_TYPES.includes(t as DiscountItemType),
  );
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeMechanic(raw: unknown): CouponMechanic | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  switch (m.kind) {
    case "percentOff": {
      const percentOff = pct(m.percentOff, 0);
      // A 0% coupon is not a coupon. Normalizing it away (rather than storing a
      // no-op) is what stops a live coupon that silently does nothing.
      if (percentOff <= 0) return null;
      return {
        kind: "percentOff",
        percentOff,
        maxDiscountAmount: nonNegative(m.maxDiscountAmount, 0),
      };
    }
    default:
      return null;
  }
}

function normalizeRestrictions(raw: unknown): CouponRestrictions {
  const r = (raw ?? {}) as Record<string, unknown>;
  const def = createRestrictions();
  const scope = r.subscriberScope;
  return {
    startsAt: Math.round(nonNegative(r.startsAt, 0)),
    endsAt: Math.round(nonNegative(r.endsAt, 0)),
    itemTypes: itemList(r.itemTypes),
    productIds: stringList(r.productIds, undefined, 200),
    currencies: stringList(r.currencies).map((c) => c.toUpperCase().slice(0, 3)),
    countries: stringList(r.countries).map((c) => c.toUpperCase().slice(0, 2)),
    minSubtotal: nonNegative(r.minSubtotal, 0),
    maxRedemptions: Math.round(nonNegative(r.maxRedemptions, 0)),
    maxPerAccount: Math.round(nonNegative(r.maxPerAccount, def.maxPerAccount)),
    maxPerCode: Math.round(nonNegative(r.maxPerCode, 0)),
    lifetimeBudget: nonNegative(r.lifetimeBudget, 0),
    dailyBudget: nonNegative(r.dailyBudget, def.dailyBudget),
    firstPurchaseOnly: r.firstPurchaseOnly === true,
    // Default-ON safety flags stay on unless explicitly turned off.
    requireVerified: r.requireVerified !== false,
    allowGuests: r.allowGuests === true,
    minAccountAgeDays: Math.round(nonNegative(r.minAccountAgeDays, 0)),
    maxAccountAgeDays: Math.round(nonNegative(r.maxAccountAgeDays, 0)),
    subscriberScope:
      scope === "subscribers" || scope === "nonSubscribers" ? scope : "any",
    planIds: stringList(r.planIds),
    stackable: r.stackable === true,
    priority: Math.round(num(r.priority, 0)),
    refundPolicy:
      r.refundPolicy === "restoreAlways" || r.refundPolicy === "consume"
        ? r.refundPolicy
        : "restoreOnFullRefund",
  };
}

function normalizeAudience(raw: unknown): CouponAudience {
  const a = (raw ?? {}) as Record<string, unknown>;
  return {
    arrivedVia: stringList(a.arrivedVia, undefined, 100),
    signedUpFrom: Math.round(nonNegative(a.signedUpFrom, 0)),
    signedUpTo: Math.round(nonNegative(a.signedUpTo, 0)),
    allowlistUids: stringList(a.allowlistUids, undefined, 500),
  };
}

function normalizeCoupon(raw: unknown, index: number, at: number): Coupon {
  const c = (raw ?? {}) as Record<string, unknown>;
  const statuses: CouponStatus[] = ["draft", "active", "paused", "ended"];
  const stored = statuses.includes(c.status as CouponStatus)
    ? (c.status as CouponStatus)
    : "draft";
  const issuance = COUPON_ISSUANCE_KINDS.includes(c.issuance as CouponIssuanceKind)
    ? (c.issuance as CouponIssuanceKind)
    : "sharedCode";
  const restrictions = normalizeRestrictions(c.restrictions);
  const parsed = normalizeMechanic(c.mechanic);
  // A mechanic that normalized away leaves the coupon present but NOT active —
  // silently rewriting it to something payable would be worse than showing the
  // admin a coupon that plainly isn't running.
  const mechanic = parsed ?? { kind: "percentOff" as const, percentOff: 0, maxDiscountAmount: 0 };
  const endsAt = restrictions.endsAt;
  const status: CouponStatus =
    !parsed && stored === "active"
      ? "draft"
      : stored === "active" && endsAt > 0 && at > endsAt
        ? "ended"
        : stored;
  return {
    id: str(c.id, `coupon-${index + 1}`, 64).trim() || `coupon-${index + 1}`,
    name: str(c.name, "Untitled coupon", 120),
    notes: str(c.notes, "", 2000),
    status,
    issuance,
    // A shared-code coupon with no code can never be typed; it's kept (so the
    // admin sees their draft) but the emptiness is what the schema rejects.
    sharedCode: issuance === "sharedCode" ? normalizeCouponCode(str(c.sharedCode, "", 64)) : "",
    mechanic,
    restrictions,
    audience: normalizeAudience(c.audience),
    presentation: {
      headline: str((c.presentation as Record<string, unknown>)?.headline, "", 160).trim(),
      subline: str((c.presentation as Record<string, unknown>)?.subline, "", 400).trim(),
    },
    createdAt: Math.round(nonNegative(c.createdAt, at)),
    updatedAt: Math.round(nonNegative(c.updatedAt, at)),
  };
}

export function normalizeCouponsConfig(input: unknown, at = Date.now()): CouponsConfig {
  const p = (input ?? {}) as Partial<CouponsConfig> & Record<string, unknown>;
  const coupons = Array.isArray(p.coupons)
    ? p.coupons.slice(0, MAX_COUPONS).map((raw, i) => normalizeCoupon(raw, i, at))
    : [];
  // Duplicate ids would collapse two coupons onto one set of counters, so the
  // later duplicate is renamed rather than silently sharing a budget.
  const seen = new Set<string>();
  for (const coupon of coupons) {
    let id = coupon.id;
    let n = 2;
    while (seen.has(id)) id = `${coupon.id}-${n++}`;
    coupon.id = id;
    seen.add(id);
  }
  return {
    version: 1,
    enabled: p.enabled === true,
    coupons,
    updatedAt: Math.round(nonNegative(p.updatedAt, 0)),
  };
}

/**
 * The world-readable projection.
 *
 * Nearly everything is stripped. Unlike campaigns — where the client evaluates
 * offers speculatively and therefore needs real rules — a coupon is validated by
 * the server on entry, so the client needs none of this. Publishing it would
 * hand out every unredeemed code in the system, which is the whole ballgame.
 * What survives is only the master switch, so the UI knows whether to render a
 * code field at all.
 */
export function publicCouponsProjection(config: CouponsConfig): { enabled: boolean } {
  return { enabled: config.enabled };
}

// ---- Validation (backend, before persisting) --------------------------------

const mechanicSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("percentOff"),
    percentOff: z.number().min(1).max(100),
    maxDiscountAmount: z.number().min(0),
  }),
]);

const restrictionsSchema = z.object({
  startsAt: z.number().min(0),
  endsAt: z.number().min(0),
  itemTypes: z.array(z.enum(["print", "ebook", "pack", "plan"])),
  productIds: z.array(z.string().max(120)).max(200),
  currencies: z.array(z.string().max(3)),
  countries: z.array(z.string().max(2)),
  minSubtotal: z.number().min(0),
  maxRedemptions: z.number().min(0),
  maxPerAccount: z.number().min(0).max(10_000),
  maxPerCode: z.number().min(0).max(10_000),
  lifetimeBudget: z.number().min(0),
  dailyBudget: z.number().min(0),
  firstPurchaseOnly: z.boolean(),
  requireVerified: z.boolean(),
  allowGuests: z.boolean(),
  minAccountAgeDays: z.number().min(0).max(3650),
  maxAccountAgeDays: z.number().min(0).max(3650),
  subscriberScope: z.enum(["any", "subscribers", "nonSubscribers"]),
  planIds: z.array(z.string().max(64)),
  stackable: z.boolean(),
  priority: z.number(),
  refundPolicy: z.enum(["restoreOnFullRefund", "restoreAlways", "consume"]),
});

const audienceSchema = z.object({
  arrivedVia: z.array(z.string().max(64)).max(100),
  signedUpFrom: z.number().min(0),
  signedUpTo: z.number().min(0),
  allowlistUids: z.array(z.string().max(128)).max(500),
});

const couponSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  notes: z.string().max(2000),
  status: z.enum(["draft", "active", "paused", "ended"]),
  issuance: z.enum(COUPON_ISSUANCE_KINDS),
  sharedCode: z.string().max(64),
  mechanic: mechanicSchema,
  restrictions: restrictionsSchema,
  audience: audienceSchema,
  presentation: z.object({ headline: z.string().max(160), subline: z.string().max(400) }),
  createdAt: z.number().min(0),
  updatedAt: z.number().min(0),
});

/**
 * Save-time validation. The messages are written for the admin about to publish
 * the coupon, not for a log: every refusal names the coupon, says what's wrong,
 * and says why it matters. A promotions system an operator can't debug from its
 * error messages is one that gets switched off.
 */
export const couponsConfigSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    coupons: z.array(couponSchema).max(MAX_COUPONS),
    updatedAt: z.number().min(0).optional(),
  })
  .superRefine((cfg, ctx) => {
    const sharedCodes = new Map<string, string>();

    cfg.coupons.forEach((coupon, ci) => {
      const at = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: "custom", path: ["coupons", ci, ...path], message });
      const r = coupon.restrictions;

      if (r.endsAt > 0 && r.startsAt > r.endsAt) {
        at(["restrictions"], `"${coupon.name}" ends before it starts.`);
      }
      if (
        r.maxAccountAgeDays > 0 &&
        r.minAccountAgeDays > 0 &&
        r.minAccountAgeDays > r.maxAccountAgeDays
      ) {
        at(["restrictions"], `"${coupon.name}" has an account-age range that can never match.`);
      }

      if (coupon.issuance === "sharedCode") {
        const code = normalizeCouponCode(coupon.sharedCode);
        if (!code) {
          at(["sharedCode"], `"${coupon.name}" is a shared-code coupon with no code to type.`);
        } else if (code.length < 4) {
          at(["sharedCode"], `"${code}" is too short to be a code — use at least 4 characters.`);
        } else {
          const owner = sharedCodes.get(code);
          if (owner) {
            at(
              ["sharedCode"],
              `"${code}" is already used by "${owner}". A code has to resolve to exactly one offer.`,
            );
          }
          sharedCodes.set(code, coupon.name);
        }
      }

      if (coupon.issuance === "autoGrant") {
        const a = coupon.audience;
        const targeted =
          a.arrivedVia.length > 0 ||
          a.allowlistUids.length > 0 ||
          a.signedUpFrom > 0 ||
          a.signedUpTo > 0;
        if (!targeted) {
          at(
            ["audience"],
            `"${coupon.name}" applies itself with no code and no audience, which means it would ` +
              `discount every order for everyone. Narrow it by arrival, signup window, or account list.`,
          );
        }
      }

      // `adminGrant` deliberately has NO audience requirement. The grant is the
      // audience: `validateCoupon` refuses a no-code coupon outright unless the
      // account holds a live one, so a coupon nobody has been granted already
      // reaches nobody. Requiring an allowlist here as well — which this once
      // did, from before grants existed — made the channel unusable: the coupon
      // couldn't be saved without pasting a raw uid, and the list is then
      // checked ON TOP of the grant, so anyone granted it by email was refused
      // at checkout for not being on it.

      if (coupon.status === "active") {
        if (r.maxRedemptions === 0 && r.maxPerAccount === 0 && r.lifetimeBudget === 0) {
          at(
            ["restrictions"],
            `"${coupon.name}" is active with no per-account cap, no total cap and no budget. ` +
              `A public code with no ceiling is unbounded exposure — set at least one.`,
          );
        }
        if (r.dailyBudget === 0 && r.lifetimeBudget === 0) {
          at(
            ["restrictions", "dailyBudget"],
            `"${coupon.name}" has no daily or lifetime budget. That's the only circuit breaker ` +
              `between a mispriced coupon and an unbounded bill — set one.`,
          );
        }
        if (r.allowGuests && !r.requireVerified) {
          at(
            ["restrictions", "allowGuests"],
            `"${coupon.name}" is open to unverified guests, who cost nothing to create. ` +
              `Require a verified email, or accept that this is a public discount with no identity behind it.`,
          );
        }
        if (coupon.mechanic.kind === "percentOff" && coupon.mechanic.percentOff >= 100) {
          if (coupon.mechanic.maxDiscountAmount === 0 && r.maxRedemptions === 0) {
            at(
              ["mechanic"],
              `"${coupon.name}" is 100% off with no cap on the amount and no limit on redemptions. ` +
                `Printed books cost real money to produce even when they're free to the customer.`,
            );
          }
        }
      }

      // The point of generated copy is that it exists.
      if (!describeMechanic(coupon.mechanic, r.itemTypes).trim()) {
        at(["mechanic"], `This mechanic has no description, so no customer can be told about it.`);
      }
    });
  });
