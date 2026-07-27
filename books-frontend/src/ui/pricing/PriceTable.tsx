/**
 * The static, server-rendered price table.
 *
 * A slider is invisible to a crawler and to anyone whose JavaScript hasn't
 * loaded yet, so the simulator alone would make this page look empty to both. The
 * numbers here are the same ones {@link simulatePublicOrder} computes, rendered
 * as plain HTML: real content for search engines, a usable answer without
 * JavaScript, and a printable overview for someone comparing formats.
 *
 * A server component on purpose — no hooks, no interactivity, no client bundle.
 */
import Link from "next/link";
import {
  formatSlug,
  type PricingSettings,
  type PublicProduct,
} from "../../core/config/products";
import { publicUnitPrice } from "../../core/config/productMath";
import { countryLabel } from "../../core/analytics/markets";
import { bindingNoun } from "../../core/fulfillment";
import { formatMoney, pricingHref, samplePageCounts, sharedPageColumns, trimLabel } from "./format";

/**
 * Per-copy prices for one format across a spread of lengths.
 *
 * Prices are for a single copy of the base specification — the variant each
 * product's own tier price is quoted for — so the column headings mean the same
 * thing on every row. Upgrades are priced per page and belong to the simulator,
 * where the length is known.
 */
export function PriceTable({
  products,
  settings,
  currency,
  linkFormats = true,
}: {
  products: PublicProduct[];
  settings: PricingSettings;
  currency: string;
  /** Link each row to its own page (off when already on one). */
  linkFormats?: boolean;
}) {
  if (products.length === 0) return null;

  // One shared set of column lengths, so a reader can compare across formats
  // instead of across two differently-scaled tables. A single format gets its own
  // even spread; several get bracket edges scored by coverage, which is what keeps
  // the columns meaningful when the catalog mixes a 48-page booklet with an
  // 800-page paperback.
  const lengths =
    products.length === 1
      ? samplePageCounts(products[0].conditions.pages, 4)
      : sharedPageColumns(products, 4);

  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-200 bg-white">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Price per copy by book format and page count, in {currency}.
        </caption>
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50/60">
            <th scope="col" className="px-4 py-3 font-semibold text-ink-700">
              Format
            </th>
            {lengths.map((n) => (
              <th
                key={n}
                scope="col"
                className="px-4 py-3 text-right font-semibold tabular-nums text-ink-700"
              >
                {n} pages
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const slug = formatSlug(p.spec);
            const name = `${bindingNoun(p.spec.binding)}, ${trimLabel(p.spec.pageTrim)}`;
            return (
              <tr key={p.sku} className="border-b border-ink-100 last:border-0">
                <th scope="row" className="px-4 py-3 font-medium text-ink-800">
                  {linkFormats ? (
                    <Link
                      href={pricingHref(`/print-pricing/${slug}`, currency, settings.baseCurrency)}
                      className="capitalize underline decoration-ink-300 underline-offset-2 hover:text-brand-700"
                    >
                      {name}
                    </Link>
                  ) : (
                    <span className="capitalize">{name}</span>
                  )}
                  <span className="mt-0.5 block text-[11px] font-normal text-ink-500">
                    {p.conditions.pages.min}–{p.conditions.pages.max} pages, in{" "}
                    {p.conditions.pages.step}s
                  </span>
                </th>
                {lengths.map((n) => {
                  const fits = n >= p.conditions.pages.min && n <= p.conditions.pages.max;
                  return (
                    <td key={n} className="px-4 py-3 text-right tabular-nums text-ink-700">
                      {fits ? (
                        formatMoney(publicUnitPrice(p, settings, { currency, pages: n }), currency)
                      ) : (
                        <span className="text-ink-300" title={`${bindingNoun(p.spec.binding)} doesn't take ${n} pages`}>
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Charged shipping per destination for one format, as plain HTML.
 *
 * Published from the measured rate matrix, so it also states where a speed
 * simply isn't offered — which is a more useful thing to read before ordering
 * than after.
 */
export function ShippingTable({
  product,
  currency,
  copies = 1,
}: {
  product: PublicProduct;
  currency: string;
  copies?: number;
}) {
  const rates = product.shipping.rates.filter((r) => r.charged[currency] || !r.available);
  if (rates.length === 0) return null;

  const countries = [...new Set(rates.map((r) => r.country))];
  const methods = [...new Set(rates.map((r) => r.method))];
  const labelFor = (method: string) =>
    product.shipping.methods.find((m) => m.method === method)?.label || method;

  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-200 bg-white">
      <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Shipping charged for {copies === 1 ? "one copy" : `${copies} copies`} by destination and
          delivery speed, in {currency}.
        </caption>
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50/60">
            <th scope="col" className="px-4 py-3 font-semibold text-ink-700">
              Destination
            </th>
            {methods.map((m) => (
              <th key={m} scope="col" className="px-4 py-3 text-right font-semibold text-ink-700">
                {labelFor(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {countries.map((country) => (
            <tr key={country} className="border-b border-ink-100 last:border-0">
              <th scope="row" className="px-4 py-3 font-medium text-ink-800">
                {countryLabel(country)}
              </th>
              {methods.map((m) => {
                const rate = rates.find((r) => r.country === country && r.method === m);
                const terms = rate?.charged[currency];
                return (
                  <td key={m} className="px-4 py-3 text-right tabular-nums text-ink-700">
                    {!rate || !rate.available ? (
                      <span className="text-ink-400">Not offered</span>
                    ) : !terms ? (
                      <span className="text-ink-400">At checkout</span>
                    ) : terms.base + terms.perCopy * copies === 0 ? (
                      "Free"
                    ) : (
                      formatMoney(terms.base + terms.perCopy * copies, currency)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}