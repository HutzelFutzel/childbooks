"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Field } from "../../components/Input";
import { Select } from "../../components/Select";
import { Slider } from "../../components/Slider";
import { useAppConfigStore } from "../../../state/appConfigStore";
import type { ProductDefinition } from "../../../core/config/products";
import {
  buyerContextsFromPublicPlans,
  catalogDiscountImpacts,
  storewideSafeDiscount,
  DISCOUNT_ITEM_LABELS,
  NEUTRAL_BUYER,
  type DiscountImpact,
} from "../../../core/config/discountImpact";
import { useAdminTab } from "../adminTabStore";
import { ConfigHealthPanel } from "./ConfigHealthPanel";
import { NumberField, Section, TabIntro, fmtMoney } from "./products/parts";

/**
 * **Discount planner** — the sale-simulation dashboard. Every sellable item
 * (print books, the digital edition, Spark packs, memberships) is run through
 * the shared discount-impact engine, so the admin can see, per item and
 * currency: the full money waterfall at any discount (via the slider), the
 * break-even discount, and the "safe max" discount that still holds the
 * configured margin floor.
 *
 * Numbers are BUYER-AWARE: plan perks (print discounts, member ebook prices,
 * Spark action multipliers) change an item's economics, so by default every
 * row shows its most expensive eligible buyer — a sale that survives the worst
 * case survives everyone. A buyer picker re-prices the catalog from one
 * specific plan's perspective. Purely advisory — nothing here changes a price.
 */
export function DiscountPlannerTab() {
  const settings = useAppConfigStore((s) => s.pricingSettings);
  const sparks = useAppConfigStore((s) => s.sparks);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const loadAdminProducts = useAppConfigStore((s) => s.loadAdminProducts);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);

  // Full product definitions (incl. cost models) — the public projection has
  // no cost internals, so print rows need the admin catalog.
  const [products, setProducts] = useState<ProductDefinition[]>([]);
  const [productsFailed, setProductsFailed] = useState(false);
  useEffect(() => {
    void loadAdminProducts()
      .then((config) => setProducts(config.products))
      .catch(() => setProductsFailed(true));
  }, [loadAdminProducts]);

  const [currency, setCurrency] = useState(settings.baseCurrency);
  const cur = settings.currencies.includes(currency) ? currency : settings.baseCurrency;
  const [discount, setDiscount] = useState(() => Math.round(settings.maxDiscountPct));
  // "worst" | "none" (no membership) | a plan id.
  const [buyerId, setBuyerId] = useState("worst");

  const buyers = useMemo(() => buyerContextsFromPublicPlans(plans, settings), [plans, settings]);
  const buyer = useMemo(() => {
    if (buyerId === "worst") return "worst" as const;
    if (buyerId === "none") return NEUTRAL_BUYER;
    return buyers.find((b) => b.planId === buyerId) ?? ("worst" as const);
  }, [buyerId, buyers]);

  const impacts = useMemo(
    () => catalogDiscountImpacts({ settings, sparks, products, plans, currency: cur, buyer }),
    [settings, sparks, products, plans, cur, buyer],
  );
  const storewide = storewideSafeDiscount(impacts);
  const losing = impacts.filter((i) => i.atDiscount(discount).netProfit < 0);

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            The margin floor and the assumed Spark spend rate behind these numbers are set under{" "}
            <span className="font-medium">Financial settings</span>; prices themselves are edited in
            the <span className="font-medium">Catalog</span> and <span className="font-medium">Memberships</span>.
          </>
        }
        links={[{ label: "Financial settings", onClick: () => setConfigTab("financial") }]}
      >
        Planning a sale? Move the slider to see exactly what a discount does to every product&apos;s
        profit — after production cost, Spark backing, processor fees and tax. Each item also shows
        its <span className="font-medium">break-even</span> (discount where profit hits zero) and its{" "}
        <span className="font-medium">safe max</span> (deepest discount that still keeps a{" "}
        {settings.minMarginPct}% margin).
      </TabIntro>

      <ConfigHealthPanel settings={settings} sparks={sparks} products={products} plans={plans} />

      <Section
        title="Simulate a sale"
        hint="The discount applies to the item price (shipping is never discounted). Pick a currency to check each market — fixed processor fees and tax behavior differ per currency."
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-64 flex-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-600">Discount</span>
              <span className="text-sm font-bold text-brand-700">{discount}% off</span>
            </div>
            <Slider value={discount} min={0} max={100} step={1} onValueChange={setDiscount} />
          </div>
          <NumberField
            label="Exact %"
            value={discount}
            step="1"
            suffix="%"
            className="w-28"
            onChange={(n) => setDiscount(Math.round(Math.min(100, Math.max(0, n))))}
          />
          <Field label="Currency" className="w-28">
            <Select
              value={cur}
              options={settings.currencies.map((c) => ({ value: c, label: c }))}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </Field>
          <Field label="Buyer" className="w-56">
            <Select
              value={buyerId}
              options={[
                { value: "worst", label: "Worst case per item" },
                { value: "none", label: "No membership" },
                ...buyers
                  .filter((b) => b.planId != null)
                  .map((b) => ({ value: b.planId!, label: `${b.planName} member` })),
              ]}
              onChange={(e) => setBuyerId(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-[11px] text-ink-400">
          Plan perks (print discounts, member ebook prices, Spark multipliers) change each item&apos;s
          real margin. &ldquo;Worst case per item&rdquo; prices every row for its most expensive
          eligible buyer — a sale that survives that survives everyone. Membership rows are always
          priced from their own subscribers.
        </p>

        {storewide && (
          <div
            className={
              discount > storewide.pct
                ? "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                : "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
            }
          >
            <span className="font-semibold">
              Safe storewide sale: up to {storewide.pct}% off.
            </span>{" "}
            Limited by {storewide.limitedBy.itemLabel} (
            {DISCOUNT_ITEM_LABELS[storewide.limitedBy.itemType].toLowerCase()}).{" "}
            {discount > storewide.pct
              ? losing.length > 0
                ? `At ${discount}% off, ${losing.length} item${losing.length === 1 ? " sells" : "s sell"} at a loss: ${losing.map((i) => i.itemLabel).join(", ")}.`
                : `At ${discount}% off some items drop below your ${settings.minMarginPct}% margin floor.`
              : `${discount}% off keeps every item at or above the ${settings.minMarginPct}% margin floor.`}
          </div>
        )}
      </Section>

      <Section
        title={`Impact at ${discount}% off (${cur})`}
        hint="Click a row for the full money waterfall. “Safe max” holds your margin floor; between safe max and break-even you still profit but below the floor; past break-even you pay customers to buy."
      >
        {impacts.length === 0 ? (
          <p className="text-xs text-ink-400">
            Nothing to simulate yet — no active products, packs or plans priced in {cur}.
            {productsFailed && " (Print products could not be loaded.)"}
          </p>
        ) : (
          <ImpactTable impacts={impacts} discount={discount} minMarginPct={settings.minMarginPct} />
        )}
        {productsFailed && impacts.length > 0 && (
          <p className="text-[11px] text-amber-700">
            Print products could not be loaded — only the digital edition, packs and plans are shown.
          </p>
        )}
      </Section>
    </div>
  );
}

