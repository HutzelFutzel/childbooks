/**
 * Art-style transfer: move every existing piece of artwork to the book's newly
 * chosen style.
 *
 * Two properties make this reliable rather than best-effort:
 *
 *  - **Stamps, not assumptions.** Every render records the style it was drawn
 *    in (`artStyleKey`), so "what still needs updating" is derived from the
 *    artwork itself. A task that silently failed, a tab closed mid-run or a
 *    second style change all resolve to the same answer.
 *  - **A persisted plan.** The unit ids and the phase live on the project, so
 *    the cascade survives a reload and can be resumed or retried. Cast sheets
 *    must land before pages start, because each page is re-rendered against the
 *    updated sheets.
 *
 * Nothing here blocks: each phase only ENQUEUES its job. Per-unit progress comes
 * from the jobs store's `activeUnitIds`, exactly like every other generation.
 */
import type { ImageActionId } from "../../core/ai/actions";
import { estimateForAction } from "../../core/config/sparks";
import type { AnchorTask, RefreshTask } from "../../core/jobs/types";
import { artStyleKey } from "../../core/prompts/style";
import type { Project, StyleRenewPlan } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { createAnchorsJob, createRefreshJob } from "../../platform/jobs";
import { currentAnchorImage, currentIllustration, getResolvedModels } from "../../state/ai";
import { useAppConfigStore } from "../../state/appConfigStore";
import { illustrationUnits } from "../../state/bookUnits";
import { requireImageTier } from "../../state/imageTierPrompt";
import { useProjectsStore } from "../../state/projectsStore";
import { useSparksStore } from "../../state/sparksStore";
import { warnBatchShortfall } from "../../state/sparksShortfallPrompt";
import { currentActionMultiplier, currentFeatureAllowed } from "../../state/subscriptionStore";

const isCoverUnit = (id: string) => id === COVER_FRONT_ID || id === COVER_BACK_ID;

/**
 * The style stamp the finished artwork will actually carry. Job snapshots have
 * free-text style directions stripped when the reader's plan doesn't include
 * them, so a plan keyed on the ungated style would wait for a stamp that can
 * never arrive.
 */
function targetStyleKey(project: Project): string {
  const style = project.config.artStyle;
  if (!style?.customDescription?.trim() || currentFeatureAllowed("customArtStyle")) {
    return artStyleKey(style);
  }
  return artStyleKey({ ...style, customDescription: "" });
}

/** Every unit that currently has artwork — the scope of a style transfer. */
export function styleRenewTargets(project: Project): { castIds: string[]; pageIds: string[] } {
  return {
    castIds: (project.anchors ?? [])
      .filter((a) => a.include && currentAnchorImage(a))
      .map((a) => a.id),
    pageIds: illustrationUnits(project)
      .filter((u) => currentIllustration(project, u.id))
      .map((u) => u.id),
  };
}

/** How much artwork a style change would renew (for the confirm dialog). */
export function styleRenewCounts(project: Project): { cast: number; pages: number } {
  const { castIds, pageIds } = styleRenewTargets(project);
  return { cast: castIds.length, pages: pageIds.length };
}

/**
 * The units of a plan whose current artwork is not yet in the target style.
 * Units that lost their artwork (deleted anchor, reverted page) drop out, so a
 * plan can always finish.
 */
export function remainingStyleRenew(
  project: Project,
  plan: StyleRenewPlan,
): { castIds: string[]; pageIds: string[] } {
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  return {
    castIds: plan.castIds.filter((id) => {
      const anchor = byId.get(id);
      const img = anchor ? currentAnchorImage(anchor) : null;
      return Boolean(img) && img!.artStyleKey !== plan.styleKey;
    }),
    pageIds: plan.pageIds.filter((id) => {
      const img = currentIllustration(project, id);
      return Boolean(img) && img!.artStyleKey !== plan.styleKey;
    }),
  };
}

/**
 * Quote both phases as one total: finishing the cast and only then discovering
 * the pages can't be paid for would leave the book half-restyled.
 */
