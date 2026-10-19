/**
 * Generation fan-out — turns a job document into a graph of independently
 * dispatched Cloud Tasks so a per-book batch scales horizontally instead of
 * racing one Cloud Function's 540s / memory budget.
 *
 * Three pieces:
 *   1. `onGenerationJob` (Firestore create trigger, the ENQUEUER): expands a
 *      job's `tasks` spec into a per-task subcollection
 *      (`users/{uid}/jobs/{jobId}/tasks/{taskId}`), computes each task's
 *      dependency edges, and dispatches every ready ("root") task onto the
 *      Cloud Tasks queue. Cheap and fast — it renders nothing.
 *   2. `runFanTask` (Cloud Tasks worker): renders exactly ONE task on its own
 *      instance, writes the result to that task's doc, atomically advances the
 *      parent job's aggregate progress, and dispatches any dependents whose
 *      dependencies are now all satisfied. Concurrent workers touch different
 *      task docs, so there is no write contention; fleet-wide throughput is
 *      capped by the queue's `maxConcurrentDispatches` (which also shields the
 *      image provider from bursts, independent of how many tasks are enqueued).
 *   3. `reapStuckJobs` (scheduled backstop): re-drives jobs whose enqueue was
 *      lost or whose worker died — re-expanding un-expanded jobs and re-queuing
 *      ready tasks — and finalizes jobs deadlocked by a failed dependency.
 *
 * The task graph is generic: a task runs only once every id in its `dependsOn`
 * is `done`. Pages/covers ship with no dependencies (fully parallel) today;
 * anchors depend on their contained anchors (children first). A future feature
 * can add page/cover dependencies purely by populating `dependsOn` — the
 * dispatch/worker/reaper engine needs no changes.
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { logger } from "firebase-functions/v2";
import { randomUUID } from "node:crypto";
import {
  FieldValue,
  getFirestore,
  type CollectionReference,
  type DocumentReference,
} from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { getAuth } from "firebase-admin/auth";
import "./providerHttp";
import { serverConfig } from "./config";
import { buildHoleMask, compositeMaskedRegion, downscaleReference } from "./imaging";
import { backendPipelineEnv } from "./pipelineEnv";
import {
  getLayoutsConfig,
  getGenerationTuningConfig,
  loadModelCapabilities,
  loadPromptContext,
  recordLatencySamples,
} from "./appConfig";
import { requireTier, resolveImageModels, resolveTextAction } from "./modelResolve";
import {
  newSpendLedger,
  runWithCarriedCost,
  runWithSpendLedger,
  withStep,
  withUsage,
  addCallStats,
  type CallStats,
  type CarriedCost,
  type SpendLedger,
  type UsageEvent,
} from "./usage";
import { errorText, meterAndSettle } from "./actionRun";
import { featureAllowedForUser } from "./plans";
import { ensureAfford, estimateForUser, referenceGroupFor, referenceLimitsForAction } from "./sparks";
import { quoteUnitKey } from "../../books-frontend/src/core/billing/generationQuote";
import {
  cappedReferenceCount,
  plannedAnchorReferences,
  plannedIllustrationReferences,
  plannedPortraitReferences,
  type ReferenceLimits,
} from "../../books-frontend/src/core/billing/referencePlan";
import { consumeQuote } from "./generationQuotes";
import { sendBookDrawnEmail } from "./email/triggers";
import { normalizeImageTier, type ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import {
  capabilitiesFor,
  sanitizeImageSize,
  type CapabilityOverrides,
} from "../../books-frontend/src/core/config/modelCapabilities";
import { resolveImageGenerationOptions } from "../../books-frontend/src/core/config/imageGeneration";
import {
  generationIntentFor,
  generationTuningFor,
  normalizeGenerationTuningConfig,
  type GenerationTuningConfig,
} from "../../books-frontend/src/core/config/generationTuning";
import { ALL_SECRETS } from "./secrets";
import { BlobMissingError, downloadBlob, downloadPublicBase64, ensureAdmin, uploadBlob } from "./storage";
import { applyCustomStyleToProject } from "./customStyles";
import { captureStyleCover } from "./styleShowcase";
import { deleteLikenessPhotoForSubject, hasLikenessPhotoForSubject, loadLikenessPhotosForSubject } from "./likeness";
import { locateEditPartOutcome, planPartEdit } from "../../books-frontend/src/core/pipeline/localize";
import { PORTRAIT_SIZE } from "../../books-frontend/src/core/guide/portraitFrame";
import { likenessPhotosOf, PORTRAIT_EDIT_NOT_VISIBLE, portraitEditPrompt, portraitPrompt, portraitReferencePlan } from "../../books-frontend/src/core/guide/portrait";
import { briefOf, namedCast } from "../../books-frontend/src/core/story/brief";
import { firstUnmet, personNeedsStatedAge } from "../../books-frontend/src/core/guide/agent/requirements";
import type { RequirementId } from "../../books-frontend/src/core/guide/agent/types";
import type { Project, SourceArtRef } from "../../books-frontend/src/core/types";
import {
  resolvePromptsConfig,
  type PromptContext,
} from "../../books-frontend/src/core/prompts/context";
import type { ResolvedModels } from "../../books-frontend/src/core/models/registry";
import { isAbortError, ProviderError } from "../../books-frontend/src/core/errors";
import { containedAnchorsFor } from "../../books-frontend/src/core/book/anchorGraph";
import { effectiveAnchorIds } from "../../books-frontend/src/core/book/anchorRefs";
import {
  clampDerivedStylePrompt,
  derivedArtStyle,
  hasSourceArt,
} from "../../books-frontend/src/core/book/sourceArt";
import { spreadsById } from "../../books-frontend/src/core/book/units";
import { DISPATCH_KEY } from "../../books-frontend/src/core/config/latencyStats";
import type { ImageActionId } from "../../books-frontend/src/core/ai/actions";
import type { CostSampleKind } from "../../books-frontend/src/core/config/imageCostStats";
import {
  estimateProfileForAction,
  generationRenderKindOf,
} from "../../books-frontend/src/core/config/generationEstimateProfile";
import { latencyKindOf as kindOf } from "./latency";
import {
  applyAnchorRender,
  renderAnchor,
  type AnchorRender,
} from "../../books-frontend/src/core/pipeline/anchorRun";
import { InPlaceEditError, renderIllustration } from "../../books-frontend/src/core/pipeline/illustrationRun";
import { signalUntil } from "../../books-frontend/src/core/pipeline/illustrationRun";
import { generateScreenplay } from "../../books-frontend/src/core/pipeline/screenplay";
import {
  assessPortraitQuality,
  portraitQualityCorrections,
  portraitQualityPassed,
} from "../../books-frontend/src/core/pipeline/portraitQuality";
import { buildRenderRecord, stampImageProvenance } from "../../books-frontend/src/core/pipeline/imageProvenance";
import { withRetry } from "../../books-frontend/src/core/pipeline/retry";
import { getImageProvider } from "../../books-frontend/src/core/providers";
import type {
  ImageResult,
  ImageRequest,
  ReferenceImage,
} from "../../books-frontend/src/core/providers/types";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  SPINE_ID,
  type BookConfig,
} from "../../books-frontend/src/core/types";
import {
  type AnchorsJob,
  type AnchorTask,
  type AnyJob,
  type BookJob,
  type BookTask,
  type ImageRenderRequest,
  type JobKind,
  type JobProgress,
  type JobStatus,
  type JobTask,
  type PipelineRefreshJob,
  type PortraitJob,
  type PortraitTask,
  type RefreshTask,
  type ScreenplayJob,
  type ScreenplayTask,
  type TaskDoc,
  type TaskResult,
  type TaskStats,
} from "../../books-frontend/src/core/jobs/types";

/** The Cloud Tasks queue backing {@link runFanTask} (== the function name). */
const FAN_QUEUE = "runFanTask";
/**
 * Text generation runs on its OWN queue ({@link runTextTask}).
 *
 * Both kinds of work used to share `runFanTask`, whose fleet-wide dispatch cap
 * exists to protect the image provider. That cap is small on purpose, so a
 * single "illustrate 12 pages" batch filled it with multi-minute renders and
 * every screenplay behind them simply waited — a cheap 30s text call queued
 * behind expensive image work it has no resource conflict with. Separate queues
 * remove the head-of-line blocking entirely.
 */
const TEXT_QUEUE = "runTextTask";

/** Which queue a job kind's tasks belong on. */
function queueForKind(kind: JobKind): string {
  return kind === "screenplay" ? TEXT_QUEUE : FAN_QUEUE;
}

/**
 * How long a worker owns a claimed task before another dispatch may re-claim it.
 *
 * Short on purpose: the owner renews it every {@link TASK_HEARTBEAT_MS} while it
 * is alive, so a slow-but-alive render is never double-run, and a worker that
 * died (OOM, instance reclaimed) frees its task within about this long instead
 * of after the longest render could possibly have taken.
 */
const TASK_LEASE_MS = 90_000;
/** How often a live worker renews its lease. Three misses in a row lose it. */
const TASK_HEARTBEAT_MS = 30_000;
/** Hard cap on a single attempt's provider work — a stalled call fails fast. */
const TASK_TIMEOUT_MS = 4 * 60_000;
/**
 * The front cover is the one picture that may not ship without its painted
 * words, so an attempt gets room to paint it again (see
 * `COVER_LETTERING_DRAWS`). The worker's own deadline sits above it.
 */
const COVER_TASK_TIMEOUT_MS = 8 * 60_000;
/**
 * Everything one wave may spend on one task across ALL its attempts, measured
 * from the first claim. Cloud Tasks' own retry count starts over every time the
 * reaper re-enqueues, so without a budget kept on the task a poison task could
 * be attempted for as long as the reaper kept finding it.
 */
const TASK_BUDGET_MS = 12 * 60_000;
const COVER_TASK_BUDGET_MS = 18 * 60_000;
/** An attempt that cannot get at least this long is not started. */
const MIN_ATTEMPT_MS = 45_000;
/**
 * The same for the front cover, whose one painting alone takes one to three
 * minutes before its words are read back: an attempt started with less than
 * this is cut off mid-painting, paid for and thrown away.
 */
const COVER_MIN_ATTEMPT_MS = 4 * 60_000;
/**
 * A non-terminal job whose `updatedAt` is older than this is looked at by the
 * reaper. Just above the task lease, so a worker that died is noticed on the
 * first sweep after its lease lapses.
 */
const STALE_MS = TASK_LEASE_MS + 30_000;
/** A task waiting in the queue is re-enqueued only after it has waited this long. */
const PENDING_REQUEUE_MS = 4 * 60_000;
/**
 * Max times the reaper may re-enqueue work for a job that makes no progress
 * before giving up on the remainder. Counts re-drives that DID something; a
 * sweep that only found tasks legitimately in flight costs nothing.
 */
const MAX_JOB_RUNS = 10;
/**
 * The latest a book job may still be running after it starts: a base plus a
 * little per task, capped. Checked by the reaper once the job has stopped
 * making progress, so a book that is moving is never cut off, and one that is
 * not always ends with whatever it has — and an error the studio can show.
 */
const JOB_DEADLINE_BASE_MS = 20 * 60_000;
const JOB_DEADLINE_PER_TASK_MS = 30_000;
const JOB_DEADLINE_MAX_MS = 45 * 60_000;
const DEADLINE_ERROR = "Drawing took longer than expected and was stopped. Nothing was charged for what is missing.";
/** Max stuck jobs a single reaper sweep adopts (repeated ticks drain more). */
const REAP_BATCH = 20;
/** Overall wall-time budget for one reaper sweep. */
const REAP_BUDGET_MS = 400_000;

/**
 * Queue shape (deploy-time config; tune via env). `maxConcurrentDispatches`
 * bounds how many tasks run across the whole fleet at once — the single knob
 * that protects the image provider from bursts no matter how many tasks are
 * enqueued. `concurrency` lets one warm instance serve several tasks (fewer
 * cold starts) within its memory budget.
 */
/**
 * Two, not four: each concurrent render holds decoded image buffers (references,
 * the result, mask composites) in the same 2GiB instance, and an OOM kills every
 * task sharing it — turning one heavy page into several failed ones. More,
 * smaller instances cost a little more and fail one task at a time.
 */
const WORKER_CONCURRENCY = Number(process.env.FAN_WORKER_CONCURRENCY) || 2;
/**
 * Halved from 20. Twenty simultaneous renders on one provider key reliably trip
 * the per-minute image limit, and until the worker started handing throttles
 * back to the queue that came back as permanently failed pages. Retries are the
 * real safety net now, so this doesn't need to be tiny — just low enough that a
 * throttle is occasional rather than the normal state of a large batch.
 */
const MAX_CONCURRENT_DISPATCHES = Number(process.env.FAN_MAX_CONCURRENT) || 10;
const MAX_DISPATCHES_PER_SEC = Number(process.env.FAN_MAX_PER_SEC) || 5;
const TASK_MAX_ATTEMPTS = Number(process.env.FAN_MAX_ATTEMPTS) || 3;

/**
 * Text queue shape. Screenplay drafting is one structured call — no shared
 * provider rate limit with images and a fraction of the memory — so it can run
 * far wider than the image fleet without endangering anything.
 */
const TEXT_WORKER_CONCURRENCY = Number(process.env.TEXT_WORKER_CONCURRENCY) || 8;
const TEXT_MAX_CONCURRENT_DISPATCHES = Number(process.env.TEXT_MAX_CONCURRENT) || 20;
const TEXT_MAX_DISPATCHES_PER_SEC = Number(process.env.TEXT_MAX_PER_SEC) || 10;

function db() {
  return getFirestore();
}

function jobRef(uid: string, jobId: string): DocumentReference {
  return db().doc(`users/${uid}/jobs/${jobId}`);
}

function tasksCol(uid: string, jobId: string): CollectionReference {
  return db().collection(`users/${uid}/jobs/${jobId}/tasks`);
}

/**
 * A per-attempt abort signal that trips after `ms`, or sooner when `abort()` is
 * called (the heartbeat does that the moment it learns the lease is lost, so a
 * worker that no longer owns the task stops spending money on it).
 */
