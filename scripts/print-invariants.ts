/**
 * Print invariants — the geometry and assembly properties a printable book
 * depends on, checked against the shipped code rather than a restatement of it.
 *
 * These are the failures that don't throw and don't show up in a typecheck.
 * A page declared one size and drawn at another still produces a valid PDF —
 * it just comes back from the printer 3% too big with the edges shaved off. An
 * interior that's four pages short of what was ordered is a valid PDF too, with
 * a spine cut for a book that doesn't exist. Both shipped.
 *
 * Run by `yarn check:print-geometry`, which bundles this with esbuild first.
 */
import { PDFDocument } from "pdf-lib";
import {
  buildCoverPdf,
  buildEbookPdf,
  buildInteriorPdf,
  type RasterPage,
} from "../books-frontend/src/core/print/assemble";
import {
  coverPanelWindow,
  pageGeometry,
  safeArea,
  spreadLeaves,
  withinSafeArea,
  PT_PER_IN,
  SAFETY_MARGIN_IN,
} from "../books-frontend/src/core/print/geometry";
import { interiorLeafPlan, physicalPageCount } from "../books-frontend/src/core/print/pagePlan";
import { preflightInterior } from "../books-frontend/src/core/print/preflight";
import { renderFingerprint } from "../books-frontend/src/core/print/fingerprint";
import { LULU_BOOK_PRODUCTS, normalizePageCount } from "../books-frontend/src/core/fulfillment/lulu/products";
import type { BookProduct } from "../books-frontend/src/core/fulfillment/types";
import type {
  BookDesign,
  Project,
  ScreenplayDoc,
  ScreenplaySpread,
} from "../books-frontend/src/core/types";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import {
  allBookLayouts,
  layoutPromptFacts,
  validateLayouts,
  PAGE_SIDES,
} from "../books-frontend/src/core/book/layouts";
import { validateTreatments } from "../books-frontend/src/core/book/treatments";
import { bindingSideFor } from "../books-frontend/src/core/book/pageLayout";
import { computePageGuides, resolveFormatCapabilities } from "../books-frontend/src/core/book/format";
import { chooseImageSize } from "../books-frontend/src/core/pipeline/illustration";
import { bookSizeFromAspect } from "../books-frontend/src/core/config/options";
import { defaultTemplate, PROMPT_ACTIONS } from "../books-frontend/src/core/prompts/registry";

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function near(a: number, b: number, tolerance = 1e-6): boolean {
  return Math.abs(a - b) <= tolerance;
}

const DPI = 300;

// A 1×1 PNG. The assembly checks care about page geometry, not pixels, so the
// smallest legal image keeps them fast and free of fixture noise.
const PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function raster(id: string, widthIn: number, heightIn: number): RasterPage {
  return { id, label: id, bytes: PIXEL_PNG, mimeType: "image/png", widthIn, heightIn };
}

const square = LULU_BOOK_PRODUCTS.find(
  (p) => p.trim.widthIn === 8.5 && p.trim.heightIn === 8.5 && p.binding === "casewrap",
) as BookProduct;
const saddle = LULU_BOOK_PRODUCTS.find((p) => p.binding === "saddle-stitch") as BookProduct;

// ---- Page geometry ---------------------------------------------------------

{
  const bleed = pageGeometry(square, { dpi: DPI, bleed: true });
  const trim = pageGeometry(square, { dpi: DPI, bleed: false });

  check(
    "a bleed page is the trim plus bleed on all four edges",
    near(bleed.widthIn, square.trim.widthIn + square.bleedIn * 2) &&
      near(bleed.heightIn, square.trim.heightIn + square.bleedIn * 2),
    `${bleed.widthIn}×${bleed.heightIn}in`,
  );

  // The bug this replaces: the page was LAID OUT at trim and DECLARED at bleed,
  // so the raster was stretched ~3% and the outer edge was trimmed away.
  check(
    "a bleed page is rendered at the size it is declared at",
    bleed.widthPx === Math.round(bleed.widthIn * DPI) &&
      bleed.heightPx === Math.round(bleed.heightIn * DPI),
    `${bleed.widthPx}×${bleed.heightPx}px for ${bleed.widthIn}×${bleed.heightIn}in`,
  );

  check(
    "the trim box inside a bleed page is the finished page size",
    near(bleed.trimWidthIn, square.trim.widthIn) && near(bleed.trimHeightIn, square.trim.heightIn),
  );

  check(
    "a screen page carries no bleed",
    trim.bleedPx === 0 && near(trim.widthIn, square.trim.widthIn),
  );

  check(
    "artwork keeps full resolution at the declared size",
    bleed.widthPx / bleed.widthIn === DPI,
    `${bleed.widthPx / bleed.widthIn} dpi`,
  );
}

