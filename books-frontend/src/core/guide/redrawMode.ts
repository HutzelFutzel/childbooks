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
import type { Project } from "../types";
import { authoringOf } from "./projectState";
import type { GuideTarget } from "./target";

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

export function asksForNewPicture(message: string): boolean {
  const text = normalized(message);
  return text.length > 0 && NEW_PICTURE.some((pattern) => pattern.test(text));
}

/** "Start over" and nothing more: it is not a description to keep on the person. */
export function isBareRestart(message: string): boolean {
  return BARE_RESTART.test(normalized(message));
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
  return hasPicture(project, target) ? "edit" : "new";
}
