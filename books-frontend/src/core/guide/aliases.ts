/**
 * Other words for a person already in the book.
 *
 * An alias only ever helps find the person again ("Dad" for Papa, the name a
 * child had before it was corrected). It is never written into a story or a
 * picture, and it is never a second person: two people never share an alias, so
 * a word that could mean either stays unresolved and the chat asks.
 */
import type { StoryCastMember } from "../types";

export const MAX_ALIASES = 8;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The aliases with one more word, unless it is the name itself, already there, or empty. */
export function withAliasWord(
  aliases: readonly string[] | undefined,
  word: string,
  name: string,
): string[] | undefined {
  const text = word.trim().slice(0, 60);
  const key = fold(text);
  const current = aliases ?? [];
  if (!key || key === fold(name) || current.some((alias) => fold(alias) === key)) {
    return current.length > 0 ? [...current] : undefined;
  }
  return [...current, text].slice(-MAX_ALIASES);
}

/**
 * The cast with a word added as an alias of one member, unless another member
 * already answers to it (a word two people share identifies neither).
 */
export function castWithAlias(cast: readonly StoryCastMember[], memberId: string, word: string): StoryCastMember[] {
  const key = fold(word);
  if (!key) return [...cast];
  const taken = cast.some(
    (member) =>
      member.id !== memberId && [member.name, ...(member.aliases ?? [])].some((label) => fold(label) === key),
  );
  if (taken) return [...cast];
  return cast.map((member) => {
    if (member.id !== memberId) return member;
    const aliases = withAliasWord(member.aliases, word, member.name);
    return aliases && aliases.length !== (member.aliases?.length ?? 0) ? { ...member, aliases } : member;
  });
}
