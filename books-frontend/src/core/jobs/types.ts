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
import type { ProviderErrorKind } from "../errors";
import type { ImageTier } from "../config/modelConfig";
import type { ResolvedModels } from "../models/registry";
import type { AnchorRender } from "../pipeline/anchorRun";
import type { IllustrationRender } from "../pipeline/illustrationRun";
import type {
  ImageRenderRecord,
  ModelSelection,
  PortraitInputs,
  Project,
  ReferenceUse,
  ScreenplayDoc,
} from "../types";
import type { ImageQuality } from "../config/modelCapabilities";
import type {
  ImageGenerationHints,
  ResolvedImageGenerationOptions,
} from "../config/imageGeneration";
import type { ReferenceImage } from "../providers/types";

export type JobStatus = "pending" | "running" | "done" | "error";

/** The generation pipelines a job/task can run. */
export type JobKind = "image" | "refresh" | "anchors" | "screenplay" | "portrait" | "book";

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
  /**
   * Server-written: the Spark estimate each task in this batch was checked
   * against at expand time. Recorded next to the eventual charge on the action
   * run, so a quote that systematically undershoots is visible instead of only
   * being felt by the user.
   *
   * @deprecated Superseded by {@link quotedByAction}; still read as a fallback
   * for jobs expanded before that existed.
   */
  quotedSparks?: number;
  /**
   * Server-written: the Spark estimate per SETTLING action, keyed by action id
   * and suffixed `:edit` for edit tasks. A batch is not uniform — the covers
   * inside a page batch settle as `coverIllustration` on a larger canvas, and an
   * edit spends one image call per subject — so one number per batch quoted
   * every book with a cover or an edit in it below what it always cost.
   */
  quotedByAction?: Record<string, number>;
  /**
   * A stored generation quote (`users/{uid}/generationQuotes/{id}`) this job was
   * confirmed against. When present, the quote's per-unit numbers are the
   * settlement cap instead of a fresh estimate, and the quote is consumed once.
   */
  quoteId?: string;
}

/** A reference image, addressed by its blob id in `users/{uid}/blobs/{id}`. */
export interface BlobRef {
  blobId: string;
  mimeType?: string;
  label?: string;
  role?: ReferenceImage["role"];
}

export interface ImageRenderRequest {
  provider: ProviderId;
  model: string;
  prompt: string;
  size?: string;
  quality?: ImageQuality;
  /** Surface-level preference; the worker intersects it with its resolved model. */
  generation?: ImageGenerationHints;
  references?: BlobRef[];
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
  /** Internal model tier stamped on this batch (server re-resolves the model). */
  tier?: ImageTier;
  createdAt: number;
  updatedAt: number;
  error?: string;
  tasks: JobTask[];
  progress: JobProgress;
}

/**
 * The JSON-serializable subset of `IllustrationRunOptions`. `region` is a spot the
 * reader marked on the picture (fractions of its width and height): the worker
 * turns it into an inpainting mask over the picture that is there, so only that
 * spot can change.
 */
