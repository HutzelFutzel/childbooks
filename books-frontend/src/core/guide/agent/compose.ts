/**
 * The persona's voice, and the rules that keep it honest.
 *
 * The composer only phrases. What a message says is decided before it runs —
 * the beats — and {@link validateComposed} checks the phrased text against
 * them: every required name is there, no number appears that the meanings do
 * not contain, no question is added or lost, the length and emoji limits hold,
 * the address is the one configured (du, not Sie), nothing on the avoid list
 * appears, and English is American. A text that fails any rule is thrown away
 * and the configured wording shows, so a model error costs style, never truth.
 */
import { z } from "zod";
import type { AnswerStyle, GuidePersona } from "../../config/guideAgent";
import { personaAddressFor } from "../../config/guideAgent";
import type { ProviderId } from "../../config/options";
import type { PromptContext } from "../../prompts/context";
import { resolvePromptsConfig } from "../../prompts/context";
import { renderTextPrompt } from "../../prompts/render";
import { getTextProvider } from "../../providers";
import type { ProviderCredentials } from "../../providers/types";
import { withRetry } from "../../pipeline/retry";
import { assumesAnotherChild } from "../speech";

// --- Prompt vars -------------------------------------------------------------------

export function personaText(persona: GuidePersona): string {
  const lines = [
    persona.identity,
    persona.traits.length ? `Traits: ${persona.traits.join(", ")}.` : "",
    persona.register === "casual"
      ? "Casual and relaxed: contractions, everyday words, like a friend who's good at this."
      : persona.register === "neutral"
        ? "Plain and friendly, neither chatty nor stiff."
        : "Polite and composed.",
    persona.humor === "none"
      ? "No jokes."
      : persona.humor === "light"
        ? "A light touch of warmth or a small wink now and then; never in errors, payments or confirmations."
        : "Playful, with the occasional joke; never in errors, payments or confirmations.",
    persona.selfReference === "sometimes" && persona.name
      ? `Your name is ${persona.name}. You may mention it now and then.`
      : "Don't talk about yourself or say your name.",
    persona.avoid.length ? `Never use: ${persona.avoid.join(", ")}.` : "",
  ];
  return lines.filter(Boolean).join(" ");
}

export function styleText(style: AnswerStyle): string {
  return [
    `At most ${style.maxSentences} sentence${style.maxSentences === 1 ? "" : "s"} and ${style.maxWords} words.`,
    style.detail === "brief" ? "Be brief." : style.detail === "thorough" ? "Be complete but plain." : "",
    style.directness === "answerFirst" ? "Lead with the answer or the result." : "",
    style.questionsPerMessage === 1 ? "At most one question." : "At most two questions.",
    style.emoji === "never" ? "No emoji." : "An emoji is fine rarely.",
    style.exclamations === "avoid" ? "At most one exclamation mark." : "",
    "No bullet points, no markdown.",
    "In English, use American spelling.",
  ]
    .filter(Boolean)
    .join(" ");
}

const ADDRESS_WORDS: Record<string, { informal: string; formal: string }> = {
  de: { informal: "du", formal: "Sie" },
  fr: { informal: "tu", formal: "vous" },
  es: { informal: "tú", formal: "usted" },
  it: { informal: "tu", formal: "Lei" },
  pt: { informal: "você/tu", formal: "o senhor/a senhora" },
  nl: { informal: "jij/je", formal: "u" },
  pl: { informal: "ty", formal: "Pan/Pani" },
  tr: { informal: "sen", formal: "siz" },
};

export function addressText(persona: GuidePersona, locale: string): string {
  const address = personaAddressFor(persona, locale);
  const words = ADDRESS_WORDS[locale.slice(0, 2).toLowerCase()];
  if (address === "informal") {
    return words
      ? `Address the parent informally (${words.informal}, never ${words.formal}).`
      : "Address the parent informally, as a friend would.";
  }
  return words ? `Address the parent formally (${words.formal}).` : "Address the parent politely.";
}

export function examplesText(persona: GuidePersona): string {
  return persona.examples.map((example) => `- meaning: ${example.meaning} → line: ${example.line}`).join("\n");
}

// --- Validation --------------------------------------------------------------------

export interface ComposeExpectations {
  meaning: string;
  mustSay: readonly string[];
  /** Whether the meanings ask something. */
  question: boolean;
  style: AnswerStyle;
  persona: GuidePersona;
  locale: string;
  /** Answers may contain words from the help sheet; lines may not add numbers. */
  kind: "line" | "answer";
}

