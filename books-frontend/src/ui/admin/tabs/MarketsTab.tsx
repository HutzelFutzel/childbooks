"use client";

/**
 * Configuration → Markets. Which countries we sell to, and what the print
 * provider was discovered to reach.
 *
 * The screen is built around one distinction: what an admin DECIDED (the
 * enabled toggle) versus what the provider was OBSERVED to do (the coverage
 * sweep). They come from separate documents and are rendered side by side
 * rather than merged, because the interesting rows are the ones where they
 * disagree — a country switched on that the printer stopped serving is a
 * checkout failure nobody would otherwise see until a customer hit it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, Upload } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { InfoHint } from "../../components/InfoHint";
import { useReadOnly } from "../../components/ReadOnlyContext";
import { cn } from "../../lib/cn";
import { countryFlag, countryLabel } from "../../../core/analytics/markets";
import {
  ISO_COUNTRIES,
  SANCTIONS_DENYLIST,
  STATE_CODE_REQUIRED,
  TAX_ID_LABEL,
  TAX_ID_REQUIRED,
} from "../../../core/config/countries";
import {
  availableMethodsFor,
  capabilityIndex,
  type MarketCapability,
} from "../../../core/config/marketCapability";
import type { Market, MarketsConfig } from "../../../core/config/markets";
import type { MarketOnboardingReport } from "../../../core/config/marketOnboarding";
import { methodLabel, type ShippingSettings } from "../../../core/config/shipping";
import type { ShippingMethod } from "../../../core/fulfillment/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { FormatCoverageSection } from "./markets/FormatCoverageSection";
import { MarketOnboardingPanel } from "./markets/MarketOnboardingPanel";
import { ShippingPolicySection } from "./markets/ShippingPolicySection";
import { EditorTabs, OverflowItem, OverflowMenu, Section, TabIntro } from "./products/parts";
import { AdminSaveBar } from "../AdminPageHeader";

type Filter = "all" | "enabled" | "available" | "mismatch";
type Panel = "countries" | "shipping" | "formats";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "mismatch", label: "Needs attention" },
  { id: "enabled", label: "Selling" },
  { id: "available", label: "Printer reaches" },
  { id: "all", label: "All" },
];

const MARKET_PANELS = [
  { id: "countries", label: "Countries" },
  { id: "shipping", label: "Shipping" },
  { id: "formats", label: "Formats" },
];

/**
 * How long a coverage sweep is trusted before it's called stale.
 *
 * The provider changes what it reaches without announcing it, so an old sweep
 * is a claim about a world that has moved on. A month is short enough to catch a
 * withdrawal before it becomes a run of failed orders, and long enough not to
 * nag — the sweep costs a couple of minutes and a few hundred API calls.
 */
const SWEEP_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function daysSince(at: number): number {
  return Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
}

