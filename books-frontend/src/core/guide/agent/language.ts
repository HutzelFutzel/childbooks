/**
 * Which language the chat answers in.
 *
 * The chat follows the language of each message, but only when the message is
 * clearly in one: long enough and detected with confidence. "ok", a name, or
 * "Paris" never flips the chat. The book's own language never follows the chat
 * after the story exists; changing it is an explicit request (`setBookLanguage`).
 */
import { BOOK_LANGUAGES } from "../../config/bookLanguages";

export interface LanguageRule {
  followMessage: boolean;
  minConfidence: number;
  minWords: number;
}

/**
 * Everyday words of a few languages. The model that reports a message's language reads names and
 * places too ("papa", "Anne", "Germany"), and its own confidence is not evidence, so a message
 * that is plainly written in the chat's language never moves the chat, whatever it reports.
 */
const COMMON_WORDS: Record<string, readonly string[]> = {
  en: "the a an and or but to of in on at for with from by is are was were be been it its this that these those i you he she we they my your our their his her them then next last day have has had not no yes please want would should could will can about as so if when where who what how very also just".split(" "),
  de: "der die das den dem des ein eine einen einem einer und oder aber zu von mit in auf an für ist sind war waren sein ich du er sie es wir ihr mein dein unser nicht kein ja bitte will möchte soll kann wird als so wenn wo wer was wie sehr auch nur dann noch nach bei aus über".split(" "),
  es: "el la los las un una unos unas y o pero a de en con por para es son era eran ser yo tú él ella nosotros mi tu su no sí quiero que como muy también solo entonces del al se".split(" "),
  fr: "le la les un une des et ou mais à de en dans sur avec pour par est sont était être je tu il elle nous vous ils mon ton son notre votre leur ne pas oui veux que comme très aussi seulement alors du au se".split(" "),
};

/** The share of a message's words that are everyday words of `lang`; null when there is no list for it. */
export function commonWordShare(message: string, lang: string): number | null {
  const list = COMMON_WORDS[lang.slice(0, 2).toLowerCase()];
  if (!list) return null;
  const words = (message.toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) => word.length > 0);
  if (words.length === 0) return null;
  const common = new Set(list);
  return words.filter((word) => common.has(word)).length / words.length;
}

/**
 * The language a message is plainly written in, judged by its everyday words alone; null when no
 * language stands out. A backstop for a reply that names none.
 */
export function guessLanguage(message: string): string | null {
  const shares = Object.keys(COMMON_WORDS)
    .map((lang) => ({ lang, share: commonWordShare(message, lang) ?? 0 }))
    .sort((a, b) => b.share - a.share);
  const [top, second] = shares;
  if (!top || top.share < 0.25) return null;
  return top.share >= 2 * (second?.share ?? 0) ? top.lang : null;
}

/**
 * The chat language of a book that has none stored yet: the language the app is shown in, and the
 * book's own variant of it ("en-GB") when that is the same language. Never the book language by
 * itself, which is guessed from the country and says nothing of the language the reader writes in.
 */
export function defaultChatLocale(input: { ui: string | null; bookLocale?: string }): string {
  const ui = (input.ui ?? "en").slice(0, 2).toLowerCase();
  if (input.bookLocale && input.bookLocale.slice(0, 2).toLowerCase() === ui) return input.bookLocale;
  return BOOK_LANGUAGES.find((language) => language.id.slice(0, 2).toLowerCase() === ui)?.id ?? "en-US";
}

/** The chat locale for a detected message language, or null to keep the current one. */
export function nextChatLocale(input: {
  current: string;
  detected: string | null;
  confidence: number;
  message: string;
  rule: LanguageRule;
  /** The book's language, preferred when it matches the detected one ("de" → the book's "de-AT"). */
  bookLocale?: string;
}): string | null {
  const { detected, rule } = input;
  if (!rule.followMessage) return null;
  const words = input.message.trim().split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;
  if (words < rule.minWords) return null;
  const reported = detected && input.confidence >= rule.minConfidence ? detected.slice(0, 2).toLowerCase() : null;
  // A reply that names no language (or one it isn't sure of) is read from the words themselves.
  const guessed = reported ? null : guessLanguage(input.message);
  const lang = reported ?? guessed;
  if (!lang) return null;
  if (input.current.slice(0, 2).toLowerCase() === lang) return null;
  if (reported) {
    // Written in the chat's own language: names and places in another one don't move the chat.
    const ownShare = commonWordShare(input.message, input.current);
    if (ownShare !== null && ownShare >= 0.2) return null;
    // Said to be in a language it barely uses the everyday words of.
    const claimedShare = commonWordShare(input.message, lang);
    if (claimedShare !== null && claimedShare < 0.1) return null;
  }
  if (input.bookLocale && input.bookLocale.slice(0, 2).toLowerCase() === lang) return input.bookLocale;
  const match = BOOK_LANGUAGES.find((language) => language.id.slice(0, 2).toLowerCase() === lang);
  return match?.id ?? null;
}
