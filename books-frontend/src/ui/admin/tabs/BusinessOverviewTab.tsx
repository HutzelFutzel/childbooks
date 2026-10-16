"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Coins,
  Compass,
  CreditCard,
  FlaskConical,
  Inbox,
  LayoutGrid,
  Percent,
  RefreshCw,
  Rocket,
  Sparkles,
  Tablet,
  Truck,
  Users,
} from "lucide-react";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminAccess } from "../../../state/adminAccessStore";
import { useAdminFinance } from "../../../state/adminFinanceStore";
import { useAdminHealth } from "../../../state/adminHealthStore";
import { useAdminOrders } from "../../../state/adminOrdersStore";
import { backendFetch } from "../../../platform/backend";
import { sparkUnitEconomics } from "../../../core/config/economics";
import {
  catalogDiscountImpacts,
  storewideSafeDiscount,
  DISCOUNT_ITEM_LABELS,
} from "../../../core/config/discountImpact";
import { describeGuideRollout } from "../../../core/config/guide";
import { freezeTerms, inviteTeaser } from "../../../core/config/referral";
import type { ProductDefinition } from "../../../core/config/products";
import { cn } from "../../lib/cn";
import {
  filterNavTree,
  MODE_BADGE_META,
  NAV_TREE,
  type NavGroup,
  type NavLeaf,
} from "../adminNav";
import { adminHref, useAdminTab } from "../adminTabStore";
import { ConfigHealthPanel } from "./ConfigHealthPanel";
import { fmtMoney } from "./products/parts";

type OverviewSection = "all" | "directory" | "business";

/**
 * The Admin Control Center (`/admin/configuration/overview`).
 *
 * Combines three things in one place so you never lose your overview:
 *   1. **Live Operations & Pulse** — orders needing attention, unread contact
 *      messages, 30d revenue/net contribution, billing mode, and config health.
 *   2. **Workspace Directory** — all 6 domain workspaces and their tools at a
 *      glance, with Settings and Analytics side-by-side.
 *   3. **Business Model & Pricing Map** — every active plan, catalog product,
 *      Sparks unit economics, referral rules, and sale headroom in clean cards.
 */
