/**
 * **Marketing campaigns** — the admin-configurable engine behind every reward,
 * refund, price break and free action the product hands out.
 *
 * Four ideas carry the whole design:
 *
 *   1. **Rules are disjunctive normal form.** A rule is ONE trigger plus a flat
 *      AND-list of conditions. "OR" is expressed by adding another rule. Every
 *      boolean expression can be written this way, so the admin loses no
 *      expressive power — but each rule stays linearly readable, linearly
 *      explainable in prose, and testable on its own. A nested condition tree
 *      would let an admin express contradictions no one could debug and no
 *      sentence could describe.
 *
 *   2. **Effects are typed, not generic.** Granting Sparks, refunding spent
 *      Sparks, making an action free and discounting a purchase touch money at
 *      four different moments (ledger, ledger-history, pricing, checkout) with
 *      four different reversal stories. They share this config shell and nothing
 *      else — see {@link CampaignEffect}.
 *
 *   3. **Two clocks.** {@link CampaignWindow} is absolute and global ("live
 *      until March 1"). Everything relative ("60 days after you earn it", "7
 *      days after signup") runs off the per-user enrollment. Conflating them is
 *      why "everyone who signs up before X" is otherwise unimplementable.
 *
 *   4. **Prose is generated from structure.** {@link describeCondition} and
 *      {@link describeEffect} are exhaustive switches, so TypeScript refuses to
 *      compile a new condition or effect that has no user-facing sentence. A
 *      silently undescribed condition means promising more than you pay out.
 *
 * SAFETY: campaigns ship as an empty list, every campaign starts as a `draft`,
 * and every payout path is additionally gated on the Sparks economy being on.
 * Turning any of this on is a deliberate admin action.
 */
import { z } from "zod";
import {
  ALL_IMAGE_ACTION_IDS,
  ALL_TEXT_ACTION_IDS,
  IMAGE_ACTIONS,
  TEXT_ACTIONS,
} from "../ai/actions";
import { IMAGE_TIERS, type ImageTier } from "./modelConfig";
import { DISCOUNT_ITEM_LABELS, type DiscountItemType } from "./discountImpact";
import { BUYER_ROLES, BUYER_ROLE_PHRASES, type BuyerRole } from "./buyerRoles";

/** The Spark glyph, matched to the referral module's copy. */
export const SPARK_SYMBOL = "✦";

const DAY_MS = 86_400_000;

// ---- Triggers ---------------------------------------------------------------

/**
 * The moments that can fire a rule. Ordered by how much they prove: `always`
 * proves nothing at all (it's a standing offer), a paid invoice proves
 * everything.
 *
 * `always` is not really an event — it means "this rule is in force for anyone
 * enrolled, continuously". It's how a price override ("fast renders are free")
 * or a storewide sale is expressed, and it is the ONLY trigger that may carry
 * those two effects, because they're evaluated at quote/checkout time rather
 * than delivered once.
 */
export const CAMPAIGN_TRIGGERS = [
  "always",
  "signup",
  "email_verified",
  "first_book_completed",
  "purchase",
  "subscription_started",
  "subscription_renewed",
  "survey_completed",
  "feedback_submitted",
  "days_after_signup",
  "days_after_project_created",
] as const;

export type CampaignTrigger = (typeof CAMPAIGN_TRIGGERS)[number];

export interface TriggerMeta {
  id: CampaignTrigger;
  label: string;
  /** What has to happen for this to fire (admin-facing). */
  description: string;
  /** True when the trigger fires before the user has paid anything, ever. */
  prePayment: boolean;
  /**
   * True when the trigger is evaluated continuously rather than delivered once.
   * Standing triggers can only carry standing effects, and vice versa.
   */
  standing: boolean;
  /** True when a scheduled sweep fires it (needs `afterDays` on the rule). */
  scheduled: boolean;
}

export const TRIGGER_META: Record<CampaignTrigger, TriggerMeta> = {
  always: {
    id: "always",
    label: "Always on (standing offer)",
    description:
      "In force for everyone in the audience for as long as the campaign runs. Use this for price breaks and storewide sales — not for one-off rewards.",
    prePayment: true,
    standing: true,
    scheduled: false,
  },
  signup: {
    id: "signup",
    label: "Signs up",
    description: "A visitor turns into a real (non-guest) account.",
    prePayment: true,
    standing: false,
    scheduled: false,
  },
  email_verified: {
    id: "email_verified",
    label: "Verifies their email",
    description: "The account confirms its email address.",
    prePayment: true,
    standing: false,
    scheduled: false,
  },
  first_book_completed: {
    id: "first_book_completed",
    label: "Finishes their first book",
    description: "Real activation — the book is done, but no money has moved.",
    prePayment: true,
    standing: false,
    scheduled: false,
  },
  purchase: {
    id: "purchase",
    label: "Buys something",
    description:
      "Any paid purchase clears: a print order, the digital edition, a Spark pack or a gift. Narrow it with the item-type condition.",
    prePayment: false,
    standing: false,
    scheduled: false,
  },
  subscription_started: {
    id: "subscription_started",
    label: "Becomes a member",
    description: "A subscription starts and its first invoice is paid.",
    prePayment: false,
    standing: false,
    scheduled: false,
  },
  subscription_renewed: {
    id: "subscription_renewed",
    label: "Renews their membership",
    description: "A later membership invoice is paid — this rewards retention rather than signup.",
    prePayment: false,
    standing: false,
    scheduled: false,
  },
  survey_completed: {
    id: "survey_completed",
    label: "Answers a survey",
    description:
      "The customer completes a profiling question set. Paying for answers lowers their quality — keep the reward small, and expect to segment incentivised responses out of your analysis.",
    prePayment: true,
    standing: false,
    scheduled: false,
  },
  feedback_submitted: {
    id: "feedback_submitted",
    label: "Sends feedback",
    description:
      "The customer submits the contact/feedback form. Nothing can judge whether feedback was useful, so this trigger always requires an admin to approve the payout.",
    prePayment: true,
    standing: false,
    scheduled: false,
  },
  days_after_signup: {
    id: "days_after_signup",
    label: "N days after signing up",
    description: "A scheduled sweep fires this once, N days after the account was created.",
    prePayment: true,
    standing: false,
    scheduled: true,
  },
  days_after_project_created: {
    id: "days_after_project_created",
    label: "N days after starting a book",
    description: "A scheduled sweep fires this once per book, N days after it was started.",
    prePayment: true,
    standing: false,
    scheduled: true,
  },
};

export const TRIGGERS: TriggerMeta[] = CAMPAIGN_TRIGGERS.map((id) => TRIGGER_META[id]);

// ---- Conditions -------------------------------------------------------------

/**
 * One extra gate on a rule, beyond its trigger firing. A rule's conditions are
 * ANDed; to express OR, add a second rule.
 *
 * Every member of this union must appear in {@link describeCondition} and in
 * {@link conditionApplies} — both are exhaustive switches, so the compiler
 * enforces it.
 */
export type RuleCondition =
  /** Restrict a `purchase` trigger to certain item types. */
  | { kind: "itemType"; items: DiscountItemType[] }
  /** Their first ever purchase (or explicitly NOT their first). */
  | { kind: "firstPurchase"; value: boolean }
  /** Minimum qualifying purchase amount, in the pricing base currency. */
  | { kind: "minAmount"; amount: number }
  /** Only accounts with a verified email. */
  | { kind: "emailVerified" }
  /** Account age in days, inclusive bounds (`maxDays` 0 = no upper bound). */
  | { kind: "accountAge"; minDays: number; maxDays: number }
  /** Only (or explicitly never) active paying members. */
  | { kind: "isSubscriber"; value: boolean }
  /** Only these plan ids (empty = any plan). */
  | { kind: "hasPlan"; planIds: string[] }
  /** Billing/geo country, ISO-2 (empty = anywhere). */
  | { kind: "country"; countries: string[] }
  /** Only these catalog product ids (print SKUs, plan ids, pack ids). */
  | { kind: "productId"; productIds: string[] }
  /** For `subscription_renewed`: which invoice number pays out (2 = 1st renewal). */
  | { kind: "nthInvoice"; min: number }
  /** For `survey_completed`: only this question set. */
  | { kind: "surveyId"; surveyId: string }
  /** The account has spent at least this many Sparks in total. */
  | { kind: "minSparksSpent"; sparks: number }
  /**
   * Who the customer told us they were buying for.
   *
   * `latest` reads their most recent answer, `ever` matches anyone who has ever
   * identified that way. The distinction is the whole value of the survey series:
   * `latest: grandparent` is "buying for a grandchild right now", while
   * `ever: parent` is "has children of their own", which stays true forever and is
   * what makes "a parent buying a gift" targetable at all.
   */
  | { kind: "buyerRole"; roles: BuyerRole[]; mode: "latest" | "ever" }
  /**
   * They picked one of these options in a survey.
   *
   * Read from the small answer-key set on the profile, so this costs nothing on the
   * pricing path. Ids rather than labels: rewording an option must not silently
   * empty a live campaign's audience.
   */
  | {
      kind: "surveyAnswer";
      surveyId: string;
      questionId: string;
      optionIds: string[];
    };

export type RuleConditionKind = RuleCondition["kind"];

export const CONDITION_KINDS: RuleConditionKind[] = [
  "itemType",
  "firstPurchase",
  "minAmount",
  "emailVerified",
  "accountAge",
  "isSubscriber",
  "hasPlan",
  "country",
  "productId",
  "nthInvoice",
  "surveyId",
  "minSparksSpent",
  "buyerRole",
  "surveyAnswer",
];

export const CONDITION_LABELS: Record<RuleConditionKind, string> = {
  itemType: "Item type",
  firstPurchase: "First purchase",
  minAmount: "Minimum amount",
  emailVerified: "Email verified",
  accountAge: "Account age",
  isSubscriber: "Membership",
  hasPlan: "On a specific plan",
  country: "Country",
  productId: "Specific product",
  nthInvoice: "Which invoice",
  surveyId: "Specific survey",
  minSparksSpent: "Sparks already spent",
  buyerRole: "Who they buy for",
  surveyAnswer: "Gave a specific answer",
};

