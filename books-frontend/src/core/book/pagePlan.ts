/**
 * Edits to one page's plan: its words, what is happening on it, who is on it,
 * and whether it carries a picture.
 *
 * Pure functions on the book, shared by the page editor and the assistant's
 * commands so both do exactly the same thing. Each returns the same object when
 * nothing changes, so callers can tell a no-op from an edit without comparing.
 *
 * Two rules hold everywhere here:
 *   - The art style is never a page's to change. It comes from the book
 *     (`config.artStyle`) and the style reference; anything in a page's
 *     description that asks for a different one is removed on the way in.
 *   - A picture is never deleted by an edit. Taking the picture off a page hides
 *     it; the history stays, so putting it back is free.
 */
import { textFromParagraphs, type PageDesign } from "../design";
import { getCursor, pruneToRecent, type VersionTree } from "../versioning";
import type { IllustrationImage, Project, RemovedPage, ScreenplayDoc, ScreenplaySpread } from "../types";
import { withoutStyleAsides } from "./styleRequest";
import { insertSpreadProject, removeSpreadProject, withSpreads } from "./pageEdits";
import { storyBoxOf } from "./storyBox";
import { canonWords, rewordParagraphs, wordsOfParagraphs } from "./pageWords";

/** Longest page description kept: the picture prompt has room for one scene, not a chapter. */
export const SCENE_MAX = 800;
/** Longest wording a page keeps. */
export const WORDS_MAX = 1500;
/** The most people a page's picture is told to show. */
export const CAST_MAX = 6;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** What a page is, read from the book. The editor and the assistant both say it this way. */
export type PageKind = "picture" | "text" | "designed" | "empty";

function docOf(project: Project): ScreenplayDoc | null {
  return project.screenplay ? getCursor(project.screenplay).content : null;
}

export function spreadOf(project: Project, id: string): ScreenplaySpread | undefined {
  return docOf(project)?.spreads.find((spread) => spread.id === id);
}

/** Whether a page was set to carry no picture (a text page or a designed one). */
export function hasNoPicture(spread: Pick<ScreenplaySpread, "blankCanvas" | "completion">): boolean {
  return Boolean(spread.blankCanvas) || spread.completion === "text" || spread.completion === "blank";
}

function designHasContent(page: PageDesign | undefined): boolean {
  if (!page) return false;
  const text = page.textBoxes.some(
    (box) => !box.hidden && textFromParagraphs(box.paragraphs).trim().length > 0,
  );
  const shapes = (page.shapes ?? []).some((shape) => !shape.hidden);
  const images = (page.images ?? []).some((image) => image.kind === "asset" && !image.hidden);
  return text || shapes || images;
}

/**
 * Which of four states a page is in, so one control can name it:
 * a picture page, a page of words, a page the reader designed, or a page with nothing yet.
 */
export function pageKind(project: Project, id: string): PageKind {
  const spread = spreadOf(project, id);
  if (!spread) return "empty";
  if (!hasNoPicture(spread)) return "picture";
  if (spread.text.trim()) return "text";
  return designHasContent(project.design?.pages[id]) ? "designed" : "empty";
}

/** Change one page, or leave the book untouched when nothing differs. */
function patchSpread(
  project: Project,
  id: string,
  change: (spread: ScreenplaySpread) => ScreenplaySpread,
): Project {
  const current = spreadOf(project, id);
  if (!current) return project;
  const next = change(current);
  if (next === current) return project;
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]) as Set<keyof ScreenplaySpread>;
  let differs = false;
  for (const key of keys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) {
      differs = true;
      break;
    }
  }
  if (!differs) return project;
  return withSpreads(project, (spreads) => spreads.map((spread) => (spread.id === id ? next : spread)));
}

/** A page description made safe to draw from: no controls, no style request, a sane length. */
export function cleanScene(scene: string): string {
  return withoutStyleAsides(scene.replace(CONTROL, " "))
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, SCENE_MAX)
    .trim();
}

/** What is happening on a page, in the reader's words, with any art-style request taken out. */
export function setPageScene(project: Project, id: string, scene: string): Project {
  const next = cleanScene(scene);
  return patchSpread(project, id, (spread) => (spread.illustration === next ? spread : { ...spread, illustration: next }));
}

