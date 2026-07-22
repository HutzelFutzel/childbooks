"use client";

import { BookOpen, CreditCard, Sparkles, Tablet, Coins, ArrowRight } from "lucide-react";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { sparkUnitEconomics } from "../../../core/config/economics";
import { useAdminTab } from "../adminTabStore";
import { TabIntro, fmtMoney } from "./products/parts";

/**
 * A read-only, at-a-glance picture of the whole business model — every plan,
 * every sellable product, the Sparks economy and the active currencies on one
 * screen, each row deep-linking to the exact editor. This is the antidote to
 * "where is that setting?": you start here, see how the pieces fit, and jump
 * straight to the one you need.
 */
export function BusinessOverviewTab() {
  const plans = useAppConfigStore((s) => s.plans.plans);
  const products = useAppConfigStore((s) => s.products.products);
  const pricing = useAppConfigStore((s) => s.pricingSettings);
  const sparks = useAppConfigStore((s) => s.sparks);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  const openCatalog = useAdminTab((s) => s.openCatalog);

  const base = pricing.baseCurrency;
  const ebook = pricing.ebook;
  const unit = sparkUnitEconomics(sparks);

  const activePlans = plans
    .filter((p) => p.status === "active")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const activeProducts = products
    .filter((p) => p.status === "active")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const activePacks = sparks.packs.filter((p) => p.active);

  /** The ebook perk wording for a plan (mirrors the storefront logic). */
  const memberEbookLabel = (planId: string, isFree: boolean): string => {
    if (!ebook.enabled) return "—";
    const mp = ebook.planPrices[planId]?.[base];
    if (isFree || mp == null) return `Regular (${fmtMoney(ebook.prices[base] ?? 0, base)})`;
    if (mp <= 0) return "Included free";
    return fmtMoney(mp, base);
  };

  return (
    <div className="space-y-5">
      <TabIntro>
        This is the whole business model on one screen — how customers pay you, and what each choice
        gives them. Everything here is read-only; use the links to jump to the editor for any piece.
        All amounts are shown in your base currency ({base}).
      </TabIntro>

      {/* Memberships */}
      <OverviewCard
        icon={<CreditCard className="size-4" />}
        title="Memberships"
        subtitle="Recurring subscriptions and what each one gives members"
        onEdit={() => setConfigTab("memberships")}
        editLabel="Edit plans"
      >
        {activePlans.length === 0 ? (
          <Empty>No active plans. Add one under Memberships.</Empty>
        ) : (
          <Table
            head={["Plan", `Price /mo (${base})`, "Sparks /mo", "Print discount", "Member ebook"]}
            rows={activePlans.map((p) => [
              p.name + (p.isFree ? "  (free)" : ""),
              p.isFree ? "Free" : fmtMoney(p.prices[base]?.month?.amount ?? 0, base),
              p.grant.monthlySparks > 0 ? `${p.grant.monthlySparks.toLocaleString()} ✦` : "—",
              p.entitlements.printDiscountPct > 0 ? `${p.entitlements.printDiscountPct}%` : "—",
              memberEbookLabel(p.id, p.isFree),
            ])}
          />
        )}
      </OverviewCard>

      {/* Catalog */}
      <OverviewCard
        icon={<BookOpen className="size-4" />}
        title="Catalog"
        subtitle="One-time purchases: printed books, the digital edition and Spark packs"
        onEdit={() => openCatalog("print")}
        editLabel="Edit catalog"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat
            icon={<BookOpen className="size-4" />}
            label="Print books"
            value={activeProducts.length === 0 ? "None active" : `${activeProducts.length} active`}
            detail={
              activeProducts.length > 0
                ? activeProducts
                    .slice(0, 3)
                    .map((p) => `${p.name} · ${fmtMoney(p.prices[base] ?? 0, base)}`)
                    .join("\n")
                : "Add a product under Catalog → Print books."
            }
            onClick={() => openCatalog("print")}
          />
          <MiniStat
            icon={<Tablet className="size-4" />}
            label="Digital edition"
            value={ebook.enabled ? fmtMoney(ebook.prices[base] ?? 0, base) : "Off"}
            detail={
              ebook.enabled
                ? `Regular price. Print owners get ${ebook.printBundleDiscountPct}% off.`
                : "Not for sale. Turn it on in Catalog → Digital edition."
            }
            onClick={() => openCatalog("ebook")}
          />
          <MiniStat
            icon={<Sparkles className="size-4" />}
            label="Spark packs"
            value={
              !sparks.enabled
                ? "Economy off"
                : activePacks.length === 0
                  ? "None active"
                  : `${activePacks.length} active`
            }
            detail={
              sparks.enabled && activePacks.length > 0
                ? activePacks
                    .slice(0, 3)
                    .map(
                      (p) =>
                        `${(p.sparks + p.bonusSparks).toLocaleString()} ✦ · ${fmtMoney(p.prices[base] ?? 0, base)}`,
                    )
                    .join("\n")
                : "Top-ups customers buy between renewals."
            }
            onClick={() => openCatalog("packs")}
          />
        </div>
      </OverviewCard>

      {/* Sparks economy */}
      <OverviewCard
        icon={<Coins className="size-4" />}
        title="Sparks economy"
        subtitle="How AI generation is metered and priced"
        onEdit={() => setConfigTab("sparks")}
        editLabel="Edit economy"
      >
        {!sparks.enabled ? (
          <Empty>The economy is off — all generation is free right now.</Empty>
        ) : (
          <Table
            head={["Setting", "Value", "Meaning"]}
            rows={[
              [
                "Spark value (peg)",
                fmtMoney(sparks.sparkValueUsd, base),
                "What one Spark sells for.",
              ],
              [
                "Markup",
                `${sparks.markupMultiplier}×`,
                "Multiple of raw provider cost charged to the customer.",
              ],
              [
                "Gross margin on metered work",
                `${unit.grossMarginPct}%`,
                "Share of each derived Spark price that isn't provider cost.",
              ],
              [
                "Grant ladder",
                `${(sparks.grants.guestSparks + sparks.grants.signupBonusSparks + sparks.grants.verifyBonusSparks).toLocaleString()} ✦`,
                "Free Sparks a fully-verified new user receives.",
              ],
            ]}
          />
        )}
      </OverviewCard>

      {/* Currencies */}
      <OverviewCard
        icon={<Coins className="size-4" />}
        title="Currencies & tax"
        subtitle="The money plumbing behind every price"
        onEdit={() => setConfigTab("financial")}
        editLabel="Edit financial settings"
      >
        <div className="flex flex-wrap gap-1.5">
          {pricing.currencies.map((c) => (
            <span
              key={c}
              className={
                c === base
                  ? "rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white"
                  : "rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink-600 ring-1 ring-inset ring-ink-200"
              }
            >
              {c}
              {c === base && " · base"}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-400">
          Max discount allowed: {pricing.maxDiscountPct}%. Tax is collected by Stripe Tax at checkout.
        </p>
      </OverviewCard>
    </div>
  );
}

function OverviewCard({
  icon,
  title,
  subtitle,
  onEdit,
  editLabel,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onEdit: () => void;
  editLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-inset ring-ink-100">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            {icon}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
            <p className="text-[11px] text-ink-400">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-50 px-2.5 py-1 text-[11px] font-semibold text-ink-600 transition hover:bg-ink-100"
        >
          {editLabel} <ArrowRight className="size-3" />
        </button>
      </div>
      {children}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-ink-50/70 text-left text-[11px] uppercase tracking-wide text-ink-400">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-ink-50">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={j === 0 ? "px-3 py-2 font-medium text-ink-800" : "px-3 py-2 text-ink-600"}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-lg bg-ink-50/50 p-3 text-left ring-1 ring-inset ring-ink-100 transition hover:bg-ink-50"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        {icon}
        {label}
      </span>
      <span className="text-lg font-bold text-ink-900">{value}</span>
      <span className="whitespace-pre-line text-[11px] leading-relaxed text-ink-400">{detail}</span>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-400">{children}</p>;
}