function withTaskTimeout(ms: number): { signal: AbortSignal; done: () => void; abort: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer), abort: () => ctrl.abort() };
}

/** How long one attempt at this task may run. */
function attemptTimeoutMs(taskId: string): number {
  return taskId === COVER_FRONT_ID ? COVER_TASK_TIMEOUT_MS : TASK_TIMEOUT_MS;
}

/** The least time an attempt at this task must have to be worth starting. */
function minAttemptMs(taskId: string): number {
  return taskId === COVER_FRONT_ID ? COVER_MIN_ATTEMPT_MS : MIN_ATTEMPT_MS;
}

/** Everything one wave may spend on this task, all attempts together. */
function taskBudgetMs(taskId: string): number {
  return taskId === COVER_FRONT_ID ? COVER_TASK_BUDGET_MS : TASK_BUDGET_MS;
}

function apiKeyFor(provider: ProviderId): string {
  const cfg = serverConfig();
  const key = provider === "openai" ? cfg.openaiApiKey : cfg.googleApiKey;
  if (!key) throw new Error(`The ${provider} provider is not configured on the server.`);
  return key;
}

function bufToBase64(buf: Buffer): string {
  return buf.toString("base64");
}

/** Cover/spine pseudo-spread ids are billed as `coverIllustration`, not pages. */
function isCoverId(id: string): boolean {
  return id === COVER_FRONT_ID || id === COVER_BACK_ID || id === SPINE_ID;
}

function illustrationActionFor(taskId: string): "pageIllustration" | "coverIllustration" {
  return isCoverId(taskId) ? "coverIllustration" : "pageIllustration";
}

/**
 * The pipeline one task runs. A book job mixes sheets and pages, so its tasks
 * carry their own kind; every other job's tasks share the job's.
 */
function taskKindOf(job: AnyJob, spec: AnyJob["tasks"][number] | TaskDoc): JobKind {
  if (job.kind !== "book") return job.kind;
  return (spec as BookTask | TaskDoc).kind === "anchors" ? "anchors" : "refresh";
}

/** The Spark action one task will SETTLE as — the same one it must be quoted at. */
function taskAction(kind: JobKind, taskId: string): ImageActionId {
  if (kind === "portrait") return "portrait";
  return kind === "anchors" ? "anchorImage" : illustrationActionFor(taskId);
}

/**
 * Which exact render shape one task is priced from.
 */
function taskQuoteKind(spec: AnyJob["tasks"][number] | TaskDoc): CostSampleKind {
  const req = "request" in spec ? spec.request : undefined;
  if (req) return req.composite || req.maskBlobId ? "edit" : "fresh";
  if ("edit" in spec && spec.edit) return "edit";
  const options = "options" in spec ? spec.options : undefined;
  return generationRenderKindOf(options);
}

/**
 * Key one task's quote by everything that moves its price: the action it settles
 * as (a cover costs more than a page) and whether it's an edit (which spends one
 * image call per subject). One number per batch under-quoted every mixed batch.
 * A task planned to send N reference images is priced in N's group.
 */
function quoteKey(action: ImageActionId, kind: CostSampleKind, group?: string): string {
  return quoteUnitKey(action, kind, group);
}

/**
 * Reference images each image task will send, planned from the job's book the
 * way its renderer assembles them. Absent for tasks that can't be planned.
 */
async function plannedTaskReferences(
  uid: string,
  job: AnyJob,
  specs: AnyJob["tasks"],
  tier: ImageTier,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const limitsByAction = new Map<ImageActionId, ReferenceLimits>();
  const limits = async (action: ImageActionId) => {
    const hit = limitsByAction.get(action);
    if (hit) return hit;
    const next = await referenceLimitsForAction(action, tier);
    limitsByAction.set(action, next);
    return next;
  };
  const project = (job as { project?: Project }).project;
  const sheetsComing = new Set(
    job.kind === "book"
      ? (job.tasks as BookTask[]).filter((t) => t.kind === "anchors").map((t) => t.id)
      : job.kind === "anchors"
        ? job.tasks.map((t) => t.id)
        : [],
  );
  for (const spec of specs) {
    const kind = taskKindOf(job, spec);
    const action = taskAction(kind, spec.id);
    const lim = await limits(action);
    if (kind === "image") {
      const req = (spec as JobTask).request;
      if (req) out.set(spec.id, cappedReferenceCount(req.references?.length ?? 0, lim, { required: Boolean(req.maskBlobId) }));
      continue;
    }
    if (!project) continue;
    if (kind === "portrait") {
      out.set(spec.id, plannedPortraitReferences(project, spec.id, lim, { edit: Boolean((spec as PortraitTask).edit) }));
    } else if (kind === "anchors") {
      const anchor = project.anchors?.find((a) => a.id === spec.id);
      const hasPhoto =
        anchor?.type === "character" && !anchor.versions
          ? await hasLikenessPhotoForSubject(uid, project.id, spec.id).catch(() => false)
          : false;
      out.set(spec.id, plannedAnchorReferences(project, spec.id, { ...((spec as AnchorTask).options ?? {}), hasPhoto }, lim));
    } else if (kind === "refresh") {
      out.set(
        spec.id,
        plannedIllustrationReferences(project, spec.id, { ...((spec as RefreshTask).options ?? {}), sheetsComing }, lim),
      );
    }
  }
  return out;
}

/**
 * What the user was quoted for one task of this job.
 *
 * Falls back to the action's fresh quote, then to the flat `quotedSparks` for
 * jobs expanded before the map existed, so in-flight work keeps reporting a real
 * quote instead of a zero that would read as "quoted free, charged 12".
 */
function quotedFor(
  job: AnyJob,
  task: Pick<TaskDoc, "quoteKey">,
  action: ImageActionId,
  kind: CostSampleKind = "fresh",
): number | undefined {
  const quoted = job.quotedByAction;
  return (
    (task.quoteKey ? quoted?.[task.quoteKey] : undefined) ??
    quoted?.[quoteKey(action, kind)] ??
    quoted?.[action] ??
    job.quotedSparks
  );
}

function isTerminal(status: JobStatus): boolean {
  return status === "done" || status === "error";
}

/**
 * The wallet's idempotency key for one task.
 *
 * Cloud Tasks delivery is at-least-once, and the reaper deliberately re-drives a
 * task whose worker died mid-flight — it can't tell "died before rendering" from
 * "died after rendering but before marking done". Keying the charge to the task
 * rather than to the attempt means the second run re-renders (we pay the
 * provider again, which is real) but bills the reader once.
 */
function taskSettleKey(jobId: string, taskId: string): string {
  return `job:${jobId}:${taskId}`;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Enqueue tasks onto the Cloud Tasks queue. Best-effort per id: a failed
 * enqueue is logged but not thrown, because the reaper re-queues any ready task
 * a job is missing — so a transient queue hiccup can't strand a job.
 */
async function enqueueTasks(
  uid: string,
  jobId: string,
  taskIds: string[],
  kind: JobKind,
): Promise<void> {
  if (taskIds.length === 0) return;
  const queue = getFunctions().taskQueue(queueForKind(kind));
  const send = (taskId: string) =>
    queue.enqueue({ uid, jobId, taskId }).catch((err) => {
      logger.error("[fan] enqueue failed", { jobId, taskId, err: String(err) });
    });
  // The front cover is the longest, most throttle-prone render in a book and the
  // one that can least afford to start late, so it goes into the queue first and
  // is dispatched ahead of the pages queued behind it.
  const first = taskIds.filter((taskId) => taskId === COVER_FRONT_ID);
  if (first.length > 0) await Promise.all(first.map(send));
  await Promise.all(taskIds.filter((taskId) => taskId !== COVER_FRONT_ID).map(send));
}

// ---------------------------------------------------------------------------
// Expansion (job spec -> task graph)
// ---------------------------------------------------------------------------

/**
 * Compute each task's dependency ids. Pages/covers have none (fully parallel);
 * an anchor depends on the contained anchors that are also part of THIS job, so
 * a child (e.g. a bed) renders before the anchor that embeds it (the room).
 */
function buildDependsOn(job: AnyJob): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const specs = job.tasks ?? [];
  if (job.kind !== "anchors" && job.kind !== "book") {
    for (const t of specs) out.set(t.id, []);
    return out;
  }
  const anchors = job.project.anchors ?? [];
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const inJob = new Set(
    specs.filter((t) => taskKindOf(job, t) === "anchors").map((t) => t.id),
  );
  const spreads = job.kind === "book" ? spreadsById(job.project) : null;
  for (const t of specs) {
    if (spreads && taskKindOf(job, t) === "refresh") {
      // A page waits for the sheets of everyone on it that this job redraws.
      const spread = spreads.get(t.id);
      const deps = spread
        ? effectiveAnchorIds(anchors, spread).filter((id) => inJob.has(id))
        : [];
      out.set(t.id, Array.from(new Set(deps)));
      continue;
    }
    const anchor = byId.get(t.id);
    if (!anchor) {
      out.set(t.id, []);
      continue;
    }
    const deps = containedAnchorsFor(anchor, anchors)
      .map((c) => c.id)
      .filter((id) => id !== t.id && inJob.has(id));
    out.set(t.id, Array.from(new Set(deps)));
  }
  return out;
}

/**
 * The caller's standing for job execution (mirrors the HTTP `/ai` guard):
 * every existing account may run jobs — guests included — at the same artwork
 * quality. Guests receive no negative-balance buffer. Fails closed when the
 * account cannot be loaded.
 */
async function jobCallerStanding(uid: string): Promise<{ allowed: boolean; guest: boolean }> {
  try {
    const user = await getAuth().getUser(uid);
    return { allowed: true, guest: user.providerData.length === 0 };
  } catch {
    return { allowed: false, guest: true };
  }
}

/**
 * Feature gate: strip free-text style directions ("customArtStyle") from a
 * refresh/anchors snapshot unless the user's plan allows them. Mutates + returns
 * the job so the gated snapshot is what gets persisted for workers to read.
 */
async function applyFeatureGate(uid: string, job: AnyJob): Promise<AnyJob> {
  if (
    (job.kind === "refresh" ||
      job.kind === "anchors" ||
      job.kind === "portrait" ||
      job.kind === "book") &&
    job.project?.config?.artStyle?.customDescription?.trim()
  ) {
    const allowed = await featureAllowedForUser(uid, "customArtStyle").catch(() => true);
    const style = job.project.config.artStyle;
    // A saved custom style (checked just before this) is a look read from the reader's
    // own drawings, whether or not those drawings are on this book.
    const derived = derivedArtStyle(style) && (hasSourceArt(job.project) || Boolean(style.customStyle));
    if (!allowed && !derived) {
      job.project.config.artStyle = { ...style, customDescription: "" };
    } else if (derived && style.customDescription) {
      job.project.config.artStyle = {
        ...style,
        customDescription: clampDerivedStylePrompt(style.customDescription),
      };
    }
  }
  return job;
}

/** Build the per-kind payload fields for a task doc (omitting undefined). */
function taskPayload(
  kind: JobKind,
  spec: JobTask | RefreshTask | AnchorTask | ScreenplayTask | PortraitTask | BookTask,
): Partial<TaskDoc> {
  if (kind === "portrait") {
    const portrait = spec as PortraitTask;
    return { inputs: portrait.inputs, ...(portrait.edit ? { edit: portrait.edit } : {}) };
  }
  if (kind === "image") {
    const s = spec as JobTask;
    const out: Partial<TaskDoc> = { request: s.request };
    if (s.referenceUses) out.referenceUses = s.referenceUses;
    return out;
  }
  if (kind === "screenplay") return {};
  const s = spec as RefreshTask | AnchorTask;
  return { options: s.options ?? {} };
}

/**
 * Expand a job's `tasks` spec into the per-task subcollection, mark the job
 * `running`/`expanded`, and dispatch its root tasks. Idempotent by task id, so a
 * partial run (created some docs then died) is safely completed by the reaper.
 * Runs the account/afford/feature checks ONCE here, so per-task workers can
 * trust every dispatched task is authorized and paid for.
 */
/**
 * The chat skills' requirements, held on the server too: a portrait needs a
 * chosen look and an age for everyone it draws; a quoted book run needs a
 * story and a look. A client that skips the chat is held to the same rules.
 */
function chatJobUnmet(job: AnyJob): string | null {
  const project = (job as { project?: Project }).project;
  if (!project?.config) return null;
  const requires: RequirementId[] =
    job.kind === "portrait" ? ["styleChosen"] : job.kind === "book" && job.quoteId ? ["hasStory", "styleChosen"] : [];
  const remedy = firstUnmet(project, requires, { guest: false });
  if (remedy) return remedy.what;
  if (job.kind === "portrait") {
    const ids = new Set((job.tasks ?? []).map((spec) => spec.id));
    const missing = namedCast(briefOf(project.config))
      .filter((member) => ids.has(member.id))
      .filter((member) => personNeedsStatedAge(member))
      .map((member) => member.name.trim());
    if (missing.length > 0) return `an age for ${missing.join(", ")}, so the pictures look right.`;
  }
  return null;
}

