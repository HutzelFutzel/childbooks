/**
 * Builds the list of designable pages from a project and seeds default text
 * boxes/typography for the Final Design editor.
 *
 * Placement is never decided here: every rectangle comes from the active
 * layout's plan (`core/book/pageLayout`), which is the same plan the
 * illustration prompt is compiled from. This module only decides *what* text
 * goes into a slot and how a page is re-laid-out when the layout changes.
 */
import { bookProductForConfig } from "../../core/book";
import { planPageLayout } from "../../core/book/pageLayout";
import type { LayoutPlan, PageSide, ResolvedSlot } from "../../core/book/layouts";
import { getBookLayout } from "../../core/book/layouts";
import { paginate } from "../../core/pipeline/pagination";
import { getCursor } from "../../core/versioning";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  DESIGN_VERSION,
  type BookDesign,
  type CoverSpec,
  type ImageElement,
  type NormRect,
  type PageDesign,
  type Project,
  type SharedTextStyle,
  type SharedTextStyleKey,
  type TextBox,
} from "../../core/types";
import { withSharedTextStyle, wordParagraphs } from "../../core/design";
import { artCarriesLettering, coverLinesOf, frontCoverArt } from "../../core/book/coverLines";
import type { BookLanguagesConfig } from "../../core/config/bookLanguages";
import { getBookLanguage } from "../../core/config/bookLanguages";
import type { LayoutsConfig } from "../../core/config/layouts";
import {
  defaultBodyFontSeedPt,
  type TypographyConfig,
} from "../../core/config/typography";
import { defaultFontForAge, getFont } from "../typography/fonts";
import { getPreset } from "./presets";
import { fitBoxHeightPct } from "./textFit";

export interface DesignPage {
  id: string;
  label: string;
  /** Aspect ratio width/height of the page surface. */
  aspect: number;
  /** Illustration blob (if generated). */
  blobId?: string;
  /** Seeding info. */
  seedText: string;
  seedTitle?: string;
  seedSubtitle?: string;
  seedAuthor?: string;
  layoutNote: string;
  isCover: boolean;
  /** Cover-only: the art carries the cover's words, so the text layer stands aside. */
  bakeText?: boolean;
  /** Physical side this page sits on (which side's layout slots apply). */
  outerSide: PageSide;
  /** The active layout's resolved plan for this page. */
  plan: LayoutPlan;
}