export type ComposeProblem =
  | "empty"
  | "missingName"
  | "newNumber"
  | "price"
  | "tooLong"
  | "questionAdded"
  | "questionLost"
  | "tooManyQuestions"
  | "emoji"
  | "exclamations"
  | "address"
  | "avoided"
  | "britishSpelling"
  | "markup"
  | "inventedChild";

function sentences(text: string): number {
  return text.split(/(?<=[.!?。！？])\s+/).filter((part) => part.trim().length > 1).length;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const NUMBER = /\d+(?:[.,]\d+)?/g;
const PRICE = /\d+\s*(?:sparks?|funken|€|\$|eur|usd|chf|£)|(?:€|\$|£)\s*\d/i;
const EMOJI = /\p{Extended_Pictographic}/u;

/** British spellings an American-English line must not use, with the American form. */
export const BRITISH_SPELLINGS: readonly [RegExp, string][] = [
  [/\bcolour/i, "color"],
  [/\bfavourit/i, "favorite"],
  [/\bpersonalis(e|ed|es|ing|ation)\b/i, "personalize"],
  [/\brealis(e|ed|es|ing)\b/i, "realize"],
  [/\borganis(e|ed|es|ing|ation)\b/i, "organize"],
  [/\brecognis(e|ed|es|ing|able)\b/i, "recognize"],
  [/\bapologis(e|ed|es|ing)\b/i, "apologize"],
  [/\bcentre/i, "center"],
  [/\bgrey/i, "gray"],
  [/\bcancelled\b/i, "canceled"],
  [/\bjudgement/i, "judgment"],
  [/\bcatalogue/i, "catalog"],
  [/\bprogramme/i, "program"],
  [/\bbehaviour/i, "behavior"],
  [/\bneighbour/i, "neighbor"],
  [/\bhumour/i, "humor"],
  [/\bmum\b/i, "mom"],
  [/\banalys(e|ed|es|ing)\b/i, "analyze"],
  [/\blicence/i, "license"],
  [/\btravell(ed|ing|er)/i, "traveled"],
  [/\blabell(ed|ing)/i, "labeled"],
  [/\bjewellery/i, "jewelry"],
  [/\bpyjamas/i, "pajamas"],
  [/\baeroplane/i, "airplane"],
  [/\bmaths\b/i, "math"],
  [/\bhonour/i, "honor"],
  [/\bflavour/i, "flavor"],
  [/\bcosy\b/i, "cozy"],
  [/\bsummaris/i, "summarize"],
  [/\bcustomis/i, "customize"],
  [/\boptimis/i, "optimize"],
  [/\bprioritis/i, "prioritize"],
  [/\bminimis/i, "minimize"],
  [/\bfinalis/i, "finalize"],
  [/\bauthoris/i, "authorize"],
];

export function britishSpellingsIn(text: string): string[] {
  return BRITISH_SPELLINGS.filter(([pattern]) => pattern.test(text)).map(([, american]) => american);
}

/**
 * Formal-address markers per language. German "Sie" is also "she/they", so only
 * forms that are unambiguous mid-sentence count: "Ihnen", a capitalized "Ihr-"
 * or "Sie" after the first word of a sentence.
 */
function formalAddressIn(text: string, lang: string): boolean {
  switch (lang) {
    case "de":
      return text
        .split(/(?<=[.!?])\s+/)
        .some((sentence) => /\bIhnen\b/.test(sentence) || /\s(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/.test(sentence.trim()));
    case "fr":
      return /\bvous\b/i.test(text);
    case "es":
      return /\busted(es)?\b/i.test(text);
    case "nl":
      return /\b(u|uw)\b/i.test(text);
    case "pl":
      return /\b(Pan|Pani|Pana|Panu|Państwo)\b/.test(text);
    case "pt":
      return /\b(o senhor|a senhora)\b/i.test(text);
    default:
      return false;
  }
}

function informalAddressIn(text: string, lang: string): boolean {
  switch (lang) {
    case "de":
      return /\b(du|dich|dir|dein|deine|deinen|deinem|deiner)\b/i.test(text);
    case "fr":
      return /\b(tu|toi|ton|ta|tes)\b/i.test(text);
    case "es":
      return /\b(tú|tu|tus|contigo)\b/i.test(text);
    default:
      return false;
  }
}

export function validateComposed(text: string, expect: ComposeExpectations): ComposeProblem[] {
  const problems: ComposeProblem[] = [];
  const clean = text.trim();
  if (!clean) return ["empty"];
  const lang = expect.locale.slice(0, 2).toLowerCase();
  if (/[*_#`]|^\s*[-•]\s/m.test(clean)) problems.push("markup");
  if (assumesAnotherChild(clean) && !assumesAnotherChild(expect.meaning)) problems.push("inventedChild");
  for (const name of expect.mustSay) {
    if (name.trim() && !clean.toLocaleLowerCase().includes(name.trim().toLocaleLowerCase())) {
      problems.push("missingName");
      break;
    }
  }
  if (PRICE.test(clean)) problems.push("price");
  if (expect.kind === "line") {
    const allowed = new Set(expect.meaning.match(NUMBER) ?? []);
    if ((clean.match(NUMBER) ?? []).some((n) => !allowed.has(n))) problems.push("newNumber");
  }
  if (sentences(clean) > expect.style.maxSentences + (expect.kind === "line" ? 1 : 0)) problems.push("tooLong");
  if (words(clean) > Math.ceil(expect.style.maxWords * 1.25)) problems.push("tooLong");
  const questions = (clean.match(/[?？;]/g) ?? []).filter((mark) => mark !== ";" || lang === "el").length;
  if (expect.kind === "line") {
    if (questions > 0 && !expect.question) problems.push("questionAdded");
    if (questions === 0 && expect.question) problems.push("questionLost");
  }
  if (questions > expect.style.questionsPerMessage) problems.push("tooManyQuestions");
  if (expect.style.emoji === "never" && EMOJI.test(clean)) problems.push("emoji");
  if (expect.style.exclamations === "avoid" && (clean.match(/!/g) ?? []).length > 1) problems.push("exclamations");
  const address = personaAddressFor(expect.persona, expect.locale);
  if (address === "informal" ? formalAddressIn(clean, lang) : informalAddressIn(clean, lang)) problems.push("address");
  const lower = clean.toLocaleLowerCase();
  if (expect.persona.avoid.some((phrase) => phrase && lower.includes(phrase.toLocaleLowerCase()))) problems.push("avoided");
  if (lang === "en" && !expect.locale.toLowerCase().startsWith("en-gb") && britishSpellingsIn(clean).length > 0) {
    problems.push("britishSpelling");
  }
  return [...new Set(problems)];
}

// --- Server calls ------------------------------------------------------------------

export const guideComposeSchema = z.object({ text: z.string().max(1200) });
export const guideAnswerSchema = z.object({ text: z.string().max(2000), grounded: z.boolean() });

interface ModelInput {
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

export interface ComposeGuideMessageInput extends ModelInput {
  /** English name plus code, e.g. "Deutsch (de-DE)". */
  language: string;
  locale: string;
  names: string[];
  meanings: string[];
  transcript: string;
  persona: GuidePersona;
  style: AnswerStyle;
}

export async function composeGuideMessage(input: ComposeGuideMessageInput): Promise<string> {
  const prompts = resolvePromptsConfig(input.prompts);
  const examples = examplesText(input.persona);
  const { system, user } = renderTextPrompt(prompts, "guideCompose/message", {
    vars: {
      persona: personaText(input.persona),
      style: styleText(input.style),
      address: addressText(input.persona, input.locale),
      examples,
      language: input.language,
      names: input.names.length > 0 ? input.names.join(", ") : "(none)",
      transcript: input.transcript.trim() || "(this is the first message)",
      meanings: input.meanings.map((meaning, index) => `${index + 1}. ${meaning}`).join("\n"),
    },
    flags: { hasExamples: examples.length > 0 },
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
        schema: guideComposeSchema,
        temperature: 0.7,
        signal: input.signal,
      }),
    { signal: input.signal, retries: 0 },
  );
  return raw.text.trim();
}

export interface AnswerGuideQuestionInput extends ModelInput {
  language: string;
  locale: string;
  question: string;
  help: string;
  skills: string;
  book: string;
  transcript: string;
  persona: GuidePersona;
  style: AnswerStyle;
}

export async function answerGuideQuestion(input: AnswerGuideQuestionInput): Promise<{ text: string; grounded: boolean }> {
  const prompts = resolvePromptsConfig(input.prompts);
  const examples = examplesText(input.persona);
  const { system, user } = renderTextPrompt(prompts, "guideAnswer/question", {
    vars: {
      persona: personaText(input.persona),
      style: styleText(input.style),
      address: addressText(input.persona, input.locale),
      examples,
      language: input.language,
      help: input.help || "(empty)",
      skills: input.skills || "(none)",
      book: input.book,
      transcript: input.transcript.trim() || "(this is the first message)",
      question: input.question.trim().slice(0, 800),
    },
    flags: { hasExamples: examples.length > 0 },
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
        schema: guideAnswerSchema,
        temperature: 0.3,
        signal: input.signal,
      }),
    { signal: input.signal, retries: 1 },
  );
  return { text: raw.text.trim(), grounded: raw.grounded };
}
