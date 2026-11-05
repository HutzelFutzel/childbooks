/**
 * Skills for the page list of a finished book: show a page, add one, take one
 * away, copy one, move one, and say what was changed lately.
 *
 * Each page edit is a pure change to the screenplay and the design, free of
 * Sparks, and one Undo takes it back whole (the change log keeps a snapshot of
 * the pages, `structural`). Pages are named the way the book on the left names
 * them: "page 4" is the fourth inside page, and the app reads the number from
 * the reader's words (`core/book/pageRefs.ts`), never the interpreter.
 */
import { interiorUnitIds, pageNumberOf } from "../../../book/pageRefs";
import {
  derivedSpreadId,
  duplicateSpreadProject,
  insertSpreadProject,
  withSpreads,
} from "../../../book/pageEdits";
import {
  cleanScene,
  hasEarlierPicture,
  hasNoPicture,
  insertPage,
  removePage,
  restorePage,
  setPageHasPicture,
  spreadOf,
} from "../../../book/pagePlan";
import { styleRequestIn } from "../../../book/styleRequest";
import { illustrationUnits } from "../../../book/units";
import { ensureStoryBoxFor } from "../../../book/storyBoxEnsurer";
import type { Project } from "../../../types";
import type { CommandContext, CommandDef, Impact } from "../types";
import { arg, askFor, beat } from "./shared";

/** Longest wording a page added from the chat may carry. */
const PAGE_WORDS_MAX = 700;

/** The raw page list, placeholders included: what a derived page id has to be unique against. */
function docIdsOf(project: Project): string[] {
  const ids: string[] = [];
  withSpreads(project, (spreads) => {
    for (const spread of spreads) ids.push(spread.id);
    return spreads;
  });
  return ids;
}

/** The one page the reader means, or the sentence that says why there is none. */
function onePage(project: Project, ctx: Pick<CommandContext, "pages">, what: string): { id: string } | { reason: string } {
  const named = (ctx.pages ?? []).filter((id) => interiorUnitIds(project).includes(id));
  if (named.length === 0) {
    return { reason: `Which page should I ${what}? Say something like “page 4”, or select the page in the book.` };
  }
  if (named.length > 1) return { reason: `I ${what} one page at a time. Which one first?` };
  return { id: named[0]! };
}

/** Where a page sits in the raw `spreads` list, which also holds placeholders. */
function docIndexOf(project: Project, id: string): number {
  let index = -1;
  withSpreads(project, (spreads) => {
    index = spreads.findIndex((spread) => spread.id === id);
    return spreads;
  });
  return index;
}

const pageWord = (project: Project, id: string) => {
  const n = pageNumberOf(project, id);
  return n === null ? "the page" : `page ${n}`;
};

function removeImpact(project: Project, ctx: CommandContext): Impact {
  const picked = onePage(project, ctx, "remove");
  if ("reason" in picked) return { level: "none", effects: [] };
  const spread = illustrationUnits(project).find((unit) => unit.id === picked.id);
  return {
    // The page is kept, with its picture, and can be put back: it is not lost.
    level: "reversible",
    effects: [
      {
        kind: "removesPage",
        page: pageNumberOf(project, picked.id) ?? 0,
        hasPicture: Boolean(project.illustrations?.[picked.id]),
        hasWords: Boolean(spread?.text?.trim()),
      },
    ],
  };
}