async function expandJob(ref: DocumentReference, uid: string, job: AnyJob): Promise<void> {
  const caller = await jobCallerStanding(uid);
  if (!caller.allowed) {
    await ref.update({
      status: "error",
      error: "Please sign in again to generate.",
      updatedAt: Date.now(),
    });
    return;
  }

  const specs = job.tasks ?? [];
  if (specs.length === 0) {
    await ref.update({
      status: "done",
      progress: { total: 0, completed: 0, failed: 0 },
      expanded: true,
      updatedAt: Date.now(),
    });
    return;
  }

  // A saved custom style supplies its own wording and drawing. Resolved before
  // anything is quoted or persisted, so workers render the record's look and
  // the price is planned from the references that will really be sent.
  await applyCustomStyleToProject(uid, (job as { project?: Project }).project);

  const unmet = chatJobUnmet(job);
  if (unmet) {
    await ref.update({ status: "error", error: `This needs ${unmet}`, updatedAt: Date.now() });
    return;
  }

  let tier: ImageTier | undefined;
  let quotedByAction: Record<string, number> | undefined;
  const taskQuoteKeys = new Map<string, string>();
  if (job.kind !== "screenplay") {
    // All customer jobs render at production quality. Guests are constrained by
    // their Spark balance and receive no negative buffer, not degraded artwork.
    tier = requireTier(job.tier, caller.guest);
    // Pre-check image work before dispatch. Text screenplay generation keeps
    // the existing settle-after-use behavior of the synchronous endpoint.
    //
    // Quote each task against the action AND cost window it will SETTLE from. A
    // batch is not uniform: the covers inside a page batch settle as
    // `coverIllustration` on a larger, dearer canvas, and an edit spends one
    // image call per subject — so pricing the whole batch as a fresh page
    // under-reserved every book with a cover or an edit in it, and recorded a
    // quote the charge was guaranteed to beat.
    //
    // The number of reference images moves the price too, so each task is
    // planned from the job's own book and priced in its reference group.
    const planned = await plannedTaskReferences(uid, job, specs, tier);
    let quotes: Record<string, number> = {};
    if (job.quoteId) {
      // The reader confirmed a stored estimate: its numbers are the cap, and each
      // unit may be consumed by one job only.
      const quote = await consumeQuote(
        uid,
        job.quoteId,
        ref.id,
        job.projectId,
        specs.map((spec) => spec.id),
      );
      quotes = { ...quote.byKey };
      for (const spec of specs) {
        const unit = quote.units.find((u) => u.id === spec.id);
        const key = quote.unitKeys[spec.id];
        if (key) taskQuoteKeys.set(spec.id, key);
        const plan = planned.get(spec.id);
        if (unit?.refs !== undefined && plan !== undefined && plan > unit.refs) {
          // Charged as quoted either way; a gap here means the button and the
          // server planned the same book differently.
          console.warn("[jobs] quoted fewer references than planned", { jobId: ref.id, task: spec.id, quoted: unit.refs, planned: plan });
        }
      }
    } else if (job.kind === "portrait") {
      throw new Error("Portraits start from a confirmed estimate.");
    }
    for (const spec of specs) {
      if (taskQuoteKeys.has(spec.id)) continue;
      const action = taskAction(taskKindOf(job, spec), spec.id);
      const kind = taskQuoteKind(spec);
      const refs = planned.get(spec.id);
      const key = quoteKey(action, kind, refs === undefined ? undefined : await referenceGroupFor(action, tier, refs));
      taskQuoteKeys.set(spec.id, key);
      if (key in quotes) continue;
      quotes[key] = await estimateForUser(uid, action, tier, kind, refs);
    }
    quotedByAction = quotes;
    const total = specs.reduce((sum, spec) => sum + (quotes[taskQuoteKeys.get(spec.id)!] ?? 0), 0);
    await ensureAfford(uid, total, { noNegativeBuffer: caller.guest });
  }

  await applyFeatureGate(uid, job);
  const frozen = tier ? { generationTuning: await getGenerationTuningConfig() } : undefined;

  const dependsMap = buildDependsOn(job);
  const col = tasksCol(uid, ref.id);
  const now = Date.now();
  const batch = db().batch();
  for (const spec of specs) {
    const docData: TaskDoc = {
      id: spec.id,
      jobId: ref.id,
      uid,
      ...(job.projectId ? { projectId: job.projectId } : {}),
      kind: taskKindOf(job, spec),
      status: "pending",
      dependsOn: dependsMap.get(spec.id) ?? [],
      ...taskPayload(taskKindOf(job, spec), spec),
      ...(taskQuoteKeys.has(spec.id) ? { quoteKey: taskQuoteKeys.get(spec.id) } : {}),
      reconciliationVersion: 1,
      updatedAt: now,
    };
    // Batch commits are atomic, so on any (rare) re-expansion no task doc can
    // pre-exist — a plain set can never clobber a task that already progressed.
    batch.set(col.doc(spec.id), docData);
  }
  batch.update(ref, {
    status: "running",
    expanded: true,
    updatedAt: now,
    deadlineAt:
      now + Math.min(JOB_DEADLINE_MAX_MS, JOB_DEADLINE_BASE_MS + JOB_DEADLINE_PER_TASK_MS * specs.length),
    progress: { total: specs.length, completed: 0, failed: 0 },
    // Persist image billing/model choices only for image-bearing jobs.
    ...(tier ? { tier } : {}),
    ...(quotedByAction ? { quotedByAction } : {}),
    ...(frozen ? { frozen } : {}),
    // Persist the feature-gated snapshot so workers render against it.
    ...(job.kind !== "image"
      ? { project: (job as PipelineRefreshJob | AnchorsJob | ScreenplayJob | PortraitJob | BookJob).project }
      : {}),
  });
  await batch.commit();

  // Dispatch roots (no dependencies). Dependents are enqueued as their deps
  // complete — or by the reaper if a completion's dispatch is lost.
  const roots = specs.filter((s) => (dependsMap.get(s.id) ?? []).length === 0).map((s) => s.id);
  await enqueueTasks(uid, ref.id, roots, job.kind);
}

// ---------------------------------------------------------------------------
// Worker helpers
// ---------------------------------------------------------------------------

/**
 * Atomically take ownership of a task: succeeds only when it isn't terminal and
 * isn't currently held by a live worker. Returns the claimed task, or null when
 * it's done/held/gone (caller no-ops — this is how at-least-once delivery and
 * duplicate dispatches are deduplicated).
 */
type ClaimedTask = TaskDoc & { claimToken: string };

async function claimTask(
  taskRef: DocumentReference,
  owner: string,
  claimToken: string,
): Promise<ClaimedTask | null> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return null;
    const task = snap.data() as TaskDoc;
    if (isTerminal(task.status)) return null;
    const now = Date.now();
    const held = typeof task.claimedUntil === "number" && task.claimedUntil > now;
    // Cloud Tasks keeps the same task name across retries. Letting the same
    // `owner` through here therefore allows an overlapping retry to render the
    // same task concurrently and overwrite its result with a second blob.
    // Retryable failures explicitly release the lease below; hard-dead workers
    // are recovered after expiry by the reaper.
    if (held) return null;
    const claimedUntil = now + TASK_LEASE_MS;
    // Attempts and the wave's clock live on the task: the queue's retry count
    // restarts whenever the reaper enqueues again, so it cannot bound anything.
    const attempts = (task.attempts ?? 0) + 1;
    const firstClaimedAt = task.firstClaimedAt ?? now;
    tx.update(taskRef, {
      status: "running",
      claimedBy: owner,
      claimToken,
      claimedUntil,
      attempts,
      firstClaimedAt,
      heartbeatAt: now,
      updatedAt: now,
    });
    return {
      ...task,
      status: "running",
      claimedBy: owner,
      claimToken,
      claimedUntil,
      attempts,
      firstClaimedAt,
      heartbeatAt: now,
    };
  });
}

/**
 * Keep a claimed task's lease alive while its worker is rendering. A task that
 * is no longer ours (the lease lapsed and someone else took it, or it was
 * closed) trips `onLost`, which aborts the render. A heartbeat that merely
 * fails to write is retried on the next beat: the lease is three beats long.
 */
function startHeartbeat(
  taskRef: DocumentReference,
  claimToken: string,
  onLost: () => void,
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    db()
      .runTransaction(async (tx) => {
        const snap = await tx.get(taskRef);
        const task = snap.data() as TaskDoc | undefined;
        if (!task || isTerminal(task.status) || task.claimToken !== claimToken) return false;
        const now = Date.now();
        tx.update(taskRef, { claimedUntil: now + TASK_LEASE_MS, heartbeatAt: now });
        return true;
      })
      .then((alive) => {
        if (!alive && !stopped) {
          logger.warn("[fan] lost the task lease; stopping its render", { task: taskRef.path });
          onLost();
        }
      })
      .catch((err) => {
        logger.warn("[fan] heartbeat failed; will retry", { task: taskRef.path, err: String(err) });
      });
  }, TASK_HEARTBEAT_MS);
  // Never keep an otherwise-finished instance alive for the sake of a beat.
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Hand a task back to the queue without failing it — used when the render hit a
 * throttle or a transient upstream fault and Cloud Tasks still has attempts
 * left. Clearing the lease matters: the retry must be able to claim it again.
 */
async function releaseTask(
  taskRef: DocumentReference,
  claimToken: string,
  cause?: unknown,
): Promise<boolean> {
  // What it died of is kept, so a task that runs out of attempts can say so in
  // the provider's terms ("busy", "too slow") instead of a generic failure.
  const lastErrorKind = cause instanceof ProviderError ? cause.kind : undefined;
  const lastError = cause === undefined ? undefined : String((cause as Error)?.message ?? cause).slice(0, 500);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return false;
    const task = snap.data() as TaskDoc;
    if (isTerminal(task.status) || task.claimToken !== claimToken) return false;
    tx.update(taskRef, {
      status: "pending",
      claimedBy: null,
      claimToken: null,
      claimedUntil: 0,
      ...(lastError ? { lastError } : {}),
      ...(lastErrorKind ? { lastErrorKind } : {}),
      updatedAt: Date.now(),
    });
    return true;
  });
}

/** Read a task's dependency docs (missing ones simply drop out). */
async function readDeps(uid: string, jobId: string, depIds: string[]): Promise<TaskDoc[]> {
  if (depIds.length === 0) return [];
  const col = tasksCol(uid, jobId);
  const snaps = await db().getAll(...depIds.map((id) => col.doc(id)));
  return snaps.filter((s) => s.exists).map((s) => s.data() as TaskDoc);
}

/**
 * An edit that could not stay in place, or a saved picture that is gone: the
 * same render would end the same way, so a free recovery pass only makes the
 * reader wait minutes longer for the same answer.
 */
function failsTheSameAgain(cause: unknown): boolean {
  return cause instanceof InPlaceEditError || cause instanceof BlobMissingError;
}

async function markTaskError(
  taskRef: DocumentReference,
  claimToken: string,
  message: string,
  cause?: unknown,
): Promise<boolean> {
  // Record the provider failure class alongside the message so the studio can
  // describe it properly instead of relaying a raw provider string.
  const kind = cause instanceof ProviderError ? cause.kind : undefined;
  const final = failsTheSameAgain(cause);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return false;
    const task = snap.data() as TaskDoc;
    if (isTerminal(task.status) || task.claimToken !== claimToken) return false;
    logger.warn("[fan] task failed", {
      jobId: task.jobId,
      taskId: task.id,
      error: message,
      ...(cause !== undefined ? { cause: errorText(cause) } : {}),
      ...(kind ? { errorKind: kind } : {}),
      final,
    });
    tx.update(taskRef, {
      status: "error",
      error: message,
      ...(kind ? { errorKind: kind } : {}),
      ...(final ? { errorFinal: true } : {}),
      claimedBy: null,
      claimToken: null,
      claimedUntil: 0,
      updatedAt: Date.now(),
    });
    return true;
  });
}

/** Commit a render only while this invocation still owns the task lease. */
async function completeTask(
  taskRef: DocumentReference,
  claimToken: string,
  result: TaskResult,
  stats: TaskStats,
): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return false;
    const task = snap.data() as TaskDoc;
    if (isTerminal(task.status) || task.claimToken !== claimToken) return false;
    tx.update(taskRef, {
      status: "done",
      result,
      stats,
      claimedBy: null,
      claimToken: null,
      claimedUntil: 0,
      updatedAt: Date.now(),
    });
    return true;
  });
}

/**
 * Advance the parent job's aggregate progress by one outcome and finalize it if
 * that was the last task. Done in a transaction so concurrent completions can't
 * lose an increment or finalize twice.
 */
async function finalizeIfComplete(
  ref: DocumentReference,
  outcome: "success" | "fail",
): Promise<void> {
  const next = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const job = snap.data() as AnyJob;
    if (isTerminal(job.status)) return null;
    const prog = job.progress ?? { total: 0, completed: 0, failed: 0 };
    const completed = prog.completed + (outcome === "success" ? 1 : 0);
    const failed = prog.failed + (outcome === "fail" ? 1 : 0);
    const patch: {
      progress: JobProgress;
      updatedAt: number;
      status?: JobStatus;
      secondPass?: boolean;
      recoveryPasses?: number;
      recovering?: boolean;
    } = {
      progress: { total: prog.total, completed, failed },
      updatedAt: Date.now(),
    };
    let step: "retry" | "finished" | null = null;
    if (completed + failed >= prog.total) {
      if (failed > 0 && recoveryApplies(job)) {
        patch.secondPass = true;
        patch.recovering = true;
        patch.recoveryPasses = recoveryPassesUsed(job) + 1;
        step = "retry";
      } else if (!job.recovering) {
        patch.status = failed > 0 && completed === 0 ? "error" : "done";
        step = "finished";
      }
    }
    tx.update(ref, patch);
    return step ? { step, kind: job.kind } : null;
  });
  const uid = ref.parent.parent?.id;
  if (!next || !uid) return;
  if (next.step === "retry") await retryFailedTasks(ref, uid, next.kind);
  else await afterJobFinished(ref, uid);
}

/**
 * Tell the reader a book they walked away from is done. Claimed on the job doc
 * first, so the two finalize paths can't both send; the template's dedupe key
 * is the second lock.
 */
async function afterJobFinished(ref: DocumentReference, uid: string): Promise<void> {
  try {
    const claimed = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const job = snap.data() as AnyJob | undefined;
      if (!job || job.kind !== "book" || !job.notify || job.notifiedAt) return null;
      if (!isTerminal(job.status)) return null;
      tx.update(ref, { notifiedAt: Date.now() });
      return job;
    });
    if (!claimed) return;
    const tasks = (await tasksCol(uid, ref.id).get()).docs.map((d) => d.data() as TaskDoc);
    await sendBookDrawnEmail({
      uid,
      jobId: ref.id,
      projectId: claimed.projectId ?? claimed.project.id,
      bookTitle: claimed.project.title ?? "",
      drawn: tasks.filter((t) => t.status === "done").length,
      missing: tasks.filter((t) => t.status === "error").length,
    });
  } catch (err) {
    logger.warn("[fan] book-drawn email failed", { jobId: ref.id, err: String(err) });
  }
}

