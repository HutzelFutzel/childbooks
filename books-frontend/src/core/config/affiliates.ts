/**
 * **Affiliate program scope** — which purchases may pay a commission, per
 * Rewardful campaign.
 *
 * Rewardful is the source of truth for rates, caps, attribution and payouts. It
 * has exactly ONE rate per campaign (a percentage or a flat amount) and no
 * concept of our products, so the only thing it cannot express is "this campaign
 * pays on print orders but not on memberships". That distinction has to live
 * here, because our catalog has wildly different economics per kind: a printed
 * book carries real production + shipping cost (and Rewardful's commission base
 * includes the shipping we charged), while a digital edition is almost pure
 * margin.
 *
 * How the scope is enforced: attribution attaches to the STRIPE CUSTOMER (we
 * stamp `metadata.referral` once), which makes every later charge from that
 * customer commissionable in Rewardful's eyes. So scope can't be enforced by
 * withholding attribution — instead each Checkout Session for an out-of-scope
 * kind carries `rewardful: false` in the metadata Rewardful reads, and no
 * commission is ever created. Suppressing before the charge is Rewardful's own
 * sanctioned mechanism; deleting commissions afterwards is not (and would email
 * the affiliate about money they never earn).
 *
 * FAIL CLOSED: a campaign we don't know about pays on nothing. Money must never
 * leave because a campaign UUID was mistyped or a new campaign was created in
 * Rewardful without being scoped here.
 *
 * The intended launch shape (campaign UUIDs come from Rewardful, so the shipped
 * default is empty):
 *   - "Print"   → `order`
 *   - "Digital" → `ebook`, `subscription`
 * Spark packs and gifts are in no campaign's scope: their cost is live model
 * spend, and a gift's value lands with somebody who was never referred.
 */
import { z } from "zod";

/**
 * Purchase kinds that can reach Stripe, and therefore Rewardful. Mirrors
 * `PaymentKind` on the backend; kept as its own list because this module is
 * shared with the client and must not depend on the functions build.
 */
export const COMMISSIONABLE_KINDS = [
  "order",
  "ebook",
  "subscription",
  "sparkPack",
  "sparkGift",
] as const;

export type CommissionableKind = (typeof COMMISSIONABLE_KINDS)[number];

/** Admin-facing names for the kinds (the admin scope editor renders these). */
export const KIND_LABELS: Record<CommissionableKind, string> = {
  order: "Print orders",
  ebook: "Digital editions",
  subscription: "Memberships",
  sparkPack: "Spark packs",
  sparkGift: "Spark gifts",
};

export interface AffiliateCampaign {
  /** The Rewardful campaign UUID (`Rewardful.campaign.id`). */
  id: string;
  /** Mirrors the campaign's name in Rewardful — display only. */
  label: string;
  /** The ONLY kinds that may generate a commission under this campaign. */
  kinds: CommissionableKind[];
}

export interface AffiliateConfig {
  version: 1;
  /**
   * Master switch. While false we neither stamp attribution onto Stripe
   * customers nor suppress anything — the program simply doesn't exist, which
   * is how it ships.
   */
  enabled: boolean;
  campaigns: AffiliateCampaign[];
  /**
   * Per-affiliate scope, keyed by Rewardful affiliate UUID, overriding whatever
   * their campaign allows. For the one-off deal ("she promotes books, but never
   * on memberships") that shouldn't force a whole new campaign.
   */
  affiliateOverrides: Record<string, CommissionableKind[]>;
  updatedAt: number;
}

export function createDefaultAffiliateConfig(): AffiliateConfig {
  return {
    version: 1,
    enabled: false,
    campaigns: [],
    affiliateOverrides: {},
    updatedAt: Date.now(),
  };
}

// ---- Scope resolution -------------------------------------------------------

function isKind(value: unknown): value is CommissionableKind {
  return typeof value === "string" && (COMMISSIONABLE_KINDS as readonly string[]).includes(value);
}

