/**
 * Batch generation orchestration for the unified Studio. Wraps the pure AI
 * pipelines (anchors → illustrations) with concurrency + progress reporting so a
 * single "Generate everything" button can fill in the whole book.
 */
import type { AnchorTask, RefreshTask, TaskDoc } from "../../core/jobs/types";
import type { ResolvedModels } from "../../core/models/registry";
import type { Project } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID, SPINE_ID } from "../../core/types";
import { containedAnchorsFor } from "../../core/book/anchorGraph";
import {
  currentAnchorImage,
  currentIllustration,
  getResolvedModels,
  staleAnchorIds,
  staleIllustrationSpreadIds,
} from "../../state/ai";
import { illustrationUnits } from "../../state/bookUnits";
import { ProviderError } from "../../core/errors";
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
import { warnBatchShortfall } from "../../state/sparksShortfallPrompt";
import { estimateForAction } from "../../core/config/sparks";
import type { ImageActionId } from "../../core/ai/actions";
import type { CostSampleKind } from "../../core/config/imageCostStats";
import { currentActionMultiplier } from "../../state/subscriptionStore";
import {
  campaignMultiplierFor,
  usePriceOverridesStore,
} from "../../state/priceOverridesStore";
import { tierSparkRange } from "../hooks/useTierEstimate";
import { requireImageTier } from "../../state/imageTierPrompt";
import type { ImageTier } from "../../core/config/modelConfig";

/** One unit of a batch, priced the way the server will settle it. */
interface BatchUnit {
  action: ImageActionId;
  kind?: CostSampleKind;
}

/** The Spark action an illustration unit settles as (covers cost more). */
function illustrationActionForId(id: string): ImageActionId {
  return id === COVER_FRONT_ID || id === COVER_BACK_ID || id === SPINE_ID
    ? "coverIllustration"
    : "pageIllustration";
}

/**
 * Mirror the server's pre-flight Spark check on the client so a batch we can't
 * afford explains itself immediately (instead of enqueuing a job that silently
 * errors). The server remains authoritative. Returns false when the batch can't
 * start within the negative buffer.
 *
 * Priced per unit, exactly as `expandJob` quotes it: the UPPER bound of the
 * tier's recent-cost window, for the action and cost window each unit will
 * actually settle from. The flat `estimateForAction` this used to call is a
 * different number entirely for `derived` image pricing, and the gap multiplied
 * by the batch size — so a batch the client waved through was refused wholesale
 * by the server's reserve, with a bare "not enough Sparks" toast and not one
 * page rendered.
 */
function ensureBatchAffordable(units: BatchUnit[], tier: ImageTier): boolean {
  const { sparks, modelCosts, imageCostStats } = useAppConfigStore.getState();
  if (!sparks.enabled || units.length === 0) return true;

  const overrides = usePriceOverridesStore.getState().actions;
  const priced = new Map<string, number>();
  const priceOf = ({ action, kind = "fresh" }: BatchUnit): number => {
    const key = `${action}:${kind}`;
    const hit = priced.get(key);
    if (hit !== undefined) return hit;
    const multiplier =
      currentActionMultiplier(action) * campaignMultiplierFor(overrides, action, tier);
    const range = tierSparkRange(
      sparks,
      modelCosts,
      imageCostStats,
      action,
      tier,
      multiplier,
      kind,
    );
    // No range means the economy can't price it here; fall back to the flat
    // configured estimate rather than quoting free.
    const value = range ? range.maxSparks : estimateForAction(sparks, action, multiplier);
    priced.set(key, value);
    return value;
  };

  const estimate = units.reduce((sum, unit) => sum + priceOf(unit), 0);
  if (estimate <= 0) return true;
  const balance = useSparksStore.getState().balance;
  if (balance - estimate >= -sparks.maxNegativeSparks) return true;

  // How far the wallet actually goes, so the warning can say "enough for 6 of
  // them" instead of only naming a price. The buffer is part of the spendable
  // amount here for the same reason the check above allows it. A mixed batch is
  // reported against its average unit, which is what "how many of these fit"
  // means when they aren't all the same price.
  const spendable = balance + sparks.maxNegativeSparks;
  const perUnit = estimate / units.length;
  warnBatchShortfall({
    action: units[0].action,
    requested: units.length,
    affordable: perUnit > 0 ? Math.max(0, Math.floor(spendable / perUnit)) : 0,
    estimate,
    balance,
    shortfall: Math.max(1, Math.ceil(estimate - balance)),
  });
  return false;
}

