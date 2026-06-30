"use client";

import { Loader2 } from "lucide-react";
import { useJobsStore } from "@/state/jobsStore";

/**
 * Compact indicator for in-flight generation jobs. Because generation runs
 * server-side, this stays accurate even across refreshes and reflects work the
 * worker is doing in the background.
 */
export function JobProgress() {
  const active = useJobsStore((s) => s.active);
  if (active.length === 0) return null;

  const total = active.reduce((n, j) => n + j.total, 0);
  const completed = active.reduce((n, j) => n + j.completed, 0);
  const failed = active.reduce((n, j) => n + j.failed, 0);

  return (
    <div className="flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
      <Loader2 className="size-3.5 animate-spin" />
      <span>
        Generating {completed}/{total}
        {failed > 0 ? ` · ${failed} failed` : ""}
      </span>
    </div>
  );
}
