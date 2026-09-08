/**
 * Landing-page print prices, derived from the public catalog.
 *
 * The homepage must not invent numbers. Every "from" amount is the same
 * {@link publicUnitPrice} checkout charges for the shortest book in that
 * binding family, and the member overlay uses the already-clamped
 * `planPrintDiscountPct` so it can only under-promise. Shipping, page
 * brackets and variants stay on `/print-pricing` — this is the starting
 * answer, not the calculator.
 */
import type { Binding } from "../../core/fulfillment";
import type { PublicPlan } from "../../core/config/plans";
import {
  formatSlug,
  offerablePublicProducts,
  type PricingSettings,
  type PublicProduct,
} from "../../core/config/products";
import { publicUnitPrice } from "../../core/config/productMath";
import { trimLabel } from "../pricing/format";

export type PrintFamilyId = "paperback" | "hardcover";

export interface LandingPrintOffer {
  id: PrintFamilyId;
  label: string;
  blurb: string;
  featured: boolean;
  fromPrice: number;
  memberFromPrice: number | null;
  memberDiscountPct: number;
  minPages: number;
  trim: string;
  href: string;
}

export interface LandingEbookOffer {
  price: number;
  printBundleDiscountPct: number;
}

export interface LandingPrintPricing {
  currency: string;
  taxInclusive: boolean;
  print: LandingPrintOffer[];
  memberPlanName: string | null;
  ebook: LandingEbookOffer | null;
}

const FAMILY: Record<
  PrintFamilyId,
  {
    preferred: Binding[];
    bindings: Binding[];
    label: string;
    blurb: string;
    featured: boolean;
  }
> = {
  paperback: {
    // Saddle-stitch (stapled) first so the landing page shows the entry format
    // starting from 4 pages.
    preferred: ["saddle-stitch"],
    bindings: ["saddle-stitch", "perfect-bound", "coil-bound"],
    label: "Paperback",
    blurb: "A flexible printed cover. Light to hold at bedtime.",
    featured: false,
  },
  hardcover: {
    preferred: ["casewrap"],
    bindings: ["casewrap", "linen-wrap"],
    label: "Hardcover",
    blurb: "Artwork printed on a sturdy board cover. The keepsake.",
    featured: true,
  },
};

/** Same rounding checkout uses when applying a plan print discount. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The paid plan whose print discount we overlay on the landing cards.
 *
 * One plan, not every tier: a second member price per card is clutter, and
 * mixing "from $27.99 or $24.99 depending on which club" is the original
 * confusion again. Prefer a badged plan (the one the admin marked as the
 * storefront pick); otherwise the cheapest monthly plan that actually
 * discounts something we sell.
 */
export function pickOverlayPlan(
  plans: readonly PublicPlan[],
  products: readonly PublicProduct[],
): PublicPlan | null {
  const paid = plans.filter((p) => !p.isFree && p.status === "active");
  const withDiscount = paid.filter((p) =>
    products.some((prod) => (prod.planPrintDiscountPct[p.id] ?? 0) > 0),
  );
  if (withDiscount.length === 0) return null;
  const badged = withDiscount.find((p) => p.badges.length > 0);
  if (badged) return badged;
  return [...withDiscount].sort((a, b) => monthlyAmount(a) - monthlyAmount(b))[0] ?? null;
}

function monthlyAmount(plan: PublicPlan): number {
  const currency = plan.prices.USD ? "USD" : Object.keys(plan.prices)[0];
  if (!currency) return Number.POSITIVE_INFINITY;
  const amount = plan.prices[currency]?.month?.amount;
  return typeof amount === "number" ? amount : Number.POSITIVE_INFINITY;
}

function cheapestInFamily(
  products: readonly PublicProduct[],
  family: PrintFamilyId,
  settings: PricingSettings,
  currency: string,
): { product: PublicProduct; pages: number; list: number } | null {
  const pick = (bindings: Binding[]) => {
    const allowed = new Set<string>(bindings);
    let best: { product: PublicProduct; pages: number; list: number } | null = null;
    for (const product of products) {
      if (!allowed.has(product.spec.binding)) continue;
      const pages = product.conditions.pages.min;
      const list = publicUnitPrice(product, settings, { currency, pages });
      if (!(list > 0)) continue;
      if (!best || list < best.list) best = { product, pages, list };
    }
    return best;
  };
  return pick(FAMILY[family].preferred) ?? pick(FAMILY[family].bindings);
}

export function buildLandingPrintPricing(args: {
  products: readonly PublicProduct[];
  settings: PricingSettings;
  plans: readonly PublicPlan[];
}): LandingPrintPricing {
  const products = offerablePublicProducts(args.products);
  const currency = args.settings.baseCurrency;
  const overlay = pickOverlayPlan(args.plans, products);
  const families: PrintFamilyId[] = ["paperback", "hardcover"];
  const print: LandingPrintOffer[] = [];

  for (const id of families) {
    const found = cheapestInFamily(products, id, args.settings, currency);
    if (!found) continue;
    const { product, pages, list } = found;
    const pct = overlay ? Math.max(0, Math.min(100, product.planPrintDiscountPct[overlay.id] ?? 0)) : 0;
    const member = pct > 0 ? round2(list * (1 - pct / 100)) : null;
    const meta = FAMILY[id];
    print.push({
      id,
      label: meta.label,
      blurb: meta.blurb,
      featured: meta.featured,
      fromPrice: list,
      memberFromPrice: member != null && member < list ? member : null,
      memberDiscountPct: member != null && member < list ? pct : 0,
      minPages: pages,
      trim: trimLabel(product.spec.pageTrim),
      href: `/print-pricing/${formatSlug(product.spec)}`,
    });
  }

  const taxInclusive = products.some((p) => p.taxBehavior[currency] === "inclusive");

  const sticker = args.settings.ebook.prices[currency] ?? 0;
  const ebook: LandingEbookOffer | null =
    args.settings.ebook.enabled && sticker > 0
      ? {
          price: sticker,
          printBundleDiscountPct: args.settings.ebook.printBundleDiscountPct,
        }
      : null;

  return {
    currency,
    taxInclusive,
    print,
    memberPlanName: overlay?.name ?? null,
    ebook,
  };
}
