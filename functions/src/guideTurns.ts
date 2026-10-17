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
import { log } from "./logs";
import type { GuideTurnResult } from "../../books-frontend/src/core/pipeline/guideInterpret";
import type { ModelSelection } from "../../books-frontend/src/core/types";
import { cleanEventDetail, type GuideEventKind } from "../../books-frontend/src/core/guide/events";

/** 90 days: long enough to explain a complaint, short enough not to hoard. */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Cap on stored text, so one pasted novel can't bloat the collection. */
const MAX_TEXT = 4000;

/** Cap on one stored claim value, measured as JSON. */
const MAX_VALUE_JSON = 1500;

/**
 * A claim's value in a form Firestore will take: JSON-round-tripped (drops
 * `undefined`, which Firestore rejects outright and which would fail the WHOLE
 * turn write), and bounded. Anything too large or unserialisable becomes `null`
 * — the claim is still logged with its evidence, just without the value.
 */
function storableValue(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    if (json === undefined || json.length > MAX_VALUE_JSON) return null;
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

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
        // What the model proposed writing. Without it a row cannot be replayed or
        // promoted into the evaluation corpus — the admin's "add as reviewed
        // example" needs exactly this — and `op` is always a plain set.
        value: storableValue(claim.value),
        op: "set",
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
      /** Chat skills the turn asked for, and the ones screening refused with why. */
      commands: (args.result.commands ?? []).slice(0, 12).map((call) => ({
        id: call.id,
        args: Object.fromEntries(Object.entries(call.args).map(([k, v]) => [k, String(v).slice(0, 200)])),
        evidence: call.evidence.slice(0, 400),
        confidence: call.confidence,
      })),
      overflowCommands: (args.result.overflowCommands ?? []).map((call) => call.id).slice(0, 12),
      refusedCommands: (args.result.refusedCommands ?? []).slice(0, 12).map((entry) => ({
        id: entry.id,
        reason: entry.reason.slice(0, 200),
        evidence: entry.evidence.slice(0, 400),
      })),
      language: args.result.language ?? null,
      languageConfidence: args.result.languageConfidence ?? 0,
      model: { provider: args.model.provider, id: args.model.id },
      latencyMs: args.latencyMs,
    });

  if (args.result.refused.length > 0 || (args.result.refusedCommands?.length ?? 0) > 0 || args.result.repairs > 0) {
    void log.warn({
      source: "backend",
      domain: "studio",
      event: "guide.turn.refused_or_repaired",
      message: `Guide interpreter ${args.result.refused.length > 0 ? `refused ${args.result.refused.length} claim(s)` : ""}${args.result.repairs > 0 ? ` (${args.result.repairs} repair pass)` : ""} at ${args.componentId ?? "chat"} (confidence ${args.result.confidence.toFixed(2)}).`,
      uid: args.uid,
      projectId: args.projectId,
      context: {
        turnId,
        componentId: args.componentId,
        intent: args.result.intent,
        confidence: args.result.confidence,
        proposedSlots: args.proposedSlots,
        refused: args.result.refused.slice(0, 8),
        refusedCommands: (args.result.refusedCommands ?? []).slice(0, 8),
        repairs: args.result.repairs,
        model: `${args.model.provider}:${args.model.id}`,
        latencyMs: args.latencyMs,
      },
    });
  }

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

  if (args.outcome.admittedFailure || args.outcome.rejected.length > 0) {
    void log[args.outcome.admittedFailure ? "error" : "warn"]({
      source: "frontend",
      domain: "studio",
      event: args.outcome.admittedFailure ? "guide.turn.admitted_failure" : "guide.turn.patch_rejected",
      message: args.outcome.admittedFailure
        ? "Guide turn did not land — the reader was told we did not understand."
        : `Client validator rejected ${args.outcome.rejected.length} proposed slot(s): ${args.outcome.rejected.map((r) => r.key).join(", ")}.`,
      uid: args.uid,
      context: {
        turnId: args.turnId,
        applied: args.outcome.applied,
        rejected: args.outcome.rejected.slice(0, 10),
        admittedFailure: args.outcome.admittedFailure,
      },
    });
  }
}

// ---- Everything that is not a typed message ----------------------------------

/**
 * Per-instance ceiling on events per user per minute.
 *
 * The route is unmetered and each call is a write we pay for, so one runaway
 * client (a render loop, someone poking the endpoint) must not be able to turn
 * telemetry into a bill. Per instance and in memory — approximate across a scaled
 * fleet, which is fine for a ceiling that only has to stop abuse, not count.
 */
const EVENTS_PER_MINUTE = 90;
const eventWindow = new Map<string, { start: number; count: number }>();

function underEventLimit(uid: string, now: number): boolean {
  const entry = eventWindow.get(uid);
  if (!entry || now - entry.start >= 60_000) {
    // Opportunistic cleanup so the map can't grow with every uid ever seen.
    if (eventWindow.size > 5000) {
      for (const [key, value] of eventWindow) if (now - value.start >= 60_000) eventWindow.delete(key);
    }
    eventWindow.set(uid, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= EVENTS_PER_MINUTE;
}

export interface RecordGuideEventArgs {
  uid: string;
  projectId: string;
  kind: GuideEventKind;
  detail?: unknown;
}

/**
 * Append one non-message interaction to the user's own event log.
 *
 * Same shape of promise as the turn log — backend-only writes, owner-readable,
 * TTL'd on `expiresAt` (a `Timestamp`, for the same reason as there), erased with
 * the user tree. Returns false when it was dropped for rate, so the route can say
 * so; a drop is never an error to the reader.
 *
 * `detail` is cleaned by {@link cleanEventDetail}: flat scalars only, bounded. The
 * log is for counting and sequencing what people DO, so there is no field in it
 * that could hold what they WROTE — that belongs to the turn log, which already
 * has its own retention and reasons.
 */
export async function recordGuideEvent(args: RecordGuideEventArgs): Promise<boolean> {
  const now = Date.now();
  if (!underEventLimit(args.uid, now)) return false;
  ensureAdmin();
  const eventId = randomUUID();
  const cleanedDetail = cleanEventDetail(args.detail);
  await getFirestore()
    .doc(`users/${args.uid}/guideEvents/${eventId}`)
    .set({
      eventId,
      projectId: args.projectId.slice(0, 200),
      kind: args.kind,
      detail: cleanedDetail,
      createdAt: now,
      expiresAt: new Date(now + RETENTION_MS),
    });

  if (args.kind === "error") {
    void log.error({
      source: "frontend",
      domain: "studio",
      event: "guide.client.error",
      message: "Reader encountered an error in the Guided Studio.",
      uid: args.uid,
      projectId: args.projectId.slice(0, 200),
      context: {
        eventId,
        ...(cleanedDetail && typeof cleanedDetail === "object" ? (cleanedDetail as Record<string, unknown>) : {}),
      },
    });
  }

  return true;
}