// Re-exported for existing UI imports (moved to the state layer).
export { coverSpread, illustrationUnits } from "../../state/bookUnits";

type SetGen = (id: string, on: boolean) => void;

/**
 * A failed task as an error the UI can describe. The worker records the
 * provider failure class next to the message, so a job failure reads the same
 * as a synchronous one rather than relaying a raw provider string.
 */
function taskError(task: TaskDoc): Error {
  const message = task.error || "Generation failed.";
  return task.errorKind ? new ProviderError(message, { kind: task.errorKind }) : new Error(message);
}

/** What a batch run reports back: whether it ran at all, and how much failed. */
export interface BatchOutcome {
  /** False when a gate refused the batch before it started (already explained). */
  started: boolean;
  /** Units that errored. Counted rather than toasted, for the caller's summary. */
  failed: number;
}

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
    /**
     * Suppress the per-task error toast, leaving the failure count to the
     * caller's own summary. A twelve-page batch that lost five pages used to
     * fire five toasts and then a sixth saying five items had failed.
     */
    quietTaskErrors?: boolean;
    onError: (err: unknown) => void;
  },
): Promise<{ failed: number }> {
  const handled = new Set<string>();
  const failedTasks = new Set<string>();
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
          failedTasks.add(task.id);
          surfacedError = true;
          if (!opts.quietTaskErrors) opts.onError(taskError(task));
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
  return { failed: failedTasks.size };
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
 * `skipIds` leaves in-progress looks alone so a one-off create doesn't get
 * re-queued by "create remaining".
 *
 * `started` is false when a gate refused the batch before it began — no tier
 * chosen, or not enough Sparks. Both cases already put an explanation on screen,
 * so the caller must stay quiet rather than report success over the top of it.
 * `failed` counts the units that errored, for the caller's own summary; those
 * failures are deliberately NOT toasted one by one.
 */
export async function generateAllAnchors(
  project: Project,
  setGen: SetGen,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
  skipIds?: ReadonlySet<string>,
): Promise<BatchOutcome> {
  const pending = (project.anchors ?? []).filter(
    (a) => a.include && !currentAnchorImage(a) && !skipIds?.has(a.id),
  );
  if (pending.length === 0) return { started: true, failed: 0 };
  // Paint every card as busy before auth/profile/tier checks or network work.
  pending.forEach((a) => setGen(a.id, true));
  let tier: ImageTier | null;
  try {
    tier = await requireImageTier();
  } catch (err) {
    pending.forEach((a) => setGen(a.id, false));
    onError(err);
    return { started: false, failed: 0 };
  }
  if (!tier) {
    pending.forEach((a) => setGen(a.id, false));
    return { started: false, failed: 0 };
  }
  if (!ensureBatchAffordable(pending.map(() => ({ action: "anchorImage" })), tier)) {
    pending.forEach((a) => setGen(a.id, false));
    return { started: false, failed: 0 };
  }

  let models: ResolvedModels;
  try {
    models = getResolvedModels(tier);
  } catch (err) {
    pending.forEach((a) => setGen(a.id, false));
    onError(err);
    return { started: true, failed: 0 };
  }

  const tasks: AnchorTask[] = pending.map((a) => ({ id: a.id, status: "pending" }));
  const succeeded: string[] = [];
  let failed = 0;
  try {
    const jobId = await createAnchorsJob(project, models, tasks, tier);
    // Fold finished renders in eagerly so the page-generation step that follows
    // sees the new anchor images instead of racing the store's own reconcile.
    ({ failed } = await watchJob(jobId, project.id, {
      signal,
      eagerReconcile: true,
      quietTaskErrors: true,
      onError,
      onTaskSettled: (task) => {
        setGen(task.id, false);
        if (task.status === "done") succeeded.push(task.id);
      },
    }));
    if (!signal?.aborted) await waitForAnchorImages(succeeded, signal);
  } catch (err) {
    onError(err);
  } finally {
    pending.forEach((a) => setGen(a.id, false));
  }
  return { started: true, failed };
}

/**
 * Generate every not-yet-generated page + cover illustration through the backend
 * job queue, using the SAME full pipeline as refresh/single-page jobs: one
 * refresh task per pending spread. The worker resolves prompts/references from
 * the project snapshot (so provenance, binding and repair behave identically to
 * every other path) and the jobs store folds results into the version trees.
 * Because the work runs server-side, it continues even if the browser is closed;
 * this call simply tracks the job for the current session.
 *
 * Reports `started`/`failed` exactly as {@link generateAllAnchors} does.
 */
export async function generateAllPages(
  project: Project,
  setGen: SetGen,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
): Promise<BatchOutcome> {
  const pending = illustrationUnits(project).filter((s) => !currentIllustration(project, s.id));
  if (pending.length === 0) return { started: true, failed: 0 };
  const tier = await requireImageTier();
  if (!tier) return { started: false, failed: 0 };
  if (!ensureBatchAffordable(pending.map((s) => ({ action: illustrationActionForId(s.id) })), tier))
    return { started: false, failed: 0 };
  pending.forEach((s) => setGen(s.id, true));

  // Enqueue one job; the backend worker renders every task. Results are applied
  // to the version trees by the jobs store (which also reconciles work that
  // finishes after the studio closes), so here we only mirror per-spread status
  // into the local spinners and surface failures.
  let failed = 0;
  try {
    const models = getResolvedModels(tier);
    const tasks: RefreshTask[] = pending.map((s) => ({
      id: s.id,
      status: "pending",
      options: {},
    }));
    const jobId = await createRefreshJob(project, models, tasks, tier);
    ({ failed } = await watchJob(jobId, project.id, {
      signal,
      quietTaskErrors: true,
      onError,
      onTaskSettled: (task) => setGen(task.id, false),
    }));
  } catch (err) {
    onError(err);
  } finally {
    pending.forEach((s) => setGen(s.id, false));
  }
  return { started: true, failed };
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
  options: {
    useReference?: boolean;
    edit?: string;
    fromNodeId?: string;
    restyle?: boolean;
    tier?: ImageTier;
  },
  onError: (err: unknown) => void,
): Promise<void> {
  const { tier: requestedTier, ...runOptions } = options;
  const tier = requestedTier ?? (await requireImageTier());
  if (!tier) return;
  const refreshUnit: BatchUnit = {
    action: illustrationActionForId(spreadId),
    kind: runOptions.edit?.trim() ? "edit" : "fresh",
  };
  if (!ensureBatchAffordable([refreshUnit], tier)) return;

  try {
    const models = getResolvedModels(tier);
    const tasks: RefreshTask[] = [{ id: spreadId, status: "pending", options: runOptions }];
    const jobId = await createRefreshJob(project, models, tasks, tier);
    // Fire-and-forget: fold the result in from the job's OWN task subcollection
    // rather than relying solely on the project-wide collection-group listener,
    // and surface render failures that would otherwise pass silently.
    void watchJob(jobId, project.id, { eagerReconcile: true, onError });
  } catch (err) {
    onError(err);
  }
}

/**
 * Generate (or iterate on) a SINGLE anchor through the backend job queue —
 * non-blocking, same as pages: only the enqueue is awaited. `onSettled` closes
 * the optimistic loading state once the queued job reaches a terminal state;
 * the jobs store independently preserves progress across reloads and folds the
 * result into the anchor's version tree on reconcile.
 *
 * Dependency expansion: when the anchor CONTAINS other anchors that have no
 * image yet (e.g. generating "hospital room" before its "hospital bed"), the
 * imageless children are queued in the same job — the worker's dependency
 * ordering renders them first, so the parent's sheet actually embeds them.
 */
export async function generateAnchorViaJob(
  project: Project,
  anchorId: string,
  options: {
    useReference?: boolean;
    edit?: string;
    fromNodeId?: string;
    restyle?: boolean;
    tier?: ImageTier;
  },
  onError: (err: unknown) => void,
  onSettled?: () => void,
): Promise<boolean> {
  const anchor = (project.anchors ?? []).find((a) => a.id === anchorId);
  if (!anchor) {
    onError(new Error("Anchor not found."));
    return false;
  }
  const { tier: requestedTier, ...runOptions } = options;
  let tier: ImageTier | null;
  try {
    tier = requestedTier ?? (await requireImageTier());
  } catch (err) {
    onError(err);
    return false;
  }
  if (!tier) return false;

  const missingChildren = containedAnchorsFor(anchor, project.anchors ?? []).filter(
    (c) => !currentAnchorImage(c),
  );
  const anchorUnits: BatchUnit[] = [
    ...missingChildren.map<BatchUnit>(() => ({ action: "anchorImage" })),
    { action: "anchorImage", kind: runOptions.edit?.trim() ? "edit" : "fresh" },
  ];
  if (!ensureBatchAffordable(anchorUnits, tier)) return false;

  try {
    const models = getResolvedModels(tier);
    const tasks: AnchorTask[] = [
      ...missingChildren.map<AnchorTask>((c) => ({ id: c.id, status: "pending" })),
      { id: anchorId, status: "pending", options: runOptions },
    ];
    const jobId = await createAnchorsJob(project, models, tasks, tier);
    // Fire-and-forget error surfacing: the enqueue returns immediately, so a
    // render failure would otherwise just silently clear the spinner. `watchJob`
    // surfaces both per-task and setup-phase errors, then unsubscribes itself
    // once the job is terminal (the per-anchor spinner is driven by the jobs
    // store's `activeUnitIds`, so nothing to clear here). Reconciling eagerly
    // from the job's own task subcollection means a single regeneration lands
    // even if the project-wide collection-group listener is unavailable.
    void watchJob(jobId, project.id, { eagerReconcile: true, onError })
      .then(async () => {
        // Do not clear the optimistic card state until the terminal result has
        // actually been folded into the live anchor.
        const finalTasks = await fetchJobTasks(jobId);
        await reconcileTasksNow(finalTasks, project.id);
      })
      .catch(onError)
      .finally(() => onSettled?.());
    return true;
  } catch (err) {
    onError(err);
    return false;
  }
}

/**
 * Re-render every anchor whose embedded reference changed since its
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
  const tier = await requireImageTier();
  if (!tier) return 0;
  if (!ensureBatchAffordable(stale.map(() => ({ action: "anchorImage" })), tier)) return 0;

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
 * Update specific character/place looks (with `useReference`), wait for them to
 * land, then refresh a page/cover scene. Used when a page's cast looks are
 * themselves stale — so "Update scene" can chain the right order without
 * sending the user to the Cast substep.
 */
export async function updateAnchorsThenSpread(
  project: Project,
  spreadId: string,
  anchorIds: string[],
  onError: (err: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const ids = [...new Set(anchorIds)].filter((id) => {
    const a = project.anchors?.find((x) => x.id === id);
    return Boolean(a?.include && currentAnchorImage(a));
  });
  if (ids.length > 0) {
    const tier = await requireImageTier();
    if (!tier) return;
    if (!ensureBatchAffordable(ids.map(() => ({ action: "anchorImage" })), tier)) return;
    try {
      const models = getResolvedModels(tier);
      const tasks: AnchorTask[] = ids.map((id) => ({
        id,
        status: "pending",
        options: { useReference: true },
      }));
      const jobId = await createAnchorsJob(project, models, tasks, tier);
      await watchJob(jobId, project.id, { signal, eagerReconcile: true, onError });
      if (!signal?.aborted) {
        const finalTasks = await fetchJobTasks(jobId);
        await reconcileTasksNow(finalTasks, project.id);
      }
    } catch (err) {
      onError(err);
      return;
    }
  }
  if (signal?.aborted) return;
  // Re-read project so the page refresh sees the new look sheets.
  const fresh = useProjectsStore.getState().current() ?? project;
  await refreshSpread(fresh, spreadId, { useReference: true }, onError);
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
  const tier = await requireImageTier();
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
