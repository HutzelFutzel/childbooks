/**
 * What the guide says, and in which language.
 *
 * **One line per change.** Everything that might be worth saying after a change
 * is offered as a candidate with a priority; the arbiter picks what is said:
 *
 *   1. a blocking error or a required confirmation — said alone;
 *   2. the answer to what was just typed;
 *   3. a result that landed;
 *   4. the next question.
 *
 * At most two candidates are joined into one message, so a finished look, a
 * finished draft and a follow-up never arrive as three bubbles.
 *
 * **The configured sentence is the meaning.** In a chat language other than the
 * configured one (English), the model phrases each meaning (`guideSpeak`),
 * keeping every name exactly as typed. Until that answer arrives the configured
 * sentence is shown, so a spoken line never delays the receipt.
 */
import { z } from "zod";
import type { ProviderId } from "../config/options";
import type { PromptContext } from "../prompts/context";
import { resolvePromptsConfig } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import { withRetry } from "../pipeline/retry";
import {
  guideCopy,
  type GuideCopyOverrides,
  type GuideCopyVars,
  type GuideLineKey,
} from "./copy";

export const GUIDE_SPEECH_PRIORITIES = ["blocking", "confirm", "answer", "result", "question"] as const;
export type GuideSpeechPriority = (typeof GUIDE_SPEECH_PRIORITIES)[number];

export interface GuideLineCandidate {
  key: GuideLineKey;
  priority: GuideSpeechPriority;
  vars?: GuideCopyVars;
  /** Free text instead of a configured line (the interpreter's acknowledgement). */
  text?: string;
}

export interface GuideUtterance {
  /** Line keys in the order spoken, for "has this been said" bookkeeping. */
  keys: GuideLineKey[];
  /** Configured meaning, filled. Shown at once. */
  meaning: string;
  /** Names that must survive phrasing unchanged. */
  names: string[];
}

const RANK: Record<GuideSpeechPriority, number> = {
  blocking: 0,
  confirm: 1,
  answer: 2,
  result: 3,
  question: 4,
};

/**
 * Choose what to say. Returns null when nothing is worth saying.
 *
 * Deterministic and pure: ties keep the order they were offered in, and the
 * same line is never said twice in one message.
 */
export function arbitrateGuideLines(
  candidates: readonly GuideLineCandidate[],
  overrides?: GuideCopyOverrides,
): GuideUtterance | null {
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => RANK[a.candidate.priority] - RANK[b.candidate.priority] || a.index - b.index)
    .map((entry) => entry.candidate);
  if (ordered.length === 0) return null;

  const picked: GuideLineCandidate[] = [];
  for (const candidate of ordered) {
    if (picked.some((p) => p.key === candidate.key && !p.text && !candidate.text)) continue;
    picked.push(candidate);
    if (candidate.priority === "blocking") break;
    if (picked.length === 2) break;
  }
  // A blocking line or confirmation stands alone, unless it is itself the
  // confirmation said together with the start of the work it confirms.
  const first = picked[0]!;
  const lines = first.priority === "blocking" ? [first] : picked;

  const texts = lines.map((line) => line.text?.trim() || guideCopy(overrides, line.key, line.vars));
  const names = new Set<string>();
  for (const line of lines) {
    const raw = line.vars?.names;
    for (const name of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      if (typeof name === "string" && name.trim()) names.add(name.trim());
    }
  }
  const meaning = texts.filter(Boolean).join(" ");
  if (!meaning) return null;
  return { keys: lines.map((line) => line.key), meaning, names: [...names] };
}

/** Whether a chat language needs phrasing, or reads the configured wording as-is. */
export function needsGuideSpeech(chatLocale: string | undefined): boolean {
  return Boolean(chatLocale) && !chatLocale!.toLowerCase().startsWith("en");
}

// --- Phrasing (server) ------------------------------------------------------

export const guideSpeakSchema = z.object({
  lines: z.record(z.string(), z.string().max(1200)),
});

export const guideAskSchema = z.object({
  text: z.string().max(600),
  asks: z.array(z.string().max(40)).max(8),
});

