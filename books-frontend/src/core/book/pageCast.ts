/**
 * Who is on a page, by name.
 *
 * A page is drawn with a reference sheet for each person (or thing, or place)
 * it lists in `anchorIds`. "Add Amanda to page 3" only draws *Amanda* when she
 * is on that list: otherwise the picture gets a stranger. The app resolves the
 * names, never the model, the same way it resolves page numbers.
 *
 * Pure: a project and a sentence in, a project out.
 */
import { getCursor, updateNodeContent } from "../versioning";
import { COVER_BACK_ID, COVER_FRONT_ID, type Anchor, type CoverSpec, type Project, type ScreenplayDoc } from "../types";
import { anchorNameKeys, effectiveAnchorIds, normalizeAnchorName } from "./anchorRefs";

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `text` says `name` as a word (or words), not as part of another word. */
function mentionsName(text: string, name: string): boolean {
  const key = normalizeAnchorName(name);
  if (key.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(key)}($|[^\\p{L}\\p{N}])`, "iu").test(text.toLowerCase());
}

/** The book's people, things and places the sentence names, in the order the book lists them. */
export function anchorsNamedIn(text: string, anchors: readonly Anchor[] | undefined): Anchor[] {
  return (anchors ?? []).filter(
    (anchor) => anchor.include !== false && anchorNameKeys(anchor).some((key) => mentionsName(text, key)),
  );
}

/** One name the reader wrote, resolved to an anchor of the book; null when the book has nobody by that name. */
export function anchorByName(name: string, anchors: readonly Anchor[] | undefined): Anchor | null {
  const key = normalizeAnchorName(name);
  if (!key) return null;
  const find = (wanted: string) => (anchors ?? []).find((anchor) => anchorNameKeys(anchor).includes(wanted)) ?? null;
  const exact = find(key);
  if (exact) return exact;
  // The reader's own possessive ("Hugos", "Hugo's") still means the person, when nobody is named that.
  const bare = key.replace(/['’]s$/u, "");
  if (bare !== key) return find(bare);
  return key.length > 3 && key.endsWith("s") ? find(key.slice(0, -1)) : null;
}

type Listed = Pick<CoverSpec, "anchorIds" | "anchorNames">;

function listedOn(doc: ScreenplayDoc, unitId: string): Listed | null {
  if (unitId === COVER_FRONT_ID) return doc.frontCover ?? null;
  if (unitId === COVER_BACK_ID) return doc.backCover ?? null;
  return doc.spreads.find((spread) => spread.id === unitId) ?? null;
}

/** The people, things and places a page or cover is drawn with, as the book will draw it. */
export function castOnPage(project: Project, unitId: string): string[] {
  if (!project.screenplay) return [];
  const listed = listedOn(getCursor(project.screenplay).content, unitId);
  return listed ? effectiveAnchorIds(project.anchors, { anchorIds: listed.anchorIds ?? [], anchorNames: listed.anchorNames }) : [];
}

/**
 * Whether a page is now drawn with somebody its picture was not made with. A
 * change like that is a new picture of the page, not an edit that can stay in place.
 */
export function gainedCast(project: Project, unitId: string): boolean {
  const tree = project.illustrations?.[unitId];
  if (!tree) return false;
  const used = new Set((getCursor(tree).content.references ?? []).map((use) => use.anchorId));
  return castOnPage(project, unitId).some((id) => !used.has(id));
}

/** The people on each of these pages, for a later {@link restoreCast}. Only pages that exist. */
export function castSnapshot(project: Project, unitIds: readonly string[]): Record<string, Listed> {
  const out: Record<string, Listed> = {};
  if (!project.screenplay) return out;
  const doc = getCursor(project.screenplay).content;
  for (const id of unitIds) {
    const listed = listedOn(doc, id);
    if (listed) out[id] = { anchorIds: [...(listed.anchorIds ?? [])], ...(listed.anchorNames ? { anchorNames: [...listed.anchorNames] } : {}) };
  }
  return out;
}

/** Every page whose cast differs between two versions of the book. */
export function pagesWithCastChange(before: Project, after: Project): string[] {
  if (!before.screenplay || !after.screenplay || before.screenplay === after.screenplay) return [];
  const was = getCursor(before.screenplay).content;
  const now = getCursor(after.screenplay).content;
  const ids = [...now.spreads.map((spread) => spread.id), COVER_FRONT_ID, COVER_BACK_ID];
  return ids.filter((id) => {
    const a = listedOn(was, id)?.anchorIds ?? [];
    const b = listedOn(now, id)?.anchorIds ?? [];
    return a.length !== b.length || a.some((anchor, index) => anchor !== b[index]);
  });
}

/** Put each page's cast back as a snapshot had it. Pages that are gone are skipped. */
export function restoreCast(project: Project, saved: Record<string, Listed>): Project {
  const tree = project.screenplay;
  if (!tree || Object.keys(saved).length === 0) return project;
  const doc = structuredClone(getCursor(tree).content);
  for (const [id, listed] of Object.entries(saved)) {
    const target = listedOn(doc, id);
    if (!target) continue;
    target.anchorIds = [...(listed.anchorIds ?? [])];
    if (listed.anchorNames) target.anchorNames = [...listed.anchorNames];
    else delete target.anchorNames;
  }
  return { ...project, screenplay: updateNodeContent(tree, tree.cursorId, doc) };
}

/** These anchors are on every one of these pages (added, not replaced), with their names recorded for self-healing. */
export function withPageCast(project: Project, unitIds: readonly string[], anchorIds: readonly string[]): Project {
  const tree = project.screenplay;
  if (!tree || anchorIds.length === 0) return project;
  const byId = new Map((project.anchors ?? []).map((anchor) => [anchor.id, anchor]));
  const add = anchorIds.filter((id) => byId.has(id));
  if (add.length === 0) return project;
  const doc: ScreenplayDoc = structuredClone(getCursor(tree).content);
  let changed = false;
  for (const unitId of unitIds) {
    const target = listedOn(doc, unitId);
    if (!target) continue;
    const here = effectiveAnchorIds(project.anchors, { anchorIds: target.anchorIds ?? [], anchorNames: target.anchorNames });
    const next = [...new Set([...here, ...add])];
    if (next.length === here.length) continue;
    target.anchorIds = next;
    target.anchorNames = next.map((id) => byId.get(id)?.name ?? "");
    changed = true;
  }
  return changed ? { ...project, screenplay: updateNodeContent(tree, tree.cursorId, doc) } : project;
}