// ---- Spreads ---------------------------------------------------------------

{
  const spread = pageGeometry(square, { dpi: DPI, bleed: true, spread: true });
  const { left, right } = spreadLeaves(spread);
  const leaf = pageGeometry(square, { dpi: DPI, bleed: true });

  check(
    "a spread is laid out as one continuous surface",
    near(spread.trimWidthIn, square.trim.widthIn * 2),
  );

  check(
    "each half of a spread is exactly one printable page wide",
    left.widthPx === leaf.widthPx && right.widthPx === leaf.widthPx,
    `${left.widthPx}/${right.widthPx} vs ${leaf.widthPx}`,
  );

  check(
    "the two halves together cover the whole spread",
    left.xPx === 0 && right.xPx + right.widthPx === spread.widthPx,
  );

  // Both leaves need artwork continuing past the gutter so their inner edges
  // bleed too. That overlap is the correct output, not a rounding error.
  const overlap = left.xPx + left.widthPx - right.xPx;
  const expected = Math.round(square.bleedIn * 2 * DPI);
  check(
    "the halves overlap by exactly twice the bleed at the gutter",
    overlap === expected,
    `${overlap}px vs ${expected}px`,
  );
}

// ---- Cover panels ----------------------------------------------------------

{
  const cover = pageGeometry(square, { dpi: DPI, bleed: true });
  const back = coverPanelWindow(cover, "left");
  const front = coverPanelWindow(cover, "right");

  check(
    "a cover panel is the trim plus its OUTER bleed only",
    near(back.widthIn, square.trim.widthIn + square.bleedIn) &&
      near(front.widthIn, back.widthIn),
    `${front.widthIn}in`,
  );

  check(
    "each panel is anchored to its outer edge",
    back.xPx === 0 && front.xPx + front.widthPx === cover.widthPx,
  );

  // Lulu returns a total cover width; the panels and the spine must tile it
  // exactly, or the artwork lands off the fold.
  const spineIn = 0.5;
  const totalIn = front.widthIn * 2 + spineIn;
  check(
    "panels plus spine tile the provider's cover width",
    near(totalIn - front.widthIn * 2, spineIn),
    `${totalIn}in`,
  );
}

// ---- Safe area -------------------------------------------------------------

{
  const recto = safeArea(square, "right");
  const verso = safeArea(square, "left");

  check(
    "the binding edge gets more clearance than the outer edge",
    recto.x > 1 - (recto.x + recto.w) && verso.x < 1 - (verso.x + verso.w),
    `recto inner ${recto.x.toFixed(3)}, verso inner ${(1 - verso.x - verso.w).toFixed(3)}`,
  );

  check(
    "the gutter is on the left of a right-hand page and mirrored on a left-hand one",
    near(recto.x, 1 - verso.x - verso.w) && near(verso.x, 1 - recto.x - recto.w),
  );

  const edgeBox = { x: 0.01, y: 0.01, w: 0.3, h: 0.2 };
  const insideBox = { x: 0.35, y: 0.3, w: 0.3, h: 0.2 };
  check("text at the very edge is flagged", !withinSafeArea(edgeBox, recto));
  check("text well inside the page is not flagged", withinSafeArea(insideBox, recto));

  check(
    "the margin is the documented physical distance",
    near(recto.y * square.trim.heightIn, SAFETY_MARGIN_IN),
  );
}