/** A blank condition of each kind, for the admin's "add condition" menu. */
export function createCondition(kind: RuleConditionKind): RuleCondition {
  switch (kind) {
    case "itemType":
      return { kind, items: ["print"] };
    case "firstPurchase":
      return { kind, value: true };
    case "minAmount":
      return { kind, amount: 0 };
    case "emailVerified":
      return { kind };
    case "accountAge":
      return { kind, minDays: 0, maxDays: 0 };
    case "isSubscriber":
      return { kind, value: true };
    case "hasPlan":
      return { kind, planIds: [] };
    case "country":
      return { kind, countries: [] };
    case "productId":
      return { kind, productIds: [] };
    case "nthInvoice":
      return { kind, min: 2 };
    case "surveyId":
      return { kind, surveyId: "" };
    case "minSparksSpent":
      return { kind, sparks: 0 };
    case "buyerRole":
      return { kind, roles: [], mode: "latest" };
    case "surveyAnswer":
      return { kind, surveyId: "", questionId: "", optionIds: [] };
  }
}

/**
 * Which conditions make sense for which trigger. A condition that can never be
 * evaluated for a trigger (an item type on a signup) isn't a harmless no-op —
 * it reads in the admin UI as a restriction that is silently ignored, which is
 * exactly how a campaign pays out more widely than its author believed.
 */
const TRIGGER_ONLY_CONDITIONS: Partial<Record<RuleConditionKind, CampaignTrigger[]>> = {
  itemType: ["purchase"],
  firstPurchase: ["purchase"],
  minAmount: ["purchase", "subscription_started", "subscription_renewed"],
  productId: ["purchase", "subscription_started", "subscription_renewed"],
  nthInvoice: ["subscription_renewed"],
  surveyId: ["survey_completed"],
};

export function conditionAllowedForTrigger(trigger: CampaignTrigger, kind: RuleConditionKind): boolean {
  const only = TRIGGER_ONLY_CONDITIONS[kind];
  return !only || only.includes(trigger);
}

// ---- Effects ----------------------------------------------------------------

/**
 * Free Sparks, straight into the balance. Real provider spend, so it may only
 * hang off a trigger that proves payment — or off one that an admin approves by
 * hand ({@link CampaignRule.requiresApproval}).
 */
export interface SparksEffect {
  kind: "sparks";
  sparks: number;
  /**
   * How long the granted Sparks live (0 = forever). An unbounded promotional
   * balance is an unbounded liability tail, so a finite life is the default.
   */
  expiresInDays: number;
}

/**
 * What a spend-refund is allowed to look back at. This is the difference
 * between "10% of what you spent on this book" and "everything you have ever
 * burned", which differ by an order of magnitude in cost.
 */
export interface SpendScope {
  /**
   * `purchased` counts only Sparks the customer actually paid for (pack, gift,
   * subscription-funded); `all` also refunds Sparks that were given away, which
   * hands back provider capacity you were never paid for. `all` is the expensive
   * one and the admin UI says so.
   */
  funding: "purchased" | "all";
  /** Limit to these action ids (empty = every action). */
  actions: string[];
  /** Limit to these image tiers (empty = every tier). */
  tiers: ImageTier[];
  /**
   * `purchasedProject` counts only spend on the book being bought — the version
   * that scales with the sale. `any` counts the whole account.
   */
  projects: "any" | "purchasedProject";
  /**
   * Only spend from after the customer was enrolled. Off by default because the
   * headline offer ("get your credits back") reads as retroactive; on, it caps
   * the liability to spend that happened while the offer was live.
   */
  sinceEnrollment: boolean;
}

/**
 * Give back Sparks the customer already spent. The one effect with genuinely
 * unbounded exposure — spent Sparks are provider cost you have already paid in
 * cash, so this hands back capacity rather than margin. Hence three caps, not
 * one, and `maxPctOfPurchase` is the one that actually keeps it safe: it ties
 * the refund to the size of the sale that triggered it.
 */
export interface SpendRefundEffect {
  kind: "spendRefund";
  /** Share of qualifying spend to return (100 = all of it). */
  percent: number;
  scope: SpendScope;
  /**
   * Floor for a non-zero refund. `topUp` pays this much when the computed
   * refund lands below it; `skip` pays nothing at all. The two behave very
   * differently on small orders, so the admin picks explicitly.
   */
  minRefundSparks: number;
  minRefundMode: "topUp" | "skip";
  /** Hard ceiling in Sparks (0 = no Spark ceiling). */
  maxRefundSparks: number;
  /**
   * Ceiling as a share of the triggering purchase's amount, valued at the Spark
   * peg (0 = no ceiling). This is what stops a customer burning 3,000 Sparks and
   * then claiming them back against your cheapest book.
   */
  maxPctOfPurchase: number;
}

/**
 * Change what an action costs while the campaign runs. Never touches the ledger:
 * it modifies the price at BOTH quote time and settle time, which has to stay in
 * lockstep or the studio quotes one number and the wallet charges another.
 */
export interface ActionPricingEffect {
  kind: "actionPricing";
  /** Action ids this covers (empty = every image action). */
  actions: string[];
  /** Image tiers this covers (empty = every tier). */
  tiers: ImageTier[];
  /** `free` zeroes the price; `multiplier` scales it (0.5 = half price). */
  mode: "free" | "multiplier";
  multiplier: number;
}

/**
 * A percentage discount on a future purchase, delivered the same way a referral
 * discount is: earned, stored, and applied automatically at checkout with no code
 * to type. Percentage rather than a fixed amount so it needs no per-currency
 * table and can never exceed the item's price.
 */
export interface PurchaseDiscountEffect {
  kind: "purchaseDiscount";
  percentOff: number;
  /** Which item types it may be redeemed against. */
  appliesTo: DiscountItemType[];
  /** How long the earned discount stays valid (0 = until the campaign ends). */
  expiresInDays: number;
  /**
   * Memberships only: whether the discount rides every renewal invoice or just
   * the first one. "Every renewal" is a permanent haircut on that subscriber's
   * lifetime value — a very different commitment from a welcome offer.
   */
  recurring: boolean;
}

export type CampaignEffect =
  | SparksEffect
  | SpendRefundEffect
  | ActionPricingEffect
  | PurchaseDiscountEffect;

export type EffectKind = CampaignEffect["kind"];

export const EFFECT_KINDS: EffectKind[] = ["sparks", "spendRefund", "actionPricing", "purchaseDiscount"];

export const EFFECT_LABELS: Record<EffectKind, string> = {
  sparks: "Give Sparks",
  spendRefund: "Refund spent Sparks",
  actionPricing: "Change what an action costs",
  purchaseDiscount: "Discount a purchase",
};

/**
 * Standing effects are in force continuously and are read at quote/checkout
 * time; delivered effects happen once, in response to an event. Mixing the two
 * (a Spark grant on `always`, or a price override on `purchase`) is always a
 * configuration mistake, so the schema rejects it outright.
 */
export function effectIsStanding(kind: EffectKind): boolean {
  return kind === "actionPricing";
}

/**
 * Which effects a trigger may carry.
 *
 *   - Standing effects (`actionPricing`) only make sense on `always`.
 *   - Sparks and Spark refunds are cash: every Spark maps to real provider
 *     spend. On a pre-payment trigger they can be farmed with throwaway
 *     accounts, so they need an approval step — see {@link ruleNeedsApproval}.
 *   - A discount costs margin only if revenue actually arrives, and nothing at
 *     all if it's never redeemed, so it's safe anywhere.
 */
export function effectAllowedForTrigger(trigger: CampaignTrigger, kind: EffectKind): boolean {
  const standingTrigger = TRIGGER_META[trigger].standing;
  if (effectIsStanding(kind)) return standingTrigger;
  if (standingTrigger) return kind === "purchaseDiscount";
  // A spend refund needs a purchase to size itself against.
  if (kind === "spendRefund") {
    return trigger === "purchase" || trigger === "subscription_started" || trigger === "subscription_renewed";
  }
  return true;
}

/**
 * True when a rule hands over real value on a trigger that proves no payment —
 * the shape that has to be approved by a human rather than paid automatically.
 * Feedback is always in this bucket: no code can judge whether feedback helped.
 */
export function ruleNeedsApproval(trigger: CampaignTrigger, kind: EffectKind): boolean {
  if (trigger === "feedback_submitted") return true;
  if (kind === "sparks" || kind === "spendRefund") return TRIGGER_META[trigger].prePayment;
  return false;
}

export function createEffect(kind: EffectKind): CampaignEffect {
  switch (kind) {
    case "sparks":
      return { kind, sparks: 50, expiresInDays: 180 };
    case "spendRefund":
      return {
        kind,
        percent: 100,
        scope: { funding: "purchased", actions: [], tiers: [], projects: "purchasedProject", sinceEnrollment: false },
        minRefundSparks: 0,
        minRefundMode: "skip",
        maxRefundSparks: 500,
        maxPctOfPurchase: 50,
      };
    case "actionPricing":
      return { kind, actions: [], tiers: ["quick"], mode: "free", multiplier: 1 };
    case "purchaseDiscount":
      return { kind, percentOff: 10, appliesTo: ["print"], expiresInDays: 60, recurring: false };
  }
}

// ---- Rules ------------------------------------------------------------------

export interface CampaignRule {
  /**
   * Stable id — it forms part of the redemption idempotency key, so renaming a
   * rule would re-pay everyone who already qualified under the old id. The admin
   * UI never reuses an id.
   */
  id: string;
  enabled: boolean;
  trigger: CampaignTrigger;
  /** ANDed. For OR, add another rule to the campaign. */
  conditions: RuleCondition[];
  effect: CampaignEffect;
  /** For the scheduled triggers: how many days after the anchor event. */
  afterDays: number;
  /** How many times this rule may fire per account (0 = unlimited). */
  maxPerAccount: number;
  /**
   * Hold the payout for an admin decision instead of delivering it. Forced on
   * for rules {@link ruleNeedsApproval} flags, and freely settable otherwise.
   */
  requiresApproval: boolean;
}

/** Hard cap on rules per campaign, so a frozen snapshot can't grow unbounded. */
export const MAX_RULES_PER_CAMPAIGN = 10;

/** Hard cap on campaigns, so evaluation on the hot pricing path stays cheap. */
export const MAX_CAMPAIGNS = 40;

