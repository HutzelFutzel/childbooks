"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { freezeTerms, inviteTeaser } from "../../../core/config/referral";
import type { ProductDefinition } from "../../../core/config/products";
import { cn } from "../../lib/cn";
import { Skeleton } from "../../components/Skeleton";
import { fmtRelative } from "../analysis/format";
import { useConfigDocsStatus } from "../ConfigReady";
import { InlineError, PanelSkeleton, useAdminBusy } from "../LoadingState";
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

/** The saved config docs the pricing / health panels below are computed from. */
const OVERVIEW_CONFIG_DOCS = ["pricingSettings", "sparks", "plans", "products", "referral"] as const;

/** How many contact messages are waiting — null when it couldn't be read (non-fatal). */
async function fetchNewInboxCount(): Promise<number | null> {
  try {
    const res = await backendFetch("/admin/contact/messages?status=new");
    if (!res.ok) return null;
    const json = (await res.json()) as { messages?: unknown[] };
    return json.messages ? json.messages.length : null;
  } catch {
    return null;
  }
}

/**
 * Run `fn` once the browser has painted and has a spare moment, so deferred
 * work never competes with the first render. Returns a cancel function.
 * (Safari has no `requestIdleCallback`; a short timeout does the same job.)
 */
function afterFirstPaint(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 400 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 60);
  return () => window.clearTimeout(id);
}

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
  const runtimeError = useAdminHealth((s) => s.modeError);
  const loadRuntime = useAdminHealth((s) => s.loadRuntime);

  const orderAnalytics = useAdminOrders((s) => s.analytics);
  const ordersLoading = useAdminOrders((s) => s.loading);
  const ordersError = useAdminOrders((s) => s.error);
  const ordersUpdatedAt = useAdminOrders((s) => s.lastUpdated);
  // The overview only needs the headline report — not the printer link, the
  // order list or the print-file dashboard the full Orders view loads.
  const loadOrdersOverview = useAdminOrders((s) => s.loadOverview);

  const financeSummary = useAdminFinance((s) => s.summary);
  const financeAlerts = useAdminFinance((s) => s.alerts);
  const financeLoading = useAdminFinance((s) => s.loading);
  const financeError = useAdminFinance((s) => s.error);
  const financeUpdatedAt = useAdminFinance((s) => s.lastUpdated);
  const refreshFinance = useAdminFinance((s) => s.refresh);
  const loadAlerts = useAdminFinance((s) => s.loadAlerts);

  const [newInboxCount, setNewInboxCount] = useState<number | null>(null);
  /** The unread-count read has finished (ok or not), so "Open inbox" is the real fallback, not a placeholder. */
  const [inboxSettled, setInboxSettled] = useState(false);
  const [adminProducts, setAdminProducts] = useState<ProductDefinition[]>([]);
  /** The catalog read has finished (successfully or not) — until then `adminProducts` is just `[]`. */
  const [productsSettled, setProductsSettled] = useState(false);
  const [productsError, setProductsError] = useState(false);
  /** Saved config docs the pricing/health panels read; until they arrive those fields are defaults. */
  const { ready: configReady, failed: configFailed } = useConfigDocsStatus(OVERVIEW_CONFIG_DOCS);
  const panelsReady = configReady && productsSettled;
  /**
   * The aggregate cards (orders, finance) are queued but haven't started or
   * finished their first load. Lets them read "Loading…" from the first paint
   * instead of flashing a call-to-action and then switching.
   */
  const [pulsePending, setPulsePending] = useState(true);

  // Load in tiers so the page is usable immediately and the expensive numbers
  // fill in after:
  //   1. cheap single reads (config, environment, unread count) — right away;
  //   2. aggregate reports (orders scan, finance scan, alerts) — once the first
  //      paint is out, so they never delay it. Anything loaded within the last
  //      30s is reused, and what's already on screen stays visible while it
  //      revalidates.
  const loadProducts = useCallback(() => {
    let cancelled = false;
    setProductsError(false);
    void loadAdminProducts()
      .then((config) => {
        if (cancelled) return;
        setAdminProducts(config.products);
        setProductsSettled(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Not fatal to the page, but the pricing checks below are incomplete without it — say so.
        setProductsError(true);
        setProductsSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAdminProducts]);

  useEffect(() => loadProducts(), [loadProducts]);

  useEffect(() => {
    let cancelled = false;
    // Tier 1.
    if (!runtime) void loadRuntime();
    if (canRead("communication.contact")) {
      void fetchNewInboxCount().then((n) => {
        if (cancelled) return;
        if (n !== null) setNewInboxCount(n);
        setInboxSettled(true);
      });
    }
    // Tier 2.
    const cancelIdle = afterFirstPaint(() => {
      const pending: Promise<unknown>[] = [];
      if (canRead("analysis.orders")) pending.push(loadOrdersOverview());
      if (canRead("analysis.finance")) {
        pending.push(refreshFinance(), loadAlerts());
      }
      void Promise.allSettled(pending).then(() => {
        if (!cancelled) setPulsePending(false);
      });
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  const refreshPulse = () => {
    // An explicit refresh skips the freshness window (and the server's cache).
    void loadRuntime();
    if (canRead("analysis.orders")) void loadOrdersOverview({ force: true });
    if (canRead("analysis.finance")) {
      void refreshFinance({ force: true });
      void loadAlerts({ force: true });
    }
    if (canRead("communication.contact")) {
      void fetchNewInboxCount().then((n) => {
        if (n !== null) setNewInboxCount(n);
      });
    }
  };

  // ---- Loading feedback ----------------------------------------------------
  const wantsOrders = canRead("analysis.orders");
  const wantsFinance = canRead("analysis.finance");
  const refreshing =
    pulsePending || (wantsOrders && ordersLoading) || (wantsFinance && financeLoading) || !productsSettled;
  // Light the page-wide progress bar for as long as anything here is still loading.
  useAdminBusy(refreshing);

  // Re-render every half minute so "Updated 2m ago" keeps telling the truth.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const pulseUpdatedAt = Math.max(
    wantsOrders ? (ordersUpdatedAt ?? 0) : 0,
    wantsFinance ? (financeUpdatedAt ?? 0) : 0,
  );

  /** Per-card state: skeleton while the first load runs, an error if it failed and nothing is cached. */
  const ordersCardState: PulseState = orderAnalytics
    ? "ready"
    : ordersLoading || pulsePending
      ? "loading"
      : ordersError
        ? "error"
        : "ready";
  const financeCardState: PulseState = financeSummary
    ? "ready"
    : financeLoading || pulsePending
      ? "loading"
      : financeError
        ? "error"
        : "ready";
  // A refresh that failed while older numbers are still on screen.
  const pulseRefreshError: string | null =
    pulsePending || ordersLoading || financeLoading
      ? null
      : wantsOrders && orderAnalytics && ordersError
        ? ordersError
        : wantsFinance && financeSummary && financeError
          ? financeError
          : null;

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

          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-400" aria-live="polite">
              {refreshing
                ? "Refreshing…"
                : pulseUpdatedAt > 0
                  ? `Updated ${fmtRelative(pulseUpdatedAt)}`
                  : null}
            </span>
            <button
              type="button"
              onClick={refreshPulse}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-ink-600 ring-1 ring-inset ring-ink-200 transition hover:bg-ink-50 hover:text-ink-900 disabled:cursor-wait disabled:opacity-70"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-brand-500")} />
              <span>Refresh pulse</span>
            </button>
          </div>
        </div>

        {pulseRefreshError && (
          <InlineError
            message={`Couldn't refresh the latest numbers (${pulseRefreshError}). Showing what was loaded earlier.`}
            onRetry={refreshPulse}
          />
        )}
        {productsError && (
          <InlineError
            message="The product catalog couldn't be loaded, so the pricing checks below may be incomplete."
            onRetry={loadProducts}
          />
        )}
        {configFailed && (
          <InlineError
            message="Some saved settings couldn't be loaded, so the pricing figures below may be defaults. Reload to try again."
            onRetry={() => window.location.reload()}
          />
        )}

        {panelsReady ? (
          <ConfigHealthPanel
            settings={pricing}
            sparks={sparks}
            products={adminProducts}
            plans={plans}
          />
        ) : (
          <Skeleton className="h-20" />
        )}
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
                state={ordersCardState}
                onClick={ordersCardState === "error" ? refreshPulse : () => openAnalysis("orders")}
                tone={attentionCount > 0 ? "amber" : "default"}
                icon={<Truck className="size-4" />}
                label="Print Orders (30d)"
                value={
                  orderAnalytics
                    ? `${orderAnalytics.orders.toLocaleString()} orders`
                    : ordersCardState === "error"
                      ? "Couldn't load"
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
                    : ordersCardState === "error"
                      ? "Click to try again"
                      : "Track print fulfillment and printer health"
                }
              />
            )}

            {/* Finance & P&L Card */}
            {canRead("analysis.finance") && (
              <PulseCard
                state={financeCardState}
                onClick={financeCardState === "error" ? refreshPulse : () => openAnalysis("finance")}
                tone={unresolvedAlerts.length > 0 ? "amber" : "default"}
                icon={<Coins className="size-4" />}
                label="Net Contribution (30d)"
                value={
                  financeSummary
                    ? fmtMoney(financeSummary.netUsd, "USD")
                    : financeCardState === "error"
                      ? "Couldn't load"
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
                    : financeCardState === "error"
                      ? "Click to try again"
                      : "Revenue, provider costs, and operating margins"
                }
              />
            )}

            {/* Contact Inbox Card */}
            {canRead("communication.contact") && (
              <PulseCard
                state={newInboxCount === null && !inboxSettled ? "loading" : "ready"}
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
              // Until the environment has loaded, `isLive` is false — without this the
              // card would claim "Sandbox Mode" for a moment on a live system.
              state={runtime ? "ready" : runtimeError ? "error" : "loading"}
              onClick={
                runtime
                  ? () => (canRead("configuration.guide") ? setConfigTab("guide") : setConfigTab("system"))
                  : () => void loadRuntime()
              }
              tone="default"
              icon={isLive ? <Rocket className="size-4" /> : <FlaskConical className="size-4" />}
              label="Studio & Environment"
              value={runtime ? (isLive ? "Live Billing" : "Sandbox Mode") : "Couldn't load"}
              badge={
                runtime ? (
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
                ) : null
              }
              detail={
                !runtime
                  ? "Click to try again"
                  : isLive
                    ? "Payments are charged for real"
                    : "Payments run against test cards"
              }
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
      {view !== "directory" && !panelsReady && <PanelSkeleton rows={2} />}
      {view !== "directory" && panelsReady && (
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

/**
 * `loading` — first load in progress: the value and detail are skeletons, so the
 * layout doesn't shift when the numbers land. `error` — the load failed and
 * nothing is cached: the card says so and a click retries (the card is one big
 * button, so the retry is the card itself rather than a nested control).
 */
type PulseState = "ready" | "loading" | "error";

function PulseCard({
  icon,
  label,
  value,
  badge,
  detail,
  tone = "default",
  state = "ready",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: React.ReactNode;
  detail: string;
  tone?: "default" | "amber" | "brand";
  state?: PulseState;
  onClick: () => void;
}) {
  const loading = state === "loading";
  const failed = state === "error";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
      className={cn(
        "group flex flex-col justify-between rounded-2xl border p-4 text-left transition hover:shadow-soft disabled:cursor-progress disabled:hover:shadow-none",
        failed
          ? "border-amber-200 bg-amber-50/40 hover:border-amber-300"
          : tone === "amber"
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
          {loading ? null : badge}
        </div>
        {loading ? (
          <Skeleton className="h-7 w-28" rounded="lg" />
        ) : (
          <div className={cn("text-lg font-bold tracking-tight", failed ? "text-amber-800" : "text-ink-900")}>
            {value}
          </div>
        )}
      </div>
      <div className="mt-3 flex w-full items-center justify-between gap-2 border-t border-ink-100/80 pt-2.5 text-[11px] text-ink-500">
        {loading ? <Skeleton className="h-3 w-40" rounded="lg" /> : <span className="truncate">{detail}</span>}
        {failed ? (
          <RefreshCw className="size-3.5 shrink-0 text-amber-600" />
        ) : (
          <ArrowRight className="size-3.5 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-700" />
        )}
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
