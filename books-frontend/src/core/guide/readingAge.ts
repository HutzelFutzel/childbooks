/**
 * Who the Chat's story is written for.
 *
 * Until the reader picks an age group, a guided book follows the first child:
 * a three-year-old hero means a story for three-year-olds. The Chat suggests
 * that group and asks before the story is written; a yes or another age
 * makes it the reader's choice (`audienceFromCast: "custom"`), which a later
 * cast edit never overwrites.
 *
 * Own words are different. The reader's words stay theirs, so the age group
 * only sets the pages. It is asked once, optionally, before they write, and
 * again only when a child's age the story actually states points at a
 * different group. A guess never counts as that age.
 */
import {
  audienceProfileForMonths,
  carryReadingMode,
  isAudienceLinkedToCast,
  resolveAudienceProfile,
  type AudienceConfig,
} from "../config/audience";
import type { AudienceProfile } from "../config/audienceCatalog";
import { audienceSourceCharacter, briefOf, characterAgeMonths } from "../story/brief";
import type { Project, ReadingModeId, StoryCastMember } from "../types";
import type { WellItem } from "./journey";
import { authoringOf } from "./projectState";
import type { GuideLineCandidate } from "./speech";

/** The child the suggestion comes from: the first named one, once their age is known. */
export function readingAgeSource(project: Project): StoryCastMember | undefined {
  return audienceSourceCharacter(briefOf(project.config).cast);
}

function followsCast(project: Project): boolean {
  return isAudienceLinkedToCast(project.config.audienceFromCast, Boolean(project.config.storyText.trim()));
}

/** The age group the story is written for now: the reader's pick, else the first child's. */
export function suggestedAudience(project: Project, audience?: AudienceConfig | null): AudienceProfile {
  if (followsCast(project)) {
    const hero = readingAgeSource(project);
    const months = hero ? characterAgeMonths(hero) : undefined;
    const linked = months !== undefined ? audienceProfileForMonths(months, audience ?? null) : undefined;
    if (linked) return linked;
  }
  return resolveAudienceProfile(project.config.ageRangeId, audience ?? null);
}

/** The book with its age group following the first child, unless the reader picked one. */
export function withLinkedAudience(project: Project, audience?: AudienceConfig | null): Project {
  if (!followsCast(project)) return project;
  const profile = suggestedAudience(project, audience);
  const readingModeId = carryReadingMode(profile, project.config.readingModeId);
  if (profile.id === project.config.ageRangeId && readingModeId === (project.config.readingModeId ?? null)) {
    return project;
  }
  return { ...project, config: { ...project.config, ageRangeId: profile.id, readingModeId } };
}

/** The reader's pick: this age group, kept whatever the cast does later. */
export function withChosenAudience(
  project: Project,
  profile: AudienceProfile,
  readingModeId?: ReadingModeId | null,
): Project {
  return {
    ...project,
    config: {
      ...project.config,
      ageRangeId: profile.id,
      audienceFromCast: "custom",
      readingModeId: readingModeId !== undefined ? readingModeId : carryReadingMode(profile, project.config.readingModeId),
    },
  };
}

type AudienceQuestion = Extract<WellItem, { kind: "audienceConfirm" }>;

/** The reader already chose an age group, or skipped and kept the current one. */
function audienceSettled(project: Project): boolean {
  const state = authoringOf(project);
  return (
    project.config.audienceFromCast === "custom" ||
    Boolean(state.answeredFacts?.includes("readingAge") || state.skippedFacts?.includes("readingAge"))
  );
}

/**
 * Months the story or the reader actually gave for the first child.
 * A drawing estimate does not count: it must not pick the audience.
 */
export function statedReaderMonths(project: Project): number | undefined {
  const hero = readingAgeSource(project);
  if (!hero) return undefined;
  const stated = characterAgeMonths(hero);
  if (stated !== undefined) return stated;
  if (hero.visualAge?.source === "story") return hero.visualAge.years * 12;
  return undefined;
}

