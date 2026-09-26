"use client";

/**
 * Print preflight, run continuously once the pages exist. Silent when the book
 * passes; otherwise the first real problem is handed to the journey, which
 * puts that page and its smallest fix in the well.
 */
import { useEffect, useMemo } from "react";
import { bookProductForConfig } from "../../../core/book";
import { unitIsDone } from "../../../core/book/pageCompletion";
import { illustrationUnits } from "../../../core/book/units";
import { interiorLeafPlan } from "../../../core/print/pagePlan";
import { preflightInterior, type PreflightCode } from "../../../core/print/preflight";
import type { Project } from "../../../core/types";
import { getCursor } from "../../../core/versioning";
import { useChatStudio } from "../../../state/chatStudio";
import { useStudio } from "../../studio/StudioContext";
import { pageNumberOf } from "./units";

/** A line crossing the fold can be deliberate; the others print wrong. */
const BLOCKING: ReadonlySet<PreflightCode> = new Set(["text-outside-safe-area", "page-has-no-artwork"]);

export function usePrintCheck(project: Project, active: boolean): void {
  const { design, pages } = useStudio();
  const setPrintIssue = useChatStudio((s) => s.setPrintIssue);

  const issue = useMemo(() => {
    if (!active || !project.screenplay) return null;
    const doc = getCursor(project.screenplay).content;
    const units = illustrationUnits(project);
    const found = preflightInterior({
      plan: interiorLeafPlan(doc),
      design,
      product: bookProductForConfig(project.config),
      hasArtwork: (pageId) => {
        if (pages.find((p) => p.id === pageId)?.blobId) return true;
        const unit = units.find((u) => u.id === pageId);
        return unit ? unitIsDone(project, unit) : false;
      },
      labelFor: (pageId) => pages.find((p) => p.id === pageId)?.label ?? "A page",
    }).find((i) => BLOCKING.has(i.code));
    return found ? { unitId: found.pageId, page: pageNumberOf(project, found.pageId), message: found.message } : null;
  }, [active, project, design, pages]);

  const key = issue ? `${issue.unitId}:${issue.message}` : "";
  useEffect(() => {
    setPrintIssue(issue);
    // Keyed on the problem, so an unchanged result doesn't re-render the journey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setPrintIssue]);
  useEffect(() => () => setPrintIssue(null), [setPrintIssue]);
}