export function createRule(partial?: Partial<CampaignRule>): CampaignRule {
  const id =
    typeof partial?.id === "string" && partial.id.trim()
      ? partial.id.trim()
      : `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const trigger = partial?.trigger ?? "purchase";
  const effect = partial?.effect ?? createEffect("sparks");
  return {
    id,
    enabled: partial?.enabled ?? true,
    trigger,
    conditions: partial?.conditions ?? [],
    effect,
    afterDays: partial?.afterDays ?? 7,
    maxPerAccount: partial?.maxPerAccount ?? 1,
    requiresApproval: partial?.requiresApproval ?? ruleNeedsApproval(trigger, effect.kind),
  };
}

// ---- Audience + window ------------------------------------------------------

/**
 * The absolute, global clock: when the campaign accepts new enrollments. Pausing
 * or ending a campaign stops NEW enrollments; it does not renege on promises
 * already frozen onto an enrollment (see {@link CampaignTerms}).
 */
export interface CampaignWindow {
  /** Inclusive start, ms epoch (0 = as soon as it goes active). */
  startsAt: number;
  /** Inclusive end, ms epoch (0 = open-ended). */
  endsAt: number;
}

/**
 * Who may enroll. Evaluated ONCE, when the user first comes into contact with the
 * campaign; the answer is frozen onto the enrollment. `signedUpBetween` is the
 * "everyone who joins before March" case — it's an audience filter rather than a
 * window, because it describes the user, not the campaign.
 */
export interface CampaignAudience {
  /** Only accounts created in this window (0/0 = any). */
  signedUpFrom: number;
  signedUpTo: number;
  /** Billing/geo countries, ISO-2 (empty = anywhere). */
  countries: string[];
  /** Only these accounts. The escape hatch for make-goods and pilots. */
  allowlistUids: string[];
  /** Require a verified email before anything is earned (strongly recommended). */
  requireVerified: boolean;
  /**
   * Let anonymous guest sessions enroll. Almost always wrong: a guest has no
   * payment relationship and costs nothing to create, so anything of value handed
   * to one is a faucet.
   */
  allowGuests: boolean;
}

export function createAudience(): CampaignAudience {
  return {
    signedUpFrom: 0,
    signedUpTo: 0,
    countries: [],
    allowlistUids: [],
    requireVerified: true,
    allowGuests: false,
  };
}

// ---- Limits -----------------------------------------------------------------

export interface CampaignLimits {
  /** Redemptions per account across the whole campaign (0 = unlimited). */
  maxPerAccount: number;
  /** Redemptions across all accounts (0 = unlimited) — the "first 100" cap. */
  maxTotal: number;
  /**
   * Payout ceiling per UTC day, in the pricing base currency. Past it, payouts
   * are held for review and an alert fires — the circuit breaker against a
   * misconfiguration or a farming wave. 0 disables it (not recommended).
   */
  dailyBudget: number;
  /** Payout ceiling for the campaign's whole life (0 = unlimited). */
  lifetimeBudget: number;
}

export function createLimits(): CampaignLimits {
  return { maxPerAccount: 1, maxTotal: 0, dailyBudget: 250, lifetimeBudget: 0 };
}

// ---- Campaign ---------------------------------------------------------------

/**
 * `draft` never evaluates. `active` enrolls and pays. `paused` stops NEW
 * enrollments but honors existing ones. `ended` is the archive state — set
 * automatically once the window closes.
 */
export type CampaignStatus = "draft" | "active" | "paused" | "ended";

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
};

export interface Campaign {
  id: string;
  /** Admin-facing name. Never shown to customers. */
  name: string;
  /** Admin-facing note: why this campaign exists, what it's testing. */
  notes: string;
  status: CampaignStatus;
  window: CampaignWindow;
  audience: CampaignAudience;
  rules: CampaignRule[];
  limits: CampaignLimits;
  /**
   * Customer-facing copy. Both are OPTIONAL overrides — leave them empty and the
   * headline is generated from the rules, which is the version that can't drift
   * out of sync with what actually pays out.
   */
  presentation: { headline: string; subline: string };
  /**
   * Whether this campaign's discount may combine with another campaign's. When
   * false, the single best non-stackable offer wins.
   */
  stackable: boolean;
  /** Higher wins when two non-stackable offers collide. */
  priority: number;
  /**
   * Share of the eligible audience deliberately EXCLUDED, so their behaviour can
   * be compared against the treated group. Without a holdout you cannot tell a
   * purchase your campaign caused from one that would have happened anyway — you
   * pay for both and can't distinguish them. Assignment is a deterministic hash
   * of (uid, campaign id), so it's stable and needs no stored coin flip.
   */
  holdoutPct: number;
  createdAt: number;
  updatedAt: number;
}

export interface CampaignsConfig {
  version: 1;
  /** Master switch for the whole engine. Off ⇒ nothing enrolls, nothing pays. */
  enabled: boolean;
  campaigns: Campaign[];
  updatedAt: number;
}

export function createCampaign(partial?: Partial<Campaign>): Campaign {
  const now = Date.now();
  return {
    id:
      typeof partial?.id === "string" && partial.id.trim()
        ? partial.id.trim()
        : `camp-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: partial?.name ?? "Untitled campaign",
    notes: partial?.notes ?? "",
    status: partial?.status ?? "draft",
    window: partial?.window ?? { startsAt: 0, endsAt: 0 },
    audience: partial?.audience ?? createAudience(),
    rules: partial?.rules ?? [createRule()],
    limits: partial?.limits ?? createLimits(),
    presentation: partial?.presentation ?? { headline: "", subline: "" },
    stackable: partial?.stackable ?? false,
    priority: partial?.priority ?? 0,
    holdoutPct: partial?.holdoutPct ?? 0,
    createdAt: partial?.createdAt ?? now,
    updatedAt: now,
  };
}

/** The engine ships on but empty — an empty campaign list is a no-op everywhere. */
export function createDefaultCampaignsConfig(): CampaignsConfig {
  return { version: 1, enabled: false, campaigns: [], updatedAt: 0 };
}

// ---- Frozen terms -----------------------------------------------------------

/**
 * The snapshot copied onto an enrollment the moment a user qualifies. A full
 * denormalized copy rather than a version pointer, so an audit can replay what
 * was promised even after the campaign has been rewritten many times — and so
 * that editing a live campaign can never change a promise already shown to
 * someone.
 */
export interface CampaignTerms {
  campaignId: string;
  /** Only the ENABLED rules, as they read at enrollment time. */
  rules: CampaignRule[];
  limits: CampaignLimits;
  /** Frozen customer-facing copy — the promise, exactly as it was made. */
  summary: string;
  notes: string[];
  /** Deadline for earning anything under these terms (0 = the campaign's end). */
  expiresAt: number;
  at: number;
}

export function freezeTerms(campaign: Campaign, at = Date.now()): CampaignTerms {
  const rules = campaign.rules.filter((r) => r.enabled).map((r) => ({ ...r }));
  const frozen: CampaignTerms = {
    campaignId: campaign.id,
    rules,
    limits: { ...campaign.limits },
    summary: "",
    notes: [],
    expiresAt: campaign.window.endsAt,
    at,
  };
  return {
    ...frozen,
    summary: campaign.presentation.headline.trim() || summarizeRules(rules),
    notes: notesForRules(rules),
  };
}

/** The rules a trigger fires, from a frozen snapshot (the engine's pure core). */
export function rulesForTrigger(terms: CampaignTerms, trigger: CampaignTrigger): CampaignRule[] {
  return terms.rules.filter((r) => r.enabled && r.trigger === trigger);
}

// ---- Evaluation (pure) ------------------------------------------------------

/**
 * Everything the evaluator knows about an account. Deliberately a flat bag of
 * primitives: the same struct is assembled server-side from Firestore and
 * client-side from the session, so the studio can answer "what would happen if I
 * bought this?" without a round trip.
 */
export interface UserFacts {
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
  /** Lifetime Sparks spent (positive number). */
  sparksSpent: number;
  /**
   * Who they most recently told us a book was for, from their survey answers.
   * Null when they've never answered, or never picked an option that identifies a
   * buyer — which is a real and common outcome, not a gap to be filled in.
   */
  buyerRole: BuyerRole | null;
  /** Every role they've ever identified as. Sticky: this only ever grows. */
  buyerRoles: BuyerRole[];
  /** `surveyId:questionId:optionId` for every option they've ever chosen. */
  surveyAnswers: string[];
}

/** Everything the evaluator knows about the event being evaluated. */
export interface TriggerFacts {
  trigger: CampaignTrigger;
  at: number;
  itemType?: DiscountItemType;
  /** Qualifying amount in the pricing base currency. */
  amount?: number;
  productId?: string;
  projectId?: string;
  /** Payment/invoice id — the handle a refund claws back on. */
  ref?: string | null;
  /** For `subscription_renewed`: which invoice this is (1 = the first). */
  invoiceNumber?: number;
  surveyId?: string;
  /** Days elapsed, for the scheduled triggers. */
  daysSince?: number;
}

/** Why a condition didn't hold — surfaced in the admin simulator and support view. */
export interface ConditionFailure {
  kind: RuleConditionKind;
  reason: string;
}

export interface RuleEvaluation {
  ruleId: string;
  matched: boolean;
  failures: ConditionFailure[];
}

/**
 * Does one condition hold? Exhaustive over {@link RuleCondition} — adding a
 * condition without teaching this function about it is a compile error.
 *
 * Unknown facts FAIL the condition rather than passing it. A campaign that pays
 * out because the country was missing is worse than one that quietly doesn't.
 */
