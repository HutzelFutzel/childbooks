/**
 * When a skill's suggestions are worth showing, read from the book.
 *
 * Each returns what `CommandIdea.relevant` expects: null to hide the
 * suggestion, an object to show it (with the name it is about, if any). Pure,
 * so the invariants can walk them.
 */
import { storyTextHash } from "../../../story/revision";
import type { Project } from "../../../types";
import { hasEarlier } from "../../history";
import { journeyEntry, storyBegun } from "../../journey";
import { authoringOf } from "../../projectState";
import { portraitStatus } from "../../portrait";
import type { GuideMessage } from "../../session";
import { castOf } from "../resolve";
import { peopleNeedingStatedAge, peopleWithoutPortrait } from "../requirements";

type Vars = { name?: string } | null;

/** The story is long enough to be worth reading for its audience. */
const FIT_CHECK_MIN_CHARS = 120;

export const whenStory = (p: Project): Vars => (p.config.storyText.trim().length > 0 ? {} : null);
export const whenNoStory = (p: Project): Vars => (!storyBegun(p) ? {} : null);
/** The story's language can still change: nothing is writing it and no page is drawn. */
export const whenLanguageOpen = (p: Project): Vars =>
  authoringOf(p).storyRun?.status !== "running" && authoringOf(p).lockedAt === undefined ? {} : null;
export const whenStoryToChange = (p: Project): Vars => (p.config.storyText.trim().length >= 20 ? {} : null);
export const whenLongStory = (p: Project): Vars => (p.config.storyText.trim().length > 200 ? {} : null);

export const whenCast = (p: Project): Vars => (castOf(p).length > 0 ? {} : null);
export const whenSeveralPeople = (p: Project): Vars => (castOf(p).length > 1 ? {} : null);
export const whenPlace = (p: Project): Vars =>
  (p.anchors ?? []).some((a) => a.include !== false && (a.type === "place" || a.type === "object")) ? {} : null;

/** The first character, by name. */
export function whenNamedPerson(p: Project): Vars {
  const member = castOf(p)[0];
  return member ? { name: member.name.trim() } : null;
}

/** Someone nobody has described yet. */
export function whenUndescribed(p: Project): Vars {
  const member = castOf(p).find((m) => portraitStatus(p, m.id) === "none" && !m.appearance?.trim() && !m.likenessPhoto);
  return member ? { name: member.name.trim() } : null;
}

/** Someone whose portrait is drawn, so a change to how they look makes sense. */
export function whenPortraitDrawn(p: Project): Vars {
  const member = castOf(p).find((m) => portraitStatus(p, m.id) === "current");
  return member ? { name: member.name.trim() } : null;
}

/** Someone still missing an age, else the first character. */
export function whenAgeToSet(p: Project): Vars {
  const missing = peopleNeedingStatedAge(p)[0];
  if (missing) return { name: missing.name.trim() };
  return whenNamedPerson(p);
}

export const whenPortraitsToDraw = (p: Project): Vars => (peopleWithoutPortrait(p).length > 0 ? {} : null);

export const whenNoLook = (p: Project): Vars =>
  p.config.styleReady !== false && p.config.artStyle?.presetId ? null : {};
export const whenLookChosen = (p: Project): Vars =>
  p.config.styleReady !== false && p.config.artStyle?.presetId ? {} : null;

/**
 * A story nobody has read for its audience in its current form. Returns the
 * text's hash, so a revised story is a new state and is offered again.
 */
export function unreadStoryOffer(p: Project, messages: readonly GuideMessage[]): string | null {
  const text = p.config.storyText;
  if (text.trim().length < FIT_CHECK_MIN_CHARS) return null;
  const hash = storyTextHash(text);
  return messages.some((message) => message.fit?.textHash === hash) ? null : hash;
}

/** A name as the story would spell it, for comparing: no accents, case or punctuation. */
const folded = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A word as the story spells it, without accents, so a capital can be compared with a small letter. */
const plainWords = (value: string): string[] =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * People in the cast whom the story never names. A person is named when the
 * story has their full name, or any other name the book knows them by (the
 * story's own word for the person they are linked to, which is how a
 * translated story still names them). Before the story has been read there is
 * only the cast, so the first name stands for "Mia Schmidt" too, but only when
 * it is not a common word of the story ("the" in "The Doctor" is also spelled
 * with a small letter). This only compares text, so it holds in any language.
 * A story too short to be one names nobody.
 */
export function castMissingFromStory(p: Project): { id: string; name: string }[] {
  if (p.config.storyText.trim().length < 20) return [];
  const story = ` ${folded(p.config.storyText)} `;
  const words = new Set(plainWords(p.config.storyText));
  return castOf(p).flatMap((member) => {
    const name = folded(member.name);
    if (!name) return [];
    const linked = (p.anchors ?? []).filter((anchor) => anchor.castId === member.id);
    const names = [name, ...linked.flatMap((anchor) => [anchor.name, ...(anchor.aliasNames ?? [])]).map(folded)].filter(Boolean);
    if (names.some((known) => story.includes(` ${known} `))) return [];
    if (linked.length === 0) {
      const first = plainWords(member.name)[0] ?? "";
      const small = first.toLowerCase();
      if (first.length >= 2 && story.includes(` ${folded(first)} `) && !(small !== first && words.has(small))) return [];
    }
    return [{ id: member.id, name: member.name.trim() }];
  });
}

/** Someone who is in the book's cast and not in its story, so the story can be asked to take them in. */
export function whenPersonMissingFromStory(p: Project): Vars {
  const missing = castMissingFromStory(p)[0];
  return missing ? { name: missing.name } : null;
}

/**
 * The same, offered first. Only for a story the guide wrote with the reader: a
 * story they wrote themselves is theirs, and gets the chip but never the
 * first place. Setting it aside holds for these people, so a new person
 * brings it back and nothing else does.
 */
export function personMissingOffer(p: Project): string | null {
  if (journeyEntry(p) !== "guided") return null;
  const missing = castMissingFromStory(p);
  return missing.length > 0 ? missing.map((member) => member.id).sort().join(",") : null;
}

/** Someone whose portrait has an earlier picture to go back to. */
export function whenEarlierPortrait(p: Project): Vars {
  const member = castOf(p).find((m) => hasEarlier(p, { kind: "person", castId: m.id, name: m.name.trim() }));
  return member ? { name: member.name.trim() } : null;
}

/** A page or the cover with an earlier picture to go back to. */
export function whenEarlierPage(p: Project): Vars {
  const found = Object.keys(p.illustrations ?? {}).some((unitId) => hasEarlier(p, { kind: "cover", unitId }));
  return found ? {} : null;
}

/** The look is still to be chosen, and there is a story to draw in it: before that the chat asks in its own order. */
export const whenLookToChoose = (p: Project): Vars => (whenStory(p) && whenNoLook(p) ? {} : null);

/** The book's shape or layout was chosen, so there is something to change. */
export function whenBookSetUp(p: Project): Vars {
  const setup = authoringOf(p).bookSetup;
  return setup?.formatConfirmedAt || setup?.layoutConfirmedAt ? {} : null;
}

/** The guide is writing the story with the reader and none has started yet, so writing it themselves is still open. */
export const whenCanWriteMyself = (p: Project): Vars =>
  journeyEntry(p) === "guided" && !storyBegun(p) ? {} : null;
