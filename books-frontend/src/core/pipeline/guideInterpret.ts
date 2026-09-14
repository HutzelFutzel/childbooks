/**
 * Turn what the reader typed into facts about the book.
 *
 * This is the one place in the guide where an unconstrained human sentence meets
 * a typed data structure, and the design follows from a single assumption: the
 * model will sometimes be wrong, and it must not matter. Three things hold that
 * up, and none of them is "the prompt is good":
 *
 *   1. **The model proposes; it never writes.** The patch this returns is
 *      `unknown` by type, and `applyGuidePatch` is the only thing that can turn it
 *      into a book. Unknown keys, artifact slots and out-of-world ids are refused
 *      there, so a hallucinated field is a logged rejection rather than a change.
 *   2. **The world is described by the validator.** The list of writable slots and
 *      their shapes comes from `guidePatchShapeLines`, generated from the writers
 *      themselves. The prompt cannot drift from what will be accepted.
 *   3. **Ids are re-checked after the call.** Skips are filtered against the live
 *      playlist, exactly as `resolveEditIntent` re-filters anchor ids — asking for
 *      a closed set is a hint, not a guarantee.
 *
 * Failure is a normal outcome, not an exception. A model that returns nonsense, or
 * doesn't return at all, degrades to "I didn't catch that" with an empty patch:
 * the engine still knows what's missing, so the conversation can continue from the
 * book's own state rather than from a lost turn.
 */
import { z } from "zod";
import type { ProviderId } from "../config/options";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { Project } from "../types";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import { withRetry } from "./retry";
import {
  GUIDE_SLOTS,
  GUIDE_SLOT_IDS,
  type GuideSlotId,
} from "../guide/slots";
import { GUIDE_COMPONENTS, isGuideComponentId, type GuideComponentId } from "../guide/components";
import type { ResolvedGuideComponent } from "../guide/playlist";
import { guidePatchShapeLines, type GuidePatchContext } from "../guide/patch";
import { nextGuideStep } from "../guide/engine";

/**
 * What kind of turn this was. The distinction that earns its keep is `revise`
 * versus `answer`: "make Maya 6" while the guide is asking about the art style is
 * an edit to a settled fact, not an answer to the question on screen, and treating
 * it as an answer is how a conversational flow starts feeling stupid.
 */
export type GuideTurnIntent = "answer" | "revise" | "skip" | "question" | "other";

export interface GuideTurn {
  role: "reader" | "guide";
  text: string;
}

export interface GuideTurnResult {
  intent: GuideTurnIntent;
  /**
   * Proposed slot writes. **Untrusted** — pass to `applyGuidePatch`, never merge.
   * Typed as `unknown` on purpose: there is no shape here worth believing, and a
   * type that claimed otherwise would invite exactly the merge this must prevent.
   */
  patch: Record<string, unknown>;
  /** Components the reader declined, already filtered to skippable ones. */
  skip: GuideComponentId[];
  /** What to say back. Empty when the model gave nothing usable. */
  reply: string;
  confidence: number;
}

