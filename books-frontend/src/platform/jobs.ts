/**
 * Client access to the generation job queue.
 *
 * A job is a Firestore document under `users/{uid}/jobs/{jobId}` holding a batch
 * of task SPECS. Writing it triggers the backend enqueuer (`onGenerationJob`),
 * which expands the specs into a per-task subcollection
 * (`users/{uid}/jobs/{jobId}/tasks/{taskId}`) and fans them out over Cloud
 * Tasks. The client watches the job doc for aggregate progress and the task
 * subcollection for per-unit status + results (folded into the version trees on
 * reconcile). Tasks are written only by the backend (Admin SDK), so the client
 * reads them but never writes them.
 */
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import type { ResolvedModels } from "../core/models/registry";
import type { ImageTier } from "../core/config/modelConfig";
import type {
  AnchorsJob,
  AnchorTask,
  AnyJob,
  GenerationJob,
  JobTask,
  PipelineRefreshJob,
  RefreshTask,
  TaskDoc,
} from "../core/jobs/types";
import type { Project } from "../core/types";
import { slimProjectForRender } from "../core/book/slimProject";

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
  tier: ImageTier,
): Promise<string> {
  const now = Date.now();
  const job: GenerationJob = {
    kind: "image",
    status: "pending",
    projectId,
    tier,
    createdAt: now,
    updatedAt: now,
    // Seed an already-expired lease so the reaper can adopt this job even if its
    // create trigger never fires; the worker takes ownership the moment it runs.
    leaseExpiresAt: 0,
    runCount: 0,
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
  tier: ImageTier,
): Promise<string> {
  const now = Date.now();
  // Persisted in Firestore (1 MB cap): embed only what the worker renders — the
  // screenplay, the anchors' active images, and the targeted spreads' trees.
  const slim = slimProjectForRender(project, {
    keepScreenplay: true,
    keepAnchorVersions: true,
    illustrationTargets: tasks.map((t) => ({ id: t.id, nodeId: t.options?.fromNodeId })),
  });
  const job: PipelineRefreshJob = {
    kind: "refresh",
    status: "pending",
    projectId: project.id,
    tier,
    createdAt: now,
    updatedAt: now,
    leaseExpiresAt: 0,
    runCount: 0,
    project: slim,
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
  tier: ImageTier,
): Promise<string> {
  const now = Date.now();
  // The anchor worker honors the dependency graph, so keep ALL anchors' active
  // images; add each target anchor's branch point. Screenplay/illustrations/
  // design are not read by anchor rendering, so they are dropped.
  const slim = slimProjectForRender(project, {
    keepAnchorVersions: true,
    anchorTargets: tasks.map((t) => ({ id: t.id, nodeId: t.options?.fromNodeId })),
  });
  const job: AnchorsJob = {
    kind: "anchors",
    status: "pending",
    projectId: project.id,
    tier,
    createdAt: now,
    updatedAt: now,
    leaseExpiresAt: 0,
    runCount: 0,
    project: slim,
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

/**
 * Subscribe to every task of a project across all its jobs, via a collection-
 * group query scoped by the owner's uid (so security rules can authorize it) and
 * the project id. Drives per-unit spinners and result reconciliation now that
 * results live in the task subcollection rather than on the job doc.
 */
export function subscribeProjectTasks(
  projectId: string,
  cb: (tasks: TaskDoc[]) => void,
): Unsubscribe {
  const q = query(
    collectionGroup(getFirebaseDb(), "tasks"),
    where("uid", "==", uid()),
    where("projectId", "==", projectId),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as TaskDoc));
  });
}

/** Subscribe to a single job's task subcollection. */
export function subscribeJobTasks(jobId: string, cb: (tasks: TaskDoc[]) => void): Unsubscribe {
  const col = collection(getFirebaseDb(), `users/${uid()}/jobs/${jobId}/tasks`);
  return onSnapshot(col, (snap) => {
    cb(snap.docs.map((d) => d.data() as TaskDoc));
  });
}

/** One-shot read of a job's tasks (for eager reconcile before continuing). */
export async function fetchJobTasks(jobId: string): Promise<TaskDoc[]> {
  const col = collection(getFirebaseDb(), `users/${uid()}/jobs/${jobId}/tasks`);
  const snap = await getDocs(col);
  return snap.docs.map((d) => d.data() as TaskDoc);
}
