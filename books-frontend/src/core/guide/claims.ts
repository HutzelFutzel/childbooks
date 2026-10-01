/**
 * What the reader asserted, one fact at a time, with receipts.
 *
 * The interpreter used to return a single merged `patch` object. That shape has a
 * property nobody wanted: it is indivisible. A turn stating three things arrives
 * as one blob, and if any part of it is wrong — a hallucinated age, an id from
 * another age band — the honest options are to take the whole thing or drop the
 * whole thing. Dropping it loses the two facts that were fine; taking it writes
 * the one that wasn't. The guide chose "drop", which is why "Micah and Neil, both
 * 5 years old" could come back as "I didn't quite catch that": one slot failed to
 * validate and took the other down with it.
 *
 * A claim is that blob split into its atoms, and each atom carries two things the
 * blob could not:
 *
 *   - **Evidence.** The words from the reader's own message that assert this fact.
 *     Checked here, against the message, before the claim is allowed anywhere near
 *     the book. A model that invents a child's age has to invent a quotation to go
 *     with it, and inventing a quotation that appears verbatim in a message it did
 *     not write is a much harder trick than inventing a number. This is the only
 *     defence in the system that does not depend on the model cooperating.
 *   - **Its own confidence.** "They said Maya" and "I think Maya is the one turning
 *     six" are different assertions and used to share one number for the turn.
 *
 * Nothing here writes anything. Claims become a patch, and `applyGuidePatch` is
 * still the only door into the book.
 */
import { z } from "zod";
import { captureGuideFacts, isGuidePatchableSlot } from "./patch";
import { GUIDE_SLOTS, type GuideSlotId } from "./slots";
import { STORY_DETAILS, isStoryDetailId, withStoryDetail, type DetailPatch } from "./storyDetails";
import { briefOf } from "../story/brief";
import type { Project } from "../types";

/** One fact the reader stated, as the model reports it. */
export interface GuideClaim {
  slot: GuideSlotId;
  /** Untrusted. Shaped by the slot's schema in `applyGuidePatch`, not here. */
  value: unknown;
  /** The reader's own words asserting this. Verified against the message. */
  evidence: string;
  confidence: number;
}

/**
 * Why a claim did not reach the book.
 *
 * Every claim ends as an applied write or one of these. There is deliberately no
 * "silently vanished" — the whole point of the rewrite is that a fact the reader
 * stated is either in the book or accounted for in the turn log.
 */
export type GuideClaimRefusal =
  | "unknown-slot"
  | "unsupported"
  | "low-confidence"
  | "superseded"
  | "not-a-statement"
  | "rejected"
  | "needs-confirmation";

/**
 * Refusals a second attempt could plausibly fix.
 *
 * "low-confidence" is not among them: the model has already told us it is
 * unsure, and asking it again is how an unsure guess becomes a confident one
 * without any new information. The reader is the right place to go for that.
 */
export const REPAIRABLE_CLAIM_REFUSALS: readonly GuideClaimRefusal[] = [
  "unknown-slot",
  "unsupported",
  "rejected",
];

export interface RefusedGuideClaim {
  /** The slot named, even when it isn't one — this is the log, not the book. */
  slot: string;
  value: unknown;
  evidence: string;
  confidence: number;
  refusal: GuideClaimRefusal;
  /** One line for the turn log, and for the repair prompt to read back. */
  reason: string;
}

/**
 * How firmly a claim is applied.
 *
 * Confidence alone is the wrong test. Filling an empty slot at 0.6 is cheap to get
 * wrong — the reader sees it in the facts strip and says so. Overwriting a name
 * they settled ten turns ago at 0.6 is expensive to get wrong, because by the time
 * anyone notices, the cast sheets have been drawn from it. Same number, different
 * blast radius, so the threshold moves with the damage rather than being one line
 * in the prompt about being careful.
 */
export type GuideClaimDisposition = "apply" | "readBack" | "confirm";

export interface GuideClaimThresholds {
  /** Below this, a claim is not worth acting on at all. */
  floor: number;
  /** Below this, an applied claim is named explicitly in the reply. */
  readBack: number;
  /** Below this, OVERWRITING a fact the book already settled is asked about first. */
  overwrite: number;
}

export const DEFAULT_GUIDE_CLAIM_THRESHOLDS: GuideClaimThresholds = {
  floor: 0.35,
  readBack: 0.75,
  overwrite: 0.8,
};

export const guideClaimSchema = z.object({
  slot: z.string().min(1).max(40),
  value: z.unknown(),
  evidence: z.string().max(600),
  confidence: z.number().min(0).max(1),
});

