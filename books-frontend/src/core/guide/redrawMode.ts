/**
 * Whether a picture change edits the picture that is there or draws a new one.
 *
 * "Make Dad's hair blue" is a change to a picture the reader already has, so
 * the current picture is the starting point and only the hair changes. A new
 * picture is drawn only when there is nothing to change yet, or the reader asks
 * for one ("start over", "draw it again", "something completely different").
 * Every result is a new version in the picture's history either way, so an edit
 * that goes wrong is one tap to take back.
 *
 * This is the one rule; the skills, the typed path and the buttons all use it.
 */
import { briefOf } from "../story/brief";
import type { PortraitImage, Project, StoryCastMember } from "../types";
import { getCursor } from "../versioning";
import { authoringOf } from "./projectState";
import type { GuideTarget } from "./target";
import { ageOfSignature, ageShiftMatters, type AgeParts } from "./visualAge";

export type RedrawMode = "edit" | "new";

/** The reader wants a new picture, not a change to this one. */
const NEW_PICTURE = [
  /\b(?:start(?:ing)?\s+over|from\s+scratch|from\s+the\s+beginning)\b/u,
  /\b(?:redo|re-?draw|re-?do)\s+(?:it|her|him|them|this|that|the\s+\w+)\s+(?:completely|entirely|from)\b/u,
  /\b(?:draw|make|try)\s+(?:it|her|him|them|this|that)?\s*(?:again|anew)\b/u,
  /\b(?:completely|entirely|totally)\s+(?:different|new)\b/u,
  /\b(?:a\s+)?(?:new|different|fresh)\s+(?:picture|image|drawing|portrait|version|take)\b/u,
  /\b(?:neu\s+zeichnen|noch\s+einmal\s+zeichnen|von\s+vorn|von\s+vorne|ganz\s+anders|komplett\s+anders|ein\s+neues\s+bild|neues\s+bild)\b/u,
];

/** Nothing but the request for a new picture, so there is no change to remember. */
const BARE_RESTART =
  /^(?:please\s+|bitte\s+)?(?:start\s+over|try\s+again|redo(?:\s+(?:it|this|that))?|draw\s+(?:it|her|him|them|this)\s+again|draw\s+(?:a\s+)?new\s+(?:picture|one|portrait)|from\s+scratch|nochmal(?:\s+neu)?|neu\s+zeichnen|noch\s+einmal)$/u;

function normalized(message: string): string {
  return message.trim().toLowerCase().replace(/[.!?]+$/u, "");
}

/**
 * "Redraw Arthur" or "retry", with at most the person's name: a new picture.
 * "Redraw his hair blue" names a change, so it stays an edit of the picture.
 */
function bareRedraw(text: string): boolean {
  const match = text.match(/^(?:please\s+|bitte\s+)?(?:re-?draw|re-?do|retry)(?:\s+(.+))?$/u);
  if (!match) return false;
  const rest = (match[1] ?? "").trim();
  if (!rest) return true;
  if (/\b(?:hair|hat|dress|shirt|coat|color|colour|blue|red|green|face|eyes|outfit|clothes|older|younger|again|with|in|wearing)\b/u.test(rest)) {
    return false;
  }
  return rest.split(/\s+/u).length <= 4;
}

export function asksForNewPicture(message: string): boolean {
  const text = normalized(message);
  if (!text) return false;
  return NEW_PICTURE.some((pattern) => pattern.test(text)) || bareRedraw(text);
}

/** "Start over" and nothing more: it is not a description to keep on the person. */
export function isBareRestart(message: string): boolean {
  const text = normalized(message);
  return BARE_RESTART.test(text) || bareRedraw(text);
}

/** "Redraw her." or "start over" as one sentence of a longer message. */
function asksForRedrawOnly(sentence: string): boolean {
  const text = normalized(sentence);
  if (!text) return false;
  if (isBareRestart(text)) return true;
  return /^(?:please\s+|bitte\s+)?(?:re-?draw|re-?do|retry|draw|zeichne)\s+(?:her|him|them|it|this|that|sie|ihn|es)(?:\s+(?:again|anew|new|neu|nochmal))?(?:\s+please|\s+bitte)?$/u.test(text);
}

