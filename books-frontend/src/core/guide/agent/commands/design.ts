/**
 * Skills for the finished pages: how the printed words look and where they sit.
 *
 * Everything here is a pure change to `project.design`, free of Sparks, and one
 * Undo takes it back (the turn keeps the earlier version of just the pages it
 * touched). They work on the book's reading text by default, and the whole book
 * at once unless the reader says "this page": type that changes from page to
 * page is a book that looks unfinished. A value is never taken on trust: a size
 * is a step with a floor and a ceiling, a color is a name or a hex code the app
 * knows, a font is one the book's language offers.
 */
import {
  sharedTextStyleOf,
  withSharedTextStyle,
  type BookDesign,
  type HAlign,
  type PageDesign,
  type SharedTextStyle,
  type SharedTextStyleKey,
  type TextBox,
} from "../../../design";
import { COVER_BACK_ID, COVER_FRONT_ID, type Anchor, type Project } from "../../../types";
import { resolveOption } from "../resolve";
import type { Beat, CommandArgs, CommandContext, CommandDef, CommandEffect } from "../types";
import { arg, askFor, beat } from "./shared";
import { illustrationUnits } from "../../../book/units";
import { pageNumberOf } from "../../../book/pageRefs";
import { anchorByName, anchorsNamedIn, castOnPage, withPageCast } from "../../../book/pageCast";
import { asksForNewPicture } from "../../redrawMode";

/** How a page is called to a reader: its printed number, or the cover. */
function pageWord(project: Project, unitId: string): string {
  if (unitId === COVER_FRONT_ID) return "Front cover";
  if (unitId === COVER_BACK_ID) return "Back cover";
  const n = pageNumberOf(project, unitId);
  return n === null ? "This page" : `Page ${n}`;
}

/** Most pictures one sentence may change at once: the price is shown before it starts, but a runaway list should not. */
const MAX_PICTURE_BATCH = 8;
/** Most out-of-date pictures one "update them" may redraw; more is the Draw the book button. */
const MAX_REFRESH_BATCH = 24;

/** What a reader can name, and the box role that carries it. */
const PARTS = {
  story: "story-body",
  title: "book-title",
  subtitle: "book-subtitle",
  author: "book-author",
} as const;
type Part = keyof typeof PARTS;

const PART_NAMES: Record<Part, string> = {
  story: "Story text",
  title: "Title",
  subtitle: "Subtitle",
  author: "Author",
};

const PART_OPTIONS = Object.keys(PARTS);

/** One tap of "larger" is about one point on a book page. */
const SIZE_STEP = 1.12;
/** Fractions of the page height: below this nothing prints legibly, above it nothing fits. */
const SIZE_MIN = 0.02;
const SIZE_MAX = 0.12;
/** How far "move it up" goes, as a fraction of the page. */
const NUDGE = 0.04;

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function partOf(args: CommandArgs): Part | null {
  const wanted = arg(args, "part").toLowerCase() || "story";
  return (PART_OPTIONS as string[]).includes(wanted) ? (wanted as Part) : null;
}

/** "This page" only when the reader said so; otherwise the whole book, so the type stays consistent. */
function scopeOf(args: CommandArgs): "page" | "book" {
  return arg(args, "scope").toLowerCase() === "page" ? "page" : "book";
}

const partArg = {
  name: "part",
  kind: "choice",
  required: false,
  hint: "story (the reading text, the default), title, subtitle or author on the cover",
  options: PART_OPTIONS,
} as const;

const scopeArg = {
  name: "scope",
  kind: "choice",
  required: false,
  hint: "'page' only when they say this page or this spread; otherwise leave empty for the whole book",
  options: ["page", "book"],
} as const;

interface Found {
  pageId: string;
  boxes: TextBox[];
}

