/**
 * A learned map of which `pod_package_id` combinations actually exist.
 *
 * The provider has no catalog endpoint, so the only way to know whether a
 * combination is real is to ask it to price one. Every answer is cached here,
 * per environment, so the SKU builder can show what's already known instead of
 * re-probing — and so a catalog sweep accumulates rather than evaporating.
 *
 * Entries are evidence, not configuration: they record what the provider said
 * and when. Only conclusive answers are stored; an unreachable provider teaches
 * us nothing and must not poison the map.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";
import { probeSku } from "./printProbe";
import { parsePageRange } from "./printCalibrate";

const DOC = "adminSettings/skuMatrix";

export interface SkuMatrixEntry {
  sku: string;
  env: FulfillmentEnv;
  ok: boolean;
  at: number;
  /** Page bounds the provider reported, when it volunteered them. */
  pages?: { min: number; max: number };
  /** Per-unit cost at the probed page count, for a rough comparison. */
  unitCost?: number;
  currency?: string;
  /** The provider's reason when `ok` is false. */
  message?: string;
}

/** Firestore keys can't contain "/", and a SKU never does — safe to concatenate. */
function keyFor(env: FulfillmentEnv, sku: string): string {
  return `${env}:${sku.toUpperCase()}`;
}

export async function readSkuMatrix(): Promise<Record<string, SkuMatrixEntry>> {
  ensureAdmin();
  try {
    const snap = await getFirestore().doc(DOC).get();
    return snap.exists ? ((snap.data() ?? {}) as Record<string, SkuMatrixEntry>) : {};
  } catch {
    return {};
  }
}

async function recordEntry(entry: SkuMatrixEntry): Promise<void> {
  ensureAdmin();
  await getFirestore()
    .doc(DOC)
    .set({ [keyFor(entry.env, entry.sku)]: entry }, { merge: true });
}

export interface CheckSkuResult {
  entry: SkuMatrixEntry;
  /** True when the provider was asked just now rather than read from the cache. */
  fresh: boolean;
}

/**
 * Determine whether a SKU exists, consulting the provider unless a cached
 * verdict is offered and accepted.
 *
 * The page count matters: a valid SKU still gets rejected at a page count it
 * doesn't support, so we probe at a count the binding is likely to allow and
 * then read the true range out of the provider's own error when it disagrees.
 */
export async function checkSku(args: {
  env: FulfillmentEnv;
  sku: string;
  pages?: number;
  /** Skip the cache and re-ask the provider. */
  refresh?: boolean;
}): Promise<CheckSkuResult> {
  const sku = args.sku.trim().toUpperCase();
  if (!args.refresh) {
    const cached = (await readSkuMatrix())[keyFor(args.env, sku)];
    if (cached) return { entry: cached, fresh: false };
  }

  // Discover the supported range first: probing an absurd page count makes the
  // provider name the real bounds, which turns one round trip into both "does
  // this exist" and "what page counts does it take".
  const boundsProbe = await probeSku({ env: args.env, sku, pages: 100_000 });
  const pages = parsePageRange(boundsProbe.message);

  if (!pages) {
    if (boundsProbe.outcome === "inconclusive") {
      // Learned nothing — don't cache, don't condemn.
      return {
        entry: { sku, env: args.env, ok: false, at: Date.now(), message: boundsProbe.message },
        fresh: true,
      };
    }
    if (boundsProbe.outcome === "rejected") {
      // Rejected without naming a page range ⇒ the package itself is unknown.
      const entry: SkuMatrixEntry = { sku, env: args.env, ok: false, at: Date.now(), message: boundsProbe.message };
      await recordEntry(entry);
      return { entry, fresh: true };
    }
  }

  // Either the provider named a range (so the package exists) or it priced even
  // an absurd page count. Price it again inside the known range to capture a
  // cost sample and confirm it end to end.
  const at = pages
    ? args.pages && args.pages >= pages.min && args.pages <= pages.max
      ? args.pages
      : pages.min
    : (args.pages ?? 32);
  const probe = await probeSku({ env: args.env, sku, pages: at });
  const entry: SkuMatrixEntry = {
    sku,
    env: args.env,
    ok: probe.outcome === "ok",
    at: Date.now(),
    ...(pages ? { pages } : {}),
    ...(probe.unitCost != null ? { unitCost: probe.unitCost } : {}),
    ...(probe.currency ? { currency: probe.currency } : {}),
    ...(probe.outcome === "ok" ? {} : { message: probe.message }),
  };
  if (probe.outcome !== "inconclusive") await recordEntry(entry);
  return { entry, fresh: true };
}