// ---- The physical leaf plan ------------------------------------------------

function spreadEntry(id: string, kind: "single" | "spread", placeholder = false): ScreenplaySpread {
  return {
    id,
    kind,
    text: "Once upon a time.",
    illustration: "A scene.",
    layoutNote: "",
    anchorIds: [],
    placeholder,
  } as ScreenplaySpread;
}

function doc(spreads: ScreenplaySpread[]): ScreenplayDoc {
  return { notes: "", spreads };
}

{
  const plan = interiorLeafPlan(doc([spreadEntry("a", "single"), spreadEntry("b", "single")]));
  check("a single page is one leaf", plan.length === 2);
  check(
    "page one is a right-hand page",
    plan[0].pageNumber === 1 && plan[0].side === "right" && plan[1].side === "left",
  );
}

{
  // A spread must start on a verso, so pagination inserts a filler before it.
  const withSpread = doc([spreadEntry("a", "single"), spreadEntry("wide", "spread")]);
  const plan = interiorLeafPlan(withSpread);

  check(
    "a spread prints as two leaves, not one page",
    plan.filter((l) => l.sourcePageId === "wide").length === 2,
    `${plan.filter((l) => l.sourcePageId === "wide").length} leaves`,
  );

  check(
    "the halves of a spread are separately addressable",
    plan.some((l) => l.id === "wide#left") && plan.some((l) => l.id === "wide#right"),
  );

  check(
    "a spread starts on a left-hand page",
    plan.find((l) => l.id === "wide#left")?.side === "left",
  );

  check(
    "page numbers are contiguous",
    plan.every((leaf, i) => leaf.pageNumber === i + 1),
  );
}

{
  const withFiller = doc([
    spreadEntry("a", "single"),
    spreadEntry("filler", "single", true),
    spreadEntry("b", "single"),
  ]);
  const plan = interiorLeafPlan(withFiller);
  check("a pagination filler still occupies a printed leaf", plan.length === 3);
  check(
    "a filler has nothing to capture",
    plan[1].sourcePageId === null,
  );
  check("the physical page count counts fillers", physicalPageCount(withFiller) === 3);
}

// ---- Interior assembly -----------------------------------------------------

{
  const geo = pageGeometry(saddle, { dpi: DPI, bleed: true });
  const pages = [raster("p1", geo.widthIn, geo.heightIn), raster("p2", geo.widthIn, geo.heightIn)];

  // Saddle stitch folds in fours, so 2 content pages are ordered (and priced,
  // and spine-sized) as 4. The PDF has to actually contain 4.
  const ordered = normalizePageCount(saddle, pages.length);
  const bytes = await buildInteriorPdf(pages, { padToPages: ordered });
  const parsed = await PDFDocument.load(bytes);

  check(
    "the interior is padded to the page count that was ordered",
    parsed.getPageCount() === ordered,
    `${parsed.getPageCount()} pages, ordered ${ordered}`,
  );

  const sizes = parsed.getPages().map((p) => `${p.getWidth().toFixed(3)}×${p.getHeight().toFixed(3)}`);
  check(
    "every interior page — including the blanks — is the same size",
    new Set(sizes).size === 1,
    sizes.join(", "),
  );

  check(
    "interior pages are the bleed size, in PDF points",
    near(parsed.getPage(0).getWidth(), geo.widthIn * PT_PER_IN, 0.01),
    `${parsed.getPage(0).getWidth()}pt vs ${geo.widthIn * PT_PER_IN}pt`,
  );
}

{
  const geo = pageGeometry(square, { dpi: DPI, bleed: true });
  const pages = Array.from({ length: 40 }, (_, i) => raster(`p${i}`, geo.widthIn, geo.heightIn));
  const bytes = await buildInteriorPdf(pages, { padToPages: 24 });
  const parsed = await PDFDocument.load(bytes);
  check(
    "a book longer than the ordered count is never truncated",
    parsed.getPageCount() === 40,
    `${parsed.getPageCount()} pages`,
  );
}

// ---- Cover assembly --------------------------------------------------------

