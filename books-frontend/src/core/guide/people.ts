/**
 * People the parent has asked for who are not in the book yet.
 *
 * "Our friends Luca and Nile", "I also need looks for Nile and Luca", "und Rex kommt auch mit": however it is
 * said, the parent has told us who belongs in the book, and the book has to hold them. Three rules keep
 * that safe whatever the wording:
 *
 *  - The decision never rests on phrasing. The interpreter reports who was named, with the words that say
 *    so; the only thing patterns do is the one shape that cannot be mistaken (a noun like "friends" or
 *    "dog" followed by a capitalised name).
 *  - Nobody is added twice or against the parent's word: someone who answers to the name already, someone
 *    the parent took out, and anyone a request in this very turn removes are all left alone.
 *  - Adding a person never draws or writes anything paid. Their age and look are asked for afterwards,
 *    like any other person's.
 */
import { z } from "zod";
import type { CastKind, Project, StoryCastMember } from "../types";
import { briefOf, isDraftStale, namedCast, storyBriefSignature } from "../story/brief";
import { claimEvidenceHolds } from "./claims";
import { namedExtras } from "./mentions";
import { foldName, resolvePerson } from "./agent/resolve";
import { authoringOf, withAuthoring } from "./projectState";
import { cleanName } from "./rename";
import { linkAnchorsToCast } from "../pipeline/analysis";
import { describeAge, hasStatedAge } from "./ageSync";
import { personNeedsStatedAge } from "./agent/requirements";
import { journeyEntry, pagesStarted, storyStatus } from "./journey";
import { storyHandedOver } from "./ownWords";

/** How many people a book can hold; `addPerson` refuses more. */
export const MAX_BOOK_CAST = 12;

export const MENTIONED_ROLES = ["child", "family", "friend", "pet", "toy", "other"] as const;
export type MentionedRole = (typeof MENTIONED_ROLES)[number];

/** What the interpreter reports about each person the message names. */
export const mentionedPersonSchema = z.object({
  name: z.string().max(60),
  role: z.enum(MENTIONED_ROLES),
  /** For a pet or a toy: which one ("dog", "teddy bear"). */
  species: z.string().max(60).optional(),
  evidence: z.string().max(300),
});

export interface MentionedPerson {
  name: string;
  role: MentionedRole;
  kind: CastKind;
  species?: string;
  /** Their age as the book has it ("4 years", "18 months"), when somebody said it. */
  age?: string;
  /** The parent's own words naming them. */
  evidence: string;
  /** Who found them: the interpreter, or the one pattern that cannot be mistaken. */
  source: "interpreter" | "words";
}

const kindOf = (role: MentionedRole): CastKind => (role === "pet" ? "animal" : role === "toy" ? "toy" : "person");

/**
 * The people the interpreter reports, kept only when the message really names them: the quoted words must be
 * in the message, and so must the name. A model that invents a person has nothing to quote.
 */
export function sanitizeMentioned(raw: readonly z.infer<typeof mentionedPersonSchema>[] | undefined, message: string): MentionedPerson[] {
  const text = foldName(message);
  const seen = new Set<string>();
  const kept: MentionedPerson[] = [];
  for (const item of raw ?? []) {
    const name = cleanName(item.name);
    const key = foldName(name);
    if (!name || !key || seen.has(key)) continue;
    if (!claimEvidenceHolds(message, item.evidence) || !text.includes(key)) continue;
    seen.add(key);
    const species = item.species?.trim();
    kept.push({
      name,
      role: item.role,
      kind: kindOf(item.role),
      ...(species && item.role !== "child" && item.role !== "family" && item.role !== "friend" ? { species } : {}),
      evidence: item.evidence.trim(),
      source: "interpreter",
    });
    if (kept.length >= 8) break;
  }
  return kept;
}

/** Friends, pets and toys the texts introduce by name, in the one shape that is safe to act on. */
export function wordsMentioned(texts: readonly string[]): MentionedPerson[] {
  const seen = new Set<string>();
  const found: MentionedPerson[] = [];
  for (const text of texts) {
    for (const extra of namedExtras(text)) {
      const key = foldName(extra.name);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        name: extra.name,
        role: extra.kind === "animal" ? "pet" : extra.kind === "toy" ? "toy" : "friend",
        kind: extra.kind,
        ...(extra.species ? { species: extra.species } : {}),
        evidence: extra.name,
        source: "words",
      });
    }
  }
  return found;
}

