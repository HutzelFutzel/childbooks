/**
 * How characters belong together — twins, siblings, a child and their dog.
 *
 * Kept on the brief by cast id, so a rename keeps the relation and a removed
 * character takes theirs with them. Read by the story prompt, the reference
 * sheets and the portraits: a parent who said "they're twins" must find twins
 * in the book, drawn alike or not as they chose.
 */
import type { CastRelation, CastRelationType, StoryBrief, StoryCastMember } from "../types";

export const CAST_RELATION_TYPES = [
  "twins",
  "siblings",
  "friends",
  "family",
  "owner",
  "other",
] as const satisfies readonly CastRelationType[];

const RELATION_WORDS: Record<CastRelationType, string> = {
  twins: "twins",
  siblings: "siblings",
  friends: "friends",
  family: "family",
  owner: "",
  other: "",
};

function named(brief: StoryBrief): StoryCastMember[] {
  return (brief.cast ?? []).filter((member) => member.name.trim().length > 0);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("\u0001") === [...b].sort().join("\u0001");
}

/** Relations whose characters are all still in the story. */
export function relationsOf(brief: StoryBrief): CastRelation[] {
  const ids = new Set(named(brief).map((member) => member.id));
  return (brief.relations ?? []).filter(
    (relation) => relation.ids.length >= 2 && relation.ids.every((id) => ids.has(id)),
  );
}

/** Add or replace the relation between exactly these characters. */
export function withRelation(brief: StoryBrief, relation: CastRelation): StoryBrief {
  const existing = brief.relations ?? [];
  const index = existing.findIndex((candidate) => sameIds(candidate.ids, relation.ids));
  const previous = index >= 0 ? existing[index] : undefined;
  const merged: CastRelation = {
    ...relation,
    ...(relation.type === "twins" && !relation.lookAlike && previous?.type === "twins" && previous.lookAlike
      ? { lookAlike: previous.lookAlike }
      : {}),
  };
  const relations = index >= 0 ? existing.map((item, at) => (at === index ? merged : item)) : [...existing, merged];
  return { ...brief, relations };
}

export function withoutRelation(brief: StoryBrief, ids: readonly string[]): StoryBrief {
  const relations = (brief.relations ?? []).filter((relation) => !sameIds(relation.ids, ids));
  return { ...brief, ...(relations.length ? { relations } : { relations: undefined }) };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function namesOf(brief: StoryBrief, ids: readonly string[]): string[] {
  const byId = new Map(named(brief).map((member) => [member.id, member.name.trim()]));
  return ids.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
}

/** One sentence, in English: "Myla and Shilo are identical twins." */
export function relationSentence(brief: StoryBrief, relation: CastRelation): string {
  const names = namesOf(brief, relation.ids);
  const label = relation.label?.trim();
  if (relation.type === "owner") {
    const [owner, ...rest] = names;
    return `${joinNames(rest)} ${rest.length > 1 ? "belong" : "belongs"} to ${owner}${label ? ` (${label})` : ""}.`;
  }
  const word =
    relation.type === "twins" && relation.lookAlike
      ? `${relation.lookAlike === "identical" ? "identical" : "non-identical"} twins`
      : RELATION_WORDS[relation.type];
  if (!word) return `${joinNames(names)}: ${label ?? "they belong together"}.`;
  return `${joinNames(names)} are ${word}${label ? ` (${label})` : ""}.`;
}

/** Every relation as prompt lines, or "" when there are none. */
export function relationPromptLines(brief: StoryBrief): string {
  return relationsOf(brief)
    .map((relation) => `- ${relationSentence(brief, relation)}`)
    .join("\n");
}

/** Short chip text for receipts and the facts strip: "Myla & Shilo: twins". */
export function relationChip(brief: StoryBrief, relation: CastRelation): string {
  const names = namesOf(brief, relation.ids);
  const what =
    relation.type === "owner" || relation.type === "other"
      ? relation.label?.trim() || (relation.type === "owner" ? `${names[0]}'s` : "together")
      : RELATION_WORDS[relation.type];
  return `${names.join(" & ")}: ${what}`;
}

/**
 * What a portrait of this character must know about the others. Identical
 * twins are drawn from the same face; anyone else is only told who they are.
 */
export function portraitRelationNote(brief: StoryBrief, memberId: string): string {
  const notes: string[] = [];
  for (const relation of relationsOf(brief)) {
    if (!relation.ids.includes(memberId)) continue;
    const others = namesOf(
      brief,
      relation.ids.filter((id) => id !== memberId),
    );
    if (relation.type === "twins" && relation.lookAlike === "identical") {
      notes.push(`${joinNames(others)}'s identical twin: the same face, hair, eye and skin color as ${joinNames(others)}; tell them apart only by clothes`);
    } else if (relation.type === "twins") {
      notes.push(`${joinNames(others)}'s twin${relation.lookAlike === "different" ? ", but they do not look alike" : ""}`);
    } else if (relation.type === "siblings" || relation.type === "family") {
      notes.push(`family of ${joinNames(others)}, with a family resemblance`);
    }
  }
  return notes.join("; ");
}

/** Twins whose look the family hasn't settled yet, as cast ids. */
export function twinsToAsk(brief: StoryBrief): CastRelation[] {
  return relationsOf(brief).filter((relation) => relation.type === "twins" && !relation.lookAlike);
}

/** Groups of characters who share an age because they are twins. */
export function twinGroups(brief: StoryBrief): string[][] {
  return relationsOf(brief)
    .filter((relation) => relation.type === "twins")
    .map((relation) => namesOf(brief, relation.ids));
}