function uid(prefix = "tb"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function blobFor(project: Project, id: string): string | undefined {
  const tree = project.illustrations?.[id];
  return tree ? getCursor(tree).content.blobId : undefined;
}

/** All pages that can be designed, in reading order (covers + content pages). */
/** "Page 7", or "Pages 8–9" for the two leaves a spread occupies. */
function pageLabel(pageNumbers: number[] | undefined): string {
  if (!pageNumbers || pageNumbers.length === 0) return "Page";
  if (pageNumbers.length === 1) return `Page ${pageNumbers[0]}`;
  return `Pages ${pageNumbers[0]}–${pageNumbers[pageNumbers.length - 1]}`;
}

export function buildDesignPages(
  project: Project,
  layoutsConfig?: LayoutsConfig | null,
): DesignPage[] {
  const aspect = bookProductForConfig(project.config).aspect;
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const pages: DesignPage[] = [];

  // Physical side per content spread (recto = odd page number = right edge).
  const pageMap = doc ? paginate(doc).pageMap : new Map<string, number[]>();
  const sideOf = (s: { id: string; kind: "single" | "spread" }): PageSide => {
    if (s.kind === "spread") return "spread";
    const nums = pageMap.get(s.id);
    return nums && nums[0] % 2 === 1 ? "right" : "left";
  };

  if (doc?.frontCover) pages.push(frontCoverPage(project, doc.frontCover, aspect, layoutsConfig));
  if (doc) {
    doc.spreads.forEach((s) => {
      if (s.placeholder) return;
      const side = sideOf(s);
      pages.push({
        id: s.id,
        // The PHYSICAL page number, not the position in the spread list. They
        // diverge as soon as the book has a double-page spread (two leaves) or
        // a pagination filler (a leaf with no design page), and this label is
        // what a print warning tells the reader to go and look at.
        label: pageLabel(pageMap.get(s.id)),
        aspect: s.kind === "spread" ? aspect * 2 : aspect,
        blobId: blobFor(project, s.id),
        seedText: s.text,
        layoutNote: s.layoutNote,
        isCover: false,
        outerSide: side,
        plan: planPageLayout(project, { side, textLength: s.text.length, layoutsConfig }),
      });
    });
  }
  if (doc?.backCover) {
    pages.push(coverPage(project, COVER_BACK_ID, "Back cover", aspect, doc.backCover, layoutsConfig));
  }
  return pages;
}

/**
 * The front cover's words come from {@link coverLinesOf}, and whether the text
 * layer stands aside follows the artwork actually there — so a cover that fell
 * back to a plain drawing shows its words as text.
 */
function frontCoverPage(
  project: Project,
  spec: CoverSpec,
  aspect: number,
  layoutsConfig?: LayoutsConfig | null,
): DesignPage {
  const lines = coverLinesOf(project);
  const page = coverPage(project, COVER_FRONT_ID, "Front cover", aspect, spec, layoutsConfig);
  return {
    ...page,
    seedTitle: lines.title,
    seedSubtitle: lines.subtitle,
    seedAuthor: lines.author,
    bakeText: frontArtCarriesWords(project, spec),
  };
}

function frontArtCarriesWords(project: Project, spec?: CoverSpec): boolean {
  const art = frontCoverArt(project);
  if (!art?.blobId) return false;
  // Covers drawn before the words were recorded carry them when the spec asked.
  return artCarriesLettering(art) || (art.textMode === "in-image" && !art.bakedText && Boolean(spec?.bakeText));
}

function coverPage(
  project: Project,
  id: string,
  label: string,
  aspect: number,
  spec: CoverSpec,
  layoutsConfig?: LayoutsConfig | null,
): DesignPage {
  // Front cover sits on the right (recto); back cover on the left (verso).
  const side: PageSide = id === COVER_FRONT_ID ? "right" : "left";
  return {
    id,
    label,
    aspect,
    blobId: blobFor(project, id),
    seedText: "",
    seedTitle: spec.title,
    seedSubtitle: spec.subtitle,
    layoutNote: spec.illustration,
    isCover: true,
    bakeText: Boolean(spec.bakeText && (spec.title ?? "").trim()),
    outerSide: side,
    plan: planPageLayout(project, { side, isCover: true, layoutsConfig }),
  };
}

/**
 * Default framing for a page's full-bleed illustration before the user has
 * manually repositioned it. Covers bias the crop toward the TOP: the generated
 * cover art is often taller than the trim, and a centred `object-fit: cover`
 * would then shave the top edge — exactly where a baked-in title lives. Content
 * pages keep the neutral centre crop.
 */
export function defaultIllustrationFocus(
  page: Pick<DesignPage, "isCover">,
): { x: number; y: number } | undefined {
  return page.isCover ? { x: 0.5, y: 0 } : undefined;
}

export function defaultDesign(
  project: Project,
  languages?: BookLanguagesConfig | null,
  typography?: TypographyConfig | null,
): BookDesign {
  const { family } = defaultFontForAge(
    project.config.ageRangeId,
    project.config.contentLocale,
    languages,
  );
  const trim = bookProductForConfig(project.config).trim;
  const seedPt = defaultBodyFontSeedPt({
    ageRangeId: project.config.ageRangeId,
    readingModeId: project.config.readingModeId,
    trim,
    config: typography,
  });
  // Design geometry is normalized to page height, but the initial reading size
  // is physical: the same point size must survive every offered trim.
  const sizePct = seedPt / (trim.heightIn * 72);
  const language = getBookLanguage(project.config.contentLocale);
  const titleFontId = languages?.overrides[language.id]?.defaultTitleFontId;
  const titleFamily = titleFontId ? getFont(titleFontId)?.family : undefined;
  return {
    version: DESIGN_VERSION,
    defaultFontFamily: family,
    ...(titleFamily ? { defaultTitleFontFamily: titleFamily } : {}),
    defaultFontSizePct: sizePct,
    printSettings: { bleedMode: "mirror" },
    pages: {},
  };
}

function makeTextBox(input: {
  rect: NormRect;
  text: string;
  family: string;
  sizePct: number;
  presetId: string;
  z: number;
  slotId?: string;
  role?: TextBox["role"];
  align?: TextBox["align"];
  vAlign?: TextBox["vAlign"];
  name?: string;
  sharedStyle?: SharedTextStyle;
}): TextBox {
  const preset = getPreset(input.presetId);
  const box: TextBox = {
    id: uid(),
    rect: input.rect,
    z: input.z,
    presetId: input.presetId,
    fontFamily: input.family,
    fontSizePct: input.sizePct,
    color: preset.defaults.text,
    align: input.align ?? "center",
    vAlign: input.vAlign ?? "center",
    lineHeight: 1.25,
    paragraphs: wordParagraphs(input.text),
    fill: preset.defaults.fill,
    stroke: preset.defaults.stroke,
    padding: preset.padding,
    autoFit: true,
    ...(input.slotId ? { slotId: input.slotId } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.name ? { name: input.name } : {}),
  };
  return input.sharedStyle ? withSharedTextStyle(box, input.sharedStyle) : box;
}

function sharedStyle(
  design: BookDesign,
  key: SharedTextStyleKey,
): SharedTextStyle | undefined {
  return design.sharedTextStyles?.[key];
}

/**
 * Size a generated box to its wrapped text while keeping it positioned inside
 * the layout slot that reserved space for it. The slot itself remains
 * full-height for illustration prompting; only the editor's interactive box
 * hugs the words.
 */
function hugTextInRect(box: TextBox, container: NormRect, pageAspect: number): TextBox {
  const h = Math.min(container.h, fitBoxHeightPct(box, pageAspect));
  const y =
    box.vAlign === "top"
      ? container.y
      : box.vAlign === "bottom"
        ? container.y + container.h - h
        : container.y + (container.h - h) / 2;
  return {
    ...box,
    rect: { ...container, y, h },
    autoHeight: true,
    autoFit: false,
  };
}

/**
 * The illustration element for a plan that places art beside the text.
 *
 * Full-bleed pages need none: the page surface draws the illustration behind
 * everything by default. Inset art has to become a real placed element so it
 * occupies exactly the rectangle the image was generated for, leaving the page
 * background visible where the text sits.
 */
function insetIllustration(plan: LayoutPlan, z: number): ImageElement | null {
  if (plan.mode !== "inset-art") return null;
  return {
    id: uid("im"),
    kind: "illustration",
    rect: plan.artRect,
    z,
    fit: "cover",
    name: "Illustration",
  };
}

/** The text a slot is fed, given the page it sits on. */
function textForSlot(slot: ResolvedSlot, page: DesignPage): string {
  switch (slot.source) {
    case "book-title":
      return page.seedTitle ?? "";
    case "book-subtitle":
      return page.seedSubtitle ?? "";
    case "spread-text":
    default:
      return page.seedText;
  }
}

const COVER_ROLES = new Set<TextBox["role"]>(["book-title", "book-subtitle", "book-author"]);

function authorBox(design: BookDesign, text: string, z: number): TextBox {
  const box = makeTextBox({
    rect: { x: 0.15, y: 0.84, w: 0.7, h: 0.08 },
    text,
    family: design.defaultFontFamily,
    sizePct: design.defaultFontSizePct * 0.8,
    presetId: "shadowed",
    z,
    sharedStyle: sharedStyle(design, "book-author"),
  });
  box.role = "book-author";
  return box;
}

/**
 * Toggle baked cover text on an existing page design. Role-owned overlays are
 * hidden rather than deleted so typography, color, placement, and current text
 * survive a round trip through "paint title into illustration".
 */
export function applyCoverBakeText(
  design: BookDesign,
  page: DesignPage,
  pageDesign: PageDesign,
  bakeText: boolean,
): PageDesign {
  if (bakeText) {
    return {
      ...pageDesign,
      textBoxes: pageDesign.textBoxes.map((b) => (COVER_ROLES.has(b.role) ? { ...b, hidden: true } : b)),
    };
  }

  const boxes = pageDesign.textBoxes.map((b) => (COVER_ROLES.has(b.role) ? { ...b, hidden: false } : b));
  let nextZ = Math.max(0, ...boxes.map((b) => b.z)) + 1;

  if (!boxes.some((b) => b.role === "book-title") && page.seedTitle?.trim()) {
    const titleBox = makeTextBox({
      rect: { x: 0.1, y: 0.08, w: 0.8, h: 0.2 },
      text: page.seedTitle,
      family: design.defaultTitleFontFamily ?? design.defaultFontFamily,
      sizePct: Math.min(0.13, design.defaultFontSizePct * 1.7),
      presetId: "shadowed",
      z: nextZ++,
      sharedStyle: sharedStyle(
        design,
        page.id === COVER_FRONT_ID ? "book-title" : "custom-cover",
      ),
    });
    if (page.id === COVER_FRONT_ID) titleBox.role = "book-title";
    boxes.push(titleBox);
  }

  if (!boxes.some((b) => b.role === "book-subtitle") && page.seedSubtitle?.trim()) {
    const subtitleBox = makeTextBox({
      rect: { x: 0.15, y: 0.3, w: 0.7, h: 0.12 },
      text: page.seedSubtitle,
      family: design.defaultFontFamily,
      sizePct: design.defaultFontSizePct,
      presetId: "shadowed",
      z: nextZ++,
      sharedStyle: sharedStyle(design, "book-subtitle"),
    });
    subtitleBox.role = "book-subtitle";
    boxes.push(subtitleBox);
  }

  if (page.id === COVER_FRONT_ID && !boxes.some((b) => b.role === "book-author") && page.seedAuthor?.trim()) {
    boxes.push(authorBox(design, page.seedAuthor, nextZ++));
  }

  return { ...pageDesign, textBoxes: boxes };
}

/**
 * Match the front cover's text layer to its current artwork, once per new
 * artwork: hidden when the art carries the words, shown (and filled in) when
 * it does not. Pages seeded before this was tracked are only stamped, so a
 * layer someone arranged by hand is never rearranged for them.
 */
export function reconcileCoverLettering(project: Project): Project {
  const design = project.design;
  const pageDesign = design?.pages[COVER_FRONT_ID];
  if (!design || !pageDesign) return project;
  const art = frontCoverArt(project)?.blobId ?? "";
  if (pageDesign.letteringFor === art) return project;
  const spec = project.screenplay ? getCursor(project.screenplay).content.frontCover : undefined;
  let next: PageDesign = { ...pageDesign, letteringFor: art };
  if (pageDesign.letteringFor !== undefined && spec) {
    const aspect = bookProductForConfig(project.config).aspect;
    const page = frontCoverPage(project, spec, aspect);
    next = { ...applyCoverBakeText(design, page, pageDesign, Boolean(page.bakeText)), letteringFor: art };
  }
  return { ...project, design: { ...design, pages: { ...design.pages, [COVER_FRONT_ID]: next } } };
}

/**
 * Returns a seeded PageDesign for a page (used the first time it's opened). Only
 * seeds boxes for pages with overlay text or cover titles.
 */
export function seedPageDesign(design: BookDesign, page: DesignPage): PageDesign {
  const existing = design.pages[page.id];
  if (existing) return existing;

  const boxes: TextBox[] = [];
  // Baked-text covers carry their title/subtitle in the artwork itself, so no
  // overlay text boxes are seeded (that would double up the text).
  if (page.isCover && !page.bakeText) {
    if (page.seedTitle) {
      const titleBox = makeTextBox({
        rect: { x: 0.1, y: 0.08, w: 0.8, h: 0.2 },
        text: page.seedTitle,
        family: design.defaultTitleFontFamily ?? design.defaultFontFamily,
        sizePct: Math.min(0.13, design.defaultFontSizePct * 1.7),
        presetId: "shadowed",
        z: 1,
        sharedStyle: sharedStyle(
          design,
          page.id === COVER_FRONT_ID ? "book-title" : "custom-cover",
        ),
      });
      // Front-cover title stays linked to the project / story title.
      if (page.id === COVER_FRONT_ID) titleBox.role = "book-title";
      boxes.push(titleBox);
    }
    if (page.seedSubtitle) {
      const subtitleBox = makeTextBox({
        rect: { x: 0.15, y: 0.3, w: 0.7, h: 0.12 },
        text: page.seedSubtitle,
        family: design.defaultFontFamily,
        sizePct: design.defaultFontSizePct,
        presetId: "shadowed",
        z: 2,
        sharedStyle: sharedStyle(design, "book-subtitle"),
      });
      // Tagged so toggling baked cover text can remove exactly the seeded
      // title/subtitle without touching any boxes the user added themselves.
      subtitleBox.role = "book-subtitle";
      boxes.push(subtitleBox);
    }
    if (page.id === COVER_FRONT_ID && page.seedAuthor?.trim()) boxes.push(authorBox(design, page.seedAuthor, 3));
  } else if (!page.isCover) {
    // One box per text slot in the active layout's plan for this page.
    page.plan.slots
      .filter((slot) => slot.role === "text")
      .forEach((slot, i) => {
        const text = textForSlot(slot, page);
        if (!text.trim()) return;
        const box = makeTextBox({
          rect: slot.pageRect,
          text,
          family: design.defaultFontFamily,
          sizePct: design.defaultFontSizePct,
          presetId: slot.presetId ?? "plain",
          z: i + 1,
          slotId: slot.id,
          role: "story-body",
          align: slot.align,
          vAlign: slot.vAlign,
          name: slot.label,
          sharedStyle: sharedStyle(design, "story-body"),
        });
        boxes.push(hugTextInRect(box, slot.pageRect, page.aspect));
      });
  }
  const art = page.isCover
    ? null
    : insetIllustration(page.plan, 0);
  return {
    textBoxes: boxes,
    ...(page.id === COVER_FRONT_ID ? { letteringFor: page.blobId ?? "" } : {}),
    layoutId: page.plan.layoutId,
    compositionMode: page.plan.mode,
    ...(art ? { images: [art] } : {}),
    ...((page.plan.background ?? design.defaultPageBackground)
      ? { background: page.plan.background ?? { ...design.defaultPageBackground } }
      : {}),
  };
}

/**
 * Re-apply the active layout to an already-seeded page.
 *
 * Layout-owned boxes (those carrying a `slotId`) move to their slot's new
 * rectangle and pick up its styling; boxes the user added have no `slotId` and
 * are left exactly where they are. A slot with no box yet — because the layout
 * gained one — is seeded, and a box whose slot no longer exists is kept in
 * place rather than deleted, so nothing a reader wrote can silently vanish.
 */
export function relayoutPageDesign(
  design: BookDesign,
  page: DesignPage,
  pageDesign: PageDesign,
): PageDesign {
  if (page.isCover) return pageDesign;
  const slots = new Map(
    page.plan.slots.filter((s) => s.role === "text").map((s) => [s.id, s] as const),
  );
  const seen = new Set<string>();

  const textBoxes = pageDesign.textBoxes.map((box) => {
    if (!box.slotId) return box;
    const slot = slots.get(box.slotId);
    if (!slot) return box;
    seen.add(slot.id);
    const preset = getPreset(slot.presetId ?? box.presetId);
    const laidOut = {
      ...box,
      rect: slot.pageRect,
      presetId: slot.presetId ?? box.presetId,
      align: slot.align ?? box.align,
      vAlign: slot.vAlign ?? box.vAlign,
      color: preset.defaults.text,
      fill: preset.defaults.fill,
      stroke: preset.defaults.stroke,
      padding: preset.padding,
    };
    // Preserve fixed-height behavior after an explicit manual resize
    // (autoHeight === false). Generated and legacy untouched boxes hug content.
    const styled = design.sharedTextStyles?.["story-body"]
      ? withSharedTextStyle(laidOut, design.sharedTextStyles["story-body"])
      : laidOut;
    return box.autoHeight === false
      ? styled
      : hugTextInRect(styled, slot.pageRect, page.aspect);
  });

  let z = textBoxes.reduce((max, b) => Math.max(max, b.z), 0);
  for (const slot of slots.values()) {
    if (seen.has(slot.id)) continue;
    const text = textForSlot(slot, page);
    if (!text.trim()) continue;
    z += 1;
    const box = makeTextBox({
      rect: slot.pageRect,
      text,
      family: design.defaultFontFamily,
      sizePct: design.defaultFontSizePct,
      presetId: slot.presetId ?? "plain",
      z,
      slotId: slot.id,
      role: "story-body",
      align: slot.align,
      vAlign: slot.vAlign,
      name: slot.label,
      sharedStyle: sharedStyle(design, "story-body"),
    });
    textBoxes.push(hugTextInRect(box, slot.pageRect, page.aspect));
  }

  // The artwork's own placement is layout-owned too: inset art moves to the new
  // art rectangle and full-bleed expands the same durable element to the whole
  // surface. Keeping the element preserves non-destructive presentation such as
  // crop, focus and image shape across layout changes.
  const images = pageDesign.images ?? [];
  const existingArt = images.find((im) => im.kind === "illustration");
  const others = images.filter((im) => im.kind !== "illustration");
  let nextImages = images;
  if (page.plan.mode === "inset-art") {
    const art = existingArt
      ? { ...existingArt, rect: page.plan.artRect }
      : insetIllustration(page.plan, Math.min(0, ...images.map((im) => im.z)) - 1);
    nextImages = art ? [...others, art] : others;
  } else if (existingArt) {
    nextImages = [...others, { ...existingArt, rect: { x: 0, y: 0, w: 1, h: 1 } }];
  }

  // Built by omission rather than by assigning `undefined`: the design is
  // persisted as a Firestore blob, which rejects undefined values.
  const next: PageDesign = {
    ...pageDesign,
    textBoxes,
    layoutId: page.plan.layoutId,
    compositionMode: page.plan.mode,
  };
  if (nextImages.length > 0) next.images = nextImages;
  else delete next.images;
  return next;
}

/** Legacy default fonts that are replaced with "Itim" on migration. */
export const LEGACY_DEFAULT_FONTS = new Set([
  "Nunito",
  "Nunito Sans",
  "Lora",
  "Baloo 2",
  "Literata",
  "Georgia",
]);

export function migratePageDesignFonts(pageDesign: PageDesign): PageDesign {
  let changed = false;
  const textBoxes = pageDesign.textBoxes.map((box) => {
    const boxFontNeedsMigration = LEGACY_DEFAULT_FONTS.has(box.fontFamily) || !box.fontFamily;
    let boxChanged = false;
    const paragraphs = box.paragraphs.map((p) => {
      let paraChanged = false;
      const spans = p.spans.map((s) => {
        if (s.fontFamily && LEGACY_DEFAULT_FONTS.has(s.fontFamily)) {
          paraChanged = true;
          return { ...s, fontFamily: "Itim" };
        }
        return s;
      });
      if (paraChanged) {
        boxChanged = true;
        return { ...p, spans };
      }
      return p;
    });

    if (boxFontNeedsMigration) {
      boxChanged = true;
      changed = true;
      return {
        ...box,
        fontFamily: "Itim",
        paragraphs: boxChanged ? paragraphs : box.paragraphs,
      };
    }
    if (boxChanged) {
      changed = true;
      return { ...box, paragraphs };
    }
    return box;
  });

  const shapes = pageDesign.shapes?.map((shape) => {
    if (shape.text && (LEGACY_DEFAULT_FONTS.has(shape.text.fontFamily) || !shape.text.fontFamily)) {
      changed = true;
      return {
        ...shape,
        text: { ...shape.text, fontFamily: "Itim" },
      };
    }
    return shape;
  });

  if (!changed) return pageDesign;
  return {
    ...pageDesign,
    textBoxes,
    ...(shapes ? { shapes } : {}),
  };
}

export function migrateDesignToCurrentVersion(
  design: BookDesign,
  pages: DesignPage[],
): BookDesign {
  const needsFontMigration =
    LEGACY_DEFAULT_FONTS.has(design.defaultFontFamily) || !design.defaultFontFamily;

  const defaultFontFamily = needsFontMigration ? "Itim" : design.defaultFontFamily;
  const defaultTitleFontFamily =
    design.defaultTitleFontFamily && LEGACY_DEFAULT_FONTS.has(design.defaultTitleFontFamily)
      ? undefined
      : design.defaultTitleFontFamily;

  const sharedTextStyles = design.sharedTextStyles
    ? Object.fromEntries(
        Object.entries(design.sharedTextStyles).map(([key, style]) => [
          key,
          style && LEGACY_DEFAULT_FONTS.has(style.fontFamily)
            ? { ...style, fontFamily: "Itim" }
            : style,
        ]),
      )
    : undefined;

  const nextPages: Record<string, PageDesign> = {};
  for (const p of pages) {
    const current = design.pages[p.id];
    if (!current) continue;
    const fontMigrated = needsFontMigration ? migratePageDesignFonts(current) : current;
    nextPages[p.id] = migrateGeneratedTextBoxHeights(p, fontMigrated);
  }
  for (const [id, pd] of Object.entries(design.pages)) {
    if (!nextPages[id]) {
      nextPages[id] = needsFontMigration ? migratePageDesignFonts(pd) : pd;
    }
  }

  return {
    ...design,
    version: DESIGN_VERSION,
    defaultFontFamily,
    ...(defaultTitleFontFamily !== undefined ? { defaultTitleFontFamily } : {}),
    ...(sharedTextStyles ? { sharedTextStyles } : {}),
    pages: nextPages,
  };
}

/**
 * Upgrade layout-owned story boxes created before font-aware auto-height
 * measurement. An explicit `false` records a user's manual resize and is left
 * alone. Existing auto-height boxes keep their centre if the corrected
 * measurement makes them taller.
 */
export function migrateGeneratedTextBoxHeights(
  page: DesignPage,
  pageDesign: PageDesign,
): PageDesign {
  if (page.isCover) return pageDesign;
  const slots = new Map(
    page.plan.slots.filter((s) => s.role === "text").map((s) => [s.id, s] as const),
  );
  let changed = false;
  const textBoxes = pageDesign.textBoxes.map((box) => {
    if (box.role !== "story-body" || !box.slotId || box.autoHeight === false) {
      return box;
    }
    const slot = slots.get(box.slotId);
    if (!slot) return box;
    const oldCenterY = box.rect.y + box.rect.h / 2;
    const container = {
      x: box.rect.x,
      y: slot.pageRect.y,
      w: box.rect.w,
      h: slot.pageRect.h,
    };
    const fitted = hugTextInRect({ ...box, rect: container }, container, page.aspect);
    const y = Math.max(
      container.y,
      Math.min(container.y + container.h - fitted.rect.h, oldCenterY - fitted.rect.h / 2),
    );
    changed = true;
    return { ...fitted, rect: { ...fitted.rect, y } };
  });
  return changed ? { ...pageDesign, textBoxes } : pageDesign;
}

function insideRect(rect: NormRect, area: NormRect): boolean {
  const e = 1e-6;
  return (
    rect.x >= area.x - e &&
    rect.y >= area.y - e &&
    rect.x + rect.w <= area.x + area.w + e &&
    rect.y + rect.h <= area.y + area.h + e
  );
}

function clampInto(rect: NormRect, area: NormRect): NormRect {
  const w = Math.min(rect.w, area.w);
  const h = Math.min(rect.h, area.h);
  return {
    x: Math.min(Math.max(rect.x, area.x), area.x + area.w - w),
    y: Math.min(Math.max(rect.y, area.y), area.y + area.h - h),
    w,
    h,
  };
}

/**
 * Move text back inside the page's safe area. By default only boxes the app
 * placed (a `slotId`, never dragged by the reader): the app keeps them
 * printable when the trim, page count or gutter changes under them. The
 * reader's own placements move only when `all` is set — a fix they asked for.
 */
export function insetPageText(page: DesignPage, pageDesign: PageDesign, all = false): PageDesign {
  const safe = page.plan.safe;
  if (!safe || page.isCover) return pageDesign;
  let changed = false;
  const textBoxes = pageDesign.textBoxes.map((box) => {
    const appPlaced = Boolean(box.slotId) && !box.placedByReader;
    if ((!all && !appPlaced) || insideRect(box.rect, safe)) return box;
    changed = true;
    return { ...box, rect: clampInto(box.rect, safe) };
  });
  return changed ? { ...pageDesign, textBoxes } : pageDesign;
}

/** Pages with layout-owned text outside the safe area. */
export function pagesWithUnsafeText(design: BookDesign, pages: DesignPage[]): DesignPage[] {
  return pages.filter((page) => {
    const stored = design.pages[page.id];
    return stored ? insetPageText(page, stored) !== stored : false;
  });
}

/** Pages whose stored layout no longer matches the project's active one. */
export function pagesNeedingRelayout(design: BookDesign, pages: DesignPage[]): DesignPage[] {
  return pages.filter((page) => {
    const stored = design.pages[page.id];
    if (!stored || page.isCover) return false;
    // Pages seeded before layouts were switchable carry neither field; treat
    // them as already matching rather than re-flowing them unasked.
    const storedId = stored.layoutId ?? page.plan.layoutId;
    const storedMode = stored.compositionMode ?? page.plan.mode;
    return storedId !== page.plan.layoutId || storedMode !== page.plan.mode;
  });
}

/**
 * Whether a page's artwork was generated for a different layout than the one
 * now in force — the prompt depends on the layout, so a full-bleed image sitting
 * under an inset-art layout is stale even though it exists.
 */
export function illustrationMatchesLayout(project: Project, page: DesignPage): boolean {
  const tree = project.illustrations?.[page.id];
  if (!tree) return true;
  const render = getCursor(tree).content as { layoutId?: string; compositionMode?: string };
  if (!render.layoutId) return true;
  const layout = getBookLayout(project.config.layoutId);
  return render.layoutId === layout.id && render.compositionMode === page.plan.mode;
}

export { uid as newTextBoxId };
export { uid as newImageId };