export interface InterpretGuideTurnInput {
  project: Project;
  /** What the reader typed. */
  message: string;
  /** The components in play, so skips can be validated against the live flow. */
  playlist: readonly ResolvedGuideComponent[];
  /** Recent turns, oldest first, so "yes" and "the second one" resolve. */
  transcript?: GuideTurn[];
  /** The worlds a patch may name. See `core/guide/patch.ts`. */
  patchContext: GuidePatchContext;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

/**
 * The envelope is strict; the patch is not.
 *
 * `patch` is a bare record because its real schema lives in the writers, and a
 * second description of it here would be a second thing to keep in sync — the
 * failure mode being a slot that validates here, is dropped there, and looks to
 * the reader like the guide ignoring them.
 */
const turnSchema = z.object({
  intent: z.enum(["answer", "revise", "skip", "question", "other"]),
  patch: z.record(z.string(), z.unknown()).optional(),
  skip: z.array(z.string()).max(20).optional(),
  reply: z.string().max(1200),
  confidence: z.number().min(0).max(1),
});

/** How many turns of history to send. Enough for "yes"; not enough to drift. */
const TRANSCRIPT_WINDOW = 8;

/** The facts the book already carries, as the reader would recognise them. */
export function describeGuideFacts(project: Project): string {
  const lines = GUIDE_SLOT_IDS.map((id) => {
    const slot = GUIDE_SLOTS[id];
    const value = slot.describe(project);
    return `- ${id} (${slot.label}): ${value ?? "not set"}`;
  });
  return lines.join("\n");
}

function describeTranscript(turns: GuideTurn[]): string {
  if (turns.length === 0) return "(this is the first message)";
  return turns
    .slice(-TRANSCRIPT_WINDOW)
    .map((turn) => `${turn.role === "reader" ? "Reader" : "Guide"}: ${turn.text}`)
    .join("\n");
}

/**
 * Everything the prompt needs, derived from the book. Exported so the offline
 * checker can assert the prompt renders with no placeholder left unfilled —
 * a missing variable is otherwise only visible as a model that answers oddly.
 */
export function buildGuideTurnVars(
  input: Pick<
    InterpretGuideTurnInput,
    "project" | "message" | "playlist" | "transcript" | "patchContext"
  >,
): Record<string, string> {
  const cursor = nextGuideStep(input.playlist, input.project);
  const active = cursor.component;
  const optional = input.playlist
    .filter((component) => component.skippable)
    .map((component) => `"${component.id}"`)
    .join(" | ");

  return {
    asking: active
      ? `${active.id} — ${active.title}: ${active.purpose}`
      : "nothing; the book has everything it needs",
    askingSlots: active && active.slots.length > 0 ? active.slots.join(", ") : "(none)",
    blockers:
      cursor.blockers.length > 0 ? cursor.blockers.map((b) => `- ${b}`).join("\n") : "(nothing)",
    facts: describeGuideFacts(input.project),
    writable: guidePatchShapeLines(input.patchContext),
    skippable: optional || "(none)",
    transcript: describeTranscript(input.transcript ?? []),
    message: input.message.trim(),
  };
}

/**
 * Keep only what the live flow can act on.
 *
 * Skips are filtered twice over: the id has to name a real component, and that
 * component has to be one the playlist marks optional. Without the second check a
 * model that decides the reader doesn't want to name the child would skip the
 * question the book cannot be made without.
 */
export function sanitizeGuideTurn(
  raw: z.infer<typeof turnSchema>,
  playlist: readonly ResolvedGuideComponent[],
): GuideTurnResult {
  const optional = new Map(playlist.map((component) => [component.id, component.skippable]));
  const skip: GuideComponentId[] = [];
  for (const id of raw.skip ?? []) {
    if (!isGuideComponentId(id)) continue;
    if (optional.get(id) !== true) continue;
    if (!skip.includes(id)) skip.push(id);
  }

  // A patch is only forwarded for turns that claim to state a fact. A "question"
  // or "other" turn carrying writes is a model filling in blanks it was not given
  // — the commonest way an interpreter invents a child's age from thin air.
  const statesFacts = raw.intent === "answer" || raw.intent === "revise";

  return {
    intent: raw.intent,
    patch: statesFacts ? raw.patch ?? {} : {},
    skip,
    reply: raw.reply.trim(),
    confidence: raw.confidence,
  };
}

/** Nothing usable came back. The engine still knows what's missing. */
function emptyTurn(reply: string): GuideTurnResult {
  return { intent: "other", patch: {}, skip: [], reply, confidence: 0 };
}

/**
 * Interpret one message. Never throws for a model or provider failure — the
 * conversation has to survive a bad turn, and the book's state is the source of
 * truth either way.
 */
export async function interpretGuideTurn(
  input: InterpretGuideTurnInput,
): Promise<GuideTurnResult> {
  const message = input.message.trim();
  if (!message) return emptyTurn("");

  const provider = getTextProvider(input.providerId);
  const { system, user } = renderTextPrompt(
    resolvePromptsConfig(input.prompts),
    "guideInterpret/turn",
    { vars: buildGuideTurnVars({ ...input, message }) },
  );

  let raw: z.infer<typeof turnSchema>;
  try {
    raw = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          schema: turnSchema,
          temperature: 0,
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
  } catch {
    // Deliberately not rethrown: a failed interpretation is a turn the reader can
    // simply repeat, whereas an error surfaced here would look like the book
    // breaking. The route still records the turn, so the failure is visible to us.
    return emptyTurn("Sorry — I didn't catch that. Could you say it another way?");
  }

  return sanitizeGuideTurn(raw, input.playlist);
}

/** Slot ids named by a patch, for the turn log. Order follows the catalog. */
export function patchedSlotIds(patch: Record<string, unknown>): GuideSlotId[] {
  return GUIDE_SLOT_IDS.filter((id) => id in patch);
}

/** The component a turn was answering, for the turn log. */
export function activeComponentId(
  playlist: readonly ResolvedGuideComponent[],
  project: Project,
): GuideComponentId | null {
  return nextGuideStep(playlist, project).component?.id ?? null;
}

/** Human label for a component id, for admin surfaces reading the turn log. */
export function guideComponentTitle(id: GuideComponentId): string {
  return GUIDE_COMPONENTS[id].title;
}
