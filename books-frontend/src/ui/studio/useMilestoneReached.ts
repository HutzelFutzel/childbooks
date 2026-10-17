/**
 * Milestones only the browser can see, reported to the book's server-side record.
 *
 * Kept apart from the flow beacon (`useFlowAttribution`) because they outlive it:
 * the beacon exists to tell the two studios apart and goes with the wizard, while
 * "the book got finished" and "the reader reached the order screen" are funnel
 * stages of the one studio that remains.
 */
"use client";

import { useEffect, useRef } from "react";
import { touchProjectRemote } from "../../platform/aiClient";

/**
 * Record a milestone only the browser can see, once per book per session.
 *
 * No AI call happens when someone opens the order screen, finishes setup or sees
 * a finished book, so the backend has nothing to observe; the browser reports it
 * and the backend keeps the FIRST timestamp ever. There is no settle window:
 * these are navigations the reader performed, not values that resolve
 * asynchronously the way the flow does.
 *
 * A failed report is not marked as sent, so it goes out again the next time this
 * runs (the same reasoning as the flow beacon): a lost report is a missing data
 * point in a funnel that is read as "how many got this far".
 */
export function useMilestoneReached(
  projectId: string | null,
  reached: boolean,
  milestone: "previewed" | "finished" | "setupLocked",
): void {
  const sent = useRef(new Set<string>());

  useEffect(() => {
    if (!projectId || !reached) return;
    const key = `${projectId}:${milestone}`;
    if (sent.current.has(key)) return;
    void touchProjectRemote({ projectId, reached: milestone }).then((taken) => {
      if (taken) sent.current.add(key);
    });
  }, [projectId, reached, milestone]);
}

/**
 * Record that the reader reached the order screen of a book.
 *
 * Separate from the flow beacon because it answers a different question and has a
 * different shape: it is a milestone, stamped once ever rather than once per
 * session, and the backend keeps the first timestamp. `ordered` is not a
 * substitute, since it measures willingness to pay rather than whether the flow
 * got them to the end — and "the book became finished" is not a substitute either,
 * which is why that is its own `finished` milestone.
 */
export function usePreviewReached(projectId: string | null, previewing: boolean): void {
  useMilestoneReached(projectId, previewing, "previewed");
}