export function BusinessOverviewTab() {
  const [view, setView] = useState<OverviewSection>("all");

  const plans = useAppConfigStore((s) => s.plans.plans);
  const products = useAppConfigStore((s) => s.products.products);
  const pricing = useAppConfigStore((s) => s.pricingSettings);
  const sparks = useAppConfigStore((s) => s.sparks);
  const shipping = useAppConfigStore((s) => s.shippingSettings);
  const referral = useAppConfigStore((s) => s.referral);
  const guide = useAppConfigStore((s) => s.guide);
  const loadAdminProducts = useAppConfigStore((s) => s.loadAdminProducts);

  const canRead = useAdminAccess((s) => s.canRead);
  const isOwner = useAdminAccess((s) => s.isOwner());

  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  const openCatalog = useAdminTab((s) => s.openCatalog);
  const openMarketingTab = useAdminTab((s) => s.openMarketingTab);
  const openAnalysis = useAdminTab((s) => s.openAnalysis);
  const openCommunicationTab = useAdminTab((s) => s.openCommunicationTab);

  // Live operational state (loaded only for sections the admin has permission to read)
  const runtime = useAdminHealth((s) => s.runtime);
  const loadRuntime = useAdminHealth((s) => s.loadRuntime);

  const orderAnalytics = useAdminOrders((s) => s.analytics);
  const ordersLoading = useAdminOrders((s) => s.loading);
  const refreshOrders = useAdminOrders((s) => s.refresh);

  const financeSummary = useAdminFinance((s) => s.summary);
  const financeAlerts = useAdminFinance((s) => s.alerts);
  const financeLoading = useAdminFinance((s) => s.loading);
  const refreshFinance = useAdminFinance((s) => s.refresh);
  const loadAlerts = useAdminFinance((s) => s.loadAlerts);

  const [newInboxCount, setNewInboxCount] = useState<number | null>(null);
  const [adminProducts, setAdminProducts] = useState<ProductDefinition[]>([]);

  useEffect(() => {
    void loadAdminProducts()
      .then((config) => setAdminProducts(config.products))
      .catch(() => {
        /* non-fatal */
      });
  }, [loadAdminProducts]);

  useEffect(() => {
    if (!runtime) void loadRuntime();
    if (canRead("analysis.orders") && !orderAnalytics && !ordersLoading) {
      void refreshOrders();
    }
    if (canRead("analysis.finance") && !financeSummary && !financeLoading) {
      void refreshFinance();
      void loadAlerts();
    }
    if (canRead("communication.contact")) {
      void backendFetch("/admin/contact/messages?status=new")
        .then((res) => (res.ok ? (res.json() as Promise<{ messages?: unknown[] }>) : null))
        .then((json) => {
          if (json?.messages) setNewInboxCount(json.messages.length);
        })
        .catch(() => {
          /* ignore */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  const refreshPulse = () => {
    void loadRuntime();
    if (canRead("analysis.orders")) void refreshOrders();
    if (canRead("analysis.finance")) {
      void refreshFinance();
      void loadAlerts();
    }
    if (canRead("communication.contact")) {
      void backendFetch("/admin/contact/messages?status=new")
        .then((res) => (res.ok ? (res.json() as Promise<{ messages?: unknown[] }>) : null))
        .then((json) => {
          if (json?.messages) setNewInboxCount(json.messages.length);
        })
        .catch(() => {});
    }
  };

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

  const saleImpacts = useMemo(
    () =>
      catalogDiscountImpacts({
        settings: pricing,
        sparks,
        products: adminProducts,
        plans,
        currency: base,
        shipping,
      }),
    [pricing, sparks, adminProducts, plans, base, shipping],
  );
  const storewide = storewideSafeDiscount(saleImpacts);

  const memberEbookLabel = (planId: string, isFree: boolean): string => {
    if (!ebook.enabled) return "—";
    const mp = ebook.planPrices[planId]?.[base];
    if (isFree || mp == null) return `Regular (${fmtMoney(ebook.prices[base] ?? 0, base)})`;
    if (mp <= 0) return "Included free";
    return fmtMoney(mp, base);
  };

  const reachableDomains = useMemo(() => {
    const canReachLeaf = (leaf: NavLeaf) =>
      leaf.ownerOnly ? isOwner : !leaf.key || canRead(leaf.key);
    return filterNavTree(NAV_TREE, canReachLeaf).filter(
      (node): node is NavGroup => node.kind === "group",
    );
  }, [canRead, isOwner]);

  const unresolvedAlerts = useMemo(
    () => financeAlerts.filter((a) => !a.resolvedAt),
    [financeAlerts],
  );

  const attentionCount = orderAnalytics?.attention.count ?? 0;
  const isLive = runtime?.env === "live";

  return (
    <div className="space-y-8">
      {/* Top View Bar + Config Health */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex rounded-xl bg-ink-100/80 p-1 ring-1 ring-inset ring-ink-200/60"
            role="tablist"
            aria-label="Control Center sections"
          >
            {(
              [
                { id: "all", label: "Full Control Center" },
                { id: "directory", label: "Workspace Directory" },
                { id: "business", label: "Business & Pricing Map" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                onClick={() => setView(tab.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  view === tab.id
                    ? "bg-white text-ink-900 shadow-2xs"
                    : "text-ink-600 hover:text-ink-900",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={refreshPulse}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-ink-600 ring-1 ring-inset ring-ink-200 transition hover:bg-ink-50 hover:text-ink-900"
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                (ordersLoading || financeLoading) && "animate-spin text-brand-500",
              )}
            />
            <span>Refresh pulse</span>
          </button>
        </div>

        <ConfigHealthPanel
          settings={pricing}
          sparks={sparks}
          products={adminProducts}
          plans={plans}
        />
      </div>

      {/* 1. Live Operational Pulse & Needs Attention */}
      {view !== "business" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Live Operations &amp; 30-Day Pulse
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Print Orders Card */}
            {canRead("analysis.orders") && (
              <PulseCard
                onClick={() => openAnalysis("orders")}
                tone={attentionCount > 0 ? "amber" : "default"}
                icon={<Truck className="size-4" />}
                label="Print Orders (30d)"
                value={
                  orderAnalytics
                    ? `${orderAnalytics.orders.toLocaleString()} orders`
                    : ordersLoading
                      ? "Loading…"
                      : "View orders"
                }
                badge={
                  orderAnalytics ? (
                    attentionCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        <AlertTriangle className="size-3" />
                        {attentionCount} need attention
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        <CheckCircle2 className="size-3" />
                        All clear
                      </span>
                    )
                  ) : null
                }
                detail={
                  orderAnalytics
                    ? `${orderAnalytics.pipeline.shipped} shipped · ${orderAnalytics.open} open`
                    : "Track print fulfillment and printer health"
                }
              />
            )}

            {/* Finance & P&L Card */}
            {canRead("analysis.finance") && (
              <PulseCard
                onClick={() => openAnalysis("finance")}
                tone={unresolvedAlerts.length > 0 ? "amber" : "default"}
                icon={<Coins className="size-4" />}
                label="Net Contribution (30d)"
                value={
                  financeSummary
                    ? fmtMoney(financeSummary.netUsd, "USD")
                    : financeLoading
                      ? "Loading…"
                      : "View P&L"
                }
                badge={
                  unresolvedAlerts.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      <AlertTriangle className="size-3" />
                      {unresolvedAlerts.length} alert{unresolvedAlerts.length === 1 ? "" : "s"}
                    </span>
                  ) : null
                }
                detail={
                  financeSummary
                    ? `Revenue ${fmtMoney(financeSummary.totalRevenueUsd, "USD")} · Cost ${fmtMoney(financeSummary.totalCostUsd, "USD")}`
                    : "Revenue, provider costs, and operating margins"
                }
              />
            )}

            {/* Contact Inbox Card */}
            {canRead("communication.contact") && (
              <PulseCard
                onClick={() => openCommunicationTab("contact")}
                tone={newInboxCount && newInboxCount > 0 ? "brand" : "default"}
                icon={<Inbox className="size-4" />}
                label="Contact Inbox"
                value={
                  newInboxCount === null
                    ? "Open inbox"
                    : newInboxCount === 0
                      ? "Inbox zero"
                      : `${newInboxCount} unread`
                }
                badge={
                  newInboxCount && newInboxCount > 0 ? (
                    <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                      Needs reply
                    </span>
                  ) : null
                }
                detail="Customer submissions from the public /contact form"
              />
            )}

            {/* Studio & Billing Mode Card */}
            <PulseCard
              onClick={() =>
                canRead("configuration.guide")
                  ? setConfigTab("guide")
                  : setConfigTab("system")
              }
              tone="default"
              icon={isLive ? <Rocket className="size-4" /> : <FlaskConical className="size-4" />}
              label="Studio & Environment"
              value={isLive ? "Live Billing" : "Sandbox Mode"}
              badge={
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    isLive
                      ? "bg-rose-100 text-rose-700"
                      : "bg-sky-100 text-sky-700",
                  )}
                >
                  {isLive ? "Real charges" : "Test mode"}
                </span>
              }
              detail={`Chat studio: ${describeGuideRollout(guide.rollout)}`}
            />
          </div>
        </section>
      )}

      {/* 2. Domain Workspace Directory */}
      {view !== "business" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
                <LayoutGrid className="size-3.5" />
                <span>All Workspaces ({reachableDomains.length})</span>
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Every admin screen grouped by domain — with live analytics and configuration side-by-side.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reachableDomains.map((domain) => (
              <DomainDirectoryCard key={domain.id} domain={domain} />
            ))}
          </div>
        </section>
      )}

      {/* 3. Business Model & Pricing Map */}
      {view !== "directory" && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Business Model &amp; Pricing Snapshot
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              How customers pay you, what each product or plan grants, and your live margin guardrails.
            </p>
          </div>

          {/* Catalog Overview Card */}
          <OverviewCard
            icon={<BookOpen className="size-4" />}
            title="Catalog (One-Time Purchases)"
            subtitle="Printed books, the digital PDF edition, and Spark top-up packs"
            onEdit={() => openCatalog("print")}
            editLabel="Edit catalog"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniStat
                icon={<BookOpen className="size-4" />}
                label="Print books"
                value={
                  activeProducts.length === 0 ? "None active" : `${activeProducts.length} active`
                }
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

          {/* Memberships Card */}
          <OverviewCard
            icon={<CreditCard className="size-4" />}
            title="Memberships"
            subtitle="Recurring subscriptions and what each tier includes"
            onEdit={() => setConfigTab("memberships")}
            editLabel="Edit plans"
          >
            {activePlans.length === 0 ? (
              <Empty>No active plans. Add one under Memberships.</Empty>
            ) : (
              <Table
                head={[
                  "Plan",
                  `Price /mo (${base})`,
                  "Sparks /mo",
                  "Print discount",
                  "Member ebook",
                ]}
                rows={activePlans.map((p) => [
                  p.name + (p.isFree ? "  (free)" : ""),
                  p.isFree ? "Free" : fmtMoney(p.prices[base]?.month?.amount ?? 0, base),
                  p.grant.monthlySparks > 0 ? `${p.grant.monthlySparks.toLocaleString()} ✦` : "—",
                  p.entitlements.printDiscountPct > 0
                    ? `${p.entitlements.printDiscountPct}%`
                    : "—",
                  memberEbookLabel(p.id, p.isFree),
                ])}
              />
            )}
          </OverviewCard>

          {/* Two-column row for Sparks Economy + Referrals */}
          <div className="grid gap-4 lg:grid-cols-2">
            <OverviewCard
              icon={<Coins className="size-4" />}
              title="Sparks Economy"
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
                      "Multiple of raw provider cost.",
                    ],
                    [
                      "Gross margin",
                      `${unit.grossMarginPct}%`,
                      "Margin on metered AI actions.",
                    ],
                    [
                      "New-user grants",
                      `${(sparks.grants.guestSparks + sparks.grants.signupBonusSparks + sparks.grants.verifyBonusSparks).toLocaleString()} ✦`,
                      "Free Sparks for a verified user.",
                    ],
                  ]}
                />
              )}
            </OverviewCard>

            <OverviewCard
              icon={<Users className="size-4" />}
              title="Referrals"
              subtitle="Invite-a-friend rewards and daily payout budget"
              onEdit={() => openMarketingTab("referrals")}
              editLabel="Edit referrals"
            >
              {!referral.enabled ? (
                <Empty>The referral program is off. Turn it on under Referrals.</Empty>
              ) : (
                <Table
                  head={["Setting", "Value"]}
                  rows={[
                    ["Status", "On"],
                    ["Live offer", inviteTeaser(freezeTerms(referral))],
                    [
                      "Enabled rules",
                      String(referral.rules.filter((r) => r.enabled).length),
                    ],
                    [
                      "Daily payout budget",
                      referral.limits.dailyBudgetAmount > 0
                        ? fmtMoney(referral.limits.dailyBudgetAmount, base)
                        : "Uncapped",
                    ],
                  ]}
                />
              )}
            </OverviewCard>
          </div>

          {/* Sale Headroom Card */}
          <OverviewCard
            icon={<Percent className="size-4" />}
            title="Sale Headroom"
            subtitle="How deep a discount each item can absorb for its most expensive buyer — after plan perks, cost, fees, and tax"
            onEdit={() => setConfigTab("discounts")}
            editLabel="Open sale planner"
          >
            {saleImpacts.length === 0 ? (
              <Empty>
                Nothing on sale yet — activate a product, pack, or plan to see its headroom.
              </Empty>
            ) : (
              <>
                {storewide && (
                  <p className="text-xs text-ink-600">
                    A storewide sale is safe up to{" "}
                    <span className="font-semibold text-ink-900">{storewide.pct}% off</span>{" "}
                    (keeps every item at ≥{pricing.minMarginPct}% margin) — limited by{" "}
                    {storewide.limitedBy.itemLabel}.
                  </p>
                )}
                <Table
                  head={[
                    "Item",
                    "Worst-case buyer",
                    `They pay (${base})`,
                    "Margin at list",
                    "Safe max",
                    "Break-even",
                  ]}
                  rows={saleImpacts.map((impact) => {
                    const wf = impact.atDiscount(0);
                    return [
                      `${impact.itemLabel} (${DISCOUNT_ITEM_LABELS[impact.itemType].toLowerCase()})`,
                      impact.buyerLabel,
                      fmtMoney(impact.listPrice, base),
                      `${wf.marginPct}%`,
                      `${impact.safeMaxDiscountPct}%`,
                      `${impact.breakEvenDiscountPct}%`,
                    ];
                  })}
                />
              </>
            )}
          </OverviewCard>

          {/* Currencies & Tax Card */}
          <OverviewCard
            icon={<Coins className="size-4" />}
            title="Currencies & Tax"
            subtitle="Active checkout currencies and margin floors"
            onEdit={() => setConfigTab("financial")}
            editLabel="Edit currencies & tax"
          >
            <div className="flex flex-wrap gap-1.5">
              {pricing.currencies.map((c) => (
                <span
                  key={c}
                  className={
                    c === base
                      ? "rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white"
                      : "rounded-full bg-ink-50 px-2.5 py-1 text-xs font-medium text-ink-700 ring-1 ring-inset ring-ink-200"
                  }
                >
                  {c}
                  {c === base && " · base"}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Planned max discount: <strong>{pricing.maxDiscountPct}%</strong> · Margin floor for
              sales: <strong>{pricing.minMarginPct}%</strong>. Tax is collected by Stripe Tax at
              checkout.
            </p>
          </OverviewCard>
        </section>
      )}
    </div>
  );
}