export interface RefreshTaskOptions {
  useReference?: boolean;
  edit?: string;
  fromNodeId?: string;
  restyle?: boolean;
  inPlaceOnly?: boolean;
  /** The change is about how subjects sit together: redraw the page from every sheet on it, skipping the in-place paths. */
  wholePage?: boolean;
  region?: { x: number; y: number; w: number; h: number };
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
  options?: RefreshTaskOptions;
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
  /** Internal model tier stamped on this batch (server re-resolves the model). */
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
 * the worker. The worker resolves private dependencies/prompts from the project snapshot.
 */
export interface AnchorTask {
  id: string; // == anchorId
  status: JobStatus;
  error?: string;
  /** A subset of `AnchorRunOptions` that is JSON-serializable. */
  options?: RefreshTaskOptions;
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
  /** Internal model tier stamped on this batch (server re-resolves the model). */
  tier?: ImageTier;
  createdAt: number;
  updatedAt: number;
  error?: string;
  project: Project;
  models: ResolvedModels;
  tasks: AnchorTask[];
  progress: JobProgress;
}

/** The single durable task used to draft a book's initial screenplay. */
export interface ScreenplayTask {
  id: "screenplay";
  status: JobStatus;
  error?: string;
  result?: ScreenplayDoc;
  stats?: TaskStats;
}

/**
 * A resumable initial-screenplay job. The text-only project snapshot contains
 * the story config and analyzed cast; the finished document is reconciled into
 * the client's version tree just like image task results.
 */
export interface ScreenplayJob extends JobLease {
  kind: "screenplay";
  status: JobStatus;
  projectId?: string;
  /** Text jobs do not use image quality tiers. */
  tier?: undefined;
  createdAt: number;
  updatedAt: number;
  error?: string;
  project: Project;
  tasks: ScreenplayTask[];
  progress: JobProgress;
}

/**
 * One Chat-studio portrait. The id is the story cast member's id, and `inputs`
 * pins the person, their likeness source and the saved style the portrait was
 * quoted for, so a result drawn from an older version of any of them is dropped.
 */
/**
 * A change to a portrait that is already drawn: the picture to change and what
 * to change in it. The worker sends that picture and only the change, so the
 * person stays the same. Absent means a portrait drawn from scratch.
 */
export interface PortraitEdit {
  instruction: string;
  /** The portrait being changed, as the book held it when this started. */
  blobId: string;
  mimeType: string;
}

export interface PortraitTask {
  id: string;
  status: JobStatus;
  error?: string;
  inputs: PortraitInputs;
  edit?: PortraitEdit;
  result?: {
    blobId: string;
    mimeType: string;
    imageTier?: ImageTier;
    imageModel?: ModelSelection;
    render?: ImageRenderRecord;
  };
  stats?: TaskStats;
}

/**
 * A scoped portrait batch. Its only authorization is the stored quote it names:
 * the worker charges each portrait at most what that quote said, and refuses a
 * quote that is expired, already consumed, or names different people.
 */
export interface PortraitJob extends JobLease {
  kind: "portrait";
  status: JobStatus;
  projectId?: string;
  tier?: ImageTier;
  createdAt: number;
  updatedAt: number;
  error?: string;
  project: Project;
  tasks: PortraitTask[];
  progress: JobProgress;
}

/**
 * One unit of Draw the book: a reference sheet (`anchors`) or a page/cover
 * (`refresh`). The task doc carries this kind, so the studio folds a book
 * job's results in exactly like a sheet or page job's.
 */
export type BookTask = (AnchorTask & { kind: "anchors" }) | (RefreshTask & { kind: "refresh" });

/**
 * The whole book as one server-run job: every stale sheet, then every page and
 * cover that draws the people on it. Pages depend on their sheets inside the
 * job, so nothing waits on the studio tab being open.
 */
export interface BookJob extends JobLease {
  kind: "book";
  status: JobStatus;
  projectId?: string;
  tier?: ImageTier;
  createdAt: number;
  updatedAt: number;
  error?: string;
  project: Project;
  models: ResolvedModels;
  tasks: BookTask[];
  progress: JobProgress;
  /** Send the "your book is ready" email when the job finishes. */
  notify?: boolean;
  /** Server-written when the finish email was queued. */
  notifiedAt?: number;
}

/**
 * Settings frozen when a job starts, so an admin change mid-run can't draw half
 * a book one way and half another.
 */
export interface JobFrozenSettings {
  generationTuning?: unknown;
}

/** Any job document stored under `users/{uid}/jobs/{id}`. */
export type AnyJob = (
  | GenerationJob
  | PipelineRefreshJob
  | AnchorsJob
  | ScreenplayJob
  | PortraitJob
  | BookJob
) & {
  /**
   * Server-written: failed tasks already given their one free second pass.
   * Kept so a job started before `recoveryPasses` still counts that wave.
   */
  secondPass?: boolean;
  /**
   * How many free recovery waves this job has already taken after the first
   * attempt. A book may take more than one; the bound lives with the worker.
   */
  recoveryPasses?: number;
  /**
   * Set while a recovery wave is being queued, so a second task finishing in
   * the same moment cannot start another wave or close the job early.
   */
  recovering?: boolean;
  /** Server-written: finished-task count at the reaper's last re-drive. */
  reapMark?: number;
  /**
   * Server-written at expansion: the latest moment this job may still be
   * running. Past it, a job that has stopped making progress is closed with
   * whatever it has, so a book can never sit "drawing" without end.
   */
  deadlineAt?: number;
  frozen?: JobFrozenSettings;
};

/** Kind-specific render output stored on a finished {@link TaskDoc}. */
export type TaskResult =
  | {
      blobId: string;
      mimeType: string;
      /** Quality tier + model stamped by the worker (optional on legacy results). */
      imageTier?: ImageTier;
      imageModel?: ModelSelection;
      generation?: ResolvedImageGenerationOptions;
      render?: ImageRenderRecord;
    } // image / portrait
  | IllustrationRender // refresh
  | AnchorRender // anchors
  | ScreenplayDoc; // screenplay

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
  options?: RefreshTaskOptions;
  /** image-kind provenance, stamped onto the version on reconcile. */
  referenceUses?: ReferenceUse[];
  /** portrait-kind payload: what the portrait was quoted for. */
  inputs?: PortraitInputs;
  /** portrait-kind payload: a change to the drawn portrait rather than a new one. */
  edit?: PortraitEdit;
  /** The job's `quotedByAction` entry this task settles against (action, edit, reference group). */
  quoteKey?: string;
  /** kind-specific render output (present when `status === "done"`). */
  result?: TaskResult;
  /**
   * Set on tasks created by the durable-receipt reconciliation protocol.
   * Missing on legacy tasks, whose absent results must not be resurrected.
   */
  reconciliationVersion?: 1;
  /**
   * Client-written receipt after the result is durably folded into the project.
   * Prevents historical completed tasks from recreating versions the user later
   * deletes or that version-history pruning removes.
   */
  appliedAt?: number;
  error?: string;
  /**
   * The provider failure class behind `error`, when there was one. Lets the
   * studio describe a job failure with the same wording as a synchronous one
   * ("the AI service took too long") instead of relaying a raw provider string.
   */
  errorKind?: ProviderErrorKind;
  stats?: TaskStats;
  /** Epoch ms a worker holds this task; guards duplicate at-least-once dispatch. */
  claimedUntil?: number;
  /**
   * Cloud Tasks task name that acquired the lease. This is diagnostic only:
   * retries share the same name, so ownership is fenced by `claimToken`.
   */
  claimedBy?: string | null;
  /**
   * Unique per worker invocation. Every release/terminal write must match it,
   * preventing an overlapping retry from overwriting a result after losing the
   * lease.
   */
  claimToken?: string | null;
  /**
   * Server-written: how many times a worker has claimed this task in the
   * current wave. Lives on the task, not on the queue message, because the
   * reaper's re-enqueue starts a new queue message with a fresh retry count.
   */
  attempts?: number;
  /** Server-written: when the current wave first claimed this task. */
  firstClaimedAt?: number;
  /** Server-written: last time the owning worker proved it was alive. */
  heartbeatAt?: number;
  /**
   * Server-written: provider spend (USD) and image calls of attempts that
   * produced nothing. Carried into the price window when the task delivers, so
   * the cost of a retry is paid for by the average instead of disappearing.
   */
  wasteUsd?: number;
  wasteImageCalls?: number;
  /** Server-written: the unit's wasted spend was banked for its next delivered render. */
  wasteCarried?: boolean;
  /** Server-written: what the last attempt that was handed back to the queue died of. */
  lastError?: string;
  lastErrorKind?: ProviderErrorKind;
  updatedAt: number;
}

/** A task document paired with… itself (id is already a field). */
export type TaskWithId = TaskDoc;
