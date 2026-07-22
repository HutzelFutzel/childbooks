/**
 * Shared "book-level generation" state + actions: what's still missing, what's
 * gone stale, and the two batch actions that fix it (generate everything /
 * update stale). Used by the canvas toolbar's next-action chip and the Book
 * panel in the context rail, so both surfaces stay in perfect agreement.
 */
import { useMemo, useState } from "react";
import { isAbortError } from "../../core/errors";
import {
  currentAnchorImage,
  currentIllustration,
  staleAnchorIds,
  staleIllustrationSpreadIds,
} from "../../state/ai";
import { useProjectsStore } from "../../state/projectsStore";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { useImageBatchRange } from "../layout/SparkCost";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import {
  generateAllAnchors,
  generateAllPages,
  illustrationUnits,
  refreshStalePages,
  updateStaleAnchors,
} from "./studioGen";

export function useBookGeneration() {
  const {
    project,
    busy,
    setBusy,
    setAnchorGenerating,
    setPageGenerating,
    startGeneration,
    cancelGeneration,
  } = useStudio();
  const models = useResolvedModels();
  const [refreshing, setRefreshing] = useState(false);

  // Staleness scans every version tree; memoize per project snapshot.
  const stalePageCount = useMemo(() => staleIllustrationSpreadIds(project).length, [project]);
  const stale = useMemo(() => new Set(staleAnchorIds(project)), [project]);

  const anchors = (project.anchors ?? []).filter((a) => a.include);
  const anchorsReady = anchors.filter((a) => currentAnchorImage(a)).length;
  const staleAnchorCount = anchors.filter((a) => stale.has(a.id) && currentAnchorImage(a)).length;

  const units = illustrationUnits(project);
  const pagesReady = units.filter((s) => currentIllustration(project, s.id)).length;

  const pendingAnchors = Math.max(0, anchors.length - anchorsReady);
  const pendingPages = Math.max(0, units.length - pagesReady);
  const pendingCount = pendingAnchors + pendingPages;
  const staleCount = stalePageCount + staleAnchorCount;

  const everythingDone =
    anchors.length > 0 && anchorsReady === anchors.length && units.length > 0 && pagesReady === units.length;

  const batchRange = useImageBatchRange([
    { action: "anchorImage", count: pendingAnchors },
    { action: "pageIllustration", count: pendingPages },
  ]);

  async function generateEverything() {
    if (!models) {
      notify.error("AI generation isn't available yet — it's being set up on the server.");
      return;
    }
    const signal = startGeneration();
    let failures = 0;
    const onError = (err: unknown) => {
      if (isAbortError(err)) return; // cancellations are not failures
      failures += 1;
      notify.error(err);
    };
    setBusy(true);
    try {
      await generateAllAnchors(useProjectsStore.getState().current()!, setAnchorGenerating, onError, signal);
      if (!signal.aborted) {
        await generateAllPages(useProjectsStore.getState().current()!, setPageGenerating, onError, signal);
      }

      if (signal.aborted) {
        notify.info("Generation cancelled", "Anything already finished was kept.");
      } else if (failures === 0) {
        notify.success("Your book is generated", "Tap any page to refine the art or layout.");
      } else {
        notify.info(
          "Finished with some errors",
          `${failures} item${failures === 1 ? "" : "s"} couldn't be generated — retry them individually.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Update everything stale in the right ORDER: first re-render outdated anchor
   * sheets (waiting for their results, since the pages must reference the NEW
   * sheets), then queue the stale pages — including any that only became stale
   * because of the anchor updates in step one.
   */
  async function refreshStale() {
    if (!models) {
      notify.error("AI generation isn't available yet — it's being set up on the server.");
      return;
    }
    setRefreshing(true);
    try {
      const updatedAnchors = await updateStaleAnchors(
        useProjectsStore.getState().current()!,
        (err) => notify.error(err),
      );
      if (updatedAnchors > 0) {
        notify.info(
          "References updated",
          `${updatedAnchors} reference sheet${updatedAnchors === 1 ? "" : "s"} re-rendered — now updating the affected pages.`,
        );
      }
      const queued = await refreshStalePages(
        useProjectsStore.getState().current()!,
        (err) => notify.error(err),
      );
      if (queued > 0) {
        notify.info(
          "Updating pages",
          `${queued} stale page${queued === 1 ? "" : "s"} are re-rendering in the background — they'll update as each finishes.`,
        );
      }
    } finally {
      setRefreshing(false);
    }
  }

  return {
    modelsReady: Boolean(models),
    busy,
    refreshing,
    anchorsTotal: anchors.length,
    anchorsReady,
    pagesTotal: units.length,
    pagesReady,
    pendingCount,
    staleAnchorCount,
    stalePageCount,
    staleCount,
    everythingDone,
    batchRange,
    generateEverything,
    refreshStale,
    cancelGeneration,
  };
}
