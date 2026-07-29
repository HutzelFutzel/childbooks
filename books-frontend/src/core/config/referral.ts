/**
 * **Referral program** — invitations that reward BOTH sides, on a reward
 * schedule the admin configures (`appConfig/referral`, world-readable so the
 * studio can show the live offer).
 *
 * Three ideas carry the whole design:
 *
 *   1. **The invitation is the unit.** A shared link and an emailed invite are
 *      the same object with a different delivery channel, so one lifecycle and
 *      one funnel cover both. A link invitation simply has no recipient email.
 *
 *   2. **Terms are frozen onto the invitation when it's sent** ({@link ReferralTerms}),
 *      so reconfiguring the program never changes what an already-sent
 *      invitation promised. Frozen terms carry an expiry, because an offer that
 *      never expires is an unbounded liability tail.
 *
 *   3. **Reward type is constrained by trigger risk** ({@link rewardAllowedForTrigger}).
 *      Sparks and free months are cash: every granted Spark maps to real
 *      provider spend, and a free month hands over a full monthly grant with no
 *      invoice. A discount costs margin only when revenue actually arrives, and
 *      nothing at all if it's never redeemed. So triggers that fire BEFORE any
 *      money moves (signup, verification, first book) may only issue discounts —
 *      otherwise a throwaway account is a free Spark faucet.
 *
 * SAFETY: the program ships disabled, and every payout path is additionally
 * gated on the Sparks economy being enabled, so turning it on is deliberate.
 */
import { z } from "zod";
import type { DiscountItemType } from "./discountImpact";

// ---- Triggers ---------------------------------------------------------------

/**
 * The moments in a referred user's life that can pay out a reward. Ordered by
 * how much they prove: an accepted invitation proves nothing, a paid invoice
 * proves everything.
 */
export const REWARD_TRIGGERS = [
  "invite_accepted",
  "email_verified",
  "first_book_completed",
  "first_purchase",
  "subscription_started",
  "subscription_renewed",
] as const;

export type RewardTrigger = (typeof REWARD_TRIGGERS)[number];

export interface TriggerMeta {
  id: RewardTrigger;
  label: string;
  /** What has to happen for this to fire. */
  description: string;
  /**
   * True when the trigger fires before the referred user has paid anything.
   * These may only issue discounts — see the module header.
   */
  prePayment: boolean;
}

export const TRIGGER_META: Record<RewardTrigger, TriggerMeta> = {
  invite_accepted: {
    id: "invite_accepted",
    label: "Invitation accepted",
    description: "The invited person opened the invite and got as far as having an account (guest included).",
    prePayment: true,
  },
  email_verified: {
    id: "email_verified",
    label: "Email verified",
    description: "The invited person confirmed their email address.",
    prePayment: true,
  },
  first_book_completed: {
    id: "first_book_completed",
    label: "First book finished",
    description: "The invited person finished their first book — real activation, but still no money.",
    prePayment: true,
  },
  first_purchase: {
    id: "first_purchase",
    label: "First purchase",
    description: "The invited person paid for anything: a print order, the digital edition, a Spark pack or a gift.",
    prePayment: false,
  },
  subscription_started: {
    id: "subscription_started",
    label: "Subscription started",
    description: "The invited person became a paying member.",
    prePayment: false,
  },
  subscription_renewed: {
    id: "subscription_renewed",
    label: "Subscription renewed",
    description: "A later membership invoice was paid — the trigger that rewards retention rather than signup.",
    prePayment: false,
  },
};

export const TRIGGERS: TriggerMeta[] = REWARD_TRIGGERS.map((id) => TRIGGER_META[id]);

// ---- Rewards ----------------------------------------------------------------

export type RewardKind = "sparks" | "discount" | "freeMonths";

/** Free Sparks. Real provider spend — only ever on a post-payment trigger. */
export interface SparksReward {
  kind: "sparks";
  sparks: number;
}

/**
 * A percentage discount, delivered as a single-use, customer-locked Stripe
 * promotion code. Percentage rather than a fixed amount on purpose: a percentage
 * needs no per-currency table and can't accidentally exceed an item's price.
 */
export interface DiscountReward {
  kind: "discount";
  percentOff: number;
  /** Which item types the code may be redeemed against. */
  appliesTo: DiscountItemType[];
  /** How long the earned code stays valid. */
  expiresInDays: number;
}

