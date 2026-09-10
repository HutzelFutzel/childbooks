/**
 * The audience configuration currently in force, as a module-level snapshot.
 *
 * Most code reads age bands through an explicitly passed config, which is the
 * honest way to do it. A handful of callers can't: the wizard's Zod schema, the
 * step-completion predicates and the review summary are pure functions of a
 * `BookConfig` with nowhere to thread a second argument, and rewriting all four
 * signatures to carry configuration into a validator is worse than this.
 *
 * The app-config store publishes here on every snapshot, so the answer is the
 * live one. Before the first snapshot arrives it's the shipped catalog, which
 * is the correct starting point rather than a guess.
 */
import type { AudienceSource } from "./audience";

let active: AudienceSource = {};

/** Called by the app-config store whenever a relevant document changes. */
export function setActiveAudienceSource(source: AudienceSource): void {
  active = source;
}

export function activeAudienceSource(): AudienceSource {
  return active;
}
