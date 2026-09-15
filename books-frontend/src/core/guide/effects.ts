/**
 * Generation, as something the reader can watch.
 *
 * Four components produce rather than ask — the story draft, the cast sheets, the
 * page plan, the page art — and all four take long enough that the tab may be
 * closed before they finish. The wizard handles that with per-surface spinners and
 * toolbar chips; the guide has one narrow pane, so it needs one answer to "what is
 * happening, how far along is it, and can I do anything about it".
 *
 * **Progress is derived from the book, not from a job.** `done` counts sheets that
 * exist and pages that are finished, so it is correct after a refresh, on another
 * device, and for a book generated in the wizard yesterday. Live job state only
 * distinguishes *running* from *not started*: it says whether someone is currently
 * working on the gap, never how big the gap is. Getting that the other way round is
 * how a progress bar ends up resetting to zero when the tab reloads.
 *
 * **Nothing here starts anything.** This module is pure and total, which is what
 * lets `scripts/guide-effect-invariants.ts` walk every effect against every
 * synthesized book. Starting lives in `state/guideEffects.ts`, where the generators
 * and their Sparks gates already are.
 */
import { illustrationUnits } from "../book/units";
import { unitIsDone } from "../book/pageCompletion";
import { currentAnchorImage } from "../pipeline/provenance";
import type { Project } from "../types";
import { storySettled, type GuideEffectId } from "./components";

/**
 * What the client knows that the book cannot tell us: whether work is in flight
 * right now. Deliberately minimal — anything derivable from the project is derived,
 * not passed in, so a caller cannot report progress that contradicts the book.
 */
export interface GuideEffectSignals {
  /**
   * Ids of units a live job is working on (`jobsStore.activeUnitIds`). Anchor ids
   * and spread ids share this space, which is why it is one set.
   */
  activeUnitIds?: ReadonlySet<string>;
  /** The latest durable screenplay attempt (`jobsStore.screenplayJob`). */
  screenplay?: { status: "pending" | "running" | "done" | "error"; error?: string } | null;
  /**
   * Whether the story draft request is in flight. Unlike the other three, drafting
   * is a single synchronous call with no job document, so its "running" cannot be
   * recovered after a reload — see {@link GuideEffectState.resumable}.
   */
  drafting?: boolean;
}

export type GuideEffectStatus =
  /** Nothing to do: the artifact is already there. */
  | "done"
  /** Work is in flight. */
  | "running"
  /** Something is missing and nothing is working on it. */
  | "idle"
  /** The last attempt failed and said why. */
  | "failed";

