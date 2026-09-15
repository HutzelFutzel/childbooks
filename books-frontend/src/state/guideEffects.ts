/**
 * Starting generation from the conversation.
 *
 * The guide's whole promise is that it does the work, so it has to be able to kick
 * off a story draft, the cast sheets, the page plan and the page art. All four
 * already have entry points that handle the Sparks gate, the model resolution, the
 * Cloud Tasks fan-out and the durable job documents — so this routes to them rather
 * than growing a second way to generate a book. A second path is how one flow starts
 * charging differently from the other.
 *
 * **Why this is a module and not a hook.** The existing callers reach the generators
 * through `useStudio()`, but the chat pane is a sibling of the studio workspace and
 * sits outside that provider. Rather than restructure the tree (or mount a bridge
 * component whose only job is to smuggle callbacks out of a context), this calls the
 * generators directly: every one of them already takes the project explicitly, and
 * the two things the context supplied are avoidable —
 *
 *   - `setAnchorGenerating` / `setPageGenerating` paint the wizard's per-unit
 *     spinners. The guide reads `jobsStore.activeUnitIds` instead, which is the same
 *     information recovered from live job state, so it survives a reload where the
 *     context's own flags do not.
 *   - `startGeneration()` supplies a shared abort signal for the wizard's Cancel
 *     button. The guide has no cancel affordance yet, so it owns a controller per
 *     run; `cancel` below is what a future one will call.
 *
 * One caveat, inherited rather than introduced: a story drafted here writes through
 * the projects store, not through `StudioContext.updateStory`, so it does not land on
 * the manuscript editor's own in-memory undo stack. The guide's `storyText` slot has
 * written that way since the patch layer existed, and the projects store's undo does
 * cover it.
 */
import { isAbortError } from "../core/errors";
import type { GuideEffectId } from "../core/guide/components";
import { storyBriefSignature, briefOf, isBriefReady } from "../core/story/brief";
import { storyDraftRemote } from "../platform/aiClient";
import { generateAllAnchors, generateAllPages } from "../ui/studio/studioGen";
import { notify } from "../ui/lib/notify";
import { useJobsStore } from "./jobsStore";
import { useProjectsStore } from "./projectsStore";

/**
 * Runs in flight, by effect. Module state rather than store state because it is not
 * rendered: the guide shows progress from `guideEffectState`, which reads the book
 * and the job documents. This exists only to stop a second start while the first is
 * still going — the reader tapping twice, or an auto-start firing on a re-render.
 */
const running = new Map<GuideEffectId, AbortController>();

/** Whether the story draft is in flight. The one effect with no job document. */
export function guideEffectDrafting(): boolean {
  return running.has("storyDraft");
}

export function cancelGuideEffect(effect: GuideEffectId): void {
  running.get(effect)?.abort();
  running.delete(effect);
}

/**
 * Start one effect. Resolves when the work is *enqueued* (or, for the story draft,
 * when it is written) — not when a whole batch of pictures has rendered, which is the
 * point of the jobs being durable.
 *
 * Returns whether anything was started, so a caller can stay quiet rather than
 * narrating a run that a gate refused.
 */
export async function startGuideEffect(effect: GuideEffectId): Promise<boolean> {
  if (running.has(effect)) return false;

  const project = useProjectsStore.getState().current();
  if (!project) return false;

  const controller = new AbortController();
  running.set(effect, controller);
  try {
    switch (effect) {
      case "storyDraft":
        return await draftStory(controller.signal);
      case "screenplay":
        // The store owns retry accounting and the "already running" check, so a
        // retry here is an explicit reader request rather than an auto-recovery.
        await useJobsStore.getState().startScreenplay(project, true);
        return true;
      case "castArt": {
        const outcome = await generateAllAnchors(
          project,
          () => {},
          reportUnlessAborted,
          controller.signal,
        );
        return outcome.started;
      }
      case "pageArt": {
        const outcome = await generateAllPages(
          project,
          () => {},
          reportUnlessAborted,
          controller.signal,
        );
        return outcome.started;
      }
    }
  } catch (err) {
    reportUnlessAborted(err);
    return false;
  } finally {
    running.delete(effect);
  }
}

function reportUnlessAborted(err: unknown): void {
  if (isAbortError(err)) return;
  notify.error(err);
}

/**
 * Write the story from the brief the conversation has assembled.
 *
 * Mirrors `ui/studio/story/useStoryDraft.ts` in what it stores, and deliberately so:
 * `generatedSignature` is what every staleness check downstream compares against, so
 * a draft written here has to be stamped exactly as one written in the story step or
 * the book would look permanently out of date.
 */
async function draftStory(signal: AbortSignal): Promise<boolean> {
  const project = useProjectsStore.getState().current();
  if (!project) return false;

  const brief = briefOf(project.config);
  // The guide should not have reached the draft without these, but the reader can
  // also arrive by URL or from the wizard — so this refuses rather than sending a
  // half-empty brief to the model and charging for the result.
  if (!isBriefReady(brief)) return false;

  const draft = await storyDraftRemote(project, brief);
  if (signal.aborted) return false;

  const live = useProjectsStore.getState().current();
  if (!live || live.id !== project.id) return false;

  const isFirstDraft = !live.config.storyText.trim();
  const { ageRangeId, readingModeId, contentLocale } = live.config;

  await useProjectsStore.getState().patchCurrent((current) => ({
    ...current,
    config: {
      ...current.config,
      storyText: draft.story,
      storyBrief: {
        ...brief,
        generatedAt: Date.now(),
        generatedSignature: storyBriefSignature(
          brief,
          ageRangeId,
          readingModeId,
          contentLocale,
        ),
        generatedForAge: ageRangeId,
        generatedForLocale: contentLocale,
      },
    },
    ...(isFirstDraft && draft.title ? { title: draft.title } : {}),
  }));

  return true;
}
