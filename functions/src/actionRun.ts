/**
 * **Action runs** — one record per thing the user actually clicked.
 *
 * The metering stack has three layers, and this is the middle one:
 *
 *   1. `users/{uid}/usage/{id}` — one doc per PROVIDER CALL (tokens, cost,
 *      latency, step, billable). Fine-grained, aged out by TTL.
 *   2. `actionRuns/{runId}`     — one doc per USER CALL: what they asked for,
 *      how many provider calls it took, what it cost us, what we charged, and
 *      what we absorbed. Kept forever; every admin cost view reads this.
 *   3. `financeEvents`          — the money ledger.
 *
 * Layer 2 is what makes the other two answerable together. Without it, "what
 * did this render cost the user" has to be reconstructed by grouping call docs
 * on a shared timestamp, and per-call averages get mistaken for per-render
 * prices (which is exactly how a 13✦ dashboard number hid a 29✦ charge).
 *
 * {@link meterAndSettle} is the ONLY place that records usage, settles Sparks,
 * writes the run, updates the project mirror and records latency — so those can
 * never drift apart or be forgotten at a new call site.
 */
import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getSparksConfig } from "./appConfig";
import { recordUsage, splitBillable, type CallStats, type UsageEvent } from "./usage";
import { settleActionCost } from "./sparks";
import { ensureProjectMirror, recordProjectRun } from "./projects";
import { recordTaskLatency } from "./latency";
import type { LatencyKind } from "../../books-frontend/src/core/config/latencyStats";
import { ALL_IMAGE_ACTION_IDS, type ImageActionId } from "../../books-frontend/src/core/ai/actions";
import type { ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import type { ModelSelection, Project } from "../../books-frontend/src/core/types";

function isImageAction(action: string): action is ImageActionId {
  return (ALL_IMAGE_ACTION_IDS as string[]).includes(action);
}

/** What kind of request produced this run (drives the edit/fresh split). */
export type RunKind = "fresh" | "edit" | "variation" | "restyle";

/**
 * Classify a render request. A restyle re-renders existing artwork in a new
 * style, an edit carries an instruction, a variation re-rolls from the current
 * image, and everything else is a fresh render.
 */
export function runKindOf(
  options: { restyle?: boolean; useReference?: boolean; edit?: string } | undefined,
  isEdit: boolean,
): RunKind {
  if (options?.restyle) return "restyle";
  if (isEdit) return "edit";
  if (options?.useReference) return "variation";
  return "fresh";
}

export type RunOutcome = "ok" | "failed" | "aborted";

export interface ActionRunDoc {
  runId: string;
  at: number;
  uid: string;
  projectId?: string;
  projectSeq?: number;
  action: string;
  tier?: ImageTier;
  kind: RunKind;
  targetId?: string;
  jobId?: string;
  source: "sync" | "worker";
  models: Record<string, string>;
  calls: { total: number; failures: number; byStep: Record<string, number> };
  costUsd: {
    total: number;
    billable: number;
    unbilled: number;
    byStep: Record<string, number>;
  };
  sparks: {
    quoted: number | null;
    charged: number;
    paid: number;
    free: number;
    unfunded: number;
    paidUsd: number;
    byLotSource: Record<string, number>;
  };
  /** Spark value charged minus what the calls cost us. */
  marginUsd: number;
  durationMs: number;
  outcome: RunOutcome;
  errorCode?: string;
  tokens: number;
}

export interface MeterAndSettleArgs {
  uid: string;
  action: string;
  tier?: ImageTier;
  /** Everything `withUsage` collected for this action. */
  events: UsageEvent[];
  stats: CallStats;
  projectId?: string;
  /** The project snapshot the render ran against (worker paths have it). */
  project?: Project;
  kind: RunKind;
  targetId?: string;
  jobId?: string;
  source: "sync" | "worker";
  /** What the user was quoted before starting, when the caller knows it. */
  quotedSparks?: number;
  startedAt: number;
  outcome?: RunOutcome;
  errorCode?: string;
  /** Models resolved for this run, keyed by role ("image", "text", …). */
  models?: Record<string, ModelSelection | undefined>;
  /** Latency bucket for the rolling window; skipped when absent. */
  latency?: { kind: LatencyKind; refs: number };
}

export interface MeterAndSettleResult {
  runId: string;
  sparksCharged: number;
  costUsd: number;
  unbilledUsd: number;
}

function db() {
  ensureAdmin();
  return getFirestore();
}

function modelMap(models: MeterAndSettleArgs["models"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, sel] of Object.entries(models ?? {})) {
    if (sel) out[role] = `${sel.provider}:${sel.id}`;
  }
  return out;
}

