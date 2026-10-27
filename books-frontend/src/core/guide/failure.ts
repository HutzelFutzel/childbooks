/**
 * Why a guide turn could not be read, in a form the rest of the system can act on.
 *
 * A turn the interpreter could not read used to look the same as any other turn
 * with nothing in it: a caught error became "Sorry — I didn't catch that", the
 * cause was thrown away, and the one outage that lasted for days (a model that
 * refuses a setting) read as a parent who kept being unclear. Naming the cause
 * is what lets the code choose between trying again, saying so, and telling us.
 */
import { ProviderError, errorForLog } from "../errors";

export type GuideFailureKind =
  /** The provider did not answer in time, or the request's own deadline passed. */
  | "timeout"
  /** Someone stopped the request (the reader sent another message, or left). */
  | "stopped"
  /** The provider refused or failed the request: a bad setting, a key, an outage. */
  | "provider"
  /** The model answered, but not in a shape that could be used. */
  | "invalid-output"
  | "unknown";

export interface GuideFailure {
  kind: GuideFailureKind;
  /** The provider's own words, short, for the log. Never shown to a reader. */
  detail: string;
}

export function classifyGuideFailure(error: unknown, signal?: AbortSignal): GuideFailure {
  const detail = errorForLog(error).slice(0, 400);
  if (error instanceof ProviderError) {
    if (error.kind === "parse") return { kind: "invalid-output", detail };
    if (error.kind === "timeout") return { kind: "timeout", detail };
    if (error.kind === "aborted") return { kind: signal?.aborted ? "stopped" : "timeout", detail };
    return { kind: "provider", detail };
  }
  const name = (error as { name?: string } | null)?.name;
  if (name === "TimeoutError") return { kind: "timeout", detail };
  if (name === "AbortError") return { kind: signal?.aborted ? "stopped" : "timeout", detail };
  return { kind: "unknown", detail };
}

/** Whether asking the same model again, once, has a real chance of a different answer. */
export function worthAskingAgain(failure: GuideFailure): boolean {
  return failure.kind === "invalid-output";
}

/** What the model is told when its previous answer could not be used. */
export function answerAgainReminder(failure: GuideFailure): string {
  return `Your previous answer could not be used (${failure.detail.slice(0, 200)}). Answer again with ONLY the JSON object the schema describes, and nothing else.`;
}
