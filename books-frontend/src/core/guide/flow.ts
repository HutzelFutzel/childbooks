/**
 * Which studio built a book, and what that lets you conclude.
 *
 * Two flows ship at once for the length of the migration, and the only reason to
 * run both is to find out which one produces better books more often. That
 * comparison rests entirely on being able to say, of a finished book, which studio
 * made it — and that fact is *not derivable*. `resolveGuideMode` reads the live
 * rollout, the reader's admin status, a `localStorage` preference and a URL
 * override; by the time anyone runs a report the rollout has moved on and the
 * preference only ever existed in one browser. So it has to be recorded as it
 * happens, and this module is the shared vocabulary for doing that.
 *
 * Pure and dependency-free on purpose. The same three decisions — is this a flow,
 * what does a new sighting change, which arm does this book belong to — are needed
 * by the beacon in the studio, the mirror write in `functions/src/projects.ts` and
 * the comparison that reads them back. Three copies of "which arm is this" is how
 * a report starts disagreeing with itself, and it is also why this can be walked
 * exhaustively offline by `scripts/guide-flow-invariants.ts`.
 *
 * Retired with the comparison (see docs/LEGACY-GUIDE.md) — one flow needs no
 * attribution.
 */

export type StudioFlow = "guide" | "legacy";

export const STUDIO_FLOWS: readonly StudioFlow[] = ["guide", "legacy"] as const;

export function isStudioFlow(value: unknown): value is StudioFlow {
  return value === "guide" || value === "legacy";
}

/**
 * Which flows a book has been seen in.
 *
 * Both fields carry their weight. `first` is the arm the book belongs to; `seen`
 * is what catches a book that MOVED, which stays possible for as long as an admin
 * can flip the toggle halfway through writing. Without `seen`, a book drafted in
 * the wizard and finished in the chat is indistinguishable from one that only ever
 * used the wizard, and it would be credited to whichever flow it started in while
 * carrying the other's work.
 */
export interface ProjectAuthoring {
  /** The flow the book was first seen in. First sighting wins, forever. */
  first: StudioFlow;
  /** When each flow was first seen. More than one key means a mixed book. */
  seen: Partial<Record<StudioFlow, number>>;
}

/**
 * The comparison arm a book belongs to.
 *
 * `mixed` and `unknown` are separate because they are different problems.
 * `unknown` is a book from before attribution shipped (or one whose reader never
 * settled on a flow long enough to be counted) — it is missing data, and it
 * shrinks the sample. `mixed` is a book that genuinely used both — it is real
 * data that answers no question, because every metric on it is part one flow's
 * doing and part the other's.
 *
 * Neither may ever be silently folded into an arm. Attributing them is how you
 * end up "proving" the new flow is faster using books the old flow drafted.
 */
export type FlowArm = StudioFlow | "mixed" | "unknown";

/** Whether an arm is one of the two things being compared. */
export function isComparable(arm: FlowArm): arm is StudioFlow {
  return arm === "guide" || arm === "legacy";
}

/**
 * Classify a book. Total: every possible stored value maps to an arm, including
 * absent, malformed and half-written ones, because this reads a Firestore
 * document that an older or newer version of the code may have written.
 */
export function flowArm(authoring: Partial<ProjectAuthoring> | null | undefined): FlowArm {
  if (!authoring) return "unknown";
  const seen = STUDIO_FLOWS.filter((flow) => {
    const at = authoring.seen?.[flow];
    return typeof at === "number" && at > 0;
  });
  if (seen.length > 1) return "mixed";
  // `seen` is the authority, not `first`: a document with a `first` but no
  // sighting was written by something that didn't finish, and trusting `first`
  // alone would file a book on the strength of a half-written record.
  if (seen.length === 1) return seen[0]!;
  return "unknown";
}

/**
 * What a new sighting changes, or null when it changes nothing.
 *
 * Returning null for "already known" is the whole contract: the beacon fires on
 * every visit, so the common case by far is a repeat, and the caller uses null to
 * skip the write entirely. Additive and never corrective — a second flow appears
 * beside the first rather than replacing it, because overwriting is exactly how a
 * mixed book would disguise itself as a clean one.
 */
export function nextAuthoring(
  existing: Partial<ProjectAuthoring> | null | undefined,
  flow: StudioFlow,
  at: number,
): ProjectAuthoring | null {
  if (!isStudioFlow(flow) || !Number.isFinite(at) || at <= 0) return null;

  const seenAt = existing?.seen?.[flow];
  if (typeof seenAt === "number" && seenAt > 0) return null; // already recorded

  const seen: Partial<Record<StudioFlow, number>> = {};
  for (const known of STUDIO_FLOWS) {
    const known_at = existing?.seen?.[known];
    if (typeof known_at === "number" && known_at > 0) seen[known] = known_at;
  }
  seen[flow] = at;

  const first = existing?.first;
  return { first: isStudioFlow(first) ? first : flow, seen };
}

/** Reader-facing name for an arm. */
export function describeFlowArm(arm: FlowArm): string {
  switch (arm) {
    case "guide":
      return "Guided studio";
    case "legacy":
      return "Step wizard";
    case "mixed":
      return "Both flows";
    case "unknown":
      return "Not recorded";
  }
}
