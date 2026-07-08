/**
 * Custom operating costs — admin-entered expenses that aren't captured by any
 * automated source (email service, domain renewals, design tools, …), booked
 * into the finance stream so the "total win" reflects the whole business.
 *
 * Model (`customCosts` collection, backend-only writes):
 *   { title, description, slug, amount (GROSS), currency, taxRatePct,
 *     cadence: once|monthly|yearly, firstChargeAt, endAt?, active, … }
 *
 * Booking rules:
 *   - Events are written when a period becomes due (matching real invoices),
 *     idempotent per cost+period, so the daily sweep can re-run freely.
 *   - Price changes are edits to `amount`; only periods booked AFTER the edit
 *     use the new figure — already-written events are immutable history.
 *   - Tax: the admin enters the gross amount + tax rate. Whether the booked
 *     cost is net (VAT reclaimed) or gross is a global preference
 *     (adminSettings.ops.reclaimVat); both figures live in the event meta.
 *   - Each cost gets its own finance kind (`custom:{slug}`) so it appears as
 *     its own line in the cost-points ("leak finder") table.
 */
import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { ensureAdmin } from "./storage";
import { getAdminSettings } from "./adminSettings";
import { recordFinanceEvent, toUsd } from "./finance";

const COLLECTION = "customCosts";

export type CostCadence = "once" | "monthly" | "yearly";

export interface CustomCost {
  id: string;
  title: string;
  description: string;
  /** Stable finance-kind suffix derived from the title at creation. */
  slug: string;
  /** GROSS amount per period, in `currency`. */
  amount: number;
  currency: string;
  /** VAT/sales-tax rate contained in `amount` (0 = untaxed / unknown). */
  taxRatePct: number;
  cadence: CostCadence;
  /** First (or only) charge date, ms epoch. */
  firstChargeAt: number;
  /** Recurring costs stop after this date (inclusive). Null = open-ended. */
  endAt: number | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

const costInputSchema = z.object({
  id: z.string().max(128).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  amount: z.number().positive().max(10_000_000),
  currency: z.string().min(3).max(3),
  taxRatePct: z.number().min(0).max(50).optional(),
  cadence: z.enum(["once", "monthly", "yearly"]),
  firstChargeAt: z.number().int().positive(),
  endAt: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export type CustomCostInput = z.infer<typeof costInputSchema>;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "cost";
}

function db() {
  ensureAdmin();
  return getFirestore();
}

export async function listCustomCosts(): Promise<CustomCost[]> {
  const snap = await db().collection(COLLECTION).orderBy("createdAt", "asc").get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<CustomCost, "id">), id: d.id }));
}

