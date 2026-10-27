/**
 * How a look said in words is kept on one person.
 *
 * A look belongs to the person it was said about: it is written to that member's
 * own `appearance` (or, for a person drawn from a photo or drawing, their
 * `portraitNote`) and nowhere else. Saying it twice in different words ("Papa wears
 * a gray cap", later "papas cap is gray") must not stack up as two looks, so a look
 * that is already there is not added again, and a fuller wording replaces the
 * shorter one it contains.
 */
import type { Project, StoryCastMember } from "../types";
import { withMemberChanges, withPersonAsk } from "./agent/commands/shared";
import { lookSourceOf } from "./portrait";

const ARTICLES = new Set([
  "a", "an", "the", "his", "her", "their", "its", "my", "our", "ein", "eine", "einen", "einer", "eines", "der", "die", "das",
  "den", "dem", "sein", "seine", "seinen", "ihr", "ihre", "ihren", "he", "she", "it", "they", "er", "sie", "es", "is", "ist", "are", "sind", "wears", "wearing", "trägt", "has", "hat",
]);

function foldWords(text: string, owner: ReadonlySet<string> = NO_WORDS): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((word) => word && !ARTICLES.has(word) && !owner.has(word));
}

const NO_WORDS: ReadonlySet<string> = new Set();

/** The words that name the owner, with the possessive an English or German speaker adds ("papas"). */
function ownerWords(names: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const name of names) {
    for (const word of foldWords(name)) {
      words.add(word);
      words.add(`${word}s`);
    }
  }
  return words;
}

/** The words of a look that carry its meaning, in an order that does not matter: "cap gray" is "gray cap". */
export function lookKey(text: string): string {
  return foldWords(text).sort().join(" ");
}

function containsAll(outer: string[], inner: string[]): boolean {
  return inner.length > 0 && inner.every((word) => outer.includes(word));
}

/**
 * Previous and new look as one `;`-separated note, without saying one thing twice.
 * A new part is skipped when an existing part already holds all its words, and
 * replaces an existing part whose words it holds (the fuller wording wins). The
 * owner's own name is not part of a look, so "papas cap is gray" restates "a gray cap".
 */
export function joinLook(previous: string | undefined, next: string, max = 400, owner: readonly string[] = []): string {
  const skip = owner.length > 0 ? ownerWords(owner) : NO_WORDS;
  const parts = (previous ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const piece of next.split(";").map((part) => part.trim()).filter(Boolean)) {
    const words = foldWords(piece, skip);
    if (words.length === 0) continue;
    if (parts.some((part) => containsAll(foldWords(part, skip), words))) continue;
    const covered = parts.findIndex((part) => containsAll(words, foldWords(part, skip)));
    if (covered >= 0) parts[covered] = piece;
    else parts.push(piece);
  }
  return parts.join("; ").slice(0, max);
}

/**
 * A look written onto one member, before any portrait exists: it shapes the first
 * drawing. For a person drawn from a photo or drawing it is a note on that picture.
 */
export function attachLook(project: Project, member: StoryCastMember, look: string): Project {
  const source = lookSourceOf(member);
  const owner = [member.name, ...(member.aliases ?? [])];
  const changes: Partial<StoryCastMember> =
    source === "photo" || source === "drawing"
      ? { portraitNote: joinLook(member.portraitNote, look, 400, owner) }
      : { appearance: joinLook(member.appearance, look, 600, owner), lookSource: "describe" as const, appearanceFromStory: false };
  return withPersonAsk(withMemberChanges(project, member.id, changes), member.id, "look");
}
