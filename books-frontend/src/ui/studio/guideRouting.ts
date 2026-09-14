/**
 * The bridge: the engine's answer expressed as a wizard destination.
 *
 * While both flows ship, the guide has no UI of its own yet — so this is how the
 * engine gets exercised against real books before anything visual depends on it.
 * The wizard keeps every screen it has; only the choice of WHICH screen to land on
 * moves from `computeProgress`'s hand-written precedence to
 * {@link nextGuideStep}.
 *
 * Doing it in this order is the point. If the engine and the wizard disagree about
 * what comes next, that shows up here as a reader being sent somewhere odd — with
 * the old UI intact around them and the flag limited to admins — rather than
 * later, tangled up with a new chat surface where it would be impossible to tell
 * which half is wrong. `scripts/guide-invariants.ts` pins the disagreements down to
 * an exact list.
 *
 * Deliberately NOT a navigation authority: this only supplies the DEFAULT landing
 * destination. Explicit navigation still wins, and the caller still passes the
 * result through `fallbackDestination`, so the engine can never send a reader
 * somewhere the wizard hasn't unlocked.
 *
 * @legacy guide-v2 — scaffolding, not a destination. Exists only to translate the
 * engine's answer into the old UI's vocabulary, and is deleted with that UI.
 */
import type { Project } from "../../core/types";
import type { GuideComponentId } from "../../core/guide/components";
import { nextGuideStep } from "../../core/guide/engine";
import type { ResolvedGuideComponent } from "../../core/guide/playlist";
import type { StudioDestination } from "./studioRoutes";

/**
 * The catalog's `legacyDestination` values and the wizard's destinations are the
 * same set. Checked here rather than assumed, so adding a destination to one
 * without the other fails at compile time.
 */
type DestinationsMatch = ResolvedGuideComponent["legacyDestination"] extends StudioDestination
  ? StudioDestination extends ResolvedGuideComponent["legacyDestination"]
    ? true
    : never
  : never;
const _destinationsMatch: DestinationsMatch = true;
void _destinationsMatch;

/**
 * Where the guide would put this reader, or null when it has nothing to say —
 * every component is satisfied, and the wizard's own default stands. A finished
 * book is the case that reaches null-adjacent territory: the terminal `review`
 * component answers `order`, and `fallbackDestination` holds it on the pages if
 * the reader hasn't earned that yet.
 */
export function guideDestination(
  project: Project,
  playlist: readonly ResolvedGuideComponent[],
  skipped: readonly GuideComponentId[] = [],
): StudioDestination | null {
  const cursor = nextGuideStep(playlist, project, skipped);
  return cursor.component?.legacyDestination ?? null;
}
