"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Tabs } from "../../components/Tabs";
import type { Timeframe } from "../../../core/analytics/types";
import { toDateInput } from "./format";

const PRESETS: { id: Timeframe; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
];

/**
 * Timeframe presets with an opt-in custom window.
 *
 * The presets cover the daily question ("what happened today"); the custom
 * range covers the one they can't ("what did the launch week look like"), which
 * is exactly when someone reaches for this dashboard.
 */
export function RangePicker({
  timeframe,
  from,
  to,
  onPreset,
  onRange,
}: {
  timeframe: Timeframe;
  from: number;
  to: number;
  onPreset: (tf: Timeframe) => void;
  onRange: (from: number, to: number) => void;
}) {
  const custom = timeframe === "custom";
  const [open, setOpen] = useState(custom);
  const [fromDraft, setFromDraft] = useState(() => toDateInput(from));
  const [toDraft, setToDraft] = useState(() => toDateInput(to));

  const apply = () => {
    const start = new Date(`${fromDraft}T00:00:00`).getTime();
    // Inclusive end day: a range of Jun 1 – Jun 1 must contain all of Jun 1.
    const end = new Date(`${toDraft}T23:59:59.999`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    onRange(start, end);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        items={[...PRESETS, ...(custom ? [{ id: "custom" as Timeframe, label: "Custom" }] : [])]}
        value={timeframe}
        onChange={(id) => onPreset(id as Timeframe)}
      />
      {open ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            className="h-9 w-36 text-xs"
            aria-label="From date"
          />
          <span className="text-xs text-ink-400">→</span>
          <Input
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            className="h-9 w-36 text-xs"
            aria-label="To date"
          />
          <Button variant="secondary" size="sm" onClick={apply}>
            Apply
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<CalendarRange className="size-4" />}
          onClick={() => setOpen(true)}
        >
          Custom range
        </Button>
      )}
    </div>
  );
}
