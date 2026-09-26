/**
 * The guide's turn log — one record per message the interpreter read.
 *
 * Backend-only writes (`firestore.rules`: owner read, `write: if false`), which is
 * what makes it worth having. Two things depend on that:
 *
 *   - **Debugging a conversation that went wrong.** When a parent says the guide
 *     misunderstood them, this is the only place that holds what they actually
 *     typed, what the model made of it, and which model did it. A log the client
 *     could write would be a log the client could also have mangled.
 *   - **Improving the prompt on evidence.** The interesting rows are the
 *     low-confidence ones and the ones with rejections — they name the sentences
 *     the interpreter can't read yet. That is a far better source of prompt edits
 *     than imagining what a parent might type.
 *
 * It is an audit trail, not state. The book is the state, and it is reconstructed
 * from `Project` alone; nothing reads these back to decide what happens next. That
 * separation is deliberate — a conversation log that the flow depended on would be
 * a second source of truth, and the one that drifts.
 *
 * Retention: `expiresAt` drives a Firestore TTL policy, declared as a `ttl`
 * fieldOverride in `firestore.indexes.json` and applied by
 * `firebase deploy --only firestore:indexes`. The reader's own words are personal
 * data, and there is no reason to hold them past the window in which they could
 * explain a complaint.
 *
 * The policy is the reason this is a `Timestamp` rather than the epoch number the
 * other expiring collections here use: TTL only reads a timestamp field, and the
 * sibling collections (`likenessPhotos`, `sparkLots`) are swept by scheduled
 * functions instead, which need arithmetic. Do not "make it consistent" by
 * switching to a number — that silently disables the policy, and nothing fails.
 *
 * Erasure on request is separate and already covered: `eraseUser` does a
 * `recursiveDelete` on `users/{uid}`, which takes this subcollection with it.
 */
import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import type { GuideTurnResult } from "../../books-frontend/src/core/pipeline/guideInterpret";
import type { ModelSelection } from "../../books-frontend/src/core/types";

/** 90 days: long enough to explain a complaint, short enough not to hoard. */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Cap on stored text, so one pasted novel can't bloat the collection. */
const MAX_TEXT = 4000;

export interface RecordGuideTurnArgs {
  uid: string;
  projectId: string;
  /** What the reader typed. */
  message: string;
  /** The component the guide was on when they said it. */
  componentId: string | null;
  result: GuideTurnResult;
  /** Slots the patch named — what the interpreter PROPOSED. */
  proposedSlots: string[];
  model: ModelSelection;
  /** Wall-clock time the interpretation took. */
  latencyMs: number;
}

/**
 * Append one turn. Returns the id so the route can hand it back, the client can
 * report what actually happened, and a parent can quote it in a bug report.
 *
 * This half is the proposal. The outcome arrives separately, from the browser
 * that applied it — see {@link recordGuideTurnOutcome}.
 */
export async function recordGuideTurn(args: RecordGuideTurnArgs): Promise<string> {
  ensureAdmin();
  const turnId = randomUUID();
  const now = Date.now();
  await getFirestore()
    .doc(`users/${args.uid}/guideTurns/${turnId}`)
    .set({
      turnId,
      projectId: args.projectId,
      createdAt: now,
      expiresAt: new Date(now + RETENTION_MS),
      componentId: args.componentId,
      message: args.message.slice(0, MAX_TEXT),
      intent: args.result.intent,
      route: args.result.route,
      reply: args.result.reply.slice(0, MAX_TEXT),
      confidence: args.result.confidence,
      proposedSlots: args.proposedSlots,
      /**
       * The claims, with the words each one rests on.
       *
       * This is what turns the log from an anecdote into a corpus. A row saying
       * "proposed heroes, confidence 0.6" cannot be replayed or argued with; a row
       * holding the message, the claim and the quoted evidence can be re-run
       * against a new prompt and scored. Evidence is capped per claim rather than
       * dropped, because the quotation is the part worth keeping.
       */
      claims: args.result.claims.slice(0, 24).map((claim) => ({
        slot: claim.slot,
        evidence: claim.evidence.slice(0, 400),
        confidence: claim.confidence,
      })),
      /**
       * And everything that did NOT make it, with the reason.
       *
       * The rows anyone improving extraction wants first. A turn where the model
       * quoted words the parent never typed, or named a field that does not exist,
       * used to leave no trace at all — the log recorded an empty patch, which
       * reads identically to a greeting.
       */
      refused: args.result.refused.slice(0, 24).map((claim) => ({
        slot: claim.slot,
        refusal: claim.refusal,
        reason: claim.reason.slice(0, 400),
        confidence: claim.confidence,
      })),
      repairs: args.result.repairs,
      skipped: args.result.skip,
      model: { provider: args.model.provider, id: args.model.id },
      latencyMs: args.latencyMs,
    });
  return turnId;
}

export interface GuideTurnOutcomeReport {
  /** Slots that changed the book. */
  applied: string[];
  /** Slots the reader restated — already true. */
  unchanged: string[];
  /** Slots the client's validator refused, with its reason. */
  rejected: { key: string; reason: string }[];
  /** True when the reply told the reader we hadn't understood. */
  admittedFailure: boolean;
}

/**
 * What the browser actually did with the proposal.
 *
 * Split from the write above because only the client knows. The patch is applied
 * against the live project inside `patchCurrent`, which may have moved on since
 * the request was sent, and against the reader's own config — so the server's dry
 * run is a good prediction and not a record. Writing a prediction into the log as
 * though it were a result would give us a corpus that agrees with itself and
 * disagrees with the book, which is the one failure mode a log must not have.
 *
 * Merged into the existing row rather than appended as a second one, so a turn
 * stays a turn. Best-effort on both sides: a reader who closes the tab leaves a
 * row with no outcome, and a row with no outcome is honest about that rather than
 * claiming the turn did nothing.
 */
export async function recordGuideTurnOutcome(args: {
  uid: string;
  turnId: string;
  outcome: GuideTurnOutcomeReport;
}): Promise<void> {
  ensureAdmin();
  await getFirestore()
    .doc(`users/${args.uid}/guideTurns/${args.turnId}`)
    .set(
      {
        outcome: {
          applied: args.outcome.applied.slice(0, 24),
          unchanged: args.outcome.unchanged.slice(0, 24),
          rejected: args.outcome.rejected.slice(0, 24).map((rejection) => ({
            key: rejection.key,
            reason: rejection.reason.slice(0, 400),
          })),
          admittedFailure: args.outcome.admittedFailure,
          at: Date.now(),
        },
      },
      { merge: true },
    );
}
