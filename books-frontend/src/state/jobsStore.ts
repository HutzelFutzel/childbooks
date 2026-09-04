/**
 * Tracks the current project's generation jobs.
 *
 * Generation runs server-side (the Cloud Tasks fan-out), so a batch can finish
 * while the studio is closed. This store does two things whenever a project is
 * open:
 *   1. Surfaces live progress for in-flight jobs (the TopBar indicator), read
 *      from each job doc's aggregate `progress`.
 *   2. Reconciles completed results into the project's version trees, read from
 *      the per-task subcollection (via a project-scoped collection-group query),
 *      so work that finished while away appears the moment the studio reopens.
 *
 * Reconciliation is idempotent: a result is only applied if its blob isn't
 * already present in the unit's version tree, so repeated snapshots (or reopening
 * twice) never duplicate versions.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import { normalizeImageTier, type ImageTier } from "../core/config/modelConfig";
import { applyAnchorRender, type AnchorRender } from "../core/pipeline/anchorRun";
import { applyIllustrationRender, type IllustrationRender } from "../core/pipeline/illustrationRun";
import type { TaskDoc } from "../core/jobs/types";
import type { Project, ScreenplayDoc, ScreenplaySpread } from "../core/types";
import { allVersions, createVersionTree } from "../core/versioning";
import {
  createScreenplayJob,
  fetchJobTasks,
  subscribeProjectJobs,
  subscribeProjectTasks,
  type JobWithId,
} from "../platform/jobs";
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
  /** When the client enqueued the job (drives the elapsed timer). */
  createdAt: number;
  /** Quality tier + image action, for the time-estimate lookup. */
  tier: ImageTier;
  action: "anchorImage" | "pageIllustration";
}

export interface ScreenplayJobSummary {
  id: string;
  status: JobWithId["status"];
  createdAt: number;
  error?: string;
}