/** The text boxes a request means, or the reason there are none. */
function boxesFor(
  project: Project,
  part: Part,
  scope: "page" | "book",
  ctx: Pick<CommandContext, "pages">,
): { found: Found[] } | { reason: string } {
  const design = project.design;
  if (!design) return { reason: "The pages have no layout yet." };
  const role = PARTS[part];
  const onCover = part !== "story";
  const ids = onCover
    ? [COVER_FRONT_ID, COVER_BACK_ID]
    : scope === "page" && ctx.pages?.length
      ? [...ctx.pages]
      : Object.keys(design.pages);
  const found: Found[] = [];
  let painted = 0;
  for (const pageId of ids) {
    const page = design.pages[pageId];
    if (!page) continue;
    const matching = page.textBoxes.filter((box) =>
      // A box carries a role when the app seeded it; an older book's story text only carries its layout slot.
      part === "story" ? box.role === role || (!box.role && Boolean(box.slotId)) : box.role === role,
    );
    painted += matching.filter((box) => box.hidden).length;
    const boxes = matching.filter((box) => !box.hidden && !box.locked);
    if (boxes.length > 0) found.push({ pageId, boxes });
  }
  if (found.length > 0) return { found };
  if (onCover && painted > 0) {
    return {
      reason: `The ${PART_NAMES[part].toLowerCase()} is painted into the cover picture, so changing it means redrawing the cover.`,
    };
  }
  return {
    reason:
      onCover || scope === "book"
        ? `There is no ${PART_NAMES[part].toLowerCase()} on the pages to change.`
        : `There is no ${PART_NAMES[part].toLowerCase()} on this page to change.`,
  };
}

/** Rewrite the found boxes, and keep the book-wide style in step when the whole book changed. */
function withBoxes(
  project: Project,
  part: Part,
  scope: "page" | "book",
  found: readonly Found[],
  change: (box: TextBox) => TextBox,
  shared?: (style: SharedTextStyle) => SharedTextStyle,
): Project {
  const design = project.design as BookDesign;
  const pages: Record<string, PageDesign> = { ...design.pages };
  for (const { pageId, boxes } of found) {
    const ids = new Set(boxes.map((box) => box.id));
    const page = pages[pageId]!;
    pages[pageId] = { ...page, textBoxes: page.textBoxes.map((box) => (ids.has(box.id) ? change(box) : box)) };
  }
  let sharedTextStyles = design.sharedTextStyles;
  if (scope === "book" && shared) {
    const key: SharedTextStyleKey = PARTS[part];
    const first = found[0]?.boxes[0];
    const base = design.sharedTextStyles?.[key] ?? (first ? sharedTextStyleOf(first) : undefined);
    if (base) sharedTextStyles = { ...design.sharedTextStyles, [key]: shared(base) };
  }
  return { ...project, design: { ...design, pages, ...(sharedTextStyles ? { sharedTextStyles } : {}) } };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function doneBeat(part: Part, what: string): Beat {
  return beat("done", undefined, { receipt: `${PART_NAMES[part]}: ${what}` });
}

/** Color names a reader says, in the chat languages, to the colors printed. */
const COLORS: Record<string, string> = {
  black: "#111111", schwarz: "#111111",
  white: "#ffffff", weiss: "#ffffff", "weiß": "#ffffff",
  gray: "#4b5563", grau: "#4b5563",
  "dark gray": "#374151", dunkelgrau: "#374151",
  "light gray": "#9ca3af", hellgrau: "#9ca3af",
  red: "#c0392b", rot: "#c0392b",
  orange: "#e67e22",
  yellow: "#f1c40f", gelb: "#f1c40f",
  green: "#2e7d32", gruen: "#2e7d32", "grün": "#2e7d32",
  blue: "#1d4ed8", blau: "#1d4ed8",
  "dark blue": "#1e3a8a", navy: "#1e3a8a", dunkelblau: "#1e3a8a",
  "light blue": "#60a5fa", hellblau: "#60a5fa",
  purple: "#7e22ce", violet: "#7e22ce", lila: "#7e22ce",
  pink: "#db2777", rosa: "#db2777",
  brown: "#6b4423", braun: "#6b4423",
  cream: "#fff7e6", creme: "#fff7e6",
  gold: "#b8860b",
};

/** A name from the table or a hex code, as a six-digit hex; null when it is neither. */
export function resolveTextColor(raw: string, palette?: CommandContext["palette"]): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  const hex = text.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex && (text.startsWith("#") || hex[1]!.length === 6)) {
    const digits = hex[1]!.length === 3 ? hex[1]!.split("").map((c) => c + c).join("") : hex[1]!;
    return `#${digits}`;
  }
  const own = palette?.colors.find((color) => color.name === text);
  if (own) return own.hex;
  if (palette?.hidden.includes(text)) return null;
  return COLORS[text] ?? null;
}

const ALIGNS: Record<string, HAlign> = {
  left: "left", links: "left",
  center: "center", centre: "center", centered: "center", mitte: "center", zentriert: "center",
  right: "right", rechts: "right",
  justify: "justify", justified: "justify", blocksatz: "justify",
};