/** Create or update a cost. The slug (⇒ finance kind) is fixed at creation. */
export async function upsertCustomCost(input: unknown): Promise<CustomCost> {
  const parsed = costInputSchema.parse(input ?? {});
  const now = Date.now();
  const col = db().collection(COLLECTION);

  if (parsed.id) {
    const ref = col.doc(parsed.id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Unknown cost id.");
    const prev = snap.data() as Omit<CustomCost, "id">;
    const next: Omit<CustomCost, "id"> = {
      ...prev,
      title: parsed.title.trim(),
      description: (parsed.description ?? "").trim(),
      amount: parsed.amount,
      currency: parsed.currency.toUpperCase(),
      taxRatePct: parsed.taxRatePct ?? 0,
      cadence: parsed.cadence,
      firstChargeAt: parsed.firstChargeAt,
      endAt: parsed.endAt ?? null,
      active: parsed.active ?? prev.active,
      updatedAt: now,
    };
    await ref.set(next);
    return { ...next, id: parsed.id };
  }

  const id = randomUUID();
  const doc: Omit<CustomCost, "id"> = {
    title: parsed.title.trim(),
    description: (parsed.description ?? "").trim(),
    slug: slugify(parsed.title),
    amount: parsed.amount,
    currency: parsed.currency.toUpperCase(),
    taxRatePct: parsed.taxRatePct ?? 0,
    cadence: parsed.cadence,
    firstChargeAt: parsed.firstChargeAt,
    endAt: parsed.endAt ?? null,
    active: parsed.active ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await col.doc(id).create(doc);
  return { ...doc, id };
}

/** Remove a cost definition. Already-booked finance events remain (history). */
export async function deleteCustomCost(id: string): Promise<void> {
  await db().collection(COLLECTION).doc(id).delete();
}

// ---------------------------------------------------------------------------
// Due-period sweep
// ---------------------------------------------------------------------------

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * All charge timestamps of `cost` that are due at `now` (bounded backfill so a
 * cost entered with a past start date fills in its history). Period keys are
 * stable, so re-sweeping is idempotent.
 */
function duePeriods(cost: CustomCost, now: number): { key: string; at: number }[] {
  const end = cost.endAt ?? Number.POSITIVE_INFINITY;
  if (cost.cadence === "once") {
    return cost.firstChargeAt <= now ? [{ key: "once", at: cost.firstChargeAt }] : [];
  }

  const first = new Date(cost.firstChargeAt);
  const out: { key: string; at: number }[] = [];
  const MAX_PERIODS = 120; // backfill cap: 10 years of months

  if (cost.cadence === "monthly") {
    for (let i = 0; i < MAX_PERIODS; i++) {
      const year = first.getUTCFullYear() + Math.floor((first.getUTCMonth() + i) / 12);
      const month0 = (first.getUTCMonth() + i) % 12;
      const day = Math.min(first.getUTCDate(), daysInMonth(year, month0));
      const at = Date.UTC(year, month0, day, 12);
      if (at > now || at > end) break;
      out.push({ key: `${year}-${String(month0 + 1).padStart(2, "0")}`, at });
    }
    return out;
  }

  // yearly
  for (let i = 0; i < MAX_PERIODS; i++) {
    const year = first.getUTCFullYear() + i;
    const day = Math.min(first.getUTCDate(), daysInMonth(year, first.getUTCMonth()));
    const at = Date.UTC(year, first.getUTCMonth(), day, 12);
    if (at > now || at > end) break;
    out.push({ key: String(year), at });
  }
  return out;
}

export interface CustomCostSweepResult {
  costs: number;
  recorded: number;
}

/**
 * Book every due-but-unbooked period of every active custom cost. Runs with
 * the daily scheduled import and after admin edits; safe to call any time.
 */
export async function sweepCustomCosts(): Promise<CustomCostSweepResult> {
  const [costs, settings] = await Promise.all([listCustomCosts(), getAdminSettings()]);
  const reclaimVat = settings.ops.reclaimVat;
  const now = Date.now();
  let recorded = 0;

  for (const cost of costs) {
    if (!cost.active) continue;
    const periods = duePeriods(cost, now);
    if (periods.length === 0) continue;

    const gross = cost.amount;
    const net = cost.taxRatePct > 0 ? gross / (1 + cost.taxRatePct / 100) : gross;
    const booked = reclaimVat ? net : gross;
    const bookedUsd = await toUsd(booked, cost.currency);

    for (const period of periods) {
      // recordFinanceEvent is idempotent on (kind, ref) — replays are no-ops.
      await recordFinanceEvent({
        category: "ops",
        kind: `custom:${cost.slug}`,
        amountUsd: -bookedUsd,
        currency: cost.currency,
        amount: booked,
        ref: `${cost.id}_${period.key}`,
        at: period.at,
        meta: {
          title: cost.title,
          costId: cost.id,
          period: period.key,
          cadence: cost.cadence,
          gross,
          net: Math.round(net * 100) / 100,
          taxRatePct: cost.taxRatePct,
          bookedAs: reclaimVat ? "net" : "gross",
        },
      });
      recorded++;
    }
  }
  return { costs: costs.length, recorded };
}
