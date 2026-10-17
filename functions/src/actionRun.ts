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
import {
  costGroupOf,
  recordUsage,
  splitBillable,
  type CallStats,
  type CostGroup,
  type UsageEvent,
} from "./usage";
import { estimateForUser, settleActionCost } from "./sparks";
import { ensureProjectMirror, recordProjectRun } from "./projects";
import { recordTaskLatency } from "./latency";
import { log } from "./logs";
import {
  completeGenerationEstimateProfile,
  generationRenderKindOf,
  type GenerationEstimateProfile,
  type GenerationRenderKind,
} from "../../books-frontend/src/core/config/generationEstimateProfile";
import { ALL_IMAGE_ACTION_IDS, type ImageActionId } from "../../books-frontend/src/core/ai/actions";
import { normalizeImageTier, type ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import type { ModelSelection, Project } from "../../books-frontend/src/core/types";
import type { ResolvedImageGenerationOptions } from "../../books-frontend/src/core/config/imageGeneration";

function isImageAction(action: string): action is ImageActionId {
  return (ALL_IMAGE_ACTION_IDS as string[]).includes(action);
}

/** What kind of request produced this run (drives the edit/fresh split). */
export type RunKind = GenerationRenderKind;

/**
 * Classify a render request. A restyle re-renders existing artwork in a new
 * style, an edit carries an instruction, a variation re-rolls from the current
 * image, and everything else is a fresh render.
 */
export function runKindOf(
  options: { restyle?: boolean; useReference?: boolean; edit?: string } | undefined,
  isEdit: boolean,
): RunKind {
  if (isEdit) return "edit";
  return generationRenderKindOf(options);
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
  calls: {
    total: number;
    failures: number;
    byStep: Record<string, number>;
    durationMsByStep: Record<string, number>;
  };
  costUsd: {
    total: number;
    billable: number;
    unbilled: number;
    byStep: Record<string, number>;
    /** Image-generation calls versus text/vision calls (absent on older runs). */
    imageCalls?: number;
    textCalls?: number;
  };
  /** Which side of the books this run's whole cost belongs to. */
  group?: CostGroup;
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
  generation?: {
    requested: Record<string, unknown>;
    applied: Record<string, unknown>;
    skipped: string[];
    inputReferenceCount: number;
  };
  estimateProfile?: GenerationEstimateProfile;
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
  /**
   * A stable id for the unit of work, so a re-driven task charges once. See
   * {@link SettleOptions.settleKey}; omit it for synchronous requests, where a
   * repeat is the user deliberately asking again.
   */
  settleKey?: string;
  startedAt: number;
  outcome?: RunOutcome;
  errorCode?: string;
  /** Models resolved for this run, keyed by role ("image", "text", …). */
  models?: Record<string, ModelSelection | undefined>;
  /** Latency bucket for the rolling window; skipped when absent. */
  latency?: { profile: GenerationEstimateProfile; refs: number };
  /** Exact profile shared by the cost window, quote, and completed run. */
  estimateProfile?: GenerationEstimateProfile;
  /** Resolved image options and the actual reference payload sent. */
  generation?: ResolvedImageGenerationOptions;
  inputReferenceCount?: number;
  outputSize?: string;
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

function compactGeneration(
  generation: ResolvedImageGenerationOptions,
  inputReferenceCount: number,
): NonNullable<ActionRunDoc["generation"]> {
  return {
    requested: JSON.parse(JSON.stringify(generation.requested)) as Record<string, unknown>,
    applied: JSON.parse(JSON.stringify(generation.applied)) as Record<string, unknown>,
    skipped: generation.skipped,
    inputReferenceCount,
  };
}

/** Provider calls that produced a delivered image (excludes repair passes). */
function countImages(events: UsageEvent[]): number {
  return events.filter((e) => e.modality === "image").length;
}

function durationByStep(events: UsageEvent[]): Record<string, number> {
  const durations: Record<string, number> = {};
  for (const event of events) {
    const step = event.step ?? "unscoped";
    durations[step] = (durations[step] ?? 0) + (event.durationMs ?? 0);
  }
  return durations;
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
  const eventSplit = splitBillable(args.events);
  const completedEstimateProfile = args.estimateProfile
    ? completeGenerationEstimateProfile(args.estimateProfile, {
        outputSize: args.outputSize,
        referenceCount: args.inputReferenceCount ?? args.latency?.refs,
        billableImages: countImages(eventSplit.billable),
      })
    : undefined;
  try {
    // The mirror must exist before the line items so they can carry `projectSeq`.
    const projectSeq = args.projectId
      ? await ensureProjectMirror(args.uid, args.projectId, args.project)
      : undefined;

    const totals = await recordUsage(args.uid, args.action, args.events, args.tier, {
      projectId: args.projectId,
      // Only a delivered render may shape the next price.
      estimateProfile: outcome === "ok" ? completedEstimateProfile : undefined,
      stats: args.stats,
      runId,
      projectSeq,
    });

    // The price shown is the price charged. A caller that quoted passes its
    // quote; an unquoted action is priced here by the same function the studio
    // shows it with. Nothing is charged for work that didn't deliver.
    const quoted =
      outcome === "ok"
        ? (args.quotedSparks ??
          (await estimateForUser(args.uid, args.action, args.tier ?? normalizeImageTier(undefined), args.kind).catch(
            () => undefined,
          )))
        : 0;

    const settled = await settleActionCost(args.uid, args.action, args.events, {
      projectId: args.projectId,
      runId,
      // Denormalized onto the ledger entry so a campaign can refund "everything
      // you spent on fast renders" with a query rather than a join through here.
      tier: args.tier,
      settleKey: args.settleKey,
      exactSparks: quoted,
    });

    const { billable, unbilled } = eventSplit;
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
        durationMsByStep: durationByStep(args.events),
      },
      costUsd: {
        total: totals.totalUsd,
        billable: totals.billableUsd,
        unbilled: totals.unbilledUsd,
        byStep: totals.costByStep,
        imageCalls: totals.imageCallsUsd,
        textCalls: totals.textCallsUsd,
      },
      group: costGroupOf(args.action),
      sparks: {
        quoted: quoted ?? null,
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
      ...(args.generation
        ? {
            generation: compactGeneration(
              args.generation,
              args.inputReferenceCount ?? args.latency?.refs ?? 0,
            ),
          }
        : {}),
      ...(completedEstimateProfile ? { estimateProfile: completedEstimateProfile } : {}),
    };
    await db().collection("actionRuns").doc(runId).set(run);

    // Emit a diagnostic log entry when an AI run fails or required provider
    // retries / quality-check repairs, so an admin investigating a user's book
    // sees the exact model, step, cost, and error code in the Logs timeline.
    if (outcome === "failed") {
      void log.error({
        source: args.source === "worker" ? "worker" : "backend",
        domain: "ai",
        event: `ai.${args.action}.failed`,
        message: `AI action "${args.action}" (${args.kind}) failed${args.errorCode ? ` [${args.errorCode}]` : ""} after ${durationMs}ms.`,
        uid: args.uid,
        projectId: args.projectId ?? null,
        jobId: args.jobId ?? null,
        context: {
          runId,
          action: args.action,
          kind: args.kind,
          tier: args.tier ?? null,
          targetId: args.targetId ?? null,
          errorCode: args.errorCode ?? null,
          models: run.models,
          calls: run.calls,
          costUsd: run.costUsd,
          durationMs,
        },
      });
    } else if ((args.stats?.failures ?? 0) > 0 || unbilled.length > 0) {
      void log.warn({
        source: args.source === "worker" ? "worker" : "backend",
        domain: "ai",
        event: `ai.${args.action}.repaired`,
        message: `AI action "${args.action}" succeeded with ${args.stats?.failures ?? 0} provider failure(s) and ${unbilled.length} quality-repair call(s) (${durationMs}ms).`,
        uid: args.uid,
        projectId: args.projectId ?? null,
        jobId: args.jobId ?? null,
        context: {
          runId,
          action: args.action,
          kind: args.kind,
          targetId: args.targetId ?? null,
          models: run.models,
          calls: run.calls,
          unbilledCalls: unbilled.length,
          costUsd: run.costUsd,
          sparksCharged: settled.sparks,
          durationMs,
        },
      });
    }

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
        group: costGroupOf(args.action),
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
        completedEstimateProfile ?? args.latency.profile,
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
    void log.error({
      source: args.source === "worker" ? "worker" : "backend",
      domain: "ai",
      event: "ai.metering.failed",
      message: `Metering and Spark settlement failed for action "${args.action}".`,
      uid: args.uid,
      projectId: args.projectId ?? null,
      jobId: args.jobId ?? null,
      error: err,
      context: {
        runId,
        action: args.action,
        kind: args.kind,
      },
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

/**
 * One user's runs, newest first.
 *
 * Its own query rather than `listActionRuns({ uid })` because that one scans a
 * time window and filters by user in memory: on a busy day the user's rows fall
 * outside the scan and the answer is "no runs", which is wrong in a way nothing
 * flags. A single equality filter needs no composite index and reads only this
 * user's documents; the sort is done here for the same reason. Without a server
 * ordering the cap takes an arbitrary slice, so callers compare the result length
 * with `limit` and say "at least" when it is reached.
 */
export async function listUserActionRuns(uid: string, limit = 1000): Promise<ActionRunDoc[]> {
  ensureAdmin();
  const snap = await db()
    .collection("actionRuns")
    .where("uid", "==", uid)
    .limit(Math.min(Math.max(limit, 1), 1000))
    .get();
  return snap.docs
    .map((d) => d.data() as ActionRunDoc)
    .sort((a, b) => b.at - a.at);
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