/**
 * One or more free membership months, applied as a 100%-off coupon on the NEXT
 * invoice (never a trial extension — trials break under plan changes and
 * proration). Referrer-side only, and only for an already-paying member.
 */
export interface FreeMonthsReward {
  kind: "freeMonths";
  months: number;
}

export type Reward = SparksReward | DiscountReward | FreeMonthsReward;

/** Which reward kinds a trigger may issue. See the module header for why. */
export function rewardAllowedForTrigger(trigger: RewardTrigger, kind: RewardKind): boolean {
  return TRIGGER_META[trigger].prePayment ? kind === "discount" : true;
}

/** Reward kinds that only ever make sense on the referrer's side. */
export function rewardAllowedForSide(side: RewardSide, kind: RewardKind): boolean {
  return kind === "freeMonths" ? side === "referrer" : true;
}

export type RewardSide = "referrer" | "referred";

// ---- Rules ------------------------------------------------------------------

/** Extra gates on a rule, beyond its trigger firing. */
export interface RuleConditions {
  /** Minimum qualifying spend (in the pricing base currency) for money triggers. */
  minPurchaseAmount: number;
  /** Only pay the referrer if they're an active paying member (required for free months). */
  referrerMustBeSubscriber: boolean;
  /** Only pay out once the referred user's email is verified. */
  referredMustBeVerified: boolean;
  /** For `subscription_renewed`: which invoice number pays out (2 = the first renewal). */
  nthInvoice: number;
}

export interface RewardRule {
  /**
   * Stable id — it forms part of the reward's idempotency key, so renaming a
   * rule would re-pay everyone who already qualified under the old id. The
   * admin UI never reuses an id.
   */
  id: string;
  enabled: boolean;
  trigger: RewardTrigger;
  referrer: Reward | null;
  referred: Reward | null;
  conditions: RuleConditions;
}

/** Hard cap on rules, so a frozen terms snapshot can't grow unbounded. */
export const MAX_REWARD_RULES = 12;

// ---- Program config ---------------------------------------------------------

export interface ReferralLimits {
  /** Invitations one user may send per day / per 30 days. */
  invitesPerUserPerDay: number;
  invitesPerUserPerMonth: number;
  /** Lifetime cap on REWARDED referrals per user; beyond it, payouts need review. */
  maxRewardedReferralsPerUser: number;
  /** How long an emailed invitation stays claimable. */
  invitationExpiryDays: number;
  /** How long a personal share link stays claimable (links get a longer life). */
  linkExpiryDays: number;
  /**
   * Program-wide daily payout budget (base currency). Once a day's granted
   * rewards exceed it, further payouts are held for review and an alert fires —
   * the circuit breaker against a misconfiguration or a farming wave. 0 disables
   * the cap entirely (not recommended).
   */
  dailyBudgetAmount: number;
}

export interface ReferralEligibility {
  /** Only verified accounts may send invitations (strongly recommended). */
  senderMustBeVerified: boolean;
  /** Only customers who've paid at least once may send invitations. */
  senderMustHavePurchased: boolean;
}

export interface ReferralPresentation {
  /** Short headline for the invite screen, e.g. "Give a book, get Sparks". */
  headline: string;
  /** One sentence explaining the deal, shown when no rule-derived summary fits. */
  subline: string;
}

export interface ReferralConfig {
  version: 1;
  /** Master switch. Off ⇒ no new invitations; already-accepted ones still pay out. */
  enabled: boolean;
  rules: RewardRule[];
  limits: ReferralLimits;
  eligibility: ReferralEligibility;
  presentation: ReferralPresentation;
}

// ---- Frozen terms -----------------------------------------------------------

/**
 * The snapshot copied onto an invitation when it's sent. A full denormalized
 * copy rather than a version pointer, so an audit can replay what was promised
 * even after the config doc has been rewritten many times over.
 */
export interface ReferralTerms {
  /** Only the ENABLED rules, as they read at send time. */
  rules: RewardRule[];
  /** Human summary of each side's benefit, frozen so the copy never drifts. */
  referrerSummary: string;
  referredSummary: string;
  /** When these terms were frozen. */
  at: number;
}

