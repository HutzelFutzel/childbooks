"use client";

/**
 * The dashboard-wide market filter.
 *
 * Renders every market present in the data (plus "All markets" and, when it has
 * traffic, the unattributed bucket) with the account count as context, so the
 * admin can tell a real market from a rounding error before clicking into it.
 */
import { Globe } from "lucide-react";
import { countryFlag, countryLabel, UNKNOWN_COUNTRY } from "../../../core/analytics/markets";
import type { CountryActivity } from "../../../core/analytics/types";
import { fmtNumber } from "./format";

export function MarketPicker({
  value,
  markets,
  onChange,
  disabled,
}: {
  value: string | null;
  markets: CountryActivity[];
  onChange: (country: string | null) => void;
  disabled?: boolean;
}) {
  // A market with no accounts and no activity is noise in a picker.
  const options = markets.filter((m) => m.totalUsers > 0 || m.signups > 0 || m.activeUsers > 0);
  const selected = value ? markets.find((m) => m.country === value) : null;

  return (
    <div className="flex items-center gap-2">
      <Globe className="size-4 shrink-0 text-ink-400" />
      <select
        value={value ?? "all"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "all" ? null : e.target.value)}
        className="h-9 max-w-[220px] rounded-lg bg-white px-2.5 text-sm text-ink-700 ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
      >
        <option value="all">All markets</option>
        {options.map((m) => (
          <option key={m.country} value={m.country}>
            {countryFlag(m.country)} {countryLabel(m.country)} · {fmtNumber(m.totalUsers)}
          </option>
        ))}
      </select>
      {selected && selected.country !== UNKNOWN_COUNTRY && (
        <span className="hidden text-xs text-ink-400 sm:inline">
          local time {selected.timezone.split("/").pop()?.replace(/_/g, " ")}
          {selected.timezoneApproximate && " (approx.)"}
        </span>
      )}
    </div>
  );
}