export function conditionApplies(
  condition: RuleCondition,
  user: UserFacts,
  trigger: TriggerFacts,
): ConditionFailure | null {
  const fail = (reason: string): ConditionFailure => ({ kind: condition.kind, reason });
  switch (condition.kind) {
    case "itemType":
      if (condition.items.length === 0) return null;
      if (!trigger.itemType) return fail("No item type on this event.");
      return condition.items.includes(trigger.itemType)
        ? null
        : fail(`Bought a ${DISCOUNT_ITEM_LABELS[trigger.itemType].toLowerCase()}, which this rule doesn't cover.`);
    case "firstPurchase": {
      const isFirst = user.purchaseCount <= 1;
      if (condition.value === isFirst) return null;
      return fail(condition.value ? "Not their first purchase." : "This is their first purchase.");
    }
    case "minAmount":
      if (condition.amount <= 0) return null;
      return (trigger.amount ?? 0) >= condition.amount
        ? null
        : fail(`Purchase of ${trigger.amount ?? 0} is under the ${condition.amount} minimum.`);
    case "emailVerified":
      return user.emailVerified ? null : fail("Email isn't verified.");
    case "accountAge": {
      const days = Math.floor((trigger.at - user.createdAt) / DAY_MS);
      if (days < condition.minDays) return fail(`Account is ${days} days old, under the ${condition.minDays}-day minimum.`);
      if (condition.maxDays > 0 && days > condition.maxDays) {
        return fail(`Account is ${days} days old, over the ${condition.maxDays}-day maximum.`);
      }
      return null;
    }
    case "isSubscriber":
      if (condition.value === user.isSubscriber) return null;
      return fail(condition.value ? "Not an active member." : "Already an active member.");
    case "hasPlan":
      if (condition.planIds.length === 0) return null;
      if (!user.planId) return fail("Not on any plan.");
      return condition.planIds.includes(user.planId) ? null : fail(`On the ${user.planId} plan, which isn't covered.`);
    case "country":
      if (condition.countries.length === 0) return null;
      if (!user.country) return fail("Country is unknown.");
      return condition.countries.includes(user.country.toUpperCase())
        ? null
        : fail(`In ${user.country}, which this rule doesn't cover.`);
    case "productId":
      if (condition.productIds.length === 0) return null;
      if (!trigger.productId) return fail("No product on this event.");
      return condition.productIds.includes(trigger.productId)
        ? null
        : fail(`Bought ${trigger.productId}, which this rule doesn't cover.`);
    case "nthInvoice":
      return (trigger.invoiceNumber ?? 0) >= condition.min
        ? null
        : fail(`Invoice ${trigger.invoiceNumber ?? 0} is before the ${condition.min}th.`);
    case "surveyId":
      if (!condition.surveyId) return null;
      return trigger.surveyId === condition.surveyId
        ? null
        : fail("A different survey was answered.");
    case "minSparksSpent":
      if (condition.sparks <= 0) return null;
      return user.sparksSpent >= condition.sparks
        ? null
        : fail(`Has spent ${user.sparksSpent} Sparks, under the ${condition.sparks} minimum.`);
    case "buyerRole": {
      if (condition.roles.length === 0) return null;
      if (condition.mode === "ever") {
        return condition.roles.some((role) => user.buyerRoles.includes(role))
          ? null
          : fail(
              user.buyerRoles.length === 0
                ? "Hasn't told us who they buy for."
                : `Buys for ${joinList(user.buyerRoles, "and")}, which this rule doesn't cover.`,
            );
      }
      if (!user.buyerRole) return fail("Hasn't told us who they buy for.");
      return condition.roles.includes(user.buyerRole)
        ? null
        : fail(`Last bought for a ${user.buyerRole}, which this rule doesn't cover.`);
    }
    case "surveyAnswer": {
      if (!condition.surveyId || !condition.questionId) return null;
      if (condition.optionIds.length === 0) return null;
      const wanted = condition.optionIds.map(
        (optionId) => `${condition.surveyId}:${condition.questionId}:${optionId}`,
      );
      return wanted.some((key) => user.surveyAnswers.includes(key))
        ? null
        : fail("Didn't give that answer.");
    }
  }
}

/** Evaluate one rule's conditions (the trigger match is the caller's job). */
export function evaluateRule(rule: CampaignRule, user: UserFacts, trigger: TriggerFacts): RuleEvaluation {
  const failures: ConditionFailure[] = [];
  for (const condition of rule.conditions) {
    const failure = conditionApplies(condition, user, trigger);
    if (failure) failures.push(failure);
  }
  return { ruleId: rule.id, matched: failures.length === 0, failures };
}

/**
 * Every rule in a snapshot that fires for this event, with a trace of the ones
 * that didn't and why. The trace is the whole reason this returns structure
 * rather than a boolean: "why didn't I get my Sparks?" is an inevitable support
 * question, and it has to be answerable from a record rather than a re-run.
 */
export function evaluateTerms(
  terms: CampaignTerms,
  user: UserFacts,
  trigger: TriggerFacts,
): { matched: CampaignRule[]; evaluations: RuleEvaluation[] } {
  const candidates = rulesForTrigger(terms, trigger.trigger);
  const evaluations = candidates.map((rule) => evaluateRule(rule, user, trigger));
  const matched = candidates.filter((_, i) => evaluations[i].matched);
  return { matched, evaluations };
}

// ---- Audience + holdout -----------------------------------------------------

export interface AudienceVerdict {
  eligible: boolean;
  /** Why not, in a sentence fit to show the customer. */
  reason: string | null;
  /** True when they were eligible but landed in the holdout group. */
  holdout: boolean;
}

/** Is the campaign accepting new enrollments right now? */
export function campaignIsLive(campaign: Campaign, at = Date.now()): boolean {
  if (campaign.status !== "active") return false;
  if (campaign.window.startsAt > 0 && at < campaign.window.startsAt) return false;
  if (campaign.window.endsAt > 0 && at > campaign.window.endsAt) return false;
  return true;
}

/**
 * FNV-1a over `uid:salt`, avalanched, mapped to [0,1). Deterministic and
 * dependency free, so the client and the server independently agree on who's in
 * the holdout without storing a coin flip anywhere.
 *
 * The finalizer is not decoration. Raw FNV-1a barely moves its high bits when only
 * the LAST character of the input changes — one flipped bit there shifts the
 * result by about 0.4% of the range — so two salts as similar as `s1` and `s2`
 * would produce nearly the same fraction for every uid. Two 50% splits keyed that
 * way would pick almost exactly the same people, which means half the customers
 * get every treatment and the other half get none: the assignments look random
 * one at a time and are useless together. The xorshift-multiply-xorshift below
 * spreads the low bits over the whole word, so each salt is its own coin.
 */
export function stableFraction(uid: string, salt: string): number {
  let hash = 0x811c9dc5;
  const input = `${uid}:${salt}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2545f491) >>> 0;
  hash ^= hash >>> 13;
  return (hash >>> 0) / 0x100000000;
}

export function inHoldout(campaign: Campaign, uid: string): boolean {
  if (campaign.holdoutPct <= 0) return false;
  if (campaign.holdoutPct >= 100) return true;
  return stableFraction(uid, campaign.id) * 100 < campaign.holdoutPct;
}

/**
 * May this account enroll? Pure, and phrased so the reason can be shown to the
 * customer — an offer advertised to someone who then silently doesn't qualify is
 * a dark pattern, so the honest answer has to be renderable.
 */
export function audienceVerdict(campaign: Campaign, user: UserFacts, at = Date.now()): AudienceVerdict {
  const a = campaign.audience;
  const no = (reason: string): AudienceVerdict => ({ eligible: false, reason, holdout: false });

  if (!campaignIsLive(campaign, at)) return no("This offer isn't running right now.");
  if (a.allowlistUids.length > 0 && !a.allowlistUids.includes(user.uid)) {
    return no("This offer is limited to selected accounts.");
  }
  if (user.anonymous && !a.allowGuests) return no("Create an account to take part in this offer.");
  if (a.requireVerified && !user.emailVerified) return no("Confirm your email address to unlock this offer.");
  if (a.signedUpFrom > 0 && user.createdAt < a.signedUpFrom) {
    return no("This offer is for accounts created more recently.");
  }
  if (a.signedUpTo > 0 && user.createdAt > a.signedUpTo) {
    return no("This offer closed to new accounts before yours was created.");
  }
  if (a.countries.length > 0 && !(user.country && a.countries.includes(user.country.toUpperCase()))) {
    return no("This offer isn't available in your country.");
  }
  if (inHoldout(campaign, user.uid)) {
    // Deliberately the same copy as "not running": a holdout that knows it's a
    // holdout is not a control group any more.
    return { eligible: false, reason: "This offer isn't running right now.", holdout: true };
  }
  return { eligible: true, reason: null, holdout: false };
}

// ---- Human-readable copy ----------------------------------------------------

const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  [...TEXT_ACTIONS, ...IMAGE_ACTIONS].map((a) => [a.id, a.label.toLowerCase()]),
);

const TIER_LABELS: Record<ImageTier, string> = { quick: "fast", premium: "premium" };

function joinList(parts: string[], conjunction = "and"): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} ${conjunction} ${parts[parts.length - 1]}`;
}

function itemScope(items: DiscountItemType[]): string {
  if (items.length === 0 || items.length >= 4) return "anything you buy";
  return joinList(items.map((t) => DISCOUNT_ITEM_LABELS[t].toLowerCase() + "s"));
}

function actionScope(actions: string[], tiers: ImageTier[]): string {
  const named = actions.length === 0 ? "image generation" : joinList(actions.map((a) => ACTION_LABELS[a] ?? a));
  if (tiers.length === 0 || tiers.length >= IMAGE_TIERS.length) return named;
  return `${joinList(tiers.map((t) => TIER_LABELS[t]))} ${named}`;
}

function sparkAmount(sparks: number, plain: boolean): string {
  return plain ? `${sparks} Sparks` : `${sparks} ${SPARK_SYMBOL}`;
}

/**
 * Plain-language description of one effect, for UI chips, banners and email.
 * Exhaustive over {@link CampaignEffect} — a new effect without copy is a
 * compile error, which is the point: an undescribed effect means promising
 * something the customer can't read.
 */
export function describeEffect(effect: CampaignEffect, opts: { plain?: boolean } = {}): string {
  const plain = opts.plain === true;
  switch (effect.kind) {
    case "sparks":
      return sparkAmount(effect.sparks, plain);
    case "spendRefund": {
      const share = effect.percent >= 100 ? "all" : `${effect.percent}%`;
      const scope = describeSpendScope(effect.scope);
      return `${share} of ${scope} back as Sparks`;
    }
    case "actionPricing": {
      const scope = actionScope(effect.actions, effect.tiers);
      if (effect.mode === "free") return `free ${scope}`;
      const pct = Math.round((1 - effect.multiplier) * 100);
      return pct > 0 ? `${pct}% cheaper ${scope}` : `${scope} at a special rate`;
    }
    case "purchaseDiscount": {
      const base = `${effect.percentOff}% off ${itemScope(effect.appliesTo)}`;
      return effect.recurring ? `${base}, on every renewal` : base;
    }
  }
}

/** What a refund is measured against, in words. */
export function describeSpendScope(scope: SpendScope): string {
  const bits: string[] = [];
  if (scope.tiers.length > 0 && scope.tiers.length < IMAGE_TIERS.length) {
    bits.push(joinList(scope.tiers.map((t) => TIER_LABELS[t])));
  }
  const noun =
    scope.actions.length > 0
      ? `the Sparks you spent on ${joinList(scope.actions.map((a) => ACTION_LABELS[a] ?? a))}`
      : "the Sparks you spent";
  let out = bits.length > 0 ? noun.replace("you spent", `you spent on ${bits.join(" ")} renders`) : noun;
  if (scope.projects === "purchasedProject") out += " on this book";
  if (scope.funding === "purchased") out += " (the ones you paid for)";
  return out;
}

/** When an effect lands, in plain language. */
export function describeTrigger(trigger: CampaignTrigger, afterDays = 0): string {
  switch (trigger) {
    case "always":
      return "for as long as this offer runs";
    case "signup":
      return "when you create your account";
    case "email_verified":
      return "once you confirm your email";
    case "first_book_completed":
      return "when you finish your first book";
    case "purchase":
      return "when your order is complete";
    case "subscription_started":
      return "when you become a member";
    case "subscription_renewed":
      return "when your membership renews";
    case "survey_completed":
      return "once you've answered a few quick questions";
    case "feedback_submitted":
      return "after you send us feedback";
    case "days_after_signup":
      return `${afterDays} days after you signed up`;
    case "days_after_project_created":
      return `${afterDays} days after you start a book`;
  }
}