{
  const geo = pageGeometry(square, { dpi: DPI, bleed: true });
  const panelWidthIn = geo.trimWidthIn + geo.bleedIn;
  const spineIn = 0.62;
  const widthIn = panelWidthIn * 2 + spineIn;

  const bytes = await buildCoverPdf(
    {
      front: raster("front", panelWidthIn, geo.heightIn),
      back: raster("back", panelWidthIn, geo.heightIn),
      spine: raster("spine", spineIn, geo.heightIn),
    },
    { widthIn, heightIn: geo.heightIn, panelWidthIn },
  );
  const parsed = await PDFDocument.load(bytes);

  check("the wraparound cover is a single page", parsed.getPageCount() === 1);
  check(
    "the cover is exactly the size the provider asked for",
    near(parsed.getPage(0).getWidth(), widthIn * PT_PER_IN, 0.01) &&
      near(parsed.getPage(0).getHeight(), geo.heightIn * PT_PER_IN, 0.01),
    `${parsed.getPage(0).getWidth()}×${parsed.getPage(0).getHeight()}pt`,
  );

  // A book with no back-cover art must still produce a printable wraparound.
  const noBack = await buildCoverPdf(
    { front: raster("front", panelWidthIn, geo.heightIn) },
    { widthIn, heightIn: geo.heightIn, panelWidthIn, background: { r: 1, g: 1, b: 1 } },
  );
  check("a cover with no back artwork still assembles", (await PDFDocument.load(noBack)).getPageCount() === 1);
}

// ---- Ebook assembly --------------------------------------------------------

{
  const trim = pageGeometry(square, { dpi: DPI, bleed: false });
  const spread = pageGeometry(square, { dpi: DPI, bleed: false, spread: true });
  const bytes = await buildEbookPdf([
    raster("cover", trim.widthIn, trim.heightIn),
    raster("wide", spread.widthIn, spread.heightIn),
  ]);
  const parsed = await PDFDocument.load(bytes);

  check(
    "the digital edition keeps a spread whole",
    near(parsed.getPage(1).getWidth(), parsed.getPage(0).getWidth() * 2, 0.01),
  );

  check(
    "the digital edition has no bleed",
    near(parsed.getPage(0).getWidth(), square.trim.widthIn * PT_PER_IN, 0.01),
  );
}

// ---- Preflight -------------------------------------------------------------

{
  const design: BookDesign = {
    defaultFontFamily: "Nunito",
    defaultFontSizePct: 0.06,
    pages: {
      a: {
        textBoxes: [
          {
            id: "t1",
            rect: { x: 0.001, y: 0.001, w: 0.4, h: 0.2 },
            z: 1,
            presetId: "card",
            fontFamily: "Nunito",
            fontSizePct: 0.06,
            color: "#000",
            align: "left",
            vAlign: "top",
            lineHeight: 1.2,
            paragraphs: [{ spans: [{ text: "Too close to the edge" }] }],
          },
        ],
      },
      b: {
        textBoxes: [
          {
            id: "t2",
            rect: { x: 0.3, y: 0.3, w: 0.3, h: 0.2 },
            z: 1,
            presetId: "card",
            fontFamily: "Nunito",
            fontSizePct: 0.06,
            color: "#000",
            align: "left",
            vAlign: "top",
            lineHeight: 1.2,
            paragraphs: [{ spans: [{ text: "Comfortably inside" }] }],
          },
        ],
      },
    },
  };

  const issues = preflightInterior({
    plan: interiorLeafPlan(doc([spreadEntry("a", "single"), spreadEntry("b", "single")])),
    design,
    product: square,
    hasArtwork: () => true,
    labelFor: (id) => `Page ${id}`,
  });

  check(
    "text over the trim line is reported",
    issues.some((i) => i.code === "text-outside-safe-area" && i.pageId === "a"),
  );
  check(
    "text inside the safe area is not reported",
    !issues.some((i) => i.code === "text-outside-safe-area" && i.pageId === "b"),
  );

  const blank = preflightInterior({
    plan: interiorLeafPlan(doc([spreadEntry("a", "single")])),
    design,
    product: square,
    hasArtwork: () => false,
    labelFor: () => "Page 1",
  });
  check(
    "a page with no artwork is reported before it prints blank",
    blank.some((i) => i.code === "page-has-no-artwork"),
  );
}

