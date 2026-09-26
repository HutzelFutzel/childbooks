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
import type { GuideSlotId } from "../core/guide/slots";
import type { GuideComponentId } from "../core/guide/components";
import type { GuideEntryRoute, GuideTurn, GuideTurnIntent } from "../core/pipeline/guideInterpret";
import { interpretGuideTurnRemote } from "../platform/aiClient";
import { useAppConfigStore } from "./appConfigStore";
import { useProjectsStore } from "./projectsStore";
import { useGuidePreference } from "../ui/guide/guidePreference";

export interface GuideTurnOutcome {
  intent: GuideTurnIntent;
  /** Suggested entry for a book that has not chosen how its story is written. */
  route: GuideEntryRoute;
  /** What to say back to the reader. */
  reply: string;
  /** Slots that actually changed the book. */
  applied: GuideSlotId[];
  /**
   * Slots the reader restated correctly — the book already held this value.
   *
   * Reported separately from `applied` so the conversation can confirm rather than
   * deny. Lumping the two together as "didn't land" is what made the guide answer
   * a correct restatement with "I didn't quite catch that".
   */
  unchanged: GuideSlotId[];
  /** Proposals refused by the validator. Worth logging; sometimes worth saying. */
  rejected: GuidePatchRejection[];
  /** Components the reader declined. The caller owns the skip set. */
  skip: GuideComponentId[];
  /** A question to ask before changing a settled fact, when one is pending. */
  confirm: string | null;
  /** Slots to name out loud because the model was only moderately sure. */
  readBack: GuideSlotId[];
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

  const { audience, artStyles, storyCraft } = useAppConfigStore.getState();
  const context = guidePatchContext({ audience, artStyles, storyCraft });

  /**
   * There is no fast path any more.
   *
   * There used to be a regex here that recognised "maya 3, thorsten 1, nils 2"
   * and wrote it without a round trip. It was added because the interpreter
   * classified that shape as chat — a real problem, fixed in the prompt and the
   * examples rather than routed around. What the regex cost was worse than the
   * latency it saved: "Micah and Neil, both 5 years old" does not match it, so
   * the message fell through to an interpreter whose prompt had been tuned
   * assuming the regex would catch lists, and the reader was told they had not
   * been understood. Two parsers, each assuming the other handled the case.
   *
   * One path now. Slower by a round trip on a handful of messages, and it reads
   * every message the same way.
   */
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
    route: result.route,
    reply: result.reply,
    skip: result.skip,
    confirm: result.confirm ?? null,
    readBack: result.readBack ?? [],
    confidence: result.confidence,
    turnId: result.turnId,
    context,
  });
}

async function applyTurnPatch(
  patch: Record<string, unknown>,
  meta: {
    intent: GuideTurnIntent;
    route: GuideEntryRoute;
    reply: string;
    skip: GuideComponentId[];
    confirm: string | null;
    readBack: GuideSlotId[];
    confidence: number;
    turnId: string | null;
    context: ReturnType<typeof guidePatchContext>;
  },
): Promise<GuideTurnOutcome> {
  let applied: GuideSlotId[] = [];
  let unchanged: GuideSlotId[] = [];
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
      unchanged = outcome.unchanged;
      rejected = outcome.rejected;
      return outcome.project;
    });
  }

  return {
    intent: meta.intent,
    route: meta.route,
    reply: meta.reply,
    applied,
    unchanged,
    rejected,
    skip: meta.skip,
    confirm: meta.confirm,
    readBack: meta.readBack,
    confidence: meta.confidence,
    turnId: meta.turnId,
    before,
  };
}
