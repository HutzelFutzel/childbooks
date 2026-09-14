/**
 * The engine: given a playlist and a book, what should the guide do next?
 *
 * One pure function, no state of its own. That is the whole design. A
 * conversational flow is tempting to model as a machine that remembers which step
 * it is on, and that model breaks the first time the book changes underneath it —
 * a job finishes on the server, the reader edits a fact from three questions ago,
 * a second tab saves. Deriving the answer from the book instead means there is no
 * cursor to invalidate: the same project always produces the same next step, on
 * any device, after any reload.
 *
 * It also means the ordering is data. An admin reordering the playlist changes
 * the flow with no code change, and the reason that is safe is that this function
 * never assumes an order — it asks the catalog whether each component's
 * requirements hold (see {@link isComponentSatisfied}), so a legal reorder cannot
 * produce a step whose inputs are missing.
 */
import { isComponentSatisfied, type GuideComponentId } from "./components";
import type { ResolvedGuideComponent } from "./playlist";
import type { Project } from "../types";

export type GuideCursorStatus = "ask" | "blocked" | "done";

export interface GuideCursor {
  /** The component to work on, or null when there is nothing left to ask. */
  component: ResolvedGuideComponent | null;
  status: GuideCursorStatus;
  /**
   * For `blocked`: the requirement that isn't met. Only reachable when the reader
   * skipped it or an admin switched it off — otherwise the walk would have
   * returned that component first.
   */
  blockedBy?: GuideComponentId;
  /** For `ask` and `blocked`: what to tell the reader is missing. */
  blockers: string[];
}

export interface GuideProgress {
  /** Components that count towards completion (terminal ones don't). */
  total: number;
  satisfied: number;
  /** Skipped-and-unsatisfied components, which is why `satisfied` can stall. */
  skipped: number;
  ratio: number;
}

/**
 * The next component the guide should work on.
 *
 * Walks the playlist in order and returns the first component that is neither
 * satisfied nor declined. Satisfied components are stepped over silently, which is
 * what makes the function work equally well for a fresh book, a book returning
 * from the old wizard, and a book whose reader just changed one fact three
 * questions back.
 */
export function nextGuideStep(
  playlist: readonly ResolvedGuideComponent[],
  project: Project,
  skipped: Iterable<GuideComponentId> = [],
): GuideCursor {
  const declined = new Set(skipped);
  // Memoized: several components share predicates that walk every version tree
  // in the book, and a requirement is checked once per dependent otherwise.
  const satisfaction = new Map<GuideComponentId, boolean>();
  const satisfied = (id: GuideComponentId): boolean => {
    const hit = satisfaction.get(id);
    if (hit !== undefined) return hit;
    const value = isComponentSatisfied(id, project);
    satisfaction.set(id, value);
    return value;
  };

  for (const component of playlist) {
    if (satisfied(component.id)) continue;
    if (component.skippable && declined.has(component.id)) continue;

    const missing = component.requires.find((required) => !satisfied(required));
    if (missing) {
      return {
        component,
        status: "blocked",
        blockedBy: missing,
        blockers: component.blockers(project),
      };
    }
    return { component, status: "ask", blockers: component.blockers(project) };
  }

  return { component: null, status: "done", blockers: [] };
}

/**
 * How far through the book the reader is.
 *
 * Terminal components are excluded so the bar can actually reach full, and
 * declined ones are counted separately rather than as done — a reader who skipped
 * the story idea has not written a story idea, and a bar that claimed otherwise
 * would be the kind of progress indicator nobody trusts.
 */
export function guideProgress(
  playlist: readonly ResolvedGuideComponent[],
  project: Project,
  skipped: Iterable<GuideComponentId> = [],
): GuideProgress {
  const declined = new Set(skipped);
  const counted = playlist.filter((component) => !component.terminal);
  let satisfied = 0;
  let skippedCount = 0;
  for (const component of counted) {
    if (isComponentSatisfied(component.id, project)) satisfied += 1;
    else if (component.skippable && declined.has(component.id)) skippedCount += 1;
  }
  const total = counted.length;
  return {
    total,
    satisfied,
    skipped: skippedCount,
    ratio: total === 0 ? 0 : satisfied / total,
  };
}

/**
 * Every component's state at once, for the progress rail and the facts strip.
 * One pass, so a surface that renders the whole flow doesn't re-run each
 * predicate per row.
 */
export function guideOutline(
  playlist: readonly ResolvedGuideComponent[],
  project: Project,
  skipped: Iterable<GuideComponentId> = [],
): {
  component: ResolvedGuideComponent;
  state: "satisfied" | "skipped" | "pending" | "active";
}[] {
  const declined = new Set(skipped);
  const active = nextGuideStep(playlist, project, skipped).component?.id;
  return playlist.map((component) => ({
    component,
    state: isComponentSatisfied(component.id, project)
      ? "satisfied"
      : component.id === active
        ? "active"
        : component.skippable && declined.has(component.id)
          ? "skipped"
          : "pending",
  }));
}
