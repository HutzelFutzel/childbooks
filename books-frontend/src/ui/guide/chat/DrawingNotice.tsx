"use client";

/**
 * Shown once Draw the book is running: how long it takes, that the reader may
 * leave, and whether to email them when it's done. The book is drawn on the
 * server either way; staying only means watching the pages arrive.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Mail, X } from "lucide-react";
import type { Project } from "../../../core/types";
import { JOB_TASK_CONCURRENCY } from "../../../core/jobs/types";
import { estimateJobRange, formatDurationRange } from "../../../core/config/latencyStats";
import { CUSTOMER_IMAGE_TIER } from "../../../core/config/modelConfig";
import { authoringOf } from "../../../core/guide/projectState";
import { setBookJobNotify } from "../../../platform/jobs";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { drawBookUnits } from "../../../state/chatGeneration";
import { useJobsStore } from "../../../state/jobsStore";
import { useGuideT } from "../intl";

const DISMISSED_KEY = "drawNoticeDismissed";

function wasDismissed(jobId: string): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === jobId;
  } catch {
    return false;
  }
}

export function DrawingNotice({ project }: { project: Project }) {
  const t = useGuideT("chrome");
  const router = useRouter();
  const run = authoringOf(project).drawBook;
  const jobId = run?.jobId;
  const drawing = run?.phase === "cast" || run?.phase === "pages";
  const job = useJobsStore((s) => (jobId ? s.active.find((j) => j.id === jobId) : undefined));
  const notify = useJobsStore((s) => (jobId ? s.jobStatus[jobId]?.notify ?? true : true));
  const latencyStats = useAppConfigStore((s) => s.latencyStats);
  const [dismissed, setDismissed] = useState(() => (jobId ? wasDismissed(jobId) : false));

  // Sheets are drawn before the pages that use them, so the two waves add up.
  const eta = useMemo(() => {
    if (!drawing) return null;
    const units = drawBookUnits(project);
    const sheets = units.filter((u) => u.action === "anchorImage").length;
    const pictures = units.length - sheets;
    if (units.length === 0) return null;
    const parts = [
      sheets > 0 ? estimateJobRange(latencyStats, "anchorImage", CUSTOMER_IMAGE_TIER, sheets, JOB_TASK_CONCURRENCY) : null,
      pictures > 0
        ? estimateJobRange(latencyStats, "pageIllustration", CUSTOMER_IMAGE_TIER, pictures, JOB_TASK_CONCURRENCY)
        : null,
    ].filter((r): r is NonNullable<typeof r> => r != null);
    return formatDurationRange({
      minMs: parts.reduce((sum, r) => sum + r.minMs, 0),
      maxMs: parts.reduce((sum, r) => sum + r.maxMs, 0),
    }).replace(/^~/, "");
    // The estimate is for the run as it started, not re-derived per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, jobId, latencyStats]);

  if (!drawing || !jobId || dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, jobId);
    } catch {
      // Private mode: the notice just comes back on reload.
    }
    setDismissed(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex w-full flex-col gap-2.5 rounded-xl border border-ink-100 bg-white/90 p-3 text-sm shadow-xs"
      role="status"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("drawStay")}
        className="absolute top-2 right-2 rounded-md p-1 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
      >
        <X className="size-4" />
      </button>
      <div className="pr-6">
        <p className="font-semibold text-ink-900">{t("drawStartedTitle")}</p>
        <p className="mt-0.5 text-ink-600">
          {eta ? t("drawStartedEta", { time: eta }) : t("drawStartedNoEta")}
        </p>
        {job && job.total > 0 && (
          <p className="mt-1 text-xs text-ink-500 tabular-nums">
            {t("drawProgress", { done: job.completed, total: job.total })}
          </p>
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-ink-700">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => void setBookJobNotify(jobId, e.target.checked).catch(() => {})}
          className="size-4 rounded border-ink-300 accent-brand-500"
        />
        <Mail className="size-3.5 text-ink-400" aria-hidden />
        {t("drawEmailMe")}
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex min-h-10 items-center rounded-full border border-ink-200 bg-white px-4 font-medium text-ink-800 transition hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
        >
          {t("drawStay")}
        </button>
        <button
          type="button"
          onClick={() => {
            dismiss();
            router.push("/studio");
          }}
          className="inline-flex min-h-10 items-center rounded-full bg-ink-900 px-4 font-medium text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          {t("drawLeave")}
        </button>
      </div>
    </motion.div>
  );
}
