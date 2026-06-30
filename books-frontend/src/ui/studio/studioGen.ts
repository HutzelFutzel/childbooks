/**
 * Batch generation orchestration for the unified Studio. Wraps the pure AI
 * pipelines (anchors → illustrations) with concurrency + progress reporting so a
 * single "Generate everything" button can fill in the whole book.
 */
import type { AnchorTask, RefreshTask } from "../../core/jobs/types";
import type { ResolvedModels } from "../../core/models/registry";
import type { Project } from "../../core/types";
import {
  buildIllustrationTask,
  currentAnchorImage,
  currentIllustration,
  getResolvedModels,
  staleIllustrationSpreadIds,
} from "../../state/ai";
import { illustrationUnits } from "../../state/bookUnits";
import {
  createAnchorsJob,
  createImageJob,
  createRefreshJob,
  subscribeJob,
} from "../../platform/jobs";
import { useProjectsStore } from "../../state/projectsStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSparksStore } from "../../state/sparksStore";
import { useSparksUiStore } from "../../state/sparksUiStore";
import { estimateForAction, type SparkActionId } from "../../core/config/sparks";

/**
 * Mirror the server's pre-flight Spark check on the client so a batch we can't
 * afford opens the top-up wallet immediately (instead of enqueuing a job that
 * silently errors). The server remains authoritative. Returns false when the
 * batch can't start within the negative buffer.
 */
function ensureBatchAffordable(action: SparkActionId, count: number): boolean {
  const { sparks } = useAppConfigStore.getState();
  if (!sparks.enabled || count <= 0) return true;
  const estimate = estimateForAction(sparks, action) * count;
  if (estimate <= 0) return true;
  const balance = useSparksStore.getState().balance;
  if (balance - estimate < -sparks.maxNegativeSparks) {
    useSparksUiStore.getState().openWallet(Math.max(1, estimate - balance));
    return false;
  }
  return true;
}

// Re-exported for existing UI imports (moved to the state layer).
export { coverSpread, illustrationUnits } from "../../state/bookUnits";

type SetGen = (id: string, on: boolean) => void;

/**
 * Safety bound on watching a single job from the client. The worker always
 * drives the job to a terminal state (and its own function timeout is 540s), so
 * this only fires if the document never updates at all (e.g. the worker never
 * ran). When it does, we stop watching and clear spinners; any results that
 * still land later are folded in by the jobs store on reconcile.
 */
const JOB_WATCH_TIMEOUT_MS = 600_000;

/**
 * Wait until the live project reflects a generated image for each id (i.e. the
 * jobs store has reconciled the worker's renders), so callers that depend on
 * anchor images (page generation) don't race ahead. Bounded so an unexpected
 * miss can't hang the flow.
 */
async function waitForAnchorImages(ids: string[], signal?: AbortSignal): Promise<void> {
  if (ids.length === 0) return;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) return;
    const project = useProjectsStore.getState().current();
    const ready =
      project &&
      ids.every((id) => {
        const a = project.anchors?.find((x) => x.id === id);
        return Boolean(a && currentAnchorImage(a));
      });
    if (ready) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Generate every not-yet-generated anchor reference through the backend job
 * queue: enqueue one anchors job (the worker honors the dependency graph), track
 * progress to drive the per-anchor spinners, then wait until results have been
 * folded back into the project. Runs server-side and survives a refresh.
 */
