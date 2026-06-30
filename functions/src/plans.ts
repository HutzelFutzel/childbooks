/**
 * Server-side access to the admin-managed **subscription plans**, plus the
 * Stripe reconciliation that keeps them in sync.
 *
 * Two documents (mirrors the product catalog pattern):
 *   - PRIVATE `adminSettings/plans` — the full {@link PlansConfig} incl. the
 *     Stripe product/price ids. Backend-only (rules deny clients).
 *   - PUBLIC  `appConfig/plans` — a derived {@link PublicPlansConfig} the
 *     storefront reads live (active price ids + amounts + entitlements + grant).
 *
 * On save, {@link syncPlanToStripe} reconciles a plan into Stripe: it ensures a
 * Product exists and, for each currency×interval, creates a recurring Price when
 * the amount is new or changed (archiving the superseded Price — Stripe Prices
 * are immutable). Existing subscribers stay on their archived price, which still
 * resolves to the plan via {@link resolvePlanByPriceId}.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getStripe, stripeConfigured } from "./stripeClient";
import {
  BILLING_INTERVALS,
  createDefaultPlansConfig,
  freePlan,
  normalizePlan,
  normalizePlansConfig,
  planSchema,
  plansConfigSchema,
  resolvePlanByPriceId,
  toPublicPlan,
  type PlanDefinition,
  type PlansConfig,
  type PublicPlansConfig,
} from "../../books-frontend/src/core/config/plans";

const PRIVATE_DOC = "adminSettings/plans";
const PUBLIC_DOC = "appConfig/plans";

const CACHE_TTL_MS = 30_000;
let cache: { value: PlansConfig; at: number } | null = null;

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);
function toMinor(amount: number, currency: string): number {
  const factor = ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
  return Math.round(amount * factor);
}

async function readConfig(): Promise<PlansConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  ensureAdmin();
  let raw: unknown = undefined;
  try {
    const snap = await getFirestore().doc(PRIVATE_DOC).get();
    raw = snap.exists ? snap.data() : undefined;
  } catch {
    // fall back to defaults
  }
  const value = raw ? normalizePlansConfig(raw) : createDefaultPlansConfig();
  cache = { value, at: Date.now() };
  return value;
}

function projectPublic(config: PlansConfig): PublicPlansConfig {
  return {
    version: 1,
    plans: config.plans
      .filter((p) => p.status !== "retired")
      .map(toPublicPlan)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/** Deep-strip `undefined` (Firestore rejects it) without changing array shape. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeConfig(config: PlansConfig): Promise<PlansConfig> {
  ensureAdmin();
  const db = getFirestore();
  await db.doc(PRIVATE_DOC).set(clean(config) as unknown as Record<string, unknown>, { merge: false });
  await db.doc(PUBLIC_DOC).set(clean(projectPublic(config)) as unknown as Record<string, unknown>, { merge: false });
  cache = { value: config, at: Date.now() };
  return config;
}

export function getPlansConfig(): Promise<PlansConfig> {
  return readConfig();
}

export function defaultPlansConfig(): PlansConfig {
  return createDefaultPlansConfig();
}

/**
 * Reconcile one plan into Stripe: ensure its Product, then create/refresh a
 * recurring Price for each currency×interval. A new Price is minted (and the old
 * one archived) when the amount, currency, interval or active flag drifts from
 * Stripe — Prices are immutable, so editing means replace. The free plan and an
 * unconfigured Stripe account are passed through untouched.
 */