/** Who somebody is to the child, as far as the book says, for the instruction that works them into the story. */
export function roleOfMember(member: StoryCastMember): MentionedPerson {
  const role: MentionedRole = member.kind === "animal" ? "pet" : member.kind === "toy" ? "toy" : /friend/i.test(member.role ?? "") ? "friend" : "other";
  return {
    name: member.name.trim(),
    role,
    kind: member.kind ?? "person",
    ...(member.species?.trim() ? { species: member.species.trim() } : {}),
    ...(hasStatedAge(member) ? { age: describeAge(member) } : {}),
    evidence: "",
    source: "words",
  };
}

/** Whether somebody took this name out of the book. */
function wasRemoved(project: Project, name: string): boolean {
  const key = foldName(name);
  return (authoringOf(project).removedNames ?? []).some((removed) => foldName(removed) === key);
}

/**
 * Who should be added to this book now, out of everyone the parent named.
 *
 * Nobody is added to a book with nobody in it (that question has its own flow: who is the book about?),
 * to a finished book, or for a name already answered by someone. `removing` is whoever this turn takes out.
 */
export function peopleToAdd(
  project: Project,
  candidates: readonly MentionedPerson[],
  options: { removing?: readonly string[] } = {},
): MentionedPerson[] {
  if (authoringOf(project).lockedAt) return [];
  const cast = namedCast(briefOf(project.config));
  if (cast.length === 0) return [];
  const removing = new Set((options.removing ?? []).map(foldName));
  const out: MentionedPerson[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = foldName(candidate.name);
    if (!key || seen.has(key) || removing.has(key) || wasRemoved(project, candidate.name)) continue;
    if (resolvePerson(project, candidate.name).kind !== "none") continue;
    seen.add(key);
    if (cast.length + out.length >= MAX_BOOK_CAST) break;
    out.push(candidate);
  }
  return out;
}

/** The letters a name may take on in a sentence: "Lucas Mama", "Nile's", "Lucas'". */
const NAME_ENDINGS = "(?:['’]?s|es|n|en|'|’)?";