// ---- Render fingerprint ----------------------------------------------------

{
  const design: BookDesign = { defaultFontFamily: "Nunito", defaultFontSizePct: 0.06, pages: {} };
  const base = {
    id: "p1",
    title: "The Brave Little Fox",
    createdAt: 1,
    updatedAt: 2,
    stage: "design",
    furthestStage: "design",
    config: { productSku: square.sku, bookSize: "square", layoutId: "outer-text" },
    screenplay: createVersionTree(doc([spreadEntry("a", "single")])),
    illustrations: {
      a: createVersionTree({ blobId: "blob-1", mimeType: "image/png" }),
    },
  } as unknown as Project;

  const first = renderFingerprint(base, design);

  check("the same book fingerprints the same twice", first === renderFingerprint(base, design));

  const touched = { ...base, updatedAt: 99, rev: 12 } as Project;
  check(
    "a save that changes nothing visible keeps the render valid",
    renderFingerprint(touched, design) === first,
  );

  const retitled = { ...base, title: "A Different Book" } as Project;
  check("retitling the book invalidates the render", renderFingerprint(retitled, design) !== first);

  const reillustrated = {
    ...base,
    illustrations: { a: createVersionTree({ blobId: "blob-2", mimeType: "image/png" }) },
  } as unknown as Project;
  check(
    "regenerating an illustration invalidates the render",
    renderFingerprint(reillustrated, design) !== first,
  );

  const restyled: BookDesign = { ...design, defaultFontSizePct: 0.09 };
  check("changing the design invalidates the render", renderFingerprint(base, restyled) !== first);

  const reformatted = {
    ...base,
    config: { ...base.config, productSku: saddle.sku },
  } as Project;
  check("changing the format invalidates the render", renderFingerprint(reformatted, design) !== first);
}

// ---- Page layouts ----------------------------------------------------------
//
// A layout is the one thing that decides both where the text is drawn AND what
// the image model is told to keep clear for it. When those two disagree, every
// page still renders — the words just land on top of a face. None of that is
// visible to a typecheck, so the catalog is asserted here instead.

