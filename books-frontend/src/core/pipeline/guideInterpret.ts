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
import {
  applyGuidePatch,
  guidePatchExampleLines,
  guidePatchShapeLines,
  type GuidePatchContext,
} from "../guide/patch";
import {
  claimsToPatch,
  disposeGuideClaims,
  guideClaimSchema,
  guideConfirmationQuestion,
  screenGuideClaims,
  REPAIRABLE_CLAIM_REFUSALS,
  type GuideClaim,
  type GuideClaimThresholds,
  type RefusedGuideClaim,
} from "../guide/claims";
import { nextGuideStep } from "../guide/engine";
import type { GuideCommandId } from "../guide/agent/ids";
import { commandPromptLines } from "../guide/agent/registry";
import { screenCommandCalls, type RawCommandCall, type RefusedCommand } from "../guide/agent/screen";
import type { CommandCall } from "../guide/agent/types";
import { castOf } from "../guide/agent/resolve";
import { portraitStatus } from "../guide/portrait";

/**
 * What kind of turn this was. The distinction that earns its keep is `revise`
 * versus `answer`: "make Maya 6" while the guide is asking about the art style is
 * an edit to a settled fact, not an answer to the question on screen, and treating
 * it as an answer is how a conversational flow starts feeling stupid.
 */
export type GuideTurnIntent = "answer" | "revise" | "skip" | "question" | "other";
export type GuideEntryRoute = "guided" | "own" | "uncertain";

export interface GuideTurn {
  role: "reader" | "guide";
  text: string;
}

export interface GuideTurnResult {
  intent: GuideTurnIntent;
  /**
   * How this message suggests starting a fresh book. Used only while the book has
   * no entry yet; later turns cannot silently switch how the story is authored.
   */
  route: GuideEntryRoute;
  /**
   * Proposed slot writes. **Untrusted** — pass to `applyGuidePatch`, never merge.
   * Typed as `unknown` on purpose: there is no shape here worth believing, and a
   * type that claimed otherwise would invite exactly the merge this must prevent.
   *
   * Derived from `claims`, one key per claim. Kept as the wire shape because the
   * client's only job is to hand it to the validator, and that has not changed.
   */
  patch: Record<string, unknown>;
  /** The facts behind the patch, each with the words that support it. */
  claims: GuideClaim[];
  /**
   * Everything the reader may have meant that did NOT reach the patch, and why.
   *
   * The most important field here for anyone debugging the guide. A turn that
   * writes nothing used to be indistinguishable from a turn the model never
   * understood; now the difference between "it proposed nothing", "it proposed a
   * field that does not exist" and "it quoted words the reader never typed" is
   * recorded rather than inferred.
   */
  refused: RefusedGuideClaim[];
  /** Slots to name explicitly in the reply because confidence was middling. */
  readBack: GuideSlotId[];
  /** A question to ask before overwriting a settled fact, when one is pending. */
  confirm: string | null;
  /** How many repair round-trips this turn cost. Zero on the happy path. */
  repairs: number;
  /** Components the reader declined, already filtered to skippable ones. */
  skip: GuideComponentId[];
  /** What to say back. Empty when the model gave nothing usable. */
  reply: string;
  /** How sure the model is about the INTENT. Per-fact certainty is on the claims. */
  confidence: number;
  /** Skill calls that passed screening, in the order the reader asked. Empty when skills are off. */
  commands: CommandCall[];
  /** Calls past the per-message limit. */
  overflowCommands: CommandCall[];
  /** Skill calls refused by screening, with the reason. For the turn log. */
  refusedCommands: RefusedCommand[];
  /** The language the message is written in (BCP-47 primary tag), when detected. */
  language: string | null;
  languageConfidence: number;
}

/** What the interpreter may do with skills this turn. Absent: skills are off. */
export interface GuideTurnSkills {
  enabled: readonly GuideCommandId[];
  floor: number;
  max: number;
  /** The open follow-up the guide just asked, for short replies ("5", "skip"). */
  pending?: string;
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
  /** Confidence gates. Admin-configurable; see `core/config/guide.ts`. */
  thresholds?: Partial<GuideClaimThresholds>;
  /** How many times a refused claim may be sent back for correction. */
  repairAttempts?: number;
  /** Sampling temperature. Zero unless an admin has a reason. */
  temperature?: number;
  skills?: GuideTurnSkills;
  /**
   * The story passage the reader has marked, already checked against the saved
   * story. It lets "make this nicer" find its skill; it is never a source of
   * evidence, which still has to be quoted from the message.
   */
  marked?: string;
  /**
   * The picture the reader has selected on the book ("Amanda's portrait"). It
   * says who "her" and "this" are; it never decides what the message asks.
   */
  selected?: string;
  signal?: AbortSignal;
}