/** Freeze the currently enabled rules into an invitation's terms. */
export function freezeTerms(config: ReferralConfig): ReferralTerms {
  const rules = config.rules.filter((r) => r.enabled).map((r) => ({ ...r }));
  const frozen: ReferralTerms = {
    rules,
    referrerSummary: "",
    referredSummary: "",
    at: Date.now(),
  };
  return {
    ...frozen,
    referrerSummary: summarizeSide(frozen, "referrer"),
    referredSummary: summarizeSide(frozen, "referred"),
  };
}

/** The rules a trigger fires, from a frozen snapshot (the engine's pure core). */
export function rulesForTrigger(terms: ReferralTerms, trigger: RewardTrigger): RewardRule[] {
  return terms.rules.filter((r) => r.enabled && r.trigger === trigger);
}

/** Every reward one side can earn across a snapshot, in trigger order. */
export function rewardsForSide(terms: ReferralTerms, side: RewardSide): { rule: RewardRule; reward: Reward }[] {
  const out: { rule: RewardRule; reward: Reward }[] = [];
  for (const trigger of REWARD_TRIGGERS) {
    for (const rule of rulesForTrigger(terms, trigger)) {
      const reward = side === "referrer" ? rule.referrer : rule.referred;
      if (reward) out.push({ rule, reward });
    }
  }
  return out;
}

// ---- Human-readable copy ----------------------------------------------------

export const SPARK_SYMBOL = "✦";

const ITEM_LABELS: Record<DiscountItemType, string> = {
  print: "printed books",
  ebook: "digital editions",
  pack: "Spark packs",
  plan: "membership",
};

/** Plain-language description of one reward, for UI chips and email copy. */
export function describeReward(reward: Reward, opts: { plain?: boolean } = {}): string {
  switch (reward.kind) {
    case "sparks":
      return opts.plain
        ? `${reward.sparks} Sparks`
        : `${reward.sparks} ${SPARK_SYMBOL}`;
    case "discount": {
      const scope =
        reward.appliesTo.length === 0 || reward.appliesTo.length >= 4
          ? "your next order"
          : reward.appliesTo.map((t) => ITEM_LABELS[t]).join(" and ");
      return `${reward.percentOff}% off ${scope}`;
    }
    case "freeMonths":
      return reward.months === 1 ? "1 free month of membership" : `${reward.months} free months of membership`;
  }
}

/** When a reward lands, in plain language ("when they make their first book"). */
export function describeTrigger(trigger: RewardTrigger, side: RewardSide): string {
  const subject = side === "referrer" ? "your friend" : "you";
  switch (trigger) {
    case "invite_accepted":
      return `as soon as ${subject === "you" ? "you join" : "they join"}`;
    case "email_verified":
      return `when ${subject} confirm${subject === "you" ? "" : "s"} their email`;
    case "first_book_completed":
      return `when ${subject} finish${subject === "you" ? "" : "es"} a first book`;
    case "first_purchase":
      return `when ${subject} make${subject === "you" ? "" : "s"} a first purchase`;
    case "subscription_started":
      return `when ${subject} become${subject === "you" ? "" : "s"} a member`;
    case "subscription_renewed":
      return `when ${subject} renew${subject === "you" ? "" : "s"} their membership`;
  }
}

/**
 * One sentence covering everything a side earns under a snapshot. Frozen onto
 * the invitation so the promise in an email sent months ago still reads exactly
 * as it did then.
 */
