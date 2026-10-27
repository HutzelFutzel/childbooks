/**
 * Invariants for a guide that cannot read a message, and for the settings that make it unable to.
 *
 * What a parent would notice, and what these hold:
 *
 * - a model that refuses a reasoning level is never sent that level again, and a refusal
 *   we did not know about is recognised, remembered and answered with the next level up;
 * - a turn that could not be read says why (and the reason is on the result, not in a swallowed catch);
 * - only an unusable answer is asked for twice, once, with the reason; a refused setting or a passed
 *   deadline is not retried;
 * - a recorded model answer that left out the people the parent named is sent back for them, so the
 *   conversation that once ended in "Who should be in the story?" ends with the people in the book;
 * - "papa and anne" in lowercase is still two people to ask about.
 *
 * Offline and deterministic: the provider is replaced by recorded answers.
 */
import { ProviderError } from "../books-frontend/src/core/errors";
import { classifyGuideFailure, worthAskingAgain } from "../books-frontend/src/core/guide/failure";
import { likelyPeople } from "../books-frontend/src/core/guide/mentions";
import { guidePatchContext } from "../books-frontend/src/core/guide/patch";
import { createDefaultGuidePlaylist, resolveGuidePlaylist } from "../books-frontend/src/core/guide/playlist";
import { withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { interpretGuideTurn } from "../books-frontend/src/core/pipeline/guideInterpret";
import {
  applyTextParams,
  clampReasoning,
  isReasoningRejection,
  noteReasoningRejected,
  reasoningFloor,
} from "../books-frontend/src/core/providers/textParams";
import { openaiTextProvider } from "../books-frontend/src/core/providers/openai";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { createDefaultConfig, type Project } from "../books-frontend/src/core/types";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

const url = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const level = (model: string, reasoning: "none" | "minimal" | "low" | "medium" | "high"): string | undefined => {
  const body = applyTextParams("google", url(model), JSON.stringify({ generationConfig: {} }), { reasoning });
  return (JSON.parse(body) as { generationConfig?: { thinkingConfig?: { thinkingLevel?: string } } }).generationConfig?.thinkingConfig
    ?.thinkingLevel;
};

// --- A model is only asked for a reasoning level it takes ---------------------------------------
{
  check(level("gemini-3.5-flash-lite", "none") === "minimal", "A model that takes `minimal` no longer gets it.");
  check(level("gemini-3.8-flash", "none") === "low", "A model known to refuse `minimal` was still sent it.");
  check(level("gemini-3.8-flash", "minimal") === "low", "`minimal` reached a model known to refuse it.");
  check(level("gemini-3.8-flash", "high") === "high", "A level the model takes was changed.");
  check(reasoningFloor("gemini-3.5-flash-lite") === "none", "A model with no known floor was given one.");

  const message = "Thinking level MINIMAL is not supported for this model.";
  check(isReasoningRejection(400, message), "The provider's own refusal of a thinking level was not recognised.");
  check(!isReasoningRejection(500, message), "A server error was taken for a refused setting.");
  check(!isReasoningRejection(400, "API key not valid."), "An unrelated 400 was taken for a refused setting.");

  // A refusal nobody wrote down: learned once, never repeated.
  const unknown = "gemini-3.1-test-flash";
  check(level(unknown, "none") === "minimal", "The unknown model did not start at the requested level.");
  check(noteReasoningRejected(unknown, clampReasoning(unknown, "none")), "A refusal could not be remembered.");
  check(level(unknown, "none") === "low", "A learned refusal was sent again.");
  check(!noteReasoningRejected(unknown, "high"), "There is no level above the highest.");
}

// --- A failure says what it was --------------------------------------------------------------------
{
  const parse = new ProviderError("Model did not return valid JSON", { kind: "parse", provider: "openai", details: "{ oops" });
  check(classifyGuideFailure(parse).kind === "invalid-output" && worthAskingAgain(classifyGuideFailure(parse)), "An unusable answer is not recognised.");
  const refused = new ProviderError("Bad request", { kind: "invalid_request", provider: "google", status: 400, details: "thinking level" });
  check(classifyGuideFailure(refused).kind === "provider" && !worthAskingAgain(classifyGuideFailure(refused)), "A refused request would be asked again.");
  check(/thinking level/.test(classifyGuideFailure(refused).detail), "The provider's words did not reach the failure.");
  check(classifyGuideFailure(new ProviderError("slow", { kind: "timeout" })).kind === "timeout", "A timeout is not recognised.");
  const stopped = new AbortController();
  stopped.abort();
  check(classifyGuideFailure(new ProviderError("x", { kind: "aborted" }), stopped.signal).kind === "stopped", "A cancelled request is called a failure.");
  const named = new Error("deadline");
  named.name = "TimeoutError";
  check(classifyGuideFailure(named).kind === "timeout", "A plain TimeoutError is not recognised.");
  check(classifyGuideFailure("odd").kind === "unknown", "A non-error was not classified.");
}

// --- Replays: recorded model answers through the real interpreter ---------------------------------------
const playlist = resolveGuidePlaylist(createDefaultGuidePlaylist());
const patchContext = guidePatchContext({});
const emptyBook: Project = withAuthoring(
  {
    id: "failure-book",
    title: "",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: { ...createDefaultConfig(), storyText: "", styleReady: false, storyBrief: createDefaultStoryBrief("guided") },
  },
  { entry: "guided" },
);

type Step = unknown | Error;

/** Answer the model calls of `body` with the recorded steps, in order (the last repeats), and report what was asked. */
async function replay<T>(steps: Step[], body: () => Promise<T>): Promise<{ value: T; asked: string[] }> {
  const asked: string[] = [];
  const provider = openaiTextProvider as unknown as {
    generateStructured: (creds: unknown, req: { messages: { content: string }[] }) => Promise<unknown>;
  };
  const original = provider.generateStructured;
  const warn = console.warn;
  console.warn = () => undefined;
  provider.generateStructured = async (_creds, req) => {
    asked.push(req.messages.map((m) => m.content).join("\n"));
    const step = steps[Math.min(asked.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return JSON.parse(JSON.stringify(step));
  };
  try {
    return { value: await body(), asked };
  } finally {
    provider.generateStructured = original;
    console.warn = warn;
  }
}

const interpret = (message: string, repairAttempts = 1) =>
  interpretGuideTurn({
    project: emptyBook,
    message,
    playlist,
    patchContext,
    creds: { apiKey: "test" },
    model: "test-model",
    providerId: "openai",
    repairAttempts,
  });

const BUG_MESSAGE =
  "we are moving from california to germany, the twins aren and amira are coming along with papa and anne, papa wears a gray cap";

const parseError = () => new ProviderError("Model did not return valid JSON", { kind: "parse", provider: "openai", details: "not json" });
const GREETING = { intent: "answer", route: "guided", claims: [], reply: "Got it, I've noted your story.", confidence: 0.8 };
const HEROES = {
  claims: [
    {
      slot: "heroes",
      value: [{ name: "Aren" }, { name: "Amira" }, { name: "Papa" }, { name: "Anne" }],
      evidence: "the twins aren and amira are coming along with papa and anne",
      confidence: 0.9,
    },
  ],
};

{
  // A refused setting: one call, a named reason, nothing invented.
  const refused = new ProviderError("Bad request", {
    kind: "invalid_request",
    provider: "openai",
    status: 400,
    details: "Thinking level MINIMAL is not supported",
  });
  const gone = await replay([refused], () => interpret(BUG_MESSAGE));
  check(gone.asked.length === 1, `A refused setting was asked ${gone.asked.length} times.`);
  check(gone.value.failure?.kind === "provider", "A refused request did not say it was a provider failure.");
  check(/Thinking level/.test(gone.value.failure?.detail ?? ""), "The provider's reason was lost.");
  check(Object.keys(gone.value.patch).length === 0 && gone.value.claims.length === 0, "A turn nobody read wrote something.");
  check(!/catch that/.test(gone.value.reply), "The old, untrue 'didn't catch that' is back.");

  // An unusable answer, then a good one: asked again once, with the reason.
  const second = await replay([parseError(), { ...GREETING, claims: [] }], () => interpret("hello there"));
  check(second.asked.length === 2 && !second.value.failure, "An unusable answer was not asked again, once.");
  check(/could not be used/.test(second.asked[1] ?? "") && !/could not be used/.test(second.asked[0] ?? ""), "The second ask did not say why.");

  // Unusable twice: a named failure, and not a third ask.
  const twice = await replay([parseError()], () => interpret("hello there"));
  check(twice.asked.length === 2, `An unusable answer was asked ${twice.asked.length} times.`);
  check(twice.value.failure?.kind === "invalid-output", "Two unusable answers were not reported as such.");

  // A timeout is not asked again: the deadline has no room.
  const slow = await replay([new ProviderError("no answer", { kind: "timeout", provider: "openai" })], () => interpret("hello there"));
  check(slow.asked.length === 1 && slow.value.failure?.kind === "timeout", "A timed-out turn was asked again or not named.");

  // A good answer carries no failure.
  const fine = await replay([{ ...GREETING }], () => interpret("hello there", 0));
  check(fine.value.failure === undefined, "A readable turn carries a failure.");
}

{
  // The recorded conversation that used to end in "Who should be in the story?": the model's first read
  // leaves everybody out, and the people the parent named come back through the repair.
  const mended = await replay([GREETING, HEROES], () => interpret(BUG_MESSAGE));
  check(mended.asked.length === 2, `The missing people were asked for ${mended.asked.length - 1} times.`);
  check(/missing/i.test(mended.asked[1] ?? "") && /anne/i.test(mended.asked[1] ?? ""), "The repair did not name the people that were missed.");
  check(mended.value.claims.some((claim) => claim.slot === "heroes"), "The people the parent named did not come back.");
  check(mended.value.repairs === 1 && !mended.value.failure, "The repair was not counted, or reported as a failure.");

  // The repair itself failing leaves the first read intact.
  const kept = await replay([GREETING, new ProviderError("down", { kind: "invalid_request", provider: "openai", status: 400 })], () => interpret(BUG_MESSAGE));
  check(kept.value.repairs === 0 && !kept.value.failure && kept.value.reply === GREETING.reply, "A failed repair spoiled the first read.");
}

// --- People next to a family word, however they are written ------------------------------------------
{
  const names = (text: string) => likelyPeople(text).join(",");
  check(names("with papa and anne next week") === "Papa,Anne", "Lowercase 'papa and anne' was not heard.");
  check(names("Anne and Papa wear caps") === "Anne,Papa", "A name before a family word was not heard.");
  check(names("papa and I go to the park") === "Papa", "'I' was taken for a person.");
  check(names("papa and the dog play") === "Papa", "'the' was taken for a person.");
  check(names("with mama, papa and grandma") === "Mama,Papa,Grandma", "A list of family words lost somebody.");
}

report.push("Failure: reasoning limits, named failures, replayed answers and people beside family words");
notes.push("Failure: unsupported reasoning is clamped and learned, failures are named and asked again only when useful, and recorded answers still end with the people in the book");

export function checkGuideFailure(): CheckResult {
  return { failures, notes, report, cases };
}