export interface GuideEffectState {
  effect: GuideEffectId;
  status: GuideEffectStatus;
  /** Units finished. Counted from the book, so it survives a reload. */
  done: number;
  /** Units wanted. Zero total means the effect has nothing to make yet. */
  total: number;
  /** One line for the reader. Never empty. */
  label: string;
  /**
   * Whether offering a start (or retry) button is honest. False while work is in
   * flight and false when there is nothing left to make — a button that enqueues a
   * second job for pages already being drawn spends Sparks on duplicates.
   */
  resumable: boolean;
  /** Provider message from a failed attempt, when there is one. */
  error?: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Included cast members and how many have a current sheet. */
function castCounts(project: Project): { done: number; total: number; pendingIds: string[] } {
  const anchors = (project.anchors ?? []).filter((anchor) => anchor.include);
  const pendingIds = anchors.filter((anchor) => !currentAnchorImage(anchor)).map((a) => a.id);
  return { done: anchors.length - pendingIds.length, total: anchors.length, pendingIds };
}

/** Illustration units and how many are finished. */
function pageCounts(project: Project): { done: number; total: number; pendingIds: string[] } {
  const units = illustrationUnits(project);
  const pendingIds = units.filter((unit) => !unitIsDone(project, unit)).map((unit) => unit.id);
  return { done: units.length - pendingIds.length, total: units.length, pendingIds };
}

/** Whether a live job is working on any of these units. */
function anyActive(ids: readonly string[], active?: ReadonlySet<string>): boolean {
  return Boolean(active && ids.some((id) => active.has(id)));
}

/**
 * The state of one effect for one book.
 *
 * Total by construction: every effect returns a state for every project, including
 * books that have no cast and no pages yet, because the guide asks for this on every
 * render and a missing case would be a blank pane.
 */
export function guideEffectState(
  effect: GuideEffectId,
  project: Project,
  signals: GuideEffectSignals = {},
): GuideEffectState {
  switch (effect) {
    case "storyDraft": {
      const written = storySettled(project);
      if (written) {
        return {
          effect,
          status: "done",
          done: 1,
          total: 1,
          label: "The story is written.",
          resumable: false,
        };
      }
      if (signals.drafting) {
        return {
          effect,
          status: "running",
          done: 0,
          total: 1,
          label: "Writing the story…",
          resumable: false,
        };
      }
      return {
        effect,
        status: "idle",
        done: 0,
        total: 1,
        label: "Ready to write the story.",
        // The one effect with no durable job: if the tab closed mid-draft there is
        // nothing to resume, so offering to write it again is the correct answer.
        resumable: true,
      };
    }

    case "screenplay": {
      if (project.screenplay) {
        return {
          effect,
          status: "done",
          done: 1,
          total: 1,
          label: "The pages are planned.",
          resumable: false,
        };
      }
      const job = signals.screenplay;
      if (job?.status === "error") {
        return {
          effect,
          status: "failed",
          done: 0,
          total: 1,
          label: "Planning the pages didn't finish.",
          resumable: true,
          ...(job.error ? { error: job.error } : {}),
        };
      }
      if (job?.status === "pending" || job?.status === "running") {
        return {
          effect,
          status: "running",
          done: 0,
          total: 1,
          label: "Turning the story into pages…",
          resumable: false,
        };
      }
      return {
        effect,
        status: "idle",
        done: 0,
        total: 1,
        label: "Ready to lay out the pages.",
        resumable: true,
      };
    }

    case "castArt": {
      const { done, total, pendingIds } = castCounts(project);
      if (total === 0) {
        return {
          effect,
          status: "idle",
          done: 0,
          total: 0,
          // Not "done": there is no cast because the story hasn't been read for one
          // yet, and calling that finished would be a lie the reader can see through.
          label: "No characters or places to draw yet.",
          resumable: false,
        };
      }
      if (pendingIds.length === 0) {
        return {
          effect,
          status: "done",
          done,
          total,
          label: `All ${plural(total, "character or place", "characters and places")} drawn.`,
          resumable: false,
        };
      }
      const running = anyActive(pendingIds, signals.activeUnitIds);
      return {
        effect,
        status: running ? "running" : "idle",
        done,
        total,
        label: running
          ? `Drawing ${plural(pendingIds.length, "character or place", "characters and places")}…`
          : `${plural(pendingIds.length, "character or place", "characters and places")} still to draw.`,
        resumable: !running,
      };
    }

    case "pageArt": {
      const { done, total, pendingIds } = pageCounts(project);
      if (total === 0) {
        return {
          effect,
          status: "idle",
          done: 0,
          total: 0,
          label: "No pages to illustrate yet.",
          resumable: false,
        };
      }
      if (pendingIds.length === 0) {
        return {
          effect,
          status: "done",
          done,
          total,
          label: `All ${plural(total, "page", "pages")} illustrated.`,
          resumable: false,
        };
      }
      const running = anyActive(pendingIds, signals.activeUnitIds);
      return {
        effect,
        status: running ? "running" : "idle",
        done,
        total,
        label: running
          ? `Illustrating ${plural(pendingIds.length, "page", "pages")}…`
          : `${plural(pendingIds.length, "page", "pages")} still to illustrate.`,
        resumable: !running,
      };
    }
  }
}

/**
 * The unit ids an effect still has to produce.
 *
 * Exported because "which units are outstanding" is the question both a caller
 * building live signals and a staleness check need to ask, and because deriving it a
 * second time from `illustrationUnits`/`currentAnchorImage` elsewhere is how two
 * counts of the same thing start to disagree. Single-unit effects report a synthetic
 * id: they have no unit space of their own, and an empty array would read as "nothing
 * outstanding".
 */
export function guideEffectPending(effect: GuideEffectId, project: Project): string[] {
  switch (effect) {
    case "storyDraft":
      return storySettled(project) ? [] : ["story"];
    case "screenplay":
      return project.screenplay ? [] : ["screenplay"];
    case "castArt":
      return castCounts(project).pendingIds;
    case "pageArt":
      return pageCounts(project).pendingIds;
  }
}

/**
 * Progress as a fraction, for a bar. Null when there is nothing to measure.
 *
 * A single-unit effect has no meaningful middle, so it reports null rather than
 * jumping 0 → 100: a bar that is only ever empty or full is a worse spinner.
 */
export function guideEffectFraction(state: GuideEffectState): number | null {
  if (state.total <= 1) return null;
  return state.done / state.total;
}