/**
 * Whether a model-written follow-up may replace the fallback question.
 *
 * The model chooses the sentence. It may not ask for a fact that is not still
 * missing, and it may not stay silent while a required fact is empty. People
 * who share an age have to be named together.
 */
export function acceptGuideQuestion(args: {
  text: string;
  asks: readonly string[];
  missing: readonly string[];
  requiredMissing: readonly string[];
  /** People who still need an age. */
  ageNames: readonly string[];
  /** Groups the reader said share an age, by name. */
  sameAgeGroups: readonly (readonly string[])[];
}): boolean {
  const text = args.text.trim();
  if (!text) return false;
  const missing = new Set(args.missing);
  if (args.asks.some((id) => !missing.has(id))) return false;
  if (args.requiredMissing.length > 0 && args.asks.length === 0) return false;
  if (!args.asks.includes("ages")) return true;
  if (args.ageNames.length > 0 && !args.ageNames.some((name) => text.includes(name))) return false;
  for (const group of args.sameAgeGroups) {
    const pending = group.filter((name) => args.ageNames.includes(name));
    if (pending.length >= 2 && !pending.every((name) => text.includes(name))) return false;
  }
  return true;
}

export interface SpeakGuideLinesInput {
  /** English name plus code, e.g. "Deutsch (de-DE)". */
  language: string;
  names: string[];
  lines: { id: string; meaning: string }[];
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

/**
 * Phrase configured meanings in the chat language.
 *
 * A phrasing that drops or respells a name is refused and the meaning is used
 * instead, so a model error costs the reader a translation, never a name.
 */
export async function speakGuideLines(input: SpeakGuideLinesInput): Promise<Record<string, string>> {
  const lines = input.lines.filter((line) => line.meaning.trim()).slice(0, 12);
  if (lines.length === 0) return {};
  const prompts = resolvePromptsConfig(input.prompts);
  const { system, user } = renderTextPrompt(prompts, "guideSpeak/line", {
    vars: {
      language: input.language,
      names: input.names.length > 0 ? input.names.join(", ") : "(none)",
      lines: lines.map((line) => `- ${line.id}: ${line.meaning}`).join("\n"),
    },
  });
  const provider = getTextProvider(input.providerId);
  const raw = await withRetry(
    () =>
      provider.generateStructured(input.creds, {
        model: input.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        schema: guideSpeakSchema,
        temperature: 0.3,
        signal: input.signal,
      }),
    { signal: input.signal, retries: 1 },
  );
  const out: Record<string, string> = {};
  for (const line of lines) {
    const said = raw.lines[line.id]?.trim();
    const keepsNames = input.names.every((name) => !line.meaning.includes(name) || said?.includes(name));
    out[line.id] = said && keepsNames ? said : line.meaning;
  }
  return out;
}

export interface AskGuideNextInput {
  /** English name plus code, e.g. "Deutsch (de-DE)". */
  language: string;
  names: string[];
  /** What this turn changed, in the reader's words. */
  learned: string;
  /** Required facts that are still empty, with the people they name. */
  open: string;
  transcript: string;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

/** The guide's next line, after the patch. The caller checks {@link acceptGuideQuestion}. */
export async function askGuideNext(input: AskGuideNextInput): Promise<{ text: string; asks: string[] }> {
  const prompts = resolvePromptsConfig(input.prompts);
  const { system, user } = renderTextPrompt(prompts, "guideSpeak/next", {
    vars: {
      language: input.language,
      names: input.names.length > 0 ? input.names.join(", ") : "(none)",
      learned: input.learned.trim() || "(nothing new)",
      open: input.open.trim() || "(nothing)",
      transcript: input.transcript.trim() || "(this is the first message)",
    },
  });
  const provider = getTextProvider(input.providerId);
  const raw = await withRetry(
    () =>
      provider.generateStructured(input.creds, {
        model: input.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        schema: guideAskSchema,
        temperature: 0.4,
        signal: input.signal,
      }),
    { signal: input.signal, retries: 1 },
  );
  return { text: raw.text.trim(), asks: raw.asks };
}
