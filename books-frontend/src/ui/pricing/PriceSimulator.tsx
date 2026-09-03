"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CatalogMediaConfig } from "../../core/config/catalogMedia";
import type { PublicPlan } from "../../core/config/plans";
import {
  type PricingSettings,
  type PublicProduct,
} from "../../core/config/products";
import {
  publicMarketsFor,
  publicShippingMethodsFor,
  simulatePublicOrder,
} from "../../core/config/productMath";
import {
  normalizeVariantPolicy,
  simplifiedPrintVariant,
  type VariantSelection,
} from "../../core/config/variants";
import { countryLabel } from "../../core/analytics/markets";
import { bindingNoun } from "../../core/fulfillment";
import type { Binding, ShippingMethod } from "../../core/fulfillment/types";
import { VariantPicker } from "../checkout/VariantPicker";
import { Field } from "../components/Input";
import { Select } from "../components/Select";
import { cn } from "../lib/cn";
import { formatMoney, trimLabel } from "./format";

/** Fallback labels for shipping speeds a product hasn't renamed. */
const SHIPPING_LABEL: Record<ShippingMethod, string> = {
  Budget: "Budget (slowest, cheapest)",
  Standard: "Standard",
  StandardPlus: "Standard Plus",
  Express: "Express",
  Overnight: "Overnight (fastest)",
};

/**
 * The public print-price simulator: pick a format, a length, a print spec and a
 * destination, and see the real number.
 *
 * Every price here is computed from the world-readable catalog projection by
 * {@link simulatePublicOrder} — the same page-tier table, variant deltas and
 * rounding rules checkout charges from. That's what makes this honest rather than
 * indicative: the book price is exact, and shipping is the measured rate labelled
 * as the estimate it is (checkout confirms it against a live carrier quote).
 *
 * Guests reach this without an account on purpose. Being able to find out what
 * something costs before signing up is the whole point.
 */
