/**
 * Is the server still working on this, or has it gone quiet for good?
 *
 * The backend promises an end: a task heartbeats while a worker holds it, the
 * reaper re-enqueues or closes anything that stops, and every job carries a
 * deadline. So silence longer than those bounds is not "still drawing" — it
 * means the backend is not going to deliver, and the reader has to be told
 * (and offered the retry) instead of watching a spinner.
 *
 * Pure and offline: the studio feeds it the job and task documents it already
 * subscribes to, so the rule can be checked without a server.
 */
import type { JobStatus } from "./types";

/**
 * The longest a live task can be silent. A running task heartbeats every 30
 * seconds; a task whose worker died is re-enqueued within about five minutes
 * (lease, reaper staleness, one sweep); a queued task is re-enqueued after four.
 * Past this, the server has missed all of its own recovery points.
 */
export const STALL_MS = 10 * 60_000;

/** The reaper closes a job within a sweep of its deadline; this is the wait beyond that. */
export const DEADLINE_GRACE_MS = 3 * 60_000;

/** A terminal job should never have open tasks; give a late write this long to land. */
const TERMINAL_JOB_GRACE_MS = 60_000;

/** The slice of a task document liveness needs. */
export interface LiveTask {
  id: string;
  jobId: string;
  status: JobStatus;
  updatedAt: number;
  heartbeatAt?: number;
}

/** The slice of a job document liveness needs. */
export interface LiveJob {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  expanded?: boolean;
  deadlineAt?: number;
}

const isOpen = (status: JobStatus) => status !== "done" && status !== "error";

/** The last moment this task showed any sign of life. */
export function lastSignOfLife(task: LiveTask): number {
  return Math.max(task.updatedAt ?? 0, task.heartbeatAt ?? 0);
}

/** Past its job's deadline by more than the reaper needs to close it. */
export function pastDeadline(job: LiveJob | undefined, now: number): boolean {
  return Boolean(job && isOpen(job.status) && typeof job.deadlineAt === "number" && now > job.deadlineAt + DEADLINE_GRACE_MS);
}

/**
 * An unfinished task the server has stopped working on. Finished tasks never
 * are; neither are tasks of a job that is demonstrably still inside its bounds.
 */
export function taskStalled(
  task: LiveTask,
  job: LiveJob | undefined,
  now: number,
  siblings: readonly LiveTask[] = [],
): boolean {
  if (!isOpen(task.status)) return false;
  if (job && !isOpen(job.status)) return now - Math.max(job.updatedAt ?? 0, lastSignOfLife(task)) > TERMINAL_JOB_GRACE_MS;
  if (pastDeadline(job, now)) return true;
  if (now - lastSignOfLife(task) <= STALL_MS) return false;
  // A queued task is idle by design while the queue works through the others
  // (or the anchors it depends on), so its own silence proves nothing while
  // its job is still moving. A running task, by contrast, heartbeats.
  if (task.status === "pending") {
    return !siblings.some((other) => other.jobId === task.jobId && other.id !== task.id && now - lastSignOfLife(other) <= STALL_MS);
  }
  return true;
}

/**
 * A job that will not deliver what it has left: past its deadline, never
 * started, or every task still open on it has gone quiet.
 */
export function jobStalled(job: LiveJob, tasks: readonly LiveTask[], now: number): boolean {
  if (!isOpen(job.status)) return false;
  if (pastDeadline(job, now)) return true;
  const mine = tasks.filter((task) => task.jobId === job.id);
  if (!job.expanded && mine.length === 0) return now - Math.max(job.updatedAt ?? 0, job.createdAt ?? 0) > STALL_MS;
  const open = mine.filter((task) => isOpen(task.status));
  return open.length > 0 && open.every((task) => taskStalled(task, job, now, mine));
}