export async function generateAllAnchors(
  project: Project,
  setGen: SetGen,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pending = (project.anchors ?? []).filter((a) => a.include && !currentAnchorImage(a));
  if (pending.length === 0) return;
  if (!ensureBatchAffordable("anchorImage", pending.length)) return;
  pending.forEach((a) => setGen(a.id, true));

  let models: ResolvedModels;
  try {
    models = getResolvedModels();
  } catch (err) {
    pending.forEach((a) => setGen(a.id, false));
    onError(err);
    return;
  }

  const tasks: AnchorTask[] = pending.map((a) => ({ id: a.id, status: "pending" }));
  const succeeded: string[] = [];
  try {
    const jobId = await createAnchorsJob(project, models, tasks);
    const handled = new Set<string>();
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (unsub: () => void) => {
        clearTimeout(timer);
        unsub();
        resolve();
      };
      const unsub = subscribeJob(jobId, (job) => {
        if (!job) return;
        if (signal?.aborted) return finish(unsub);
        for (const task of job.tasks) {
          if (handled.has(task.id)) continue;
          if (task.status === "done") {
            handled.add(task.id);
            succeeded.push(task.id);
            setGen(task.id, false);
          } else if (task.status === "error") {
            handled.add(task.id);
            setGen(task.id, false);
            onError(new Error(task.error || "Anchor generation failed."));
          }
        }
        if (job.status === "done" || job.status === "error") finish(unsub);
      });
      timer = setTimeout(() => finish(unsub), JOB_WATCH_TIMEOUT_MS);
    });
    if (!signal?.aborted) await waitForAnchorImages(succeeded, signal);
  } catch (err) {
    onError(err);
  } finally {
    pending.forEach((a) => setGen(a.id, false));
  }
}

/**
 * Generate every not-yet-generated page + cover illustration through the backend
 * job queue: assemble one render task per pending spread, enqueue a single job,
 * then apply each result to its version tree as the worker completes it. Because
 * the work runs server-side, it continues even if the browser is closed; this
 * call simply tracks the job for the current session.
 */
export async function generateAllPages(
  project: Project,
  setGen: SetGen,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pending = illustrationUnits(project).filter((s) => !currentIllustration(project, s.id));
  if (pending.length === 0) return;
  if (!ensureBatchAffordable("pageIllustration", pending.length)) return;
  pending.forEach((s) => setGen(s.id, true));

  let tasks;
  try {
    tasks = pending.map((s) => buildIllustrationTask(project, s));
  } catch (err) {
    pending.forEach((s) => setGen(s.id, false));
    onError(err);
    return;
  }

  // Enqueue one job; the backend worker renders every task. Results are applied
  // to the version trees by the jobs store (which also reconciles work that
  // finishes after the studio closes), so here we only mirror per-spread status
  // into the local spinners and surface failures.
  try {
    const jobId = await createImageJob(project.id, tasks);
    const handled = new Set<string>();

    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (unsub: () => void) => {
        clearTimeout(timer);
        unsub();
        resolve();
      };
      const unsub = subscribeJob(jobId, (job) => {
        if (!job) return;
        if (signal?.aborted) return finish(unsub);

        for (const task of job.tasks) {
          if (handled.has(task.id)) continue;
          if (task.status === "done") {
            handled.add(task.id);
            setGen(task.id, false);
          } else if (task.status === "error") {
            handled.add(task.id);
            setGen(task.id, false);
            onError(new Error(task.error || "Generation failed."));
          }
        }

        if (job.status === "done" || job.status === "error") finish(unsub);
      });
      timer = setTimeout(() => finish(unsub), JOB_WATCH_TIMEOUT_MS);
    });
  } catch (err) {
    onError(err);
  } finally {
    pending.forEach((s) => setGen(s.id, false));
  }
}

/**
 * Refresh every illustration whose anchors changed since it was generated,
 * server-side: enqueue one pipeline-refresh job (which carries a project
 * snapshot + resolved models) and let the worker re-run the full illustration
 * pipeline per stale page. Results are folded back in by the jobs store on
 * reconcile, and progress shows in the global indicator. Returns the number of
 * pages queued.
 */
export async function refreshStalePages(
  project: Project,
  onError: (err: unknown) => void,
): Promise<number> {
  const stale = staleIllustrationSpreadIds(project);
  if (stale.length === 0) return 0;
  try {
    const models = getResolvedModels();
    const tasks: RefreshTask[] = stale.map((id) => ({
      id,
      status: "pending",
      options: { useReference: true },
    }));
    await createRefreshJob(project, models, tasks);
    return stale.length;
  } catch (err) {
    onError(err);
    return 0;
  }
}
