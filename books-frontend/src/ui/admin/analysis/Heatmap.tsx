import type { AnalyticsOverview } from "../../../core/analytics/types";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { WEEKDAYS, fmtNumber } from "./format";

/**
 * Weekday × hour activity heatmap. A plain CSS grid of cells whose background
 * opacity scales with the bucket value — sharper and lighter than a charting
 * lib's heatmap, and trivially responsive.
 */
export function Heatmap({ overview }: { overview: AnalyticsOverview }) {
  const matrix = overview.weekdayHour;
  let max = 0;
  for (const row of matrix) for (const v of row) if (v > max) max = v;

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Usage by weekday &amp; hour</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">Times shown in {overview.timezone}.</p>
      </CardHeader>
      <CardBody className="overflow-x-auto pt-2">
        <div className="min-w-[560px]">
          {/* Hour axis */}
          <div className="mb-1 flex pl-9">
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
                  const intensity = max > 0 ? value / max : 0;
                  return (
                    <div
                      key={hour}
                      title={`${WEEKDAYS[day]} ${hour}:00 — ${fmtNumber(value)} events`}
                      className="aspect-square flex-1 rounded-[3px]"
                      style={{
                        backgroundColor:
                          value === 0 ? "#f1f3f5" : `rgba(99,102,241,${0.15 + intensity * 0.85})`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {/* Legend */}
          <div className="mt-3 flex items-center justify-end gap-2 pr-1 text-[10px] text-ink-400">
            <span>Less</span>
            {[0, 0.25, 0.5, 0.75, 1].map((i) => (
              <span
                key={i}
                className="size-3 rounded-[3px]"
                style={{ backgroundColor: i === 0 ? "#f1f3f5" : `rgba(99,102,241,${0.15 + i * 0.85})` }}
              />
            ))}
            <span>More</span>
          </div>
        </div>
      </CardBody>
    </div>
  );
}