/** Words for a kind of font, in the chat languages, to the font library's categories. */
const FONT_KINDS: Record<string, string> = {
  serif: "serif", "mit serifen": "serif", klassisch: "serif", classic: "serif",
  sans: "sans", "sans serif": "sans", "sans-serif": "sans", modern: "sans", clean: "sans", serifenlos: "sans",
  handwritten: "hand", handwriting: "hand", playful: "hand", handschrift: "hand", handgeschrieben: "hand",
  rounded: "rounded", round: "rounded", friendly: "rounded", rund: "rounded", abgerundet: "rounded",
  display: "display", fancy: "display", bold: "display",
};

/** Colors for paper: a plain name is a soft tint (the text must stay readable on it); "dark" names and hex codes are exact. */
const PAPER_COLORS: Record<string, string> = {
  white: "#ffffff", weiss: "#ffffff", "weiß": "#ffffff",
  cream: "#fff7e6", creme: "#fff7e6", beige: "#f5ecd7", ivory: "#fffff0", elfenbein: "#fffff0",
  yellow: "#fef9c3", gelb: "#fef9c3",
  orange: "#ffedd5", peach: "#ffe8d6", pfirsich: "#ffe8d6",
  red: "#fee2e2", rot: "#fee2e2",
  pink: "#fce7f3", rosa: "#fce7f3",
  purple: "#ede9fe", lavender: "#ede9fe", lavendel: "#ede9fe", violet: "#ede9fe", lila: "#ede9fe",
  blue: "#dbeafe", blau: "#dbeafe", "light blue": "#e0f2fe", hellblau: "#e0f2fe", "sky blue": "#e0f2fe",
  green: "#dcfce7", gruen: "#dcfce7", "grün": "#dcfce7", mint: "#d1fae5",
  brown: "#efe3d3", braun: "#efe3d3",
  gray: "#f3f4f6", grau: "#f3f4f6",
  black: "#111111", schwarz: "#111111",
  "dark blue": "#1e3a8a", navy: "#1e3a8a", dunkelblau: "#1e3a8a",
  "dark green": "#14532d", dunkelgruen: "#14532d", "dunkelgrün": "#14532d",
  "dark gray": "#374151", dunkelgrau: "#374151",
  night: "#0f172a", nacht: "#0f172a",
};

/** A paper color from a name or a hex code, as six-digit hex; null when it is neither. */
export function resolvePaperColor(raw: string, palette?: CommandContext["palette"]): string | null {
  // Readers write the British spelling too; the source stays American English.
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ").replaceAll("gr" + "ey", "gray");
  if (!text) return null;
  const own = palette?.colors.find((color) => color.name === text);
  if (own) return own.hex;
  if (palette?.hidden.includes(text)) return null;
  return PAPER_COLORS[text] ?? resolveTextColor(text, palette);
}