/** Who is on a page, from the cast the book already has. Names the book doesn't know are ignored. */
export function setPageCast(project: Project, id: string, anchorIds: readonly string[]): Project {
  const known = new Map((project.anchors ?? []).map((anchor) => [anchor.id, anchor] as const));
  const ids = [...new Set(anchorIds)].filter((anchorId) => known.has(anchorId)).slice(0, CAST_MAX);
  return patchSpread(project, id, (spread) => {
    const same = ids.length === spread.anchorIds.length && ids.every((anchorId, i) => spread.anchorIds[i] === anchorId);
    if (same) return spread;
    return { ...spread, anchorIds: ids, anchorNames: ids.map((anchorId) => known.get(anchorId)!.name) };
  });
}

/** Words made safe to keep: no control characters, one kind of line ending, a sane length. */
export function cleanWords(words: string): string {
  return words.replace(CONTROL, "").replace(/\r\n?/g, "\n").slice(0, WORDS_MAX);
}

/**
 * The page with these words. Words on a page that had none make it a page with words, not a
 * picture-only one, and a page without a picture is "text" or "blank" by whether it has words.
 */
export function spreadWithWords(spread: ScreenplaySpread, text: string): ScreenplaySpread {
  if (spread.text === text) return spread;
  const { wordless: _wordless, ...withWords } = spread;
  const base = text.trim() ? withWords : spread;
  const completion = hasNoPicture(spread) ? { completion: text.trim() ? ("text" as const) : ("blank" as const) } : {};
  return { ...base, text, ...completion };
}

/**
 * The page's words: the plan and the story text box together, so what is printed
 * and what the plan says never drift. The box keeps its look, and the words that did not change keep
 * theirs; only the words that changed are rewritten. A page with no story box keeps the plan's words,
 * and the editor adds the box (`ensureStoryBox`) so the words show.
 *
 * Every write to the book also passes `pageWordsGate.reconcilePageWords`, which does the same for
 * a change made any other way. This is the same step, done up front for callers that read the result.
 */
export function setPageWords(project: Project, id: string, words: string): Project {
  const text = cleanWords(words);
  let next = patchSpread(project, id, (spread) => spreadWithWords(spread, text));
  const design = next.design;
  const page = design?.pages[id];
  const box = storyBoxOf(page);
  if (design && page && box !== "none" && box !== "several") {
    if (wordsOfParagraphs(box.paragraphs) !== canonWords(text)) {
      next = {
        ...next,
        design: {
          ...design,
          pages: {
            ...design.pages,
            [id]: {
              ...page,
              textBoxes: page.textBoxes.map((candidate) =>
                candidate.id === box.id ? { ...candidate, paragraphs: rewordParagraphs(box.paragraphs, text) } : candidate,
              ),
            },
          },
        },
      };
    }
  }
  return next;
}

/** Whether the art on a page is currently shown on it. */
function artHidden(page: PageDesign | undefined): boolean {
  return Boolean(page?.images?.some((image) => image.kind === "illustration" && image.hidden));
}

/**
 * Put a picture on a page or take it off.
 *
 * Off hides the picture and marks the page done as it is (words, or left blank on
 * purpose); nothing is deleted. On shows the last picture again, free, when the page
 * ever had one; otherwise the page simply needs drawing.
 */
export function setPageHasPicture(project: Project, id: string, on: boolean): Project {
  const spread = spreadOf(project, id);
  if (!spread) return project;
  const has = !hasNoPicture(spread);
  const design = project.design;
  const page = design?.pages[id];
  let next = project;
  if (has !== on) {
    next = patchSpread(project, id, (current) => {
      if (on) {
        const { blankCanvas: _blank, completion: _completion, ...rest } = current;
        return rest;
      }
      return { ...current, blankCanvas: true, completion: current.text.trim() ? "text" : "blank" };
    });
  }
  const images = page?.images;
  if (design && page && images?.some((image) => image.kind === "illustration" && Boolean(image.hidden) === on)) {
    next = {
      ...next,
      design: {
        ...design,
        pages: {
          ...design.pages,
          [id]: {
            ...page,
            images: images.map((image) => (image.kind === "illustration" ? { ...image, hidden: !on } : image)),
          },
        },
      },
    };
  }
  return next;
}