export function PriceSimulator({
  products,
  settings,
  plans,
  media,
  currency: initialCurrency,
  planId: initialPlanId,
  /** Pin the tool to one format (the per-format pages) instead of offering the choice. */
  lockedFormat,
  className,
}: {
  products: PublicProduct[];
  settings: PricingSettings;
  plans: PublicPlan[];
  media: CatalogMediaConfig;
  /**
   * The currency the surrounding page was rendered in. Owned by the page rather
   * than by this component because the static tables beside it are server-rendered
   * — a currency held only in local state would leave the tool reading in euros
   * next to a table still priced in dollars.
   */
  currency: string;
  /**
   * Preselect a buyer's own plan (from `?plan=`, typically a deep link from
   * inside the Studio) so the quote includes their real member price. Guests see
   * the standard price; hypothetical plan switching does not belong in a print
   * quote because it hides the recurring membership cost.
   */
  planId?: string | null;
  lockedFormat?: PublicProduct;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sku, setSku] = useState(lockedFormat?.sku ?? products[0]?.sku ?? "");
  const product = useMemo(
    () => (lockedFormat ?? products.find((p) => p.sku === sku) ?? products[0]),
    [lockedFormat, products, sku],
  );

  const currencies = useMemo(
    () => (product?.supportedCurrencies?.length ? product.supportedCurrencies : settings.currencies),
    [product, settings.currencies],
  );
  // Mirrored in local state as well as the URL: the receipt has to re-price the
  // instant the reader picks a currency, and waiting for the server round trip
  // that repaints the tables would make the control feel broken.
  const [currency, setCurrency] = useState(initialCurrency);
  const [country, setCountry] = useState("");
  const [copies, setCopies] = useState(1);
  const [pages, setPages] = useState(product?.conditions.pages.min ?? 24);
  const [method, setMethod] = useState<ShippingMethod | "">("");
  const planId = initialPlanId ?? null;

  // Countries and speeds come from the product, so the tool can never quote a
  // route checkout would refuse.
  const countries = useMemo(() => (product ? publicMarketsFor(product) : []), [product]);
  const methods = useMemo(
    () => (product ? publicShippingMethodsFor(product, country) : []),
    [product, country],
  );

  const variantPolicy = useMemo(
    () =>
      product
        ? normalizeVariantPolicy(product.variants, product.defaultVariant)
        : normalizeVariantPolicy(undefined),
    [product],
  );
  const [variant, setVariant] = useState<VariantSelection | null>(null);

  // Every selection below is bounded by the product, and switching products can
  // invalidate any of them: a new format has its own page range, its own markets
  // and its own variant policy. Each effect re-anchors one of them rather than
  // resetting the whole form, so changing binding keeps the length and the
  // destination whenever the new format can still honour them.
  useEffect(() => {
    if (!currencies.includes(currency)) setCurrency(currencies[0] ?? "USD");
  }, [currencies, currency]);

  /**
   * Switch currency here and on the server-rendered tables at once.
   *
   * The query parameter is what the page reads to price its static content, so
   * putting the choice there is what keeps one page from quoting two currencies.
   * It also makes a currency shareable — `?currency=EUR` is a link someone can
   * send. `replace` rather than `push` so flicking between currencies doesn't
   * bury the back button under a dozen entries; the canonical URL in
   * `generateMetadata` deliberately omits the parameter, so search engines see
   * one page rather than one per currency.
   */
  const chooseCurrency = (next: string) => {
    setCurrency(next);
    const query = new URLSearchParams();
    if (next !== settings.baseCurrency) query.set("currency", next);
    if (planId) query.set("plan", planId);
    const serialized = query.toString();
    const suffix = serialized ? `?${serialized}` : "";
    router.replace(`${pathname}${suffix}`, { scroll: false });
  };

  useEffect(() => {
    if (countries.length > 0 && !countries.includes(country)) setCountry(countries[0]);
  }, [countries, country]);

  useEffect(() => {
    if (methods.length > 0 && !methods.includes(method as ShippingMethod)) setMethod(methods[0]);
  }, [methods, method]);

  useEffect(() => {
    if (!product) return;
    const { min, max, step } = product.conditions.pages;
    setPages((current) => {
      const clamped = Math.min(max, Math.max(min, current));
      // Snap onto the binding's own step, measured from its minimum: a bindery
      // that works in fours cannot make a 26-page book.
      const snapped = min + Math.round((clamped - min) / step) * step;
      return Math.min(max, Math.max(min, snapped));
    });
  }, [product]);

  useEffect(() => {
    setVariant((current) => {
      const finish = current?.finish ?? product?.defaultVariant?.finish;
      return simplifiedPrintVariant(variantPolicy, finish) ?? null;
    });
  }, [variantPolicy, product]);

  const maxCopies = product?.conditions.copies.max ?? 100;

  const quote = useMemo(
    () =>
      product && variant
        ? simulatePublicOrder(product, settings, {
            currency,
            pages,
            copies,
            variant,
            destinationCountry: country || undefined,
            shippingMethod: (method as ShippingMethod) || undefined,
            planId,
          })
        : null,
    [product, settings, currency, pages, copies, variant, country, method, planId],
  );

  const currentPlan = plans.find((plan) => plan.id === planId) ?? null;

  // If active paid plans offer a print discount on this product, compute the best member quote
  const memberOffer = useMemo(() => {
    if (!product || !variant) return null;
    const candidates = plans
      .filter((p) => !p.isFree && p.status === "active" && (product.planPrintDiscountPct[p.id] ?? 0) > 0)
      .map((p) => {
        const pct = product.planPrintDiscountPct[p.id] ?? 0;
        const memberQuote = simulatePublicOrder(product, settings, {
          currency,
          pages,
          copies,
          variant,
          destinationCountry: country || undefined,
          shippingMethod: (method as ShippingMethod) || undefined,
          planId: p.id,
        });
        return { plan: p, pct, quote: memberQuote };
      })
      .sort((a, b) => b.pct - a.pct);

    return candidates[0] ?? null;
  }, [product, variant, plans, settings, currency, pages, copies, country, method]);

  if (!product) {
    return (
      <p className={cn("rounded-2xl border border-ink-200 bg-white p-6 text-sm text-ink-500", className)}>
        Our print catalog is being updated. Please check back shortly.
      </p>
    );
  }

  const { min: minPages, max: maxPages, step: pageStep } = product.conditions.pages;
  const shippingMethodOptions = methods.map((m) => ({
    value: m,
    label: product.shipping.methods.find((x) => x.method === m)?.label || SHIPPING_LABEL[m] || m,
  }));

  const trimOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: { key: string; label: string }[] = [];
    for (const p of products) {
      const key = trimKey(p.spec.pageTrim);
      if (!seen.has(key)) {
        seen.add(key);
        const shape = p.spec.orientation ? `${capitalize(p.spec.orientation)} · ` : "";
        list.push({
          key,
          label: `${shape}${trimLabel(p.spec.pageTrim)}`,
        });
      }
    }
    return list;
  }, [products]);

  const currentTrimKey = product ? trimKey(product.spec.pageTrim) : (trimOptions[0]?.key ?? "");

  const availableBindingsForTrim = useMemo(() => {
    if (!currentTrimKey) return [];
    return products.filter((p) => trimKey(p.spec.pageTrim) === currentTrimKey);
  }, [products, currentTrimKey]);

  const bindingOptions = useMemo(() => {
    return availableBindingsForTrim.map((p) => ({
      value: p.spec.binding,
      label: capitalize(bindingNoun(p.spec.binding)),
    }));
  }, [availableBindingsForTrim]);

  const handleTrimChange = (nextTrimKey: string) => {
    const matchingTrimProducts = products.filter((p) => trimKey(p.spec.pageTrim) === nextTrimKey);
    if (matchingTrimProducts.length === 0) return;
    const currentBinding = product?.spec.binding;
    const sameBindingProduct = matchingTrimProducts.find((p) => p.spec.binding === currentBinding);
    const targetProduct = sameBindingProduct ?? matchingTrimProducts[0];
    setSku(targetProduct.sku);
  };

  const handleBindingChange = (nextBinding: string) => {
    const targetProduct = availableBindingsForTrim.find((p) => p.spec.binding === nextBinding);
    if (targetProduct) {
      setSku(targetProduct.sku);
    }
  };

  const availableCopies = copyOptions(maxCopies);
  const copyIndex = Math.max(0, availableCopies.indexOf(copies));
  const changeCopies = (direction: -1 | 1) => {
    const next = availableCopies[copyIndex + direction];
    if (next != null) setCopies(next);
  };

  return (
    <div
      className={cn(
        "mx-auto max-w-4xl overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-soft",
        className,
      )}
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-6 p-6 sm:p-8">
          {!lockedFormat && products.length > 1 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Size">
                <Select
                  options={trimOptions.map((t) => ({ value: t.key, label: t.label }))}
                  value={currentTrimKey}
                  onChange={(e) => handleTrimChange(e.target.value)}
                />
              </Field>
              <Field label="Binding">
                <Select
                  options={bindingOptions}
                  value={product.spec.binding}
                  onChange={(e) => handleBindingChange(e.target.value)}
                  disabled={bindingOptions.length <= 1}
                />
              </Field>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="flex w-full items-baseline justify-between gap-3 text-sm font-medium text-ink-700">
              <span>Pages</span>
              <span className="tabular-nums text-ink-500">{pages}</span>
            </legend>
            <input
              type="range"
              min={minPages}
              max={maxPages}
              step={pageStep}
              value={pages}
              onChange={(e) => setPages(Number(e.target.value))}
              aria-label="Number of interior pages"
              className="w-full accent-brand-600"
            />
            <div className="flex justify-between text-xs tabular-nums text-ink-400">
              <span>{minPages}</span>
              <span>{maxPages}</span>
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Copies">
              <div className="flex h-11 items-center justify-between rounded-xl2 ring-1 ring-inset ring-ink-200">
                <button
                  type="button"
                  onClick={() => changeCopies(-1)}
                  disabled={copyIndex === 0}
                  aria-label="Fewer copies"
                  className="flex h-full w-11 items-center justify-center rounded-l-xl2 text-lg text-ink-500 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  −
                </button>
                <span className="tabular-nums text-sm font-medium text-ink-800">{copies}</span>
                <button
                  type="button"
                  onClick={() => changeCopies(1)}
                  disabled={copyIndex >= availableCopies.length - 1}
                  aria-label="More copies"
                  className="flex h-full w-11 items-center justify-center rounded-r-xl2 text-lg text-ink-500 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </Field>
            <Field label="Deliver to">
              <Select
                options={countries.map((c) => ({ value: c, label: countryLabel(c) }))}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </Field>
          </div>

          {variant && (
            <VariantPicker
              policy={variantPolicy}
              value={variant}
              onChange={(next) =>
                setVariant(simplifiedPrintVariant(variantPolicy, next.finish) ?? variant)
              }
              currency={currency}
              pages={pages}
              media={media}
              visibleAxes={["finish"]}
            />
          )}

          <details className="border-t border-ink-100 pt-5">
            <summary className="cursor-pointer text-sm font-medium text-ink-600 hover:text-ink-900">
              Advanced options
            </summary>
            <div className="mt-5 space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Currency">
                  <Select
                    options={currencies.map((c) => ({ value: c, label: c }))}
                    value={currency}
                    onChange={(e) => chooseCurrency(e.target.value)}
                  />
                </Field>
                <Field label="Delivery speed">
                  <Select
                    options={shippingMethodOptions}
                    value={method}
                    onChange={(e) => setMethod(e.target.value as ShippingMethod)}
                    disabled={shippingMethodOptions.length === 0}
                  />
                </Field>
              </div>
            </div>
          </details>
        </div>

        <div className="border-t border-ink-100 bg-ink-50/50 p-6 sm:p-8 lg:border-l lg:border-t-0">
          {quote && variant ? (
            <div className="flex h-full flex-col">
              <p className="text-sm font-medium text-ink-600">Estimated total</p>
              <p className="mt-2 font-display text-4xl font-bold tracking-tight text-ink-900">
                {formatMoney(quote.total ?? quote.items, currency)}
              </p>
              <p className="mt-1 text-sm text-ink-500">
                {quote.total == null
                  ? "Plus delivery, confirmed at checkout"
                  : `For ${quote.copies} ${quote.copies === 1 ? "copy" : "copies"}, including delivery`}
              </p>

              <details className="mt-6 border-y border-ink-200 py-3 text-sm">
                <summary className="cursor-pointer font-medium text-ink-600 hover:text-ink-900">
                  Price details
                </summary>
                <div className="mt-3 space-y-2">
                  <Row
                    label={`${quote.copies} × ${formatMoney(quote.unitPrice, currency)}`}
                    value={formatMoney(quote.items, currency)}
                  />
                  <Row
                    label="Delivery"
                    value={
                      quote.shipping == null
                        ? shippingFallbackText(quote.shippingNote)
                        : quote.shipping === 0
                          ? "Free"
                          : formatMoney(quote.shipping, currency)
                    }
                  />
                  {quote.discountPct > 0 ? (
                    <p className="text-xs leading-relaxed text-emerald-700">
                      Includes your {quote.discountPct}% {currentPlan?.name ?? "member"} print discount.
                    </p>
                  ) : memberOffer ? (
                    <p className="text-xs leading-relaxed text-ink-600">
                      With {memberOffer.plan.name} membership ({memberOffer.pct}% off books), this total is{" "}
                      <span className="font-semibold text-ink-900">
                        {formatMoney(memberOffer.quote.total ?? memberOffer.quote.items, currency)}
                      </span>
                      .
                    </p>
                  ) : null}
                  <p className="text-xs leading-relaxed text-ink-500">
                    {quote.taxBehavior === "inclusive"
                      ? "Includes VAT where it applies."
                      : "Sales tax, where it applies, is added at checkout."}
                  </p>
                </div>
              </details>

              <Link
                href="/studio"
                className="mt-6 flex w-full items-center justify-center rounded-2xl bg-brand-600 px-5 py-3 text-sm font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700"
              >
                Start making your book
              </Link>
              <p className="mt-3 text-center text-xs leading-relaxed text-ink-500">
                No purchase is required until you order.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-500">Choose a format to see pricing.</p>
          )}
        </div>
      </div>

      {memberOffer && (
        <p className="border-t border-ink-100 bg-brand-50/40 px-6 py-3.5 text-center text-xs leading-relaxed text-ink-600 sm:px-8">
          {quote && quote.discountPct > 0 ? (
            <span>
              Your {quote.discountPct}% {currentPlan?.name ?? "member"} print discount is applied to this order.
            </span>
          ) : (
            <span>
              Members pay{" "}
              <span className="font-semibold text-ink-900">
                {formatMoney(memberOffer.quote.total ?? memberOffer.quote.items, currency)}
              </span>{" "}
              for this order ({memberOffer.pct}% off with {memberOffer.plan.name}).{" "}
              <Link href="/#pricing" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
                See membership plans
              </Link>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Copy counts to offer. A short ladder rather than a free number field: the
 * measured shipping rates are fitted over ordinary quantities, and a carrier
 * stops quoting its cheapest service on a big enough pallet — so a simulator
 * that let someone ask about 500 copies would answer with a straight-line
 * extrapolation nobody has verified.
 */
function copyOptions(max: number): number[] {
  return [1, 2, 3, 4, 5, 10, 15, 20, 25].filter((n) => n <= max);
}

/** What to show where a shipping amount would go, when there isn't one. */
function shippingFallbackText(note: string): string {
  if (note === "unavailable") return "Not available";
  return "Quoted at checkout";
}

function Row({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-600">{label}</span>
      <span className="shrink-0 tabular-nums text-ink-700">{value}</span>
    </div>
  );
}

function trimKey(trim: { width: number; height: number; unit?: string }): string {
  return `${trim.width}x${trim.height}${trim.unit ?? "in"}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
