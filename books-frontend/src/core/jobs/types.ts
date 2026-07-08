/**
 * Generation job model (shared by the client that enqueues and the backend
 * worker that runs them). A job is a batch of independent image-render tasks.
 *
 * The client pre-assembles each task's request (prompt + references as blob ids
 * in the user's own Storage), so the heavy prompt/reference assembly and the
 * version-tree bookkeeping stay client-side; the worker just renders and stores
 * the result, reporting progress on the job document.
 */
import type { ProviderId } from "../config/options";
import type { ImageTier } from "../config/modelConfig";
import type { ResolvedModels } from "../models/registry";
import type { AnchorRender } from "../pipeline/anchorRun";
import type { IllustrationRender } from "../pipeline/illustrationRun";
import type { Project, ReferenceUse } from "../types";

export type JobStatus = "pending" | "running" | "done" | "error";

/** The three generation pipelines a job/task can run. */
export type JobKind = "image" | "refresh" | "anchors";

/**
 * Legacy time-estimate constant. With the Cloud Tasks fan-out each task runs on
 * its own instance, so per-job wave scheduling no longer bounds throughput —
 * fleet-wide concurrency is governed by the queue's `maxConcurrentDispatches`.
 * Kept as the client's estimate divisor for a typical in-flight width.
 */
export const JOB_TASK_CONCURRENCY = 3;

/**
 * Lease/resume bookkeeping shared by every job kind. A per-book batch can't
 * always finish inside one Cloud Function invocation (540s / 1 GiB), so the
 * worker processes tasks under a time-bounded LEASE that it heartbeats while
 * alive. If it dies (timeout/OOM) the lease expires and a scheduled reaper
 * resumes the remaining tasks; `runCount` bounds how many times a job may be
 * (re)started so a poison task can't loop forever. Written by the backend;
 * the client only seeds `leaseExpiresAt: 0` on create so a job whose trigger
 * never fired is still eligible for the reaper.
 */
export interface JobLease {
  /**
   * Epoch ms until which the current worker owns the job. `0` (unclaimed) or a
   * past value means it can be claimed; a terminal job is parked far in the
   * future so the reaper never re-picks it.
   */
  leaseExpiresAt?: number;
  /** How many times this job has been started (create trigger + each resume). */
  runCount?: number;
  /**
   * Set once the enqueuer has expanded the job's `tasks` spec into the per-task
   * subcollection and dispatched its root tasks. Lets the reaper tell "never
   * started" (re-expand) from "started, some tasks left" (re-enqueue ready).
   */
  expanded?: boolean;
}

/** A reference image, addressed by its blob id in `users/{uid}/blobs/{id}`. */
export interface BlobRef {
  blobId: string;
  mimeType?: string;
  label?: string;
  role?: "subject" | "composition" | "relation";
}

export interface ImageRenderRequest {
  provider: ProviderId;
  model: string;
  prompt: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
  references?: BlobRef[];
  /**
   * Art-style preset whose example image should be prepended as a leading
   * "style" reference at render time (resolved server-side from the art-styles
   * config, so the huge exemplar isn't embedded in every task).
   */
  stylePresetId?: string;
  /** Optional inpainting mask, stored as a blob (transparent = region to change). */
  maskBlobId?: string;
  /**
   * Optional post-composite: paste the model output back over `originalBlobId`
   * only inside `maskBlobId`, so every pixel outside the mask stays identical.
   */
  composite?: { originalBlobId: string; maskBlobId: string };
}

export interface JobTask {
  id: string;
  status: JobStatus;
  error?: string;
  request: ImageRenderRequest;
  /**
   * Provenance captured when the task was BUILT (anchor versions/signatures the
   * prompt + references reflect). Reconciliation stamps these instead of the
   * live project state, so edits made while the job ran still flag the page.
   */
  referenceUses?: ReferenceUse[];
  result?: { blobId: string; mimeType: string };
  /** Render diagnostics: wall time + provider call/failure counts (makes silent retries visible). */
  stats?: TaskStats;
}

/** Diagnostics recorded on a finished task. */
export interface TaskStats {
  /** Wall-clock render duration (ms). */
  ms: number;
  /** Provider HTTP attempts made (retries included). */
  calls: number;
  /** Attempts that failed (non-2xx / network error / timeout). */
  failures: number;
}

export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
}

export interface GenerationJob extends JobLease {
  kind: "image";
  status: JobStatus;
  /** The project these tasks belong to (for client-side reconciliation). */
  projectId?: string;
  /** User-chosen quality tier for this batch (server re-resolves the model). */
  tier?: ImageTier;
  createdAt: number;
  updatedAt: number;
  error?: string;
  tasks: JobTask[];
  progress: JobProgress;
}