/** Whether a page has a picture from before, so turning the picture back on is free. */
export function hasEarlierPicture(project: Project, id: string): boolean {
  const tree = project.illustrations?.[id];
  if (!tree) return false;
  const render = getCursor(tree).content;
  return Boolean(render.blobId);
}

/** Whether the art is hidden by the design layer (`setPageHasPicture(off)`). */
export function pictureIsHidden(project: Project, id: string): boolean {
  return artHidden(project.design?.pages[id]);
}

/** The people two neighbouring pages share, or the one neighbour's people: who a new page probably shows. */
function neighbourCast(project: Project, before: ScreenplaySpread | undefined, after: ScreenplaySpread | undefined): string[] {
  const people = new Set(
    (project.anchors ?? []).filter((anchor) => anchor.type === "character").map((anchor) => anchor.id),
  );
  const pick = (spread: ScreenplaySpread | undefined) => (spread?.anchorIds ?? []).filter((anchorId) => people.has(anchorId));
  const a = pick(before);
  const b = pick(after);
  const out = before && after ? a.filter((anchorId) => b.includes(anchorId)) : before ? a : b;
  return out.slice(0, 3);
}

export interface NewPageInput {
  /** What is happening on it. Empty leaves the page to be described. */
  scene?: string;
  /** Its words, exactly as the reader wrote them. */
  words?: string;
  /** Who is on it. Omitted: the people the pages around it share. */
  castIds?: string[];
  /** Without a picture: a page of words, or a page left blank on purpose. */
  picture?: boolean;
  /** A fixed id (see `derivedSpreadId`), for a skill that must plan and write the same page. */
  id?: string;
}

/**
 * A new page at a position in the book. It is a picture page unless told otherwise, so the
 * reader's first step is to say what happens on it; nothing is drawn or charged here.
 */
export function insertPage(project: Project, docIndex: number, input: NewPageInput = {}): { project: Project; id: string } {
  const doc = docOf(project);
  const at = Math.max(0, Math.min(docIndex, doc?.spreads.length ?? 0));
  const out = insertSpreadProject(project, at, input.id ? { id: input.id } : {});
  let next = out.project;
  const spreads = docOf(next)?.spreads ?? [];
  const index = spreads.findIndex((spread) => spread.id === out.id);
  const cast = input.castIds ?? neighbourCast(project, spreads[index - 1], spreads[index + 1]);
  if (input.scene) next = setPageScene(next, out.id, input.scene);
  if (cast.length > 0) next = setPageCast(next, out.id, cast);
  if (input.words?.trim()) next = setPageWords(next, out.id, input.words);
  if (input.picture === false) next = setPageHasPicture(next, out.id, false);
  return { project: next, id: out.id };
}

// ---- Taking a page out, and putting it back --------------------------------------------

/** Pages kept after they are removed. Counted, not timed: a page is not lost because a week passed. */
export const REMOVED_PAGES_KEPT = 10;

/** The pages that can be put back, newest first. */
export function removedPagesOf(project: Project): RemovedPage[] {
  // A page that is back in the book (taken back with Undo) is not "removed", whatever the bin still holds.
  const inBook = new Set(docOf(project)?.spreads.map((spread) => spread.id) ?? []);
  return [...(project.removedPages ?? [])].filter((entry) => !inBook.has(entry.spread.id)).reverse();
}

/** A picture trimmed for keeping: the version in use and the first one, nothing else. */
function keptPicture(tree: VersionTree<IllustrationImage> | undefined): VersionTree<IllustrationImage> | undefined {
  return tree ? pruneToRecent(tree, 1) : undefined;
}

/**
 * The book without a page, with the page kept so it can be put back in the same place. The
 * picture is kept too: a drawing the reader paid for is not thrown away with the page.
 */
