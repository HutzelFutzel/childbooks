"use client";

/**
 * Configuration → Markets → what happened after a market was opened.
 *
 * Opening a country is meant to be one click. Behind it the backend asks the
 * printer whether it ships there, which of our formats it makes for it, and
 * what shipping costs, then republishes the catalog. This panel is the report
 * of that work: per product, can customers buy it in the new market, and if not,
 * why. Nothing here needs acting on to make a market work — products are
 * enabled by evidence, not by hand — it exists so the outcome isn't invisible.
 *
 * It also lists any open market that ISN'T fully ready, whether or not it was
 * opened this session: setup the provider throttled is finished by a scheduled
 * job, and a market the printer can't serve needs a human decision.
 */

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "../../../lib/cn";
import { countryFlag, countryLabel } from "../../../../core/analytics/markets";
import { methodLabel, type ShippingSettings } from "../../../../core/config/shipping";
import type {
  MarketOnboardingReport,
  MarketOnboardingState,
  ProductMarketRow,
} from "../../../../core/config/marketOnboarding";
import { useAppConfigStore } from "../../../../state/appConfigStore";

const STATE_COPY: Record<MarketOnboardingState, { label: string; tone: string }> = {
  ready: { label: "Ready to sell", tone: "bg-emerald-50 text-emerald-800" },
  pending: { label: "Finishing setup", tone: "bg-amber-50 text-amber-800" },
  nothing_sellable: { label: "Nothing sellable", tone: "bg-red-50 text-red-700" },
  unreachable: { label: "Printer can't ship here", tone: "bg-red-50 text-red-700" },
};

const PRODUCT_COPY: Record<ProductMarketRow["state"], { label: string; tone: string }> = {
  sellable: { label: "On sale", tone: "text-emerald-700" },
  refused: { label: "Not made here", tone: "text-red-700" },
  excluded: { label: "Excluded by product", tone: "text-ink-500" },
  unknown: { label: "Checking…", tone: "text-amber-700" },
  draft: { label: "Draft", tone: "text-ink-500" },
};

export function MarketOnboardingPanel({
  running,
  reports,
  refreshKey,
  onDismiss,
}: {
  /** The country being set up right now, if any. */
  running: string | null;
  /** Fresh results from this session's runs. */
  reports: MarketOnboardingReport[];
  /** Bumped whenever the stored status may have changed. */
  refreshKey: number;
  onDismiss: (country: string) => void;
}) {
  const load = useAppConfigStore((s) => s.loadMarketOnboarding);
  const shipping = useAppConfigStore((s) => s.shippingSettings);
  const [stored, setStored] = useState<MarketOnboardingReport[]>([]);

  useEffect(() => {
    let alive = true;
    load()
      .then((res) => {
        if (alive) setStored(res.markets);
      })
      .catch(() => {
        // Status is advisory; a failed read must not break the Markets screen.
      });
    return () => {
      alive = false;
    };
  }, [load, refreshKey]);

  const fresh = new Map(reports.map((r) => [r.country, r]));
  // Fresh reports win; otherwise only markets that still need a look.
  const cards = [
    ...reports,
    ...stored.filter((r) => !fresh.has(r.country) && r.state !== "ready" && r.country !== running),
  ];

  if (!running && cards.length === 0) return null;

  return (
    <div className="space-y-2">
      {running ? (
        <p className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
          <Loader2 className="size-4 animate-spin" />
          Setting up {countryLabel(running)}: checking what the printer makes and ships there, then
          measuring shipping. Leave this tab open — it takes about a minute.
        </p>
      ) : null}
      {cards.map((report) => (
        <ReportCard
          key={report.country}
          report={report}
          shipping={shipping}
          dismissable={fresh.has(report.country)}
          onDismiss={() => onDismiss(report.country)}
        />
      ))}
    </div>
  );
}

function ReportCard({
  report,
  shipping,
  dismissable,
  onDismiss,
}: {
  report: MarketOnboardingReport;
  shipping: ShippingSettings;
  dismissable: boolean;
  onDismiss: () => void;
}) {
  const copy = STATE_COPY[report.state];
  const visible = report.products.filter((p) => p.state !== "draft");
  return (
    <div className="rounded-lg border border-ink-100 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink-900">
          {countryFlag(report.country)} {countryLabel(report.country)}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", copy.tone)}>{copy.label}</span>
        {report.throttled ? (
          <span className="text-xs text-amber-700">
            The printer rate-limited some checks — they're retried automatically.
          </span>
        ) : null}
        {dismissable ? (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="ml-auto text-ink-400 hover:text-ink-700"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {visible.length > 0 ? (
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {visible.map((p) => (
            <li key={p.productId} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-ink-700">{p.name}</span>
              <span className={cn("shrink-0 text-xs", PRODUCT_COPY[p.state].tone)}>
                {PRODUCT_COPY[p.state].label}
                {p.state === "sellable" && p.methods.length > 0
                  ? ` · ${p.methods.map((m) => methodLabel(shipping, m)).join(", ")}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {report.notes.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-ink-500">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