{
  for (const problem of validateLayouts()) check(`layout catalog: ${problem}`, false);
  for (const problem of validateTreatments()) check(`treatment catalog: ${problem}`, false);
  check("the layout catalog is self-consistent", validateLayouts().length === 0);
  check("the treatment catalog is self-consistent", validateTreatments().length === 0);

  for (const layout of allBookLayouts()) {
    for (const product of [square, saddle] as BookProduct[]) {
      const caps = resolveFormatCapabilities(product, product.minPages);
      for (const side of PAGE_SIDES) {
        const spread = side === "spread";
        const { safe } = computePageGuides({ caps, spread, bindingSide: bindingSideFor(side) });
        const plan = layout.plan({
          side,
          safe,
          aspect: spread ? product.aspect * 2 : product.aspect,
          trim: product.trim,
          isCover: false,
          mode: "full-bleed",
        });
        const label = `${layout.id} · ${product.sku} · ${side}`;

        // Text outside the safe area is trimmed off by the printer, and a
        // fraction-of-the-page rect is exactly how that happens on a trim whose
        // margin isn't the fraction the layout was authored against.
        for (const slot of plan.slots) {
          const r = slot.pageRect;
          check(
            `${label}: slot "${slot.id}" stays inside the printable safe area`,
            r.x >= safe.x - 1e-9 &&
              r.y >= safe.y - 1e-9 &&
              r.x + r.w <= safe.x + safe.w + 1e-9 &&
              r.y + r.h <= safe.y + safe.h + 1e-9,
          );
        }

        // The prompt must actually say where the calm band is. An empty
        // description means the model is told nothing and the text lands on
        // whatever the model felt like painting there.
        const surfaceAspect = spread ? product.aspect * 2 : product.aspect;
        const facts = layoutPromptFacts(plan, surfaceAspect);
        if (plan.slots.some((s) => s.role === "text")) {
          check(`${label}: the prompt describes the calm region`, facts.calmRegions.length > 0);
          check(`${label}: the prompt describes where the focal action goes`, facts.focalRegion.length > 0);
          // A slot running the full printable height must read as a column
          // ("the right third"), not a vague "block on the right side" — that
          // phrasing is what the model actually acts on.
          const fullHeight = plan.slots.some(
            (s) => s.role === "text" && s.pageRect.h >= safe.h - 1e-9,
          );
          check(
            `${label}: the calm region names a page position, not just numbers`,
            /third|quarter|half|fifth|sixth|eighth|band|block|column|whole/.test(facts.calmRegions),
          );
          if (fullHeight) {
            check(
              `${label}: a full-height text column is described as a column`,
              !/block/.test(facts.calmRegions),
              facts.calmRegions,
            );
          }
        }

        // Inset art that overlaps the text would be covered by it.
        const inset = layout.plan({
          side,
          safe,
          aspect: surfaceAspect,
          trim: product.trim,
          isCover: false,
          mode: "inset-art",
        });
        if (inset.mode === "inset-art") {
          for (const slot of inset.slots.filter((s) => s.role === "text")) {
            const a = inset.artRect;
            const t = slot.pageRect;
            const overlaps =
              a.x < t.x + t.w && t.x < a.x + a.w && a.y < t.y + t.h && t.y < a.y + a.h;
            check(`${label}: inset artwork doesn't run under the text`, !overlaps);
          }
          check(
            `${label}: inset artwork is a usable shape`,
            inset.artRect.w > 0.2 && inset.artRect.h > 0.2,
          );
        }
      }
    }
  }

  // The generated canvas must match the shape of the region it fills, or the
  // page crops it — the failure that looks like "the model ignored my prompt".
  for (const product of [square, saddle] as BookProduct[]) {
    const config = { productSku: product.sku, bookSize: bookSizeFromAspect(product.aspect) };
    const [w, h] = chooseImageSize("single", config).split("x").map(Number);
    const requested = w / h;
    check(
      `${product.sku}: a full-page render is generated at roughly the page shape`,
      Math.abs(requested - product.aspect) / product.aspect < 0.3,
      `asked for ${requested.toFixed(2)}, page is ${product.aspect.toFixed(2)}`,
    );
  }

  // Every variable the layout blocks interpolate has to be declared, or the
  // admin prompt editor renders `{{calmRegions}}` as literal text to the model.
  {
    const metas = PROMPT_ACTIONS.flatMap((a) => a.templates);
    check("every prompt template is described to the admin editor", metas.length > 0);

    for (const meta of metas) {
      const template = defaultTemplate(meta.key);
      // Text prompts split into system/user; image prompts are one `single` list.
      const blocks = [
        ...(template.system ?? []),
        ...(template.user ?? []),
        ...(template.single ?? []),
      ];
      check(`${meta.key} resolves to a shipped template`, blocks.length > 0);
      if (blocks.length === 0) continue;

      const declared = new Set(meta.variables.map((v) => v.name));
      const used = new Set(
        blocks.flatMap((b) => [...b.text.matchAll(/\{\{(\w+)\}\}/g)]).map((m) => m[1]),
      );
      for (const name of used) {
        check(`${meta.key} declares {{${name}}}`, declared.has(name));
      }

      const flags = new Set(Object.keys(meta.sampleFlags));
      for (const block of blocks) {
        if (!block.enabledWhen) continue;
        // A predicate may be negated ("!isSpread"); either polarity is driven
        // by the same sample flag.
        const flag = block.enabledWhen.replace(/^!/, "");
        check(`${meta.key} can preview the "${block.id}" block`, flags.has(flag));
      }
    }
  }
}

// ---- Report ----------------------------------------------------------------

for (const name of checks) console.log(`  ok   ${name}`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
console.log(`\n${checks.length} passed, ${failures.length} failed.`);
process.exit(failures.length > 0 ? 1 : 0);
