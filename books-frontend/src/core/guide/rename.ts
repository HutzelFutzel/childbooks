/**
 * Giving a character a new name, everywhere the old one is written.
 *
 * A name is the reader's handle on a person, but it is also written into the
 * story, the page plan, the cover, the pictures' references and the book's
 * notes. Changing it in one place leaves the book contradicting itself, and the
 * next read of the story would find the old name and add that person back. So a
 * rename is one operation, here, and the cast card, the story and the chat all
 * run it: the cast member's id is who they are, the name only what they are called.
 *
 * Pure: it returns the renamed book and what the caller still has to say about
 * the cover's words (the title and subtitle are written through the store, which
 * keeps the canvas boxes that show them in step).
 */
import { normalizeAnchorName } from "../book/anchorRefs";
import { coverLinesOf } from "../book/coverLines";
import { renameDerivedStyleNames } from "../book/sourceArt";
import { briefOf, isDraftStale, storyBriefSignature } from "../story/brief";
import type {
  Anchor,
  CoverSpec,
  PageDesign,
  Project,
  ReferenceUse,
  ScreenplayDoc,
  StoryBrief,
  StoryCastMember,
  TextParagraph,
} from "../types";
import { anchorSignature } from "../pipeline/provenance";
import { getCursor, updateNodeContent, type VersionTree } from "../versioning";
import { foldName } from "./agent/resolve";
import { countNameMentions, properName, renameInText } from "./nameText";
import { manuscriptHash } from "./ownWords";
import { portraitInputs, portraitStatus, portraitSubjects } from "./portrait";
import { authoringOf, withAuthoring } from "./projectState";

export const MAX_NAME_LENGTH = 60;