/** Marks saved with a pick. Once a stated age exists, the pick also closes a later "switch?" question. */
export function audienceAnswerMarks(project: Project): string[] {
  return statedReaderMonths(project) !== undefined ? ["readingAge", "readingAgeBand"] : ["readingAge"];
}

/**
 * Own words: who the pages are set for.
 *
 * Before the story is handed over, and whenever no age was stated, this is
 * optional: skip keeps the book's current group. After the story is read, a
 * stated child age that lands in another group is asked once. A guess is never
 * offered as if the story had said it.
 */
export function ownAudienceQuestion(project: Project, audience?: AudienceConfig | null): AudienceQuestion | null {
  const state = authoringOf(project);
  if (state.answeredFacts?.includes("readingAgeBand")) return null;
  const hero = readingAgeSource(project);
  const months = statedReaderMonths(project);
  const fromCast = months !== undefined ? audienceProfileForMonths(months, audience ?? null) : undefined;
  const current = resolveAudienceProfile(project.config.ageRangeId, audience ?? null);
  const spoken = hero ? readingAgeOf(hero) : null;
  const fromStoryYears = hero?.visualAge?.source === "story" ? hero.visualAge.years : undefined;
  const age = spoken ?? (fromStoryYears !== undefined ? { n: fromStoryYears, months: false } : null);
  const base = {
    kind: "audienceConfirm" as const,
    castId: hero?.id ?? "",
    name: hero?.name.trim() ?? "",
    age: age?.n ?? 0,
    months: age?.months ?? false,
    own: true as const,
  };
  if (audienceSettled(project)) {
    if (!fromCast || fromCast.id === current.id) return null;
    return { ...base, bandId: fromCast.id, bandLabel: fromCast.label, differ: true };
  }
  const band = fromCast ?? current;
  return { ...base, bandId: band.id, bandLabel: band.label, optional: !fromCast };
}

/** "Mila is 3, so I'll write the story for children aged 3 years. Is that right…?" */
export function readingAgeAskLine(question: AudienceQuestion): GuideLineCandidate {
  if (question.own && question.differ) {
    return {
      key: "readingAgeAskOwnDiffer",
      priority: "question",
      vars: { names: question.name, n: question.age, what: question.bandLabel },
    };
  }
  if (question.own && question.optional) {
    return { key: "readingAgeAskOwnEarly", priority: "question", vars: { what: question.bandLabel } };
  }
  if (question.own && question.name) {
    return {
      key: "readingAgeAskOwnFromAge",
      priority: "question",
      vars: { names: question.name, n: question.age, what: question.bandLabel },
    };
  }
  if (question.own) return { key: "readingAgeAskOwn", priority: "question", vars: { what: question.bandLabel } };
  return {
    key: question.months ? "readingAgeAskMonths" : "readingAgeAsk",
    priority: "question",
    vars: { names: question.name, n: question.age, what: question.bandLabel },
  };
}

/** What the interpreter should make of the reply to that question. */
export function readingAgeExpectation(question: AudienceQuestion): string {
  const base =
    `the reading age. A yes keeps "${question.bandId}": write audience {"ageRangeId": "${question.bandId}"}. ` +
    `Another age or age group ("for 4-year-olds", "eher für 6") picks the band containing it: write it under audience. ` +
    `A child's own age is heroAges, not audience.`;
  if (question.optional) return `${base} Skip keeps the current group.`;
  if (question.differ) return `${base} Keeping the current group is also an answer.`;
  return base;
}

/** How the question names the child's age: months for under-twos, else years. */
export function readingAgeOf(member: StoryCastMember): { n: number; months: boolean } | null {
  if (member.ageMonths !== undefined && member.age === undefined && member.ageMonths < 24) {
    return { n: member.ageMonths, months: true };
  }
  if (member.age !== undefined) return { n: member.age, months: false };
  if (member.ageMonths !== undefined) return { n: Math.floor(member.ageMonths / 12), months: false };
  return null;
}
