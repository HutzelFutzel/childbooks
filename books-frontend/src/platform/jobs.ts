/**
 * Client access to the generation job queue.
 *
 * A job is a Firestore document under `users/{uid}/jobs/{jobId}` holding a batch
 * of image-render tasks. Writing it triggers the backend worker
 * (`onGenerationJob`); the client subscribes to watch live progress and reads
 * each task's result blob id when it completes.
 */
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import type { ResolvedModels } from "../core/models/registry";
import type {
  AnchorsJob,
  AnchorTask,
  AnyJob,
  GenerationJob,
  JobTask,
  PipelineRefreshJob,
  RefreshTask,
} from "../core/jobs/types";
import type { Project } from "../core/types";

/** A job document paired with its Firestore id. */
export type JobWithId = AnyJob & { id: string };

function uid(): string {
  const u = getFirebaseAuth().currentUser?.uid;
  if (!u) throw new Error("You must be signed in to start a generation job.");
  return u;
}

/** Create an image-render job and return its id. */
export async function createImageJob(
  projectId: string,
  tasks: JobTask[],
): Promise<string> {
  const now = Date.now();
  const job: GenerationJob = {
    kind: "image",
    status: "pending",
    projectId,
    createdAt: now,
    updatedAt: now,
    tasks,
    progress: { total: tasks.length, completed: 0, failed: 0 },
  };
  const ref = await addDoc(collection(getFirebaseDb(), `users/${uid()}/jobs`), job);
  return ref.id;
}

/**
 * Create a server-side pipeline-refresh job: the worker re-renders each named
 * spread through the full illustration pipeline (using the project snapshot +
 * resolved models), and the client folds the results back in on reconcile.
 */
export async function createRefreshJob(
  project: Project,
  models: ResolvedModels,
  tasks: RefreshTask[],
): Promise<string> {
  const now = Date.now();
  const job: PipelineRefreshJob = {
    kind: "refresh",
    status: "pending",
    projectId: project.id,
    createdAt: now,
    updatedAt: now,
    project,
    models,
    tasks,
    progress: { total: tasks.length, completed: 0, failed: 0 },
  };
  const ref = await addDoc(collection(getFirebaseDb(), `users/${uid()}/jobs`), job);
  return ref.id;
}

/**
 * Create an anchors job: the worker renders each named anchor's reference image
 * through the full anchor pipeline (honoring the dependency graph), and the
 * client folds the results into the anchors' version trees on reconcile.
 */
export async function createAnchorsJob(
  project: Project,
  models: ResolvedModels,
  tasks: AnchorTask[],
): Promise<string> {
  const now = Date.now();
  const job: AnchorsJob = {
    kind: "anchors",
    status: "pending",
    projectId: project.id,
    createdAt: now,
    updatedAt: now,
    project,
    models,
    tasks,
    progress: { total: tasks.length, completed: 0, failed: 0 },
  };
  const ref = await addDoc(collection(getFirebaseDb(), `users/${uid()}/jobs`), job);
  return ref.id;
}

/** Subscribe to a job document; the callback fires on every change. */
export function subscribeJob(jobId: string, cb: (job: AnyJob | null) => void): Unsubscribe {
  return onSnapshot(doc(getFirebaseDb(), `users/${uid()}/jobs`, jobId), (snap) => {
    cb(snap.exists() ? (snap.data() as AnyJob) : null);
  });
}

/**
 * Subscribe to every job belonging to a project. Used to surface live progress
 * and to reconcile results that completed while the studio was closed.
 */
export function subscribeProjectJobs(
  projectId: string,
  cb: (jobs: JobWithId[]) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), `users/${uid()}/jobs`),
    where("projectId", "==", projectId),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as GenerationJob) })));
  });
}
