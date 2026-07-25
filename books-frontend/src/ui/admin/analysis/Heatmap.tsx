"use client";

/**
 * Weekday × hour activity.
 *
 * Four things make this readable rather than decorative:
 *
 *  1. **Local time.** In `market` mode the server buckets each event in the
 *     timezone of the market it came from, so the curve says "people act at
 *     20:00 THEIR time" instead of averaging a global audience into mush.
 *  2. **One metric at a time.** Signups and logins answer different questions;
 *     merging them into a single grid (the old behaviour) made a spike
 *     unattributable to either.
 *  3. **People, not just events.** A distinct-user mode stops one power user's
 *     refresh habit from painting a busy hour.
 *  4. **Choosable normalization.** Scaling every cell against the global peak
 *     hides all internal structure whenever one cell dominates; per-row and
 *     per-column modes reveal the shape within a day or within an hour.
 */
import { useState } from "react";
import type { ActivityGrid, TimezoneMode } from "../../../core/analytics/types";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { Tabs } from "../../components/Tabs";
import { WEEKDAYS, fmtNumber } from "./format";

type Normalization = "global" | "row" | "column";

const NORMALIZATIONS: { id: Normalization; label: string }[] = [
  { id: "global", label: "Absolute" },
  { id: "row", label: "Per day" },
  { id: "column", label: "Per hour" },
];

/** Per-cell divisor for the chosen normalization. */
function scaleFor(matrix: number[][], mode: Normalization): (day: number, hour: number) => number {
  if (mode === "row") {
    const rowMax = matrix.map((row) => Math.max(...row, 0));
    return (day) => rowMax[day] || 0;
  }
  if (mode === "column") {
    const colMax = new Array<number>(24).fill(0);
    for (const row of matrix) {
      for (let h = 0; h < 24; h += 1) if (row[h] > colMax[h]) colMax[h] = row[h];
    }
    return (_day, hour) => colMax[hour] || 0;
  }
  let max = 0;
  for (const row of matrix) for (const v of row) if (v > max) max = v;
  return () => max;
}

export function Heatmap({
  grid,
  timezone,
  tzMode,
  countUniqueUsers,
  metricLabel,
}: {
  grid: ActivityGrid;
  timezone: string;
  tzMode: TimezoneMode;
  countUniqueUsers: boolean;
  metricLabel: string;
}) {
  const [normalization, setNormalization] = useState<Normalization>("global");
  const matrix = countUniqueUsers ? grid.users : grid.events;
  const scale = scaleFor(matrix, normalization);
  const unit = countUniqueUsers ? "users" : "events";

  const rowTotals = countUniqueUsers ? grid.usersByWeekday : grid.byWeekday;
  const colTotals = countUniqueUsers ? grid.usersByHour : grid.byHour;
  const busiest = busiestCell(matrix);

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 py-3.5">
        <div>
          <CardTitle className="text-sm">{metricLabel} by weekday &amp; hour</CardTitle>
          <p className="mt-0.5 text-xs text-ink-400">
            {tzMode === "market"
              ? "Each event in its own market's local time — the hour it was for the person."
              : `All events in ${timezone}.`}
            {busiest && (
              <>
                {" "}Peak: <span className="font-medium text-ink-600">
                  {WEEKDAYS[busiest.day]} {String(busiest.hour).padStart(2, "0")}:00
                </span>{" "}
                ({fmtNumber(busiest.value)} {unit}).
              </>
            )}
          </p>
        </div>
        <Tabs
          items={NORMALIZATIONS}
          value={normalization}
          onChange={(id) => setNormalization(id as Normalization)}
        />
      </CardHeader>
      <CardBody className="overflow-x-auto pt-2">
        <div className="min-w-[640px]">
          {/* Hour axis */}
          <div className="mb-1 flex pl-9 pr-14">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center text-[9px] text-ink-400">
                {h % 3 === 0 ? h : ""}
              </div>
            ))}
          </div>
          {matrix.map((row, day) => (
            <div key={day} className="mb-1 flex items-center">
              <div className="w-9 shrink-0 text-[10px] font-medium text-ink-500">{WEEKDAYS[day]}</div>
              <div className="flex flex-1 gap-0.5">
                {row.map((value, hour) => {
                  const max = scale(day, hour);
                  const intensity = max > 0 ? value / max : 0;
                  return (
                    <div
                      key={hour}
                      title={`${WEEKDAYS[day]} ${String(hour).padStart(2, "0")}:00 — ${fmtNumber(value)} ${unit}`}
                      className="aspect-square flex-1 rounded-[3px]"
                      style={{
                        backgroundColor:
                          value === 0 ? "#f1f3f5" : `rgba(99,102,241,${0.15 + intensity * 0.85})`,
                      }}
                    />
                  );
                })}
              </div>
              {/* Row marginal — the day's own total, independent of colour scale. */}
              <div className="w-14 shrink-0 pl-2 text-right text-[10px] tabular-nums text-ink-400">
                {fmtNumber(rowTotals[day] ?? 0)}
              </div>
            </div>
          ))}
          {/* Column marginals */}
          <div className="mt-1 flex items-center border-t border-ink-100 pt-1.5">
            <div className="w-9 shrink-0 text-[9px] font-medium uppercase tracking-wide text-ink-400">
              All
            </div>
            <div className="flex flex-1 gap-0.5">
              {colTotals.map((total, hour) => (
                <div
                  key={hour}
                  className="flex-1 text-center text-[8px] tabular-nums text-ink-400"
                  title={`${String(hour).padStart(2, "0")}:00 — ${fmtNumber(total)} ${unit}`}
                >
                  {hour % 3 === 0 ? compact(total) : ""}
                </div>
              ))}
            </div>
            <div className="w-14 shrink-0" />
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 pr-1 text-[10px] text-ink-400">
            <span>{normalization === "global" ? "Less" : "Quiet for this slice"}</span>
            {[0, 0.25, 0.5, 0.75, 1].map((i) => (
              <span
                key={i}
                className="size-3 rounded-[3px]"
                style={{ backgroundColor: i === 0 ? "#f1f3f5" : `rgba(99,102,241,${0.15 + i * 0.85})` }}
              />
            ))}
            <span>{normalization === "global" ? "More" : "Busy for this slice"}</span>
          </div>
        </div>
      </CardBody>
    </div>
  );
}

function busiestCell(matrix: number[][]): { day: number; hour: number; value: number } | null {
  let best: { day: number; hour: number; value: number } | null = null;
  matrix.forEach((row, day) =>
    row.forEach((value, hour) => {
      if (value > 0 && (!best || value > best.value)) best = { day, hour, value };
    }),
  );
  return best;
}

/** Compact axis labels so the marginal row doesn't overflow its cells. */
function compact(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
