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
import {
  getFirestore,
  type CollectionReference,
  type DocumentReference,
} from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { getAuth } from "firebase-admin/auth";
import "./providerHttp";
import { serverConfig } from "./config";
import { compositeMaskedRegion, downscaleReference } from "./imaging";
import { backendPipelineEnv } from "./pipelineEnv";
import { loadPromptContext, recordLatencySamples } from "./appConfig";
import { resolveImageModels } from "./modelResolve";
import { recordUsage, withUsage, type CallStats } from "./usage";
import { featureAllowedForUser } from "./plans";
import { ensureAfford, estimateForUser, settleActionCost } from "./sparks";
import { normalizeImageTier, type ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import { ALL_SECRETS } from "./secrets";
import { downloadBlob, ensureAdmin, uploadBlob } from "./storage";
import type { ResolvedModels } from "../../books-frontend/src/core/models/registry";
import { containedAnchorsFor } from "../../books-frontend/src/core/book/anchorGraph";
import { effectiveAnchorIds } from "../../books-frontend/src/core/book/anchorRefs";
import { spreadsById } from "../../books-frontend/src/core/book/units";
import { DISPATCH_KEY } from "../../books-frontend/src/core/config/latencyStats";
import { latencyKindOf as kindOf, recordTaskLatency } from "./latency";
import {
  applyAnchorRender,
  renderAnchor,
  type AnchorRender,
} from "../../books-frontend/src/core/pipeline/anchorRun";
import { renderIllustration } from "../../books-frontend/src/core/pipeline/illustrationRun";
import { withRetry } from "../../books-frontend/src/core/pipeline/retry";
import { getImageProvider } from "../../books-frontend/src/core/providers";
import type {
  ImageRequest,
  ReferenceImage,
} from "../../books-frontend/src/core/providers/types";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import { COVER_BACK_ID, COVER_FRONT_ID, SPINE_ID } from "../../books-frontend/src/core/types";
import {
  type AnchorsJob,
  type AnchorTask,
  type AnyJob,
  type ImageRenderRequest,
  type JobKind,
  type JobProgress,
  type JobStatus,
  type JobTask,
  type PipelineRefreshJob,
  type RefreshTask,
  type TaskDoc,
  type TaskResult,
  type TaskStats,
} from "../../books-frontend/src/core/jobs/types";

/** The Cloud Tasks queue backing {@link runFanTask} (== the function name). */
const FAN_QUEUE = "runFanTask";

/**
 * How long a worker owns a claimed task before another dispatch may re-claim it.
 * Kept above the worker's own timeout so a slow-but-alive render is never
 * double-run; once it lapses the reaper can safely re-queue a dead task.
 */
const TASK_LEASE_MS = 6 * 60_000;
/** Hard cap on a single task's provider work — a stalled call fails fast. */
const TASK_TIMEOUT_MS = 4 * 60_000;
/**
 * A non-terminal job whose `updatedAt` is older than this is treated as
 * abandoned (enqueue lost / worker died). Kept ≥ the task lease so a job with a
 * legitimately in-flight task isn't reaped early.
 */
const STALE_MS = TASK_LEASE_MS;
/** Max times the reaper may re-drive a job before giving up on the remainder. */
const MAX_JOB_RUNS = 10;
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
const WORKER_CONCURRENCY = Number(process.env.FAN_WORKER_CONCURRENCY) || 4;
const MAX_CONCURRENT_DISPATCHES = Number(process.env.FAN_MAX_CONCURRENT) || 20;
const MAX_DISPATCHES_PER_SEC = Number(process.env.FAN_MAX_PER_SEC) || 10;
const TASK_MAX_ATTEMPTS = Number(process.env.FAN_MAX_ATTEMPTS) || 3;

function db() {
  return getFirestore();
}

function jobRef(uid: string, jobId: string): DocumentReference {
  return db().doc(`users/${uid}/jobs/${jobId}`);
}

function tasksCol(uid: string, jobId: string): CollectionReference {
  return db().collection(`users/${uid}/jobs/${jobId}/tasks`);
}

/** A per-task abort signal that trips after {@link TASK_TIMEOUT_MS}. */
function withTaskTimeout(): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TASK_TIMEOUT_MS);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
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

function isTerminal(status: JobStatus): boolean {
  return status === "done" || status === "error";
}