/**
 * Free recovery waves after the first attempt. A book the reader already
 * confirmed gets two, so a bad minute at the provider is not their problem.
 * Every other image job keeps the original single wave. Failed renders are
 * never charged, so these waves cost the reader nothing. Screenplay has its
 * own retry.
 */
const BOOK_RECOVERY_PASSES = 2;
const IMAGE_RECOVERY_PASSES = 1;

function recoveryPassesUsed(job: AnyJob): number {
  if (typeof job.recoveryPasses === "number" && job.recoveryPasses >= 0) return job.recoveryPasses;
  return job.secondPass ? 1 : 0;
}

function recoveryLimit(job: AnyJob): number {
  if (job.kind === "screenplay") return 0;
  return job.kind === "book" ? BOOK_RECOVERY_PASSES : IMAGE_RECOVERY_PASSES;
}

function recoveryApplies(job: AnyJob): boolean {
  return !job.recovering && recoveryPassesUsed(job) < recoveryLimit(job);
}

/**
 * Put every failed task (and the ones skipped behind it) back in the queue.
 * If this dies halfway, the reaper finds the job with nothing left to run and
 * finalizes it as it stands.
 */
async function retryFailedTasks(ref: DocumentReference, uid: string, kind: JobKind): Promise<void> {
  const all = (await tasksCol(uid, ref.id).get()).docs.map((d) => d.data() as TaskDoc);
  const failed = all.filter((t) => t.status === "error");
  const worthRetrying = failed.filter((t) => !t.errorFinal);
  if (worthRetrying.length === 0) {
    // Nothing to retry, so close the job properly. Clearing only the email
    // here left `recovering` set and the job open forever.
    await forceFinalize(ref, uid);
    return;
  }
  const statusById = new Map(all.map((t) => [t.id, t.status]));
  const retrying = new Set(worthRetrying.map((t) => t.id));
  // A task whose dependency is gone, and is not itself being retried, can
  // never become ready. Leave it failed so the wave doesn't sit pending.
  const canRetry = worthRetrying.filter((t) =>
    t.dependsOn.every((id) => statusById.get(id) === "done" || retrying.has(id)),
  );
  if (canRetry.length === 0) {
    await forceFinalize(ref, uid);
    return;
  }
  const now = Date.now();
  const batch = db().batch();
  for (const t of canRetry) {
    batch.update(tasksCol(uid, ref.id).doc(t.id), {
      status: "pending",
      error: null,
      errorKind: null,
      lastError: null,
      lastErrorKind: null,
      errorFinal: null,
      claimedBy: null,
      claimToken: null,
      claimedUntil: 0,
      // A recovery wave is a fresh start: its own attempts and its own clock.
      attempts: 0,
      firstClaimedAt: null,
      updatedAt: now,
    });
  }
  const completed = all.filter((t) => t.status === "done").length;
  batch.update(ref, {
    progress: { total: all.length, completed, failed: failed.length - canRetry.length },
    recovering: false,
    updatedAt: now,
  });
  await batch.commit();
  logger.info("[fan] recovery pass for failed tasks", { jobId: ref.id, count: canRetry.length });

  const ready = canRetry
    .filter((t) => t.dependsOn.every((id) => !retrying.has(id) && statusById.get(id) === "done"))
    .map((t) => t.id);
  await enqueueTasks(uid, ref.id, ready, kind);
}

/**
 * A failed task blocks everything drawn from it. Mark those dependents skipped
 * right away (deepest first, so the job's last count lands after every skip)
 * instead of leaving the job to wait for the reaper.
 */
async function skipDependents(
  ref: DocumentReference,
  uid: string,
  failedId: string,
): Promise<void> {
  const q = await tasksCol(uid, ref.id).where("dependsOn", "array-contains", failedId).get();
  for (const d of q.docs) {
    const skipped = await db().runTransaction(async (tx) => {
      const snap = await tx.get(d.ref);
      const t = snap.data() as TaskDoc | undefined;
      if (!t || t.status !== "pending") return false;
      tx.update(d.ref, {
        status: "error",
        error: "Skipped: a dependency failed to generate.",
        updatedAt: Date.now(),
      });
      return true;
    });
    if (!skipped) continue;
    await skipDependents(ref, uid, d.id);
    await finalizeIfComplete(ref, "fail");
  }
}

/**
 * After a task finishes, dispatch every dependent whose dependencies are now
 * ALL done. `array-contains` finds the dependents; the per-task claim dedupes if
 * two of a task's deps finish at once and both try to enqueue it.
 */
async function enqueueReadyDependents(
  uid: string,
  jobId: string,
  doneTaskId: string,
  kind: JobKind,
): Promise<void> {
  const q = await tasksCol(uid, jobId).where("dependsOn", "array-contains", doneTaskId).get();
  const candidates = q.docs
    .map((d) => d.data() as TaskDoc)
    .filter((t) => t.status === "pending");
  const ready: string[] = [];
  for (const c of candidates) {
    const deps = await readDeps(uid, jobId, c.dependsOn);
    const allDone = c.dependsOn.every((id) => deps.find((d) => d.id === id)?.status === "done");
    if (allDone) ready.push(c.id);
  }
  await enqueueTasks(uid, jobId, ready, kind);
}


/**
 * For a change to a drawn portrait ("make her hair yellow"): find the part it
 * is about and mask just that, so the rest of the picture stays as it is.
 *
 * `region` is null only when the whole picture is meant to change (the model
 * can't take a mask, or the change is about most of the picture). A part that
 * can't be located is never quietly turned into a whole-picture redraw: the
 * task is retried, and a part the portrait doesn't show fails with a clear
 * message and draws nothing.
 */
async function portraitEditMask(args: {
  uid: string;
  name: string;
  instruction: string;
  blobId: string;
  canMask: boolean;
  finalAttempt: boolean;
  models: ResolvedModels;
  prompts: Awaited<ReturnType<typeof loadPromptContext>>;
  signal: AbortSignal;
  jobId: string;
  taskId: string;
}): Promise<{
  region: { maskBlobId: string; part: string } | null;
  /** The vision call's usage, for the caller to meter with the render it serves. */
  events: UsageEvent[];
  stats: CallStats;
}> {
  const { uid, name, instruction, blobId, models, prompts, signal } = args;
  const logContext = { jobId: args.jobId, taskId: args.taskId, instruction };
  if (!args.canMask) {
    logger.info("[portrait-edit] whole-picture edit", { ...logContext, reason: "cannot_mask" });
    return { region: null, events: [], stats: { calls: 0, failures: 0 } };
  }
  const model = models.bindingModel ?? models.textModel;
  const original = await downloadBlob(uid, blobId);
  const small = await downscaleReference(original, 1024, 85);
  // This is a paid vision call; it used to run outside any usage scope, so its
  // cost never reached the portrait's run or the book's P&L.
  const located = await withUsage(() =>
    withStep("locate", () =>
      locateEditPartOutcome({
        pageBase64: bufToBase64(small?.buf ?? original),
        pageMime: small?.mimeType ?? "image/png",
        name,
        instruction,
        creds: { apiKey: apiKeyFor(model.provider) },
        model: model.id,
        providerId: model.provider,
        prompts,
        signal,
      }),
    ),
  );
  const { events, stats } = located;
  const plan = planPartEdit(located.value, { finalAttempt: args.finalAttempt });
  switch (plan.path) {
    case "notVisible":
      logger.info("[portrait-edit] part not in the portrait", logContext);
      throw new Error(PORTRAIT_EDIT_NOT_VISIBLE);
    case "retry":
      logger.warn("[portrait-edit] could not locate the part; retrying", { ...logContext, detail: plan.detail });
      throw new ProviderError("Couldn't tell which part of the portrait to change.", {
        kind: "transient",
        retryable: true,
      });
    case "whole":
      logger.info("[portrait-edit] whole-picture edit", {
        ...logContext,
        reason: plan.reason,
        ...(plan.detail ? { detail: plan.detail } : {}),
      });
      return { region: null, events, stats };
    case "masked": {
      const mask = await buildHoleMask({ page: original, box: plan.box, paddingFrac: 0.1 });
      const maskBlobId = await uploadBlob(uid, mask, "image/png", { variants: false });
      logger.info("[portrait-edit] masked edit", { ...logContext, part: plan.part, box: plan.box });
      return { region: { maskBlobId, part: plan.part || "part" }, events, stats };
    }
  }
}

/**
 * An inpainting mask over the spot the reader marked on a picture, so an edit can
 * change only there. Null — and the edit goes through the normal path — when no
 * spot was marked, it is too small or covers most of the picture, the model can't
 * take a mask, or the picture that is there can't be read. The spot comes from
 * the browser, so it is clamped and checked here rather than trusted.
 */