function PulseCard({
  icon,
  label,
  value,
  badge,
  detail,
  tone = "default",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: React.ReactNode;
  detail: string;
  tone?: "default" | "amber" | "brand";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col justify-between rounded-2xl border p-4 text-left transition hover:shadow-soft",
        tone === "amber"
          ? "border-amber-200 bg-amber-50/40 hover:border-amber-300"
          : tone === "brand"
            ? "border-brand-200 bg-brand-50/30 hover:border-brand-300"
            : "border-ink-100 bg-white hover:border-ink-200",
      )}
    >
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500">
            <span className="text-ink-400 group-hover:text-ink-700">{icon}</span>
            <span>{label}</span>
          </span>
          {badge}
        </div>
        <div className="text-lg font-bold tracking-tight text-ink-900">{value}</div>
      </div>
      <div className="mt-3 flex w-full items-center justify-between gap-2 border-t border-ink-100/80 pt-2.5 text-[11px] text-ink-500">
        <span className="truncate">{detail}</span>
        <ArrowRight className="size-3.5 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-700" />
      </div>
    </button>
  );
}

function DomainDirectoryCard({ domain }: { domain: NavGroup }) {
  const directLeaves = domain.children.filter((c): c is NavLeaf => c.kind === "leaf");
  const subGroups = domain.children.filter((c): c is NavGroup => c.kind === "group");

  return (
    <div className="flex flex-col rounded-2xl border border-ink-100 bg-white p-4 shadow-2xs">
      <div className="mb-3 flex items-start gap-2.5 border-b border-ink-100 pb-3">
        {domain.icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            {domain.icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-900">{domain.label}</h3>
          {domain.description && (
            <p className="mt-0.5 text-xs text-ink-500">{domain.description}</p>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3">
        {directLeaves.length > 0 && (
          <div className="grid grid-cols-1 gap-1">
            {directLeaves.map((leaf) => (
              <DirectoryLeafLink key={leaf.id} leaf={leaf} />
            ))}
          </div>
        )}

        {subGroups.map((sub) => (
          <div key={sub.id} className="space-y-1">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              {sub.label}
            </p>
            <div className="grid grid-cols-1 gap-0.5">
              {sub.children
                .filter((c): c is NavLeaf => c.kind === "leaf")
                .map((leaf) => (
                  <DirectoryLeafLink key={leaf.id} leaf={leaf} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DirectoryLeafLink({ leaf }: { leaf: NavLeaf }) {
  const badge = leaf.mode && leaf.mode !== "overview" ? MODE_BADGE_META[leaf.mode] : null;
  return (
    <Link
      href={leaf.href}
      className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-ink-50"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-ink-400 transition group-hover:text-brand-600">
          {leaf.icon}
        </span>
        <span className="truncate font-medium text-ink-700 group-hover:text-ink-900">
          {leaf.label}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {badge && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              leaf.mode === "config"
                ? "bg-ink-100/80 text-ink-500"
                : leaf.mode === "ops"
                  ? "bg-amber-100/70 text-amber-800"
                  : "bg-sky-100/70 text-sky-700",
            )}
          >
            {badge.label}
          </span>
        )}
        <ArrowRight className="size-3 text-ink-300 opacity-0 transition group-hover:translate-x-0.5 group-hover:text-ink-600 group-hover:opacity-100" />
      </span>
    </Link>
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
    <div className="space-y-3.5 rounded-2xl border border-ink-100 bg-white p-5 shadow-2xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-ink-50 text-ink-600">
            {icon}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
            <p className="text-xs text-ink-500">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-100 hover:text-ink-900"
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
    <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-ink-100">
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
                  className={
                    j === 0
                      ? "px-3 py-2 font-medium text-ink-800"
                      : "px-3 py-2 text-ink-600"
                  }
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
      className="flex flex-col items-start gap-1 rounded-xl bg-ink-50/50 p-3.5 text-left ring-1 ring-inset ring-ink-100 transition hover:bg-ink-50 hover:ring-ink-200"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        {icon}
        {label}
      </span>
      <span className="text-lg font-bold text-ink-900">{value}</span>
      <span className="whitespace-pre-line text-[11px] leading-relaxed text-ink-400">
        {detail}
      </span>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-400">{children}</p>;
}
