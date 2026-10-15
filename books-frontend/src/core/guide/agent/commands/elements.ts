/**
 * Skills for what sits on a finished page besides the picture: a speech bubble
 * that says something, a small shape (a star, a heart), taking those away, and
 * the page's own words.
 *
 * Each is a pure change to `project.design`, free of Sparks, and one Undo takes
 * it back (the change log keeps the property-level diff). Nothing is taken on
 * trust: what a bubble says or a page now reads is the reader's own words
 * (the screen checks they are in the message), a color is a name or a hex code
 * the app knows, a place is one of nine named spots, and the page is the one
 * the reader named or has selected, never a guess.
 */
import { textFromParagraphs, wordParagraphs, type BookDesign, type PageDesign, type ShapeElement, type ShapeKind, type TextBox } from "../../../design";
import { bookProductForConfig } from "../../../book";
import { interiorUnitIds, pageNumberOf } from "../../../book/pageRefs";
import { illustrationUnits } from "../../../book/units";
import { applyBookTitle, applyCoverLine } from "../../../book/coverEdits";
import { coverLinesOf } from "../../../book/coverLines";
import { authoringOf, withAuthoring } from "../../projectState";
import { COVER_FRONT_ID, type Project } from "../../../types";
import { isBubble, newShapeId, shapeStyleDefaults } from "../../../../ui/design/shapes";
import { contrastInk, readableShapeInk, shapeTextDefaults } from "../../../../ui/design/shapeText";
import type { CommandArgs, CommandContext, CommandDef, CommandResult } from "../types";
import { arg, askFor, beat } from "./shared";
import { resolveTextColor } from "./design";

/** Most pages one sentence may decorate: a runaway list is not what anyone meant. */
const MAX_DECORATED_PAGES = 12;
/** Longest speech bubble and longest page text a chat message may write. */
const BUBBLE_MAX = 140;
const WORDS_MAX = 700;