export function ensureStyleRenewAffordable(castCount: number, pageCount: number): boolean {
  const { sparks } = useAppConfigStore.getState();
  if (!sparks.enabled) return true;
  const perCast = estimateForAction(sparks, "anchorImage", currentActionMultiplier("anchorImage"));
  const perPage = estimateForAction(
    sparks,
    "pageIllustration",
    currentActionMultiplier("pageIllustration"),
  );
  const estimate = perCast * castCount + perPage * pageCount;
  if (estimate <= 0) return true;

  const balance = useSparksStore.getState().balance;
  if (balance - estimate >= -sparks.maxNegativeSparks) return true;

  // Attribute the shortfall to the larger phase so the buy prompt can talk in
  // units the reader recognizes.
  const action: ImageActionId = castCount >= pageCount ? "anchorImage" : "pageIllustration";
  const perUnit = action === "anchorImage" ? perCast : perPage;
  const spendable = balance + sparks.maxNegativeSparks;
  warnBatchShortfall({
    action,
    requested: castCount + pageCount,
    affordable: perUnit > 0 ? Math.max(0, Math.floor(spendable / perUnit)) : 0,
    estimate,
    balance,
    shortfall: Math.max(1, Math.ceil(estimate - balance)),
  });
  return false;
}

async function savePlan(plan: StyleRenewPlan | undefined): Promise<void> {
  await useProjectsStore.getState().updateConfig({ styleRenew: plan });
}

/**
 * Enqueue the current phase's remaining work. Safe to call repeatedly (that's
 * the retry path): units already in the target style are skipped, and a unit
 * rendered twice just adds one more version in the same style.
 *
 * The page job is always built from the freshly reconciled project so the worker
 * renders against the restyled cast sheets rather than the snapshot the reader
 * confirmed against.
 */
export async function runStyleRenewPhase(
  plan: StyleRenewPlan,
  onError: (err: unknown) => void,
): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) return;
  const remaining = remainingStyleRenew(project, plan);
  const ids = plan.phase === "cast" ? remaining.castIds : remaining.pageIds;
  if (ids.length === 0) return;

  const tier = await requireImageTier();
  if (!tier) return;

  try {
    const models = getResolvedModels(tier);
    if (plan.phase === "cast") {
      const tasks: AnchorTask[] = ids.map((id) => ({
        id,
        status: "pending",
        options: { restyle: true },
      }));
      await createAnchorsJob(project, models, tasks, tier);
    } else {
      const tasks: RefreshTask[] = ids.map((id) => ({
        id,
        status: "pending",
        options: { restyle: true, useReference: true },
      }));
      await createRefreshJob(project, models, tasks, tier);
    }
  } catch (err) {
    onError(err);
  }
}

/**
 * Begin a transfer to the style already committed on the project. Returns false
 * when a gate refused it (quality tier, Sparks) so the caller can keep its
 * confirm dialog open.
 */
export async function startStyleRenew(
  project: Project,
  onError: (err: unknown) => void,
): Promise<boolean> {
  const { castIds, pageIds } = styleRenewTargets(project);
  if (castIds.length === 0 && pageIds.length === 0) return true;

  const tier = await requireImageTier();
  if (!tier) return false;
  if (!ensureStyleRenewAffordable(castIds.length, pageIds.length)) return false;

  const plan: StyleRenewPlan = {
    styleKey: targetStyleKey(project),
    phase: castIds.length > 0 ? "cast" : "pages",
    castIds,
    pageIds,
    startedAt: Date.now(),
  };
  await savePlan(plan);
  await runStyleRenewPhase(plan, onError);
  return true;
}

/** Move a finished cast phase on to pages (rendered against the new sheets). */
export async function advanceStyleRenew(
  plan: StyleRenewPlan,
  onError: (err: unknown) => void,
): Promise<void> {
  const next: StyleRenewPlan = { ...plan, phase: "pages" };
  await savePlan(next);
  await runStyleRenewPhase(next, onError);
}

/** Drop the plan — the transfer finished, or the reader stopped waiting on it. */
export async function clearStyleRenew(): Promise<void> {
  await savePlan(undefined);
}

/** Per-action counts for a Sparks estimate of what's left (covers priced apart). */
export function styleRenewEstimateParts(
  castCount: number,
  pageIds: string[],
): { action: ImageActionId; count: number }[] {
  const covers = pageIds.filter(isCoverUnit).length;
  return [
    { action: "anchorImage", count: castCount },
    { action: "pageIllustration", count: pageIds.length - covers },
    { action: "coverIllustration", count: covers },
  ].filter((p) => p.count > 0) as { action: ImageActionId; count: number }[];
}