export const PAGE_COMMANDS: CommandDef[] = [
  {
    id: "goToPage",
    area: "pages",
    aimsAtPages: true,
    suggest: false,
    summary:
      "Show a page of the finished book on the right ('show me page 12', 'go to the last page', 'show the back cover'). Changes nothing.",
    args: [],
    examples: ["Show me page 12", "Go to the last page", "Show the back cover"],
    help: "Shows the page or cover you name on the right. Nothing changes.",
    requires: ["pagesStarted"],
    run: (project, _args, ctx) => {
      const id = (ctx.pages ?? [])[0];
      if (!id || !illustrationUnits(project).some((unit) => unit.id === id)) {
        return { kind: "invalid", reason: "Which page? Say something like “page 4” or “the back cover”.", say: true };
      }
      return { kind: "effect", effect: { kind: "goToPage", unitId: id }, beat: beat("done", undefined, { priority: "result" }) };
    },
  },
  {
    id: "addPage",
    area: "pages",
    aimsAtPages: true,
    suggest: [{ id: "addPage", views: ["pages"], duringDrawing: true }],
    structural: true,
    summary:
      "Add a page to the finished book: at the end, at the start, or before or after the page they name. With 'scene' (what happens on it, in the reader's words) it is a picture page and is drawn right away, the reader sees the price first; with only 'words' it is a page of text; 'type' blank leaves it empty on purpose. Never invent the scene or the words: with neither and no 'type', the app asks.",
    args: [
      {
        name: "where",
        kind: "choice",
        required: false,
        hint: "end (the default), start, before or after: before and after need the page they name",
        options: ["end", "start", "before", "after"],
      },
      { name: "scene", kind: "text", required: false, hint: "what happens on the new page, in the reader's words, when they say it" },
      { name: "words", kind: "text", required: false, hint: "the exact words the new page should print, only when the reader wrote them" },
      {
        name: "type",
        kind: "choice",
        required: false,
        hint: "blank only when they ask for an empty or blank page; leave empty otherwise",
        options: ["picture", "text", "blank"],
      },
    ],
    examples: [
      "Add a page after page 5 where Arthur finds a lantern in the cave",
      "Add a page at the end that says “The end.”",
      "Add a blank page after page 5",
    ],
    help: "Adds a page: at the end, at the start, or next to a page you name. Tell me what happens on it and I'll draw it in the book's look; or give it words, or leave it blank. You see the price before anything is drawn. Undo removes it.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const where = arg(args, "where").toLowerCase() || "end";
      const interior = interiorUnitIds(project);
      let at = docIndexOf(project, interior[interior.length - 1] ?? "") + 1;
      let phrase = "at the end";
      if (where === "start") {
        at = Math.max(0, docIndexOf(project, interior[0] ?? ""));
        phrase = "at the start";
      } else if (where === "before" || where === "after") {
        const picked = onePage(project, ctx, "add next to");
        if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
        const index = docIndexOf(project, picked.id);
        at = where === "before" ? index : index + 1;
        phrase = `${where} ${pageWord(project, picked.id)}`;
      } else if (at <= 0) {
        at = docIndexOf(project, interior[0] ?? "");
      }
      const index = Math.max(0, at);
      const type = arg(args, "type").toLowerCase();
      const asked = styleRequestIn(arg(args, "scene"));
      const scene = cleanScene(arg(args, "scene"));
      const words = arg(args, "words").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, PAGE_WORDS_MAX);
      // The same book and the same words make the same page, so what is planned is what is written.
      const id = derivedSpreadId([...docIdsOf(project), index, scene, words, type]);

      if (type === "blank") {
        const blank = insertSpreadProject(project, index, { blankCanvas: true, id });
        return {
          kind: "write",
          project: blank.project,
          beat: beat("done", undefined, { receipt: `Added a blank page ${phrase}` }),
          view: "pages",
        };
      }

      // Nothing said about the page: ask, rather than leave an empty page the reader has to find.
      // A request that was only about the look is answered first: the page is the same look as the book.
      if (!scene && !words) return askFor("scene", asked.phrases.length > 0 ? "styleIsBookWide" : "askNewPageScene");

      if (type === "text" || !scene) {
        const textPage = ensureStoryBoxFor(insertPage(project, index, { words, picture: false, id }).project, id);
        return {
          kind: "write",
          project: textPage,
          beat: beat("done", undefined, { receipt: `Added a page of words ${phrase}` }),
          view: "pages",
        };
      }

      const added = insertPage(project, index, { scene, ...(words ? { words } : {}), id });
      const withBox = words ? ensureStoryBoxFor(added.project, id) : added.project;
      return {
        kind: "write",
        project: withBox,
        beat: beat(asked.phrases.length > 0 ? "styleKeptForBook" : "redrawReady", undefined, {
          receipt: `Added a page ${phrase}`,
        }),
        // Describing a page is asking for it: the reader sees the price on the card before anything is drawn.
        then: { kind: "redrawPage", unitIds: [id], instruction: "", mode: "new" },
        view: "pages",
      };
    },
  },
  {
    id: "setPagePicture",
    area: "pages",
    aimsAtPages: true,
    suggest: false,
    structural: true,
    summary:
      "Take the picture off ONE finished page so it shows only its words or stays blank ('page 6 doesn't need a picture', 'no picture on this page'), or put the picture back ('add the picture back on page 6'). Nothing is deleted: putting it back is free and brings back the last picture. To draw a different picture on that page, use editPicture instead.",
    args: [
      {
        name: "picture",
        kind: "choice",
        required: true,
        hint: "off to take the picture off, on to put the last one back",
        options: ["on", "off"],
      },
    ],
    examples: ["Page 6 doesn't need a picture", "Put the picture back on page 6"],
    help: "Takes the picture off a page, or puts the last one back. The picture is kept, so nothing is lost and Undo brings it back too.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const picked = onePage(project, ctx, "change");
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const on = arg(args, "picture").toLowerCase() === "on";
      const label = pageWord(project, picked.id);
      const spread = spreadOf(project, picked.id);
      if (!spread) return { kind: "invalid", reason: "That page isn't in the book any more.", say: true };
      if (on && !hasNoPicture(spread)) return { kind: "noop", beat: beat("alreadyThat") };
      if (!on && hasNoPicture(spread)) return { kind: "noop", beat: beat("alreadyThat") };
      const next = setPageHasPicture(project, picked.id, on);
      // Back on with nothing to show again is a page that needs describing: say so rather than leave it empty.
      if (on && !hasEarlierPicture(project, picked.id)) {
        return {
          kind: "write",
          project: next,
          beat: beat("askNewPageScene", undefined, { priority: "question", receipt: `Added a picture to ${label}` }),
          view: "pages",
        };
      }
      return {
        kind: "write",
        project: next,
        beat: beat("done", undefined, { receipt: on ? `Put the picture back on ${label}` : `Took the picture off ${label}` }),
        view: "pages",
      };
    },
  },
  {
    id: "removePage",
    area: "pages",
    aimsAtPages: true,
    suggest: false,
    structural: true,
    summary:
      "Take one page out of the finished book, with its picture and words. Only the page they name or have selected; never guess it. The page is kept, so it can be put back.",
    args: [],
    examples: ["Remove page 7", "Delete the last page", "Take out page 3"],
    help: "Takes a page out of the book with its picture and words. The page is kept: say \"put it back\", use Undo, or choose it under Recently removed to bring it back in the same place.",
    requires: ["pagesStarted"],
    undoable: true,
    impact: (project, _args, ctx) => removeImpact(project, ctx),
    run: (project, _args, ctx) => {
      const picked = onePage(project, ctx, "remove");
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      if (interiorUnitIds(project).length <= 1) {
        return { kind: "invalid", reason: "A book needs at least one page, so I can't remove the last one.", say: true };
      }
      const label = pageWord(project, picked.id);
      return {
        kind: "write",
        project: removePage(project, picked.id),
        beat: beat("done", undefined, { receipt: `Removed ${label}. Say "put it back" to restore it.` }),
        view: "pages",
      };
    },
  },
  {
    id: "restorePage",
    area: "pages",
    suggest: false,
    structural: true,
    summary:
      "Put back the page that was removed most recently, with its picture and words, in the place it was ('put it back', 'bring back the page I deleted', 'undo removing that page'). Only pages removed through the app; the last ten are kept.",
    args: [],
    examples: ["Put that page back", "Bring back the page I just deleted"],
    help: "Brings back the page you removed most recently, with its picture, where it was. The last ten removed pages are kept, and you can also pick one under Recently removed beside the pages.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project) => {
      const out = restorePage(project);
      if (!out.id) {
        return { kind: "invalid", reason: "There is no removed page to put back.", say: true };
      }
      return {
        kind: "write",
        project: out.project,
        beat: beat("done", undefined, { receipt: `Put ${pageWord(out.project, out.id)} back` }),
        view: "pages",
      };
    },
  },
  {
    id: "duplicatePage",
    area: "pages",
    aimsAtPages: true,
    suggest: false,
    structural: true,
    summary: "Copy a page of the finished book, with its picture settings and design, right after it.",
    args: [],
    examples: ["Duplicate page 4", "Copy this page"],
    help: "Copies a page right after itself, with its words and design. Undo removes the copy.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, _args, ctx) => {
      const picked = onePage(project, ctx, "copy");
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const label = pageWord(project, picked.id);
      return {
        kind: "write",
        project: duplicateSpreadProject(project, picked.id).project,
        beat: beat("done", undefined, { receipt: `Copied ${label}` }),
        view: "pages",
      };
    },
  },
  {
    id: "movePage",
    area: "pages",
    aimsAtPages: true,
    suggest: false,
    structural: true,
    summary:
      "Move one page of the finished book to another place: 'to' is the page number it should become, or 'first' or 'last'. Only the page they name or have selected.",
    args: [{ name: "to", kind: "text", required: true, hint: "the new page number, or first, or last" }],
    examples: ["Move page 5 to the end", "Make page 3 the first page", "Move page 8 to page 2"],
    help: "Moves a page to a new place in the book: a number, the start or the end. Undo puts it back.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const picked = onePage(project, ctx, "move");
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const interior = interiorUnitIds(project);
      const wanted = arg(args, "to").toLowerCase();
      const target = /^(first|start|beginning|erste|erster|erstes)/.test(wanted)
        ? 1
        : /^(last|end|final|letzte|letzter|letztes|ende)/.test(wanted)
          ? interior.length
          : Number.parseInt(wanted.replace(/\D+/g, ""), 10);
      if (!Number.isInteger(target) || target < 1 || target > interior.length) {
        return {
          kind: "invalid",
          reason: `The book has ${interior.length} pages, so I can't put a page at “${arg(args, "to") || "?"}”.`,
          say: true,
        };
      }
      const from = interior.indexOf(picked.id) + 1;
      const label = pageWord(project, picked.id);
      if (from === target) return { kind: "noop", beat: beat("alreadyThat") };
      // Reinsert next to the page that now sits at the target spot, in the raw list (which also holds placeholders).
      const rest = interior.filter((id) => id !== picked.id);
      const anchor = target > rest.length ? null : rest[target - 1]!;
      const moved = withSpreads(project, (spreads) => {
        const page = spreads.find((spread) => spread.id === picked.id);
        if (!page) return spreads;
        const others = spreads.filter((spread) => spread.id !== picked.id);
        const at = anchor === null ? others.reduce((last, spread, index) => (rest.includes(spread.id) ? index : last), -1) + 1 : others.findIndex((spread) => spread.id === anchor);
        const next = [...others];
        next.splice(at < 0 ? next.length : at, 0, page);
        return next;
      });
      return {
        kind: "write",
        project: moved,
        beat: beat("done", undefined, { receipt: `Moved ${label} to page ${target}` }),
        view: "pages",
      };
    },
  },
  {
    id: "listChanges",
    area: "conversation",
    suggest: false,
    summary: "Say what was changed lately, newest first ('what did you change?', 'what have I changed so far?'). Changes nothing.",
    args: [],
    examples: ["What did you change?", "What have I changed so far?"],
    help: "Lists the latest changes made to the pages, newest first. You can undo any of them.",
    requires: [],
    run: () => ({ kind: "effect", effect: { kind: "listChanges" } }),
  },
];