/** Whether a text speaks of somebody, by any name they answer to and with the endings a sentence gives it. */
export function textMentions(text: string, names: readonly string[]): boolean {
  return names.some((name) => {
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escaped) return false;
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${NAME_ENDINGS}(?![\\p{L}\\p{N}])`, "iu").test(text);
  });
}

/** The people of this list the story does not speak of yet. */
export function missingFromStory(project: Project, names: readonly string[]): string[] {
  const story = project.config.storyText;
  if (!story.trim()) return [];
  return names.filter((name) => {
    const member = namedCast(briefOf(project.config)).find((candidate) => foldName(candidate.name) === foldName(name));
    return !textMentions(story, [name, ...(member?.aliases ?? [])]);
  });
}

/** Whether the draft was the story for the book as it is: written for its brief, and not out of date. */
export function wasDraftCurrent(project: Project): boolean {
  const brief = briefOf(project.config);
  const { storyText, ageRangeId, readingModeId, contentLocale } = project.config;
  return Boolean(brief.generatedSignature) && !isDraftStale(brief, storyText, ageRangeId, readingModeId, contentLocale);
}

/** The draft called the story for the brief as it is now: used once it speaks of whoever joined the brief. */
export function stampDraftCurrent(after: Project): Project {
  const now = briefOf(after.config);
  if (!after.config.storyBrief) return after;
  return {
    ...after,
    config: {
      ...after.config,
      storyBrief: {
        ...now,
        generatedSignature: storyBriefSignature(
          now,
          after.config.ageRangeId,
          after.config.readingModeId,
          now.generatedForLocale ? after.config.contentLocale : undefined,
        ),
      },
    },
  };
}

/**
 * A draft that was up to date before people were added is still the story for the brief that holds them,
 * once it speaks of them. Without this the story would be called out of date for a change it already shows.
 */
export function keepDraftCurrent(before: Project, after: Project): Project {
  return wasDraftCurrent(before) ? stampDraftCurrent(after) : after;
}

/** The instruction the story editor gets for people who are not in the story yet. */
export function addPeopleInstruction(people: readonly MentionedPerson[], names: readonly string[]): string {
  const described = names.map((name) => {
    const person = people.find((candidate) => candidate.name === name);
    const what =
      person?.role === "pet"
        ? `their ${person.species ?? "pet"}`
        : person?.role === "toy"
          ? `their ${person.species ?? "toy"}`
          : person?.role === "friend"
            ? "a friend"
            : person?.role === "family"
              ? "a family member"
              : "";
    const details = [what, person?.age ? `${person.age} old` : ""].filter(Boolean).join(", ");
    return details ? `${name} (${details})` : name;
  });
  return (
    `Work ${described.join(" and ")} into the story, because the parent wants them in the book. ` +
    `Use ${names.length > 1 ? "their names" : "the name"} exactly as written, give each a small, natural moment where it fits, ` +
    `and do not change anything else more than needed to make room.`
  );
}

// --- What the story still owes -----------------------------------------------------------

/** The people of the cast with these ids. */
function membersById(project: Project, ids: readonly string[]): StoryCastMember[] {
  const wanted = new Set(ids);
  return namedCast(briefOf(project.config)).filter((member) => wanted.has(member.id));
}

/** Whether the written story may be rewritten for newcomers: guided, written, not handed over to print. */
export function storyRewritable(project: Project): boolean {
  return (
    journeyEntry(project) === "guided" &&
    Boolean(project.config.storyText.trim()) &&
    !authoringOf(project).lockedAt &&
    authoringOf(project).storyRun?.status !== "running"
  );
}

/**
 * Whether the guide asks for ages at this point of the book: the story is written, so the ages come
 * before any portrait. Anywhere else nobody is asked, and nothing may wait for an answer.
 */
function agesAreAsked(project: Project): boolean {
  return !pagesStarted(project) && storyStatus(project) === "ready" && storyHandedOver(project);
}

/** The people who are in the cast now and were not before. */
export function joinedPeople(before: Project, after: Project): StoryCastMember[] {
  const had = new Set(namedCast(briefOf(before.config)).map((member) => foldName(member.name)));
  return namedCast(briefOf(after.config)).filter((member) => !had.has(foldName(member.name)));
}

/**
 * Tie the book's characters to the people who just joined it. A character the story reading already
 * found under their name becomes that person at once (by `castId`, so the portrait is theirs however the
 * story spells the name), and one that was left out of the book when the person went comes back with them.
 * Whoever the reading has not met yet is linked by the next reading.
 */
export function withAnchorsLinked(project: Project, joined: readonly StoryCastMember[]): Project {
  const anchors = project.anchors;
  if (!anchors?.length || joined.length === 0) return project;
  const ids = new Set(joined.map((member) => member.id));
  const linked = linkAnchorsToCast(anchors, project.config, anchors).map((anchor) =>
    anchor.type === "character" && anchor.castId && ids.has(anchor.castId) && anchor.include === false ? { ...anchor, include: true } : anchor,
  );
  return linked.some((anchor, index) => anchor !== anchors[index]) ? { ...project, anchors: linked } : project;
}

/** Write down who the story owes a place, with whether the draft was current before they came. */
export function withStoryOwed(project: Project, members: readonly StoryCastMember[], current: boolean): Project {
  if (members.length === 0) return project;
  const owed = authoringOf(project).storyOwes;
  const ids = [...new Set([...(owed?.ids ?? []), ...members.map((member) => member.id)])];
  return withAuthoring(project, { storyOwes: { ids, current: owed ? owed.current : current } });
}

export function withoutStoryOwed(project: Project): Project {
  return authoringOf(project).storyOwes ? withAuthoring(project, { storyOwes: undefined }) : project;
}

export type StoryOwedStatus =
  | { state: "none" }
  /** They are in the story, or it can no longer be rewritten for them: nothing is owed any more. */
  | { state: "settled"; current: boolean; covered: boolean }
  /** The story is being written or revised by something else; look again later. */
  | { state: "busy" }
  /** What the story needs of them is not known yet (an age the guide is asking for). */
  | { state: "waiting"; names: string[] }
  | { state: "ready"; members: StoryCastMember[]; names: string[]; current: boolean };

/** Where the story stands with the people it owes a place. Pure: the caller does what it says. */
export function storyOwedStatus(project: Project): StoryOwedStatus {
  const owed = authoringOf(project).storyOwes;
  if (!owed) return { state: "none" };
  const members = membersById(project, owed.ids);
  if (members.length === 0 || !storyRewritable(project)) {
    // A story being written right now is looked at again once it is done.
    if (authoringOf(project).storyRun?.status === "running" && members.length > 0) return { state: "busy" };
    return { state: "settled", current: owed.current, covered: false };
  }
  const names = missingFromStory(
    project,
    members.map((member) => member.name.trim()),
  );
  if (names.length === 0) return { state: "settled", current: owed.current, covered: true };
  const lacking = members.filter((member) => names.includes(member.name.trim()));
  if (agesAreAsked(project) && lacking.some((member) => personNeedsStatedAge(member))) {
    return { state: "waiting", names: lacking.filter((member) => personNeedsStatedAge(member)).map((member) => member.name.trim()) };
  }
  return { state: "ready", members: lacking, names, current: owed.current };
}
