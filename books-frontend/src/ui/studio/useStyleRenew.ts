/**
 * Drives a persisted art-style transfer while the studio is open: advances cast
 * → pages once the sheets have landed, clears the plan when everything carries
 * the new style, and reports progress for the Design banner.
 *
 * The state machine reads only the artwork's own style stamps, so it converges
 * no matter how the work actually completed — a resumed session, a duplicate
 * job, or a manual regeneration of one page all count the same.
 */
import { useEffect, useState } from "react";
import { resolveArtStyleLabel } from "../../core/prompts/style";
import type { StyleRenewPlan } from "../../core/types";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useJobsStore } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { notify } from "../lib/notify";
import {
  advanceStyleRenew,
  clearStyleRenew,
  remainingStyleRenew,
  runStyleRenewPhase,
} from "./styleRenew";

/**
 * How long every remaining unit must be absent from the job queue before we
 * call the phase stalled. Covers the gap between enqueuing a job and its task
 * documents appearing, so a healthy start never flashes an error.
 */
const STALL_GRACE_MS = 12_000;

/**
 * Phase transitions already dispatched, keyed by the plan's own start time so a
 * later transfer to the same style still advances. Module-level rather than a
 * ref so a remount (or a second copy of the banner) can't enqueue the page
 * phase twice; a genuine retry goes through `retry`.
 */
const dispatched = new Set<string>();

export interface StyleRenewStatus {
  phase: StyleRenewPlan["phase"];
  styleLabel: string;
  castDone: number;
  castTotal: number;
  pagesDone: number;
  pagesTotal: number;
  /** Units left in the current phase with nothing running for them. */
  stalled: boolean;
  stuckCount: number;
  retry: () => void;
  dismiss: () => void;
}

export function useStyleRenew(): StyleRenewStatus | null {
  const project = useProjectsStore((s) => s.current());
  const activeUnitIds = useJobsStore((s) => s.activeUnitIds);
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const [stalled, setStalled] = useState(false);

  const plan = project?.config.styleRenew;
  const remaining = project && plan ? remainingStyleRenew(project, plan) : null;
  const pending = remaining
    ? plan!.phase === "cast"
      ? remaining.castIds
      : remaining.pageIds
    : [];
  const pendingKey = pending.join(",");
  const castLeft = remaining?.castIds.length ?? 0;
  const pagesLeft = remaining?.pageIds.length ?? 0;

  useEffect(() => {
    if (!project || !plan) return;
    if (plan.phase === "cast" && castLeft > 0) return;
    if (plan.phase === "pages" && pagesLeft > 0) return;
    const step = `${project.id}:${plan.startedAt}:${plan.phase}`;
    if (dispatched.has(step)) return;
    dispatched.add(step);
    if (plan.phase === "cast" && pagesLeft > 0) {
      void advanceStyleRenew(plan, (err) => notify.error(err));
      return;
    }
    void clearStyleRenew().then(() =>
      notify.success("New style applied", "Your cast and pages are all in the new style."),
    );
  }, [project, plan, castLeft, pagesLeft]);

  // Stall detection: something failed (or the tab was closed mid-run) when work
  // remains but nothing is queued for it.
  useEffect(() => {
    if (!plan || pending.length === 0) {
      setStalled(false);
      return;
    }
    if (pending.some((id) => activeUnitIds.has(id))) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), STALL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [plan, pendingKey, activeUnitIds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project || !plan || !remaining) return null;

  const styleLabel = project.config.artStyle?.presetId
    ? resolveArtStyleLabel(project.config.artStyle.presetId, artStyles)
    : "your new style";

  return {
    phase: plan.phase,
    styleLabel,
    castDone: plan.castIds.length - remaining.castIds.length,
    castTotal: plan.castIds.length,
    pagesDone: plan.pageIds.length - remaining.pageIds.length,
    pagesTotal: plan.pageIds.length,
    stalled,
    stuckCount: pending.length,
    retry: () => {
      setStalled(false);
      void runStyleRenewPhase(plan, (err) => notify.error(err));
    },
    dismiss: () => {
      void clearStyleRenew();
    },
  };
}