function uniqueKinds(raw: unknown): CommissionableKind[] {
  if (!Array.isArray(raw)) return [];
  const out: CommissionableKind[] = [];
  for (const v of raw) {
    if (isKind(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The kinds a referral may earn on, given the campaign it was created under and
 * the affiliate who owns it. An affiliate override REPLACES the campaign scope
 * rather than extending it, so one place always answers "what does this person
 * earn on".
 */
export function scopeFor(
  config: AffiliateConfig,
  args: { campaignId?: string | null; affiliateId?: string | null },
): CommissionableKind[] {
  if (!config.enabled) return [];
  const override = args.affiliateId ? config.affiliateOverrides[args.affiliateId] : undefined;
  if (override) return override;
  const campaign = args.campaignId
    ? config.campaigns.find((c) => c.id === args.campaignId)
    : undefined;
  return campaign ? campaign.kinds : [];
}

/**
 * Whether a purchase may generate a commission. Everything unknown resolves to
 * `false` — see FAIL CLOSED in the module header.
 */
export function isCommissionable(
  config: AffiliateConfig,
  args: { campaignId?: string | null; affiliateId?: string | null; kind: CommissionableKind },
): boolean {
  return scopeFor(config, args).includes(args.kind);
}

// ---- Normalization ----------------------------------------------------------

/** A Rewardful id — always a UUID. Used to reject junk before it's stored. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRewardfulId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function normalizeAffiliateConfig(input: unknown): AffiliateConfig {
  const d = createDefaultAffiliateConfig();
  const c = (input ?? {}) as Partial<AffiliateConfig>;

  const campaigns: AffiliateCampaign[] = [];
  if (Array.isArray(c.campaigns)) {
    for (const raw of c.campaigns) {
      const entry = (raw ?? {}) as Partial<AffiliateCampaign>;
      // A campaign without a valid UUID can never match a real referral, and
      // keeping it would only make the admin list look configured.
      if (!isRewardfulId(entry.id)) continue;
      const id = String(entry.id).trim();
      if (campaigns.some((existing) => existing.id === id)) continue;
      campaigns.push({
        id,
        label: typeof entry.label === "string" ? entry.label.slice(0, 120) : "",
        kinds: uniqueKinds(entry.kinds),
      });
    }
  }

  const affiliateOverrides: Record<string, CommissionableKind[]> = {};
  if (c.affiliateOverrides && typeof c.affiliateOverrides === "object") {
    for (const [affiliateId, kinds] of Object.entries(c.affiliateOverrides)) {
      if (!isRewardfulId(affiliateId)) continue;
      affiliateOverrides[affiliateId.trim()] = uniqueKinds(kinds);
    }
  }

  return {
    version: 1,
    enabled: c.enabled === true,
    campaigns,
    affiliateOverrides,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : d.updatedAt,
  };
}

// ---- Mirrored Rewardful data ------------------------------------------------

/**
 * Rewardful is the system of record; these are read-only local copies, kept so
 * the admin dashboard can render fast, join commissions to our own payments, and
 * feed the finance ledger. Nothing here is ever edited locally — every field is
 * overwritten by the next sync, and `syncedAt` says how stale it is.
 *
 * Money arrives from Rewardful as integer cents in the sale's currency.
 * `amountUsd` is added by us at mirror time (via the admin FX table) so the
 * dashboard and the P&L can aggregate one comparable number.
 */
export interface AffiliateCampaignMirror {
  id: string;
  name: string;
  rewardType: "percent" | "amount";
  commissionPercent: number | null;
  commissionAmountCents: number | null;
  commissionAmountCurrency: string | null;
  minimumPayoutCents: number | null;
  minimumPayoutCurrency: string | null;
  /** Recurring caps: null means "no cap" (commissions run forever). */
  maxCommissionPeriodMonths: number | null;
  maxCommissions: number | null;
  daysBeforeReferralsExpire: number | null;
  /** The refund window — commissions stay `pending` this long before becoming due. */
  daysUntilCommissionsAreDue: number | null;
  isDefault: boolean;
  visitors: number;
  leads: number;
  conversions: number;
  affiliates: number;
  createdAt: number | null;
  syncedAt: number;
}

export interface AffiliatePartnerMirror {
  id: string;
  name: string;
  email: string;
  /** `active` | `disabled` | `suspicious` — disabled/suspicious earn nothing. */
  state: string;
  campaignId: string | null;
  campaignName: string | null;
  visitors: number;
  leads: number;
  conversions: number;
  links: { token: string; url: string }[];
  createdAt: number | null;
  confirmedAt: number | null;
  syncedAt: number;
  /** Set when Rewardful reports the affiliate gone; the row is kept for history. */
  deletedAt: number | null;
}

export type AffiliateCommissionState = "pending" | "due" | "paid" | "voided";

export interface AffiliateCommissionMirror {
  id: string;
  amountCents: number;
  currency: string;
  amountUsd: number;
  state: string;
  createdAt: number | null;
  dueAt: number | null;
  paidAt: number | null;
  voidedAt: number | null;
  /** When the underlying charge happened — the period this cost belongs to. */
  chargedAt: number | null;
  affiliateId: string | null;
  affiliateName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  saleAmountCents: number | null;
  chargeAmountCents: number | null;
  refundAmountCents: number | null;
  saleCurrency: string | null;
  stripeChargeId: string | null;
  stripeCustomerId: string | null;
  /** Our side of the join, resolved from the Stripe ids at mirror time. */
  uid: string | null;
  paymentId: string | null;
  purchaseKind: CommissionableKind | null;
  /**
   * Whether the purchase was inside the affiliate's scope. `false` means a
   * commission was created that our suppression should have prevented — a bug or
   * a scope map that drifted from Rewardful, and worth an alert either way.
   * `null` when the purchase kind couldn't be resolved, so nothing can be said.
   */
  inScope: boolean | null;
  /** Bookkeeping for the finance ledger, so a cost is booked exactly once. */
  costRecordedAt: number | null;
  costVoidedAt: number | null;
  syncedAt: number;
  deletedAt: number | null;
}

export interface AffiliatePayoutMirror {
  id: string;
  amountCents: number;
  currency: string;
  amountUsd: number;
  /** `pending` | `due` | `processing` | `paid`. */
  state: string;
  paidAt: number | null;
  affiliateId: string | null;
  affiliateName: string | null;
  commissionCount: number;
  createdAt: number | null;
  syncedAt: number;
  deletedAt: number | null;
}

/** Outcome of the last reconcile, shown in the admin dashboard. */
export interface AffiliateSyncStatus {
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  durationMs: number | null;
  campaigns: number;
  partners: number;
  commissions: number;
  payouts: number;
  /** Commissions the mirror found outside our scope map on the last run. */
  scopeViolations: number;
}

export function emptySyncStatus(): AffiliateSyncStatus {
  return {
    lastRunAt: null,
    lastOkAt: null,
    lastError: null,
    durationMs: null,
    campaigns: 0,
    partners: 0,
    commissions: 0,
    payouts: 0,
    scopeViolations: 0,
  };
}

/** Per-affiliate rollup computed from the mirrored commissions. */
export interface AffiliateTotals {
  commissions: number;
  pendingUsd: number;
  dueUsd: number;
  paidUsd: number;
  voidedUsd: number;
  /** Gross sales credited to this affiliate (USD), for a cost-of-sale ratio. */
  salesUsd: number;
}

export interface AffiliateStateTotals {
  count: number;
  usd: number;
}

/** Everything the admin affiliate dashboard renders, in one response. */
export interface AffiliateOverview {
  config: AffiliateConfig;
  /** Whether the program can actually work right now, and why not. */
  readiness: {
    apiConfigured: boolean;
    webhookConfigured: boolean;
    liveEnv: boolean;
    enabled: boolean;
    apiReachable: boolean | null;
    apiError: string | null;
  };
  campaigns: AffiliateCampaignMirror[];
  partners: (AffiliatePartnerMirror & { totals: AffiliateTotals })[];
  byState: Record<string, AffiliateStateTotals>;
  recentCommissions: AffiliateCommissionMirror[];
  payouts: AffiliatePayoutMirror[];
  /** Commissions that were created outside our scope map (should be zero). */
  outOfScope: AffiliateCommissionMirror[];
  sync: AffiliateSyncStatus;
  /**
   * The endpoint to register in Rewardful → Webhooks, with the token masked
   * (the admin already knows it — it's the one they generated).
   */
  webhook: { url: string; configured: boolean };
}

/** Deep links into Rewardful, so the admin never has to hunt for the real thing. */
export const REWARDFUL_APP_URL = "https://app.getrewardful.com";

export function rewardfulAffiliateUrl(affiliateId: string): string {
  return `${REWARDFUL_APP_URL}/affiliates/${affiliateId}`;
}

export function rewardfulCampaignUrl(campaignId: string): string {
  return `${REWARDFUL_APP_URL}/campaigns/${campaignId}`;
}

// ---- Validation (backend, before persisting) --------------------------------

const kindSchema = z.enum(COMMISSIONABLE_KINDS);

export const affiliateConfigSchema = z.object({
  version: z.literal(1).optional(),
  enabled: z.boolean().optional(),
  campaigns: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().max(120).optional(),
        kinds: z.array(kindSchema),
      }),
    )
    .optional(),
  affiliateOverrides: z.record(z.string(), z.array(kindSchema)).optional(),
  updatedAt: z.number().optional(),
});
