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
import type { ResolvedModels } from "../models/registry";
import type { AnchorRender } from "../pipeline/anchorRun";
import type { IllustrationRender } from "../pipeline/illustrationRun";
import type { Project } from "../types";

export type JobStatus = "pending" | "running" | "done" | "error";

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
  result?: { blobId: string; mimeType: string };
}

export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
}

export interface GenerationJob {
  kind: "image";
  status: JobStatus;
  /** The project these tasks belong to (for client-side reconciliation). */
  projectId?: string;
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
}

/**
 * A job that runs the full illustration pipeline server-side (e.g. bulk refresh
 * of stale pages). Carries a project snapshot + resolved models so the worker
 * can reproduce exactly what the client would compute; results are folded into
 * the version trees by the client during reconciliation (single writer).
 */
export interface PipelineRefreshJob {
  kind: "refresh";
  status: JobStatus;
  projectId?: string;
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
}

/**
 * A job that renders anchor reference images server-side, honoring the anchor
 * dependency graph (a contained anchor is rendered before the one referencing
 * it). Carries a project snapshot + resolved models; results are folded into
 * each anchor's version tree by the client on reconcile.
 */
export interface AnchorsJob {
  kind: "anchors";
  status: JobStatus;
  projectId?: string;
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