/** Provider calls that produced a delivered image (excludes repair passes). */
function countImages(events: UsageEvent[]): number {
  return events.filter((e) => e.modality === "image").length;
}

/**
 * Meter one finished action end-to-end: persist the per-call line items, settle
 * the billable half against the user's Sparks, write the run record, fold the
 * result into the project mirror and user rollups, and record latency.
 *
 * Best-effort in the same sense as the pieces it composes: a failure here is
 * logged and recorded, never thrown into the render that produced the work.
 */
export async function meterAndSettle(args: MeterAndSettleArgs): Promise<MeterAndSettleResult> {
  const runId = randomUUID();
  const at = Date.now();
  const durationMs = Math.max(0, at - args.startedAt);
  const outcome: RunOutcome = args.outcome ?? "ok";
  const isEdit = args.kind === "edit";

  try {
    // The mirror must exist before the line items so they can carry `projectSeq`.
    const projectSeq = args.projectId
      ? await ensureProjectMirror(args.uid, args.projectId, args.project)
      : undefined;

    const totals = await recordUsage(args.uid, args.action, args.events, args.tier, {
      projectId: args.projectId,
      isEdit,
      stats: args.stats,
      runId,
      projectSeq,
    });

    const settled = await settleActionCost(args.uid, args.action, args.events, {
      projectId: args.projectId,
      runId,
      // Denormalized onto the ledger entry so a campaign can refund "everything
      // you spent on fast renders" with a query rather than a join through here.
      tier: args.tier,
    });

    const { billable, unbilled } = splitBillable(args.events);
    const sparksConfig = await getSparksConfig();
    const chargedValueUsd = settled.sparks * sparksConfig.sparkValueUsd;
    const breakdown = settled.breakdown;

    const run: ActionRunDoc = {
      runId,
      at,
      uid: args.uid,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(typeof projectSeq === "number" ? { projectSeq } : {}),
      action: args.action,
      ...(args.tier ? { tier: args.tier } : {}),
      kind: args.kind,
      ...(args.targetId ? { targetId: args.targetId } : {}),
      ...(args.jobId ? { jobId: args.jobId } : {}),
      source: args.source,
      models: modelMap(args.models),
      calls: {
        total: args.events.length,
        failures: args.stats?.failures ?? 0,
        byStep: totals.callsByStep,
      },
      costUsd: {
        total: totals.totalUsd,
        billable: totals.billableUsd,
        unbilled: totals.unbilledUsd,
        byStep: totals.costByStep,
      },
      sparks: {
        quoted: typeof args.quotedSparks === "number" ? args.quotedSparks : null,
        charged: settled.sparks,
        paid: breakdown?.paidSparks ?? 0,
        free: breakdown?.freeSparks ?? 0,
        unfunded: breakdown?.unfundedSparks ?? 0,
        paidUsd: breakdown?.paidUsd ?? 0,
        byLotSource: breakdown?.freeBySource ?? {},
      },
      marginUsd: Math.round((chargedValueUsd - totals.totalUsd) * 10000) / 10000,
      durationMs,
      outcome,
      ...(args.errorCode ? { errorCode: args.errorCode } : {}),
      tokens: totals.tokens,
    };
    await db().collection("actionRuns").doc(runId).set(run);

    if (args.projectId) {
      await recordProjectRun({
        uid: args.uid,
        projectId: args.projectId,
        action: args.action,
        tier: args.tier,
        imageModel: run.models.image ?? run.models.anchorImage,
        imagesGenerated: countImages(billable),
        qcCalls: unbilled.length,
        kind: args.kind,
        failed: outcome !== "ok",
        costUsd: {
          total: totals.totalUsd,
          billed: totals.billableUsd,
          unbilled: totals.unbilledUsd,
        },
        sparks: {
          charged: settled.sparks,
          paid: breakdown?.paidSparks ?? 0,
          free: (breakdown?.freeSparks ?? 0) + (breakdown?.unfundedSparks ?? 0),
          byLotSource: breakdown?.freeBySource ?? {},
        },
        at,
      });
    }

    await bumpUserRollups({
      uid: args.uid,
      providerUsd: totals.totalUsd,
      sparksSpent: settled.sparks,
      at,
    });

    // The latency window is keyed by image action + tier, so text actions and
    // tier-less calls simply have nothing to append to.
    if (args.latency && args.tier && isImageAction(args.action)) {
      await recordTaskLatency(
        args.action,
        args.tier,
        args.latency.kind,
        args.latency.refs,
        durationMs,
      );
    }

    return {
      runId,
      sparksCharged: settled.sparks,
      costUsd: totals.totalUsd,
      unbilledUsd: totals.unbilledUsd,
    };
  } catch (err) {
    console.error("[actionRun] metering failed", {
      uid: args.uid,
      action: args.action,
      projectId: args.projectId,
      err,
    });
    return { runId, sparksCharged: 0, costUsd: 0, unbilledUsd: 0 };
  }
}

