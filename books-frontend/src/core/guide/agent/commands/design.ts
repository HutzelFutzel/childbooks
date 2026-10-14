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
import { COVER_BACK_ID, COVER_FRONT_ID, type Project } from "../../../types";
import { resolveOption } from "../resolve";
import type { Beat, CommandArgs, CommandContext, CommandDef } from "../types";
import { arg, askFor, beat } from "./shared";

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
export function resolveTextColor(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  const hex = text.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex && (text.startsWith("#") || hex[1]!.length === 6)) {
    const digits = hex[1]!.length === 3 ? hex[1]!.split("").map((c) => c + c).join("") : hex[1]!;
    return `#${digits}`;
  }
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
      const color = resolveTextColor(wanted);
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
];
