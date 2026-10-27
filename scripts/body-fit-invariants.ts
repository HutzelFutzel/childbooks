/**
 * Invariants for the book-wide fit of the story text.
 *
 * What a parent would notice, and what these hold:
 *
 * - a page whose words outgrow its text area never has its text clipped: every
 *   story box fits at the size it ends up with;
 * - the size is the same on every page, never above the age-based size, and a
 *   book of short pages keeps that size;
 * - fitting twice changes nothing, and shortening the long page gives the size back;
 * - a size the reader chose (a shared story style, or one box changed) is never
 *   overwritten;
 * - a page added later starts at the fitted size.
 *
 * Offline and deterministic: text is measured with a stand-in canvas whose
 * glyphs are half an em wide.
 */
import assert from "node:assert/strict";
import type { LayoutPlan, ResolvedSlot } from "../books-frontend/src/core/book/layouts";
import { textFromParagraphs, wordParagraphs, createDefaultDesign } from "../books-frontend/src/core/design";
import {
  bodySizePct,
  fitBookBodyText,
  seedPageDesign,
  type DesignPage,
} from "../books-frontend/src/ui/design/designInit";
import { isTextOverflowing } from "../books-frontend/src/ui/design/textFit";
import type { BookDesign, PageDesign, TextBox } from "../books-frontend/src/core/types";

// --- A canvas that measures every glyph as half an em ---------------------

const measuring = {
  font: "16px sans-serif",
  measureText(text: string) {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
    return { width: text.length * px * 0.5 };
  },
};
(globalThis as { document?: unknown }).document = {
  createElement: () => ({ getContext: () => measuring }),
};

// --- A book: pages with one text area each --------------------------------

const ASPECT = 0.8;
const SEED = 0.04;

function pageOf(id: string, text: string): DesignPage {
  const slot = {
    id: "text",
    role: "text",
    rect: { x: 0.1, y: 0.62, w: 0.8, h: 0.3 },
    pageRect: { x: 0.1, y: 0.62, w: 0.8, h: 0.3 },
    presetId: "plain",
    align: "center",
    vAlign: "center",
    treatment: {},
  } as unknown as ResolvedSlot;
  const plan: LayoutPlan = {
    layoutId: "test",
    mode: "full-bleed",
    side: "right",
    slots: [slot],
    artRect: { x: 0, y: 0, w: 1, h: 1 },
  };
  return {
    id,
    label: id,
    aspect: ASPECT,
    seedText: text,
    layoutNote: "",
    isCover: false,
    outerSide: "right",
    plan,
    textWidth: 0.9,
  };
}

const SHORT = "Papa buckled Aren with a clickity-click.";
const LONG = Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a stanza that keeps on rolling along.`).join(" ");

function seeded(pages: DesignPage[]): BookDesign {
  const base = createDefaultDesign("Itim", SEED);
  const designPages: Record<string, PageDesign> = {};
  for (const page of pages) designPages[page.id] = seedPageDesign(base, page);
  return { ...base, pages: designPages };
}

const storyBoxes = (design: BookDesign): TextBox[] =>
  Object.values(design.pages).flatMap((p) => p.textBoxes.filter((b) => b.role === "story-body"));

// --- Short pages keep the age-based size -----------------------------------

const shortPages = [pageOf("a", SHORT), pageOf("b", SHORT)];
const shortBook = fitBookBodyText(seeded(shortPages), shortPages);
assert.ok(
  storyBoxes(shortBook).every((b) => b.fontSizePct === SEED),
  "A book of short pages lost its age-based size.",
);
assert.equal(shortBook.bodyFit?.appliedPct, SEED);

// --- One wordy page decides the size for all of them -----------------------

const pages = [pageOf("a", SHORT), pageOf("b", LONG), pageOf("c", SHORT)];
const raw = seeded(pages);
const wordy = storyBoxes(raw).find((b) => textFromParagraphs(b.paragraphs) === LONG)!;
assert.ok(
  isTextOverflowing(wordy, ASPECT, SEED * 1000),
  "The wordy page already fit; the fixture proves nothing.",
);

const fitted = fitBookBodyText(raw, pages);
const applied = fitted.bodyFit!.appliedPct;
assert.ok(applied < SEED, "The wordy page did not shrink the book's size.");
assert.ok(applied >= 0.018, "The shared size fell below the readability floor.");

const boxes = storyBoxes(fitted);
assert.equal(boxes.length, 3);
assert.ok(
  boxes.every((b) => b.fontSizePct === applied),
  "Story text is not one size across the book.",
);
for (const box of boxes) {
  assert.ok(
    !isTextOverflowing(box, ASPECT, box.fontSizePct * 1000),
    "A story box still clips its text after the fit.",
  );
  assert.ok(box.rect.h <= 0.3 + 1e-9, "A story box grew past its text area.");
}
// The size is the largest that fits: a little bigger would clip the wordy page.
const bigger = { ...boxes.find((b) => textFromParagraphs(b.paragraphs) === LONG)!, fontSizePct: applied + 0.002 };
assert.ok(
  isTextOverflowing(bigger, ASPECT, bigger.fontSizePct * 1000) || bigger.rect.h < 0.3,
  "The fitted size left room to grow.",
);

// --- Fitting is stable ------------------------------------------------------

assert.equal(fitBookBodyText(fitted, pages), fitted, "Fitting a fitted book changed it again.");

// --- Shortening the wordy page gives the size back -------------------------

const edited = pages.map((p) => (p.id === "b" ? pageOf("b", SHORT) : p));
const shorter: BookDesign = {
  ...fitted,
  pages: {
    ...fitted.pages,
    b: {
      ...fitted.pages.b!,
      textBoxes: fitted.pages.b!.textBoxes.map((b) => ({ ...b, paragraphs: wordParagraphs(SHORT) })),
    },
  },
};
const regrown = fitBookBodyText(shorter, edited);
assert.equal(regrown.bodyFit?.appliedPct, SEED, "The size did not come back once the long page was short.");
assert.ok(storyBoxes(regrown).every((b) => b.fontSizePct === SEED));

// --- The reader's size is never overwritten --------------------------------

const ownSize: BookDesign = {
  ...raw,
  pages: {
    ...raw.pages,
    a: {
      ...raw.pages.a!,
      textBoxes: raw.pages.a!.textBoxes.map((b) => ({ ...b, fontSizePct: 0.05 })),
    },
  },
};
assert.equal(fitBookBodyText(ownSize, pages), ownSize, "One box the reader resized was fitted over.");

const sharedStyle: BookDesign = {
  ...raw,
  sharedTextStyles: {
    "story-body": { fontFamily: "Itim", fontSizePct: SEED, color: "#111111", lineHeight: 1.25 },
  },
};
assert.equal(fitBookBodyText(sharedStyle, pages), sharedStyle, "A shared story style the reader set was fitted over.");

// --- A page added later starts at the fitted size ---------------------------

assert.equal(bodySizePct(fitted), applied);
const added = seedPageDesign(fitted, pageOf("d", SHORT));
assert.ok(
  added.textBoxes.every((b) => b.fontSizePct === applied),
  "A new page did not start at the book's fitted size.",
);

console.log("Body text fit invariants hold.");
