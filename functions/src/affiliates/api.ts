/**
 * Rewardful REST API client (https://api.getrewardful.com/v1).
 *
 * The ONLY trusted source of affiliate data. Webhooks arrive unsigned, so
 * nothing they say is stored without being re-read through this client — which
 * makes it the boundary where "one source of truth" is actually enforced.
 *
 * Shape of the API, for whoever reads this next:
 *   - HTTP Basic, API secret as the username, no password (like Stripe).
 *   - UUID primary keys, ISO 8601 timestamps, money as integer cents.
 *   - Lists are `{ pagination: { next_page, … }, data: [...] }`, 25 per page by
 *     default and 100 at most.
 *   - Nested objects need an explicit `expand[]`, otherwise you get bare ids.
 *   - 45 requests per 30 seconds, answered with 429 + RateLimit headers.
 *
 * Types below cover the fields we actually mirror. They're deliberately partial
 * and every one is optional: this is somebody else's JSON, and a new field or a
 * missing one must never throw inside a webhook or a nightly job.
 */
import { serverConfig } from "../config";

const BASE_URL = "https://api.getrewardful.com/v1";
const TIMEOUT_MS = 20_000;
/**
 * Page cap per list call. At 100 per page this is 50k commissions — far beyond
 * anything this program will produce, and the thing that guarantees a paging bug
 * can't turn into an infinite loop inside a scheduled function.
 */
const MAX_PAGES = 500;

// ---- Object shapes ----------------------------------------------------------

export interface RewardfulCampaignObject {
  id?: string;
  name?: string;
  url?: string;
  reward_type?: "percent" | "amount" | string;
  commission_percent?: number;
  commission_amount_cents?: number;
  commission_amount_currency?: string;
  minimum_payout_cents?: number;
  minimum_payout_currency?: string;
  max_commission_period_months?: number | null;
  max_commissions?: number | null;
  days_before_referrals_expire?: number;
  days_until_commissions_are_due?: number;
  default?: boolean;
  private?: boolean;
  visitors?: number;
  leads?: number;
  conversions?: number;
  affiliates?: number;
  created_at?: string;
  updated_at?: string;
}

export interface RewardfulLinkObject {
  id?: string;
  url?: string;
  token?: string;
  visitors?: number;
  leads?: number;
  conversions?: number;
}

export interface RewardfulAffiliateObject {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  paypal_email?: string | null;
  wise_email?: string | null;
  state?: "active" | "disabled" | "suspicious" | string;
  visitors?: number;
  leads?: number;
  conversions?: number;
  confirmed_at?: string | null;
  campaign?: RewardfulCampaignObject | null;
  links?: RewardfulLinkObject[];
  created_at?: string;
  updated_at?: string;
}

export interface RewardfulReferralObject {
  id?: string;
  stripe_customer_id?: string | null;
  conversion_state?: string;
  expires_at?: string | null;
  deactivated_at?: string | null;
  customer?: { id?: string; name?: string; email?: string } | null;
  link?: RewardfulLinkObject | null;
}

export interface RewardfulSaleObject {
  id?: string;
  currency?: string;
  charged_at?: string | null;
  invoiced_at?: string | null;
  stripe_charge_id?: string | null;
  stripe_account_id?: string | null;
  charge_amount_cents?: number;
  refund_amount_cents?: number;
  tax_amount_cents?: number;
  sale_amount_cents?: number;
  referral?: RewardfulReferralObject | null;
  affiliate?: RewardfulAffiliateObject | null;
}

export interface RewardfulCommissionObject {
  id?: string;
  /** Commission value in CENTS of `currency`. */
  amount?: number;
  currency?: string;
  state?: "pending" | "due" | "paid" | "voided" | string;
  due_at?: string | null;
  paid_at?: string | null;
  voided_at?: string | null;
  campaign?: RewardfulCampaignObject | null;
  sale?: RewardfulSaleObject | null;
  created_at?: string;
  updated_at?: string;
}

export interface RewardfulPayoutObject {
  id?: string;
  amount?: number;
  currency?: string;
  state?: "pending" | "due" | "processing" | "paid" | string;
  paid_at?: string | null;
  affiliate?: RewardfulAffiliateObject | null;
  commissions?: { id?: string; amount?: number; currency?: string }[];
  created_at?: string;
  updated_at?: string;
}

// ---- Client -----------------------------------------------------------------

export class RewardfulNotConfiguredError extends Error {
  constructor() {
    super("Rewardful is not configured (no API secret).");
    this.name = "RewardfulNotConfiguredError";
  }
}

