/**
 * One page's words are kept in two places: `spread.text` in the page plan, and the story text box on
 * the page. They are two shapes of the same words (plain, and styled for print), and they must say the
 * same thing. This is the one place that makes sure they do.
 *
 * It runs on every write to the book (`projectsStore.mutateProject`), so it does not matter who wrote:
 * the words field, the page, the assistant, an undo or a redo, or a book that is merged from another
 * device. Whichever side changed is copied into the other:
 *
 *   - only the box changed: its words go to the plan (nothing is lost, plain text is the same words)
 *   - only the plan changed: the box gets the new words, and the words that stayed keep their style
 *   - both changed and they differ: the box wins, because it is what prints
 *
 * A page with no story box, or with two, has no second copy and is left alone. A write that changes
 * neither returns the same book, so it can never start a save of its own.
 */
import type { PageDesign } from "../design";
import type { Project, ScreenplayDoc, ScreenplaySpread } from "../types";
import { getCursor } from "../versioning";
import { withSpreads } from "./pageEdits";
import { cleanWords, spreadWithWords } from "./pagePlan";
import { canonWords, rewordParagraphs, wordsOfParagraphs } from "./pageWords";
import { storyBoxOf } from "./storyBox";

function docOf(project: Project | null | undefined): ScreenplayDoc | null {
  return project?.screenplay ? getCursor(project.screenplay).content : null;
}

/** The page's words as the book now reads them: the box when the page has one, else the plan. */
export function pageWordsOf(project: Project, pageId: string): string {
  const spread = docOf(project)?.spreads.find((candidate) => candidate.id === pageId);
  if (!spread) return "";
  const box = storyBoxOf(project.design?.pages[pageId]);
  return box !== "none" && box !== "several" ? wordsOfParagraphs(box.paragraphs) : spread.text;
}

/**
 * Make the plan and the story boxes agree, given the book as it was (null when there is no earlier
 * book to compare with: then the box wins wherever they differ).
 */
export function reconcilePageWords(before: Project | null, after: Project): Project {
  const doc = docOf(after);
  const design = after.design;
  if (!doc || !design) return after;
  const earlierDoc = docOf(before);
  const earlierDesign = before?.design;
  if (before && doc === earlierDoc && design === earlierDesign) return after;

  const earlier = new Map<string, ScreenplaySpread>((earlierDoc?.spreads ?? []).map((spread) => [spread.id, spread]));

  const planFixes = new Map<string, string>();
  const boxFixes = new Map<string, { boxId: string; paragraphs: ReturnType<typeof rewordParagraphs> }>();

  for (const spread of doc.spreads) {
    const page: PageDesign | undefined = design.pages[spread.id];
    const box = storyBoxOf(page);
    if (box === "none" || box === "several") continue;
    const was = earlier.get(spread.id);
    const wasPage = earlierDesign?.pages[spread.id];
    // Nothing about this page was written.
    if (before && was === spread && wasPage === page) continue;

    const inBox = wordsOfParagraphs(box.paragraphs);
    const inPlan = canonWords(spread.text);
    if (inBox === inPlan) continue;

    const wasBox = storyBoxOf(wasPage);
    const planChanged = !was || canonWords(was.text) !== inPlan;
    const boxChanged = wasBox === "none" || wasBox === "several" || wordsOfParagraphs(wasBox.paragraphs) !== inBox;

    if (boxChanged || !planChanged) {
      // The box is what prints: its words go to the plan.
      planFixes.set(spread.id, cleanWords(inBox));
    } else {
      boxFixes.set(spread.id, { boxId: box.id, paragraphs: rewordParagraphs(box.paragraphs, cleanWords(spread.text)) });
    }
  }
  if (planFixes.size === 0 && boxFixes.size === 0) return after;

  let next = after;
  if (planFixes.size > 0) {
    next = withSpreads(next, (spreads) =>
      spreads.map((spread) => {
        const text = planFixes.get(spread.id);
        return text === undefined ? spread : spreadWithWords(spread, text);
      }),
    );
  }
  if (boxFixes.size > 0 && next.design) {
    const pages = { ...next.design.pages };
    for (const [pageId, fix] of boxFixes) {
      const page = pages[pageId];
      if (!page) continue;
      pages[pageId] = {
        ...page,
        textBoxes: page.textBoxes.map((candidate) =>
          candidate.id === fix.boxId ? { ...candidate, paragraphs: fix.paragraphs } : candidate,
        ),
      };
    }
    next = { ...next, design: { ...next.design, pages } };
  }
  return next;
}

/** A book that was saved with the two copies apart, made whole once when it is opened. */
export function repairPageWords(project: Project): Project {
  return reconcilePageWords(null, project);
}
