/**
 * The history of a picture, as the reader walks through it.
 *
 * Every redraw adds a version and nothing is thrown away, so "the old one was
 * better" is always possible. This reads a picture's versions in the order they
 * were drawn and moves between them. The picture itself carries the control
 * (‹ 2 / 3 ›); this is the pure part underneath it and under the "go back"
 * skill.
 *
 * A portrait is more than a picture: it was drawn for a person as described at
 * that moment. Choosing an earlier portrait therefore puts that description
 * back with it, and counts as the reader's choice for the person as they are
 * now, so it is never flagged as out of date for the note that moved on.
 * Only a different art style keeps it out of date, because that one really is
 * a different look.
 */
import type { Project } from "../types";
import { allVersions, selectVersion, updateNodeContent, type VersionTree } from "../versioning";
import { withMemberChanges } from "./agent/commands/shared";
import { portraitInputs, portraitSubjects, withPortraitAnchorReferences } from "./portrait";
import { authoringOf, pagesLocked, withAuthoring } from "./projectState";
import type { GuideTarget } from "./target";

/** A picture with a version tree behind it. */
type PictureTree = VersionTree<{ blobId: string }>;

export interface PictureHistory {
  /** Version ids, oldest first. */
  ids: readonly string[];
  /** Index of the version in the book. */
  at: number;
  count: number;
}

function treeOf(project: Project, target: GuideTarget): PictureTree | null {
  const tree =
    target.kind === "person"
      ? authoringOf(project).portraits?.[target.castId]
      : project.illustrations?.[target.unitId];
  return (tree as PictureTree | undefined) ?? null;
}

/**
 * The versions of a picture, or null when there is nothing to choose between
 * (one version) or the picture can't change any more (a portrait once the
 * pages are drawn from it).
 */
export function pictureHistory(project: Project, target: GuideTarget): PictureHistory | null {
  if (target.kind === "person" && pagesLocked(project)) return null;
  const tree = treeOf(project, target);
  if (!tree) return null;
  const nodes = allVersions(tree);
  if (nodes.length < 2) return null;
  const ids = nodes.map((node) => node.id);
  return { ids, at: Math.max(0, ids.indexOf(tree.cursorId)), count: ids.length };
}

/** The version a step of `delta` lands on, or null at either end. */
export function neighbourVersion(history: PictureHistory, delta: number): string | null {
  return history.ids[history.at + delta] ?? null;
}

/** The blob of a version, for showing it before it is chosen. */
export function versionBlobId(project: Project, target: GuideTarget, versionId: string): string | null {
  return treeOf(project, target)?.nodes[versionId]?.content.blobId ?? null;
}

/** A portrait version chosen again: its description comes back with it. */
export function withPortraitVersion(project: Project, castId: string, versionId: string): Project {
  if (pagesLocked(project)) return project;
  const tree = authoringOf(project).portraits?.[castId];
  const node = tree?.nodes[versionId];
  if (!tree || !node) return project;
  const member = portraitSubjects(project).find((m) => m.id === castId);
  if (!member) return project;
  const { look } = node.content;
  // The description it was drawn from comes back; an old picture without one keeps today's.
  const restored = look
    ? withMemberChanges(project, castId, {
        portraitNote: look.portraitNote || undefined,
        appearance: look.appearance || undefined,
      })
    : project;
  const now = portraitSubjects(restored).find((m) => m.id === castId) ?? member;
  const chosen = {
    ...node.content,
    // Current for the person as they are now; only a different art style stays out of date.
    inputs: { ...portraitInputs(restored, now), styleKey: node.content.inputs.styleKey },
  };
  const picked = selectVersion(updateNodeContent(tree, versionId, chosen), versionId);
  return withPortraitAnchorReferences(
    withAuthoring(restored, { portraits: { ...authoringOf(restored).portraits, [castId]: picked } }),
  );
}

/** A page or cover version chosen again. The store applies it (design frames follow the art). */
export function illustrationWithVersion(project: Project, unitId: string, versionId: string) {
  const tree = project.illustrations?.[unitId];
  if (!tree || !tree.nodes[versionId]) return null;
  return selectVersion(tree, versionId);
}

/** Whether there is an earlier version than the one in the book. */
export function hasEarlier(project: Project, target: GuideTarget): boolean {
  const history = pictureHistory(project, target);
  return history !== null && history.at > 0;
}

/** Who or what a picture is of, in the words a line uses. */
export function pictureSubject(target: GuideTarget): string {
  if (target.kind === "person") return target.name;
  return target.kind === "cover" ? "the cover" : `page ${target.page}`;
}

const BACK_VERB =
  /^(?:(?:please|bitte|can you|could you|kannst du|könntest du)\s+)?(?:go back|bring back|take back|put back|switch back|change back|revert|restore|geh zurück|gehe zurück|zurück|stell wieder her|stelle wieder her|bring zurück)\b/u;
const EARLIER_PICTURE =
  /\b(?:earlier|previous|old|older|prior|last|vorherige[nrms]?|frühere[nrms]?|ältere[nrms]?|alte[nrms]?|letzte[nrms]?)\s+(?:picture|image|version|one|look|portrait|drawing|illustration|bild|version|zeichnung|porträt|portrait)\b/u;

/**
 * Whether a short sentence asks to go back to an earlier picture, rather than
 * to change it. Used where a message about a selected picture would otherwise
 * be read as a change to redraw, so it is deliberately narrow: it starts with
 * "go back" (and the like) or names an earlier picture, and it is short.
 */
export function asksForEarlierPicture(message: string): boolean {
  const text = message.trim().toLowerCase().replace(/[.!?]+$/u, "");
  if (!text || text.split(/\s+/u).length > 12) return false;
  return BACK_VERB.test(text) || EARLIER_PICTURE.test(text);
}
