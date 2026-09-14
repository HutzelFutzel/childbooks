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
 * Retention: `expiresAt` drives Firestore TTL. The reader's own words are personal
 * data, and there is no reason to hold them past the window in which they could
 * explain a complaint.
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
 * Append one turn. Returns the id so the route can hand it back and the client can
 * quote it in a bug report.
 *
 * Records the proposal, not the outcome: the patch is applied on the client
 * against the live config, so what finally landed is visible in the project's own
 * history. Recording a guess at the result here would produce a log that disagrees
 * with the book, which is worse than one that admits its scope.
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
      reply: args.result.reply.slice(0, MAX_TEXT),
      confidence: args.result.confidence,
      proposedSlots: args.proposedSlots,
      skipped: args.result.skip,
      model: { provider: args.model.provider, id: args.model.id },
      latencyMs: args.latencyMs,
    });
  return turnId;
}