/**
 * The caveats a trigger doesn't say out loud. `describeTrigger` only names WHEN
 * something happens; a rule can also require a minimum spend, a verified email,
 * a specific product. Surfaced as footnotes so a promise never reads as more
 * unconditional than it actually pays out.
 *
 * Exhaustive over {@link RuleCondition} for the same reason as
 * {@link describeEffect}: an undescribed condition is a silent overpromise.
 */
export function describeCondition(condition: RuleCondition): string {
  switch (condition.kind) {
    case "itemType":
      return `only on ${itemScope(condition.items)}`;
    case "firstPurchase":
      return condition.value ? "on your first purchase only" : "not on your first purchase";
    case "minAmount":
      return condition.amount > 0 ? `on orders over ${condition.amount}` : "";
    case "emailVerified":
      return "once your email is confirmed";
    case "accountAge": {
      if (condition.minDays > 0 && condition.maxDays > 0) {
        return `for accounts between ${condition.minDays} and ${condition.maxDays} days old`;
      }
      if (condition.minDays > 0) return `for accounts at least ${condition.minDays} days old`;
      if (condition.maxDays > 0) return `for accounts less than ${condition.maxDays} days old`;
      return "";
    }
    case "isSubscriber":
      return condition.value ? "for members only" : "for non-members only";
    case "hasPlan":
      return condition.planIds.length > 0 ? `on the ${joinList(condition.planIds, "or")} plan` : "";
    case "country":
      return condition.countries.length > 0 ? `in ${joinList(condition.countries, "or")}` : "";
    case "productId":
      return condition.productIds.length > 0 ? `on selected products only` : "";
    case "nthInvoice":
      return `from your ${ordinal(condition.min)} invoice onwards`;
    case "surveyId":
      return condition.surveyId ? "for that particular set of questions" : "";
    case "minSparksSpent":
      return condition.sparks > 0 ? `once you've used at least ${condition.sparks} Sparks` : "";
    case "buyerRole": {
      if (condition.roles.length === 0) return "";
      const who = joinList(
        condition.roles.map((role) => BUYER_ROLE_PHRASES[role]),
        "or",
      );
      return condition.mode === "ever"
        ? `if you've ever bought for ${who}`
        : `when you're buying for ${who}`;
    }
    case "surveyAnswer":
      // Deliberately vague. The alternative is quoting a customer's own survey
      // answer back at them in a promotional sentence, which reads as surveillance
      // however carefully it's worded.
      return condition.optionIds.length > 0 ? "based on what you told us" : "";
  }
}


function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * One clause for a set of rules that all land at the same moment: everything you
 * get, then when you get it. Rules are grouped before being described because
 * naming the moment once per rule reads as a stutter — "50 Sparks when your order
 * is complete and 10% back when your order is complete" is the same promise said
 * twice.
 */
function summarizeGroup(rules: CampaignRule[]): string {
  const what = joinList(rules.map((r) => describeEffect(r.effect, { plain: true })));
  const [first] = rules;
  const when = describeTrigger(first.trigger, first.afterDays);
  // A standing price break reads backwards as "free renders when the offer runs";
  // lead with the scope instead.
  if (first.trigger === "always") {
    return rules.every((r) => r.effect.kind === "actionPricing")
      ? `${what} while this offer runs`
      : `${what}, ${when}`;
  }
  return `${what} ${when}`;
}

/** One sentence for one rule: what you get, and when. */
export function summarizeRule(rule: CampaignRule): string {
  return summarizeGroup([rule]);
}

/** One sentence covering everything a campaign's rules promise. */
export function summarizeRules(rules: CampaignRule[]): string {
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return "";
  // Grouped by the moment they fire, in the order those moments first appear, so
  // the sentence follows the customer's timeline rather than the config's.
  const groups = new Map<string, CampaignRule[]>();
  for (const rule of enabled) {
    const key = `${rule.trigger}:${TRIGGER_META[rule.trigger].scheduled ? rule.afterDays : 0}`;
    const group = groups.get(key);
    if (group) group.push(rule);
    else groups.set(key, [rule]);
  }
  const sentence = joinList([...groups.values()].map(summarizeGroup));
  // Capitalize: this is the headline a customer reads.
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

/** Every distinct caveat across a rule set, in rule order, never repeated. */
export function notesForRules(rules: CampaignRule[]): string[] {
  const seen = new Set<string>();
  const notes: string[] = [];
  for (const rule of rules.filter((r) => r.enabled)) {
    for (const condition of rule.conditions) {
      const note = describeCondition(condition);
      if (note && !seen.has(note)) {
        seen.add(note);
        notes.push(note);
      }
    }
    if (rule.requiresApproval && !seen.has(APPROVAL_NOTE)) {
      seen.add(APPROVAL_NOTE);
      notes.push(APPROVAL_NOTE);
    }
    if (rule.effect.kind === "spendRefund") {
      for (const note of refundCapNotes(rule.effect)) {
        if (!seen.has(note)) {
          seen.add(note);
          notes.push(note);
        }
      }
    }
    if (rule.effect.kind === "sparks" && rule.effect.expiresInDays > 0) {
      const note = `Sparks earned this way are valid for ${rule.effect.expiresInDays} days`;
      if (!seen.has(note)) {
        seen.add(note);
        notes.push(note);
      }
    }
  }
  return notes;
}

const APPROVAL_NOTE = "we check these by hand, so it may take a day or two to land";

/**
 * A refund's caps, spelled out. These are the single most important footnotes in
 * the whole engine: "get your Sparks back" with a silent 500-Spark ceiling is the
 * kind of promise that generates chargebacks.
 */
export function refundCapNotes(effect: SpendRefundEffect): string[] {
  const notes: string[] = [];
  if (effect.maxRefundSparks > 0) notes.push(`up to ${effect.maxRefundSparks} Sparks`);
  if (effect.maxPctOfPurchase > 0 && effect.maxPctOfPurchase < 100) {
    notes.push(`capped at ${effect.maxPctOfPurchase}% of what you paid`);
  }
  if (effect.minRefundMode === "skip" && effect.minRefundSparks > 0) {
    notes.push(`only when it comes to at least ${effect.minRefundSparks} Sparks`);
  }
  if (effect.scope.sinceEnrollment) notes.push("counting only what you've used since the offer started");
  return notes;
}

/** The short teaser for a button or banner. */
export function campaignTeaser(campaign: Campaign): string {
  if (campaign.presentation.headline.trim()) return campaign.presentation.headline.trim();
  const first = campaign.rules.find((r) => r.enabled);
  return first ? summarizeRule(first) : campaign.name;
}

// ---- Spend refund maths (pure) ----------------------------------------------

/**
 * One spend entry, reduced to the fields a refund cares about. Mirrors the
 * `spend` rows of `users/{uid}/sparksLedger` — the server projects real ledger
 * docs into this, and the admin simulator makes them up, so both run the same
 * arithmetic.
 */
export interface SpendEntry {
  id: string;
  at: number;
  /** Positive number of Sparks spent. */
  sparks: number;
  /** Action id (the ledger's `reason`). */
  action: string;
  tier: ImageTier | null;
  projectId: string | null;
  /** Sparks in this spend that came from lots the customer paid for. */
  paidSparks: number;
  /** Sparks spent past all lots — value that was never funded at all. */
  unfundedSparks: number;
  /** Set once some campaign has already refunded this entry. */
  refundedBy: string | null;
}

/**
 * Does this spend entry fall inside a refund's scope?
 *
 * Two exclusions are unconditional rather than configurable:
 *   - An entry already refunded by ANY campaign is out. Two overlapping
 *     campaigns refunding the same spend twice is free money.
 *   - `unfundedSparks` (negative-buffer territory) is netted off below, because
 *     refunding Sparks the customer never had mints value from nothing.
 */
export function spendMatchesScope(
  entry: SpendEntry,
  scope: SpendScope,
  ctx: { enrolledAt: number; purchasedProjectId?: string | null },
): boolean {
  if (entry.refundedBy) return false;
  if (scope.sinceEnrollment && entry.at < ctx.enrolledAt) return false;
  if (scope.actions.length > 0 && !scope.actions.includes(entry.action)) return false;
  if (scope.tiers.length > 0 && !(entry.tier && scope.tiers.includes(entry.tier))) return false;
  if (scope.projects === "purchasedProject") {
    if (!ctx.purchasedProjectId || entry.projectId !== ctx.purchasedProjectId) return false;
  }
  return true;
}

/** How many Sparks of one entry a scope may return. */
export function refundableSparks(entry: SpendEntry, scope: SpendScope): number {
  const funded = Math.max(0, entry.sparks - entry.unfundedSparks);
  return scope.funding === "purchased" ? Math.min(entry.paidSparks, funded) : funded;
}

export interface RefundComputation {
  /** Sparks to grant back. */
  sparks: number;
  /** Qualifying spend the percentage was applied to. */
  qualifyingSparks: number;
  /** Ledger entries consumed, so they can be marked and never refunded twice. */
  entryIds: string[];
  /** Which cap bound the result, for the admin log and the customer note. */
  cappedBy: "none" | "sparks" | "purchase" | "belowMinimum";
}

export interface RefundInputs {
  entries: SpendEntry[];
  effect: SpendRefundEffect;
  enrolledAt: number;
  purchasedProjectId?: string | null;
  /** The triggering purchase amount, base currency (for `maxPctOfPurchase`). */
  purchaseAmount?: number;
  /** USD value of one Spark, to compare a Spark cap against a money cap. */
  sparkValueUsd: number;
}

/**
 * Work out what a spend refund actually pays. Ordering matters and is deliberate:
 * take the percentage of qualifying spend first, then apply the ceilings, then
 * the floor — so `maxRefundSparks` caps the payout rather than the base, and a
 * floor can never push a payout above a ceiling.
 */
export function computeRefund(inputs: RefundInputs): RefundComputation {
  const { entries, effect, sparkValueUsd } = inputs;
  const scoped = entries.filter((e) =>
    spendMatchesScope(e, effect.scope, {
      enrolledAt: inputs.enrolledAt,
      purchasedProjectId: inputs.purchasedProjectId,
    }),
  );
  const qualifyingSparks = scoped.reduce((sum, e) => sum + refundableSparks(e, effect.scope), 0);
  const entryIds = scoped.map((e) => e.id);

  let sparks = Math.floor((qualifyingSparks * Math.min(100, Math.max(0, effect.percent))) / 100);
  let cappedBy: RefundComputation["cappedBy"] = "none";

  if (effect.maxRefundSparks > 0 && sparks > effect.maxRefundSparks) {
    sparks = effect.maxRefundSparks;
    cappedBy = "sparks";
  }
  if (effect.maxPctOfPurchase > 0 && (inputs.purchaseAmount ?? 0) > 0 && sparkValueUsd > 0) {
    const ceilingUsd = ((inputs.purchaseAmount ?? 0) * effect.maxPctOfPurchase) / 100;
    const ceilingSparks = Math.floor(ceilingUsd / sparkValueUsd);
    if (sparks > ceilingSparks) {
      sparks = Math.max(0, ceilingSparks);
      cappedBy = "purchase";
    }
  }
  if (effect.minRefundSparks > 0 && sparks < effect.minRefundSparks) {
    if (effect.minRefundMode === "topUp") {
      // Never let the floor jump a ceiling — a "minimum" is a rounding kindness,
      // not permission to exceed the cap that was set to keep this affordable.
      const ceiling = effect.maxRefundSparks > 0 ? effect.maxRefundSparks : effect.minRefundSparks;
      sparks = Math.min(effect.minRefundSparks, ceiling);
    } else {
      sparks = 0;
      cappedBy = "belowMinimum";
    }
  }

  return { sparks, qualifyingSparks, entryIds: sparks > 0 ? entryIds : [], cappedBy };
}

// ---- Action pricing overrides (pure, on the hot path) -----------------------

/**
 * The most generous standing price override across a set of live rules, as a
 * multiplier to apply on top of the plan multiplier. 1 means "no campaign
 * touches this action".
 *
 * Best-for-the-customer wins rather than highest-priority: a price break is a
 * promise displayed in the studio, and quoting the worse of two active offers
 * reads as a bug to the person looking at it.
 *
 * This runs on every render quote, so it stays a pure fold over already-loaded
 * config — never a lookup.
 */
export function actionPriceMultiplier(
  rules: CampaignRule[],
  action: string,
  tier: ImageTier | null,
): number {
  let best = 1;
  for (const rule of rules) {
    if (!rule.enabled || rule.trigger !== "always") continue;
    const effect = rule.effect;
    if (effect.kind !== "actionPricing") continue;
    if (effect.actions.length > 0 && !effect.actions.includes(action)) continue;
    if (effect.tiers.length > 0 && !(tier && effect.tiers.includes(tier))) continue;
    const m = effect.mode === "free" ? 0 : Math.max(0, Math.min(1, effect.multiplier));
    if (m < best) best = m;
  }
  return best;
}

// ---- Normalization ----------------------------------------------------------

const ALL_ACTION_IDS: string[] = [...ALL_TEXT_ACTION_IDS, ...ALL_IMAGE_ACTION_IDS];
const ITEM_TYPES: DiscountItemType[] = ["print", "ebook", "pack", "plan"];

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
function stringList(v: unknown, allowed?: string[], max = 50): string[] {
  if (!Array.isArray(v)) return [];
  const out = v
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .map((x) => x.trim())
    .filter((x) => !allowed || allowed.includes(x));
  return Array.from(new Set(out)).slice(0, max);
}
function tierList(v: unknown): ImageTier[] {
  return stringList(v, IMAGE_TIERS).filter((t): t is ImageTier => IMAGE_TIERS.includes(t as ImageTier));
}
function itemList(v: unknown): DiscountItemType[] {
  return stringList(v, ITEM_TYPES).filter((t): t is DiscountItemType => ITEM_TYPES.includes(t as DiscountItemType));
}

function normalizeCondition(raw: unknown): RuleCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  switch (c.kind) {
    case "itemType":
      return { kind: "itemType", items: itemList(c.items) };
    case "firstPurchase":
      return { kind: "firstPurchase", value: c.value !== false };
    case "minAmount":
      return { kind: "minAmount", amount: nonNegative(c.amount, 0) };
    case "emailVerified":
      return { kind: "emailVerified" };
    case "accountAge":
      return {
        kind: "accountAge",
        minDays: Math.round(nonNegative(c.minDays, 0)),
        maxDays: Math.round(nonNegative(c.maxDays, 0)),
      };
    case "isSubscriber":
      return { kind: "isSubscriber", value: c.value !== false };
    case "hasPlan":
      return { kind: "hasPlan", planIds: stringList(c.planIds) };
    case "country":
      return { kind: "country", countries: stringList(c.countries).map((x) => x.toUpperCase().slice(0, 2)) };
    case "productId":
      return { kind: "productId", productIds: stringList(c.productIds) };
    case "nthInvoice":
      return { kind: "nthInvoice", min: Math.max(2, Math.round(nonNegative(c.min, 2))) };
    case "surveyId":
      return { kind: "surveyId", surveyId: str(c.surveyId, "", 64) };
    case "buyerRole":
      return {
        kind: "buyerRole",
        roles: stringList(c.roles).filter((r): r is BuyerRole =>
          BUYER_ROLES.includes(r as BuyerRole),
        ),
        mode: c.mode === "ever" ? "ever" : "latest",
      };
    case "surveyAnswer":
      return {
        kind: "surveyAnswer",
        surveyId: str(c.surveyId, "", 64),
        questionId: str(c.questionId, "", 64),
        optionIds: stringList(c.optionIds).slice(0, 20),
      };
    case "minSparksSpent":
      return { kind: "minSparksSpent", sparks: Math.round(nonNegative(c.sparks, 0)) };
    default:
      return null;
  }
}