export function summarizeSide(terms: ReferralTerms, side: RewardSide): string {
  const parts = rewardsForSide(terms, side).map(
    ({ rule, reward }) => `${describeReward(reward, { plain: true })} ${describeTrigger(rule.trigger, side)}`,
  );
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Short both-sides teaser for buttons and banners ("They get X, you get Y"). */
export function inviteTeaser(terms: ReferralTerms): string {
  const referred = rewardsForSide(terms, "referred")[0];
  const referrer = rewardsForSide(terms, "referrer")[0];
  if (!referred && !referrer) return "Invite a friend";
  if (referred && referrer) {
    return `They get ${describeReward(referred.reward)}, you get ${describeReward(referrer.reward)}`;
  }
  const only = referred ?? referrer!;
  return only === referred
    ? `Give a friend ${describeReward(only.reward)}`
    : `Earn ${describeReward(only.reward)} per friend`;
}

// ---- Invitation + reward views (API shapes shared with the client) ----------

export type InvitationStatus = "pending" | "accepted" | "expired" | "void" | "blocked";

/** What the invited person has done so far — drives the inviter's progress list. */
export interface InvitationProgress {
  signedUp: boolean;
  verified: boolean;
  activated: boolean;
  purchased: boolean;
}

export function emptyProgress(): InvitationProgress {
  return { signedUp: false, verified: false, activated: false, purchased: false };
}

/**
 * The inviter-facing view of one invitation. Deliberately excludes anything
 * about the invitee beyond the address the inviter typed themselves.
 */
export interface InvitationView {
  id: string;
  code: string;
  /** The address the inviter entered; null for a shared link. */
  recipientEmail: string | null;
  status: InvitationStatus;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  progress: InvitationProgress;
  /** Frozen promise for the inviter, e.g. "100 Sparks when they first buy". */
  referrerSummary: string;
  /** How many reminder emails have gone out (capped at one). */
  remindersSent: number;
  /** True when at least one reward has actually been granted for it. */
  rewarded: boolean;
}

export type RewardStatus = "pending" | "granted" | "void" | "clawed_back" | "review";

/** One earned (or pending) reward, as shown in the wallet. */
export interface RewardView {
  id: string;
  side: RewardSide;
  status: RewardStatus;
  /** e.g. "100 Sparks" — what the reward is. */
  summary: string;
  /** e.g. "when your friend makes a first purchase" — what unlocks it. */
  unlocks: string;
  at: number;
  /**
   * When a granted discount stops being usable (null when it doesn't expire or
   * isn't a discount). There is deliberately no code to type: earned discounts
   * apply themselves at checkout.
   */
  expiresAt: number | null;
  /** True once a discount reward has been used on a purchase. */
  used: boolean;
}

/** Everything the invite screen needs in one round trip. */
export interface ReferralOverview {
  enabled: boolean;
  /** The caller's evergreen share code. */
  code: string;
  /** Absolute share link built by the server from the configured site URL. */
  shareUrl: string;
  headline: string;
  subline: string;
  /** Live teaser from the CURRENT config (what a new invitation would promise). */
  teaser: string;
  referrerSummary: string;
  referredSummary: string;
  /** False when this account may not send invitations (unverified, or no purchase yet). */
  canInvite: boolean;
  /** Why not, when `canInvite` is false. */
  cannotInviteReason: string | null;
  invitationsLeftToday: number;
  invitations: InvitationView[];
  rewards: RewardView[];
}

// ---- Statistics -------------------------------------------------------------

/** One day's referral funnel counters (`referralStats/{YYYY-MM-DD}`). */
export interface ReferralDayStats {
  day: string;
  invitesSent: number;
  invitesAccepted: number;
  verified: number;
  activated: number;
  purchased: number;
  rewardsGranted: number;
  /** Estimated payout cost in the pricing base currency. */
  rewardCost: number;
  clawbacks: number;
}

export function emptyDayStats(day = ""): ReferralDayStats {
  return {
    day,
    invitesSent: 0,
    invitesAccepted: 0,
    verified: 0,
    activated: 0,
    purchased: 0,
    rewardsGranted: 0,
    rewardCost: 0,
    clawbacks: 0,
  };
}

export function normalizeDayStats(day: string, raw: unknown): ReferralDayStats {
  const d = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    day,
    invitesSent: n(d.invitesSent),
    invitesAccepted: n(d.invitesAccepted),
    verified: n(d.verified),
    activated: n(d.activated),
    purchased: n(d.purchased),
    rewardsGranted: n(d.rewardsGranted),
    rewardCost: n(d.rewardCost),
    clawbacks: n(d.clawbacks),
  };
}

/** One inviter's totals, for the admin's top-inviters table. */
export interface InviterStats {
  uid: string;
  email: string | null;
  sent: number;
  accepted: number;
  rewarded: number;
  cost: number;
  /** True once they're past the lifetime rewarded cap (payouts held for review). */
  needsReview: boolean;
}

/**
 * A reward waiting for a human: held by the lifetime cap or the daily budget,
 * undeliverable (a free month for a cancelled membership), or stuck mid-delivery.
 * The admin either releases it or declines it — "held" is a decision queue, not
 * a graveyard.
 */