/** WCAG relative luminance of "#rrggbb"; null for anything else (a gradient, an rgba value). */
function luminance(color: unknown): number | null {
  if (typeof color !== "string") return null;
  const m = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const channel = (i: number) => {
    const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Below this the words are hard to read (WCAG large text). */
const MIN_CONTRAST = 3;

const LINE_STEP = 0.1;
const LINE_MIN = 1.0;
const LINE_MAX = 2.2;

export const DESIGN_COMMANDS: CommandDef[] = [
  {
    id: "setTextSize",
    area: "design",
    suggest: [
      { id: "largerText", views: ["pages"], instant: true, duringDrawing: true },
      { id: "smallerText", views: ["pages"], instant: true, duringDrawing: true },
    ],
    summary:
      "Make the printed words on the finished pages larger or smaller (the story text by default; the title, subtitle or author on the cover when named). One step at a time. The whole book unless they say this page. Changes the pages' text only; nothing is redrawn.",
    args: [
      { name: "size", kind: "choice", required: true, hint: "larger or smaller", options: ["larger", "smaller"] },
      partArg,
      scopeArg,
    ],
    examples: ["Make the text bigger", "The words are too small", "Make the title smaller", "A bit larger on this page"],
    help: "Makes the printed words larger or smaller, one step at a time. It changes the whole book unless you say this page. Nothing is redrawn and it costs nothing.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const size = arg(args, "size").toLowerCase();
      if (size !== "larger" && size !== "smaller") return { kind: "invalid", reason: "size must be larger or smaller" };
      const part = partOf(args);
      if (!part) return { kind: "invalid", reason: `part must be one of ${PART_OPTIONS.join(", ")}` };
      const scope = scopeOf(args);
      const picked = boxesFor(project, part, scope, ctx);
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const factor = size === "larger" ? SIZE_STEP : 1 / SIZE_STEP;
      const next = (value: number) => round4(clamp(value * factor, SIZE_MIN, SIZE_MAX));
      const out = withBoxes(
        project,
        part,
        scope,
        picked.found,
        (box) => withSharedTextStyle(box, { ...sharedTextStyleOf(box), fontSizePct: next(box.fontSizePct) }),
        (style) => ({ ...style, fontSizePct: next(style.fontSizePct) }),
      );
      if (same(out.design, project.design)) {
        return { kind: "noop", beat: beat("alreadyThat") };
      }
      return { kind: "write", project: out, beat: doneBeat(part, size), view: "pages" };
    },
  },
  {
    id: "setTextColor",
    area: "design",
    suggest: [{ id: "textColor", views: ["pages"], duringDrawing: true }],
    summary:
      "Change the color of the printed words on the finished pages: a color name or a hex code. The story text by default; the title, subtitle or author on the cover when named. The whole book unless they say this page.",
    args: [
      { name: "color", kind: "text", required: true, hint: "a color name like 'dark blue' or a hex code, as the reader said it" },
      partArg,
      scopeArg,
    ],
    examples: ["Make the text dark blue", "White text on this page", "Change the title color to #aa3300"],
    help: "Changes the color of the printed words. Name a color or give a hex code. It changes the whole book unless you say this page.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const wanted = arg(args, "color");
      const color = resolveTextColor(wanted, ctx.palette);
      if (!color) {
        return {
          kind: "invalid",
          reason: wanted
            ? `I don't know the color "${wanted}". Try a name like dark blue, or a hex code.`
            : "Which color should the text be?",
          say: true,
        };
      }
      const part = partOf(args);
      if (!part) return { kind: "invalid", reason: `part must be one of ${PART_OPTIONS.join(", ")}` };
      const scope = scopeOf(args);
      const picked = boxesFor(project, part, scope, ctx);
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const out = withBoxes(
        project,
        part,
        scope,
        picked.found,
        (box) => withSharedTextStyle(box, { ...sharedTextStyleOf(box), color }),
        (style) => ({ ...style, color }),
      );
      if (same(out.design, project.design)) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "write", project: out, beat: doneBeat(part, wanted || color), view: "pages" };
    },
  },
  {
    id: "setTextAlign",
    area: "design",
    suggest: [{ id: "centerText", views: ["pages"], instant: true, duringDrawing: true }],
    summary:
      "Align the printed words on the finished pages: left, center, right or justify. The story text by default. The whole book unless they say this page.",
    args: [
      { name: "align", kind: "choice", required: true, hint: "left, center, right or justify", options: ["left", "center", "right", "justify"] },
      partArg,
      scopeArg,
    ],
    examples: ["Center the text", "Align the words to the left", "Justify the story text"],
    help: "Aligns the printed words left, centered, right or justified. It changes the whole book unless you say this page.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const align = ALIGNS[arg(args, "align").toLowerCase()];
      if (!align) return { kind: "invalid", reason: "align must be left, center, right or justify" };
      const part = partOf(args);
      if (!part) return { kind: "invalid", reason: `part must be one of ${PART_OPTIONS.join(", ")}` };
      const scope = scopeOf(args);
      const picked = boxesFor(project, part, scope, ctx);
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const out = withBoxes(project, part, scope, picked.found, (box) => ({
        ...box,
        align,
        // A paragraph that carried its own alignment follows the box.
        paragraphs: box.paragraphs.map(({ align: _own, ...paragraph }) => {
          void _own;
          return paragraph;
        }),
      }));
      if (same(out.design, project.design)) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "write", project: out, beat: doneBeat(part, align), view: "pages" };
    },
  },
  {
    id: "setTextFont",
    area: "design",
    suggest: [{ id: "changeFont", views: ["pages"], duringDrawing: true }],
    summary:
      "Change the font of the printed words on the finished pages, by the font's name or a word like 'serif' or 'handwritten'. The story text by default. The whole book unless they say this page.",
    args: [
      { name: "font", kind: "text", required: true, hint: "the font's name, as the reader said it" },
      partArg,
      scopeArg,
    ],
    examples: ["Use a serif font", "Change the font to Lora", "Make the title handwritten"],
    help: "Changes the font of the printed words to one of the book's fonts. It changes the whole book unless you say this page.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const wanted = arg(args, "font");
      const fonts = ctx.fonts ?? [];
      // "A serif font" names a kind, not a font: offer a few of that kind to pick from.
      const kind =
        FONT_KINDS[
          wanted
            .toLowerCase()
            .replace(/^(a|an|the|eine?n?|die|der|das)\s+/, "")
            .replace(/\s*(font|schrift|schriftart)\s*$/, "")
            .trim()
        ];
      const ofKind = kind ? fonts.filter((font) => font.category === kind) : [];
      if (ofKind.length > 0) {
        return askFor(
          "font",
          "askWhich",
          ofKind.slice(0, 6).map((font) => ({ id: font.label, label: font.label })),
        );
      }
      const match = wanted ? resolveOption(wanted, fonts) : ({ kind: "none" } as const);
      if (match.kind === "none") {
        return {
          kind: "invalid",
          reason: wanted
            ? `I don't have a font called "${wanted}" for this book.`
            : "Which font should the text use?",
          say: true,
        };
      }
      if (match.kind === "many") {
        return askFor(
          "font",
          "askWhich",
          match.values.slice(0, 6).map((font) => ({ id: font.label, label: font.label })),
        );
      }
      const family = match.value.id;
      const part = partOf(args);
      if (!part) return { kind: "invalid", reason: `part must be one of ${PART_OPTIONS.join(", ")}` };
      const scope = scopeOf(args);
      const picked = boxesFor(project, part, scope, ctx);
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const out = withBoxes(
        project,
        part,
        scope,
        picked.found,
        (box) => withSharedTextStyle(box, { ...sharedTextStyleOf(box), fontFamily: family }),
        (style) => ({ ...style, fontFamily: family }),
      );
      if (same(out.design, project.design)) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "write", project: out, beat: doneBeat(part, match.value.label), view: "pages" };
    },
  },
  {
    id: "moveText",
    area: "design",
    suggest: [{ id: "moveText", views: ["pages"], instant: true, duringDrawing: true }],
    summary:
      "Move the story text on the finished pages up, down, left or right by a small step. Only the pages they mean: the one in view, or every page when they say all of them. The text stays on the page; if it ends up too close to the edge for printing, the print check says so.",
    args: [
      { name: "direction", kind: "choice", required: true, hint: "up, down, left or right", options: ["up", "down", "left", "right"] },
      scopeArg,
    ],
    examples: ["Move the text up a little", "Put the words lower on this page", "Shift the text to the right"],
    help: "Moves the story text a small step up, down, left or right. It moves the page in view unless you say all of them.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const direction = arg(args, "direction").toLowerCase();
      if (!["up", "down", "left", "right"].includes(direction)) {
        return { kind: "invalid", reason: "direction must be up, down, left or right" };
      }
      // Position is a per-page matter: the page in view unless the reader said "all".
      const scope = arg(args, "scope").toLowerCase() === "book" ? "book" : "page";
      const picked = boxesFor(project, "story", scope, ctx);
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const dx = direction === "left" ? -NUDGE : direction === "right" ? NUDGE : 0;
      const dy = direction === "up" ? -NUDGE : direction === "down" ? NUDGE : 0;
      const out = withBoxes(project, "story", scope, picked.found, (box) => ({
        ...box,
        rect: {
          ...box.rect,
          x: round4(clamp(box.rect.x + dx, 0, Math.max(0, 1 - box.rect.w))),
          y: round4(clamp(box.rect.y + dy, 0, Math.max(0, 1 - box.rect.h))),
        },
        // Moved on purpose: the app leaves it where it is put.
        placedByReader: true,
      }));
      if (same(out.design, project.design)) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "write", project: out, beat: doneBeat("story", `moved ${direction}`), view: "pages" };
    },
  },
  {
    id: "refreshPictures",
    area: "pictures",
    suggest: false,
    summary:
      "Redraw the pictures that no longer match the people or places in them, after a character or place was changed ('update the pictures that are out of date', 'refresh the pages'). Only pages the app has marked out of date; the reader does not name them. Keeps the old pictures in their history.",
    args: [],
    examples: ["Update the pictures that are out of date", "Refresh the pages that don't match any more"],
    help: "Redraws only the pictures that no longer match a changed character or place, and keeps the old pictures in their history. You see the price before anything is drawn unless it's small.",
    requires: ["pagesStarted"],
    paid: true,
    run: (project, _args, ctx) => {
      const inBook = new Set(illustrationUnits(project).map((unit) => unit.id));
      const stale = (ctx.stalePages ?? []).filter((id) => inBook.has(id) && Boolean(project.illustrations?.[id]));
      if (stale.length === 0) {
        return { kind: "invalid", reason: "Every picture still matches the book, so there is nothing to update.", say: true };
      }
      const refreshMax = ctx.limits?.refreshBatch ?? MAX_REFRESH_BATCH;
      if (stale.length > refreshMax) {
        return {
          kind: "invalid",
          reason: `${stale.length} pictures are out of date. I update up to ${refreshMax} at a time; use “Draw the book” to update them all together.`,
          say: true,
        };
      }
      return {
        kind: "effect",
        effect: { kind: "redrawPage", unitIds: stale, instruction: "Update to match the book", mode: "new" },
        beat: beat("redrawReady", undefined, { priority: "result" }),
      };
    },
  },
  {
    id: "setPageColor",
    area: "design",
    suggest: [{ id: "pageColor", views: ["pages"], duringDrawing: true }],
    summary:
      "Change the paper color of finished pages, the page background behind the picture and text ('make the background of this page pale yellow', 'make the pages cream'): a color name or a hex code. A plain name like 'blue' is a soft tint; 'dark blue' or a hex code is exact. Only the pages they name or the one in view; the whole book when they say all of them. The covers keep their own color unless named. The pictures are not redrawn.",
    args: [
      { name: "color", kind: "text", required: true, hint: "a color name like 'cream' or 'dark blue', or a hex code, as the reader said it" },
      scopeArg,
    ],
    examples: ["Make the page background cream", "Pale yellow paper on every page", "Page 4 should have a dark blue background"],
    help: "Changes the paper color behind the pictures and words. Name a color or give a hex code. It changes the page in view, the pages you name, or the whole book when you say all of them. Nothing is redrawn.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const wanted = arg(args, "color");
      const color = resolvePaperColor(wanted, ctx.palette);
      if (!color) {
        return {
          kind: "invalid",
          reason: wanted
            ? `I don't know the color "${wanted}". Try a name like cream or dark blue, or a hex code.`
            : "Which color should the paper be?",
          say: true,
        };
      }
      const design = project.design;
      if (!design) return { kind: "invalid", reason: "The pages have no layout yet.", say: true };
      const wholeBook = scopeOf(args) === "book";
      const ids = wholeBook
        ? Object.keys(design.pages).filter((id) => id !== COVER_FRONT_ID && id !== COVER_BACK_ID)
        : [...(ctx.pages ?? [])].filter((id) => Boolean(design.pages[id]));
      if (ids.length === 0) {
        return {
          kind: "invalid",
          reason: wholeBook ? "There are no pages to change yet." : "Tell me which page, like “page 4”, or say all of them.",
          say: true,
        };
      }
      const pages: Record<string, PageDesign> = { ...design.pages };
      for (const id of ids) {
        const page = pages[id]!;
        if ((page.background?.color ?? "#ffffff").toString().toLowerCase() === color) continue;
        pages[id] = { ...page, background: { ...page.background, color } };
      }
      const next: BookDesign = {
        ...design,
        pages,
        // New pages follow a book-wide color, as the editor's "apply to all" does.
        ...(wholeBook ? { defaultPageBackground: { ...design.defaultPageBackground, color } } : {}),
      };
      if (same(next, design)) return { kind: "noop", beat: beat("alreadyThat") };
      const paper = luminance(color);
      const worst = Math.min(
        ...ids.flatMap((id) =>
          pages[id]!.textBoxes
            .filter((box) => !box.hidden && !box.fill && box.paragraphs.length > 0)
            .map((box) => {
              const ink = luminance(box.color);
              return paper === null || ink === null ? Infinity : contrastRatio(paper, ink);
            }),
        ),
        Infinity,
      );
      const receipt = `Page color: ${wanted || color}`;
      return {
        kind: "write",
        project: { ...project, design: next },
        beat:
          worst < MIN_CONTRAST
            ? beat("pageColorContrast", undefined, { receipt })
            : beat("done", undefined, { receipt }),
        view: "pages",
      };
    },
  },
  {
    id: "setTextEmphasis",
    area: "design",
    suggest: false,
    summary:
      "Make the printed words bold, italic or underlined on the finished pages, or take that off again (the story text by default; the title, subtitle or author when named). The whole book unless they say this page.",
    args: [
      { name: "emphasis", kind: "choice", required: true, hint: "bold, italic, underline, or plain to remove all three", options: ["bold", "italic", "underline", "plain"] },
      { name: "state", kind: "choice", required: false, hint: "'off' to remove it; leave empty to turn it on", options: ["on", "off"] },
      partArg,
      scopeArg,
    ],
    examples: ["Make the text bold", "Italic words on this page", "Take the underline off", "Make the title bold"],
    help: "Makes the printed words bold, italic or underlined, or plain again. It changes the whole book unless you say this page.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const emphasis = arg(args, "emphasis").toLowerCase();
      if (!["bold", "italic", "underline", "plain"].includes(emphasis)) {
        return { kind: "invalid", reason: "emphasis must be bold, italic, underline or plain" };
      }
      const part = partOf(args);
      if (!part) return { kind: "invalid", reason: `part must be one of ${PART_OPTIONS.join(", ")}` };
      const scope = scopeOf(args);
      const picked = boxesFor(project, part, scope, ctx);
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const on = arg(args, "state").toLowerCase() !== "off";
      const patch: Partial<SharedTextStyle> =
        emphasis === "plain"
          ? { bold: false, italic: false, underline: false }
          : { [emphasis]: on };
      const out = withBoxes(
        project,
        part,
        scope,
        picked.found,
        (box) => withSharedTextStyle(box, { ...sharedTextStyleOf(box), ...patch }),
        (style) => ({ ...style, ...patch }),
      );
      if (same(out.design, project.design)) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "write", project: out, beat: doneBeat(part, emphasis === "plain" ? "plain" : `${emphasis} ${on ? "on" : "off"}`), view: "pages" };
    },
  },
  {
    id: "setLineSpacing",
    area: "design",
    suggest: false,
    summary:
      "Make the lines of the printed words closer together or farther apart on the finished pages, one step at a time (the story text by default). The whole book unless they say this page.",
    args: [
      { name: "spacing", kind: "choice", required: true, hint: "tighter or looser", options: ["tighter", "looser"] },
      partArg,
      scopeArg,
    ],
    examples: ["More space between the lines", "Tighten the line spacing", "The lines are too close together"],
    help: "Moves the lines of text closer together or farther apart, one step at a time. It changes the whole book unless you say this page.",
    requires: ["pagesStarted"],
    undoable: true,
    run: (project, args, ctx) => {
      const spacing = arg(args, "spacing").toLowerCase();
      if (spacing !== "tighter" && spacing !== "looser") return { kind: "invalid", reason: "spacing must be tighter or looser" };
      const part = partOf(args);
      if (!part) return { kind: "invalid", reason: `part must be one of ${PART_OPTIONS.join(", ")}` };
      const scope = scopeOf(args);
      const picked = boxesFor(project, part, scope, ctx);
      if ("reason" in picked) return { kind: "invalid", reason: picked.reason, say: true };
      const step = spacing === "looser" ? LINE_STEP : -LINE_STEP;
      const next = (value: number) => round4(clamp(value + step, LINE_MIN, LINE_MAX));
      const out = withBoxes(
        project,
        part,
        scope,
        picked.found,
        (box) => withSharedTextStyle(box, { ...sharedTextStyleOf(box), lineHeight: next(box.lineHeight) }),
        (style) => ({ ...style, lineHeight: next(style.lineHeight) }),
      );
      if (same(out.design, project.design)) return { kind: "noop", beat: beat("alreadyThat") };
      return { kind: "write", project: out, beat: doneBeat(part, `lines ${spacing}`), view: "pages" };
    },
  },
  {
    id: "editPicture",
    area: "pictures",
    aimsAtPages: true,
    suggest: [{ id: "changePicture", views: ["pages"], duringDrawing: true }],
    summary:
      "Change something inside the drawn picture of one finished page or cover ('give her an umbrella in her left hand on page 18', 'make the sky pink on the cover', 'remove the boy from this picture', 'take the dog out of page 5'). Not for the color of the page itself: 'the background of the page' means the paper color, unless they speak of something drawn in the scene. Changes only what they ask for and keeps the old picture in the history. 'change' holds only what should look different, in the reader's words. The page comes from the page they name or have selected; never guess it. Set mode 'new' only when they want a completely different picture. Several pages at once (\'the sky pink on pages 3 to 5\') get the same change; at most 8.",
    args: [
      { name: "change", kind: "text", required: true, hint: "what should look different in the picture, in the reader's words" },
      {
        name: "mode",
        kind: "choice",
        required: false,
        hint: "'new' when they want the page drawn again from scratch, or ask to redraw or retry with no other change; otherwise leave empty so the picture there is changed",
        options: ["edit", "new"],
      },
      {
        name: "people",
        kind: "text",
        required: false,
        hint: "first names of people the reader asks to add or show, as written, comma separated ('Amanda' for 'add Amanda to page 3'); empty when the change names nobody, and never for 'a dog' or 'a girl'",
      },
      { name: "pages", kind: "text", required: false, hint: "never set this: the app fills it in when it asks which page" },
    ],
    examples: ["Give her an umbrella in her left hand on page 18", "Make the sky pink on page 3", "Add a small dog on the cover", "Redraw page 7"],
    help: "Changes something in the picture of a page or the cover. Name the page (\"page 18\") or select it in the book. I change the picture that is there and keep the old one in its history. You see the price before anything is drawn unless it's small.",
    requires: ["pagesStarted"],
    paid: true,
    run: (project, args, ctx) => {
      const change = arg(args, "change").slice(0, 400);
      if (!change) return askFor("change", "askWhatChange");
      let named = [...new Set(ctx.pages ?? [])];
      if (named.length === 0) {
        return { kind: "invalid", reason: "Which page is that? Say something like “page 4”, or select the page in the book.", say: true };
      }
      // Pages read off the screen (a spread in view) are not a choice the reader made: ask, never redraw both.
      const only = arg(args, "pages");
      if (only && only !== "both" && named.includes(only)) named = [only];
      else if (!only && !ctx.pagesNamed && named.length > 1) {
        return askFor("pages", "askWhichPage", [
          ...named.map((id) => ({ id, label: pageWord(project, id) })),
          { id: "both", label: "Both" },
        ]);
      }
      const inBook = new Set(illustrationUnits(project).map((unit) => unit.id));
      const present = named.filter((id) => inBook.has(id));
      if (present.length === 0) return { kind: "invalid", reason: "That page isn't in the book any more.", say: true };
      const drawn = present.filter((id) => Boolean(project.illustrations?.[id]));
      if (drawn.length === 0) {
        const page = pageNumberOf(project, present[0]!);
        return {
          kind: "invalid",
          reason: present.length > 1 ? "None of those pages has a picture yet, so there's nothing to change." : `${page === null ? "That picture" : `Page ${page}`} has no picture yet, so there's nothing to change.`,
          say: true,
        };
      }
      const batchMax = ctx.limits?.pictureBatch ?? MAX_PICTURE_BATCH;
      if (drawn.length > batchMax) {
        return {
          kind: "invalid",
          reason: `I can change up to ${batchMax} pictures at once. Name fewer pages, or do it in two goes.`,
          say: true,
        };
      }
      const unitIds = drawn;
      const fresh = arg(args, "mode") === "new" || asksForNewPicture(change);

      // Who the change is about is looked up in the book, never guessed: a person put on the page
      // is drawn from their own sheet, or the picture gets a stranger.
      const wrote = arg(args, "people");
      const withoutThem = wrote.toLowerCase() === "none";
      const wanted = withoutThem ? [] : wrote.split(/[,;&]|\band\b|\bund\b/i).map((name) => name.trim()).filter(Boolean);
      const resolved = new Map<string, Anchor>();
      for (const name of wanted) {
        const hit = anchorByName(name, project.anchors);
        if (hit) resolved.set(hit.id, hit);
      }
      if (!withoutThem) for (const hit of anchorsNamedIn(change, project.anchors)) resolved.set(hit.id, hit);
      const unknown = wanted.filter((name) => /^\p{Lu}/u.test(name) && !anchorByName(name, project.anchors) && !anchorsNamedIn(name, project.anchors).length);
      if (!fresh && unknown.length > 0 && !withoutThem) {
        return askFor("people", "personNotInBook", [{ id: "none", label: "Draw them anyway" }], { names: unknown[0]! });
      }
      const effect: CommandEffect = { kind: "redrawPage", unitIds, instruction: change, ...(fresh ? { mode: "new" as const } : {}) };
      const added = fresh ? [] : [...resolved.keys()].filter((id) => unitIds.some((unit) => !castOnPage(project, unit).includes(id)));
      if (added.length > 0) {
        return {
          kind: "write",
          project: withPageCast(project, unitIds, added),
          beat: beat("redrawReady", undefined, { priority: "result" }),
          then: effect,
        };
      }
      return { kind: "effect", effect, beat: beat("redrawReady", undefined, { priority: "result" }) };
    },
  },
];
