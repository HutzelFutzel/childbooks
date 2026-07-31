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
  type TextBox,
} from "../../core/types";
import { wordParagraphs } from "../../core/design";
import { defaultFontForAge } from "../typography/fonts";
import { getPreset } from "./presets";

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
  layoutNote: string;
  isCover: boolean;
  /** Cover-only: the title/subtitle are baked into the art, so no overlay boxes. */
  bakeText?: boolean;
  /** Physical side this page sits on (drives the outer-edge text column). */
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

export function buildDesignPages(project: Project): DesignPage[] {
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

  if (doc?.frontCover) {
    // The project title is the single source of truth for the front-cover title.
    pages.push(
      coverPage(project, COVER_FRONT_ID, "Front cover", aspect, {
        ...doc.frontCover,
        title: project.title,
      }),
    );
  }
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
        plan: planPageLayout(project, { side, textLength: s.text.length }),
      });
    });
  }
  if (doc?.backCover) {
    pages.push(coverPage(project, COVER_BACK_ID, "Back cover", aspect, doc.backCover));
  }
  return pages;
}

function coverPage(
  project: Project,
  id: string,
  label: string,
  aspect: number,
  spec: CoverSpec,
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
    plan: planPageLayout(project, { side, isCover: true }),
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

export function defaultDesign(project: Project): BookDesign {
  const { family, sizePct } = defaultFontForAge(project.config.ageRangeId);
  return {
    version: DESIGN_VERSION,
    defaultFontFamily: family,
    defaultFontSizePct: sizePct,
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
  align?: TextBox["align"];
  vAlign?: TextBox["vAlign"];
  name?: string;
}): TextBox {
  const preset = getPreset(input.presetId);
  return {
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
    ...(input.name ? { name: input.name } : {}),
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
        family: design.defaultFontFamily,
        sizePct: Math.min(0.13, design.defaultFontSizePct * 1.7),
        presetId: "shadowed",
        z: 1,
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
      });
      // Tagged so toggling baked cover text can remove exactly the seeded
      // title/subtitle without touching any boxes the user added themselves.
      subtitleBox.role = "book-subtitle";
      boxes.push(subtitleBox);
    }
  } else if (!page.isCover) {
    // One box per text slot in the active layout's plan for this page.
    page.plan.slots
      .filter((slot) => slot.role === "text")
      .forEach((slot, i) => {
        const text = textForSlot(slot, page);
        if (!text.trim()) return;
        boxes.push(
          makeTextBox({
            rect: slot.pageRect,
            text,
            family: design.defaultFontFamily,
            sizePct: design.defaultFontSizePct,
            presetId: slot.presetId ?? "plain",
            z: i + 1,
            slotId: slot.id,
            align: slot.align,
            vAlign: slot.vAlign,
            name: slot.label,
          }),
        );
      });
  }
  const art = page.isCover ? null : insetIllustration(page.plan, 0);
  return {
    textBoxes: boxes,
    layoutId: page.plan.layoutId,
    compositionMode: page.plan.mode,
    ...(art ? { images: [art] } : {}),
    ...(page.plan.background ? { background: page.plan.background } : {}),
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
    return {
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
  });

  let z = textBoxes.reduce((max, b) => Math.max(max, b.z), 0);
  for (const slot of slots.values()) {
    if (seen.has(slot.id)) continue;
    const text = textForSlot(slot, page);
    if (!text.trim()) continue;
    z += 1;
    textBoxes.push(
      makeTextBox({
        rect: slot.pageRect,
        text,
        family: design.defaultFontFamily,
        sizePct: design.defaultFontSizePct,
        presetId: slot.presetId ?? "plain",
        z,
        slotId: slot.id,
        align: slot.align,
        vAlign: slot.vAlign,
        name: slot.label,
      }),
    );
  }

  // The artwork's own placement is layout-owned too: inset art moves to the new
  // art rectangle, and switching back to full-bleed drops the placed element so
  // the page surface draws the illustration edge to edge again. A crop the user
  // adjusted themselves (zoom/focus) is carried over rather than reset.
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
    nextImages = others;
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