/** A name as typed: no wrapping quotes, single spaces, a sensible length, and capitals where a name has them. */
export function cleanName(raw: string): string {
  return properName(
    raw
      .replace(/^["'“„«‘‚]+|["'”“»’‘]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME_LENGTH),
  );
}

export type RenameRefusal = "empty" | "unknown" | "taken" | "same";

export interface PersonRename {
  project: Project;
  from: string;
  to: string;
  /** How many times the story said the old name. */
  storyMentions: number;
  /** The title with the new name, or null when the title never said the old one. */
  title: string | null;
  /** The subtitle with the new name, or null when it never said the old one. */
  subtitle: string | null;
}

/** Everything that says the name: how many mentions a rename will touch in the story. */
export function renameMentions(project: Project, name: string): number {
  return countNameMentions(project.config.storyText, name.trim());
}

/** Change a field's text, and leave the object as it was when nothing in it said the name. */
function swapFields<T extends object>(value: T, keys: readonly (keyof T)[], swap: (text: string) => string): T {
  let next = value;
  for (const key of keys) {
    const text = value[key];
    if (typeof text !== "string" || !text) continue;
    const swapped = swap(text);
    if (swapped !== text) next = { ...next, [key]: swapped } as T;
  }
  return next;
}

const CAST_TEXT_FIELDS = ["role", "note", "appearance", "portraitNote", "lookFromArt"] as const;
const BRIEF_TEXT_FIELDS = [
  "customTheme",
  "customDevice",
  "customSetting",
  "occasion",
  "when",
  "where",
  "mustInclude",
  "pictureNotes",
] as const;

function swapBrief(brief: StoryBrief, from: string, to: string, swap: (text: string) => string): StoryBrief {
  let next = swapFields(brief, BRIEF_TEXT_FIELDS, swap);
  if (brief.heroNames?.some((name) => name.trim() === from)) {
    next = { ...next, heroNames: brief.heroNames.map((name) => (name.trim() === from ? to : name)) };
  }
  if (brief.relations?.some((relation) => relation.label && swap(relation.label) !== relation.label)) {
    next = {
      ...next,
      relations: brief.relations.map((relation) => (relation.label ? { ...relation, label: swap(relation.label) } : relation)),
    };
  }
  if (brief.details) {
    const details = Object.fromEntries(
      Object.entries(brief.details).map(([id, detail]) => [id, detail.text ? { ...detail, text: swap(detail.text) } : detail]),
    );
    if (JSON.stringify(details) !== JSON.stringify(brief.details)) next = { ...next, details };
  }
  return next;
}

function swapParagraphs(paragraphs: TextParagraph[] | undefined, swap: (text: string) => string): TextParagraph[] | undefined {
  if (!paragraphs) return paragraphs;
  let changed = false;
  const next = paragraphs.map((paragraph) => ({
    ...paragraph,
    spans: paragraph.spans.map((span) => {
      const text = swap(span.text);
      if (text === span.text) return span;
      changed = true;
      return { ...span, text };
    }),
  }));
  return changed ? next : paragraphs;
}

const COVER_ROLES = new Set(["book-title", "book-subtitle", "book-author"]);

/** The words on the pages, in the canvas. The cover's own lines follow the title through the store. */
function swapPageDesign(page: PageDesign, swap: (text: string) => string): PageDesign {
  let changed = false;
  const textBoxes = page.textBoxes.map((box) => {
    if (box.role && COVER_ROLES.has(box.role)) return box;
    const paragraphs = swapParagraphs(box.paragraphs, swap);
    if (paragraphs === box.paragraphs) return box;
    changed = true;
    return { ...box, paragraphs: paragraphs! };
  });
  const shapes = page.shapes?.map((shape) => {
    const paragraphs = swapParagraphs(shape.text?.paragraphs, swap);
    if (!shape.text || paragraphs === shape.text.paragraphs) return shape;
    changed = true;
    return { ...shape, text: { ...shape.text, paragraphs: paragraphs! } };
  });
  return changed ? { ...page, textBoxes, ...(shapes ? { shapes } : {}) } : page;
}

function swapSpec(
  spec: CoverSpec | undefined,
  swap: (text: string) => string,
  swapNames: (names: string[] | undefined) => string[] | undefined,
  options: { title: boolean },
): CoverSpec | undefined {
  if (!spec) return spec;
  return {
    ...spec,
    illustration: swap(spec.illustration),
    ...(spec.anchorNames ? { anchorNames: swapNames(spec.anchorNames) } : {}),
    ...(options.title && spec.title ? { title: swap(spec.title) } : {}),
  };
}

function withScreenplayRenamed(project: Project, from: string, to: string, swap: (text: string) => string): Project {
  const tree = project.screenplay;
  if (!tree) return project;
  const key = normalizeAnchorName(from);
  const swapNames = (names: string[] | undefined) =>
    names?.map((name) => (normalizeAnchorName(name) === key ? to : name));
  const doc = getCursor(tree).content;
  const frontCover = swapSpec(doc.frontCover, swap, swapNames, { title: false });
  const backCover = swapSpec(doc.backCover, swap, swapNames, { title: true });
  const next: ScreenplayDoc = {
    ...doc,
    ...(doc.notes ? { notes: swap(doc.notes) } : {}),
    spreads: doc.spreads.map((spread) => ({
      ...spread,
      text: swap(spread.text),
      illustration: swap(spread.illustration),
      ...(spread.layoutNote ? { layoutNote: swap(spread.layoutNote) } : {}),
      ...(spread.anchorNames ? { anchorNames: swapNames(spread.anchorNames) } : {}),
    })),
    // The front cover's title and subtitle are the book's own words, written through the store.
    ...(frontCover ? { frontCover } : {}),
    // The back cover's title is its blurb.
    ...(backCover ? { backCover } : {}),
  };
  if (JSON.stringify(next) === JSON.stringify(doc)) return project;
  return { ...project, screenplay: updateNodeContent(tree, tree.cursorId, next) };
}

function withDesignRenamed(project: Project, swap: (text: string) => string): Project {
  const design = project.design;
  if (!design) return project;
  let changed = false;
  const pages = Object.fromEntries(
    Object.entries(design.pages).map(([id, page]) => {
      const next = swapPageDesign(page, swap);
      if (next !== page) changed = true;
      return [id, next];
    }),
  );
  return changed ? { ...project, design: { ...design, pages } } : project;
}

function withAnchorsRenamed(anchors: Anchor[], from: string, to: string, swap: (text: string) => string): Anchor[] {
  const fromKey = normalizeAnchorName(from);
  const toKey = normalizeAnchorName(to);
  return anchors.map((anchor) => {
    const described = swapFields(anchor, ["description"], swap);
    const names = [anchor.name, ...(anchor.aliasNames ?? [])];
    if (anchor.type !== "character" || !names.some((name) => normalizeAnchorName(name) === fromKey)) return described;
    // The old name stays as an alias, so a fresh read of the story still finds this anchor.
    const aliasNames = [...new Set([...names, from])].filter((name) => {
      const key = normalizeAnchorName(name);
      return key !== toKey;
    });
    return { ...described, name: to, aliasNames };
  });
}

type WithReferences = { references?: ReferenceUse[] };

/** The references with a recorded signature moved from one text to another, or the same array when none was. */
function moveSignatures(references: ReferenceUse[] | undefined, moved: Map<string, { from: string; to: string }>): ReferenceUse[] | undefined {
  if (!references) return references;
  let changed = false;
  const next = references.map((reference) => {
    const move = moved.get(reference.anchorId);
    if (!move || reference.signature !== move.from) return reference;
    changed = true;
    return { ...reference, signature: move.to };
  });
  return changed ? next : references;
}

function moveTreeSignatures<T extends WithReferences>(
  tree: VersionTree<T> | undefined,
  moved: Map<string, { from: string; to: string }>,
): VersionTree<T> | undefined {
  if (!tree) return tree;
  let changed = false;
  const nodes = Object.fromEntries(
    Object.entries(tree.nodes).map(([id, node]) => {
      const references = moveSignatures(node.content.references, moved);
      if (references === node.content.references) return [id, node];
      changed = true;
      return [id, { ...node, content: { ...node.content, references } }];
    }),
  );
  return changed ? { ...tree, nodes } : tree;
}

/**
 * A page or a character image remembers the text of every description it was
 * drawn from, and is out of date when one changes. A rename changes descriptions
 * that said the old name, but not how anyone looks: what was current stays current.
 * Only records that matched the old text move; one that was already out of date stays so.
 */
function restampAnchorSignatures(before: Anchor[] | undefined, project: Project): Project {
  const after = project.anchors;
  if (!before || !after) return project;
  const moved = new Map<string, { from: string; to: string }>();
  for (const anchor of after) {
    const old = before.find((candidate) => candidate.id === anchor.id);
    if (!old) continue;
    const from = anchorSignature(old);
    const to = anchorSignature(anchor);
    if (from !== to) moved.set(anchor.id, { from, to });
  }
  if (moved.size === 0) return project;

  let illustrations = project.illustrations;
  if (illustrations) {
    let changed = false;
    const next = Object.fromEntries(
      Object.entries(illustrations).map(([id, tree]) => {
        const moved_ = moveTreeSignatures(tree, moved);
        if (moved_ !== tree) changed = true;
        return [id, moved_!];
      }),
    );
    if (changed) illustrations = next;
  }
  const anchors = after.map((anchor) => {
    const versions = moveTreeSignatures(anchor.versions, moved);
    return versions === anchor.versions ? anchor : { ...anchor, versions };
  });
  return { ...project, ...(illustrations ? { illustrations } : {}), anchors };
}

/**
 * Rename one cast member throughout the book. Refuses an empty name, one
 * someone else already has, and a name that is no change.
 */
export function renamePersonEverywhere(
  project: Project,
  memberId: string,
  rawTo: string,
): PersonRename | { refused: RenameRefusal } {
  const brief = briefOf(project.config);
  const member = (brief.cast ?? []).find((candidate) => candidate.id === memberId);
  if (!member) return { refused: "unknown" };
  const to = cleanName(rawTo);
  if (!to) return { refused: "empty" };
  const from = member.name.trim();
  if (to === from) return { refused: "same" };
  const key = foldName(to);
  if (key && (brief.cast ?? []).some((other) => other.id !== memberId && foldName(other.name) === key)) {
    return { refused: "taken" };
  }

  const swap = (text: string) => (from ? renameInText(text, from, to) : text);
  const isFrom = (name: string) => Boolean(from) && foldName(name) === foldName(from);
  const { storyText, ageRangeId, readingModeId, contentLocale } = project.config;
  const draftWasCurrent = Boolean(brief.generatedSignature) && !isDraftStale(brief, storyText, ageRangeId, readingModeId, contentLocale);
  const hadCurrentPortrait = portraitSubjects(project)
    .filter((candidate) => portraitStatus(project, candidate.id) === "current")
    .map((candidate) => candidate.id);
  const extractionWasCurrent = authoringOf(project).extraction?.storyHash === manuscriptHash(storyText);

  const cast: StoryCastMember[] = (brief.cast ?? []).map((candidate) => {
    const renamed = candidate.id === memberId ? { ...candidate, name: to } : candidate;
    return from ? swapFields(renamed, CAST_TEXT_FIELDS, swap) : renamed;
  });
  let storyBrief: StoryBrief = { ...(from ? swapBrief(brief, from, to, swap) : brief), cast };
  const nextStory = swap(storyText);
  if (draftWasCurrent) {
    storyBrief = {
      ...storyBrief,
      generatedSignature: storyBriefSignature(storyBrief, ageRangeId, readingModeId, brief.generatedForLocale ? contentLocale : undefined),
    };
  }

  let next: Project = {
    ...project,
    config: {
      ...project.config,
      storyText: nextStory,
      storyBrief,
      ...(from ? { artStyle: renameDerivedStyleNames(project.config.artStyle, from, to) ?? project.config.artStyle } : {}),
    },
    ...(project.analysis
      ? {
          analysis: {
            ...project.analysis,
            summary: swap(project.analysis.summary),
            // The cast and the page plan follow the new name, so the story that was read is the new one.
            ...(project.analysis.sourceStoryText !== undefined
              ? { sourceStoryText: swap(project.analysis.sourceStoryText) }
              : {}),
          },
        }
      : {}),
    ...(project.anchors && from ? { anchors: withAnchorsRenamed(project.anchors, from, to, swap) } : {}),
  };
  if (from) {
    next = withScreenplayRenamed(next, from, to, swap);
    next = withDesignRenamed(next, swap);
  }

  const state = authoringOf(next);
  const removed = (state.removedNames ?? []).filter((name) => foldName(name) !== key);
  next = withAuthoring(next, {
    // The old name is not someone new when a later read of the story meets it again.
    ...(from && foldName(from) !== key ? { removedNames: [...removed, from] } : { removedNames: removed }),
    ...(state.sameAge
      ? { sameAge: state.sameAge.map((group) => group.map((name) => (isFrom(name) ? to : name))) }
      : {}),
    ...(state.extraction
      ? {
          extraction: {
            ...state.extraction,
            ...(extractionWasCurrent ? { storyHash: manuscriptHash(nextStory) } : {}),
            names: state.extraction.names.map((name) => (isFrom(name) ? to : name)),
            unresolved: state.extraction.unresolved.filter((name) => !isFrom(name)),
          },
        }
      : {}),
  });

  // A new name does not change anyone's face: a portrait that was current stays current. The name itself
  // is no part of a portrait's inputs; this covers the words around it (a role or a note that said the name).
  for (const id of hadCurrentPortrait) {
    if (portraitStatus(next, id) === "current") continue;
    const tree = authoringOf(next).portraits?.[id];
    const person = briefOf(next.config).cast?.find((candidate) => candidate.id === id);
    if (!tree || !person) continue;
    const image = getCursor(tree).content;
    const now = portraitInputs(next, person);
    const inputs = { ...image.inputs, subjectSignature: now.subjectSignature, styleKey: now.styleKey, sourceKey: now.sourceKey };
    next = withAuthoring(next, {
      portraits: { ...authoringOf(next).portraits, [id]: updateNodeContent(tree, tree.cursorId, { ...image, inputs }) },
    });
  }

  // Nor does it change a page or a character image: they were drawn from descriptions that now say the new name.
  next = restampAnchorSignatures(project.anchors, next);

  const lines = coverLinesOf(project);
  return {
    project: next,
    from,
    to,
    storyMentions: countNameMentions(storyText, from),
    title: from && countNameMentions(project.title, from) > 0 ? swap(project.title) : null,
    subtitle: from && countNameMentions(lines.subtitle, from) > 0 ? swap(lines.subtitle) : null,
  };
}