function normalizeEffect(raw: unknown): CampaignEffect | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  switch (e.kind) {
    case "sparks": {
      const sparks = Math.round(nonNegative(e.sparks, 0));
      return sparks > 0
        ? { kind: "sparks", sparks, expiresInDays: Math.round(nonNegative(e.expiresInDays, 180)) }
        : null;
    }
    case "spendRefund": {
      const percent = pct(e.percent, 100);
      if (percent <= 0) return null;
      const scope = (e.scope ?? {}) as Record<string, unknown>;
      return {
        kind: "spendRefund",
        percent,
        scope: {
          funding: scope.funding === "all" ? "all" : "purchased",
          actions: stringList(scope.actions, ALL_ACTION_IDS),
          tiers: tierList(scope.tiers),
          projects: scope.projects === "any" ? "any" : "purchasedProject",
          sinceEnrollment: scope.sinceEnrollment === true,
        },
        minRefundSparks: Math.round(nonNegative(e.minRefundSparks, 0)),
        minRefundMode: e.minRefundMode === "topUp" ? "topUp" : "skip",
        maxRefundSparks: Math.round(nonNegative(e.maxRefundSparks, 0)),
        maxPctOfPurchase: pct(e.maxPctOfPurchase, 0),
      };
    }
    case "actionPricing": {
      const mode = e.mode === "multiplier" ? "multiplier" : "free";
      const multiplier = Math.min(1, Math.max(0, num(e.multiplier, 1)));
      // A "multiplier" of exactly 1 changes nothing — treat it as absent rather
      // than shipping a live campaign that silently does nothing.
      if (mode === "multiplier" && multiplier >= 1) return null;
      return {
        kind: "actionPricing",
        actions: stringList(e.actions, ALL_ACTION_IDS),
        tiers: tierList(e.tiers),
        mode,
        multiplier,
      };
    }
    case "purchaseDiscount": {
      const percentOff = pct(e.percentOff, 0);
      if (percentOff <= 0) return null;
      const appliesTo = itemList(e.appliesTo);
      return {
        kind: "purchaseDiscount",
        percentOff,
        appliesTo: appliesTo.length > 0 ? appliesTo : [...ITEM_TYPES],
        expiresInDays: Math.round(nonNegative(e.expiresInDays, 60)),
        recurring: e.recurring === true,
      };
    }
    default:
      return null;
  }
}

/**
 * Coerce one rule, dropping anything its trigger isn't allowed to carry. The
 * same guard the Zod schema enforces on save is applied again on READ, so a
 * hand-edited Firestore doc can't turn a signup trigger into a Spark faucet.
 */
function normalizeRule(raw: unknown, index: number): CampaignRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  const trigger: CampaignTrigger = CAMPAIGN_TRIGGERS.includes(r.trigger as CampaignTrigger)
    ? (r.trigger as CampaignTrigger)
    : "purchase";
  // An effect that normalized away (zero Sparks, 0% off) or that this trigger
  // isn't allowed to carry leaves the rule present but DISABLED — silently
  // rewriting it to something payable would be worse than showing the admin a
  // rule that plainly isn't running.
  const parsed = normalizeEffect(r.effect);
  const usable = parsed !== null && effectAllowedForTrigger(trigger, parsed.kind);
  const effect: CampaignEffect = usable ? parsed : { kind: "sparks", sparks: 0, expiresInDays: 0 };
  const conditions = Array.isArray(r.conditions)
    ? r.conditions
        .map(normalizeCondition)
        .filter((c): c is RuleCondition => c !== null && conditionAllowedForTrigger(trigger, c.kind))
        .slice(0, 8)
    : [];
  return {
    id: str(r.id, `rule-${index + 1}`, 64).trim() || `rule-${index + 1}`,
    enabled: r.enabled === true && usable,
    trigger,
    conditions,
    effect,
    afterDays: Math.max(1, Math.round(nonNegative(r.afterDays, 7))),
    maxPerAccount: Math.round(nonNegative(r.maxPerAccount, 1)),
    // Forced on where the risk demands it, regardless of what was stored.
    requiresApproval: r.requiresApproval === true || ruleNeedsApproval(trigger, effect.kind),
  };
}