export interface HeldRewardView {
  id: string;
  uid: string;
  email: string | null;
  side: RewardSide;
  status: RewardStatus;
  /** What the reward is, e.g. "100 Sparks". */
  summary: string;
  /** What earned it, e.g. "when your friend makes a first purchase". */
  unlocks: string;
  /** Estimated payout cost in the pricing base currency. */
  cost: number;
  at: number;
  /** Why it's held — the limit that bit, or the delivery failure. */
  note: string | null;
  invitationId: string;
}

export interface ReferralStatsSummary {
  from: number;
  to: number;
  totals: ReferralDayStats;
  series: ReferralDayStats[];
  topInviters: InviterStats[];
  /** How many rewards are waiting for a human (the length of `held`, uncapped). */
  pendingReview: number;
  /** The queue itself, oldest first, so the admin can act on each one. */
  held: HeldRewardView[];
}

/** Funnel conversion rates derived from a totals row (pure, for the admin panel). */
export function funnelRates(t: ReferralDayStats): {
  acceptRate: number;
  purchaseRate: number;
  costPerPayingCustomer: number;
} {
  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
  return {
    acceptRate: pct(t.invitesAccepted, t.invitesSent),
    purchaseRate: pct(t.purchased, t.invitesAccepted),
    costPerPayingCustomer: t.purchased > 0 ? Math.round((t.rewardCost / t.purchased) * 100) / 100 : 0,
  };
}

// ---- Defaults ---------------------------------------------------------------

export function createDefaultConditions(): RuleConditions {
  return {
    minPurchaseAmount: 0,
    referrerMustBeSubscriber: false,
    referredMustBeVerified: true,
    nthInvoice: 2,
  };
}

