"use client";

/**
 * Per-market breakdown of the selected window.
 *
 * Rows are clickable: picking one scopes the ENTIRE dashboard to that market,
 * which is the point of the card — it's a launcher for a market deep-dive, not
 * just a table. Each row shows the market's local timezone because that's the
 * clock its hour-of-day curve is drawn in.
 */
import { countryFlag, countryLabel, UNKNOWN_COUNTRY } from "../../../core/analytics/markets";
import type { CountryActivity } from "../../../core/analytics/types";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { cn } from "../../lib/cn";
import { fmtNumber } from "./format";

export function MarketsCard({
  countries,
  selected,
  onSelect,
}: {
  countries: CountryActivity[];
  selected: string | null;
  onSelect: (country: string | null) => void;
}) {
  const rows = countries.filter((c) => c.totalUsers > 0 || c.signups > 0 || c.activeUsers > 0);
  const maxUsers = Math.max(1, ...rows.map((r) => r.totalUsers));

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Markets</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">
          Click a market to scope the whole dashboard to it.
        </p>
      </CardHeader>
      <CardBody className="pt-1">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">No market data yet.</p>
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs text-ink-400">
                  <th className="py-2 font-medium">Market</th>
                  <th className="py-2 text-right font-medium">Accounts</th>
                  <th className="py-2 text-right font-medium">Signups</th>
                  <th className="py-2 text-right font-medium">Active</th>
                  <th className="py-2 pl-3 text-right font-medium">Local time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.country}
                    onClick={() => onSelect(selected === c.country ? null : c.country)}
                    className={cn(
                      "cursor-pointer border-t border-ink-50 transition hover:bg-brand-50/40",
                      selected === c.country && "bg-brand-50/70",
                    )}
                  >
                    <td className="py-2">
                      <span className="mr-1.5">{countryFlag(c.country)}</span>
                      <span className="text-ink-700">{countryLabel(c.country)}</span>
                      {/* Share bar: relative size at a glance, no second column. */}
                      <span className="ml-2 inline-block h-1 w-16 overflow-hidden rounded-full bg-ink-100 align-middle">
                        <span
                          className="block h-full rounded-full bg-brand-400"
                          style={{ width: `${Math.round((c.totalUsers / maxUsers) * 100)}%` }}
                        />
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-800">
                      {fmtNumber(c.totalUsers)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-emerald-600">
                      {c.signups > 0 ? fmtNumber(c.signups) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-600">
                      {c.activeUsers > 0 ? fmtNumber(c.activeUsers) : "—"}
                    </td>
                    <td className="py-2 pl-3 text-right text-xs text-ink-400">
                      {c.country === UNKNOWN_COUNTRY
                        ? "—"
                        : c.timezone.split("/").pop()?.replace(/_/g, " ")}
                      {c.timezoneApproximate && (
                        <span title="This market spans several timezones, so its hour-of-day curve is approximate.">
                          {" "}~
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </div>
  );
}
