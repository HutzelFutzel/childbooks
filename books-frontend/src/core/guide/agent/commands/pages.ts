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
  duplicateSpreadProject,
  insertSpreadProject,
  removeSpreadProject,
  withSpreads,
} from "../../../book/pageEdits";
import { illustrationUnits } from "../../../book/units";
import type { Project } from "../../../types";
import type { CommandContext, CommandDef, Impact } from "../types";
import { arg, beat } from "./shared";

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
    level: "destructive",
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
      "Add a blank page to the finished book: at the end, at the start, or before or after the page they name. The new page has no picture and no words yet; they can ask for either after.",
    args: [
      {
        name: "where",
        kind: "choice",
        required: false,
        hint: "end (the default), start, before or after: before and after need the page they name",
        options: ["end", "start", "before", "after"],
      },
    ],
    examples: ["Add a page at the end", "Add a blank page after page 5", "Put a new page before page 2"],
    help: "Adds a blank page: at the end, at the start, or next to a page you name. It has no picture yet. Undo removes it.",
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
      const out = insertSpreadProject(project, Math.max(0, at), { blankCanvas: true });
      return {
        kind: "write",
        project: out.project,
        beat: beat("done", undefined, { receipt: `Added a blank page ${phrase}` }),
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
    alwaysConfirm: true,
    summary:
      "Take one page out of the finished book, with its picture and words. Only the page they name or have selected; never guess it.",
    args: [],
    examples: ["Remove page 7", "Delete the last page", "Take out page 3"],
    help: "Takes a page out of the book with its picture and words. You always see which page first, and Undo brings it back.",
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
        project: removeSpreadProject(project, picked.id),
        beat: beat("done", undefined, { receipt: `Removed ${label}` }),
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