/**
 * Fold a message down to comparable tokens.
 *
 * Everything that is not a letter or a digit becomes a single space, so quoting
 * "both 5 years old" still matches a message that wrote "both 5 years old," or
 * used a curly apostrophe or a non-breaking space. Punctuation is not evidence.
 *
 * What survives is word order, and that is the part doing the work: a model can
 * drop a comma from a quotation it is copying, but it cannot produce the reader's
 * words in the reader's order for a fact the reader never stated.
 */
function foldForEvidence(text: string): string {
  return ` ${text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/**
 * Whether the message really contains the words the claim quotes.
 *
 * Padded with spaces on both sides so matching is token-aligned: quoting "Ann"
 * must not be satisfied by a message that says "Hannah".
 */
export function claimEvidenceHolds(message: string, evidence: string): boolean {
  const quoted = foldForEvidence(evidence);
  if (quoted.trim().length === 0) return false;
  return foldForEvidence(message).includes(quoted);
}

export interface ScreenedGuideClaims {
  /** Claims that survived, best-confidence-first within each slot. */
  kept: GuideClaim[];
  refused: RefusedGuideClaim[];
}

/**
 * Check claims against the message and against the closed world, before the book
 * is involved at all.
 *
 * Three filters, cheapest first, none of which needs the project:
 *
 *   1. The slot has to be one a message may write. Artifact slots and invented
 *      field names die here, as they always did — but now they die individually
 *      instead of taking the turn's other facts with them.
 *   2. The evidence has to be in the message.
 *   3. The confidence has to clear the floor.
 *
 * Duplicates for one slot are resolved by keeping the most confident, because the
 * alternative — merging two disagreeing values — invents a third value that the
 * reader never said and the model never proposed.
 */
export function screenGuideClaims(args: {
  message: string;
  claims: readonly GuideClaim[];
  thresholds?: Pick<GuideClaimThresholds, "floor">;
}): ScreenedGuideClaims {
  const floor = args.thresholds?.floor ?? DEFAULT_GUIDE_CLAIM_THRESHOLDS.floor;
  const refused: RefusedGuideClaim[] = [];
  const bySlot = new Map<GuideSlotId, GuideClaim>();

  const refuse = (
    claim: GuideClaim | (Omit<GuideClaim, "slot"> & { slot: string }),
    refusal: GuideClaimRefusal,
    reason: string,
  ) => {
    refused.push({
      slot: claim.slot,
      value: claim.value,
      evidence: claim.evidence,
      confidence: claim.confidence,
      refusal,
      reason,
    });
  };

  for (const claim of args.claims) {
    if (!isGuidePatchableSlot(claim.slot)) {
      refuse(
        claim,
        "unknown-slot",
        claim.slot in GUIDE_SLOTS
          ? `"${claim.slot}" is produced by generation and cannot be set from a message`
          : `"${claim.slot}" is not a fact this guide keeps`,
      );
      continue;
    }
    if (!claimEvidenceHolds(args.message, claim.evidence)) {
      refuse(
        claim,
        "unsupported",
        `the message does not contain "${claim.evidence}"`,
      );
      continue;
    }
    // A manuscript can be much longer than the bounded evidence quotation. Its
    // value therefore has one stronger rule: the exact proposed words must occur
    // in the reader's message. This makes paste-to-editor lossless and prevents a
    // model from "helpfully" polishing text while still quoting its first line.
    if (
      claim.slot === "storyText" &&
      (typeof claim.value !== "string" ||
        !claim.value.trim() ||
        !args.message.includes(claim.value))
    ) {
      refuse(
        claim,
        "unsupported",
        "the proposed manuscript is not an exact passage from the message",
      );
      continue;
    }
    if (claim.confidence < floor) {
      refuse(claim, "low-confidence", `confidence ${claim.confidence.toFixed(2)} is below ${floor}`);
      continue;
    }

    const held = bySlot.get(claim.slot);
    if (!held) {
      bySlot.set(claim.slot, claim);
      continue;
    }
    const [winner, loser] = held.confidence >= claim.confidence ? [held, claim] : [claim, held];
    bySlot.set(claim.slot, winner);
    refuse(loser, "superseded", `a more confident claim for "${claim.slot}" was taken instead`);
  }

  return { kept: [...bySlot.values()], refused };
}

/**
 * Does taking this claim overwrite something the book had already settled?
 *
 * Read through `captureGuideFacts`, which is the same function a checkpoint uses,
 * so "settled" means exactly what "restorable" means. A slot absent from the
 * capture has never been decided, and filling it in is not an overwrite however
 * the model phrases it.
 */
export function claimOverwritesSettledFact(project: Project, claim: GuideClaim): boolean {
  const settled = captureGuideFacts(project);
  if (!(claim.slot in settled)) return false;
  if (claim.slot === "storyIdea" && claim.value && typeof claim.value === "object" && !Array.isArray(claim.value)) {
    return storyIdeaOverwrites(project, settled.storyIdea as Record<string, unknown>, claim.value as Record<string, unknown>);
  }
  return JSON.stringify(settled[claim.slot]) !== JSON.stringify(claim.value);
}

/**
 * The story idea is many small details, and adding one is not changing another:
 * only a detail that already has a different value counts as an overwrite.
 */
function storyIdeaOverwrites(
  project: Project,
  settled: Record<string, unknown>,
  proposed: Record<string, unknown>,
): boolean {
  const brief = briefOf(project.config);
  return Object.entries(proposed).some(([key, value]) => {
    if (isStoryDetailId(key)) {
      const before = STORY_DETAILS[key].read(brief);
      if (!before) return false;
      // Words added next to the parent's own keep everything that was there.
      const patch = value === null ? null : { ...(value as DetailPatch), add: undefined };
      const after = STORY_DETAILS[key].read(withStoryDetail(brief, key, patch));
      return JSON.stringify(before) !== JSON.stringify(after);
    }
    const before = settled[key];
    if (before === null || before === undefined || (Array.isArray(before) && before.length === 0)) return false;
    return JSON.stringify(before) !== JSON.stringify(value);
  });
}

export interface DisposedGuideClaim {
  claim: GuideClaim;
  disposition: GuideClaimDisposition;
}

export interface DisposedGuideClaims {
  /** Claims to send to `applyGuidePatch`, with how loudly to say so. */
  taken: DisposedGuideClaim[];
  /** Claims held back pending a yes. Not written, not lost. */
  refused: RefusedGuideClaim[];
}

/**
 * Decide how firmly each surviving claim is applied.
 *
 * A held-back claim needs no pending-state machinery to survive: the question the
 * guide asks goes into the transcript, and the reader's "yes" arrives on the next
 * turn with that question sitting in the interpreter's context. The transcript IS
 * the pending state, which is why there isn't a second one here to get out of sync
 * with the conversation the reader can see.
 */
export function disposeGuideClaims(args: {
  project: Project;
  claims: readonly GuideClaim[];
  thresholds?: Partial<GuideClaimThresholds>;
}): DisposedGuideClaims {
  const limits = { ...DEFAULT_GUIDE_CLAIM_THRESHOLDS, ...args.thresholds };
  const taken: DisposedGuideClaim[] = [];
  const refused: RefusedGuideClaim[] = [];

  for (const claim of args.claims) {
    if (
      claim.confidence < limits.overwrite &&
      claimOverwritesSettledFact(args.project, claim)
    ) {
      refused.push({
        slot: claim.slot,
        value: claim.value,
        evidence: claim.evidence,
        confidence: claim.confidence,
        refusal: "needs-confirmation",
        reason: `would overwrite a settled ${claim.slot} at confidence ${claim.confidence.toFixed(2)}`,
      });
      continue;
    }
    taken.push({
      claim,
      disposition: claim.confidence < limits.readBack ? "readBack" : "apply",
    });
  }

  return { taken, refused };
}

/**
 * The patch to hand `applyGuidePatch`.
 *
 * Claims are already one-per-slot by the time they get here, so this is a
 * projection rather than a merge — there is no combining rule to get wrong, which
 * was the point of splitting them up.
 */
export function claimsToPatch(claims: readonly GuideClaim[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const claim of claims) patch[claim.slot] = claim.value;
  return patch;
}

/**
 * What to ask when a claim was held back for confirmation.
 *
 * Phrased around the value the book currently holds rather than the one proposed,
 * because the current value is the one we can describe accurately — it came from
 * the slot's own `describe`, the same text in the facts strip. Describing the
 * proposed value would mean rendering an unvalidated blob as prose, and getting
 * that wrong would put words in the reader's mouth.
 */
export function guideConfirmationQuestion(
  project: Project,
  refused: readonly RefusedGuideClaim[],
): string | null {
  const pending = refused.find((claim) => claim.refusal === "needs-confirmation");
  if (!pending || !isGuidePatchableSlot(pending.slot)) return null;
  const current = GUIDE_SLOTS[pending.slot].describe(project);
  return current
    ? `I have ${current} at the moment — shall I change that?`
    : `Shall I change the ${GUIDE_SLOTS[pending.slot].label.toLowerCase()}?`;
}