/** Thrown for any non-2xx response, carrying the status for caller decisions. */
export class RewardfulApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Rewardful API ${status}: ${message}`);
    this.name = "RewardfulApiError";
    this.status = status;
  }
}

export function rewardfulConfigured(): boolean {
  return Boolean(serverConfig().rewardful.apiSecret.trim());
}

function authHeader(): string {
  const secret = serverConfig().rewardful.apiSecret.trim();
  if (!secret) throw new RewardfulNotConfiguredError();
  // Basic auth with the secret as username and an empty password.
  return `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
}

/**
 * `expand[]=a&expand[]=b` plus scalar params. Arrays are always sent in the
 * bracket form, which the API accepts for single values too, so there's one
 * code path instead of two.
 */
function buildQuery(params: Record<string, string | number | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(`${key}[]`, v);
    } else {
      qs.set(key, String(value));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

async function request<T>(
  path: string,
  params: Record<string, string | number | string[] | undefined> = {},
  attempt = 0,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}${buildQuery(params)}`, {
      method: "GET",
      headers: { Authorization: authHeader(), Accept: "application/json" },
      signal: controller.signal,
    });

    // One polite retry on 429, honoring the reset hint. Beyond that the caller
    // (a nightly job or a webhook Rewardful will redeliver) is better placed to
    // decide than a tight loop here.
    if (res.status === 429 && attempt === 0) {
      const resetSeconds = Number(res.headers.get("ratelimit-reset") ?? res.headers.get("retry-after") ?? 5);
      const waitMs = Math.min(Math.max(Number.isFinite(resetSeconds) ? resetSeconds : 5, 1), 30) * 1000;
      clearTimeout(timer);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return request<T>(path, params, attempt + 1);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new RewardfulApiError(res.status, body.slice(0, 300) || res.statusText);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface Paginated<T> {
  pagination?: { next_page?: number | null; total_count?: number; total_pages?: number };
  data?: T[];
}

/** Walk every page of a list endpoint, 100 at a time. */
async function listAll<T>(
  path: string,
  params: Record<string, string | number | string[] | undefined> = {},
): Promise<T[]> {
  const out: T[] = [];
  let page: number | null = 1;
  for (let i = 0; i < MAX_PAGES && page; i++) {
    const res: Paginated<T> = await request<Paginated<T>>(path, { ...params, page, limit: 100 });
    if (Array.isArray(res.data)) out.push(...res.data);
    const next = res.pagination?.next_page;
    page = typeof next === "number" && next > page ? next : null;
  }
  return out;
}

// ---- Endpoints we use -------------------------------------------------------

export function listCampaigns(): Promise<RewardfulCampaignObject[]> {
  return listAll<RewardfulCampaignObject>("/campaigns");
}

export function listAffiliates(): Promise<RewardfulAffiliateObject[]> {
  return listAll<RewardfulAffiliateObject>("/affiliates", { expand: ["campaign", "links"] });
}

export function getAffiliate(id: string): Promise<RewardfulAffiliateObject> {
  return request<RewardfulAffiliateObject>(`/affiliates/${encodeURIComponent(id)}`, {
    expand: ["campaign", "links"],
  });
}

/**
 * Commissions with the sale expanded, which is where the affiliate, the referral
 * and the Stripe charge id live — everything needed to tie a commission back to
 * one of our own payments.
 */
export function listCommissions(): Promise<RewardfulCommissionObject[]> {
  return listAll<RewardfulCommissionObject>("/commissions", { expand: ["sale", "campaign"] });
}

export function getCommission(id: string): Promise<RewardfulCommissionObject> {
  return request<RewardfulCommissionObject>(`/commissions/${encodeURIComponent(id)}`, {
    expand: ["sale", "campaign"],
  });
}

export function listPayouts(): Promise<RewardfulPayoutObject[]> {
  return listAll<RewardfulPayoutObject>("/payouts", { expand: ["affiliate", "commissions"] });
}

export function getPayout(id: string): Promise<RewardfulPayoutObject> {
  return request<RewardfulPayoutObject>(`/payouts/${encodeURIComponent(id)}`, {
    expand: ["affiliate", "commissions"],
  });
}

/**
 * Cheapest authenticated call there is — used by the admin readiness check to
 * prove the API secret works without pulling the whole account.
 */
export async function pingRewardful(): Promise<{ ok: boolean; campaigns: number; error?: string }> {
  try {
    const res = await request<Paginated<RewardfulCampaignObject>>("/campaigns", { limit: 1 });
    return { ok: true, campaigns: res.pagination?.total_count ?? res.data?.length ?? 0 };
  } catch (err) {
    return { ok: false, campaigns: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
