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
import { journeyEntry } from "../../journey";
import { authoringOf } from "../../projectState";
import { portraitStatus } from "../../portrait";
import type { GuideMessage } from "../../session";
import { castOf } from "../resolve";
import { peopleNeedingStatedAge, peopleWithoutPortrait } from "../requirements";

type Vars = { name?: string } | null;

/** The story is long enough to be worth reading for its audience. */
const FIT_CHECK_MIN_CHARS = 120;

export const whenStory = (p: Project): Vars => (p.config.storyText.trim().length > 0 ? {} : null);
export const whenNoStory = (p: Project): Vars => (p.config.storyText.trim().length === 0 ? {} : null);
export const whenStoryToChange = (p: Project): Vars => (p.config.storyText.trim().length >= 20 ? {} : null);
export const whenLongStory = (p: Project): Vars => (p.config.storyText.trim().length > 200 ? {} : null);

export const whenCast = (p: Project): Vars => (castOf(p).length > 0 ? {} : null);
export const whenSeveralPeople = (p: Project): Vars => (castOf(p).length > 1 ? {} : null);

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

/** The guide is writing the story with the reader and none exists yet, so writing it themselves is still open. */
export const whenCanWriteMyself = (p: Project): Vars =>
  journeyEntry(p) === "guided" && p.config.storyText.trim().length === 0 ? {} : null;