/** Mint a new rule with a unique id (ids are part of the reward idempotency key). */
export function createRewardRule(partial?: Partial<RewardRule>): RewardRule {
  const id =
    typeof partial?.id === "string" && partial.id.trim()
      ? partial.id.trim()
      : `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    enabled: partial?.enabled ?? true,
    trigger: partial?.trigger ?? "first_purchase",
    referrer: partial?.referrer ?? { kind: "sparks", sparks: 100 },
    referred: partial?.referred ?? { kind: "sparks", sparks: 50 },
    conditions: { ...createDefaultConditions(), ...(partial?.conditions ?? {}) },
  };
}

/**
 * The program ships disabled, with one payment-gated Sparks rule — the shape
 * that can't be farmed, and the same deal the pre-rules implementation paid.
 */
export function createDefaultReferralConfig(): ReferralConfig {
  return {
    version: 1,
    enabled: false,
    rules: [
      {
        id: "first-purchase",
        enabled: true,
        trigger: "first_purchase",
        referrer: { kind: "sparks", sparks: 100 },
        referred: { kind: "sparks", sparks: 50 },
        conditions: createDefaultConditions(),
      },
    ],
    limits: {
      invitesPerUserPerDay: 10,
      invitesPerUserPerMonth: 50,
      maxRewardedReferralsPerUser: 25,
      invitationExpiryDays: 45,
      linkExpiryDays: 180,
      dailyBudgetAmount: 250,
    },
    eligibility: {
      senderMustBeVerified: true,
      senderMustHavePurchased: false,
    },
    presentation: {
      headline: "Invite a friend, you both get a treat",
      subline: "Share your link — when your friend makes their first book you'll both be rewarded.",
    },
  };
}

/**
 * Build a program config from the legacy `sparks.referral` settings, so a
 * deployment that configured the old payment-gated referral keeps paying
 * exactly the same rewards until an admin edits the new program.
 */
export function referralConfigFromLegacy(legacy: {
  enabled: boolean;
  referrerSparks: number;
  referredSparks: number;
}): ReferralConfig {
  const def = createDefaultReferralConfig();
  return {
    ...def,
    enabled: legacy.enabled === true,
    rules: [
      {
        ...def.rules[0],
        referrer: legacy.referrerSparks > 0 ? { kind: "sparks", sparks: legacy.referrerSparks } : null,
        referred: legacy.referredSparks > 0 ? { kind: "sparks", sparks: legacy.referredSparks } : null,
      },
    ],
  };
}

// ---- Normalization ----------------------------------------------------------

function nonNegative(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function positiveInt(v: unknown, fallback: number): number {
  const n = nonNegative(v, fallback);
  return Math.max(1, Math.round(n));
}

const ITEM_TYPES: DiscountItemType[] = ["print", "ebook", "pack", "plan"];

function normalizeReward(raw: unknown): Reward | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "sparks": {
      const sparks = Math.round(nonNegative(r.sparks, 0));
      return sparks > 0 ? { kind: "sparks", sparks } : null;
    }
    case "discount": {
      const percentOff = Math.min(100, Math.round(nonNegative(r.percentOff, 0)));
      if (percentOff <= 0) return null;
      const appliesTo = Array.isArray(r.appliesTo)
        ? (r.appliesTo.filter((t): t is DiscountItemType => ITEM_TYPES.includes(t as DiscountItemType)))
        : [];
      return {
        kind: "discount",
        percentOff,
        appliesTo: appliesTo.length > 0 ? appliesTo : [...ITEM_TYPES],
        expiresInDays: positiveInt(r.expiresInDays, 60),
      };
    }
    case "freeMonths": {
      const months = Math.round(nonNegative(r.months, 0));
      return months > 0 ? { kind: "freeMonths", months: Math.min(12, months) } : null;
    }
    default:
      return null;
  }
}

function normalizeConditions(raw: unknown): RuleConditions {
  const def = createDefaultConditions();
  const c = (raw ?? {}) as Partial<RuleConditions>;
  return {
    minPurchaseAmount: nonNegative(c.minPurchaseAmount, def.minPurchaseAmount),
    referrerMustBeSubscriber: c.referrerMustBeSubscriber === true,
    referredMustBeVerified: c.referredMustBeVerified !== false,
    nthInvoice: Math.max(2, Math.round(nonNegative(c.nthInvoice, def.nthInvoice))),
  };
}

/**
 * Coerce one rule, dropping rewards its trigger or side isn't allowed to issue.
 * This is the same guard the Zod schema enforces on save — applied again on READ
 * so a hand-edited Firestore doc can never turn a signup trigger into a Spark
 * faucet.
 */
function normalizeRule(raw: unknown, index: number): RewardRule {
  const r = (raw ?? {}) as Partial<RewardRule>;
  const trigger: RewardTrigger = REWARD_TRIGGERS.includes(r.trigger as RewardTrigger)
    ? (r.trigger as RewardTrigger)
    : "first_purchase";
  const keep = (reward: Reward | null, side: RewardSide): Reward | null => {
    if (!reward) return null;
    if (!rewardAllowedForTrigger(trigger, reward.kind)) return null;
    if (!rewardAllowedForSide(side, reward.kind)) return null;
    return reward;
  };
  const conditions = normalizeConditions(r.conditions);
  const referrer = keep(normalizeReward(r.referrer), "referrer");
  return {
    id: typeof r.id === "string" && r.id.trim() ? r.id.trim() : `rule-${index + 1}`,
    enabled: r.enabled === true,
    trigger,
    referrer,
    referred: keep(normalizeReward(r.referred), "referred"),
    // Free months are only ever safe for someone already paying you.
    conditions:
      referrer?.kind === "freeMonths"
        ? { ...conditions, referrerMustBeSubscriber: true }
        : conditions,
  };
}

export function normalizeReferralConfig(input: unknown): ReferralConfig {
  const def = createDefaultReferralConfig();
  const p = (input ?? {}) as Partial<ReferralConfig>;
  const rules = Array.isArray(p.rules)
    ? p.rules.slice(0, MAX_REWARD_RULES).map(normalizeRule)
    : def.rules;
  // Duplicate ids would collapse two rules onto one idempotency key, so the
  // later duplicate is renamed rather than silently paying once.
  const seen = new Set<string>();
  for (const rule of rules) {
    let id = rule.id;
    let n = 2;
    while (seen.has(id)) id = `${rule.id}-${n++}`;
    rule.id = id;
    seen.add(id);
  }
  return {
    version: 1,
    enabled: p.enabled === true,
    rules,
    limits: {
      invitesPerUserPerDay: positiveInt(p.limits?.invitesPerUserPerDay, def.limits.invitesPerUserPerDay),
      invitesPerUserPerMonth: positiveInt(p.limits?.invitesPerUserPerMonth, def.limits.invitesPerUserPerMonth),
      maxRewardedReferralsPerUser: positiveInt(
        p.limits?.maxRewardedReferralsPerUser,
        def.limits.maxRewardedReferralsPerUser,
      ),
      invitationExpiryDays: positiveInt(p.limits?.invitationExpiryDays, def.limits.invitationExpiryDays),
      linkExpiryDays: positiveInt(p.limits?.linkExpiryDays, def.limits.linkExpiryDays),
      dailyBudgetAmount: nonNegative(p.limits?.dailyBudgetAmount, def.limits.dailyBudgetAmount),
    },
    eligibility: {
      senderMustBeVerified: p.eligibility?.senderMustBeVerified !== false,
      senderMustHavePurchased: p.eligibility?.senderMustHavePurchased === true,
    },
    presentation: {
      headline:
        typeof p.presentation?.headline === "string" && p.presentation.headline.trim()
          ? p.presentation.headline.trim().slice(0, 120)
          : def.presentation.headline,
      subline:
        typeof p.presentation?.subline === "string" && p.presentation.subline.trim()
          ? p.presentation.subline.trim().slice(0, 300)
          : def.presentation.subline,
    },
  };
}

/** Coerce a stored terms snapshot (tolerant: old invitations must keep working). */
export function normalizeTerms(raw: unknown): ReferralTerms {
  const t = (raw ?? {}) as Partial<ReferralTerms>;
  const rules = Array.isArray(t.rules) ? t.rules.slice(0, MAX_REWARD_RULES).map(normalizeRule) : [];
  const terms: ReferralTerms = {
    rules,
    referrerSummary: typeof t.referrerSummary === "string" ? t.referrerSummary : "",
    referredSummary: typeof t.referredSummary === "string" ? t.referredSummary : "",
    at: nonNegative(t.at, 0),
  };
  // Re-derive missing summaries so a doc written before they existed still reads.
  if (!terms.referrerSummary) terms.referrerSummary = summarizeSide(terms, "referrer");
  if (!terms.referredSummary) terms.referredSummary = summarizeSide(terms, "referred");
  return terms;
}

// ---- Validation (used by the backend before persisting) --------------------

const rewardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sparks"), sparks: z.number().min(0) }),
  z.object({
    kind: z.literal("discount"),
    percentOff: z.number().min(0).max(100),
    appliesTo: z.array(z.enum(["print", "ebook", "pack", "plan"])),
    expiresInDays: z.number().min(1).max(365),
  }),
  z.object({ kind: z.literal("freeMonths"), months: z.number().min(1).max(12) }),
]);

const ruleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  trigger: z.enum(REWARD_TRIGGERS),
  referrer: rewardSchema.nullable(),
  referred: rewardSchema.nullable(),
  conditions: z
    .object({
      minPurchaseAmount: z.number().min(0),
      referrerMustBeSubscriber: z.boolean(),
      referredMustBeVerified: z.boolean(),
      nthInvoice: z.number().min(2),
    })
    .partial()
    .optional(),
});

export const referralConfigSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    rules: z.array(ruleSchema).max(MAX_REWARD_RULES),
    limits: z.object({
      invitesPerUserPerDay: z.number().min(1),
      invitesPerUserPerMonth: z.number().min(1),
      maxRewardedReferralsPerUser: z.number().min(1),
      invitationExpiryDays: z.number().min(1),
      linkExpiryDays: z.number().min(1),
      dailyBudgetAmount: z.number().min(0),
    }),
    eligibility: z.object({
      senderMustBeVerified: z.boolean(),
      senderMustHavePurchased: z.boolean(),
    }),
    presentation: z.object({ headline: z.string(), subline: z.string() }),
  })
  .superRefine((cfg, ctx) => {
    cfg.rules.forEach((rule, i) => {
      for (const side of ["referrer", "referred"] as const) {
        const reward = rule[side];
        if (!reward) continue;
        if (!rewardAllowedForTrigger(rule.trigger, reward.kind)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rules", i, side],
            message:
              `"${TRIGGER_META[rule.trigger].label}" happens before the invited person has paid anything, ` +
              `so it can only award a discount — a Spark or free-month reward there can be farmed with throwaway accounts.`,
          });
        }
        if (!rewardAllowedForSide(side, reward.kind)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rules", i, side],
            message: "Free months can only be awarded to the referrer, and only while they're a paying member.",
          });
        }
      }
    });
  });