function ImpactTable({
  impacts,
  discount,
  minMarginPct,
}: {
  impacts: DiscountImpact[];
  discount: number;
  minMarginPct: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="bg-ink-50/70 text-left text-[11px] uppercase tracking-wide text-ink-400">
            <th className="px-3 py-2 font-semibold">Item</th>
            <th className="px-3 py-2 font-semibold">List price</th>
            <th className="px-3 py-2 font-semibold">Sale price</th>
            <th className="px-3 py-2 font-semibold">Net profit</th>
            <th className="px-3 py-2 font-semibold">Margin</th>
            <th className="px-3 py-2 font-semibold">Break-even</th>
            <th className="px-3 py-2 font-semibold">Safe max</th>
            <th className="px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {impacts.map((impact) => {
            const key = `${impact.itemType}:${impact.itemId}`;
            const wf = impact.atDiscount(discount);
            const open = openId === key;
            const status =
              wf.netProfit < 0
                ? { label: "LOSS", cls: "bg-rose-100 text-rose-700" }
                : wf.marginPct < minMarginPct
                  ? { label: "THIN", cls: "bg-amber-100 text-amber-700" }
                  : { label: "OK", cls: "bg-emerald-50 text-emerald-700" };
            return (
              <Fragment key={key}>
                <tr
                  className="cursor-pointer border-t border-ink-50 hover:bg-ink-50/40"
                  onClick={() => setOpenId(open ? null : key)}
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 font-medium text-ink-800">
                      {open ? <ChevronDown className="size-3.5 shrink-0 text-ink-400" /> : <ChevronRight className="size-3.5 shrink-0 text-ink-400" />}
                      {impact.itemLabel}
                      {impact.costIsEstimate && (
                        <span title="Cost is a static estimate — no live provider quote.">
                          <AlertTriangle className="size-3 text-amber-500" />
                        </span>
                      )}
                    </span>
                    <span className="pl-5 text-[10px] uppercase tracking-wide text-ink-400">
                      {DISCOUNT_ITEM_LABELS[impact.itemType]}
                      {impact.buyerPlanId != null || impact.buyerLabel !== NEUTRAL_BUYER.planName
                        ? ` · ${impact.buyerLabel}`
                        : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-600">{fmtMoney(impact.listPrice, impact.currency)}</td>
                  <td className="px-3 py-2 font-semibold text-ink-800">{fmtMoney(wf.discountedPrice, impact.currency)}</td>
                  <td className={`px-3 py-2 font-semibold ${wf.netProfit < 0 ? "text-rose-600" : "text-ink-800"}`}>
                    {fmtMoney(wf.netProfit, impact.currency)}
                  </td>
                  <td className={`px-3 py-2 ${wf.netProfit < 0 ? "text-rose-600" : wf.marginPct < minMarginPct ? "text-amber-600" : "text-ink-600"}`}>
                    {wf.marginPct}%
                  </td>
                  <td className="px-3 py-2 text-ink-600">{impact.breakEvenDiscountPct}%</td>
                  <td className="px-3 py-2 font-semibold text-ink-800">{impact.safeMaxDiscountPct}%</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${status.cls}`}>{status.label}</span>
                  </td>
                </tr>
                {open && (
                  <tr className="border-t border-ink-50 bg-ink-50/30">
                    <td colSpan={8} className="px-3 py-3">
                      <WaterfallDetail impact={impact} discount={discount} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WaterfallDetail({ impact, discount }: { impact: DiscountImpact; discount: number }) {
  const wf = impact.atDiscount(discount);
  const cur = impact.currency;
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <DetailGroup title="Customer pays">
          <DetailRow label={`Price (${discount}% off)`} value={fmtMoney(wf.discountedPrice, cur)} />
          {wf.shippingCharged > 0 && <DetailRow label="Shipping" value={fmtMoney(wf.shippingCharged, cur)} />}
          <DetailRow label="Tax" value={fmtMoney(wf.taxAmount, cur)} muted />
          <DetailRow label="Total charged" value={fmtMoney(wf.grossCustomerPays, cur)} />
        </DetailGroup>
        <DetailGroup title="Your costs">
          <DetailRow label={impact.costLabel} value={fmtMoney(wf.directCost, cur)} muted />
          <DetailRow label="Payment fee" value={fmtMoney(wf.paymentFee, cur)} muted />
          <DetailRow label="Tax remitted" value={fmtMoney(wf.taxAmount, cur)} muted />
        </DetailGroup>
        <DetailGroup title="You keep">
          <DetailRow
            label="Net profit"
            value={fmtMoney(wf.netProfit, cur)}
            accent={wf.netProfit >= 0 ? "good" : "bad"}
          />
          <DetailRow label="Margin" value={`${wf.marginPct}%`} accent={wf.marginPct >= impact.minMarginPct ? "good" : "warn"} />
          <DetailRow label="Safe max discount" value={`${impact.safeMaxDiscountPct}%`} />
          <DetailRow label="Break-even discount" value={`${impact.breakEvenDiscountPct}%`} />
        </DetailGroup>
      </div>
      {impact.perBuyer && impact.perBuyer.length > 1 && (
        <div className="overflow-x-auto rounded-md bg-white ring-1 ring-inset ring-ink-100">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-ink-50/70 text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-2.5 py-1.5 font-semibold">Per buyer (at full price)</th>
                <th className="px-2.5 py-1.5 font-semibold">They pay</th>
                <th className="px-2.5 py-1.5 font-semibold">Net profit</th>
                <th className="px-2.5 py-1.5 font-semibold">Margin</th>
                <th className="px-2.5 py-1.5 font-semibold">Safe max</th>
                <th className="px-2.5 py-1.5 font-semibold">Break-even</th>
              </tr>
            </thead>
            <tbody>
              {impact.perBuyer.map((b) => {
                const isShown = b.label === impact.buyerLabel;
                return (
                  <tr key={b.label} className={`border-t border-ink-50 ${isShown ? "bg-amber-50/50" : ""}`}>
                    <td className="px-2.5 py-1.5 font-medium text-ink-700">
                      {b.label}
                      {isShown && <span className="ml-1 text-[9px] uppercase text-amber-600">shown above</span>}
                    </td>
                    <td className="px-2.5 py-1.5 text-ink-600">{fmtMoney(b.effectivePrice, cur)}</td>
                    <td className={`px-2.5 py-1.5 font-semibold ${b.netProfit < 0 ? "text-rose-600" : "text-ink-800"}`}>
                      {fmtMoney(b.netProfit, cur)}
                    </td>
                    <td className="px-2.5 py-1.5 text-ink-600">{b.marginPct}%</td>
                    <td className="px-2.5 py-1.5 text-ink-600">{b.safeMaxDiscountPct}%</td>
                    <td className="px-2.5 py-1.5 text-ink-600">{b.breakEvenDiscountPct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {impact.notes.length > 0 && (
        <ul className="list-inside list-disc space-y-0.5 text-[11px] text-ink-400">
          {impact.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-md bg-white p-2.5 ring-1 ring-inset ring-ink-100">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{title}</div>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function DetailRow({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: "good" | "bad" | "warn";
}) {
  const color =
    accent === "good"
      ? "text-emerald-600"
      : accent === "bad"
        ? "text-rose-600"
        : accent === "warn"
          ? "text-amber-600"
          : muted
            ? "text-ink-500"
            : "text-ink-800";
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={`text-xs font-semibold ${color}`}>{value}</dd>
    </div>
  );
}