export function MarketsTab() {
  const readOnly = useReadOnly();
  const loadMarketsConfig = useAppConfigStore((s) => s.loadMarketsConfig);
  const saveMarketsConfig = useAppConfigStore((s) => s.saveMarketsConfig);
  const sweep = useAppConfigStore((s) => s.sweepMarketCapability);
  const onboardMarket = useAppConfigStore((s) => s.onboardMarket);
  const stored = useAppConfigStore((s) => s.adminMarkets);
  const capability = useAppConfigStore((s) => s.marketCapability);
  const shipping = useAppConfigStore((s) => s.shippingSettings);
  const loadShippingSettings = useAppConfigStore((s) => s.loadShippingSettings);
  const saveShipping = useAppConfigStore((s) => s.saveShippingSettings);
  const remeasure = useAppConfigStore((s) => s.remeasureShipping);
  const reproject = useAppConfigStore((s) => s.reprojectProducts);
  const projectedAt = useAppConfigStore((s) => s.products.projectedAt);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);

  const [draft, setDraft] = useState<MarketsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [filter, setFilter] = useState<Filter>("enabled");
  const [panel, setPanel] = useState<Panel>("countries");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Setting up newly opened markets: which one is in flight, what came back, and
  // a counter that tells the status panel to re-read after each change.
  const [onboardingRunning, setOnboardingRunning] = useState<string | null>(null);
  const [onboardingReports, setOnboardingReports] = useState<MarketOnboardingReport[]>([]);
  const [onboardingRefresh, setOnboardingRefresh] = useState(0);
  const seededFilter = useRef(false);

  // Both documents, together. They're edited on the same screen — the country
  // rows toggle speeds, which lives in the shipping policy — so having one
  // arrive without the other would let an edit be written against a default
  // that isn't what's stored.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([loadMarketsConfig(), loadShippingSettings()])
      .then(([config]) => {
        if (alive) setDraft(config);
      })
      .catch((err: unknown) => {
        if (alive) {
          setLoadError(err instanceof Error ? err.message : "Could not load markets.");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadAttempt, loadMarketsConfig, loadShippingSettings]);

  const config = draft ?? stored;
  const enabled = useMemo(
    () => new Set(config.markets.filter((m) => m.enabled).map((m) => m.country)),
    [config],
  );
  const notes = useMemo(
    () => new Map(config.markets.map((m) => [m.country, m.notes])),
    [config],
  );
  const coverage = useMemo(() => capabilityIndex(capability), [capability]);

  const dirty = useMemo(
    () => JSON.stringify(normalizeForCompare(config)) !== JSON.stringify(normalizeForCompare(stored)),
    [config, stored],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ISO_COUNTRIES.filter((country) => {
      if (SANCTIONS_DENYLIST.has(country)) return false;
      const cap = coverage.get(country);
      const on = enabled.has(country);
      if (filter === "enabled" && !on) return false;
      if (filter === "available" && cap?.status !== "available") return false;
      if (filter === "mismatch" && !needsAttention(on, cap)) return false;
      if (!q) return true;
      return (
        country.toLowerCase().includes(q) || countryLabel(country).toLowerCase().includes(q)
      );
    });
  }, [coverage, enabled, filter, query]);

  const setMarket = (country: string, patch: Partial<Market>) => {
    setDraft((prev) => {
      const base = prev ?? stored;
      const existing = base.markets.find((m) => m.country === country);
      const next: Market = {
        country,
        enabled: existing?.enabled ?? false,
        notes: existing?.notes ?? "",
        updatedAt: Date.now(),
        updatedBy: existing?.updatedBy ?? "",
        ...patch,
      };
      return {
        ...base,
        markets: existing
          ? base.markets.map((m) => (m.country === country ? next : m))
          : [...base.markets, next].sort((a, b) => a.country.localeCompare(b.country)),
      };
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    // Countries this save turns on, compared with what was stored — these are
    // the ones that need setting up, and the only ones worth probing.
    const wasOn = new Set(stored.markets.filter((m) => m.enabled).map((m) => m.country));
    const opened = draft.markets.filter((m) => m.enabled && !wasOn.has(m.country)).map((m) => m.country);
    try {
      const saved = await saveMarketsConfig(draft);
      setDraft(saved);
      toast.success(
        opened.length > 0 ? "Markets saved. Setting up the new ones…" : "Markets saved.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save markets.");
      setSaving(false);
      return;
    }
    setSaving(false);
    await setUpMarkets(opened);
  };

  // Make each newly opened market actually sellable. One request per country so
  // it can't outrun the request timeout however many were switched on. A failure
  // here never undoes the save: the scheduled job finishes whatever is left, so
  // this is the fast path, not the only one.
  const setUpMarkets = async (countries: string[]) => {
    for (const country of countries) {
      setOnboardingRunning(country);
      try {
        const report = await onboardMarket(country);
        setOnboardingReports((prev) => [report, ...prev.filter((r) => r.country !== country)]);
        if (report.state === "ready") {
          toast.success(`${countryLabel(country)} is ready to sell.`);
        } else if (report.state === "pending") {
          toast.info(`${countryLabel(country)} is opening — the rest finishes in the background.`);
        } else {
          toast.warning(`${countryLabel(country)} is open but can't sell anything yet — see details below.`);
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `${countryLabel(country)}: ${err.message} It will finish in the background.`
            : `Could not finish setting up ${countryLabel(country)}.`,
        );
      }
    }
    setOnboardingRunning(null);
    setOnboardingRefresh((n) => n + 1);
  };

  const runSweep = async (force: boolean) => {
    setSweeping(true);
    try {
      const summary = await sweep({ force });
      toast.success(
        summary.probed === 0
          ? "Nothing to re-probe — every country already has a verdict."
          : `Probed ${summary.probed}: ${summary.available} reachable, ${summary.refused} refused, ${summary.unknown} still unknown.`,
      );
      if (summary.message) toast.warning(summary.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The coverage sweep failed.");
    } finally {
      setSweeping(false);
    }
  };

  // Disable one speed for one country: "the printer runs it, we don't want to
  // sell it here". Saved immediately rather than batched with the market edits
  // above, because it belongs to a different document and pretending otherwise
  // is how a half-saved screen happens.
  const toggleCountryMethod = async (country: string, method: ShippingMethod, sell: boolean) => {
    const disabled = new Set(shipping.countryOverrides[country]?.disabled ?? []);
    if (sell) disabled.delete(method);
    else disabled.add(method);
    const overrides = { ...shipping.countryOverrides };
    if (disabled.size > 0) overrides[country] = { disabled: [...disabled] };
    else delete overrides[country];
    try {
      await saveShipping({ ...shipping, countryOverrides: overrides });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the speed override.");
    }
  };

  const runRemeasure = async () => {
    setBusy("Starting…");
    try {
      const summary = await remeasure({ onProgress: setBusy });
      for (const step of summary.steps) {
        if (step.ok) toast.success(step.detail);
        else toast.error(step.detail);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The re-measure failed.");
    } finally {
      setBusy(null);
    }
  };

  const republish = async () => {
    setBusy("Republishing…");
    try {
      await reproject();
      toast.success("Catalog republished.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not republish the catalog.");
    } finally {
      setBusy(null);
    }
  };

  const enabledCount = enabled.size;
  const reachable = capability.countries.filter((c) => c.status === "available").length;
  const attention = ISO_COUNTRIES.filter(
    (c) => !SANCTIONS_DENYLIST.has(c) && needsAttention(enabled.has(c), coverage.get(c)),
  ).length;
  const stale = capability.sweptAt > 0 && Date.now() - capability.sweptAt > SWEEP_STALE_AFTER_MS;
  // The storefront reads ONLY the projection, so anything published before its
  // inputs last changed is what customers are currently being shown. Compared
  // against the inputs rather than against a clock: "three days old" is fine if
  // nothing has changed in three days, and "an hour old" is wrong if the policy
  // was saved half an hour ago.
  const staleProjection = useMemo(() => {
    const newest = Math.max(shipping.updatedAt, stored.updatedAt, capability.sweptAt);
    return newest > 0 && projectedAt < newest;
  }, [capability.sweptAt, projectedAt, shipping.updatedAt, stored.updatedAt]);

  useEffect(() => {
    if (loading || seededFilter.current) return;
    seededFilter.current = true;
    if (attention > 0) setFilter("mismatch");
  }, [loading, attention]);

  if (loadError) {
    return (
      <Section title="Markets unavailable">
        <div className="space-y-3 py-3 text-sm text-red-700">
          <p>{loadError} No market or shipping controls were enabled, so stored configuration cannot be overwritten by defaults.</p>
          <Button variant="secondary" size="sm" onClick={() => setLoadAttempt((value) => value + 1)}>
            Retry loading
          </Button>
        </div>
      </Section>
    );
  }

  const toolsBusy = readOnly || loading || sweeping || busy != null || onboardingRunning != null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
          <TabIntro
            links={[{ label: "Print shipping rates", onClick: () => setConfigTab("catalog") }]}
          />
          <p>
            Selling {enabledCount}
            <span className="text-ink-300"> · </span>
            Printer {reachable}
            {attention > 0 ? (
              <>
                <span className="text-ink-300"> · </span>
                <span className="text-amber-800">{attention} need attention</span>
              </>
            ) : null}
          </p>
          <InfoHint title="What this page does not cover" align="start">
            Countries under comprehensive sanctions are omitted — the payment processor declines them.
            Opening a market here is a fulfillment decision only: tax registration and consumer-law
            obligations in a new country are separate work.
          </InfoHint>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={
              sweeping ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />
            }
            disabled={toolsBusy}
            onClick={() => runSweep(false)}
          >
            {capability.sweptAt ? "Re-check coverage" : "Discover coverage"}
          </Button>
          <OverflowMenu>
            {(close) => (
              <>
                <OverflowItem
                  label="Re-measure everything"
                  busy={busy != null}
                  disabledReason={
                    readOnly
                      ? "Read only"
                      : sweeping
                        ? "Coverage check is running…"
                        : loading
                          ? "Loading…"
                          : null
                  }
                  onSelect={() => {
                    close();
                    void runRemeasure();
                  }}
                />
                <OverflowItem
                  label="Republish catalog"
                  busy={busy != null}
                  disabledReason={readOnly ? "Read only" : null}
                  onSelect={() => {
                    close();
                    void republish();
                  }}
                />
              </>
            )}
          </OverflowMenu>
        </div>
      </div>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-ink-600">
          <Loader2 className="size-4 animate-spin" /> {busy} Leave this tab open — it stops if you
          navigate away.
        </p>
      )}

      {staleProjection ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="flex-1">
            The storefront is serving a catalog published before the latest market, coverage or
            shipping change.
          </span>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Upload className="size-4" />}
            disabled={busy != null}
            onClick={() => void republish()}
          >
            Republish now
          </Button>
        </div>
      ) : capability.sweptAt === 0 ? (
        <p className="text-sm text-amber-800">
          Coverage has never been checked. Discover it to see which of these countries the printer
          actually ships to.
        </p>
      ) : stale ? (
        <p className="text-sm text-amber-800">
          Coverage was last checked {daysSince(capability.sweptAt)} days ago. Re-check before
          treating it as current.
        </p>
      ) : null}

      <MarketOnboardingPanel
        running={onboardingRunning}
        reports={onboardingReports}
        refreshKey={onboardingRefresh}
        onDismiss={(country) =>
          setOnboardingReports((prev) => prev.filter((r) => r.country !== country))
        }
      />

      <EditorTabs
        items={MARKET_PANELS}
        value={panel}
        onChange={(id) => setPanel(id as Panel)}
      />

      {panel === "countries" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search countries"
                className="pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-x-3 text-sm">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    filter === f.id ? "font-medium text-ink-900" : "text-ink-500 hover:text-ink-800",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-ink-400">
              <Loader2 className="size-4 animate-spin" /> Loading markets…
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">No countries match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-400">
                    <th className="pb-2 pr-3 font-medium">Country</th>
                    <th className="pb-2 pr-3 font-medium">Selling</th>
                    <th className="pb-2 pr-3 font-medium">Printer</th>
                    <th className="pb-2 pr-3 font-medium">Speeds</th>
                    <th className="pb-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((country) => (
                    <CountryRow
                      key={country}
                      country={country}
                      enabled={enabled.has(country)}
                      notes={notes.get(country) ?? ""}
                      capability={coverage.get(country)}
                      shipping={shipping}
                      readOnly={readOnly}
                      onToggle={(on) => setMarket(country, { enabled: on })}
                      onNotes={(value) => setMarket(country, { notes: value })}
                      onToggleMethod={(method, sell) => void toggleCountryMethod(country, method, sell)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {panel === "shipping" && <ShippingPolicySection loading={loading} />}

      {panel === "formats" && <FormatCoverageSection markets={[...enabled].sort()} />}

      <AdminSaveBar
        dirty={dirty}
        saving={saving}
        saveLabel="Save markets"
        saveDisabled={readOnly || loading || onboardingRunning != null}
        onSave={() => void save()}
        onDiscard={() => setDraft(stored)}
      />
    </div>
  );
}

