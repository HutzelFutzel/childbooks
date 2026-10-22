/**
 * Keeping one subject one subject when the story's words change.
 *
 * A book names its people, places and things in the story's own words. When
 * those words change (the story is translated, or rewritten) the book must not
 * meet "die Lampe" as a stranger to "the lamp": the same sheet, the same place
 * on the pages and the same decision to leave it out all hang on it being one
 * subject. Deciding that two phrases are one subject is language judgment, so a
 * model makes it, and this file only checks what it says: a name must be one the
 * book has, an id must be one the book has, for the same kind of subject, once.
 */
import { briefOf, namedCast } from "../story/brief";
import type { Anchor, BookConfig } from "../types";
import { anchorNameKeys, boundedAliases, followsStory, mergeAliasNames, normalizeAnchorName } from "./anchorRefs";

/** One thing the translation renamed: how the book had it, and how the story now says it. */
export interface NamePair {
  from: string;
  to: string;
}

/** The most subjects a prompt lists; a book has a handful, so this is only a ceiling. */
const KNOWN_MAX = 60;

const clip = (text: string, max: number): string => text.trim().slice(0, max);

/** The people the cast names, as `{ id, name }`. */
export function castOf(config: BookConfig): { id: string; name: string }[] {
  return namedCast(briefOf(config)).map((member) => ({ id: member.id, name: member.name.trim() }));
}

/**
 * Everything the book already calls something, one per line, for a model that
 * must say which of them it has renamed. Excluded subjects are listed too: a
 * subject the author left out must stay left out whatever it is called next.
 */
export function knownNameLines(anchors: Anchor[] | undefined, cast: { name: string }[]): string {
  const lines: string[] = [];
  const covered = new Set<string>();
  for (const anchor of anchors ?? []) {
    const aliases = (anchor.aliasNames ?? []).map((alias) => clip(alias, 80)).filter(Boolean);
    for (const key of anchorNameKeys(anchor)) covered.add(key);
    lines.push(`- ${clip(anchor.name, 80)} [${anchor.type}]${aliases.length > 0 ? ` (also called: ${aliases.join("; ")})` : ""}`);
  }
  for (const member of cast) {
    const key = normalizeAnchorName(member.name);
    if (!key || covered.has(key)) continue;
    covered.add(key);
    lines.push(`- ${clip(member.name, 80)} [character]`);
  }
  return lines.slice(0, KNOWN_MAX).join("\n");
}

/** Every name and alias the book has, in the form names are compared. */
export function knownNameKeys(anchors: Anchor[] | undefined, cast: { name: string }[]): Set<string> {
  const keys = new Set<string>();
  for (const anchor of anchors ?? []) for (const key of anchorNameKeys(anchor)) keys.add(key);
  for (const member of cast) {
    const key = normalizeAnchorName(member.name);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * The renames worth keeping: from a name the book has, to a different non-empty
 * one, each "from" once. The model's list is a report, never an order.
 */
export function validNamePairs(
  raw: ReadonlyArray<{ from?: string | null; to?: string | null }> | null | undefined,
  known: ReadonlySet<string>,
): NamePair[] {
  const seen = new Set<string>();
  const out: NamePair[] = [];
  for (const pair of raw ?? []) {
    const from = clip(pair.from ?? "", 120);
    const to = clip(pair.to ?? "", 120);
    const fromKey = normalizeAnchorName(from);
    const toKey = normalizeAnchorName(to);
    if (!fromKey || !toKey || fromKey === toKey || !known.has(fromKey) || seen.has(fromKey)) continue;
    seen.add(fromKey);
    out.push({ from, to });
  }
  return out;
}

/**
 * The anchors after the story renamed some of them. Each pair is applied to the
 * one anchor that has that name (or, for a person, is linked to the cast member
 * who has it); a name that fits two anchors, or a new name another anchor already
 * has, is left alone rather than guessed. The story's own name follows the story;
 * a name the reader chose stays and gains the new words as an alias, so the next
 * reading finds the same anchor either way.
 */
export function carryNames(anchors: Anchor[], cast: { id: string; name: string }[], pairs: NamePair[]): Anchor[] {
  let next = anchors;
  const done = new Set<string>();
  for (const { from, to } of pairs) {
    const fromKey = normalizeAnchorName(from);
    const toKey = normalizeAnchorName(to);
    if (!fromKey || !toKey || fromKey === toKey) continue;
    const castIds = new Set(cast.filter((member) => normalizeAnchorName(member.name) === fromKey).map((member) => member.id));
    const targets = next.filter((a) => anchorNameKeys(a).includes(fromKey) || Boolean(a.castId && castIds.has(a.castId)));
    if (targets.length !== 1) continue;
    const target = targets[0]!;
    if (done.has(target.id)) continue;
    if (next.some((a) => a.id !== target.id && anchorNameKeys(a).includes(toKey))) continue;
    done.add(target.id);
    next = next.map((a) => {
      if (a.id !== target.id) return a;
      const follows = followsStory(a);
      const aliasNames = boundedAliases(
        follows ? mergeAliasNames(to, a.aliasNames, [a.name]) : mergeAliasNames(a.name, a.aliasNames, [to]),
      );
      const { aliasNames: _drop, ...rest } = a;
      void _drop;
      return { ...rest, name: follows ? to : a.name, ...(aliasNames ? { aliasNames } : {}) };
    });
  }
  return next;
}

// --- Reading the story again -------------------------------------------------

/** The existing anchors, as a model that is asked to say which ones it found again reads them. */
export function existingSubjectLines(anchors: Anchor[] | undefined): string {
  return (anchors ?? [])
    .slice(0, KNOWN_MAX)
    .map((anchor) => {
      const aliases = (anchor.aliasNames ?? []).map((alias) => clip(alias, 80)).filter(Boolean);
      return `- id ${anchor.id} | ${anchor.type} | ${clip(anchor.name, 80)}${aliases.length > 0 ? ` | also called: ${aliases.join("; ")}` : ""}`;
    })
    .join("\n");
}

/**
 * The ids a fresh reading may reuse. A claim stands only when the id is one of
 * the book's, for the same kind of subject, and nobody else claimed it first;
 * anything else is a new subject, whatever the model said.
 */
export function acceptedClaims(
  claims: ReadonlyArray<{ type: string; sameAs?: string | null }>,
  previous: Anchor[] | undefined,
): (Anchor | undefined)[] {
  const byId = new Map((previous ?? []).map((a) => [a.id, a]));
  const taken = new Set<string>();
  return claims.map((claim) => {
    const id = claim.sameAs?.trim();
    const match = id ? byId.get(id) : undefined;
    if (!match || match.type !== claim.type || taken.has(match.id)) return undefined;
    taken.add(match.id);
    return match;
  });
}