export function removePage(project: Project, id: string, now: number = Date.now()): Project {
  const doc = docOf(project);
  const at = doc ? doc.spreads.findIndex((spread) => spread.id === id) : -1;
  if (!doc || at < 0) return project;
  const entry: RemovedPage = {
    spread: doc.spreads[at]!,
    ...(project.design?.pages[id] ? { design: project.design.pages[id] } : {}),
    ...(project.illustrations?.[id] ? { illustration: keptPicture(project.illustrations[id]) } : {}),
    removedAt: now,
    ...(at > 0 ? { afterId: doc.spreads[at - 1]!.id } : {}),
  };
  const removed = removeSpreadProject(project, id);
  const others = (project.removedPages ?? []).filter((kept) => kept.spread.id !== id);
  return { ...removed, removedPages: [...others, entry].slice(-REMOVED_PAGES_KEPT) };
}

/**
 * Put a removed page back where it was (after the page it followed, else first, else last when that
 * page is gone too), with its picture and layout. The newest removed page when none is named.
 */
export function restorePage(project: Project, id?: string): { project: Project; id: string | null } {
  const bin = project.removedPages ?? [];
  const found = id ? bin.find((entry) => entry.spread.id === id) : removedPagesOf(project)[0];
  const doc = docOf(project);
  if (!doc) return { project, id: null };
  if (!found) {
    // Entries for pages that are back in the book (Undo took them back) are only leftovers: drop them.
    const live = new Set(doc.spreads.map((spread) => spread.id));
    const kept = bin.filter((entry) => !live.has(entry.spread.id));
    return { project: kept.length === bin.length ? project : { ...project, removedPages: kept }, id: null };
  }
  // The same id is already in the book (a copy, or a plan that made it again): there is nothing to put back.
  const without = (current: Project): Project => ({
    ...current,
    removedPages: (current.removedPages ?? []).filter((entry) => entry !== found),
  });
  if (doc.spreads.some((spread) => spread.id === found.spread.id)) return { project: without(project), id: null };
  const after = found.afterId ? doc.spreads.findIndex((spread) => spread.id === found.afterId) : -1;
  const index = found.afterId ? (after >= 0 ? after + 1 : doc.spreads.length) : 0;
  let next = withSpreads(project, (spreads) => {
    const out = [...spreads];
    out.splice(index, 0, found.spread);
    return out;
  });
  if (found.design && next.design) {
    next = { ...next, design: { ...next.design, pages: { ...next.design.pages, [found.spread.id]: found.design } } };
  }
  if (found.illustration) {
    next = { ...next, illustrations: { ...(next.illustrations ?? {}), [found.spread.id]: found.illustration } };
  }
  return { project: without(next), id: found.spread.id };
}

/** Whether a removed page with this id is waiting in the bin. */
export function isRemovedPage(project: Project, id: string): boolean {
  return (project.removedPages ?? []).some((entry) => entry.spread.id === id);
}

/** A picture drawn for a page that has since been removed goes to the page's kept copy, not away. */
export function withRemovedPicture(
  project: Project,
  id: string,
  update: (tree: VersionTree<IllustrationImage> | undefined) => VersionTree<IllustrationImage>,
): Project {
  const bin = project.removedPages;
  if (!bin?.some((entry) => entry.spread.id === id)) return project;
  return {
    ...project,
    removedPages: bin.map((entry) =>
      entry.spread.id === id ? { ...entry, illustration: keptPicture(update(entry.illustration)) } : entry,
    ),
  };
}

/**
 * The story as it reads now. Before drawing it is the story the reader wrote or had written
 * (`config.storyText`). Once drawing has started the pages hold the words, so it is what the pages say,
 * and an edit to a page is an edit to the story. `config.storyText` is then only the story the pictures
 * were made from, which staleness checks compare against and nothing else should read as "the story".
 */
export function storyOf(project: Project): string {
  return project.authoringState?.lockedAt !== undefined && docOf(project) ? bookWords(project) : project.config.storyText;
}

/**
 * The book's words as they are now: each page's words in order, a blank line between pages.
 * After drawing starts the pages are where the words live; `config.storyText` is the story as it was
 * when drawing began and is not changed by editing a page.
 */
export function bookWords(project: Project): string {
  const doc = docOf(project);
  if (!doc) return project.config.storyText;
  return doc.spreads
    .filter((spread) => !spread.placeholder)
    .map((spread) => spread.text.trim())
    .filter(Boolean)
    .join("\n\n");
}