async function markedRegionMask(args: {
  uid: string;
  project: Project;
  spreadId: string;
  region: { x: number; y: number; w: number; h: number } | undefined;
  canMask: boolean;
}): Promise<{ base64: string; mimeType: string } | null> {
  const { region } = args;
  if (!region || !args.canMask) return null;
  const nums = [region.x, region.y, region.w, region.h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const x = Math.min(1, Math.max(0, region.x));
  const y = Math.min(1, Math.max(0, region.y));
  const width = Math.min(1 - x, Math.max(0, region.w));
  const height = Math.min(1 - y, Math.max(0, region.h));
  if (width < 0.03 || height < 0.03 || width * height > 0.6) return null;
  const tree = args.project.illustrations?.[args.spreadId];
  const blobId = tree?.cursorId ? tree.nodes[tree.cursorId]?.content.blobId : undefined;
  if (!blobId) return null;
  try {
    const original = await downloadBlob(args.uid, blobId);
    const mask = await buildHoleMask({ page: original, box: { x, y, width, height }, paddingFrac: 0.05 });
    return { base64: bufToBase64(mask), mimeType: "image/png" };
  } catch {
    return null;
  }
}

type ImageQualityControl = (input: {
  result: ImageResult;
  request: ImageRequest;
  references: readonly ReferenceImage[];
  render: (prompt: string, signal: AbortSignal) => Promise<ImageResult>;
}) => Promise<ImageResult>;

function portraitQualityControl(args: {
  checkModel: ResolvedModels["textModel"];
  prompts: PromptContext;
  targetPrompt: string;
  sharesStyleReference: boolean;
  budgetMs: number;
  signal: AbortSignal;
  jobId: string;
  taskId: string;
}): ImageQualityControl {
  return async ({ result, request, references, render }) => {
    const deadlineAt = Date.now() + args.budgetMs;
    const identityReference = references.find((reference) => reference.role !== "style");
    const styleReference =
      references.find((reference) => reference.role === "style") ??
      (args.sharesStyleReference ? identityReference : undefined);
    const original = Buffer.from(result.base64, "base64");
    const small = await downscaleReference(original, 1024, 82);
    const assessment = await withStep("portraitCheck", () =>
      assessPortraitQuality({
        portrait: {
          base64: bufToBase64(small?.buf ?? original),
          mimeType: small?.mimeType ?? result.mimeType,
        },
        targetPrompt: args.targetPrompt,
        identityReference,
        styleReference,
        creds: { apiKey: apiKeyFor(args.checkModel.provider) },
        model: args.checkModel.id,
        providerId: args.checkModel.provider,
        prompts: args.prompts,
        signal: signalUntil(args.signal, deadlineAt),
      }),
    );
    if (!assessment || portraitQualityPassed(assessment)) return result;

    const corrections = portraitQualityCorrections(assessment);
    logger.info("[fan] portrait quality check requested one corrective redraw", {
      jobId: args.jobId,
      taskId: args.taskId,
      corrections,
    });
    const repairPrompt = [
      request.prompt,
      "QUALITY CHECK — redraw the portrait once and correct every item below:",
      ...corrections.map((correction) => `- ${correction}`),
      "Keep every requirement and reference-image role from the original request. Return one finished portrait only.",
    ].join("\n");
    return withStep("portraitRepair", () =>
      render(repairPrompt, signalUntil(args.signal, deadlineAt)),
    );
  };
}

/**
 * Run one image-render task and return the stored result. The model/provider
 * are resolved server-side (the client-supplied values on the request are
 * ignored) so generation can't be escalated to a costlier model.
 */
async function runImageTask(args: {
  uid: string;
  req: ImageRenderRequest;
  model: ResolvedModels["imageModel"];
  /** Admin capability overlay, so the canvas is checked against this model. */
  caps: CapabilityOverrides;
  generationTuning: GenerationTuningConfig;
  tier: ImageTier;
  action: ImageActionId;
  projectId: string | undefined;
  signal: AbortSignal;
  jobId: string;
  taskId: string;
  startedAt: number;
  quotedSparks?: number;
  /** References that are not blobs (a private likeness photo). Sent first. */
  inlineReferences?: ReferenceImage[];
  /** Provider calls made on this render's behalf before it (e.g. locating the part to edit). */
  priorUsage?: { events: UsageEvent[]; stats: CallStats };
  /** Optional vision model used by post-render quality control. */
  qualityModel?: ResolvedModels["textModel"];
  /**
   * Optional post-render inspection that runs inside this action's usage scope.
   * It may return one corrected render; quality-control calls are step-labeled
   * by the caller so they are metered but never added to this reader's charge.
   */
  qualityControl?: ImageQualityControl;
}): Promise<{
  blobId: string;
  mimeType: string;
  stats: CallStats;
  generation: ReturnType<typeof resolveImageGenerationOptions>;
}> {
  const {
    uid,
    req,
    model,
    tier,
    action,
    projectId,
    signal,
    jobId,
    taskId,
    startedAt,
    generationTuning,
  } =
    args;
  const actionTuning = generationTuningFor(generationTuning, action);
  const capabilities = capabilitiesFor(model, args.caps);
  const configuredReferenceLimit = Math.min(
    capabilities.inputs.maxReferenceImages,
    actionTuning.references.maxImages,
  );
  const hasRequiredIdentityReference =
    action === "portrait" &&
    [
      ...(args.inlineReferences ?? []).map((reference) => reference.role),
      ...(req.references ?? []).map((reference) => reference.role),
    ].some((role) => role !== "style");
  const submittedReferenceLimit =
    req.maskBlobId || hasRequiredIdentityReference
      ? Math.min(capabilities.inputs.maxReferenceImages, Math.max(1, configuredReferenceLimit))
      : configuredReferenceLimit;
  const canShrink = !req.maskBlobId;
  const inline = (args.inlineReferences ?? []).slice(0, submittedReferenceLimit);
  const blobReferences: ReferenceImage[] = await Promise.all(
    (req.references ?? [])
      .slice(0, Math.max(0, submittedReferenceLimit - inline.length))
      .map(async (r): Promise<ReferenceImage> => {
      const buf = await downloadBlob(uid, r.blobId);
      const small = canShrink
        ? await downscaleReference(
            buf,
            actionTuning.references.maxDimension,
            actionTuning.references.encodingQuality,
          )
        : null;
      return {
        base64: bufToBase64(small?.buf ?? buf),
        mimeType: small?.mimeType ?? r.mimeType ?? "image/png",
        label: r.label,
        role: r.role,
      };
    }),
  );
  const references = [...inline, ...blobReferences];

  let mask: ReferenceImage | undefined;
  if (req.maskBlobId) {
    const buf = await downloadBlob(uid, req.maskBlobId);
    mask = { base64: bufToBase64(buf), mimeType: "image/png" };
  }

  const generation = resolveImageGenerationOptions(capabilities, {
    ...(req.generation ?? {}),
    ...(req.quality ? { quality: req.quality } : {}),
    ...generationIntentFor(actionTuning),
  });
  const imageReq: ImageRequest = {
    model: model.id,
    prompt: req.prompt,
    // The client assembles the request, so its canvas is untrusted input: keep
    // only the SHAPE it asked for and re-resolve the pixels against the model
    // resolved here. A task that named a size this model can't produce, or an
    // 8 MP one (image tokens scale with area), lands on the same canvas the
    // pipeline would have chosen itself.
    size: sanitizeImageSize(capabilities, req.size),
    quality: generation.applied.quality,
    output:
      generation.applied.background ||
      generation.applied.format ||
      generation.applied.outputCompression !== undefined
        ? {
            background: generation.applied.background,
            format: generation.applied.format,
            compression: generation.applied.outputCompression,
          }
        : undefined,
    references:
      capabilities.operations.referenceEditing && references.length
        ? references
        : undefined,
    mask: capabilities.operations.maskEditing ? mask : undefined,
    signal,
  };

  const {
    value: result,
    events: renderEvents,
    stats: renderStats,
  } = await withUsage(async () => {
    const provider = getImageProvider(model.provider);
    let rendered = await withRetry(
      () =>
        provider.generateImage(
          { apiKey: apiKeyFor(model.provider) },
          imageReq,
        ),
      { retries: actionTuning.retries, signal },
    );
    if (args.qualityControl) {
      try {
        rendered = await args.qualityControl({
          result: rendered,
          request: imageReq,
          references,
          render: (prompt, operationSignal) =>
            provider.generateImage(
              { apiKey: apiKeyFor(model.provider) },
              { ...imageReq, prompt, signal: operationSignal },
            ),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        logger.warn("[fan] optional image quality control failed; keeping primary render", {
          jobId,
          taskId,
          action,
          error: String(error),
        });
      }
    }
    return rendered;
  });
  const events = [...(args.priorUsage?.events ?? []), ...renderEvents];
  const stats: CallStats = { calls: 0, failures: 0 };
  addCallStats(stats, args.priorUsage?.stats);
  addCallStats(stats, renderStats);
  const isEdit = Boolean(req.composite || req.maskBlobId);
  const renderKind = isEdit ? "edit" : "fresh";
  const estimateProfile = estimateProfileForAction({
    action,
    tier,
    model,
    qualityModel: args.qualityModel,
    tuning: actionTuning,
    kind: renderKind,
  });
  await meterAndSettle({
    uid,
    action,
    tier,
    events,
    stats,
    projectId,
    kind: renderKind,
    jobId,
    targetId: taskId,
    source: "worker",
    quotedSparks: args.quotedSparks,
    settleKey: taskSettleKey(jobId, taskId),
    startedAt,
    models: { image: model, quality: args.qualityModel },
    generation,
    estimateProfile,
    inputReferenceCount: imageReq.references?.length ?? 0,
    outputSize: imageReq.size,
    latency: {
      profile: estimateProfile,
      refs: imageReq.references?.length ?? 0,
    },
  });

  let finalBuf: Buffer = Buffer.from(result.base64, "base64");
  let mimeType = result.mimeType;

  if (req.composite) {
    const [original, maskBuf] = await Promise.all([
      downloadBlob(uid, req.composite.originalBlobId),
      downloadBlob(uid, req.composite.maskBlobId),
    ]);
    finalBuf = await compositeMaskedRegion({ original, edited: finalBuf, mask: maskBuf });
    mimeType = "image/png";
  }

  const blobId = await uploadBlob(uid, finalBuf, mimeType);
  return { blobId, mimeType, stats, generation };
}

/** Fold a task's already-rendered anchor dependencies into a snapshot. */
async function hydrateAnchorDeps(
  uid: string,
  jobId: string,
  task: TaskDoc,
  project: AnchorsJob["project"],
): Promise<void> {
  if (!task.dependsOn?.length) return;
  const deps = await readDeps(uid, jobId, task.dependsOn);
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  for (const d of deps) {
    if (d.status !== "done" || !d.result) continue;
    const anchor = byId.get(d.id);
    if (anchor) anchor.versions = applyAnchorRender(anchor.versions, d.result as AnchorRender);
  }
}

/** Render one task through its kind's pipeline; meters, settles and records it. */
async function renderTask(
  uid: string,
  jobId: string,
  job: AnyJob,
  task: TaskDoc,
  tier: ImageTier,
  signal: AbortSignal,
  /** When this attempt will be cut off (epoch ms), so a render can plan inside it. */
  deadlineAt?: number,
): Promise<{ result: TaskResult; stats: TaskStats }> {
  if (job.kind === "book") {
    const kind = taskKindOf(job, task);
    const project = structuredClone(job.project);
    // Sheets drawn earlier in this job aren't in the snapshot yet.
    if (kind === "refresh") await hydrateAnchorDeps(uid, jobId, task, project);
    const view = { ...job, kind, project } as PipelineRefreshJob | AnchorsJob;
    return renderTask(uid, jobId, view as AnyJob, task, tier, signal, deadlineAt);
  }
  if (job.kind === "screenplay") {
    const [model, prompts] = await Promise.all([
      resolveTextAction("screenplay"),
      loadPromptContext(),
    ]);
    const project = job.project;
    const startedAt = Date.now();
    const config: BookConfig = { ...project.config, textModel: model };
    const { value: screenplay, events, stats } = await withUsage(() =>
      generateScreenplay({
        config,
        anchors: project.anchors ?? [],
        creds: { apiKey: apiKeyFor(model.provider) },
        model: model.id,
        prompts,
        signal,
      }),
      model.params,
    );
    await meterAndSettle({
      uid,
      action: "screenplay",
      events,
      stats,
      projectId: job.projectId ?? project.id,
      project,
      kind: "fresh",
      jobId,
      targetId: task.id,
      source: "worker",
      settleKey: taskSettleKey(jobId, task.id),
      startedAt,
      models: { text: model },
    });
    return {
      result: screenplay,
      stats: { ms: Date.now() - startedAt, ...stats },
    };
  }

  const imageAction = taskAction(job.kind, task.id);
  const [models, prompts, layouts, capabilities, generationTuning] = await Promise.all([
    resolveImageModels(imageAction, tier),
    loadPromptContext(),
    getLayoutsConfig(),
    loadModelCapabilities(),
    job.frozen?.generationTuning
      ? normalizeGenerationTuningConfig(job.frozen.generationTuning)
      : getGenerationTuningConfig(),
  ]);
  const startedAt = Date.now();

  if (job.kind === "portrait") {
    const project = job.project;
    const member = (briefOf(project.config).cast ?? []).find((m) => m.id === task.id);
    if (!member) throw new Error("This person is no longer in the book.");
    // A change to a drawn portrait sends that portrait and nothing else: a photo or a
    // style picture next to it would pull the model toward drawing someone new.
    const editing = task.edit?.instruction.trim() ? task.edit : undefined;
    const plan = editing
      ? { photos: 0, subject: [], existing: [], style: [], catalogStyle: [], hasStyle: false, sharesStyle: false }
      : portraitReferencePlan(project, member);
    let inlineReferences: ReferenceImage[] = [];
    if (plan.photos > 0) {
      const photos = await loadLikenessPhotosForSubject(uid, project.id, member.id, plan.photos);
      if (photos.length === 0) throw new Error("The photo has expired. Add it again, or describe them instead.");
      photos.forEach((photo, i) =>
        inlineReferences.push({
          base64: photo.base64,
          mimeType: photo.mimeType,
          label: photos.length > 1 ? `${member.name} (photo ${i + 1})` : `${member.name} (photo)`,
          role: "likeness",
        }),
      );
    }
    let subjectReferences = plan.subject;
    let existingReferences = plan.existing;
    let styleReferences = plan.style;
    let catalogStyleReferences: ReferenceImage[] = [];
    for (const reference of plan.catalogStyle) {
      const presetId = project.config.artStyle?.presetId;
      const expectedPrefix = presetId
        ? `public/artStyles/${encodeURIComponent(presetId)}/generation-`
        : "";
      if (!expectedPrefix || !reference.storagePath.startsWith(expectedPrefix)) {
        logger.warn("[fan] ignored invalid catalog style reference path", {
          jobId,
          taskId: task.id,
          storagePath: reference.storagePath,
        });
        continue;
      }
      try {
        const image = await downloadPublicBase64(reference.storagePath);
        catalogStyleReferences.push({
          ...image,
          label: "the book’s generation style reference",
          role: "style",
        });
      } catch (error) {
        logger.warn("[fan] optional catalog style reference unavailable; using text style", {
          jobId,
          taskId: task.id,
          storagePath: reference.storagePath,
          error: String(error),
        });
      }
    }
    const portraitCapabilities = capabilitiesFor(models.imageModel, capabilities);
    // The earlier portrait only keeps the look of someone whose age or style changed. A model that
    // can't take a picture to draw from draws them from the description instead of failing the task.
    if (!portraitCapabilities.operations.referenceEditing) existingReferences = [];
    const portraitTuning = generationTuningFor(generationTuning, "portrait");
    const configuredPortraitReferenceLimit = Math.min(
      portraitCapabilities.inputs.maxReferenceImages,
      portraitTuning.references.maxImages,
    );
    const identityCount =
      inlineReferences.length + subjectReferences.length + existingReferences.length + (editing ? 1 : 0);
    const portraitReferenceLimit =
      identityCount > 0
        ? Math.min(portraitCapabilities.inputs.maxReferenceImages, Math.max(1, configuredPortraitReferenceLimit))
        : configuredPortraitReferenceLimit;
    if (identityCount > 0 && !portraitCapabilities.operations.referenceEditing) {
      throw new Error("The selected portrait model cannot use the required identity reference.");
    }
    if (identityCount > 0 && portraitReferenceLimit < 1) {
      throw new Error("The selected portrait model cannot use the required identity reference.");
    }
    if (!portraitCapabilities.operations.referenceEditing) {
      styleReferences = [];
      catalogStyleReferences = [];
    }
    const plannedReferenceCount =
      inlineReferences.length +
      subjectReferences.length +
      existingReferences.length +
      styleReferences.length +
      catalogStyleReferences.length +
      (editing ? 1 : 0);
    if (plannedReferenceCount > portraitReferenceLimit && !editing) {
      const identity = [
        ...inlineReferences.map((reference) => ({ kind: "inline" as const, reference })),
        ...subjectReferences.map((reference) => ({ kind: "subject" as const, reference })),
        ...existingReferences.map((reference) => ({ kind: "existing" as const, reference })),
      ];
      const keep = new Set<SourceArtRef>();
      const keepInline = new Set<ReferenceImage>();
      const firstIdentity = identity[0];
      if (firstIdentity?.kind === "inline") keepInline.add(firstIdentity.reference);
      else if (firstIdentity) keep.add(firstIdentity.reference);
      const firstStyle = styleReferences[0];
      const firstCatalogStyle = catalogStyleReferences[0];
      const hasRoomForStyle =
        keep.size + keepInline.size < portraitReferenceLimit &&
        (firstStyle != null || firstCatalogStyle != null);
      if (hasRoomForStyle && firstStyle) keep.add(firstStyle);
      else if (hasRoomForStyle && firstCatalogStyle) keepInline.add(firstCatalogStyle);
      for (const candidate of identity) {
        if (keep.size + keepInline.size >= portraitReferenceLimit) break;
        if (candidate.kind === "inline") keepInline.add(candidate.reference);
        else keep.add(candidate.reference);
      }
      inlineReferences = inlineReferences.filter((reference) => keepInline.has(reference));
      subjectReferences = subjectReferences.filter((reference) => keep.has(reference));
      existingReferences = existingReferences.filter((reference) => keep.has(reference));
      styleReferences = styleReferences.filter((reference) => keep.has(reference));
      catalogStyleReferences = catalogStyleReferences.filter((reference) => keepInline.has(reference));
    }
    const hasStyleReference = plan.sharesStyle
      ? subjectReferences.length > 0
      : styleReferences.length > 0 || catalogStyleReferences.length > 0;
    const sharesStyleReference = plan.sharesStyle;
    const prompt = editing
      ? portraitEditPrompt(member, editing.instruction, resolvePromptsConfig(prompts))
      : portraitPrompt(
          project,
          member,
          resolvePromptsConfig(prompts),
          prompts.artStyles,
          { currentPortraitIdentity: existingReferences.length > 0 },
        );
    const editLocate = editing
      ? await portraitEditMask({
          uid,
          name: member.name,
          instruction: editing.instruction,
          blobId: editing.blobId,
          canMask: capabilitiesFor(models.imageModel, capabilities).operations.maskEditing,
          finalAttempt: (task.attempts ?? 1) >= TASK_MAX_ATTEMPTS,
          models,
          prompts,
          signal,
          jobId,
          taskId: task.id,
        })
      : null;
    const editRegion = editLocate?.region ?? null;
    const referenceGuide = (() => {
      if (editing) {
        return editRegion
          ? `Reference image 1 is the current portrait of this character. Edit that picture; do not redraw the person. Only the transparent area of the mask may change: it covers just the ${editRegion.part}. Repaint that part with the requested change, keep its shape, outline, texture and the art style, and leave everything else exactly as it is.`
          : "Reference image 1 is the current portrait of this character. Edit that picture; do not redraw the person.";
      }
      const ordered = [
        ...inlineReferences.map(() => "a likeness photo of the same person; preserve identity only, never photographic rendering"),
        ...catalogStyleReferences.map(() => "the book’s art-style reference; copy style only, never its subject or composition"),
        ...subjectReferences.map(() =>
          sharesStyleReference
            ? "this character’s exact design and the book’s rendering style"
            : "this character’s exact design; preserve identity, outfit and colors",
        ),
        ...existingReferences.map(() => "the approved current portrait; preserve identity and design only, not its old rendering style"),
        ...styleReferences.map(() => "the book’s art-style reference; copy style only, never its subject or composition"),
      ];
      return ordered.map((description, index) => `Reference image ${index + 1} is ${description}.`).join(" ");
    })();
    const req: ImageRenderRequest = {
      provider: models.imageModel.provider,
      model: models.imageModel.id,
      prompt: [
        prompt,
        hasStyleReference
          ? sharesStyleReference
            ? "The supplied character drawing also defines the book’s ART STYLE. Keep this character’s identity and design, and use its facial-feature simplification, rendering technique, linework, shading, palette, texture and finish for the portrait."
            : "Use the supplied ART-STYLE reference only for facial-feature simplification, eye and nose treatment, line quality, shading method, palette, brush or paper texture and level of detail. Never copy its character identity, face shape, age, hair, skin tone, clothing, pose, expression, body proportions, background, layout or composition. The new character's identity comes only from their likeness photo, character artwork or written description."
          : "",
        referenceGuide,
      ]
        .filter(Boolean)
        .join("\n\n"),
      size: PORTRAIT_SIZE,
      ...(editing && editRegion
        ? {
            maskBlobId: editRegion.maskBlobId,
            composite: { originalBlobId: editing.blobId, maskBlobId: editRegion.maskBlobId },
          }
        : {}),
      references: [
        ...(editing
          ? [
              {
                blobId: editing.blobId,
                mimeType: editing.mimeType,
                label: `${member.name} (current portrait)`,
                role: "subject" as const,
              },
            ]
          : []),
        ...subjectReferences.map((art) => ({
          blobId: art.blobId,
          mimeType: art.mimeType,
          label: `${member.name} (drawing)`,
          role: "sourceArt" as const,
        })),
        ...existingReferences.map((art) => ({
          blobId: art.blobId,
          mimeType: art.mimeType,
          label: `${member.name} (approved portrait; identity only)`,
          role: "sourceArt" as const,
        })),
        ...styleReferences.map((art) => ({
          blobId: art.blobId,
          mimeType: art.mimeType,
          label: "the reader’s book-wide style reference",
          role: "style" as const,
        })),
      ],
    };
    const portraitQualityEnabled =
      !editing &&
      portraitTuning.qualityControl.portraitCheck &&
      portraitTuning.qualityControl.budgetMs > 0 &&
      portraitTuning.qualityControl.maxImageCalls > 0;
    const portraitCheckModel = portraitQualityEnabled
      ? (models.bindingModel ?? models.textModel)
      : undefined;
    const { blobId, mimeType, stats, generation } = await runImageTask({
      uid,
      req,
      model: models.imageModel,
      caps: capabilities,
      generationTuning,
      tier,
      action: "portrait",
      projectId: job.projectId ?? project.id,
      signal,
      jobId,
      taskId: task.id,
      startedAt,
      quotedSparks: quotedFor(job, task, "portrait"),
      inlineReferences: [...inlineReferences, ...catalogStyleReferences],
      ...(portraitCheckModel
        ? {
            qualityModel: portraitCheckModel,
            qualityControl: portraitQualityControl({
              checkModel: portraitCheckModel,
              prompts,
              targetPrompt: prompt,
              sharesStyleReference,
              budgetMs: portraitTuning.qualityControl.budgetMs,
              signal,
              jobId,
              taskId: task.id,
            }),
          }
        : {}),
      ...(editLocate && editLocate.events.length > 0
        ? { priorUsage: { events: editLocate.events, stats: editLocate.stats } }
        : {}),
    });
    const render = buildRenderRecord({
      artStyle: project.config.artStyle,
      action: "portrait",
      outputSize: req.size,
      generation,
      prompt: req.prompt,
      inputReferences: [
        // A one-use photo is deleted after drawing: its role is kept, never an id.
        ...inlineReferences
          .filter((reference) => !catalogStyleReferences.includes(reference))
          .map((reference) => ({ role: reference.role ?? "likeness", label: reference.label })),
        ...catalogStyleReferences.map((reference, index) => ({
          role: "style",
          label: reference.label,
          ...(plan.catalogStyle[index] ? { storagePath: plan.catalogStyle[index]!.storagePath } : {}),
        })),
        ...(req.references ?? []).map((reference) => ({
          role: reference.role ?? "subject",
          label: reference.label,
          blobId: reference.blobId,
        })),
      ],
    });
    return {
      result: stampImageProvenance({ blobId, mimeType, render }, tier, models.imageModel),
      stats: { ms: Date.now() - startedAt, ...stats },
    };
  }

  if (job.kind === "image") {
    const projectId = job.projectId;
    const req = task.request;
    if (!req) throw new Error("Image task is missing its render request.");
    const action = illustrationActionFor(task.id);
    const { blobId, mimeType, stats, generation } = await runImageTask({
      uid,
      req,
      model: models.imageModel,
      caps: capabilities,
      generationTuning,
      tier,
      action,
      projectId,
      signal,
      jobId,
      taskId: task.id,
      startedAt,
      quotedSparks: quotedFor(job, task, action, taskQuoteKind(task)),
    });
    return {
      result: stampImageProvenance(
        { blobId, mimeType, generation },
        tier,
        models.imageModel,
      ),
      stats: { ms: Date.now() - startedAt, ...stats },
    };
  }

  const project = (job as PipelineRefreshJob | AnchorsJob).project;
  const projectId = job.projectId ?? project?.id;
  if (job.kind === "refresh") {
    const spread = spreadsById(project).get(task.id);
    if (!spread) throw new Error("Spread not found in the project snapshot.");
    const action = illustrationActionFor(task.id);
    const env = backendPipelineEnv(
      uid,
      models,
      prompts,
      capabilities,
      layouts,
      generationTuning,
      action,
    );
    const regionMask = await markedRegionMask({
      uid,
      project,
      spreadId: spread.id,
      region: task.options?.region,
      canMask: capabilitiesFor(models.imageModel, capabilities).operations.maskEditing,
    });
    const { region: _region, ...runOptions } = task.options ?? {};
    const { value: render, events, stats } = await withUsage(() =>
      renderIllustration(
        project,
        spread,
        {
          ...runOptions,
          ...(regionMask ? { mask: regionMask, useReference: true } : {}),
          signal,
          ...(deadlineAt !== undefined ? { deadlineAt } : {}),
        },
        env,
      ),
    );
    const renderKind = kindOf(task.options);
    const estimateProfile = estimateProfileForAction({
      action,
      tier,
      model: models.imageModel,
      tuning: generationTuningFor(generationTuning, action),
      kind: renderKind,
    });
    await meterAndSettle({
      uid,
      action,
      tier,
      events,
      stats,
      projectId,
      project,
      kind: renderKind,
      jobId,
      targetId: task.id,
      source: "worker",
      quotedSparks: quotedFor(job, task, action, renderKind),
      settleKey: taskSettleKey(jobId, task.id),
      startedAt,
      models: { image: models.imageModel, text: models.textModel },
      generation: render?.generation,
      estimateProfile,
      inputReferenceCount: render?.inputReferenceCount,
      outputSize: render?.outputSize,
      latency: {
        profile: estimateProfile,
        refs:
          render?.inputReferenceCount ??
          effectiveAnchorIds(project.anchors, spread).length,
      },
      ...(render ? {} : { outcome: "failed" as const, errorCode: "emptyRender" }),
    });
    if (!render) throw new Error("Nothing to render for this spread.");
    // The first covers drawn in a look become that look's previews. Whole-page
    // renders only: a touch-up leaves most pixels in whatever look they had.
    if (task.id === COVER_FRONT_ID && render.artStyleKey && projectId) {
      await captureStyleCover(uid, { style: project.config.artStyle, projectId, blobId: render.blobId });
    }
    return {
      result: stampImageProvenance(render, tier, models.imageModel),
      stats: { ms: Date.now() - startedAt, ...stats },
    };
  }

  // anchors
  const anchor = (project.anchors ?? []).find((a) => a.id === task.id);
  if (!anchor) throw new Error("Anchor not found in the project snapshot.");
  const env = backendPipelineEnv(
    uid,
    models,
    prompts,
    capabilities,
    layouts,
    generationTuning,
    "anchorImage",
  );
  await hydrateAnchorDeps(uid, task.jobId, task, project);
  const { value: render, events, stats } = await withUsage(() =>
    renderAnchor(project, anchor, { ...(task.options ?? {}), signal }, env),
  );
  const renderKind = kindOf(task.options);
  const estimateProfile = estimateProfileForAction({
    action: "anchorImage",
    tier,
    model: models.anchorImageModel,
    tuning: generationTuningFor(generationTuning, "anchorImage"),
    kind: renderKind,
  });
  await meterAndSettle({
    uid,
    action: "anchorImage",
    tier,
    events,
    stats,
    projectId,
    project,
    kind: renderKind,
    jobId,
    targetId: task.id,
    source: "worker",
    quotedSparks: quotedFor(job, task, "anchorImage", renderKind),
    settleKey: taskSettleKey(jobId, task.id),
    startedAt,
    models: { image: models.anchorImageModel, text: models.textModel },
    generation: render.generation,
    estimateProfile,
    inputReferenceCount: render.inputReferenceCount,
    outputSize: render.outputSize,
    latency: {
      profile: estimateProfile,
      refs:
        render.inputReferenceCount ??
        containedAnchorsFor(anchor, project.anchors ?? []).length,
    },
  });
  return {
    result: { ...stampImageProvenance(render, tier, models.anchorImageModel), versionId: randomUUID() },
    stats: { ms: Date.now() - startedAt, ...stats },
  };
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * ENQUEUER: on job creation, record dispatch latency, then expand the job into
 * its task graph and dispatch the roots. Renders nothing, so it needs little
 * memory/time; a failure here marks the job errored (the reaper also re-expands
 * un-expanded jobs, covering a hard death before this completes).
 */
export const onGenerationJob = onDocumentCreated(
  {
    document: "users/{uid}/jobs/{jobId}",
    secrets: ALL_SECRETS,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    ensureAdmin();
    const uid = event.params.uid as string;
    const job = snap.data() as AnyJob;
    if (job.status !== "pending") return;

    // Queue-dispatch latency (client enqueue → trigger), fed into the same
    // rolling window as task durations. Guarded against clock skew / stale data.
    const dispatchMs = Date.now() - job.createdAt;
    if (dispatchMs >= 0 && dispatchMs < 10 * 60_000) {
      await recordLatencySamples([{ key: DISPATCH_KEY, ms: dispatchMs }]).catch(() => {});
    }

    try {
      await expandJob(snap.ref, uid, job);
    } catch (err) {
      await snap.ref.update({
        status: "error",
        error: (err as Error)?.message ?? "Generation failed to start.",
        updatedAt: Date.now(),
      });
    }
  },
);

/**
 * Should this failure be handed back to Cloud Tasks instead of failing the task?
 *
 * Only faults that say nothing about the request itself: a throttle or a
 * transient upstream fault will very likely succeed on the identical call
 * later. Everything else — a bad prompt, a missing spread, a parse failure — is
 * a verdict, and repeating it just asks the same question again.
 *
 * This matters most under fan-out. A dozen parallel renders reliably trip the
 * image provider's per-minute limit, and the pipeline's own single retry fires
 * about a second later, well inside that same minute, so it fails too. Cloud
 * Tasks retries on a 5–60s backoff, which is the right timescale for a
 * per-minute quota — but it only ever saw 2xx, because the worker swallowed
 * every render error. That is why a big batch came back with pages that had
 * simply given up.
 */
function isRetryableRenderError(err: unknown): boolean {
  if (err instanceof ProviderError) {
    // A render that ran past the task budget (ours or the provider's) says
    // nothing about the request; a fresh attempt usually lands. An empty
    // image is the same kind of miss: the provider accepted the call and
    // returned no picture.
    const emptyImage = err.kind === "parse" && /no image returned/i.test(err.message);
    return err.retryable || err.kind === "timeout" || err.kind === "aborted" || emptyImage;
  }
  return isAbortError(err) || isTransientInfraError(err);
}

/**
 * A fault in OUR plumbing rather than in the request: Storage, Firestore or the
 * network blinked. The same call a moment later will very likely work, and
 * calling it a verdict would fail a finished picture over a dropped socket.
 */
function isTransientInfraError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; status?: unknown; message?: unknown; cause?: unknown };
  const code = typeof e.code === "string" ? e.code.toUpperCase() : e.code;
  // gRPC (Firestore): DEADLINE_EXCEEDED 4, RESOURCE_EXHAUSTED 8, ABORTED 10, INTERNAL 13, UNAVAILABLE 14.
  if (typeof code === "number" && [4, 8, 10, 13, 14].includes(code)) return true;
  // HTTP-coded errors (Cloud Storage): throttles and server faults.
  const http = typeof code === "number" ? code : typeof e.status === "number" ? e.status : undefined;
  if (http !== undefined && (http === 408 || http === 429 || (http >= 500 && http < 600))) return true;
  if (
    typeof code === "string" &&
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "EPIPE",
      "EAI_AGAIN",
      "ENOTFOUND",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
      "DEADLINE_EXCEEDED",
      "UNAVAILABLE",
      "ABORTED",
    ].includes(code)
  ) {
    return true;
  }
  const message = typeof e.message === "string" ? e.message : "";
  if (/fetch failed|socket hang up|network error|temporarily unavailable|stream (closed|reset)/i.test(message)) return true;
  return e.cause !== undefined && e.cause !== err ? isTransientInfraError(e.cause) : false;
}

/** What a dispatched task carries — enough to find the job and the task doc. */
type TaskPayload = { uid: string; jobId: string; taskId: string };

/**
 * WORKER BODY (shared by {@link runFanTask} and {@link runTextTask}): render
 * exactly one task. Claims it (dedupes duplicate/at-least-once dispatch),
 * verifies its dependencies, renders under a per-task timeout, writes the
 * result, advances aggregate progress, and dispatches now-ready dependents.
 */
async function handleTask(data: TaskPayload, owner: string, attempt: number): Promise<void> {
  ensureAdmin();
  const { uid, jobId, taskId } = data;
  if (!uid || !jobId || !taskId) return;

  const ref = jobRef(uid, jobId);
  const jobSnap = await ref.get();
  if (!jobSnap.exists) return;
  const job = jobSnap.data() as AnyJob;
  if (isTerminal(job.status)) return;

  const taskRef = tasksCol(uid, jobId).doc(taskId);
  const claimToken = randomUUID();
  const task = await claimTask(taskRef, owner, claimToken);
  if (!task) return; // terminal, held by another live worker, or gone

  // From here this worker owns a lease. Every way out of `runClaimedTask` must
  // leave the task released, finished or failed — never merely abandoned with
  // the lease still held, which is how one stray exception between the claim
  // and the render used to park a task (and its book) for the whole lease.
  const outcome = { settled: false };
  try {
    await runClaimedTask({ uid, jobId, taskId, ref, job, taskRef, claimToken, task, attempt, outcome });
  } catch (err) {
    if (outcome.settled) throw err;
    const attemptNo = task.attempts ?? attempt;
    if (attemptNo < TASK_MAX_ATTEMPTS) {
      await releaseTask(taskRef, claimToken, err).catch(() => false);
      logger.warn("[fan] unexpected failure after claiming — returning to the queue", {
        jobId,
        taskId,
        attempt: attemptNo,
        err: String(err),
      });
      throw err;
    }
    logger.error("[fan] unexpected failure after claiming — out of attempts", {
      jobId,
      taskId,
      err: String(err),
    });
    const marked = await markTaskError(
      taskRef,
      claimToken,
      (err as Error)?.message || "Generation failed.",
      err,
    ).catch(() => false);
    if (marked) {
      await skipDependents(ref, uid, taskId).catch(() => undefined);
      await finalizeIfComplete(ref, "fail").catch(() => undefined);
    }
  }
}

/** Run `fn`, trying again after a short wait when it throws (best for one flaky write). */
async function withWriteRetries<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < tries - 1) await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  throw last;
}

