/**
 * One conversational turn, end to end: message out, book updated.
 *
 * The split with the backend is the important part. The server chooses the model,
 * runs the interpreter and returns a *proposal*; the book itself is only ever
 * written here, through `patchCurrent` — the same door studio undo uses. So the
 * project keeps one writer, and everything the guide does lands in the undo
 * history the reader already has, rather than in a second history that would have
 * to be reconciled with it.
 *
 * Rejections are returned rather than thrown. A model naming a slot it may not
 * write is an ordinary event, and the useful response is to tell the reader what
 * we couldn't do — not to fail the turn and lose the parts that were fine.
 */
"use client";

import { applyGuidePatch, guidePatchContext, type GuidePatchRejection } from "../core/guide/patch";
import type { GuideSlotId } from "../core/guide/slots";
import type { GuideComponentId } from "../core/guide/components";
import type { GuideTurn, GuideTurnIntent } from "../core/pipeline/guideInterpret";
import { interpretGuideTurnRemote } from "../platform/aiClient";
import { useAppConfigStore } from "./appConfigStore";
import { useProjectsStore } from "./projectsStore";
import { useGuidePreference } from "../ui/guide/guidePreference";

export interface GuideTurnOutcome {
  intent: GuideTurnIntent;
  /** What to say back to the reader. */
  reply: string;
  /** Slots that actually changed the book. A restated fact reports nothing. */
  applied: GuideSlotId[];
  /** Proposals refused by the validator. Worth logging, rarely worth showing. */
  rejected: GuidePatchRejection[];
  /** Components the reader declined. The caller owns the skip set. */
  skip: GuideComponentId[];
  confidence: number;
  /** The server's turn-log id, for quoting in a bug report. */
  turnId: string | null;
}

/**
 * Send one message and fold the result into the current project.
 *
 * Deliberately not a store: there is no state here that outlives the call. The
 * transcript belongs to whatever is drawing the conversation, and the book belongs
 * to `projectsStore` — a store in between would be a third copy of both.
 */
export async function sendGuideTurn(
  message: string,
  transcript: GuideTurn[] = [],
  signal?: AbortSignal,
): Promise<GuideTurnOutcome> {
  const project = useProjectsStore.getState().current();
  if (!project) throw new Error("No book is open.");

  const result = await interpretGuideTurnRemote(
    project,
    message,
    {
      transcript,
      guidePreference: useGuidePreference.getState().preference,
    },
    signal,
  );

  const { audience, artStyles } = useAppConfigStore.getState();
  const context = guidePatchContext({ audience, artStyles });

  // Applied inside the mutator, against the project as it is at write time rather
  // than the snapshot we sent. A render that finished mid-conversation must not be
  // rolled back by a patch computed before it landed.
  let applied: GuideSlotId[] = [];
  let rejected: GuidePatchRejection[] = [];
  if (Object.keys(result.patch).length > 0) {
    await useProjectsStore.getState().patchCurrent((live) => {
      const outcome = applyGuidePatch(live, result.patch, context);
      applied = outcome.applied;
      rejected = outcome.rejected;
      return outcome.project;
    });
  }

  return {
    intent: result.intent,
    reply: result.reply,
    applied,
    rejected,
    skip: result.skip,
    confidence: result.confidence,
    turnId: result.turnId,
  };
}
