/**
 * Who a change to a picture is about, read from the sentence and the page.
 *
 * "Fix Hugo's hand on page 6" is about Hugo, and about page 6. The page is
 * looked up by the app; the person is matched here against the people the page
 * is actually drawn with, so the question gets asked now — before a price or a
 * job — instead of after a picture has failed:
 *   - the person named is not on that page (nothing there to fix);
 *   - the sentence says "his" or "her" and two people on the page could be meant.
 *
 * Pure, and deliberately cautious: when it cannot tell, it says nothing and the
 * picture worker's own reading of the sentence decides, as it always has.
 */
import type { Anchor, Project } from "../types";
import { anchorNameKeys } from "./anchorRefs";
import { castOnPage } from "./pageCast";

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `text` names `name` as somebody's: "Hugo's", "Hugo’s", or the bare "hugos"
 * a reader types without the apostrophe. Whole words only, so "Bo" is not found in
 * "bos"; a name under three letters must carry its apostrophe.
 */
function namedPossessively(text: string, name: string): boolean {
  const key = name.trim().toLowerCase();
  if (key.length < 2) return false;
  const suffix = key.length >= 3 ? "(?:['’]s|s)" : "(?:['’]s)";
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(key)}${suffix}($|[^\\p{L}\\p{N}])`, "iu").test(text.toLowerCase());
}

/** The book's people, things and places the sentence speaks of as owning something ("Hugo's hand"). */
export function anchorsNamedPossessively(text: string, anchors: readonly Anchor[] | undefined): Anchor[] {
  return (anchors ?? []).filter(
    (anchor) => anchor.include !== false && anchorNameKeys(anchor).some((key) => namedPossessively(text, key)),
  );
}

/** Whether the sentence says a character's name at all, whole or as a possessive. */
function namesAnyone(text: string, anchors: readonly Anchor[]): boolean {
  const lower = text.toLowerCase();
  return anchors.filter((anchor) => anchor.type === "character").some((anchor) =>
    anchorNameKeys(anchor).some(
      (key) =>
        key.length >= 2 &&
        (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(key)}($|[^\\p{L}\\p{N}])`, "iu").test(lower) || namedPossessively(lower, key)),
    ),
  );
}

/** The characters a page is drawn with. */
export function charactersOnPage(project: Project, unitId: string): Anchor[] {
  const here = new Set(castOnPage(project, unitId));
  return (project.anchors ?? []).filter((anchor) => anchor.type === "character" && anchor.include !== false && here.has(anchor.id));
}

/** Characters the sentence speaks of by name that the page is not drawn with. Empty when it names nobody. */
export function absentFromPage(project: Project, unitId: string, sentence: string): Anchor[] {
  const here = new Set(castOnPage(project, unitId));
  return anchorsNamedPossessively(sentence, project.anchors).filter((anchor) => anchor.type === "character" && !here.has(anchor.id));
}

type Gender = "male" | "female";

const MALE_PRONOUN = /\b(?:he|him|his|himself)\b|\b(?:er|ihn|ihm|sein\w*)\b/iu;
const FEMALE_PRONOUN = /\b(?:she|her|hers|herself)\b|\b(?:sie|ihr\w*)\b/iu;

/** "his hand" is a he; "give her an umbrella" a she; a sentence that says both, or neither, is neither. */
export function pronounGender(sentence: string): Gender | null {
  const male = MALE_PRONOUN.test(sentence);
  const female = FEMALE_PRONOUN.test(sentence);
  if (male === female) return null;
  return male ? "male" : "female";
}

const MALE_CUES =
  /\b(?:boy|man|father|dad|daddy|grandfather|grandpa|brother|uncle|son|king|prince|he|his|him|mr)\b|\b(?:junge|mann|vater|papa|opa|bruder|onkel|sohn|k(?:ö|oe)nig|prinz)\b/iu;
const FEMALE_CUES =
  /\b(?:girl|woman|mother|mom|mommy|mum|grandmother|grandma|sister|aunt|daughter|queen|princess|she|her|mrs|ms)\b|\b(?:m(?:ä|ae)dchen|frau|mutter|mama|oma|schwester|tante|tochter|k(?:ö|oe)nigin|prinzessin)\b/iu;

/** What an anchor's own words say about its gender; null when they say nothing, or both. */
function genderOf(anchor: Anchor): Gender | null {
  const words = `${anchor.name} ${anchor.description ?? ""}`;
  const male = MALE_CUES.test(words);
  const female = FEMALE_CUES.test(words);
  if (male === female) return null;
  return male ? "male" : "female";
}

/**
 * The people on the page a bare "his" or "her" could mean, when it could be more
 * than one; null when the sentence names somebody, is not about a single he or she,
 * or only one person on the page fits. A person whose description says nothing about
 * gender stays a candidate: asking once is better than redrawing the wrong person.
 */
export function ambiguousPerson(project: Project, unitId: string, sentence: string): Anchor[] | null {
  const gender = pronounGender(sentence);
  if (!gender) return null;
  if (namesAnyone(sentence, project.anchors ?? [])) return null;
  const candidates = charactersOnPage(project, unitId).filter((anchor) => {
    const theirs = genderOf(anchor);
    return theirs === null || theirs === gender;
  });
  return candidates.length >= 2 ? candidates : null;
}

/** Whether the sentence uses a he/she and names nobody: the chosen person's name is then added for the picture worker. */
export function speaksOfSomeoneUnnamed(project: Project, sentence: string): boolean {
  return pronounGender(sentence) !== null && !namesAnyone(sentence, project.anchors ?? []);
}