function jobProjectId(job: AnyJob): string | undefined {
  return (
    (job as { projectId?: string }).projectId ?? (job as { project?: { id?: string } }).project?.id
  );
}

/** Banked cost of an earlier job's failed attempts at this unit, waiting for a delivery. */
function wasteCarryRef(uid: string, projectId: string, taskId: string): DocumentReference {
  return db().doc(`users/${uid}/wasteCarry/${projectId}__${taskId}`);
}

async function readWasteCarry(
  uid: string,
  projectId: string | undefined,
  taskId: string,
): Promise<{ usd: number; imageCalls: number }> {
  if (!projectId) return { usd: 0, imageCalls: 0 };
  try {
    const data = (await wasteCarryRef(uid, projectId, taskId).get()).data() as
      | { usd?: number; imageCalls?: number }
      | undefined;
    return { usd: data?.usd ?? 0, imageCalls: data?.imageCalls ?? 0 };
  } catch {
    return { usd: 0, imageCalls: 0 };
  }
}

/**
 * Book what one attempt that delivered nothing cost.
 *
 * The attempt's provider calls become an `actionRuns` doc with outcome `failed`
 * (so they reach the usage line items, the finance stream and the admin cost
 * views, and charge the reader nothing), and their cost is added to the task so
 * the delivered render — this wave's or a later one's — carries it into the
 * price window instead of leaving the price blind to what retries cost.
 */