/** The nine spots a reader can name, as the center of the element on the page. */
const SPOTS: Record<string, { x: number; y: number }> = {
  top: { x: 0.5, y: 0.17 },
  bottom: { x: 0.5, y: 0.83 },
  left: { x: 0.2, y: 0.5 },
  right: { x: 0.8, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  "top-left": { x: 0.2, y: 0.17 },
  "top-right": { x: 0.8, y: 0.17 },
  "bottom-left": { x: 0.2, y: 0.83 },
  "bottom-right": { x: 0.8, y: 0.83 },
};
const SPOT_NAMES = Object.keys(SPOTS);

const BUBBLE_KINDS: Record<string, ShapeKind> = {
  speech: "bubble-round",
  say: "bubble-round",
  thought: "bubble-thought",
  think: "bubble-thought",
  box: "bubble-rect",
};

const SHAPE_KINDS: Record<string, ShapeKind> = {
  star: "star",
  heart: "heart",
  circle: "circle",
  triangle: "triangle",
  diamond: "diamond",
  arrow: "arrow",
  square: "rect",
  rectangle: "rect",
  rounded: "rounded-rect",
};

/** Where a bubble's tail points, as a spot (page-box fractions) just outside the bubble. */
const TAILS: Record<string, { x: number; y: number }> = {
  down: { x: 0.3, y: 1.32 },
  up: { x: 0.4, y: -0.32 },
  left: { x: -0.3, y: 0.6 },
  right: { x: 1.3, y: 0.6 },
};

const SIZES = { small: 0.13, medium: 0.2, large: 0.3 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function topZ(page: PageDesign | undefined): number {
  let max = 0;
  for (const box of page?.textBoxes ?? []) max = Math.max(max, box.z);
  for (const shape of page?.shapes ?? []) max = Math.max(max, shape.z);
  for (const image of page?.images ?? []) max = Math.max(max, image.z);
  return max;
}

/** Width ÷ height of a page of this book, to draw a square as a square. */
function pageAspect(project: Project): number {
  const aspect = bookProductForConfig(project.config).aspect;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}

function rectAround(w: number, h: number, spot: { x: number; y: number }) {
  return { x: round4(clamp(spot.x - w / 2, 0, 1 - w)), y: round4(clamp(spot.y - h / 2, 0, 1 - h)), w: round4(w), h: round4(h) };
}

function spotOf(args: CommandArgs, fallback: string): { name: string; at: { x: number; y: number } } | null {
  const wanted = (arg(args, "position") || fallback).toLowerCase().replace(/\s+/g, "-");
  const name = SPOT_NAMES.includes(wanted) ? wanted : null;
  return name ? { name, at: SPOTS[name]! } : null;
}

/** The pages the reader named that are in the book (covers included), once each. */
function namedPages(project: Project, ctx: Pick<CommandContext, "pages">): string[] {
  const inBook = new Set(illustrationUnits(project).map((unit) => unit.id));
  return [...new Set(ctx.pages ?? [])].filter((id) => inBook.has(id));
}

const pageWord = (project: Project, id: string) => {
  const n = pageNumberOf(project, id);
  return n === null ? "the cover" : `page ${n}`;
};

const which = (what: string): CommandResult => ({
  kind: "invalid",
  reason: `Which page should I ${what}? Say something like “page 4”, or select the page in the book.`,
  say: true,
});

function withShapes(project: Project, pageId: string, change: (shapes: ShapeElement[]) => ShapeElement[]): Project {
  const design = project.design as BookDesign;
  const page = design.pages[pageId];
  const base: PageDesign = page ?? { textBoxes: [] };
  const shapes = change(base.shapes ?? []);
  const nextPage: PageDesign = { ...base, shapes };
  if (shapes.length === 0) delete nextPage.shapes;
  return { ...project, design: { ...design, pages: { ...design.pages, [pageId]: nextPage } } };
}

/** Does `chars` letters fit a w×h box (page fractions) at this size, with room for the padding? */
function fits(chars: number, w: number, h: number, size: number, aspect: number): boolean {
  const usable = 0.64;
  const perLine = Math.max(1, Math.floor((w * usable) / ((size * 0.52) / aspect)));
  const lines = Math.ceil(chars / perLine);
  return lines * size * 1.22 <= h * usable;
}

/** The size of the type and of the bubble: the largest type that reads well and still fits. */
function bubbleSizing(chars: number, aspect: number): { w: number; h: number; size: number } {
  const w = chars <= 18 ? 0.36 : chars <= 60 ? 0.5 : 0.64;
  for (const size of [0.042, 0.036, 0.03, 0.026]) {
    for (const h of [0.15, 0.2, 0.26, 0.32, 0.4]) {
      if (fits(chars, w, h, size, aspect)) return { w, h, size };
    }
  }
  return { w, h: 0.4, size: 0.024 };
}

/** The story text box of a page, when there is exactly one the reader could mean. */
function storyBoxOf(page: PageDesign | undefined): TextBox | "none" | "several" {
  const boxes = (page?.textBoxes ?? []).filter(
    (box) => !box.hidden && !box.locked && (box.role === "story-body" || (!box.role && Boolean(box.slotId))),
  );
  if (boxes.length === 0) return "none";
  return boxes.length > 1 ? "several" : boxes[0]!;
}

export const ELEMENT_COMMANDS: CommandDef[] = [
  {
    id: "addBubble",
    area: "design",
    aimsAtPages: true,
    suggest: [{ id: "addBubble", views: ["pages"], duringDrawing: true }],
    summary:
      "Add a speech bubble (or thought bubble) with words in it to one finished page ('put a speech bubble on page 4 saying Hello!'). 'says' is exactly what the bubble should say, in the reader's words; never write it for them. Placed at a named spot on the page, the top by default.",
    args: [
      { name: "says", kind: "text", required: true, hint: "exactly what the bubble says, as the reader wrote it" },
      {
        name: "bubble",
        kind: "choice",
        required: false,
        hint: "speech (the default), thought, or box (a square speech bubble)",
        options: ["speech", "thought", "box"],
      },
      {
        name: "position",
        kind: "choice",
        required: false,
        hint: "where on the page: top (default), bottom, left, right, center, top-left, top-right, bottom-left or bottom-right",
        options: SPOT_NAMES,
      },
    ],
    examples: ["Put a speech bubble on page 4 saying “Look at me!”", "Add a thought bubble top right on page 9: I wonder…"],
    help: "Adds a speech or thought bubble with your words to one page. Name the page (“page 4”) and, if you like, where it goes. Move or restyle it in the page editor, or take it back with Undo.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const says = arg(args, "says").replace(/\s+/g, " ").slice(0, BUBBLE_MAX);
      if (!says) return { kind: "ask", arg: "says", beat: beat("askText", undefined, { priority: "question" }), options: [] };
      const pages = namedPages(project, ctx);
      if (pages.length === 0) return which("put the bubble on");
      if (pages.length > 1) return { kind: "invalid", reason: "I add a bubble to one page at a time. Which page first?", say: true };
      const design = project.design;
      if (!design) return { kind: "invalid", reason: "The pages have no layout yet.", say: true };
      const spot = spotOf(args, "top");
      if (!spot) return { kind: "invalid", reason: `position must be one of ${SPOT_NAMES.join(", ")}` };
      const kind = BUBBLE_KINDS[arg(args, "bubble").toLowerCase()] ?? "bubble-round";
      const pageId = pages[0]!;
      const sizing = bubbleSizing(says.length, pageAspect(project));
      const style = shapeStyleDefaults(kind);
      const nearBottom = spot.at.y > 0.6;
      const text = shapeTextDefaults({ kind, fill: style.fill }, { fontFamily: design.defaultFontFamily, fontSizePct: sizing.size });
      const shape: ShapeElement = {
        id: newShapeId(),
        kind,
        rect: rectAround(sizing.w, sizing.h, spot.at),
        z: topZ(design.pages[pageId]) + 1,
        ...style,
        // The tail points at the middle of the page from wherever the bubble sits, toward who is likely speaking.
        tailX: spot.at.x < 0.35 ? 0.35 : spot.at.x > 0.65 ? 0.65 : 0.4,
        tailY: nearBottom ? -0.32 : 1.32,
        text: { ...text, fontSizePct: sizing.size, color: contrastInk(style.fill), paragraphs: wordParagraphs(says) },
        name: "Speech",
      };
      const out = withShapes(project, pageId, (shapes) => [...shapes, shape]);
      return {
        kind: "write",
        project: out,
        beat: beat("done", undefined, { receipt: `Added a bubble to ${pageWord(project, pageId)}: “${says.length > 40 ? `${says.slice(0, 39)}…` : says}”` }),
        view: "pages",
      };
    },
  },
  {
    id: "addShape",
    area: "design",
    aimsAtPages: true,
    suggest: false,
    summary:
      "Add a small decorative shape (star, heart, circle, triangle, diamond, arrow, square) to the finished pages they name ('add a yellow star to page 3'). Optional color, size and place. Not a speech bubble.",
    args: [
      {
        name: "shape",
        kind: "choice",
        required: true,
        hint: "star, heart, circle, triangle, diamond, arrow, square, rectangle or rounded",
        options: Object.keys(SHAPE_KINDS),
      },
      { name: "color", kind: "text", required: false, hint: "a color name like 'yellow' or a hex code, as the reader said it" },
      { name: "size", kind: "choice", required: false, hint: "small, medium (default) or large", options: Object.keys(SIZES) },
      {
        name: "position",
        kind: "choice",
        required: false,
        hint: "where on the page: top-right (default), top, bottom, left, right, center, top-left, bottom-left or bottom-right",
        options: SPOT_NAMES,
      },
    ],
    examples: ["Add a yellow star to page 3", "Put a big red heart in the bottom left of page 8"],
    help: "Adds a star, heart or other simple shape to the pages you name, in a color and place you choose. Undo takes it away.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const design = project.design;
      if (!design) return { kind: "invalid", reason: "The pages have no layout yet.", say: true };
      const kind = SHAPE_KINDS[arg(args, "shape").toLowerCase()];
      if (!kind || isBubble(kind)) return { kind: "invalid", reason: `shape must be one of ${Object.keys(SHAPE_KINDS).join(", ")}` };
      const pages = namedPages(project, ctx);
      if (pages.length === 0) return which("add the shape to");
      const pagesMax = ctx.limits?.extrasPages ?? MAX_DECORATED_PAGES;
      if (pages.length > pagesMax) {
        return { kind: "invalid", reason: `I can decorate up to ${pagesMax} pages at once. Name fewer pages.`, say: true };
      }
      const spot = spotOf(args, "top-right");
      if (!spot) return { kind: "invalid", reason: `position must be one of ${SPOT_NAMES.join(", ")}` };
      const colorText = arg(args, "color");
      const color = colorText ? resolveTextColor(colorText, ctx.palette) : null;
      if (colorText && !color) {
        return { kind: "invalid", reason: `I don't know the color “${colorText}”. Try a plain name like yellow or a hex code like #f4c430.`, say: true };
      }
      const sizeName = arg(args, "size").toLowerCase();
      const h = SIZES[(sizeName in SIZES ? sizeName : "medium") as keyof typeof SIZES];
      const aspect = pageAspect(project);
      const w = Math.min(0.6, h / aspect);
      const style = shapeStyleDefaults(kind);
      let out = project;
      for (const pageId of pages) {
        const shape: ShapeElement = {
          id: newShapeId(),
          kind,
          rect: rectAround(w, h, spot.at),
          z: topZ((out.design as BookDesign).pages[pageId]) + 1,
          ...style,
          ...(color ? { fill: color } : {}),
          name: arg(args, "shape") ? arg(args, "shape").toLowerCase() : "Shape",
        };
        out = withShapes(out, pageId, (shapes) => [...shapes, shape]);
      }
      const where = pages.length === 1 ? pageWord(project, pages[0]!) : `${pages.length} pages`;
      return {
        kind: "write",
        project: out,
        beat: beat("done", undefined, { receipt: `Added a ${colorText ? `${colorText.toLowerCase()} ` : ""}${arg(args, "shape").toLowerCase()} to ${where}` }),
        view: "pages",
      };
    },
  },
  {
    id: "editExtra",
    area: "design",
    aimsAtPages: true,
    suggest: false,
    summary:
      "Change a speech bubble or shape that is already on a finished page ('make the bubble on page 4 blue', 'make the star bigger', 'move the heart to the bottom left', 'change what the bubble says to …'). The page comes from the page they name or have selected; 'which' says what ('bubble', 'star', 'heart'…) when the page has more than one extra. Give only what changes. 'says' is the new words of a bubble, exactly as the reader wrote them.",
    args: [
      { name: "which", kind: "text", required: false, hint: "what is meant when the page has several extras: 'bubble', or a shape like 'star' or 'heart'; leave empty when there is only one" },
      { name: "color", kind: "text", required: false, hint: "the new color, a name like 'blue' or a hex code, as the reader said it" },
      { name: "says", kind: "text", required: false, hint: "the new words of a speech bubble, exactly as the reader wrote them" },
      { name: "size", kind: "choice", required: false, hint: "larger or smaller (one step), or small, medium or large", options: ["larger", "smaller", "small", "medium", "large"] },
      { name: "position", kind: "choice", required: false, hint: "move it to: top, bottom, left, right, center, top-left, top-right, bottom-left or bottom-right", options: SPOT_NAMES },
      { name: "tail", kind: "choice", required: false, hint: "which way a bubble's tail points: down, up, left or right", options: Object.keys(TAILS) },
    ],
    examples: ["Make the bubble on page 4 blue", "Make the star on page 3 bigger", "Move the heart on page 8 to the bottom left", "Change the bubble on page 2 to say Wow!"],
    help: "Changes a bubble or shape already on a page: its color, words, size, place, or where a bubble's tail points. Name the page, and the shape if there is more than one. Undo puts it back.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const design = project.design;
      if (!design) return { kind: "invalid", reason: "The pages have no layout yet.", say: true };
      const pages = namedPages(project, ctx);
      if (pages.length === 0) return which("change the extra on");
      if (pages.length > 1) return { kind: "invalid", reason: "I change one page's extras at a time. Which page first?", say: true };
      const pageId = pages[0]!;
      const label = pageWord(project, pageId);
      const colorText = arg(args, "color");
      const color = colorText ? resolveTextColor(colorText) : null;
      if (colorText && !color) {
        return { kind: "invalid", reason: `I don't know the color “${colorText}”. Try a plain name like blue or a hex code like #1d4ed8.`, say: true };
      }
      const says = arg(args, "says").replace(/\s+/g, " ").slice(0, BUBBLE_MAX);
      const size = arg(args, "size").toLowerCase();
      const spotName = arg(args, "position");
      const spot = spotName ? spotOf(args, "") : null;
      if (spotName && !spot) return { kind: "invalid", reason: `position must be one of ${SPOT_NAMES.join(", ")}` };
      const tailName = arg(args, "tail").toLowerCase();
      if (tailName && !(tailName in TAILS)) return { kind: "invalid", reason: `tail must be one of ${Object.keys(TAILS).join(", ")}` };
      if (!color && !says && !size && !spot && !tailName) return askFor("color", "askWhatChange");

      const wanted = arg(args, "which").toLowerCase();
      const onPage = (design.pages[pageId]?.shapes ?? []).filter((shape) => !shape.locked);
      const byKind = SHAPE_KINDS[wanted];
      const matching = onPage.filter((shape) =>
        !wanted ? true : /bubble|speech|thought|sprech|denk/.test(wanted) ? isBubble(shape.kind) : byKind ? shape.kind === byKind : true,
      );
      const capital = `${label[0]!.toUpperCase()}${label.slice(1)}`;
      if (matching.length === 0) {
        return { kind: "invalid", reason: onPage.length === 0 ? `${capital} has no bubbles or shapes to change.` : `${capital} has no ${wanted || "extra"} like that to change.`, say: true };
      }
      if (matching.length > 1) {
        return { kind: "invalid", reason: `${capital} has ${matching.length} of those. Say which one, like “the star” or “the bubble”.`, say: true };
      }
      const target = matching[0]!;
      if ((says || tailName) && !isBubble(target.kind)) {
        return { kind: "invalid", reason: "Only a speech bubble has words and a tail.", say: true };
      }
      let next: ShapeElement = { ...target };
      if (color) {
        next.fill = color;
        if (next.text) next.text = { ...next.text, color: readableShapeInk(color, typeof next.text.color === "string" ? next.text.color : undefined) };
      }
      if (says) {
        const base = next.text ?? shapeTextDefaults({ kind: next.kind, fill: next.fill }, { fontFamily: design.defaultFontFamily, fontSizePct: 0.036 });
        const sizing = bubbleSizing(says.length, pageAspect(project));
        next = {
          ...next,
          text: { ...base, paragraphs: wordParagraphs(says), fontSizePct: Math.min(base.fontSizePct, sizing.size) },
        };
        if (next.rect.h < sizing.h * 0.9 || next.rect.w < sizing.w * 0.9) {
          const cx = next.rect.x + next.rect.w / 2;
          const cy = next.rect.y + next.rect.h / 2;
          next.rect = rectAround(Math.max(next.rect.w, sizing.w), Math.max(next.rect.h, sizing.h), { x: cx, y: cy });
        }
      }
      if (size) {
        const factor = size === "larger" ? 1.25 : size === "smaller" ? 0.8 : null;
        const h = factor ? clamp(next.rect.h * factor, 0.06, 0.8) : SIZES[size as keyof typeof SIZES] ?? next.rect.h;
        const grown = h / next.rect.h;
        const w = clamp(next.rect.w * grown, 0.06, 0.9);
        next.rect = rectAround(w, h, { x: next.rect.x + next.rect.w / 2, y: next.rect.y + next.rect.h / 2 });
      }
      if (spot) next.rect = rectAround(next.rect.w, next.rect.h, spot.at);
      if (tailName) next = { ...next, tailX: TAILS[tailName]!.x, tailY: TAILS[tailName]!.y };
      if (JSON.stringify(next) === JSON.stringify(target)) return { kind: "noop", beat: beat("alreadyThat") };
      const out = withShapes(project, pageId, (shapes) => shapes.map((shape) => (shape.id === target.id ? next : shape)));
      const what = [color && "color", says && "words", size && "size", spot && "place", tailName && "tail"].filter(Boolean).join(", ");
      return {
        kind: "write",
        project: out,
        beat: beat("done", undefined, { receipt: `Changed the ${isBubble(target.kind) ? "bubble" : target.kind} on ${label}: ${what}` }),
        view: "pages",
      };
    },
  },
  {
    id: "removeDecorations",
    area: "design",
    aimsAtPages: true,
    suggest: false,
    summary:
      "Take the speech bubbles and/or decorative shapes off the pages they name ('remove the bubble on page 4', 'take the stars off page 2'). Only on pages they name or have selected; never the whole book, and never the picture or the story text.",
    args: [
      {
        name: "what",
        kind: "choice",
        required: false,
        hint: "bubbles, shapes or all (the default): which of the extras to take off",
        options: ["bubbles", "shapes", "all"],
      },
    ],
    examples: ["Remove the speech bubble on page 4", "Take the shapes off page 2"],
    help: "Removes the speech bubbles and shapes from the pages you name. The picture and the story text stay. Undo puts them back.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const design = project.design;
      if (!design) return { kind: "invalid", reason: "The pages have no layout yet.", say: true };
      const pages = namedPages(project, ctx);
      if (pages.length === 0) return which("clear");
      const clearMax = ctx.limits?.extrasPages ?? MAX_DECORATED_PAGES;
      if (pages.length > clearMax) {
        return { kind: "invalid", reason: `I can clear up to ${clearMax} pages at once. Name fewer pages.`, say: true };
      }
      const what = arg(args, "what").toLowerCase();
      const drops = (shape: ShapeElement) => (what === "bubbles" ? isBubble(shape.kind) : what === "shapes" ? !isBubble(shape.kind) : true);
      let out = project;
      let removed = 0;
      for (const pageId of pages) {
        const shapes = design.pages[pageId]?.shapes ?? [];
        const gone = shapes.filter((shape) => !shape.locked && drops(shape));
        if (gone.length === 0) continue;
        removed += gone.length;
        const ids = new Set(gone.map((shape) => shape.id));
        out = withShapes(out, pageId, (list) => list.filter((shape) => !ids.has(shape.id)));
      }
      if (removed === 0) {
        const label = what === "bubbles" ? "speech bubbles" : what === "shapes" ? "shapes" : "bubbles or shapes";
        return {
          kind: "invalid",
          reason: pages.length === 1 ? `There are no ${label} on ${pageWord(project, pages[0]!)} to take off.` : `There are no ${label} on those pages to take off.`,
          say: true,
        };
      }
      return {
        kind: "write",
        project: out,
        beat: beat("done", undefined, { receipt: `Removed ${removed} ${removed === 1 ? "extra" : "extras"} from ${pages.length === 1 ? pageWord(project, pages[0]!) : `${pages.length} pages`}` }),
        view: "pages",
      };
    },
  },
  {
    id: "editCoverWords",
    area: "design",
    suggest: false,
    // The words live in the title, the cover spec and the cover's text box: Undo puts the whole cover back together.
    structural: true,
    summary:
      "Change the title, subtitle or author printed on the front cover of a finished book ('change the title to …', 'remove the subtitle', 'the author is …'). 'words' is exactly the new text in the reader's own words; never write it for them. If the words are painted into the cover picture, the cover is redrawn with the new words.",
    args: [
      { name: "part", kind: "choice", required: true, hint: "title, subtitle or author", options: ["title", "subtitle", "author"] },
      { name: "words", kind: "text", required: false, hint: "the new text, exactly as the reader wrote it; leave empty only when they want a subtitle or author removed" },
      { name: "remove", kind: "choice", required: false, hint: "yes only when they want the subtitle or author taken off the cover", options: ["yes"] },
    ],
    examples: ["Change the title to Moonlight Adventures", "Remove the subtitle", "Put Grandma Lou as the author"],
    help: "Changes the title, subtitle or author on the front cover of a finished book. If those words are painted into the cover picture, the cover is redrawn with the new ones (you see the price first unless it's small). Undo restores the old words.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args) => {
      const part = arg(args, "part").toLowerCase();
      if (part !== "title" && part !== "subtitle" && part !== "author") {
        return { kind: "invalid", reason: "part must be title, subtitle or author" };
      }
      const clear = arg(args, "remove").toLowerCase() === "yes";
      const words = arg(args, "words").replace(/^["'“„«]+|["'”“»]+$/g, "").replace(/\s+/g, " ").trim().slice(0, part === "subtitle" ? 160 : 120);
      if (part === "title" && !words) return { kind: "ask", arg: "words", beat: beat("askText", undefined, { priority: "question" }), options: [] };
      if (part !== "title" && !words && !clear) return { kind: "ask", arg: "words", beat: beat("askText", undefined, { priority: "question" }), options: [] };
      const next = clear && part !== "title" ? "" : words;
      const lines = coverLinesOf(project);
      if (lines[part] === next) return { kind: "noop", beat: beat("alreadyThat") };
      const box = project.design?.pages[COVER_FRONT_ID]?.textBoxes.find((candidate) => candidate.role === `book-${part}`);
      let out = part === "title" ? applyBookTitle(project, next) : applyCoverLine(project, part, next);
      if (part === "title") out = withAuthoring(out, { cover: { ...authoringOf(out).cover, titleEdited: true } });
      const painted = box?.hidden === true;
      const missing = !box && next !== "";
      const note = painted
        ? " The old words are painted into the cover picture, so it keeps them until you redraw the cover."
        : missing
          ? " That line isn't on the cover layout yet, so add it in the page editor to see it."
          : "";
      const done = next === "" ? `Removed the ${part} from the cover` : `Cover ${part}: ${next}`;
      if (painted && project.illustrations?.[COVER_FRONT_ID]) {
        // The old words are in the picture: the cover is redrawn with the new ones, through the same
        // price check as any picture change, and the old cover stays in its history.
        const instruction =
          next === ""
            ? `Take the ${part} off the cover. Keep the picture and every other word exactly as they are.`
            : `The ${part} on the cover must now read exactly "${next}". Keep the picture and every other word exactly as they are.`;
        return {
          kind: "write",
          project: out,
          beat: beat("redrawReady", undefined, { receipt: done }),
          then: { kind: "redrawPage", unitIds: [COVER_FRONT_ID], instruction },
          view: "pages",
        };
      }
      return {
        kind: "write",
        project: out,
        beat: beat("done", undefined, { receipt: done, ...(note ? { text: `${done}.${note}` } : {}) }),
        view: "pages",
      };
    },
  },
  {
    id: "editPageWords",
    area: "design",
    aimsAtPages: true,
    suggest: false,
    summary:
      "Change the printed words on ONE finished page ('change the text on page 4 to …', 'on page 7 change dog to cat'). 'words' is exactly the new wording in the reader's own words; never write or improve it for them. With 'from', only that word or phrase is replaced and 'words' is its replacement. Changes this page's printed words only: the story in the Story tab and the picture stay as they are.",
    args: [
      { name: "words", kind: "text", required: true, hint: "the new words, exactly as the reader wrote them" },
      { name: "from", kind: "text", required: false, hint: "only when they replace one word or phrase: the words on the page to replace; leave empty to replace all the page's words" },
    ],
    examples: ["Change the text on page 4 to “Aren ran home as fast as she could.”", "On page 7 change dog to cat"],
    help: "Changes the printed words on one page. Name the page. The Story tab keeps its own wording and the picture isn't redrawn, so the words and the picture can drift apart; Undo takes it back.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const words = arg(args, "words").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, WORDS_MAX);
      if (!words) return { kind: "ask", arg: "words", beat: beat("askText", undefined, { priority: "question" }), options: [] };
      const design = project.design;
      if (!design) return { kind: "invalid", reason: "The pages have no layout yet.", say: true };
      const pages = namedPages(project, ctx).filter((id) => interiorUnitIds(project).includes(id));
      if (pages.length === 0) return which("change the words on");
      if (pages.length > 1) return { kind: "invalid", reason: "I change the words of one page at a time. Which page first?", say: true };
      const pageId = pages[0]!;
      const page = design.pages[pageId];
      const box = storyBoxOf(page);
      const label = pageWord(project, pageId);
      if (box === "none") return { kind: "invalid", reason: `${label[0]!.toUpperCase()}${label.slice(1)} has no words to change.`, say: true };
      if (box === "several") return { kind: "invalid", reason: `${label[0]!.toUpperCase()}${label.slice(1)} has more than one text box. Edit it in the page editor.`, say: true };
      const current = textFromParagraphs(box.paragraphs);
      const from = arg(args, "from");
      let next = words;
      if (from) {
        const at = current.toLowerCase().indexOf(from.toLowerCase());
        if (at < 0) return { kind: "invalid", reason: `I can't find “${from}” on ${label}.`, say: true };
        next = `${current.slice(0, at)}${words}${current.slice(at + from.length)}`.slice(0, WORDS_MAX);
      }
      if (next.trim() === current.trim()) return { kind: "noop", beat: beat("alreadyThat") };
      const pages2: Record<string, PageDesign> = {
        ...design.pages,
        [pageId]: {
          ...page!,
          textBoxes: page!.textBoxes.map((candidate) => (candidate.id === box.id ? { ...candidate, paragraphs: wordParagraphs(next) } : candidate)),
        },
      };
      return {
        kind: "write",
        project: { ...project, design: { ...design, pages: pages2 } },
        beat: beat("done", undefined, { receipt: `Changed the words on ${label}` }),
        view: "pages",
      };
    },
  },
];
