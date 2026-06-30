/**
 * Tracks the current project's generation jobs.
 *
 * Generation runs server-side (the Firestore-triggered worker), so a batch can
 * finish while the studio is closed. This store does two things whenever a
 * project is open:
 *   1. Surfaces live progress for in-flight jobs (the TopBar indicator).
 *   2. Reconciles completed results into the project's version trees, so work
 *      that finished while away appears the moment the studio reopens.
 *
 * Reconciliation is idempotent: a result is only applied if its blob isn't
 * already present in the spread's illustration tree, so repeated snapshots (or
 * reopening twice) never duplicate versions.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import { applyAnchorRender } from "../core/pipeline/anchorRun";
import { applyIllustrationRender } from "../core/pipeline/illustrationRun";
import type { Project, ScreenplaySpread } from "../core/types";
import { allVersions } from "../core/versioning";
import { subscribeProjectJobs, type JobWithId } from "../platform/jobs";
import { applyIllustrationResult } from "./ai";
import { spreadsById } from "./bookUnits";
import { useProjectsStore } from "./projectsStore";

/** A compact view of an in-flight job for the progress UI. */
export interface JobSummary {
  id: string;
  status: JobWithId["status"];
  total: number;
  completed: number;
  failed: number;
}

interface JobsState {
  /** Jobs that are still pending or running for the open project. */
  active: JobSummary[];
  projectId: string | null;
  unsub: Unsubscribe | null;
  /** Begin tracking jobs for a project (idempotent for the same id). */
  watch: (projectId: string) => void;
  /** Stop tracking and clear state. */
  stop: () => void;
}

// Results currently being written. Snapshots can arrive faster than a write
// persists, so this guards against applying the same task twice in flight.
const inFlight = new Set<string>();

/** True if the spread's tree already contains a version backed by `blobId`. */
function hasBlob(project: Project, spreadId: string, blobId: string): boolean {
  const tree = project.illustrations?.[spreadId];
  return Boolean(tree && allVersions(tree).some((n) => n.content.blobId === blobId));
}

/** True if the anchor's tree already contains a version backed by `blobId`. */
function anchorHasBlob(project: Project, anchorId: string, blobId: string): boolean {
  const tree = project.anchors?.find((a) => a.id === anchorId)?.versions;
  return Boolean(tree && allVersions(tree).some((n) => n.content.blobId === blobId));
}

/**
 * Resolve the live project for `projectId`, guarding against the user switching
 * projects mid-reconcile. Returns null when it no longer matches.
 */
function liveProject(projectId: string): Project | null {
  const project = useProjectsStore.getState().current();
  return project && project.id === projectId ? project : null;
}

/**
 * Apply one completed task's blob into the project, idempotently and guarded
 * against concurrent in-flight writes. `apply` does the kind-specific folding.
 */
async function applyTask(
  jobId: string,
  taskId: string,
  blobId: string,
  projectId: string,
  apply: (project: Project, spread: ScreenplaySpread) => Promise<void>,
): Promise<boolean> {
  const key = `${jobId}:${taskId}`;
  if (inFlight.has(key)) return true;

  const project = liveProject(projectId);
  if (!project) return false; // project switched away — stop reconciling
  const spread = spreadsById(project).get(taskId);
  if (!spread || hasBlob(project, taskId, blobId)) return true;

  inFlight.add(key);
  try {
    await apply(project, spread);
  } finally {
    inFlight.delete(key);
  }
  return true;
}

/** Apply any done-but-unapplied results from a job into the project. */
async function reconcile(job: JobWithId, projectId: string): Promise<void> {
  if (job.kind === "anchors") {
    for (const task of job.tasks) {
      if (task.status !== "done" || !task.result) continue;
      const render = task.result;
      const key = `${job.id}:${task.id}`;
      if (inFlight.has(key)) continue;

      const project = liveProject(projectId);
      if (!project) return;
      const anchor = project.anchors?.find((a) => a.id === task.id);
      if (!anchor || anchorHasBlob(project, task.id, render.blobId)) continue;

      inFlight.add(key);
      try {
        const versions = applyAnchorRender(anchor.versions, render);
        await useProjectsStore.getState().updateAnchor(task.id, { versions });
      } finally {
        inFlight.delete(key);
      }
    }
    return;
  }

  if (job.kind === "refresh") {
    for (const task of job.tasks) {
      if (task.status !== "done" || !task.result) continue;
      const render = task.result;
      const keep = await applyTask(job.id, task.id, render.blobId, projectId, async (project, spread) => {
        // The worker produced a full render (provenance + label + parent); fold
        // it into the live tree as the project owner (single writer).
        const tree = applyIllustrationRender(project.illustrations?.[spread.id], render);
        await useProjectsStore.getState().setIllustration(spread.id, tree);
      });
      if (!keep) return;
    }
    return;
  }

  for (const task of job.tasks) {
    if (task.status !== "done" || !task.result) continue;
    const result = task.result;
    const prompt = task.request.prompt;
    const keep = await applyTask(job.id, task.id, result.blobId, projectId, async (project, spread) => {
      await applyIllustrationResult(project, spread, result, prompt);
    });
    if (!keep) return;
  }
}

export const useJobsStore = create<JobsState>((set, get) => ({
  active: [],
  projectId: null,
  unsub: null,

  watch(projectId) {
    if (get().projectId === projectId && get().unsub) return;
    get().unsub?.();

    const unsub = subscribeProjectJobs(projectId, (jobs) => {
      // Newest first for the indicator.
      const active = jobs
        .filter((j) => j.status === "pending" || j.status === "running")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map<JobSummary>((j) => ({
          id: j.id,
          status: j.status,
          total: j.progress.total,
          completed: j.progress.completed,
          failed: j.progress.failed,
        }));
      set({ active });

      // Bring any finished results into the project. Live generation paths
      // already apply their own results, but this also covers jobs that
      // completed while the studio was closed.
      for (const job of jobs) {
        if (job.tasks.some((t) => t.status === "done")) {
          void reconcile(job, projectId);
        }
      }
    });

    set({ projectId, unsub });
  },

  stop() {
    get().unsub?.();
    set({ active: [], projectId: null, unsub: null });
  },
}));