interface JobsState {
  /** Jobs that are still pending or running for the open project. */
  active: JobSummary[];
  /**
   * Ids of units (spread/cover/anchor ids == task ids) currently being generated
   * by a non-terminal job. Lets the UI show a per-item "working" state driven by
   * real job state (survives refresh, no blocking await), and clears itself when
   * the job finishes and its result reconciles.
   */
  activeUnitIds: Set<string>;
  /** Latest durable screenplay attempt for the open project. */
  screenplayJob: ScreenplayJobSummary | null;
  /** True after the initial project-jobs snapshot has arrived. */
  jobsLoaded: boolean;
  projectId: string | null;
  unsub: Unsubscribe | null;
  /** Begin tracking jobs for a project (idempotent for the same id). */
  watch: (projectId: string) => void;
  /** Enqueue the initial screenplay, or a fresh attempt after an error. */
  startScreenplay: (project: Project, retry?: boolean) => Promise<void>;
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

/**
 * Fold any done-but-unapplied task results into the project. Each task doc is
 * self-describing (carries its `kind` + payload), so reconciliation works off
 * the task subcollection alone — no job doc needed.
 */
async function reconcileTasks(tasks: TaskDoc[], projectId: string): Promise<void> {
  for (const task of tasks) {
    if (task.status !== "done" || !task.result) continue;

    if (task.kind === "screenplay") {
      const key = `${task.jobId}:${task.id}`;
      if (inFlight.has(key)) continue;

      const project = liveProject(projectId);
      if (!project) return;
      // Initial screenplay attempts are idempotent: if two tabs managed to
      // finish, the first reconciled document wins instead of creating an
      // unexplained revision.
      if (project.screenplay) continue;

      inFlight.add(key);
      try {
        const versions = createVersionTree(task.result as ScreenplayDoc, { label: "Initial" });
        await useProjectsStore.getState().setScreenplay(versions);
      } finally {
        inFlight.delete(key);
      }
      continue;
    }

    if (task.kind === "anchors") {
      const render = task.result as AnchorRender;
      const key = `${task.jobId}:${task.id}`;
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
      continue;
    }

    if (task.kind === "refresh") {
      const render = task.result as IllustrationRender;
      const keep = await applyTask(task.jobId, task.id, render.blobId, projectId, async (project, spread) => {
        // The worker produced a full render (provenance + label + parent); fold
        // it into the live tree as the project owner (single writer).
        const tree = applyIllustrationRender(project.illustrations?.[spread.id], render);
        await useProjectsStore.getState().setIllustration(spread.id, tree);
      });
      if (!keep) return;
      continue;
    }

    // image
    const result = task.result as { blobId: string; mimeType: string };
    const prompt = task.request?.prompt ?? "";
    const referenceUses = task.referenceUses;
    const keep = await applyTask(task.jobId, task.id, result.blobId, projectId, async (project, spread) => {
      await applyIllustrationResult(project, spread, result, prompt, referenceUses);
    });
    if (!keep) return;
  }
}

/**
 * Immediately fold a set of finished task docs into the project (same idempotent
 * path the snapshot subscription uses). Lets orchestration code that awaits a
 * job's completion continue synchronously with the reconciled state instead of
 * racing the store's own snapshot-driven reconcile.
 */
export async function reconcileTasksNow(tasks: TaskDoc[], projectId: string): Promise<void> {
  await reconcileTasks(tasks, projectId);
}

export const useJobsStore = create<JobsState>((set, get) => ({
  active: [],
  activeUnitIds: new Set<string>(),
  screenplayJob: null,
  jobsLoaded: false,
  projectId: null,
  unsub: null,

  watch(projectId) {
    if (get().projectId === projectId && get().unsub) return;
    get().unsub?.();
    set({
      active: [],
      activeUnitIds: new Set<string>(),
      screenplayJob: null,
      jobsLoaded: false,
      projectId,
      unsub: null,
    });

    // Job docs drive the aggregate progress indicator.
    const unsubJobs = subscribeProjectJobs(projectId, (jobs) => {
      const active = jobs
        .filter(
          (j) =>
            j.kind !== "screenplay" &&
            (j.status === "pending" || j.status === "running"),
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .map<JobSummary>((j) => ({
          id: j.id,
          status: j.status,
          total: j.progress.total,
          completed: j.progress.completed,
          failed: j.progress.failed,
          createdAt: j.createdAt,
          tier: normalizeImageTier(j.tier),
          action: j.kind === "anchors" ? "anchorImage" : "pageIllustration",
        }));
      const latestScreenplay = jobs
        .filter((j) => j.kind === "screenplay")
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      set((state) => ({
        active,
        jobsLoaded: true,
        screenplayJob: latestScreenplay
          ? {
              id: latestScreenplay.id,
              status: latestScreenplay.status,
              createdAt: latestScreenplay.createdAt,
              error:
                latestScreenplay.error ??
                (state.screenplayJob?.id === latestScreenplay.id
                  ? state.screenplayJob.error
                  : undefined),
            }
          : state.screenplayJob?.id.startsWith("starting-")
            ? state.screenplayJob
            : null,
      }));
      if (
        latestScreenplay &&
        (latestScreenplay.status === "done" || latestScreenplay.status === "error")
      ) {
        // Do not depend solely on the collection-group listener: fetch this
        // terminal job directly so a missing index/dropped listener cannot
        // leave the screenplay spinner frozen after backend completion.
        void fetchJobTasks(latestScreenplay.id)
          .then((tasks) => {
            const failed = tasks.find(
              (task) => task.kind === "screenplay" && task.status === "error",
            );
            if (failed) {
              set((state) => ({
                screenplayJob:
                  state.screenplayJob?.id === latestScreenplay.id
                    ? { ...state.screenplayJob, status: "error", error: failed.error }
                    : state.screenplayJob,
              }));
            }
            if (tasks.some((task) => task.kind === "screenplay" && task.status === "done")) {
              return reconcileTasks(tasks, projectId);
            }
          })
          .catch((err) => {
            console.error("[jobs] screenplay reconciliation failed.", err);
          });
      }
    });

    // Task docs drive per-unit "updating" state and result reconciliation. Live
    // generation paths also apply their own results; this covers tasks that
    // finished while the studio was closed (idempotent either way).
    const unsubTasks = subscribeProjectTasks(projectId, (tasks) => {
      const activeUnitIds = new Set<string>();
      for (const t of tasks) {
        if (
          t.kind !== "screenplay" &&
          t.status !== "done" &&
          t.status !== "error"
        ) {
          activeUnitIds.add(t.id);
        }
      }
      const failedScreenplay = tasks
        .filter((t) => t.kind === "screenplay" && t.status === "error")
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      set((state) => ({
        activeUnitIds,
        screenplayJob:
          failedScreenplay && state.screenplayJob?.id === failedScreenplay.jobId
            ? { ...state.screenplayJob, status: "error", error: failedScreenplay.error }
            : state.screenplayJob,
      }));
      if (tasks.some((t) => t.status === "done")) void reconcileTasks(tasks, projectId);
    });

    const unsub = () => {
      unsubJobs();
      unsubTasks();
    };
    set({ unsub });
  },

  async startScreenplay(project, retry = false) {
    const current = get().screenplayJob;
    if (current?.status === "pending" || current?.status === "running") return;
    if (!retry && current) return;

    const optimisticId = `starting-${Date.now()}`;
    set({
      screenplayJob: {
        id: optimisticId,
        status: "pending",
        createdAt: Date.now(),
      },
    });
    try {
      const id = await createScreenplayJob(project, { retry });
      set((state) => ({
        screenplayJob:
          state.screenplayJob?.id === optimisticId
            ? { id, status: "pending", createdAt: Date.now() }
            : state.screenplayJob,
      }));
    } catch (err) {
      const message = (err as Error)?.message ?? "The page-by-page draft could not start.";
      set((state) => ({
        screenplayJob:
          state.screenplayJob?.id === optimisticId
            ? { id: optimisticId, status: "error", createdAt: Date.now(), error: message }
            : state.screenplayJob,
      }));
      throw err;
    }
  },

  stop() {
    get().unsub?.();
    set({
      active: [],
      activeUnitIds: new Set<string>(),
      screenplayJob: null,
      jobsLoaded: false,
      projectId: null,
      unsub: null,
    });
  },
}));
