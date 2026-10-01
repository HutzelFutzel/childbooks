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
  if (!rule.followMessage || !detected) return null;
  if (input.confidence < rule.minConfidence) return null;
  const words = input.message.trim().split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;
  if (words < rule.minWords) return null;
  const lang = detected.slice(0, 2).toLowerCase();
  if (input.current.slice(0, 2).toLowerCase() === lang) return null;
  if (input.bookLocale && input.bookLocale.slice(0, 2).toLowerCase() === lang) return input.bookLocale;
  const match = BOOK_LANGUAGES.find((language) => language.id.slice(0, 2).toLowerCase() === lang);
  return match?.id ?? null;
}
