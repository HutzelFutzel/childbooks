"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useJobsStore } from "@/state/jobsStore";
import { useAppConfigStore } from "@/state/appConfigStore";
import { JOB_TASK_CONCURRENCY } from "@/core/jobs/types";
import {
  estimateJobRange,
  formatDurationRange,
  type DurationRange,
} from "@/core/config/latencyStats";

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A 2px coral thread along the bottom edge of the workspace bar that fills as
 * generation tasks finish: the book is being made. Renders nothing when idle.
 * Mount inside a `relative` header.
 */
export function JobThread() {
  const active = useJobsStore((s) => s.active);
  if (active.length === 0) return null;
  const total = active.reduce((n, j) => n + j.total, 0);
  const done = active.reduce((n, j) => n + j.completed + j.failed, 0);
  const pct = total > 0 ? Math.min(100, Math.max(4, (done / total) * 100)) : 4;
  return (
    <div
      role="progressbar"
      aria-label="Generation progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] bg-brand-600/12"
    >
      <div
        className="h-full bg-brand-600 transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Compact indicator for in-flight generation jobs. Because generation runs
 * server-side, this stays accurate even across refreshes and reflects work the
 * worker is doing in the background. Shows a live time estimate (from the
 * rolling latency window) next to the elapsed time, and flags when a job is
 * taking longer than usual.
 */
export function JobProgress() {
  const active = useJobsStore((s) => s.active);
  const latencyStats = useAppConfigStore((s) => s.latencyStats);
  const [now, setNow] = useState(() => Date.now());

  const running = active.length > 0;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (!running) return null;

  const total = active.reduce((n, j) => n + j.total, 0);
  const completed = active.reduce((n, j) => n + j.completed, 0);
  const failed = active.reduce((n, j) => n + j.failed, 0);

  // Estimate: the max across active jobs (they run in parallel on the worker),
  // each modeled as dispatch + waves of tasks. Elapsed from the oldest job.
  let estimate: DurationRange | null = null;
  let startedAt = Number.POSITIVE_INFINITY;
  for (const j of active) {
    const r = estimateJobRange(
      latencyStats,
      j.action,
      j.tier,
      j.total,
      JOB_TASK_CONCURRENCY,
    );
    if (!estimate || r.maxMs > estimate.maxMs) estimate = r;
    if (j.createdAt < startedAt) startedAt = j.createdAt;
  }
  const elapsedMs = Number.isFinite(startedAt) ? now - startedAt : 0;
  const overdue = estimate != null && elapsedMs > estimate.maxMs * 1.25;

  return (
    <div className="flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
      <Loader2 className="size-3.5 animate-spin" />
      <span>
        Generating {completed}/{total}
        {failed > 0 ? ` · ${failed} failed` : ""}
      </span>
      <span className="text-brand-500">
        {formatElapsed(elapsedMs)}
        {estimate && !overdue ? ` / ${formatDurationRange(estimate)}` : ""}
        {overdue ? " · taking longer than usual" : ""}
      </span>
    </div>
  );
}
