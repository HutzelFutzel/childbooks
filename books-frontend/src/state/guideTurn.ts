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

import {
  applyGuidePatch,
  captureGuideFacts,
  guidePatchContext,
  type GuidePatchRejection,
} from "../core/guide/patch";
import { peopleListPatch } from "../core/guide/parsePeople";
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
  /**
   * The facts as they stood before this turn, when it changed any — the restore point
   * for a jump-back. Captured inside the same `patchCurrent` callback as the write, so
   * it is the state the patch was actually applied to rather than whatever the store
   * happened to hold by the time the caller looked.
   */
  before: Record<string, unknown>;
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

  const { audience, artStyles } = useAppConfigStore.getState();
  const context = guidePatchContext({ audience, artStyles });

  // A typed name+age list is too regular to wait on the interpreter. The model
  // often classifies "maya 3, thorsten 1, nils 2" as chat, returns no patch, and
  // the guide says it didn't catch that. When the shape is already a list, write
  // it here and skip the round trip.
  const parsed = peopleListPatch(message);
  if (parsed) {
    return applyTurnPatch(parsed, {
      intent: "answer",
      reply: "",
      skip: [],
      confidence: 1,
      turnId: null,
      context,
    });
  }

  const result = await interpretGuideTurnRemote(
    project,
    message,
    {
      transcript,
      guidePreference: useGuidePreference.getState().preference,
    },
    signal,
  );

  return applyTurnPatch(result.patch, {
    intent: result.intent,
    reply: result.reply,
    skip: result.skip,
    confidence: result.confidence,
    turnId: result.turnId,
    context,
  });
}

async function applyTurnPatch(
  patch: Record<string, unknown>,
  meta: {
    intent: GuideTurnIntent;
    reply: string;
    skip: GuideComponentId[];
    confidence: number;
    turnId: string | null;
    context: ReturnType<typeof guidePatchContext>;
  },
): Promise<GuideTurnOutcome> {
  let applied: GuideSlotId[] = [];
  let rejected: GuidePatchRejection[] = [];
  let before: Record<string, unknown> = {};
  // Applied inside the mutator, against the project as it is at write time rather
  // than the snapshot we sent. A render that finished mid-conversation must not be
  // rolled back by a patch computed before it landed.
  if (Object.keys(patch).length > 0) {
    await useProjectsStore.getState().patchCurrent((live) => {
      before = captureGuideFacts(live);
      const outcome = applyGuidePatch(live, patch, meta.context);
      applied = outcome.applied;
      rejected = outcome.rejected;
      return outcome.project;
    });
  }

  return {
    intent: meta.intent,
    reply: meta.reply,
    applied,
    rejected,
    skip: meta.skip,
    confidence: meta.confidence,
    turnId: meta.turnId,
    before,
  };
}