/** Model role a job kind resolves against (covers reuse the page model). */
function modelRoleFor(kind: JobKind): "pageIllustration" | "anchorImage" {
  return kind === "anchors" ? "anchorImage" : "pageIllustration";
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Enqueue tasks onto the Cloud Tasks queue. Best-effort per id: a failed
 * enqueue is logged but not thrown, because the reaper re-queues any ready task
 * a job is missing — so a transient queue hiccup can't strand a job.
 */
async function enqueueTasks(uid: string, jobId: string, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  const queue = getFunctions().taskQueue(FAN_QUEUE);
  await Promise.all(
    taskIds.map((taskId) =>
      queue.enqueue({ uid, jobId, taskId }).catch((err) => {
        logger.error("[fan] enqueue failed", { jobId, taskId, err: String(err) });
      }),
    ),
  );
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
  if (job.kind !== "anchors") {
    for (const t of specs) out.set(t.id, []);
    return out;
  }
  const anchors = job.project.anchors ?? [];
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const inJob = new Set(specs.map((t) => t.id));
  for (const t of specs) {
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
 * every existing account may run jobs — guests included — but guests are
 * limited to the cheap tier with no negative-balance buffer. Fails closed
 * (denied) when the account can't be loaded.
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
    (job.kind === "refresh" || job.kind === "anchors") &&
    job.project?.config?.artStyle?.customDescription?.trim()
  ) {
    const allowed = await featureAllowedForUser(uid, "customArtStyle").catch(() => true);
    if (!allowed) {
      job.project.config.artStyle = { ...job.project.config.artStyle, customDescription: "" };
    }
  }
  return job;
}

/** Build the per-kind payload fields for a task doc (omitting undefined). */
function taskPayload(kind: JobKind, spec: JobTask | RefreshTask | AnchorTask): Partial<TaskDoc> {
  if (kind === "image") {
    const s = spec as JobTask;
    const out: Partial<TaskDoc> = { request: s.request };
    if (s.referenceUses) out.referenceUses = s.referenceUses;
    return out;
  }
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

  // Guests render on the cheap tier only and get no negative buffer.
  const tier = caller.guest ? "quick" : normalizeImageTier(job.tier);
  // Pre-check the whole batch is affordable (within the negative buffer) so we
  // don't dispatch work the user can't pay for; each task settles as it renders.
  const action = job.kind === "anchors" ? "anchorImage" : "pageIllustration";
  await ensureAfford(uid, (await estimateForUser(uid, action, tier)) * specs.length, {
    noNegativeBuffer: caller.guest,
  });

  await applyFeatureGate(uid, job);

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
      kind: job.kind,
      status: "pending",
      dependsOn: dependsMap.get(spec.id) ?? [],
      ...taskPayload(job.kind, spec),
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
    progress: { total: specs.length, completed: 0, failed: 0 },
    // Persist the (possibly guest-downgraded) tier so workers render with it.
    tier,
    // Persist the feature-gated snapshot so workers render against it.
    ...(job.kind !== "image" ? { project: (job as PipelineRefreshJob | AnchorsJob).project } : {}),
  });
  await batch.commit();

  // Dispatch roots (no dependencies). Dependents are enqueued as their deps
  // complete — or by the reaper if a completion's dispatch is lost.
  const roots = specs.filter((s) => (dependsMap.get(s.id) ?? []).length === 0).map((s) => s.id);
  await enqueueTasks(uid, ref.id, roots);
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
async function claimTask(taskRef: DocumentReference): Promise<TaskDoc | null> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return null;
    const task = snap.data() as TaskDoc;
    if (isTerminal(task.status)) return null;
    const now = Date.now();
    if (typeof task.claimedUntil === "number" && task.claimedUntil > now) return null;
    const claimedUntil = now + TASK_LEASE_MS;
    tx.update(taskRef, { status: "running", claimedUntil, updatedAt: now });
    return { ...task, status: "running", claimedUntil };
  });
}

/** Read a task's dependency docs (missing ones simply drop out). */
async function readDeps(uid: string, jobId: string, depIds: string[]): Promise<TaskDoc[]> {
  if (depIds.length === 0) return [];
  const col = tasksCol(uid, jobId);
  const snaps = await db().getAll(...depIds.map((id) => col.doc(id)));
  return snaps.filter((s) => s.exists).map((s) => s.data() as TaskDoc);
}