/** "Amanda is 3 years old", "she's 3", "Leo ist 5 Jahre alt": a fact about someone, not a look. */
const AGE_FACT =
  /^(?:[\p{L}'’-]+\s+)?(?:is|was|are|ist|sind|['’]s)\s+(?:now\s+|jetzt\s+|actually\s+|only\s+|erst\s+)?(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:years?|yrs?|months?|jahre?|monate?)(?:\s+(?:old|alt))?)?$/iu;

function isAgeFact(sentence: string): boolean {
  return AGE_FACT.test(normalized(sentence).replace(/\s*(?:'s|’s)\s+/u, " 's "));
}

function sentencesOf(message: string): string[] {
  return message
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The part of a message that says how a picture should look, for keeping on
 * the person. Facts about them ("she is 3") belong in their fields, and a
 * request to draw again is not a look: both are left out, so they never ride
 * along into every later picture of that person.
 */
export function visualChange(message: string): string {
  return sentencesOf(message)
    .filter((sentence) => !asksForRedrawOnly(sentence) && !isAgeFact(sentence))
    .join(" ")
    .trim();
}

/** Some sentence of the message asks for the picture to be drawn again. */
export function asksForRedraw(message: string): boolean {
  return sentencesOf(message).some((sentence) => asksForRedrawOnly(sentence) || asksForNewPicture(sentence));
}

/** What a person is, apart from their age: another kind of being is another picture. */
type Being = { kind: string; species: string; bodyPlan: string };

function beingOfMember(member: StoryCastMember): Being {
  return {
    kind: member.kind && member.kind !== "person" ? member.kind : "",
    species: member.kind && member.kind !== "person" ? (member.species?.trim() ?? "") : "",
    bodyPlan: member.bodyPlan && member.bodyPlan !== "bipedal" ? member.bodyPlan : "",
  };
}

function ageOfMember(member: StoryCastMember): AgeParts {
  return { age: member.age ?? null, months: member.ageMonths ?? null, visualYears: member.visualAge?.years ?? null };
}

function drawnPerson(image: PortraitImage): { being: Being; age: AgeParts } | null {
  try {
    const drawn = JSON.parse(image.inputs.subjectSignature) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      being: { kind: text(drawn.kind), species: text(drawn.species), bodyPlan: text(drawn.bodyPlan) },
      age: ageOfSignature(drawn),
    };
  } catch {
    return null;
  }
}

/**
 * The person is no longer who their picture shows: an age that looks different
 * (`ageShiftMatters`), or another kind of being. Changing that picture would
 * keep the old face (a six-year-old edited to look three is still six), so the
 * only honest picture is a new one. An age that looks the same (a year on an
 * adult) is not a change of person.
 */
export function identityChanged(project: Project, castId: string): boolean {
  const tree = authoringOf(project).portraits?.[castId];
  const member = briefOf(project.config).cast?.find((candidate) => candidate.id === castId);
  if (!tree || !member) return false;
  const image = getCursor(tree).content;
  if (!image) return false;
  const drawn = drawnPerson(image);
  if (!drawn) return false;
  const now = beingOfMember(member);
  if ((Object.keys(now) as (keyof Being)[]).some((key) => now[key] !== drawn.being[key])) return true;
  return ageShiftMatters(drawn.age, ageOfMember(member));
}

/** Whether the picture a change is about has been drawn yet. */
export function hasPicture(project: Project, target: GuideTarget): boolean {
  if (target.kind === "person") return Boolean(authoringOf(project).portraits?.[target.castId]);
  const tree = project.illustrations?.[target.unitId];
  return Boolean(tree && tree.nodes[tree.cursorId]);
}

/**
 * What a typed change does to this picture. The model that draws it must be
 * able to edit from a picture (`canEdit`); when it can't, the change is drawn
 * anew from the description rather than refused.
 */
export function redrawModeFor(
  project: Project,
  target: GuideTarget,
  options: { restart?: boolean; canEdit?: boolean } = {},
): RedrawMode {
  if (options.restart) return "new";
  if (options.canEdit === false) return "new";
  if (target.kind === "person" && identityChanged(project, target.castId)) return "new";
  return hasPicture(project, target) ? "edit" : "new";
}
