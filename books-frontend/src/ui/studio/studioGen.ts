/**
 * Batch generation orchestration for the unified Studio. Wraps the pure AI
 * pipelines (anchors → illustrations) with concurrency + progress reporting so a
 * single "Generate everything" button can fill in the whole book.
 */
import type { AnchorTask, RefreshTask, TaskDoc } from "../../core/jobs/types";
import type { ResolvedModels } from "../../core/models/registry";
import type { Project } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { containedAnchorsFor } from "../../core/book/anchorGraph";
import {
  currentAnchorImage,
  currentIllustration,
  getResolvedModels,
  staleAnchorIds,
  staleIllustrationSpreadIds,
} from "../../state/ai";
import { illustrationUnits } from "../../state/bookUnits";
import {
  createAnchorsJob,
  createRefreshJob,
  fetchJobTasks,
  subscribeJob,
  subscribeJobTasks,
} from "../../platform/jobs";
import { reconcileTasksNow } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSparksStore } from "../../state/sparksStore";
import { useSparksUiStore } from "../../state/sparksUiStore";
import { estimateForAction, type SparkActionId } from "../../core/config/sparks";
import { currentActionMultiplier } from "../../state/subscriptionStore";
import { requireImageTier } from "../../state/imageTierPrompt";

/**
 * Mirror the server's pre-flight Spark check on the client so a batch we can't
 * afford opens the top-up wallet immediately (instead of enqueuing a job that
 * silently errors). The server remains authoritative. Returns false when the
 * batch can't start within the negative buffer.
 */
function ensureBatchAffordable(action: SparkActionId, count: number): boolean {
  const { sparks } = useAppConfigStore.getState();
  if (!sparks.enabled || count <= 0) return true;
  const estimate = estimateForAction(sparks, action, currentActionMultiplier(action)) * count;
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
 * Watch a job to completion across BOTH its aggregate doc (for terminal status +
 * setup-phase errors) and its per-task subcollection (for per-unit done/error
 * and eager result reconciliation), resolving once the job is terminal. Task
 * results live in the subcollection now, so a job can finish "done" while some
 * individual tasks errored — `onTaskSettled` still fires per task and each task
 * error is surfaced via `onError`, while a setup-phase failure that left no task
 * errored is surfaced from the job doc.
 */
async function watchJob(
  jobId: string,
  projectId: string,
  opts: {
    signal?: AbortSignal;
    /** Fold finished renders in immediately (for callers that continue on them). */
    eagerReconcile?: boolean;
    /** Fires once per task the first time it reaches done/error. */
    onTaskSettled?: (task: TaskDoc) => void;
    onError: (err: unknown) => void;
  },
): Promise<void> {
  const handled = new Set<string>();
  let surfacedError = false;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    let unsubJob: () => void = () => {};
    let unsubTasks: () => void = () => {};
    const finish = () => {
      clearTimeout(timer);
      unsubJob();
      unsubTasks();
      resolve();
    };
    unsubTasks = subscribeJobTasks(jobId, (tasks) => {
      if (opts.signal?.aborted) return finish();
      if (opts.eagerReconcile && tasks.some((t) => t.status === "done")) {
        void reconcileTasksNow(tasks, projectId);
      }
      for (const task of tasks) {
        if (handled.has(task.id)) continue;
        if (task.status === "done") {
          handled.add(task.id);
          opts.onTaskSettled?.(task);
        } else if (task.status === "error") {
          handled.add(task.id);
          surfacedError = true;
          opts.onError(new Error(task.error || "Generation failed."));
          opts.onTaskSettled?.(task);
        }
      }
    });
    unsubJob = subscribeJob(jobId, (job) => {
      if (!job) return;
      if (opts.signal?.aborted) return finish();
      if (job.status === "done" || job.status === "error") {
        if (job.status === "error" && !surfacedError) {
          opts.onError(new Error(job.error || "Generation failed."));
        }
        finish();
      }
    });
    timer = setTimeout(finish, JOB_WATCH_TIMEOUT_MS);
  });
}

