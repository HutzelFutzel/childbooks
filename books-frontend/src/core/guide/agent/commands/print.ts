/**
 * Skills for getting a finished book to print: say whether it is ready, and
 * open the order screen.
 *
 * Neither spends or changes anything. The check is the same preflight the book
 * pane runs continuously (`core/print/preflight.ts`); ordering only opens the
 * checkout, where the price and the buy button are, so nothing is ever bought
 * from a sentence.
 */
import { formatCapabilitiesForProject } from "../../../book";
import { unitIsDone } from "../../../book/pageCompletion";
import { pageNumberOf } from "../../../book/pageRefs";
import { illustrationUnits } from "../../../book/units";
import { interiorLeafPlan } from "../../../print/pagePlan";
import { preflightInterior, type PreflightCode, type PreflightIssue } from "../../../print/preflight";
import type { Project } from "../../../types";
import { getCursor } from "../../../versioning";
import type { CommandDef } from "../types";
import { beat } from "./shared";

/** A line across the fold can be deliberate; the other two print wrong, so they stop an order. */
const STOPS_ORDER: ReadonlySet<PreflightCode> = new Set(["text-outside-safe-area", "page-has-no-artwork"]);

/** The preflight's findings for this book, or none when it has no pages yet. */
export function printIssuesOf(project: Project): PreflightIssue[] {
  if (!project.screenplay || !project.design) return [];
  const units = illustrationUnits(project);
  return preflightInterior({
    plan: interiorLeafPlan(getCursor(project.screenplay).content),
    design: project.design,
    caps: formatCapabilitiesForProject(project),
    hasArtwork: (pageId) => {
      const unit = units.find((candidate) => candidate.id === pageId);
      return unit ? unitIsDone(project, unit) : false;
    },
    labelFor: (pageId) => {
      const n = pageNumberOf(project, pageId);
      return n === null ? "the cover" : `page ${n}`;
    },
  });
}

/** One issue in a parent's words. */
function sentenceFor(issue: PreflightIssue): string {
  const label = issue.pageLabel;
  switch (issue.code) {
    case "text-outside-safe-area":
      return `the words on ${label} are too close to the edge and could be cut off when printed`;
    case "text-crosses-gutter":
      return `the words on ${label} run across the fold in the middle`;
    case "page-has-no-artwork":
      return `${label} has no picture yet`;
  }
}

function listOf(issues: readonly PreflightIssue[]): string {
  const shown = issues.slice(0, 4).map(sentenceFor);
  const more = issues.length - shown.length;
  return `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

export const PRINT_COMMANDS: CommandDef[] = [
  {
    id: "checkPrint",
    area: "generation",
    suggest: false,
    summary:
      "Say whether the finished book is ready to print ('is my book ready?', 'check the book before I order'): pictures all drawn, words inside the printable area. Only looks; changes nothing and costs nothing.",
    args: [],
    examples: ["Is my book ready to print?", "Check the book before I order"],
    help: "Checks every page for what would print wrong: a page with no picture yet, or words too close to the edge or across the fold. It only looks; nothing changes.",
    requires: ["pagesStarted"],
    run: (project, _args, ctx) => {
      // What prints is the saved book: wait for the picture that is being drawn.
      if (ctx.drawingReason) return { kind: "invalid", reason: ctx.drawingReason, say: true };
      const units = illustrationUnits(project);
      const notDrawn = units.filter((unit) => !unitIsDone(project, unit)).length;
      const issues = printIssuesOf(project).filter((issue) => issue.code !== "page-has-no-artwork");
      const parts: string[] = [];
      if (notDrawn > 0) parts.push(`${notDrawn} ${notDrawn === 1 ? "page has" : "pages have"} no picture yet`);
      if (issues.length > 0) parts.push(listOf(issues));
      const text =
        parts.length === 0
          ? "Everything looks ready to print: every page has its picture and the words are inside the printable area."
          : `Not quite ready: ${parts.join("; ")}. Ask me to fix any of it, or say “order” when you are happy.`;
      return { kind: "noop", beat: beat("done", undefined, { text }) };
    },
  },
  {
    id: "orderBook",
    area: "generation",
    suggest: false,
    summary:
      "Open the order screen so the reader can print the book ('order the book', 'I want to print it'). Only opens it: the price and the buy button are on that screen, and nothing is bought from a sentence. Not available while a picture is being drawn, nor until every page has its picture and nothing would print wrong.",
    args: [],
    examples: ["Order the book", "I'd like to print it now"],
    help: "Opens the order screen once the book is ready to print. You see the price there and confirm yourself; nothing is bought from a message.",
    requires: ["pagesStarted"],
    run: (project, _args, ctx) => {
      // What prints is the saved book: wait for the picture that is being drawn.
      if (ctx.drawingReason) return { kind: "invalid", reason: ctx.drawingReason, say: true };
      const units = illustrationUnits(project);
      const notDrawn = units.filter((unit) => !unitIsDone(project, unit)).length;
      if (notDrawn > 0) {
        return {
          kind: "invalid",
          reason: `${notDrawn} ${notDrawn === 1 ? "page has" : "pages have"} no picture yet, so the book can't be ordered. Draw them first.`,
          say: true,
        };
      }
      const stops = printIssuesOf(project).filter((issue) => STOPS_ORDER.has(issue.code));
      if (stops.length > 0) {
        return {
          kind: "invalid",
          reason: `Before you order: ${listOf(stops)}. Ask me to fix it, or fix it in the page editor.`,
          say: true,
        };
      }
      return {
        kind: "effect",
        effect: { kind: "openOrder" },
        beat: beat("done", undefined, { text: "Opening the order screen. You see the price there and confirm yourself; nothing is bought yet." }),
      };
    },
  },
];
