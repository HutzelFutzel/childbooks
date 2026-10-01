/**
 * What a character is, and what follows from it.
 *
 * A child, the family dog, a favourite teddy and a dragon are all characters,
 * but each needs different facts before it can be written and drawn: a person
 * needs an age (it shapes the portrait and the reading age); anything else
 * needs to be known as what it is, so it is drawn as a dog or a teddy rather
 * than as a child. The chat's questions, the skills, the portrait and the
 * story prompt all read this one table.
 */
import type { CastKind, StoryCastMember } from "../types";

export const CAST_KINDS = ["person", "animal", "toy", "creature"] as const satisfies readonly CastKind[];

/** A fact a character still needs before their story and portrait. */
export type CastDetail = "age" | "species";

export interface CastKindSpec {
  id: CastKind;
  /** One of them, in the guide's English. */
  noun: string;
  /** Written into prompts before the species: "an animal", "a toy". */
  article: string;
  needs: readonly CastDetail[];
  /** Species examples for the interpreter, the skills and the question. */
  speciesExamples: string;
}

export const CAST_KIND_SPECS: Record<CastKind, CastKindSpec> = {
  person: { id: "person", noun: "person", article: "a person", needs: ["age"], speciesExamples: "" },
  animal: {
    id: "animal",
    noun: "animal",
    article: "an animal",
    needs: ["species"],
    speciesExamples: "dog, cat, rabbit, pony, golden retriever",
  },
  toy: {
    id: "toy",
    noun: "toy",
    article: "a toy",
    needs: ["species"],
    speciesExamples: "teddy bear, stuffed bunny, doll, toy robot",
  },
  creature: {
    id: "creature",
    noun: "creature",
    article: "an imaginary creature",
    needs: ["species"],
    speciesExamples: "dragon, unicorn, friendly monster, fairy",
  },
};

export function isCastKind(value: unknown): value is CastKind {
  return typeof value === "string" && (CAST_KINDS as readonly string[]).includes(value);
}

/** What a character is. Older books have no `kind`: a non-upright body plan reads as an animal. */
export function castKindOf(member: Pick<StoryCastMember, "kind" | "bodyPlan">): CastKind {
  if (member.kind) return member.kind;
  return member.bodyPlan && member.bodyPlan !== "bipedal" ? "animal" : "person";
}

export function isPerson(member: Pick<StoryCastMember, "kind" | "bodyPlan">): boolean {
  return castKindOf(member) === "person";
}

function hasStatedAge(member: Pick<StoryCastMember, "age" | "ageMonths">): boolean {
  return member.age !== undefined || member.ageMonths !== undefined;
}

/**
 * What this character still needs before the story can be written about them.
 * A kind read off a story's description (no stated `kind`) already says what
 * they are, and so does any description of their look.
 */
export function missingDetails(
  member: Pick<StoryCastMember, "kind" | "bodyPlan" | "age" | "ageMonths" | "species" | "appearance" | "lookFromArt">,
): CastDetail[] {
  return CAST_KIND_SPECS[castKindOf(member)].needs.filter((detail) =>
    detail === "age"
      ? !hasStatedAge(member)
      : Boolean(member.kind) && !member.species?.trim() && !member.appearance?.trim() && !member.lookFromArt?.trim(),
  );
}

/** "a golden retriever", "a teddy bear", or "an animal" when the species isn't known yet. */
export function castKindPhrase(member: Pick<StoryCastMember, "kind" | "bodyPlan" | "species">): string {
  const kind = castKindOf(member);
  if (kind === "person") return "";
  const species = member.species?.trim();
  const spec = CAST_KIND_SPECS[kind];
  if (!species) return spec.article;
  return kind === "creature" ? `an imaginary ${species}` : `${/^[aeiou]/i.test(species) ? "an" : "a"} ${species} (${spec.noun})`;
}