async function recordFailedAttempt(args: {
  uid: string;
  jobId: string;
  job: AnyJob;
  task: TaskDoc;
  taskRef: DocumentReference;
  tier: ImageTier;
  ledger: SpendLedger;
  startedAt: number;
  err?: unknown;
  /** The task delivered anyway: book the spend, but don't carry it onto the task. */
  delivered?: boolean;
}): Promise<void> {
  const { ledger, task } = args;
  if (ledger.events.length === 0 && ledger.stats.calls === 0) return;
  try {
    const kind = taskKindOf(args.job, task);
    const action = kind === "screenplay" ? "screenplay" : taskAction(kind, task.id);
    const metered = await meterAndSettle({
      uid: args.uid,
      action,
      ...(kind === "screenplay" ? {} : { tier: args.tier }),
      events: ledger.events,
      stats: ledger.stats,
      projectId: jobProjectId(args.job),
      kind: kindOf(task.options),
      targetId: task.id,
      jobId: args.jobId,
      source: "worker",
      startedAt: args.startedAt,
      outcome: "failed",
      errorCode:
        args.err instanceof ProviderError ? args.err.kind : isAbortError(args.err) ? "aborted" : "error",
      ...(args.err ? { errorMessage: errorText(args.err) } : {}),
    });
    const imageCalls = ledger.events.filter((e) => e.modality === "image").length;
    if (!args.delivered && (metered.costUsd > 0 || imageCalls > 0)) {
      await args.taskRef.update({
        wasteUsd: FieldValue.increment(metered.costUsd),
        wasteImageCalls: FieldValue.increment(imageCalls),
      });
    }
  } catch (err) {
    logger.warn("[fan] could not book a failed attempt's cost", { jobId: args.jobId, taskId: task.id, err: String(err) });
  }
}

interface ClaimedRun {
  uid: string;
  jobId: string;
  taskId: string;
  ref: DocumentReference;
  job: AnyJob;
  taskRef: DocumentReference;
  claimToken: string;
  task: ClaimedTask;
  /** The queue's own delivery count; the task's persisted `attempts` is what bounds it. */
  attempt: number;
  /** Set once the task has reached an outcome this invocation is answerable for. */
  outcome: { settled: boolean };
}

async function runClaimedTask(run: ClaimedRun): Promise<void> {
  const { uid, jobId, taskId, ref, job, taskRef, claimToken, task, attempt, outcome } = run;
  // Dependency gate. A failed dependency permanently blocks this task; deps
  // that aren't done yet mean a premature dispatch — release and let the
  // dep's completion (or the reaper) re-queue us when truly ready.
  if (task.dependsOn && task.dependsOn.length > 0) {
    const deps = await readDeps(uid, jobId, task.dependsOn);
    if (deps.some((d) => d.status === "error")) {
      const marked = await markTaskError(
        taskRef,
        claimToken,
        "Skipped: a dependency failed to generate.",
      );
      outcome.settled = true;
      if (marked) {
        await skipDependents(ref, uid, taskId);
        await finalizeIfComplete(ref, "fail");
      }
      return;
    }
    const allDone = task.dependsOn.every((id) => deps.find((d) => d.id === id)?.status === "done");
    if (!allDone) {
      // A premature dispatch is not an attempt: give the claim back whole.
      await releaseTask(taskRef, claimToken);
      const before = Math.max(0, (task.attempts ?? 1) - 1);
      await taskRef
        .update({ attempts: before, firstClaimedAt: before === 0 ? null : (task.firstClaimedAt ?? null) })
        .catch(() => undefined);
      outcome.settled = true;
      return;
    }
  }

  // What this wave has left for the task. Attempts and the clock are kept on
  // the task, so a task the reaper keeps re-enqueueing still runs out.
  const attemptNo = task.attempts ?? attempt;
  const remainingMs = taskBudgetMs(taskId) - (Date.now() - (task.firstClaimedAt ?? Date.now()));
  const pastDeadline = typeof job.deadlineAt === "number" && Date.now() > job.deadlineAt;
  if (attemptNo > TASK_MAX_ATTEMPTS || remainingMs < minAttemptMs(taskId) || pastDeadline) {
    const cause = new ProviderError(
      pastDeadline
        ? DEADLINE_ERROR
        : task.lastError
          ? `Gave up after ${attemptNo - 1} tries: ${task.lastError}`
          : `Gave up after ${attemptNo - 1} tries: it took too long.`,
      { kind: task.lastErrorKind ?? "timeout", retryable: false },
    );
    logger.error("[fan] task out of attempts or time", { jobId, taskId, attempts: attemptNo, remainingMs });
    const marked = await markTaskError(taskRef, claimToken, cause.message, cause);
    outcome.settled = true;
    if (marked) {
      await skipDependents(ref, uid, taskId);
      await finalizeIfComplete(ref, "fail");
    }
    return;
  }

  // `expandJob` validated this and persisted it onto the job doc (guests
  // already downgraded), so this only re-reads a known-good value.
  const tier = normalizeImageTier(job.tier);
  const attemptMs = Math.min(attemptTimeoutMs(taskId), remainingMs);
  const timeout = withTaskTimeout(attemptMs);
  const attemptDeadlineAt = Date.now() + attemptMs;
  // The lease is only as long as the worker is demonstrably alive. If it is
  // lost, the render is stopped rather than left to spend money on a task
  // someone else now owns.
  const stopHeartbeat = startHeartbeat(taskRef, claimToken, timeout.abort);
  const attemptStartedAt = Date.now();
  const ledger = newSpendLedger();
  // Cost of earlier attempts at this unit (this wave's, or a previous job's
  // that was given up on), handed to the price window with this delivery.
  const banked = await readWasteCarry(uid, jobProjectId(job), taskId);
  const carry: CarriedCost = {
    usd: (task.wasteUsd ?? 0) + banked.usd,
    imageCalls: (task.wasteImageCalls ?? 0) + banked.imageCalls,
  };
  let result: TaskResult;
  let stats: TaskStats;
  try {
    ({ result, stats } = await runWithSpendLedger(ledger, () =>
      runWithCarriedCost(carry, () => renderTask(uid, jobId, job, task, tier, timeout.signal, attemptDeadlineAt)),
    ));
  } catch (err) {
    stopHeartbeat();
    // Whatever the attempt spent is booked, whatever became of the task.
    await recordFailedAttempt({ uid, jobId, job, task, taskRef, tier, ledger, startedAt: attemptStartedAt, err });
    if (attemptNo < TASK_MAX_ATTEMPTS && isRetryableRenderError(err)) {
      // Non-2xx so Cloud Tasks retries on its backoff. Release first: the retry
      // has to be able to claim the task again.
      const released = await releaseTask(taskRef, claimToken, err);
      outcome.settled = true;
      if (!released) return;
      logger.warn("[fan] retryable render failure — returning to the queue", {
        jobId,
        taskId,
        attempt: attemptNo,
        err: String(err),
      });
      throw err;
    }
    const marked = await markTaskError(
      taskRef,
      claimToken,
      (err as Error)?.message ?? "Generation failed.",
      err,
    );
    outcome.settled = true;
    if (marked) {
      await skipDependents(ref, uid, taskId);
      await finalizeIfComplete(ref, "fail");
    }
    return;
  } finally {
    stopHeartbeat();
    timeout.done();
  }

  // Anything that failed inside a scope the render recovered from was still paid for.
  if (ledger.events.length > 0 || ledger.stats.calls > 0) {
    await recordFailedAttempt({
      uid,
      jobId,
      job,
      task,
      taskRef,
      tier,
      ledger,
      startedAt: attemptStartedAt,
      delivered: true,
    });
  }

  // The write that commits a paid-for render is retried: losing it to one
  // flaky write would draw (and bill the provider for) the same picture again.
  const completed = await withWriteRetries(() => completeTask(taskRef, claimToken, result, stats));
  outcome.settled = true;
  if (!completed) return;
  // Delivered: the banked cost of earlier give-ups has reached the price window.
  const projectId = jobProjectId(job);
  if (carry.consumed && banked.usd > 0 && projectId) {
    await wasteCarryRef(uid, projectId, taskId).delete().catch(() => undefined);
  }

  // A likeness source has completed its only job once the first character
  // sheet is durably recorded. Deletion is best-effort here; the 24-hour
  // scheduled expiry is the backstop if Storage is temporarily unavailable.
  if (job.kind === "portrait") {
    // The consent says the photos go once the portrait is done.
    const member = (briefOf(job.project.config).cast ?? []).find((m) => m.id === taskId);
    const used = member && portraitReferencePlan(job.project, member).photos > 0 ? likenessPhotosOf(member) : [];
    for (const photo of used) {
      await deleteLikenessPhotoForSubject(uid, job.project.id, taskId, photo.createdAt).catch((err) => {
        logger.warn("[fan] portrait photo deletion failed; expiry will retry", { jobId, taskId, err: String(err) });
      });
    }
  }
  if ((job.kind === "anchors" || job.kind === "book") && taskKindOf(job, task) === "anchors") {
    const createdAt = (result as AnchorRender).consumedLikenessCreatedAt;
    if (createdAt !== undefined) {
      await deleteLikenessPhotoForSubject(
        uid,
        job.project.id,
        taskId,
        createdAt,
      ).catch((err) => {
        logger.warn("[fan] likeness deletion failed; expiry will retry", {
          jobId,
          taskId,
          err: String(err),
        });
      });
    }
  }

  // Bookkeeping from here on. It must never be able to un-deliver the render
  // above: these two used to sit inside the render's own try/catch, so a
  // Firestore contention abort on the shared job document — which is exactly
  // what a dozen pages finishing at once produces — flipped a rendered,
  // already-charged page to "error" and threw its result away. The reaper
  // recomputes progress from the task docs, so swallowing these is safe.
  await finalizeIfComplete(ref, "success").catch((err) => {
    logger.error("[fan] progress update failed (render kept)", { jobId, taskId, err: String(err) });
  });
  await enqueueReadyDependents(uid, jobId, taskId, job.kind).catch((err) => {
    logger.error("[fan] dependent dispatch failed", { jobId, taskId, err: String(err) });
  });
}