function normalizeCampaign(raw: unknown, index: number, at: number): Campaign {
  const c = (raw ?? {}) as Record<string, unknown>;
  const statuses: CampaignStatus[] = ["draft", "active", "paused", "ended"];
  const rules = Array.isArray(c.rules)
    ? c.rules.slice(0, MAX_RULES_PER_CAMPAIGN).map(normalizeRule)
    : [];
  // Duplicate rule ids would collapse two rules onto one idempotency key, so the
  // later duplicate is renamed rather than silently paying once.
  const seen = new Set<string>();
  for (const rule of rules) {
    let id = rule.id;
    let n = 2;
    while (seen.has(id)) id = `${rule.id}-${n++}`;
    rule.id = id;
    seen.add(id);
  }
  const audience = (c.audience ?? {}) as Record<string, unknown>;
  const limits = (c.limits ?? {}) as Record<string, unknown>;
  const window = (c.window ?? {}) as Record<string, unknown>;
  const presentation = (c.presentation ?? {}) as Record<string, unknown>;
  const endsAt = Math.round(nonNegative(window.endsAt, 0));
  const stored = statuses.includes(c.status as CampaignStatus) ? (c.status as CampaignStatus) : "draft";
  return {
    id: str(c.id, `campaign-${index + 1}`, 64).trim() || `campaign-${index + 1}`,
    name: str(c.name, "Untitled campaign", 120),
    notes: str(c.notes, "", 2000),
    // A window that has closed reads as ended no matter what's stored, so the
    // admin list never shows a campaign as "active" when it can't enroll anyone.
    status: stored === "active" && endsAt > 0 && at > endsAt ? "ended" : stored,
    window: { startsAt: Math.round(nonNegative(window.startsAt, 0)), endsAt },
    audience: {
      signedUpFrom: Math.round(nonNegative(audience.signedUpFrom, 0)),
      signedUpTo: Math.round(nonNegative(audience.signedUpTo, 0)),
      countries: stringList(audience.countries).map((x) => x.toUpperCase().slice(0, 2)),
      allowlistUids: stringList(audience.allowlistUids, undefined, 500),
      requireVerified: audience.requireVerified !== false,
      allowGuests: audience.allowGuests === true,
    },
    rules,
    limits: {
      maxPerAccount: Math.round(nonNegative(limits.maxPerAccount, 1)),
      maxTotal: Math.round(nonNegative(limits.maxTotal, 0)),
      dailyBudget: nonNegative(limits.dailyBudget, 250),
      lifetimeBudget: nonNegative(limits.lifetimeBudget, 0),
    },
    presentation: {
      headline: str(presentation.headline, "", 160).trim(),
      subline: str(presentation.subline, "", 400).trim(),
    },
    stackable: c.stackable === true,
    priority: Math.round(num(c.priority, 0)),
    holdoutPct: pct(c.holdoutPct, 0),
    createdAt: Math.round(nonNegative(c.createdAt, at)),
    updatedAt: Math.round(nonNegative(c.updatedAt, at)),
  };
}

export function normalizeCampaignsConfig(input: unknown, at = Date.now()): CampaignsConfig {
  const p = (input ?? {}) as Partial<CampaignsConfig> & Record<string, unknown>;
  const campaigns = Array.isArray(p.campaigns)
    ? p.campaigns.slice(0, MAX_CAMPAIGNS).map((raw, i) => normalizeCampaign(raw, i, at))
    : [];
  const seen = new Set<string>();
  for (const campaign of campaigns) {
    let id = campaign.id;
    let n = 2;
    while (seen.has(id)) id = `${campaign.id}-${n++}`;
    campaign.id = id;
    seen.add(id);
  }
  return {
    version: 1,
    enabled: p.enabled === true,
    campaigns,
    updatedAt: Math.round(nonNegative(p.updatedAt, 0)),
  };
}

/**
 * The world-readable projection. The full config names individual accounts
 * (`allowlistUids`) and publishes the commercial shape of the programme
 * (budgets, holdout size, admin notes) — none of which the client needs to
 * render an offer, and none of which should be readable by anyone who asks.
 *
 * Everything the client DOES need is kept: the client evaluates offers
 * speculatively ("what would I get if I bought this?"), which is only possible
 * from real rules.
 */
export function publicCampaignsProjection(config: CampaignsConfig): CampaignsConfig {
  return {
    version: 1,
    enabled: config.enabled,
    campaigns: config.campaigns
      // Drafts and ended campaigns can't enroll anyone, so they stay private.
      .filter((c) => c.status === "active" || c.status === "paused")
      .map((c) => ({
        ...c,
        notes: "",
        audience: { ...c.audience, allowlistUids: [] },
        limits: { ...c.limits, dailyBudget: 0, lifetimeBudget: 0 },
      })),
    updatedAt: config.updatedAt,
  };
}

// ---- Enrollment + offer views (API shapes shared with the client) -----------

export type RedemptionStatus = "pending" | "granted" | "review" | "void" | "clawed_back";

/** One earned (or pending) campaign benefit, as shown in the wallet. */
export interface RedemptionView {
  id: string;
  campaignId: string;
  campaignName: string;
  status: RedemptionStatus;
  /** What it is, e.g. "240 Sparks". */
  summary: string;
  /** What unlocked it, e.g. "when your order is complete". */
  unlocks: string;
  at: number;
  /** When a granted discount stops being usable (null when not applicable). */
  expiresAt: number | null;
  used: boolean;
  /** Why it's waiting, when the status is `review`. */
  note: string | null;
}

/**
 * One offer as the customer sees it. `active` offers are already earning;
 * `available` ones will start the moment they do the thing. That distinction is
 * the whole point of showing offers at all — "you'll get X if you buy this" has
 * to be visible BEFORE the click, not discovered afterwards.
 */
export interface OfferView {
  campaignId: string;
  headline: string;
  subline: string;
  /** Generated from the rules — never admin free-text. */
  summary: string;
  /** Caveats the summary doesn't say out loud. */
  notes: string[];
  /** True once the customer is enrolled and earning. */
  enrolled: boolean;
  /** When the offer stops being claimable (0 = open-ended). */
  endsAt: number;
  /** Present when they can't take part, phrased for them to read. */
  blockedReason: string | null;
}

/** Everything the wallet's offers panel needs in one round trip. */
export interface OffersOverview {
  enabled: boolean;
  offers: OfferView[];
  redemptions: RedemptionView[];
}

/**
 * What a specific, imminent action would earn — the answer to "if I buy this
 * print book, what happens?". Computed speculatively from the same pure
 * evaluator the server pays out with, so the promise and the payout can't drift.
 */
export interface OfferPreview {
  campaignId: string;
  /** e.g. "This order refunds 240 ✦ to your balance." */
  message: string;
  /** Sparks this would return/grant, when that's knowable up front. */
  sparks: number;
}

// ---- Admin views (shapes + maths shared with the dashboard) -----------------

/**
 * One campaign's counters for one UTC day. Written by the engine with
 * `FieldValue.increment`, read by the admin report.
 *
 * The one field here that isn't obvious is the holdout pair. Treated and holdout
 * accounts are counted separately on purpose: comparing them is the only way to
 * know whether a campaign CAUSED anything. A report without a control group can
 * tell you what you paid and never what you earned.
 */
export interface CampaignDayStats {
  /** UTC day key, `YYYY-MM-DD`. */
  day: string;
  /** Accounts that entered the campaign. */
  enrollments: number;
  /** Accounts that entered but were assigned to the holdout group. */
  holdouts: number;
  redemptions: number;
  /** Payouts held for an admin decision. */
  held: number;
  /** Estimated payout cost in the pricing base currency. */
  cost: number;
  /** Sparks handed out (grants + refunds). */
  sparks: number;
  /** Purchases by enrolled (treated) accounts while the campaign ran. */
  purchases: number;
  /** Purchase revenue from treated accounts, base currency. */
  revenue: number;
  /** Purchases by holdout accounts — the counterfactual. */
  holdoutPurchases: number;
  holdoutRevenue: number;
  clawbacks: number;
}

/** Every countable field, i.e. everything but the day key. */
export type CampaignStatField = Exclude<keyof CampaignDayStats, "day">;

export function emptyDayStats(day = ""): CampaignDayStats {
  return {
    day,
    enrollments: 0,
    holdouts: 0,
    redemptions: 0,
    held: 0,
    cost: 0,
    sparks: 0,
    purchases: 0,
    revenue: 0,
    holdoutPurchases: 0,
    holdoutRevenue: 0,
    clawbacks: 0,
  };
}

export function normalizeDayStats(day: string, raw: unknown): CampaignDayStats {
  const d = (raw ?? {}) as Record<string, unknown>;
  const empty = emptyDayStats(day);
  const out = { ...empty };
  for (const key of Object.keys(empty) as (keyof CampaignDayStats)[]) {
    if (key === "day") continue;
    out[key] = num(d[key], 0);
  }
  return out;
}

/** Sum of day stats, for the report totals. */
export function totalDayStats(series: CampaignDayStats[], day = "total"): CampaignDayStats {
  const total = emptyDayStats(day);
  for (const stats of series) {
    for (const key of Object.keys(total) as (keyof CampaignDayStats)[]) {
      if (key === "day") continue;
      total[key] += stats[key];
    }
  }
  return total;
}

export interface CampaignRates {
  /** Payout cost per purchase by a treated account. */
  costPerPurchase: number;
  /** Purchase rate among treated accounts, %. */
  conversionPct: number;
  /** Purchase rate among holdouts, % (null when the holdout is empty). */
  holdoutConversionPct: number | null;
  /**
   * Treated conversion minus holdout conversion, in percentage points. This —
   * not gross conversion — is what the campaign actually bought you. Null
   * without a holdout, and it should read as "unknown", not "zero".
   */
  liftPoints: number | null;
  /** Revenue earned per unit of payout cost among treated accounts. */
  returnOnSpend: number | null;
}

export function campaignRates(t: CampaignDayStats): CampaignRates {
  const share = (numerator: number, denominator: number) =>
    denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
  const treated = Math.max(0, t.enrollments - t.holdouts);
  const conversionPct = share(t.purchases, treated);
  const holdoutConversionPct = t.holdouts > 0 ? share(t.holdoutPurchases, t.holdouts) : null;
  return {
    costPerPurchase: t.purchases > 0 ? Math.round((t.cost / t.purchases) * 100) / 100 : 0,
    conversionPct,
    holdoutConversionPct,
    liftPoints:
      holdoutConversionPct === null ? null : Math.round((conversionPct - holdoutConversionPct) * 10) / 10,
    returnOnSpend: t.cost > 0 ? Math.round((t.revenue / t.cost) * 100) / 100 : null,
  };
}

export interface CampaignReport {
  campaignId: string;
  from: number;
  to: number;
  totals: CampaignDayStats;
  series: CampaignDayStats[];
  rates: CampaignRates;
}

/** One sampled account in a dry run. */
export interface SimulationRow {
  uid: string;
  eligible: boolean;
  /** Why not, when they aren't. */
  reason: string | null;
  holdout: boolean;
  /** Rules that would fire for the modelled event. */
  matchedRuleIds: string[];
  /** Sparks this account would receive. */
  sparks: number;
  /** Worst-case payout cost in the pricing base currency. */
  costUsd: number;
}