/**
 * A refresh task names a spread to (re)render through the full illustration
 * pipeline on the worker. The worker resolves prompts/references from the
 * project snapshot, so the client doesn't pre-assemble anything.
 */
export interface RefreshTask {
  id: string; // == spreadId / unit id
  status: JobStatus;
  error?: string;
  /** A subset of `IllustrationRunOptions` that is JSON-serializable. */
  options?: { useReference?: boolean; edit?: string; fromNodeId?: string };
  /** Render output for the client to fold into the version tree. */
  result?: IllustrationRender;
  stats?: TaskStats;
}

/**
 * A job that runs the full illustration pipeline server-side (e.g. bulk refresh
 * of stale pages). Carries a project snapshot + resolved models so the worker
 * can reproduce exactly what the client would compute; results are folded into
 * the version trees by the client during reconciliation (single writer).
 */
export interface PipelineRefreshJob extends JobLease {
  kind: "refresh";
  status: JobStatus;
  projectId?: string;
  /** User-chosen quality tier for this batch (server re-resolves the model). */
  tier?: ImageTier;
  createdAt: number;
  updatedAt: number;
  error?: string;
  /** Snapshot of the project the worker renders against. */
  project: Project;
  /** Auto-resolved models (the client never asks the user to pick). */
  models: ResolvedModels;
  tasks: RefreshTask[];
  progress: JobProgress;
}

/**
 * An anchor task names an anchor to (re)render through the anchor pipeline on
 * the worker. The worker resolves relations/prompts from the project snapshot.
 */
export interface AnchorTask {
  id: string; // == anchorId
  status: JobStatus;
  error?: string;
  /** A subset of `AnchorRunOptions` that is JSON-serializable. */
  options?: { useReference?: boolean; edit?: string; fromNodeId?: string };
  result?: AnchorRender;
  stats?: TaskStats;
}

/**
 * A job that renders anchor reference images server-side, honoring the anchor
 * dependency graph (a contained anchor is rendered before the one referencing
 * it). Carries a project snapshot + resolved models; results are folded into
 * each anchor's version tree by the client on reconcile.
 */
export interface AnchorsJob extends JobLease {
  kind: "anchors";
  status: JobStatus;
  projectId?: string;
  /** User-chosen quality tier for this batch (server re-resolves the model). */
  tier?: ImageTier;
  createdAt: number;
  updatedAt: number;
  error?: string;
  project: Project;
  models: ResolvedModels;
  tasks: AnchorTask[];
  progress: JobProgress;
}

/** Any job document stored under `users/{uid}/jobs/{id}`. */
export type AnyJob = GenerationJob | PipelineRefreshJob | AnchorsJob;

/** Kind-specific render output stored on a finished {@link TaskDoc}. */
export type TaskResult =
  | { blobId: string; mimeType: string } // image
  | IllustrationRender // refresh
  | AnchorRender; // anchors

/**
 * A single unit of work in the Cloud Tasks fan-out, stored at
 * `users/{uid}/jobs/{jobId}/tasks/{taskId}`. Each task is dispatched as its own
 * Cloud Task and rendered by an independent worker instance, so concurrent
 * workers write DIFFERENT task docs (no contention) while the parent job doc
 * only tracks aggregate progress.
 *
 * `dependsOn` makes the fan-out a generic task graph: a task becomes eligible to
 * run only once every id it lists is `done`. Pages/covers ship with `[]` today
 * (fully parallel); anchors carry their contained-anchor ids (children first).
 * A future feature can introduce page/cover dependencies purely by populating
 * this field — the dispatch engine needs no changes.
 */
export interface TaskDoc {
  /** == the unit id (spread id / cover id / anchor id). */
  id: string;
  jobId: string;
  /** Owner uid, denormalized so the client can collection-group query safely. */
  uid: string;
  /** Denormalized for the client's per-project task subscription. */
  projectId?: string;
  kind: JobKind;
  status: JobStatus;
  /** Task ids that must be `done` before this one may run ([] = ready at once). */
  dependsOn: string[];
  /** image-kind payload (pre-assembled request). */
  request?: ImageRenderRequest;
  /** refresh/anchor-kind payload (pipeline options). */
  options?: { useReference?: boolean; edit?: string; fromNodeId?: string };
  /** image-kind provenance, stamped onto the version on reconcile. */
  referenceUses?: ReferenceUse[];
  /** kind-specific render output (present when `status === "done"`). */
  result?: TaskResult;
  error?: string;
  stats?: TaskStats;
  /** Epoch ms a worker holds this task; guards duplicate at-least-once dispatch. */
  claimedUntil?: number;
  updatedAt: number;
}

/** A task document paired with… itself (id is already a field). */
export type TaskWithId = TaskDoc;