export async function syncPlanToStripe(plan: PlanDefinition): Promise<PlanDefinition> {
  if (plan.isFree || !stripeConfigured()) return plan;
  const stripe = getStripe();

  const name = plan.presentation.name || "Subscription plan";
  const description = plan.presentation.tagline || plan.presentation.description || undefined;

  let productId = plan.billing.stripeProductId;
  if (!productId) {
    const product = await stripe.products.create({ name, description, metadata: { planId: plan.id } });
    productId = product.id;
  } else {
    try {
      await stripe.products.update(productId, { name, description, metadata: { planId: plan.id } });
    } catch {
      // Product was deleted in Stripe — recreate it.
      const product = await stripe.products.create({ name, description, metadata: { planId: plan.id } });
      productId = product.id;
    }
  }

  const prices = clean(plan.billing.prices);
  for (const [currency, byInterval] of Object.entries(prices)) {
    for (const interval of BILLING_INTERVALS) {
      const pp = byInterval?.[interval];
      if (!pp || pp.amount <= 0) continue;
      const desiredMinor = toMinor(pp.amount, currency);
      let needNew = !pp.stripePriceId;
      if (pp.stripePriceId) {
        try {
          const existing = await stripe.prices.retrieve(pp.stripePriceId);
          if (
            existing.unit_amount !== desiredMinor ||
            existing.currency !== currency.toLowerCase() ||
            existing.recurring?.interval !== interval ||
            !existing.active
          ) {
            needNew = true;
          }
        } catch {
          needNew = true;
        }
      }
      if (needNew) {
        if (pp.stripePriceId) {
          try {
            await stripe.prices.update(pp.stripePriceId, { active: false });
          } catch {
            // ignore — archiving a missing price is fine
          }
        }
        const created = await stripe.prices.create({
          product: productId,
          currency: currency.toLowerCase(),
          unit_amount: desiredMinor,
          recurring: { interval },
          tax_behavior: plan.billing.taxBehavior,
          metadata: { planId: plan.id },
        });
        pp.stripePriceId = created.id;
        pp.active = true;
      } else {
        pp.active = true;
      }
    }
  }

  return { ...plan, billing: { ...plan.billing, stripeProductId: productId, prices } };
}

/** Replace the whole plans config (validated, no Stripe sync). */
export async function savePlansConfig(input: unknown): Promise<PlansConfig> {
  const parsed = plansConfigSchema.parse(input);
  return writeConfig(normalizePlansConfig(parsed));
}

/** Create or update a single plan (validated), syncing it to Stripe first. */
export async function upsertPlan(input: unknown, uid?: string): Promise<PlanDefinition> {
  const parsed = planSchema.parse(input);
  const normalized = normalizePlan({ ...parsed, updatedAt: Date.now(), updatedBy: uid });
  const synced = await syncPlanToStripe(normalized);
  const current = await readConfig();
  const idx = current.plans.findIndex((p) => p.id === synced.id);
  const plans =
    idx === -1 ? [...current.plans, synced] : current.plans.map((p) => (p.id === synced.id ? synced : p));
  await writeConfig({ version: 1, plans });
  return synced;
}

export async function deletePlan(id: string): Promise<PlansConfig> {
  const current = await readConfig();
  const target = current.plans.find((p) => p.id === id);
  if (target?.isFree) return current; // never delete the baseline free plan
  // Archive the Stripe product so checkout can't start it, but keep prices so
  // existing subscribers' webhooks still resolve. Best-effort.
  if (target?.billing.stripeProductId && stripeConfigured()) {
    try {
      await getStripe().products.update(target.billing.stripeProductId, { active: false });
    } catch {
      // ignore
    }
  }
  const plans = current.plans.filter((p) => p.id !== id);
  return writeConfig({ version: 1, plans });
}

// ---- Per-user resolution ---------------------------------------------------

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** The price id of the user's current active subscription, if any. */
async function activePriceId(uid: string): Promise<string | null> {
  try {
    ensureAdmin();
    const snap = await getFirestore().collection(`users/${uid}/subscriptions`).get();
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const status = typeof d.status === "string" ? d.status : "";
      if (ACTIVE_STATUSES.has(status) && typeof d.priceId === "string") return d.priceId;
    }
  } catch {
    // ignore — treat as no subscription
  }
  return null;
}

/** The user's effective plan (their active subscription's plan, else free). */
export async function resolveActivePlan(uid: string): Promise<PlanDefinition | null> {
  const config = await readConfig();
  const priceId = await activePriceId(uid);
  return resolvePlanByPriceId(config, priceId) ?? freePlan(config);
}

/** The per-action Spark price multiplier for a user's plan (1 when none/unset). */
export async function actionMultiplier(uid: string, action: string): Promise<number> {
  try {
    const plan = await resolveActivePlan(uid);
    const m = plan?.actionMultipliers?.[action];
    return typeof m === "number" && m > 0 ? m : 1;
  } catch {
    return 1;
  }
}
