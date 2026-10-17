/**
 * Record which studio a reader actually used, so the two can be compared.
 *
 * Every metric phase 8 judges the migration on — time to a draft, whether the
 * book reached the preview, Sparks spent, turns taken — is a comparison between
 * the wizard and the guide. None of them mean anything without knowing which flow
 * a given book was built in, and that is not recoverable after the fact:
 * `resolveGuideMode` reads the live rollout, the reader's admin status, a
 * `localStorage` preference and a URL override, so by the time anyone asks, the
 * rollout has moved on and the preference only ever existed in one browser. Data
 * not captured while it happened is gone.
 *
 * **Why this waits before reporting.** The resolved flow is not stable on the
 * first render. `hydrateGuidePreference` runs in an effect after mount, so an
 * admin who prefers the chat resolves to `legacy` for one frame and then flips.
 * Reporting immediately would record a wizard visit for a book that never showed
 * the wizard — and because a second flow is what marks a book as MIXED and
 * excludes it from both arms, that single frame would quietly disqualify every
 * book an admin opened. So the flow has to hold still for a moment before it
 * counts, which also naturally ignores a reader flicking the toggle to look.
 *
 * **Why it fires more than once.** The beacon is sent once per flow per book per
 * session, not once per book: a book genuinely moved between flows is the case the
 * report needs to detect, and it can only be detected by reporting both. The
 * backend keeps the first timestamp for each flow and ignores repeats, so a chatty
 * client costs nothing.
 *
 * Fire-and-forget telemetry throughout. A failed beacon must never reach the
 * person writing a story.
 *
 * @legacy guide-v2 L5
 */
"use client";

import { useEffect, useRef } from "react";
import { touchProjectRemote } from "../../platform/aiClient";

/**
 * How long the resolved flow must hold still before it is reported.
 *
 * Long enough to outlast preference hydration and a reader double-tapping the
 * toggle; short enough that closing the tab straight after opening a book still
 * records the visit. The exact number does not matter — that it is not zero does.
 */
const SETTLE_MS = 1500;

export function useFlowAttribution(
  projectId: string | null,
  flow: "guide" | "legacy" | null,
): void {
  /**
   * Flows already reported, keyed by `${projectId}:${flow}`. A ref rather than
   * state: nothing renders from it, and re-rendering on a telemetry send would be
   * a render caused by measurement.
   */
  const sent = useRef(new Set<string>());

  useEffect(() => {
    if (!projectId || !flow) return;
    const key = `${projectId}:${flow}`;
    if (sent.current.has(key)) return;

    const timer = setTimeout(() => {
      // Marked as sent only once the server has it. Marking first meant a single
      // failed request (offline for a moment, a cold backend) disqualified the
      // book for the whole session, and an unattributed book is dropped from both
      // arms. A failure now leaves it eligible: the next time this effect runs
      // (re-opening the book, switching flow) it is sent again, and the server
      // ignores repeats. Not a retry loop — a dead backend shouldn't be hammered.
      void touchProjectRemote({ projectId, flow }).then((taken) => {
        if (taken) sent.current.add(key);
      });
    }, SETTLE_MS);
    // Cleanup cancels the pending report, which is what makes this a settle
    // rather than a delay: a flow that changes within the window is never sent.
    return () => clearTimeout(timer);
  }, [projectId, flow]);
}
