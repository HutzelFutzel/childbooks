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

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Globe, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { cn } from "../../lib/cn";
import { countryFlag, countryLabel } from "../../../core/analytics/markets";
import {
  isMeasurable,
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
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { Section, TabIntro } from "./products/parts";

type Filter = "all" | "enabled" | "available" | "mismatch";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All countries" },
  { id: "enabled", label: "Selling" },
  { id: "available", label: "Printer reaches" },
  { id: "mismatch", label: "Needs attention" },
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
  const loadMarketsConfig = useAppConfigStore((s) => s.loadMarketsConfig);
  const saveMarketsConfig = useAppConfigStore((s) => s.saveMarketsConfig);
  const sweep = useAppConfigStore((s) => s.sweepMarketCapability);
  const stored = useAppConfigStore((s) => s.adminMarkets);
  const capability = useAppConfigStore((s) => s.marketCapability);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);

  const [draft, setDraft] = useState<MarketsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    loadMarketsConfig()
      .then((config) => {
        if (alive) setDraft(config);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Could not load markets.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadMarketsConfig]);

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
    try {
      const saved = await saveMarketsConfig(draft);
      setDraft(saved);
      toast.success("Markets saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save markets.");
    } finally {
      setSaving(false);
    }
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

  const enabledCount = enabled.size;
  const reachable = capability.countries.filter((c) => c.status === "available").length;
  const attention = ISO_COUNTRIES.filter(
    (c) => !SANCTIONS_DENYLIST.has(c) && needsAttention(enabled.has(c), coverage.get(c)),
  ).length;
  const stale = capability.sweptAt > 0 && Date.now() - capability.sweptAt > SWEEP_STALE_AFTER_MS;
  // Open markets calibration can't measure a fallback rate for. They still sell,
  // but only while the live quote answers — worth naming here because the
  // symptom otherwise appears as an unpriceable order on a product page.
  const liveQuoteOnly = useMemo(
    () => [...enabled].filter((c) => !isMeasurable(c)).sort(),
    [enabled],
  );

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere="Which countries a specific book ships to — and the shipping speeds and rates it offers — stay on that product, under Catalog → Print books → Shipping. This tab only decides which countries are available to choose from at all."
        links={[{ label: "Catalog", onClick: () => setConfigTab("catalog") }]}
      >
        The countries we sell to. A country switched off here can&apos;t be ordered to by anyone,
        whatever a product claims — the server enforces this list as a ceiling on every product&apos;s
        own geo policy. Switching one on is safe to do gradually: it only makes the country
        selectable, and orders to it still have to price successfully before they can be placed.
      </TabIntro>

      <div className="flex flex-wrap items-center gap-2">
        <Stat icon={<Globe className="size-4" />} label="Selling to" value={`${enabledCount} countries`} />
        <Stat label="Printer reaches" value={`${reachable} probed`} />
        {attention > 0 && (
          <Stat tone="warn" label="Needs attention" value={`${attention} countries`} />
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={sweeping ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            disabled={sweeping}
            onClick={() => runSweep(false)}
          >
            {capability.sweptAt ? "Re-check coverage" : "Discover coverage"}
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save markets"}
          </Button>
        </div>
      </div>

      {capability.sweptAt === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-100">
          Coverage has never been discovered. Run it once to find out which of these countries the
          printer actually ships to — it asks about every country in turn, so it takes a couple of
          minutes. Until then a country can still be switched on; you just won&apos;t know in advance
          whether an order to it can be fulfilled.
        </p>
      )}

      {stale && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-100">
          Coverage was last checked {daysSince(capability.sweptAt)} days ago. The printer drops and
          adds countries without telling us, so re-check before treating any of this as current.
        </p>
      )}

      {liveQuoteOnly.length > 0 && (
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-600 ring-1 ring-inset ring-ink-100">
          <span className="font-medium">Live quote only:</span>{" "}
          {liveQuoteOnly.map((c) => countryLabel(c)).join(", ")}. Cost calibration has no probe
          address for these, so no fallback shipping rate can be measured. Orders still work while
          the printer answers a live quote, but a product that charges the shipping it pays will
          refuse the order if that call fails. Adding a probe address is a code change
          (<code>PROBE_ADDRESS</code> in <code>core/config/countries.ts</code>), after which
          &ldquo;Measure cost from the provider&rdquo; will cover them.
        </p>
      )}

      <Section
        title="Countries"
        hint="Enabled means orderable. Coverage is what the printer answered when it was last asked — evidence, not a setting."
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                  filter === f.id
                    ? "bg-brand-600 text-white"
                    : "bg-white text-ink-500 ring-1 ring-inset ring-ink-200 hover:bg-ink-50",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries"
            className="pl-8"
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-400">
            <Loader2 className="size-4 animate-spin" /> Loading markets…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-ink-400">No countries match.</div>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-lg bg-white ring-1 ring-inset ring-ink-100">
            {rows.map((country) => (
              <CountryRow
                key={country}
                country={country}
                enabled={enabled.has(country)}
                notes={notes.get(country) ?? ""}
                capability={coverage.get(country)}
                onToggle={(on) => setMarket(country, { enabled: on })}
                onNotes={(value) => setMarket(country, { notes: value })}
              />
            ))}
          </ul>
        )}
      </Section>

      <p className="text-[10px] leading-relaxed text-ink-400">
        Countries under comprehensive sanctions are omitted entirely — the payment processor declines
        them and serving them breaches its terms, so they aren&apos;t ours to switch on. Opening a
        market here is a fulfillment decision only: tax registration and consumer-law obligations in
        a new country are separate work and are not tracked on this screen.
      </p>
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
  onToggle,
  onNotes,
}: {
  country: string;
  enabled: boolean;
  notes: string;
  capability: MarketCapability | undefined;
  onToggle: (on: boolean) => void;
  onNotes: (value: string) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const methods = availableMethodsFor(capability);
  const attention = needsAttention(enabled, capability);

  return (
    <li className={cn("px-3 py-2", attention && "bg-amber-50/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label className="flex w-64 min-w-0 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
          />
          <span className="truncate">
            {countryFlag(country)} {countryLabel(country)}
          </span>
          <span className="shrink-0 text-[10px] text-ink-300">{country}</span>
        </label>

        <CoverageBadge capability={capability} />

        {methods.length > 0 && (
          <span className="text-[11px] text-ink-400">{methods.join(", ")}</span>
        )}

        {STATE_CODE_REQUIRED.has(country) && (
          <Tag title="The carrier rejects an address here without a state or province code.">
            state required
          </Tag>
        )}
        {TAX_ID_REQUIRED.has(country) && (
          <Tag title={`Customs here needs the recipient's ${TAX_ID_LABEL[country]}. Checkout asks for it.`}>
            {TAX_ID_LABEL[country]} required
          </Tag>
        )}
        {enabled && !isMeasurable(country) && (
          <Tag title="No probe address, so cost calibration can't measure a fallback shipping rate here. Orders depend on the live quote succeeding.">
            live quote only
          </Tag>
        )}

        <button
          type="button"
          onClick={() => setEditingNotes((v) => !v)}
          className="ml-auto shrink-0 text-[11px] text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline"
        >
          {notes ? "Note" : "Add note"}
        </button>
      </div>

      {attention && (
        <p className="mt-1 pl-6 text-[11px] text-amber-800">
          {capability == null
            ? "Selling here, but coverage has never been checked."
            : capability.status === "unknown"
              ? "Selling here, but the last probe failed — re-run the sweep to settle it."
              : `Selling here, but the printer ships nothing to this country.${capability.message ? ` ${capability.message}` : ""}`}
        </p>
      )}

      {editingNotes && (
        <div className="mt-1.5 pl-6">
          <Input
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Why this market is open, what to watch"
          />
        </div>
      )}
      {!editingNotes && notes && (
        <p className="mt-1 pl-6 text-[11px] italic text-ink-400">{notes}</p>
      )}
    </li>
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
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
        tone === "ok" && "bg-emerald-50 text-emerald-700",
        tone === "bad" && "bg-red-50 text-red-600",
        tone === "muted" && "bg-ink-100 text-ink-500",
      )}
    >
      {children}
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ring-1 ring-inset",
        tone === "warn"
          ? "bg-amber-50 text-amber-800 ring-amber-100"
          : "bg-white text-ink-600 ring-ink-100",
      )}
    >
      {icon}
      <span className="text-ink-400">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

/** Compare only what an admin can change, so timestamps don't read as edits. */
function normalizeForCompare(config: MarketsConfig) {
  return config.markets
    .map((m) => ({ country: m.country, enabled: m.enabled, notes: m.notes }))
    .sort((a, b) => a.country.localeCompare(b.country));
}