/** How much of a marked passage the interpreter reads. */
const MARKED_PROMPT_CHARS = 600;

/** The marked passage as the prompt shows it: quoted, capped, and clearly not an instruction. */
export function describeMarkedPassage(marked: string | undefined): string {
  const text = marked?.replace(/"""/g, '"').trim();
  if (!text) return "(nothing marked)";
  const capped = text.length > MARKED_PROMPT_CHARS ? `${text.slice(0, MARKED_PROMPT_CHARS)}…` : text;
  return `"""\n${capped}\n"""`;
}

/**
 * The envelope is strict; the values inside the claims are not.
 *
 * A claim's `value` is `unknown` because its real schema lives in the writers, and
 * a second description of it here would be a second thing to keep in sync — the
 * failure mode being a slot that validates here, is dropped there, and looks to
 * the reader like the guide ignoring them.
 */
const turnSchema = z.object({
  intent: z.enum(["answer", "revise", "skip", "question", "other"]),
  route: z.enum(["guided", "own", "uncertain"]),
  claims: z.array(guideClaimSchema).max(24).optional(),
  skip: z.array(z.string()).max(20).optional(),
  reply: z.string().max(1200),
  confidence: z.number().min(0).max(1),
  commands: z
    .array(
      z.object({
        id: z.string().max(40),
        args: z.array(z.object({ name: z.string().max(40), value: z.string().max(800) })).max(8).optional(),
        evidence: z.string().max(600),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(12)
    .optional(),
  language: z.string().max(16).optional(),
  languageConfidence: z.number().min(0).max(1).optional(),
});

/** A repair returns corrected claims and nothing else; the turn is already read. */
const repairSchema = z.object({
  claims: z.array(guideClaimSchema).max(24),
});

/** Test and migration callers may omit the new route; production model output may not. */
type SanitizableGuideTurn = Omit<z.infer<typeof turnSchema>, "route"> & {
  route?: GuideEntryRoute;
};

/** The people in the book, as the interpreter needs them to resolve "her" and "the baby". */
export function describeGuidePeople(project: Project): string {
  const cast = castOf(project);
  if (cast.length === 0) return "(nobody yet)";
  return cast
    .map((member) => {
      const age =
        member.age !== undefined ? `${member.age}` : member.ageMonths !== undefined ? `${member.ageMonths} months` : "age not set";
      const role = member.role?.trim() ? `, ${member.role.trim()}` : "";
      const portrait = portraitStatus(project, member.id);
      const drawn = portrait === "current" ? "portrait drawn" : portrait === "stale" ? "portrait out of date" : "no portrait";
      return `- ${member.name.trim()} (${age}${role}; ${drawn}${member.likenessPhoto ? "; has a photo" : ""})`;
    })
    .join("\n");
}

function describePlaces(project: Project): string {
  const anchors = (project.anchors ?? []).filter((anchor) => anchor.type !== "character");
  if (anchors.length === 0) return "(none)";
  return anchors.map((anchor) => `- ${anchor.name}${anchor.include ? "" : " (not drawn)"}`).join("\n");
}

function screenTurnCommands(
  raw: SanitizableGuideTurn,
  message: string,
  skills: GuideTurnSkills | undefined,
): Pick<GuideTurnResult, "commands" | "overflowCommands" | "refusedCommands" | "language" | "languageConfidence"> {
  const language = typeof raw.language === "string" && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(raw.language.trim())
    ? raw.language.trim().slice(0, 2).toLowerCase()
    : null;
  const languageConfidence = language ? (raw.languageConfidence ?? 0) : 0;
  if (!skills || skills.enabled.length === 0) {
    return { commands: [], overflowCommands: [], refusedCommands: [], language, languageConfidence };
  }
  const screened = screenCommandCalls({
    raw: (raw.commands ?? []) as RawCommandCall[],
    message,
    enabled: skills.enabled,
    floor: skills.floor,
    max: skills.max,
  });
  return {
    commands: screened.kept,
    overflowCommands: screened.overflow,
    refusedCommands: screened.refused,
    language,
    languageConfidence,
  };
}

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
    "project" | "message" | "playlist" | "transcript" | "patchContext" | "skills" | "marked" | "selected"
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
    writable: guidePatchShapeLines(input.patchContext, input.project),
    examples: guidePatchExampleLines(),
    skippable: optional || "(none)",
    transcript: describeTranscript(input.transcript ?? []),
    message: input.message.trim(),
    people: describeGuidePeople(input.project),
    places: describePlaces(input.project),
    skills:
      input.skills && input.skills.enabled.length > 0
        ? commandPromptLines(input.skills.enabled)
        : "(none — never return commands)",
    pending: input.skills?.pending?.trim() || "(nothing)",
    marked: describeMarkedPassage(input.marked),
    selected: input.selected?.trim() || "(nothing selected)",
  };
}

/**
 * The refusals worth going back to the model about, written as instructions.
 *
 * Deliberately concrete: the slot, what it proposed, and the validator's own
 * words for why that was refused. A repair prompt that says "some claims were
 * invalid" produces a second guess; one that says `heroAges: no cast member named
 * Sam` produces a correction, because the model can see that it misheard a name
 * it has already written down.
 */
export function describeClaimProblems(refused: readonly RefusedGuideClaim[]): string {
  return refused
    .filter((claim) => REPAIRABLE_CLAIM_REFUSALS.includes(claim.refusal))
    .map(
      (claim) =>
        `- ${claim.slot} = ${JSON.stringify(claim.value)} (you quoted "${claim.evidence}") ` +
        `was refused: ${claim.reason}`,
    )
    .join("\n");
}

/**
 * Keep only what the live flow can act on.
 *
 * Skips are filtered twice over: the id has to name a real component, and that
 * component has to be one the playlist marks optional. Without the second check a
 * model that decides the reader doesn't want to name the child would skip the
 * question the book cannot be made without.
 */
export interface SanitizeGuideTurnOptions {
  playlist: readonly ResolvedGuideComponent[];
  /** The reader's message, verbatim. Claims are checked against it. */
  message: string;
  /** The live book, for deciding what a claim would overwrite. */
  project: Project;
  /** The worlds a claim may name, for the dry run. */
  patchContext: GuidePatchContext;
  thresholds?: Partial<GuideClaimThresholds>;
  skills?: GuideTurnSkills;
}

export function sanitizeGuideTurn(
  raw: SanitizableGuideTurn,
  options: SanitizeGuideTurnOptions,
): GuideTurnResult {
  const agent = screenTurnCommands(raw, options.message, options.skills);
  const optional = new Map(options.playlist.map((c) => [c.id, c.skippable]));
  const skip: GuideComponentId[] = [];
  for (const id of raw.skip ?? []) {
    if (!isGuideComponentId(id)) continue;
    if (optional.get(id) !== true) continue;
    if (!skip.includes(id)) skip.push(id);
  }

  const proposed = (raw.claims ?? []) as GuideClaim[];
  const refused: RefusedGuideClaim[] = [];

  /**
   * A question or an aside can still carry a fact. "How long does printing
   * take? Amira is 4" states an age. A one-word quotation does not: "what ages
   * do you support?" contains the word "ages", and "is Maya a good name?"
   * contains a name, and neither is the reader telling us who the book is for.
   * Skipping still states nothing.
   *
   * A dropped claim is recorded. This gate used to replace the patch with `{}`
   * and leave nothing behind, so a misclassified intent was indistinguishable
   * from a model that extracted nothing.
   */
  const statesFacts = raw.intent === "answer" || raw.intent === "revise";
  if (raw.intent === "skip") {
    for (const claim of proposed) {
      refused.push({
        slot: claim.slot,
        value: claim.value,
        evidence: claim.evidence,
        confidence: claim.confidence,
        refusal: "not-a-statement",
        reason: `a "skip" turn may not state facts`,
      });
    }
    return {
      intent: raw.intent,
      route: raw.route ?? "uncertain",
      patch: {},
      claims: [],
      refused,
      readBack: [],
      confirm: null,
      repairs: 0,
      skip,
      reply: raw.reply.trim(),
      confidence: raw.confidence,
      ...agent,
    };
  }

  // A story idea and a manuscript can contain the same words. The independent
  // route decision is therefore required before any exact text may become the
  // manuscript; otherwise one mistaken claim can silently turn a vivid brief
  // into the finished story and suppress drafting.
  const candidates =
    raw.route === "own"
      ? proposed
      : proposed.filter((claim) => {
          if (claim.slot !== "storyText") return true;
          refused.push({
            slot: claim.slot,
            value: claim.value,
            evidence: claim.evidence,
            confidence: claim.confidence,
            refusal: "not-a-statement",
            reason: `story text requires an own-words route`,
          });
          return false;
        });

  const screened = screenGuideClaims({
    message: options.message,
    claims: candidates,
    thresholds:
      options.thresholds?.floor !== undefined ? { floor: options.thresholds.floor } : undefined,
  });
  refused.push(...screened.refused);
  let keptClaims = screened.kept;
  if (!statesFacts) {
    const substantial = [];
    for (const claim of screened.kept) {
      const words = claim.evidence.trim().split(/\s+/).filter(Boolean);
      if (words.length < 2) {
        refused.push({
          slot: claim.slot,
          value: claim.value,
          evidence: claim.evidence,
          confidence: claim.confidence,
          refusal: "not-a-statement",
          reason: `a "${raw.intent}" turn needs more than one word of evidence to state a fact`,
        });
      } else {
        substantial.push(claim);
      }
    }
    if (substantial.length === 0) {
      return {
        intent: raw.intent,
        route: raw.route ?? "uncertain",
        patch: {},
        claims: [],
        refused,
        readBack: [],
        confirm: null,
        repairs: 0,
        skip,
        reply: raw.reply.trim(),
        confidence: raw.confidence,
        ...agent,
      };
    }
    keptClaims = substantial;
  }

  /**
   * The dry run. `applyGuidePatch` is pure and returns a new project, so asking it
   * what would happen costs nothing and is exact — no second copy of the
   * validation rules that could disagree with the real write.
   *
   * This is what makes repair possible. Without it the first time anyone learns a
   * claim is unacceptable is in the browser, after the model has gone.
   */
  const dry = applyGuidePatch(
    options.project,
    claimsToPatch(keptClaims),
    options.patchContext,
  );
  const rejectedSlots = new Map(dry.rejected.map((rejection) => [rejection.key, rejection]));
  const rerouting: { claim: GuideClaim; reason: string; command: NonNullable<SanitizableGuideTurn["commands"]>[number] }[] = [];
  const survived = keptClaims.filter((claim) => {
    const rejection = rejectedSlots.get(claim.slot);
    // A partial refusal still applied something, so the claim survives; the part
    // that did not stick is reported by the real write, in the reader's words.
    if (!rejection || dry.applied.includes(claim.slot)) return true;
    if (rejection.reroute) {
      // Settled below, once the skill calls have been screened.
      rerouting.push({
        claim,
        reason: rejection.reason,
        command: {
          id: rejection.reroute.command,
          args: Object.entries(rejection.reroute.args).map(([name, value]) => ({ name, value })),
          evidence: claim.evidence,
          confidence: claim.confidence,
        },
      });
      return false;
    }
    refused.push({
      slot: claim.slot,
      value: claim.value,
      evidence: claim.evidence,
      confidence: claim.confidence,
      refusal: "rejected",
      reason: rejection.reason,
    });
    return false;
  });

  /**
   * Facts that only a skill may change, filed as that skill's call.
   *
   * "Change the art style to watercolor" can reach here as a fact, and for a
   * book whose look is the reader's drawing a fact write would drop the drawing
   * without asking. The writer refuses it and names the skill that asks first;
   * the same words go through the usual screening as that skill's call, so the
   * planner's confirmation applies unchanged. A call the model made itself is
   * not doubled, and a request no skill took is a plain refusal.
   */
  let turnAgent = agent;
  if (rerouting.length > 0) {
    const asked = new Set([...agent.commands, ...agent.overflowCommands].map((call) => call.id as string));
    const added = rerouting.filter((entry) => !asked.has(String(entry.command.id))).map((entry) => entry.command);
    if (added.length > 0) {
      turnAgent = screenTurnCommands({ ...raw, commands: [...(raw.commands ?? []), ...added] }, options.message, options.skills);
    }
    const filedIds = new Set([...turnAgent.commands, ...turnAgent.overflowCommands].map((call) => call.id as string));
    for (const entry of rerouting) {
      const filed = filedIds.has(String(entry.command.id));
      refused.push({
        slot: entry.claim.slot,
        value: entry.claim.value,
        evidence: entry.claim.evidence,
        confidence: entry.claim.confidence,
        refusal: filed ? "rerouted" : "rejected",
        reason: filed ? `${entry.reason}; asked as the ${entry.command.id} skill` : entry.reason,
      });
    }
  }

  const disposed = disposeGuideClaims({
    project: options.project,
    claims: survived,
    thresholds: options.thresholds,
  });
  refused.push(...disposed.refused);

  const taken = disposed.taken.map((entry) => entry.claim);
  return {
    intent: raw.intent,
    route: raw.route ?? "uncertain",
    patch: claimsToPatch(taken),
    claims: taken,
    refused,
    readBack: disposed.taken
      .filter((entry) => entry.disposition === "readBack")
      .map((entry) => entry.claim.slot),
    confirm: guideConfirmationQuestion(options.project, refused),
    repairs: 0,
    skip,
    reply: raw.reply.trim(),
    confidence: raw.confidence,
    ...turnAgent,
  };
}

/** Nothing usable came back. The engine still knows what's missing. */
function emptyTurn(reply: string): GuideTurnResult {
  return {
    intent: "other",
    route: "uncertain",
    patch: {},
    claims: [],
    refused: [],
    readBack: [],
    confirm: null,
    repairs: 0,
    skip: [],
    reply,
    confidence: 0,
    commands: [],
    overflowCommands: [],
    refusedCommands: [],
    language: null,
    languageConfidence: 0,
  };
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
  const prompts = resolvePromptsConfig(input.prompts);
  const vars = buildGuideTurnVars({ ...input, message });
  const { system, user } = renderTextPrompt(prompts, "guideInterpret/turn", { vars });
  const options: SanitizeGuideTurnOptions = {
    playlist: input.playlist,
    message,
    project: input.project,
    patchContext: input.patchContext,
    thresholds: input.thresholds,
    skills: input.skills,
  };

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
          temperature: input.temperature ?? 0,
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

  let result = sanitizeGuideTurn(raw, options);

  /**
   * One more try, with the validator's objections in hand.
   *
   * The repair exists because the commonest extraction failure is not a model that
   * misunderstood the reader — it is a model that understood perfectly and
   * expressed it in a shape the validator does not take. Those are recoverable and
   * used to be thrown away: the whole patch was dropped, the turn reported nothing
   * applied, and the reader was told they had not been understood.
   *
   * Bounded at `repairAttempts` (default one) and only ever for refusals a
   * correction could fix, so a model that is simply wrong cannot spend the
   * reader's latency budget arguing with the schema. Claims that already landed
   * are kept — a repair may only add to what worked, never undo it.
   */
  const budget = input.repairAttempts ?? 1;
  for (let attempt = 0; attempt < budget; attempt += 1) {
    const problems = describeClaimProblems(result.refused);
    if (!problems) break;

    let repaired: z.infer<typeof repairSchema>;
    try {
      const repairPrompt = renderTextPrompt(prompts, "guideInterpret/repair", {
        vars: { ...vars, problems, kept: JSON.stringify(result.patch) },
      });
      repaired = await provider.generateStructured(input.creds, {
        model: input.model,
        messages: [
          { role: "system", content: repairPrompt.system },
          { role: "user", content: repairPrompt.user },
        ],
        schema: repairSchema,
        temperature: input.temperature ?? 0,
        signal: input.signal,
      });
    } catch {
      break; // A failed repair leaves the first reading intact, which is the point.
    }

    const merged = sanitizeGuideTurn(
      { ...raw, claims: [...result.claims, ...repaired.claims] },
      options,
    );
    // Only accept a repair that actually recovered something. A model that
    // re-proposes the same refused claim would otherwise loop, and a model that
    // drops a good claim while fixing a bad one would make the turn worse.
    if (merged.claims.length <= result.claims.length) break;
    // A fact filed as a skill's call lives in the commands, not the claims, and
    // the merged read only holds the claims: keep the first read's calls.
    const rerouted = result.refused.filter((claim) => claim.refusal === "rerouted");
    result = {
      ...merged,
      repairs: attempt + 1,
      ...(rerouted.length > 0
        ? {
            commands: result.commands,
            overflowCommands: result.overflowCommands,
            refusedCommands: result.refusedCommands,
            refused: [...merged.refused, ...rerouted],
          }
        : {}),
    };
  }

  return result;
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