/**
 * Wait until the live project reflects a generated image for each id (i.e. the
 * jobs store has reconciled the worker's renders), so callers that depend on
 * anchor images (page generation) don't race ahead. Bounded so an unexpected
 * miss can't hang the flow.
 */
async function waitForAnchorImages(ids: string[], signal?: AbortSignal): Promise<void> {
  if (ids.length === 0) return;
  // Generous fallback only: results are reconciled eagerly from the job
  // subscription, so under normal operation this resolves in one poll.
  const deadline = Date.now() + 60_000;
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
  const tier = requireImageTier();
  if (!tier) return;
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
    const jobId = await createAnchorsJob(project, models, tasks, tier);
    // Fold finished renders in eagerly so the page-generation step that follows
    // sees the new anchor images instead of racing the store's own reconcile.
    await watchJob(jobId, project.id, {
      signal,
      eagerReconcile: true,
      onError,
      onTaskSettled: (task) => {
        setGen(task.id, false);
        if (task.status === "done") succeeded.push(task.id);
      },
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
 * job queue, using the SAME full pipeline as refresh/single-page jobs: one
 * refresh task per pending spread. The worker resolves prompts/references from
 * the project snapshot (so provenance, binding and repair behave identically to
 * every other path) and the jobs store folds results into the version trees.
 * Because the work runs server-side, it continues even if the browser is closed;
 * this call simply tracks the job for the current session.
 */
export async function generateAllPages(
  project: Project,
  setGen: SetGen,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pending = illustrationUnits(project).filter((s) => !currentIllustration(project, s.id));
  if (pending.length === 0) return;
  const tier = requireImageTier();
  if (!tier) return;
  if (!ensureBatchAffordable("pageIllustration", pending.length)) return;
  pending.forEach((s) => setGen(s.id, true));

  // Enqueue one job; the backend worker renders every task. Results are applied
  // to the version trees by the jobs store (which also reconciles work that
  // finishes after the studio closes), so here we only mirror per-spread status
  // into the local spinners and surface failures.
  try {
    const models = getResolvedModels(tier);
    const tasks: RefreshTask[] = pending.map((s) => ({
      id: s.id,
      status: "pending",
      options: {},
    }));
    const jobId = await createRefreshJob(project, models, tasks, tier);
    await watchJob(jobId, project.id, {
      signal,
      onError,
      onTaskSettled: (task) => setGen(task.id, false),
    });
  } catch (err) {
    onError(err);
  } finally {
    pending.forEach((s) => setGen(s.id, false));
  }
}

/**
 * Refresh a SINGLE spread/cover through the job queue (the same server-side path
 * as the batch "refresh stale pages"), instead of the inline blocking HTTP call.
 * The surgical in-place refresh does extra work (vision localization + masked
 * edit + composite) and can take minutes; running it inline — or even watching
 * the job to completion here — blocks the button for the whole render. Instead we
 * only ENQUEUE the job (fast) and return. The running job then shows in the
 * global progress indicator, the per-spread "updating" state is driven by the
 * jobs store's `activeUnitIds`, and the result is folded into the version tree by
 * the jobs store on reconcile. Survives a page refresh. `spreadId` is the
 * illustration-unit id (a spread id or a cover id), matching the tree key.
 */
export async function refreshSpread(
  project: Project,
  spreadId: string,
  options: { useReference?: boolean; edit?: string; fromNodeId?: string },
  onError: (err: unknown) => void,
): Promise<void> {
  const isCover = spreadId === COVER_FRONT_ID || spreadId === COVER_BACK_ID;
  const tier = requireImageTier();
  if (!tier) return;
  if (!ensureBatchAffordable(isCover ? "coverIllustration" : "pageIllustration", 1)) return;

  try {
    const models = getResolvedModels(tier);
    const tasks: RefreshTask[] = [{ id: spreadId, status: "pending", options }];
    await createRefreshJob(project, models, tasks, tier);
  } catch (err) {
    onError(err);
  }
}

/**
 * Generate (or iterate on) a SINGLE anchor through the backend job queue —
 * non-blocking, same as pages: only the enqueue is awaited; the per-anchor
 * "working" state is driven by the jobs store's `activeUnitIds` and the result
 * is folded into the anchor's version tree on reconcile.
 *
 * Dependency expansion: when the anchor CONTAINS other anchors that have no
 * image yet (e.g. generating "hospital room" before its "hospital bed"), the
 * imageless children are queued in the same job — the worker's dependency
 * ordering renders them first, so the parent's sheet actually embeds them.
 */
export async function generateAnchorViaJob(
  project: Project,
  anchorId: string,
  options: { useReference?: boolean; edit?: string; fromNodeId?: string },
  onError: (err: unknown) => void,
): Promise<void> {
  const anchor = (project.anchors ?? []).find((a) => a.id === anchorId);
  if (!anchor) {
    onError(new Error("Anchor not found."));
    return;
  }
  const tier = requireImageTier();
  if (!tier) return;

  const missingChildren = containedAnchorsFor(anchor, project.anchors ?? []).filter(
    (c) => !currentAnchorImage(c),
  );
  if (!ensureBatchAffordable("anchorImage", 1 + missingChildren.length)) return;

  try {
    const models = getResolvedModels(tier);
    const tasks: AnchorTask[] = [
      ...missingChildren.map<AnchorTask>((c) => ({ id: c.id, status: "pending" })),
      { id: anchorId, status: "pending", options },
    ];
    const jobId = await createAnchorsJob(project, models, tasks, tier);
    // Fire-and-forget error surfacing: the enqueue returns immediately, so a
    // render failure would otherwise just silently clear the spinner. `watchJob`
    // surfaces both per-task and setup-phase errors, then unsubscribes itself
    // once the job is terminal (the per-anchor spinner is driven by the jobs
    // store's `activeUnitIds`, so nothing to clear here).
    void watchJob(jobId, project.id, { onError });
  } catch (err) {
    onError(err);
  }
}

/**
 * Re-render every anchor whose linked references/relations changed since its
 * image was generated (dependency-ordered, keeping composition via
 * `useReference`), and WAIT until the results are reconciled into the project.
 * Used as the first step of the "update everything stale" cascade so the page
 * refreshes that follow see the NEW anchor sheets. Returns the number queued.
 */
export async function updateStaleAnchors(
  project: Project,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
): Promise<number> {
  const stale = staleAnchorIds(project).filter((id) => {
    const a = project.anchors?.find((x) => x.id === id);
    return Boolean(a?.include && currentAnchorImage(a));
  });
  if (stale.length === 0) return 0;
  const tier = requireImageTier();
  if (!tier) return 0;
  if (!ensureBatchAffordable("anchorImage", stale.length)) return 0;

  try {
    const models = getResolvedModels(tier);
    const tasks: AnchorTask[] = stale.map((id) => ({
      id,
      status: "pending",
      options: { useReference: true },
    }));
    const jobId = await createAnchorsJob(project, models, tasks, tier);
    await watchJob(jobId, project.id, { signal, eagerReconcile: true, onError });
    // Final idempotent reconcile so the caller continues with updated anchors,
    // covering results that landed just after the job doc went terminal.
    if (!signal?.aborted) {
      const finalTasks = await fetchJobTasks(jobId);
      await reconcileTasksNow(finalTasks, project.id);
    }
    return stale.length;
  } catch (err) {
    onError(err);
    return 0;
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
  const tier = requireImageTier();
  if (!tier) return 0;
  try {
    const models = getResolvedModels(tier);
    const tasks: RefreshTask[] = stale.map((id) => ({
      id,
      status: "pending",
      options: { useReference: true },
    }));
    await createRefreshJob(project, models, tasks, tier);
    return stale.length;
  } catch (err) {
    onError(err);
    return 0;
  }
}
