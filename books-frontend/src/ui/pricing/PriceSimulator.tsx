"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Info, Package, Truck } from "lucide-react";
import type { CatalogMediaConfig } from "../../core/config/catalogMedia";
import type { PublicPlan } from "../../core/config/plans";
import {
  formatSlug,
  type PricingSettings,
  type PublicProduct,
} from "../../core/config/products";
import {
  allowedMarketsFor,
  pickTier,
  publicShippingMethodsFor,
  simulatePublicOrder,
} from "../../core/config/productMath";
import {
  firstAllowedVariant,
  normalizeVariantPolicy,
  type VariantSelection,
} from "../../core/config/variants";
import { countryLabel } from "../../core/analytics/markets";
import { bindingNoun } from "../../core/fulfillment";
import type { ShippingMethod } from "../../core/fulfillment/types";
import { VariantPicker } from "../checkout/VariantPicker";
import { Field } from "../components/Input";
import { Select } from "../components/Select";
import { cn } from "../lib/cn";
import { formatMoney, pricingHref, trimLabel } from "./format";

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
   * inside the Studio) so the receipt opens on what they'd actually pay instead
   * of the list price a guest would see. Purely a starting point — the "Price
   * as" rows below remain switchable, so this never turns the comparison into
   * the only number shown.
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
  const [planId, setPlanId] = useState<string | null>(initialPlanId ?? null);

  // Countries and speeds come from the product, so the tool can never quote a
  // route checkout would refuse.
  const countries = useMemo(
    () => (product ? allowedMarketsFor(product.shipping.destinations) : []),
    [product],
  );
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
    const query = next === settings.baseCurrency ? "" : `?currency=${encodeURIComponent(next)}`;
    router.replace(`${pathname}${query}`, { scroll: false });
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
      const preferred = current ?? product?.defaultVariant;
      return firstAllowedVariant(variantPolicy, preferred) ?? null;
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

  // Plans worth offering as a comparison: only ones whose discount this product
  // can actually honour, since the projection has already clamped each to what
  // the price can carry.
  const discountPlans = useMemo(
    () =>
      plans
        .filter((p) => p.status === "active" && (product?.planPrintDiscountPct[p.id] ?? 0) > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [plans, product],
  );

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

  return (
    <div className={cn("grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start", className)}>
      {/* ---- Controls ---- */}
      <div className="space-y-6 rounded-3xl border border-ink-200 bg-white p-5 shadow-soft sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ship to">
            <Select
              options={countries.map((c) => ({ value: c, label: countryLabel(c) }))}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <Select
              options={currencies.map((c) => ({ value: c, label: c }))}
              value={currency}
              onChange={(e) => chooseCurrency(e.target.value)}
            />
          </Field>
        </div>

        {!lockedFormat && products.length > 1 && (
          <fieldset className="space-y-2">
            <legend className="text-[12px] font-semibold text-ink-800">Book format</legend>
            <p className="text-[11px] text-ink-500">
              The page size and how the book is bound. Everything else is a choice you make on top of it.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {products.map((p) => {
                const selected = p.sku === product.sku;
                const from = pickTier(p.priceTiers ?? [], p.conditions.pages.min)?.prices[currency];
                return (
                  <button
                    key={p.sku}
                    type="button"
                    onClick={() => setSku(p.sku)}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-lg px-2.5 py-2 text-left ring-1 ring-inset transition",
                      selected ? "bg-brand-50 ring-brand-300" : "bg-white ring-ink-200 hover:ring-ink-300",
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] font-medium capitalize text-ink-800">
                        {bindingNoun(p.spec.binding)}
                      </span>
                      {from != null && (
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                          from {formatMoney(from, currency)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-500">
                      {trimLabel(p.spec.pageTrim)} · {p.conditions.pages.min}–{p.conditions.pages.max} pages
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* Pages. The slider steps by the binding's own increment, and the tier
            edges are marked: seeing where the price brackets fall is the single
            most useful thing this tool can show. */}
        <fieldset className="space-y-2">
          <legend className="flex w-full items-baseline justify-between gap-2 text-[12px] font-semibold text-ink-800">
            <span>Pages</span>
            <span className="tabular-nums font-normal text-ink-500">{pages}</span>
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
          <div className="flex justify-between text-[10px] tabular-nums text-ink-400">
            <span>{minPages}</span>
            <span>{maxPages}</span>
          </div>
          <PriceBrackets product={product} currency={currency} pages={pages} />
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Copies" hint={`Up to ${maxCopies} per order`}>
            <Select
              options={copyOptions(maxCopies).map((n) => ({ value: String(n), label: String(n) }))}
              value={String(copies)}
              onChange={(e) => setCopies(Number(e.target.value))}
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

        {variant && (
          <VariantPicker
            policy={variantPolicy}
            value={variant}
            onChange={setVariant}
            currency={currency}
            pages={pages}
            media={media}
          />
        )}
      </div>

      {/* ---- Receipt ---- */}
      <div className="lg:sticky lg:top-24">
        <div className="rounded-3xl border border-ink-200 bg-white p-5 shadow-soft">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
            <Package className="size-3.5" /> Your price
          </div>

          {/* `variant` is narrowed alongside the quote: the quote only exists
              when one is resolved, and the plan rows below re-price with it. */}
          {quote && variant ? (
            <>
              <div className="space-y-1.5 text-sm">
                <Row
                  label={`${quote.copies} × ${formatMoney(quote.unitPrice, currency)}`}
                  value={formatMoney(quote.items, currency)}
                />
                {quote.discountPct > 0 && (
                  <p className="text-[11px] text-emerald-600">
                    Includes {quote.discountPct}% member discount (list{" "}
                    {formatMoney(quote.listUnitPrice, currency)} per copy).
                  </p>
                )}
                <Row
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Truck className="size-3.5 text-ink-400" /> Shipping
                    </span>
                  }
                  value={
                    quote.shipping == null
                      ? shippingFallbackText(quote.shippingNote)
                      : quote.shipping === 0
                        ? "Free"
                        : formatMoney(quote.shipping, currency)
                  }
                />
                <div className="my-2 h-px bg-ink-100" />
                <Row
                  label="Total"
                  value={quote.total == null ? "—" : formatMoney(quote.total, currency)}
                  bold
                />
                <p className="pt-1 text-[11px] leading-relaxed text-ink-500">
                  {quote.taxBehavior === "inclusive"
                    ? "Includes VAT where it applies."
                    : "Sales tax, where it applies, is added at checkout."}
                </p>
              </div>

              {discountPlans.length > 0 && (
                <div className="mt-4 border-t border-ink-100 pt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                    Price as
                  </p>
                  <div className="mt-2 space-y-1">
                    <PlanRow
                      label="No subscription"
                      selected={planId === null}
                      onSelect={() => setPlanId(null)}
                      product={product}
                      settings={settings}
                      scenario={{ currency, pages, copies, variant, country, method }}
                      planId={null}
                    />
                    {discountPlans.map((plan) => (
                      <PlanRow
                        key={plan.id}
                        label={plan.name}
                        note={`${product.planPrintDiscountPct[plan.id]}% off`}
                        selected={planId === plan.id}
                        onSelect={() => setPlanId(plan.id)}
                        product={product}
                        settings={settings}
                        scenario={{ currency, pages, copies, variant, country, method }}
                        planId={plan.id}
                      />
                    ))}
                  </div>
                </div>
              )}

              <Link
                href="/studio"
                className="mt-5 flex w-full items-center justify-center rounded-2xl bg-brand-600 px-5 py-3 text-sm font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700"
              >
                Start your book
              </Link>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
                <Info className="mt-px size-3.5 shrink-0" />
                {quote.shippingNote === "estimated"
                  ? "The book price is exact. Shipping to this destination is an estimate until the carrier quotes your address at checkout."
                  : "The book price is exact. Shipping is confirmed against a live carrier quote at checkout."}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-500">Choose a format to see pricing.</p>
          )}
        </div>

        {!lockedFormat && (
          <p className="mt-3 px-1 text-[11px] text-ink-400">
            Looking at one format?{" "}
            <Link
              href={pricingHref(
                `/print-pricing/${formatSlug(product.spec)}`,
                currency,
                settings.baseCurrency,
              )}
              className="underline decoration-ink-300 underline-offset-2 hover:text-ink-600"
            >
              See {bindingNoun(product.spec.binding)} pricing in detail
            </Link>
            .
          </p>
        )}
      </div>
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
  bold,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={bold ? "font-semibold text-ink-800" : "text-ink-600"}>{label}</span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          bold ? "text-base font-semibold text-ink-900" : "text-ink-700",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** One selectable buyer context, with the total that buyer would pay. */
function PlanRow({
  label,
  note,
  selected,
  onSelect,
  product,
  settings,
  scenario,
  planId,
}: {
  label: string;
  note?: string;
  selected: boolean;
  onSelect: () => void;
  product: PublicProduct;
  settings: PricingSettings;
  scenario: {
    currency: string;
    pages: number;
    copies: number;
    variant: VariantSelection;
    country: string;
    method: ShippingMethod | "";
  };
  planId: string | null;
}) {
  const quote = simulatePublicOrder(product, settings, {
    currency: scenario.currency,
    pages: scenario.pages,
    copies: scenario.copies,
    variant: scenario.variant,
    destinationCountry: scenario.country || undefined,
    shippingMethod: (scenario.method as ShippingMethod) || undefined,
    planId,
  });
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-baseline justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] ring-1 ring-inset transition",
        selected ? "bg-brand-50 ring-brand-300" : "bg-white ring-ink-200 hover:ring-ink-300",
      )}
    >
      <span className="min-w-0 truncate text-ink-700">
        {label}
        {note && <span className="ml-1.5 text-emerald-600">{note}</span>}
      </span>
      <span className="shrink-0 tabular-nums font-medium text-ink-900">
        {quote.total == null
          ? formatMoney(quote.items, scenario.currency)
          : formatMoney(quote.total, scenario.currency)}
      </span>
    </button>
  );
}

/**
 * The page brackets this format is priced in, with the active one marked.
 *
 * Shown because it answers the question the slider provokes. A customer who
 * watches the total stay flat from 64 to 80 pages and then jump assumes
 * something is broken; one who can see the brackets understands they have
 * headroom to fill, which is both true and useful.
 */
function PriceBrackets({
  product,
  currency,
  pages,
}: {
  product: PublicProduct;
  currency: string;
  pages: number;
}) {
  const tiers = (product.priceTiers ?? []).filter((t) => (t.prices[currency] ?? 0) > 0);
  if (tiers.length <= 1) return null;
  const active = pickTier(tiers, pages);
  const { min, max } = product.conditions.pages;
  return (
    <ul className="mt-1 space-y-0.5">
      {tiers.map((t) => {
        const from = Math.max(min, t.minPages);
        const to = Math.min(max, t.maxPages);
        if (from > to) return null;
        const isActive = t === active;
        return (
          <li
            key={`${t.minPages}-${t.maxPages}`}
            className={cn(
              "flex items-baseline justify-between gap-2 rounded px-1.5 py-0.5 text-[11px] tabular-nums",
              isActive ? "bg-brand-50 font-medium text-ink-800" : "text-ink-500",
            )}
          >
            <span>
              {from}–{to} pages
            </span>
            <span>{formatMoney(t.prices[currency], currency)} per copy</span>
          </li>
        );
      })}
    </ul>
  );
}