/**
 * Both workers run the same body. `req.id` is the Cloud Tasks task name, useful
 * for diagnostics but stable across retries; a unique invocation token fences
 * actual ownership inside `handleTask`.
 */
function dispatch(req: { data: TaskPayload; id?: string; retryCount?: number }): Promise<void> {
  const owner = req.id ?? `${req.data.jobId}:${req.data.taskId}`;
  return handleTask(req.data, owner, (req.retryCount ?? 0) + 1);
}

/**
 * IMAGE WORKER. Its fleet-wide dispatch cap is the single knob protecting the
 * image provider from bursts, so it stays deliberately small — see
 * {@link MAX_CONCURRENT_DISPATCHES}.
 */
export const runFanTask = onTaskDispatched<TaskPayload>(
  {
    secrets: ALL_SECRETS,
    memory: "2GiB",
    // Above the longest attempt (a cover's eight minutes) with room to save it,
    // and under the queue's ten-minute dispatch deadline.
    timeoutSeconds: 540,
    concurrency: WORKER_CONCURRENCY,
    retryConfig: {
      maxAttempts: TASK_MAX_ATTEMPTS,
      minBackoffSeconds: 5,
      maxBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: MAX_CONCURRENT_DISPATCHES,
      maxDispatchesPerSecond: MAX_DISPATCHES_PER_SEC,
    },
  },
  dispatch,
);

/**
 * TEXT WORKER — screenplay drafting on its own queue, so a cheap 30s text call
 * never waits behind a batch of multi-minute image renders. Text has no shared
 * rate limit with images and needs a fraction of the memory, so it runs wider.
 */
export const runTextTask = onTaskDispatched<TaskPayload>(
  {
    secrets: ALL_SECRETS,
    memory: "512MiB",
    timeoutSeconds: 300,
    concurrency: TEXT_WORKER_CONCURRENCY,
    retryConfig: {
      maxAttempts: TASK_MAX_ATTEMPTS,
      minBackoffSeconds: 5,
      maxBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: TEXT_MAX_CONCURRENT_DISPATCHES,
      maxDispatchesPerSecond: TEXT_MAX_DISPATCHES_PER_SEC,
    },
  },
  dispatch,
);

// ---------------------------------------------------------------------------
// Reaper (backstop)
// ---------------------------------------------------------------------------

/** Recompute progress from the task docs and set the terminal status. */
async function forceFinalize(ref: DocumentReference, uid: string, reason?: string): Promise<void> {
  const snaps = (await tasksCol(uid, ref.id).get()).docs;
  const all = snaps.map((d) => d.data() as TaskDoc);
  const completed = all.filter((t) => t.status === "done").length;
  const failed = all.filter((t) => t.status === "error").length;
  await ref.update({
    status: failed > 0 && completed === 0 ? "error" : "done",
    progress: { total: all.length, completed, failed },
    recovering: false,
    ...(reason && failed > 0 ? { error: reason } : {}),
    updatedAt: Date.now(),
  });
  await bankFailedWaste(ref, uid, snaps).catch((err) => {
    logger.warn("[fan] could not bank failed-unit cost", { jobId: ref.id, err: String(err) });
  });
  await afterJobFinished(ref, uid);
}

/**
 * A unit the book gave up on has still cost what its failed attempts cost. Park
 * that on the project and unit; the next delivery of the same unit (the reader
 * pressing "draw it again") carries it into the price window, so the average
 * pays for retries that never produced anything on their own.
 */
async function bankFailedWaste(
  ref: DocumentReference,
  uid: string,
  tasks: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<void> {
  const owing = tasks.filter((d) => {
    const t = d.data() as TaskDoc;
    return t.status === "error" && (t.wasteUsd ?? 0) > 0 && !t.wasteCarried;
  });
  if (owing.length === 0) return;
  const job = (await ref.get()).data() as AnyJob | undefined;
  const projectId = job ? jobProjectId(job) : undefined;
  if (!projectId) return;
  const batch = db().batch();
  const now = Date.now();
  for (const d of owing) {
    const t = d.data() as TaskDoc;
    batch.set(
      wasteCarryRef(uid, projectId, t.id),
      {
        usd: FieldValue.increment(t.wasteUsd ?? 0),
        imageCalls: FieldValue.increment(t.wasteImageCalls ?? 0),
        updatedAt: now,
      },
      { merge: true },
    );
    batch.update(d.ref, { wasteCarried: true });
  }
  await batch.commit();
}

/** Finish a job with nothing left to run, giving its failures their second pass first. */
async function finishOrRetry(ref: DocumentReference, uid: string, job: AnyJob): Promise<void> {
  const all = (await tasksCol(uid, ref.id).get()).docs.map((d) => d.data() as TaskDoc);
  if (all.some((t) => t.status === "error") && recoveryApplies(job)) {
    await ref.update({
      secondPass: true,
      recovering: true,
      recoveryPasses: recoveryPassesUsed(job) + 1,
      updatedAt: Date.now(),
    });
    await retryFailedTasks(ref, uid, job.kind);
    return;
  }
  await forceFinalize(ref, uid);
}

/**
 * Give up on whatever's left of a job that has been re-driven too many times or
 * has run out of time. A task whose worker is still demonstrably alive is left
 * to finish — its attempt is bounded by its own timeout — and the job closes on
 * a later sweep, so a render that is about to land is never thrown away.
 */
async function failRemaining(
  ref: DocumentReference,
  uid: string,
  reason = "Generation could not complete after multiple attempts.",
): Promise<void> {
  const snaps = (await tasksCol(uid, ref.id).get()).docs;
  const batch = db().batch();
  const now = Date.now();
  let live = 0;
  for (const d of snaps) {
    const t = d.data() as TaskDoc;
    if (isTerminal(t.status)) continue;
    if (t.status === "running" && typeof t.claimedUntil === "number" && t.claimedUntil > now) {
      live += 1;
      continue;
    }
    batch.update(d.ref, {
      status: "error",
      error: reason,
      errorKind: t.lastErrorKind ?? "timeout",
      claimedBy: null,
      claimToken: null,
      claimedUntil: 0,
      updatedAt: now,
    });
  }
  await batch.commit();
  if (live > 0) return;
  await forceFinalize(ref, uid, reason);
}

/** Has this task used up what its wave allows (attempts or time)? */
function taskSpent(t: TaskDoc, now: number): boolean {
  if ((t.attempts ?? 0) >= TASK_MAX_ATTEMPTS) return true;
  return typeof t.firstClaimedAt === "number" && now - t.firstClaimedAt > taskBudgetMs(t.id);
}

/**
 * Close a task nobody is working on any more and that has no attempts or time
 * left. Fenced on the lease having lapsed, so a worker that is merely slow is
 * never closed under its own feet.
 */
async function closeSpentTask(taskRef: DocumentReference): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    const t = snap.data() as TaskDoc | undefined;
    const now = Date.now();
    if (!t || isTerminal(t.status)) return false;
    if (typeof t.claimedUntil === "number" && t.claimedUntil > now) return false;
    if (!taskSpent(t, now)) return false;
    tx.update(taskRef, {
      status: "error",
      error: t.lastError
        ? `Gave up after ${t.attempts ?? 0} tries: ${t.lastError}`
        : `Gave up after ${t.attempts ?? 0} tries: it took too long.`,
      errorKind: t.lastErrorKind ?? "timeout",
      claimedBy: null,
      claimToken: null,
      claimedUntil: 0,
      updatedAt: now,
    });
    return true;
  });
}

/**
 * Count one re-drive that did something. A job stuck at the same progress that
 * has been given this many chances is closed; one whose tasks keep finishing
 * starts the count over.
 */
async function spendRun(ref: DocumentReference, job: AnyJob): Promise<boolean> {
  const mark = (job.progress?.completed ?? 0) + (job.progress?.failed ?? 0);
  const runCount = job.reapMark === mark ? (job.runCount ?? 0) + 1 : 1;
  await ref.update({ runCount, reapMark: mark, updatedAt: Date.now() });
  return runCount > MAX_JOB_RUNS;
}

/**
 * Re-drive a stalled job: re-expand it if it never expanded, otherwise re-queue
 * every ready task and finalize the job if it's actually complete or deadlocked
 * (all remaining tasks blocked by a failed dependency). Bumps `updatedAt` first
 * so a job doesn't get re-picked every tick while its re-queued tasks run.
 */
async function resumeJob(ref: DocumentReference, uid: string, job: AnyJob): Promise<void> {
  const now = Date.now();
  // Looked at now: the next sweep considers this job again once it has been
  // quiet for STALE_MS. Only a re-drive that DOES something spends the run
  // budget (see `spendRun`) — finding tasks legitimately in flight costs nothing.
  await ref.update({ updatedAt: now });

  // Out of time. Whatever is drawn stays drawn; what is not is closed with an
  // error the studio can show, so the book is never left "drawing".
  if (typeof job.deadlineAt === "number" && now > job.deadlineAt) {
    logger.error("[reap] job passed its deadline", { jobId: ref.id, uid });
    await failRemaining(ref, uid, DEADLINE_ERROR);
    return;
  }

  if (!job.expanded) {
    if (await spendRun(ref, job)) {
      await failRemaining(ref, uid);
      return;
    }
    await expandJob(ref, uid, job);
    return;
  }

  const snaps = (await tasksCol(uid, ref.id).get()).docs;
  const all = snaps.map((d) => d.data() as TaskDoc);

  // The aggregate on the job is incremented by workers and can fall behind (a
  // contended write that was logged and dropped). The task docs are the truth.
  const completedN = all.filter((t) => t.status === "done").length;
  const failedN = all.filter((t) => t.status === "error").length;
  if (
    job.progress &&
    (job.progress.completed !== completedN || job.progress.failed !== failedN || job.progress.total !== all.length)
  ) {
    await ref.update({ progress: { total: all.length, completed: completedN, failed: failedN } });
  }

  const nonTerminal = all.filter((t) => !isTerminal(t.status));
  if (nonTerminal.length === 0) {
    await finishOrRetry(ref, uid, job);
    return;
  }

  // Tasks nobody is working on any more and that have no attempts or time left
  // are failed here and now, rather than re-enqueued to be found dead again.
  let closed = 0;
  for (const d of snaps) {
    const t = d.data() as TaskDoc;
    if (isTerminal(t.status) || !taskSpent(t, now)) continue;
    if (!(await closeSpentTask(d.ref))) continue;
    closed += 1;
    logger.error("[reap] closed a task that ran out of attempts or time", { jobId: ref.id, taskId: t.id });
    await skipDependents(ref, uid, t.id);
    await finalizeIfComplete(ref, "fail");
  }
  if (closed > 0) return;

  const statusById = new Map(all.map((t) => [t.id, t.status]));
  const ready = nonTerminal.filter((t) => {
    if (!t.dependsOn.every((id) => statusById.get(id) === "done")) return false;
    // A worker that stopped heartbeating, or a queue message that was lost.
    if (t.status === "running") return !t.claimedUntil || t.claimedUntil < now;
    return now - (t.updatedAt ?? 0) > PENDING_REQUEUE_MS;
  });

  if (ready.length > 0) {
    if (await spendRun(ref, job)) {
      await failRemaining(ref, uid);
      return;
    }
    await enqueueTasks(uid, ref.id, ready.map((t) => t.id), job.kind);
    return;
  }

  // Nothing ready: if every remaining task is blocked by a failed or missing
  // dependency the job can never finish — mark them errored and finalize
  // (no perpetual stall). A missing dependency cannot be recovered, so that
  // case does not spend a recovery wave resetting tasks that cannot run.
  const blocked = nonTerminal.filter((t) =>
    t.dependsOn.some((id) => {
      const status = statusById.get(id);
      return status === "error" || status === undefined;
    }),
  );
  if (blocked.length === nonTerminal.length && blocked.length > 0) {
    const batch = db().batch();
    for (const t of blocked) {
      batch.update(tasksCol(uid, ref.id).doc(t.id), {
        status: "error",
        error: "Skipped: a dependency failed to generate.",
        updatedAt: now,
      });
    }
    await batch.commit();
    const missingOnly = blocked.every((t) =>
      t.dependsOn.some((id) => statusById.get(id) === undefined),
    );
    if (missingOnly) await forceFinalize(ref, uid);
    else await finishOrRetry(ref, uid, job);
  }
  // Otherwise tasks are legitimately in flight (claim not lapsed) — wait.
}

/**
 * Scheduled backstop. A live job advances `updatedAt` as its tasks complete, so
 * a non-terminal job whose `updatedAt` is older than {@link STALE_MS} is one
 * whose enqueue was lost, whose worker died, or that was never expanded. Each is
 * re-driven through {@link resumeJob} until terminal, so a batch can never get
 * permanently stranded at partial progress.
 */
export const reapStuckJobs = onSchedule(
  {
    schedule: "every 1 minutes",
    secrets: ALL_SECRETS,
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    ensureAdmin();
    const cutoff = Date.now() - STALE_MS;
    const budget = Date.now() + REAP_BUDGET_MS;
    const seen = new Set<string>();
    let resumed = 0;

    for (const status of ["running", "pending"] as const) {
      const snap = await db()
        .collectionGroup("jobs")
        .where("status", "==", status)
        .orderBy("updatedAt", "asc")
        .limit(REAP_BATCH)
        .get();
      for (const doc of snap.docs) {
        if (Date.now() > budget) break;
        const job = doc.data() as AnyJob;
        if (job.updatedAt > cutoff) break; // rest are fresher (ordered asc)
        if (seen.has(doc.ref.path)) continue;
        seen.add(doc.ref.path);
        const uid = doc.ref.parent.parent?.id;
        if (!uid) continue;
        try {
          await resumeJob(doc.ref, uid, job);
          resumed += 1;
        } catch (err) {
          logger.error("[reap] failed to resume job", { path: doc.ref.path, err: String(err) });
        }
      }
    }
    if (resumed > 0) logger.info(`[reap] re-drove ${resumed} stuck job(s)`);
  },
);