/**
 * A row worth an admin's attention: we sell there but the printer says it can't
 * deliver, or we sell there and nobody has ever checked.
 *
 * `unknown` counts. It means the probe failed rather than the provider
 * refusing, and an enabled country with no verdict is exactly the case where an
 * order fails for a reason nothing in the dashboard predicted.
 */
function needsAttention(enabled: boolean, cap: MarketCapability | undefined): boolean {
  if (!enabled) return false;
  return cap == null || cap.status !== "available";
}

function CountryRow({
  country,
  enabled,
  notes,
  capability,
  shipping,
  readOnly,
  onToggle,
  onNotes,
  onToggleMethod,
}: {
  country: string;
  enabled: boolean;
  notes: string;
  capability: MarketCapability | undefined;
  shipping: ShippingSettings;
  readOnly: boolean;
  onToggle: (on: boolean) => void;
  onNotes: (value: string) => void;
  onToggleMethod: (method: ShippingMethod, sell: boolean) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const methods = availableMethodsFor(capability);
  const attention = needsAttention(enabled, capability);
  const vetoed = new Set(shipping.countryOverrides[country]?.disabled ?? []);
  const reason = attention
    ? capability == null
      ? "Selling here, but coverage has never been checked."
      : capability.status === "unknown"
        ? "Selling here, but the last probe failed — re-run the sweep to settle it."
        : `Selling here, but the printer ships nothing to this country.${capability.message ? ` ${capability.message}` : ""}`
    : null;

  return (
    <tr className={cn("border-t border-ink-100 align-top", attention && "bg-amber-50/60")}>
      <td className="py-2 pr-3">
        <div className="font-medium text-ink-800">
          {countryFlag(country)} {countryLabel(country)}{" "}
          <span className="font-normal text-ink-400">{country}</span>
        </div>
        {reason ? <p className="mt-0.5 text-xs text-amber-800">{reason}</p> : null}
        {(STATE_CODE_REQUIRED.has(country) || TAX_ID_REQUIRED.has(country)) && (
          <p className="mt-0.5 text-xs text-ink-400">
            {STATE_CODE_REQUIRED.has(country) ? "State required" : null}
            {STATE_CODE_REQUIRED.has(country) && TAX_ID_REQUIRED.has(country) ? " · " : null}
            {TAX_ID_REQUIRED.has(country) ? `${TAX_ID_LABEL[country]} required` : null}
          </p>
        )}
      </td>
      <td className="py-2 pr-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={readOnly}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Sell to ${countryLabel(country)}`}
          className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
        />
      </td>
      <td className="py-2 pr-3">
        <CoverageBadge capability={capability} />
      </td>
      <td className="py-2 pr-3">
        {methods.length === 0 ? (
          <span className="text-ink-300">—</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {methods.map((method) => {
              const selling = shipping.methods[method]?.offered && !vetoed.has(method);
              const globallyOff = !shipping.methods[method]?.offered;
              return (
                <button
                  key={method}
                  type="button"
                  disabled={readOnly || globallyOff}
                  onClick={() => onToggleMethod(method, !selling)}
                  title={
                    globallyOff
                      ? `${methodLabel(shipping, method)} is switched off for the whole catalog in Shipping.`
                      : selling
                        ? `Selling ${methodLabel(shipping, method)} here. Click to stop offering it in this country only.`
                        : `Not selling ${methodLabel(shipping, method)} here, though the printer runs it. Click to offer it again.`
                  }
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs font-medium transition",
                    globallyOff
                      ? "cursor-not-allowed bg-ink-50 text-ink-300 line-through"
                      : selling
                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "bg-ink-100 text-ink-400 line-through hover:bg-ink-200",
                  )}
                >
                  {methodLabel(shipping, method)}
                </button>
              );
            })}
          </span>
        )}
      </td>
      <td className="py-2">
        {editingNotes ? (
          <Input
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Why this market is open"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            className="text-xs text-ink-400 hover:text-ink-700 hover:underline"
          >
            {notes || "Add"}
          </button>
        )}
      </td>
    </tr>
  );
}

function CoverageBadge({ capability }: { capability: MarketCapability | undefined }) {
  if (!capability) {
    return <Tag tone="muted">not probed</Tag>;
  }
  if (capability.status === "available") {
    return (
      <Tag tone="ok">
        {capability.levels.length} service{capability.levels.length === 1 ? "" : "s"}
      </Tag>
    );
  }
  if (capability.status === "refused") {
    return <Tag tone="bad">no service</Tag>;
  }
  return <Tag tone="muted">unknown</Tag>;
}

function Tag({
  children,
  tone = "muted",
  title,
}: {
  children: React.ReactNode;
  tone?: "ok" | "bad" | "muted";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-emerald-50 text-emerald-700",
        tone === "bad" && "bg-red-50 text-red-600",
        tone === "muted" && "bg-ink-100 text-ink-500",
      )}
    >
      {children}
    </span>
  );
}

/** Compare only what an admin can change, so timestamps don't read as edits. */
function normalizeForCompare(config: MarketsConfig) {
  return config.markets
    .map((m) => ({ country: m.country, enabled: m.enabled, notes: m.notes }))
    .sort((a, b) => a.country.localeCompare(b.country));
}