export interface SimulationResult {
  campaignId: string;
  /** The generated customer-facing copy — reviewed here, before it ships. */
  summary: string;
  notes: string[];
  /** Accounts examined (a bounded sample, not the whole table). */
  sampled: number;
  eligible: number;
  wouldPay: number;
  totalSparks: number;
  totalCostUsd: number;
  /** Mean payout across the accounts that would actually receive something. */
  avgCostUsd: number;
  /** The most expensive accounts — where a misconfiguration shows up first. */
  worst: SimulationRow[];
  /** True when the sample was capped, so the totals are a lower bound. */
  truncated: boolean;
}

/** A payout waiting on a human, as the admin decision queue shows it. */
export interface HeldRedemptionView {
  id: string;
  campaignId: string;
  campaignName: string;
  ruleId: string;
  uid: string;
  email: string | null;
  status: RedemptionStatus;
  /** What it is, e.g. "240 Sparks". */
  summary: string;
  /** What unlocked it, e.g. "when your order is complete". */
  unlocks: string;
  /** Estimated payout cost in the pricing base currency. */
  cost: number;
  sparks: number;
  createdAt: number;
  /** Why it's held. */
  note: string | null;
}

// ---- Validation (used by the backend before persisting) --------------------

const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("itemType"), items: z.array(z.enum(["print", "ebook", "pack", "plan"])) }),
  z.object({ kind: z.literal("firstPurchase"), value: z.boolean() }),
  z.object({ kind: z.literal("minAmount"), amount: z.number().min(0) }),
  z.object({ kind: z.literal("emailVerified") }),
  z.object({ kind: z.literal("accountAge"), minDays: z.number().min(0), maxDays: z.number().min(0) }),
  z.object({ kind: z.literal("isSubscriber"), value: z.boolean() }),
  z.object({ kind: z.literal("hasPlan"), planIds: z.array(z.string()) }),
  z.object({ kind: z.literal("country"), countries: z.array(z.string()) }),
  z.object({ kind: z.literal("productId"), productIds: z.array(z.string()) }),
  z.object({ kind: z.literal("nthInvoice"), min: z.number().min(2) }),
  z.object({ kind: z.literal("surveyId"), surveyId: z.string() }),
  z.object({ kind: z.literal("minSparksSpent"), sparks: z.number().min(0) }),
  z.object({
    kind: z.literal("buyerRole"),
    roles: z.array(z.enum(BUYER_ROLES)),
    mode: z.enum(["latest", "ever"]),
  }),
  z.object({
    kind: z.literal("surveyAnswer"),
    surveyId: z.string().max(64),
    questionId: z.string().max(64),
    optionIds: z.array(z.string().max(64)).max(20),
  }),
]);

const spendScopeSchema = z.object({
  funding: z.enum(["purchased", "all"]),
  actions: z.array(z.string()),
  tiers: z.array(z.enum(["quick", "premium"])),
  projects: z.enum(["any", "purchasedProject"]),
  sinceEnrollment: z.boolean(),
});

const effectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sparks"), sparks: z.number().min(1).max(100_000), expiresInDays: z.number().min(0).max(3650) }),
  z.object({
    kind: z.literal("spendRefund"),
    percent: z.number().min(1).max(100),
    scope: spendScopeSchema,
    minRefundSparks: z.number().min(0).max(100_000),
    minRefundMode: z.enum(["topUp", "skip"]),
    maxRefundSparks: z.number().min(0).max(100_000),
    maxPctOfPurchase: z.number().min(0).max(100),
  }),
  z.object({
    kind: z.literal("actionPricing"),
    actions: z.array(z.string()),
    tiers: z.array(z.enum(["quick", "premium"])),
    mode: z.enum(["free", "multiplier"]),
    multiplier: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("purchaseDiscount"),
    percentOff: z.number().min(1).max(100),
    appliesTo: z.array(z.enum(["print", "ebook", "pack", "plan"])),
    expiresInDays: z.number().min(0).max(3650),
    recurring: z.boolean(),
  }),
]);

const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  trigger: z.enum(CAMPAIGN_TRIGGERS),
  conditions: z.array(conditionSchema).max(8),
  effect: effectSchema,
  afterDays: z.number().min(1).max(3650),
  maxPerAccount: z.number().min(0).max(10_000),
  requiresApproval: z.boolean(),
});

const campaignSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  notes: z.string().max(2000),
  status: z.enum(["draft", "active", "paused", "ended"]),
  window: z.object({ startsAt: z.number().min(0), endsAt: z.number().min(0) }),
  audience: z.object({
    signedUpFrom: z.number().min(0),
    signedUpTo: z.number().min(0),
    countries: z.array(z.string()),
    allowlistUids: z.array(z.string()).max(500),
    requireVerified: z.boolean(),
    allowGuests: z.boolean(),
  }),
  rules: z.array(ruleSchema).min(1).max(MAX_RULES_PER_CAMPAIGN),
  limits: z.object({
    maxPerAccount: z.number().min(0).max(10_000),
    maxTotal: z.number().min(0),
    dailyBudget: z.number().min(0),
    lifetimeBudget: z.number().min(0),
  }),
  presentation: z.object({ headline: z.string().max(160), subline: z.string().max(400) }),
  stackable: z.boolean(),
  priority: z.number(),
  holdoutPct: z.number().min(0).max(100),
  createdAt: z.number().min(0),
  updatedAt: z.number().min(0),
});

/**
 * Save-time validation. The messages are written for the admin who is about to
 * ship the campaign, not for a log: every refusal names the rule, says what's
 * wrong, and says why it matters. A rule engine an operator can't debug from its
 * error messages is a rule engine that gets switched off.
 */
export const campaignsConfigSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    campaigns: z.array(campaignSchema).max(MAX_CAMPAIGNS),
    updatedAt: z.number().min(0).optional(),
  })
  .superRefine((cfg, ctx) => {
    cfg.campaigns.forEach((campaign, ci) => {
      const at = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: "custom", path: ["campaigns", ci, ...path], message });

      if (campaign.window.endsAt > 0 && campaign.window.startsAt > campaign.window.endsAt) {
        at(["window"], `"${campaign.name}" ends before it starts.`);
      }
      if (campaign.audience.signedUpTo > 0 && campaign.audience.signedUpFrom > campaign.audience.signedUpTo) {
        at(["audience"], `"${campaign.name}" has a signup window that ends before it starts.`);
      }

      const ruleIds = new Set<string>();
      campaign.rules.forEach((rule, ri) => {
        const atRule = (path: (string | number)[], message: string) => at(["rules", ri, ...path], message);

        if (ruleIds.has(rule.id)) {
          atRule(["id"], `Two rules share the id "${rule.id}". Rule ids are part of the payout key, so duplicates would pay once and strand the other.`);
        }
        ruleIds.add(rule.id);

        if (!effectAllowedForTrigger(rule.trigger, rule.effect.kind)) {
          const trigger = TRIGGER_META[rule.trigger];
          atRule(
            ["effect"],
            effectIsStanding(rule.effect.kind)
              ? `"${EFFECT_LABELS[rule.effect.kind]}" is a standing price change, so it only works on the "${TRIGGER_META.always.label}" trigger — it's read every time a price is quoted, not delivered once.`
              : trigger.standing
                ? `"${trigger.label}" is continuous, so it can't deliver "${EFFECT_LABELS[rule.effect.kind]}" — that would pay out over and over. Use a real event, or switch to a discount.`
                : `"${EFFECT_LABELS[rule.effect.kind]}" needs a purchase to size itself against, so it can't hang off "${trigger.label}".`,
          );
        }

        for (const condition of rule.conditions) {
          if (!conditionAllowedForTrigger(rule.trigger, condition.kind)) {
            atRule(
              ["conditions"],
              `The "${CONDITION_LABELS[condition.kind]}" condition can never be evaluated on "${TRIGGER_META[rule.trigger].label}", so it would silently be ignored — and the rule would pay out more widely than it looks like it does.`,
            );
          }
        }

        if (ruleNeedsApproval(rule.trigger, rule.effect.kind) && !rule.requiresApproval) {
          atRule(
            ["requiresApproval"],
            rule.trigger === "feedback_submitted"
              ? `Nothing can judge whether feedback was useful, so this payout has to be approved by hand.`
              : `"${TRIGGER_META[rule.trigger].label}" happens before any money has moved, so paying Sparks automatically can be farmed with throwaway accounts. Approve these by hand.`,
          );
        }

        if (rule.effect.kind === "spendRefund") {
          const e = rule.effect;
          if (e.maxRefundSparks === 0 && e.maxPctOfPurchase === 0) {
            atRule(
              ["effect"],
              `This refund has no ceiling at all. Spent Sparks are provider work you have already paid for, so an uncapped refund is unbounded exposure — a customer can burn Sparks deliberately and claim them back against your cheapest product. Set a Spark cap, a share-of-purchase cap, or both.`,
            );
          }
          if (e.minRefundMode === "topUp" && e.maxRefundSparks > 0 && e.minRefundSparks > e.maxRefundSparks) {
            atRule(["effect"], `The minimum refund (${e.minRefundSparks}) is above the maximum (${e.maxRefundSparks}).`);
          }
          if (e.scope.funding === "all" && e.percent >= 100 && e.maxPctOfPurchase === 0) {
            atRule(
              ["effect"],
              `Refunding 100% of ALL Sparks — including free ones — with no share-of-purchase cap gives back more value than the sale brings in. Cap it against the purchase, or refund only purchased Sparks.`,
            );
          }
        }

        if (rule.effect.kind === "purchaseDiscount" && rule.effect.recurring && !rule.effect.appliesTo.includes("plan")) {
          atRule(["effect"], `"Every renewal" only means anything for memberships — add the membership item type, or turn it off.`);
        }

        if (TRIGGER_META[rule.trigger].scheduled && rule.afterDays < 1) {
          atRule(["afterDays"], `"${TRIGGER_META[rule.trigger].label}" needs a number of days.`);
        }

        // The whole point of generated copy is that it exists. An effect with no
        // sentence would ship a campaign nobody can be told about.
        if (!describeEffect(rule.effect, { plain: true }).trim()) {
          atRule(["effect"], `This effect has no description, so there's no way to tell a customer about it.`);
        }
      });

      if (campaign.status === "active" && !campaign.rules.some((r) => r.enabled)) {
        at(["rules"], `"${campaign.name}" is active but has no enabled rules, so it does nothing.`);
      }
      if (campaign.status === "active" && campaign.limits.dailyBudget === 0 && campaign.rules.some((r) => r.enabled && (r.effect.kind === "sparks" || r.effect.kind === "spendRefund"))) {
        at(
          ["limits", "dailyBudget"],
          `"${campaign.name}" grants Sparks with no daily budget. That's the only circuit breaker between a misconfigured rule and an unbounded payout — set one.`,
        );
      }
    });
  });