/** Keep the lifetime per-user totals the admin user table reads. */
async function bumpUserRollups(args: {
  uid: string;
  providerUsd: number;
  sparksSpent: number;
  at: number;
}): Promise<void> {
  try {
    await db()
      .doc(`users/${args.uid}`)
      .set(
        {
          lastActiveAt: args.at,
          lifetime: {
            providerCostUsd: FieldValue.increment(args.providerUsd),
            sparksSpent: FieldValue.increment(args.sparksSpent),
          },
        },
        { merge: true },
      );
  } catch {
    // telemetry only
  }
}

// ---- Read side ---------------------------------------------------------------

export interface RunQuery {
  fromMs: number;
  toMs: number;
  uid?: string;
  projectId?: string;
  action?: string;
  tier?: ImageTier;
  kind?: RunKind;
  outcome?: RunOutcome;
  limit?: number;
}

/**
 * List action runs newest-first. Filters beyond the time range are applied in
 * memory so the query needs only the single-field `at` index — same tradeoff
 * the finance summary makes.
 */
export async function listActionRuns(q: RunQuery): Promise<ActionRunDoc[]> {
  ensureAdmin();
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 1000);
  const snap = await db()
    .collection("actionRuns")
    .where("at", ">=", q.fromMs)
    .where("at", "<=", q.toMs)
    .orderBy("at", "desc")
    .limit(Math.min(limit * 5, 5000))
    .get();
  const rows = snap.docs
    .map((d) => d.data() as ActionRunDoc)
    .filter(
      (r) =>
        (!q.uid || r.uid === q.uid) &&
        (!q.projectId || r.projectId === q.projectId) &&
        (!q.action || r.action === q.action) &&
        (!q.tier || r.tier === q.tier) &&
        (!q.kind || r.kind === q.kind) &&
        (!q.outcome || r.outcome === q.outcome),
    );
  return rows.slice(0, limit);
}

export async function getActionRun(runId: string): Promise<ActionRunDoc | null> {
  ensureAdmin();
  const snap = await db().collection("actionRuns").doc(runId).get();
  return snap.exists ? (snap.data() as ActionRunDoc) : null;
}

/** The per-call line items behind one run. */
export async function getRunCalls(uid: string, runId: string): Promise<Record<string, unknown>[]> {
  ensureAdmin();
  const snap = await db()
    .collection(`users/${uid}/usage`)
    .where("runId", "==", runId)
    .limit(200)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