async function markTaskError(taskRef: DocumentReference, message: string): Promise<void> {
  await taskRef.update({
    status: "error",
    error: message,
    claimedUntil: 0,
    updatedAt: Date.now(),
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
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const job = snap.data() as AnyJob;
    if (isTerminal(job.status)) return;
    const prog = job.progress ?? { total: 0, completed: 0, failed: 0 };
    const completed = prog.completed + (outcome === "success" ? 1 : 0);
    const failed = prog.failed + (outcome === "fail" ? 1 : 0);
    const patch: { progress: JobProgress; updatedAt: number; status?: JobStatus } = {
      progress: { total: prog.total, completed, failed },
      updatedAt: Date.now(),
    };
    if (completed + failed >= prog.total) {
      patch.status = failed > 0 && completed === 0 ? "error" : "done";
    }
    tx.update(ref, patch);
  });
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
  await enqueueTasks(uid, jobId, ready);
}

/**
 * Run one image-render task and return the stored result. The model/provider
 * are resolved server-side (the client-supplied values on the request are
 * ignored) so generation can't be escalated to a costlier model.
 */
async function runImageTask(
  uid: string,
  req: ImageRenderRequest,
  model: ResolvedModels["imageModel"],
  tier: ImageTier,
  action: "pageIllustration" | "coverIllustration",
  projectId: string | undefined,
  loadStyle: (presetId?: string) => Promise<{ base64: string; mimeType: string } | null>,
  signal: AbortSignal,
): Promise<{ blobId: string; mimeType: string; stats: CallStats }> {
  const canShrink = !req.maskBlobId;
  const references: ReferenceImage[] = await Promise.all(
    (req.references ?? []).map(async (r): Promise<ReferenceImage> => {
      const buf = await downloadBlob(uid, r.blobId);
      const small = canShrink ? await downscaleReference(buf) : null;
      return {
        base64: bufToBase64(small?.buf ?? buf),
        mimeType: small?.mimeType ?? r.mimeType ?? "image/png",
        label: r.label,
        role: r.role,
      };
    }),
  );

  if (req.stylePresetId && !req.maskBlobId) {
    const style = await loadStyle(req.stylePresetId);
    if (style) {
      references.unshift({
        base64: style.base64,
        mimeType: style.mimeType,
        role: "style",
        label: "art style reference",
      });
    }
  }

  let mask: ReferenceImage | undefined;
  if (req.maskBlobId) {
    const buf = await downloadBlob(uid, req.maskBlobId);
    mask = { base64: bufToBase64(buf), mimeType: "image/png" };
  }

  const imageReq: ImageRequest = {
    model: model.id,
    prompt: req.prompt,
    size: req.size,
    quality: req.quality,
    references: references.length ? references : undefined,
    mask,
    signal,
  };

  const { value: result, events, stats } = await withUsage(() =>
    withRetry(
      () =>
        getImageProvider(model.provider).generateImage(
          { apiKey: apiKeyFor(model.provider) },
          imageReq,
        ),
      { retries: 1, signal },
    ),
  );
  const isEdit = Boolean(req.composite || req.maskBlobId);
  await recordUsage(uid, action, events, tier, { projectId, isEdit, stats });
  await settleActionCost(uid, action, events, { projectId });

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
  return { blobId, mimeType, stats };
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

/** Render one task through its kind's pipeline; records usage + latency. */
async function renderTask(
  uid: string,
  job: AnyJob,
  task: TaskDoc,
  tier: ImageTier,
  signal: AbortSignal,
): Promise<{ result: TaskResult; stats: TaskStats }> {
  const [models, prompts] = await Promise.all([
    resolveImageModels(modelRoleFor(job.kind), tier),
    loadPromptContext(),
  ]);
  const env = backendPipelineEnv(uid, models, prompts);
  const startedAt = Date.now();

  if (job.kind === "image") {
    const projectId = job.projectId;
    const req = task.request;
    if (!req) throw new Error("Image task is missing its render request.");
    const action = illustrationActionFor(task.id);
    const styleCache = new Map<string, Promise<{ base64: string; mimeType: string } | null>>();
    const loadStyle = (presetId?: string) => {
      if (!presetId) return Promise.resolve(null);
      let hit = styleCache.get(presetId);
      if (!hit) {
        hit = env.loadStyleImage(presetId).catch(() => null);
        styleCache.set(presetId, hit);
      }
      return hit;
    };
    const { blobId, mimeType, stats } = await runImageTask(
      uid,
      req,
      models.imageModel,
      tier,
      action,
      projectId,
      loadStyle,
      signal,
    );
    const ms = Date.now() - startedAt;
    await recordTaskLatency(
      action,
      tier,
      req.composite || req.maskBlobId ? "edit" : "fresh",
      req.references?.length ?? 0,
      ms,
    );
    return { result: { blobId, mimeType }, stats: { ms, ...stats } };
  }

  const project = (job as PipelineRefreshJob | AnchorsJob).project;
  const projectId = job.projectId ?? project?.id;
  const isEdit = typeof task.options?.edit === "string" && task.options.edit.trim().length > 0;

  if (job.kind === "refresh") {
    const spread = spreadsById(project).get(task.id);
    if (!spread) throw new Error("Spread not found in the project snapshot.");
    const action = illustrationActionFor(task.id);
    const { value: render, events, stats } = await withUsage(() =>
      renderIllustration(project, spread, { ...(task.options ?? {}), signal }, env),
    );
    await recordUsage(uid, action, events, tier, { projectId, isEdit, stats });
    await settleActionCost(uid, action, events, { projectId });
    if (!render) throw new Error("Nothing to render for this spread.");
    const ms = Date.now() - startedAt;
    await recordTaskLatency(
      action,
      tier,
      kindOf(task.options),
      effectiveAnchorIds(project.anchors, spread).length,
      ms,
    );
    return { result: render, stats: { ms, ...stats } };
  }

  // anchors
  const anchor = (project.anchors ?? []).find((a) => a.id === task.id);
  if (!anchor) throw new Error("Anchor not found in the project snapshot.");
  await hydrateAnchorDeps(uid, task.jobId, task, project);
  const { value: render, events, stats } = await withUsage(() =>
    renderAnchor(project, anchor, { ...(task.options ?? {}), signal }, env),
  );
  await recordUsage(uid, "anchorImage", events, tier, { projectId, isEdit, stats });
  await settleActionCost(uid, "anchorImage", events, { projectId });
  const ms = Date.now() - startedAt;
  await recordTaskLatency(
    "anchorImage",
    tier,
    kindOf(task.options),
    containedAnchorsFor(anchor, project.anchors ?? []).length,
    ms,
  );
  return { result: render, stats: { ms, ...stats } };
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
 * WORKER: render exactly one task. Claims it (dedupes duplicate/at-least-once
 * dispatch), verifies its dependencies, renders under a per-task timeout, writes
 * the result, advances aggregate progress, and dispatches now-ready dependents.
 * A render failure is TERMINAL for the task (returns 2xx, no Cloud Tasks retry);
 * only a hard crash (OOM/timeout) surfaces as non-2xx so Cloud Tasks retries the
 * infrastructure failure per `retryConfig`.
 */
export const runFanTask = onTaskDispatched<{ uid: string; jobId: string; taskId: string }>(
  {
    secrets: ALL_SECRETS,
    memory: "2GiB",
    timeoutSeconds: 300,
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
  async (req) => {
    ensureAdmin();
    const { uid, jobId, taskId } = req.data;
    if (!uid || !jobId || !taskId) return;

    const ref = jobRef(uid, jobId);
    const jobSnap = await ref.get();
    if (!jobSnap.exists) return;
    const job = jobSnap.data() as AnyJob;
    if (isTerminal(job.status)) return;

    const taskRef = tasksCol(uid, jobId).doc(taskId);
    const task = await claimTask(taskRef);
    if (!task) return; // terminal, held by a live worker, or gone

    // Dependency gate. A failed dependency permanently blocks this task; deps
    // that aren't done yet mean a premature dispatch — release and let the
    // dep's completion (or the reaper) re-queue us when truly ready.
    if (task.dependsOn && task.dependsOn.length > 0) {
      const deps = await readDeps(uid, jobId, task.dependsOn);
      if (deps.some((d) => d.status === "error")) {
        await markTaskError(taskRef, "Skipped: a dependency failed to generate.");
        await finalizeIfComplete(ref, "fail");
        return;
      }
      const allDone = task.dependsOn.every(
        (id) => deps.find((d) => d.id === id)?.status === "done",
      );
      if (!allDone) {
        await taskRef.update({ status: "pending", claimedUntil: 0, updatedAt: Date.now() });
        return;
      }
    }

    const tier = normalizeImageTier(job.tier);
    const timeout = withTaskTimeout();
    try {
      const { result, stats } = await renderTask(uid, job, task, tier, timeout.signal);
      await taskRef.update({
        status: "done",
        result,
        stats,
        claimedUntil: 0,
        updatedAt: Date.now(),
      });
      await finalizeIfComplete(ref, "success");
      await enqueueReadyDependents(uid, jobId, taskId);
    } catch (err) {
      await markTaskError(taskRef, (err as Error)?.message ?? "Generation failed.");
      await finalizeIfComplete(ref, "fail");
    } finally {
      timeout.done();
    }
  },
);

// ---------------------------------------------------------------------------
// Reaper (backstop)
// ---------------------------------------------------------------------------

/** Recompute progress from the task docs and set the terminal status. */
async function forceFinalize(ref: DocumentReference, uid: string): Promise<void> {
  const all = (await tasksCol(uid, ref.id).get()).docs.map((d) => d.data() as TaskDoc);
  const completed = all.filter((t) => t.status === "done").length;
  const failed = all.filter((t) => t.status === "error").length;
  await ref.update({
    status: failed > 0 && completed === 0 ? "error" : "done",
    progress: { total: all.length, completed, failed },
    updatedAt: Date.now(),
  });
}

/** Give up on whatever's left of a job that has been re-driven too many times. */
async function failRemaining(ref: DocumentReference, uid: string): Promise<void> {
  const snaps = (await tasksCol(uid, ref.id).get()).docs;
  const batch = db().batch();
  const now = Date.now();
  for (const d of snaps) {
    const t = d.data() as TaskDoc;
    if (!isTerminal(t.status)) {
      batch.update(d.ref, {
        status: "error",
        error: "Generation could not complete after multiple attempts.",
        updatedAt: now,
      });
    }
  }
  await batch.commit();
  await forceFinalize(ref, uid);
}

/**
 * Re-drive a stalled job: re-expand it if it never expanded, otherwise re-queue
 * every ready task and finalize the job if it's actually complete or deadlocked
 * (all remaining tasks blocked by a failed dependency). Bumps `updatedAt` first
 * so a job doesn't get re-picked every tick while its re-queued tasks run.
 */
async function resumeJob(ref: DocumentReference, uid: string, job: AnyJob): Promise<void> {
  const runCount = (job.runCount ?? 0) + 1;
  await ref.update({ runCount, updatedAt: Date.now() });

  if (runCount > MAX_JOB_RUNS) {
    await failRemaining(ref, uid);
    return;
  }

  if (!job.expanded) {
    await expandJob(ref, uid, job);
    return;
  }

  const all = (await tasksCol(uid, ref.id).get()).docs.map((d) => d.data() as TaskDoc);
  const nonTerminal = all.filter((t) => !isTerminal(t.status));
  if (nonTerminal.length === 0) {
    await forceFinalize(ref, uid);
    return;
  }

  const now = Date.now();
  const statusById = new Map(all.map((t) => [t.id, t.status]));
  const ready = nonTerminal.filter(
    (t) =>
      (!t.claimedUntil || t.claimedUntil < now) &&
      t.dependsOn.every((id) => statusById.get(id) === "done"),
  );

  if (ready.length > 0) {
    await enqueueTasks(uid, ref.id, ready.map((t) => t.id));
    return;
  }

  // Nothing ready: if every remaining task is blocked by a failed dependency the
  // job can never finish — mark them errored and finalize (no perpetual stall).
  const blocked = nonTerminal.filter((t) =>
    t.dependsOn.some((id) => statusById.get(id) === "error"),
  );
  if (blocked.length === nonTerminal.length) {
    const batch = db().batch();
    for (const t of blocked) {
      batch.update(tasksCol(uid, ref.id).doc(t.id), {
        status: "error",
        error: "Skipped: a dependency failed to generate.",
        updatedAt: now,
      });
    }
    await batch.commit();
    await forceFinalize(ref, uid);
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
