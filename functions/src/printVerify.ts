/**
 * SKU verification: proving a product can actually be printed, per environment.
 *
 * A product's page range is only as good as its endpoints — Lulu rejects a
 * casewrap at 900 pages and a saddle-stitch at 60 just as firmly as it rejects a
 * nonexistent package id. So verification probes BOTH bounds and vouches for the
 * range between them; widening `conditions.pages` later invalidates the record
 * (see `verificationCoversPages`).
 *
 * An inconclusive probe (auth, network, provider outage) writes nothing. A prior
 * verdict is evidence we paid for; an outage must never be able to erase it.
 */
import {
  normalizeProduct,
  type ProductDefinition,
  type ProductsConfig,
  type SkuVerification,
} from "../../books-frontend/src/core/config/products";
import { costVariantKey, enumerateVariants } from "../../books-frontend/src/core/config/variants";
import { skuForVariant } from "../../books-frontend/src/core/fulfillment/lulu/skuAxes";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";
import { mapLimit } from "./concurrency";
import { probeSku, type ProbeOutcome } from "./printProbe";
import { getProductsConfig, saveProductsConfig } from "./products";

export interface VerifyResult {
  productId: string;
  sku: string;
  outcome: ProbeOutcome;
  /** The record written, when the probe was conclusive. */
  record?: SkuVerification;
  /** Why it failed or why we couldn't tell. */
  message?: string;
}

/** Probe one product's page bounds without persisting anything. */
export async function verifyProduct(
  product: ProductDefinition,
  env: FulfillmentEnv,
): Promise<VerifyResult> {
  const base = { productId: product.id, sku: product.provider.sku };
  if (product.provider.id !== "lulu" || !product.provider.sku.trim()) {
    return { ...base, outcome: "inconclusive", message: "Not a print-provider product." };
  }

  const { min, max } = product.conditions.pages;
  // Probe the endpoints only; anything in between is printable if both are.
  const pageCounts = max > min ? [min, max] : [min];

  // The base SKU, then every OTHER print tier × paper the product offers. A
  // customer can pick any of them, and the page range is a property of the paper
  // (thickness) as much as the binding: a variant that prints fewer pages than
  // the product's range would pass checkout and fail at the bindery. Finish is
  // skipped — a cover coating doesn't change what can be bound.
  const targets: { sku: string; label: string }[] = [{ sku: product.provider.sku, label: "" }];
  const seen = new Set<string>([product.provider.sku]);
  const perCost = new Map<string, ReturnType<typeof enumerateVariants>[number]>();
  for (const variant of enumerateVariants(product.variants)) {
    const key = costVariantKey(variant);
    if (!perCost.has(key)) perCost.set(key, variant);
  }
  for (const [key, variant] of perCost) {
    const sku = skuForVariant(product.provider.sku, variant);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    targets.push({ sku, label: key });
  }

  for (const target of targets) {
    for (const pages of pageCounts) {
      const probe = await probeSku({ env, sku: target.sku, pages });
      if (probe.outcome === "inconclusive") {
        return { ...base, outcome: "inconclusive", message: probe.message };
      }
      if (probe.outcome === "rejected") {
        const where = target.label ? ` (variant ${target.label})` : "";
        return {
          ...base,
          outcome: "rejected",
          message: `Rejected at ${pages} pages${where}: ${probe.message ?? "no reason given"}`,
          record: {
            ok: false,
            at: Date.now(),
            pages: { min, max },
            error: `At ${pages} pages${where}: ${probe.message ?? "rejected"}`,
          },
        };
      }
    }
  }

  return { ...base, outcome: "ok", record: { ok: true, at: Date.now(), pages: { min, max } } };
}

/** Merge a verification record into a product without touching other envs. */
export function withVerification(
  product: ProductDefinition,
  env: FulfillmentEnv,
  record: SkuVerification,
): ProductDefinition {
  return normalizeProduct({
    ...product,
    provider: {
      ...product.provider,
      verifiedIn: { ...product.provider.verifiedIn, [env]: record },
    },
  });
}

export interface VerifySummary {
  env: FulfillmentEnv;
  results: VerifyResult[];
  ok: number;
  rejected: number;
  inconclusive: number;
  config: ProductsConfig;
}

/**
 * Verify every print product (or one, by id) against `env` and persist the
 * conclusive results in a single catalog write.
 */
export async function verifyCatalog(env: FulfillmentEnv, productId?: string): Promise<VerifySummary> {
  const config = await getProductsConfig();
  const targets = config.products.filter(
    (p) => p.provider.id === "lulu" && p.provider.sku.trim() && (!productId || p.id === productId),
  );

  // Four at a time: fast enough for a catalog-wide pass without risking the
  // provider's rate limits.
  const results = await mapLimit(targets, 4, (p) => verifyProduct(p, env));

  const byId = new Map(results.filter((r) => r.record).map((r) => [r.productId, r.record!]));
  const products = config.products.map((p) => {
    const record = byId.get(p.id);
    return record ? withVerification(p, env, record) : p;
  });

  const saved = byId.size > 0 ? await saveProductsConfig({ version: 1, products }) : config;

  return {
    env,
    results,
    ok: results.filter((r) => r.outcome === "ok").length,
    rejected: results.filter((r) => r.outcome === "rejected").length,
    inconclusive: results.filter((r) => r.outcome === "inconclusive").length,
    config: saved,
  };
}
