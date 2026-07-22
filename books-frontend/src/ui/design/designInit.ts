/**
 * Builds the list of designable pages from a project and seeds default text
 * boxes/typography for the Final Design editor.
 */
import { bookProductForConfig } from "../../core/book";
import { getBookLayout, type PageSide } from "../../core/book/layouts";
import { paginate } from "../../core/pipeline/pagination";
import { getCursor } from "../../core/versioning";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  type BookDesign,
  type CoverSpec,
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
  /** The active layout's text-column rectangle for this page's side. */
  textRect: NormRect;
}

function uid(): string {
  return `tb_${Math.random().toString(36).slice(2, 10)}`;
}

function blobFor(project: Project, id: string): string | undefined {
  const tree = project.illustrations?.[id];
  return tree ? getCursor(tree).content.blobId : undefined;
}

/** All pages that can be designed, in reading order (covers + content pages). */
export function buildDesignPages(project: Project): DesignPage[] {
  const aspect = bookProductForConfig(project.config).aspect;
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const layout = getBookLayout(project.config.layoutId);
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
    doc.spreads.forEach((s, i) => {
      if (s.placeholder) return;
      const side = sideOf(s);
      pages.push({
        id: s.id,
        label: `Page ${i + 1}`,
        aspect: s.kind === "spread" ? aspect * 2 : aspect,
        blobId: blobFor(project, s.id),
        seedText: s.text,
        layoutNote: s.layoutNote,
        isCover: false,
        outerSide: side,
        textRect: layout.textRegion(side),
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
    textRect: getBookLayout(project.config.layoutId).textRegion(side),
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
  return { defaultFontFamily: family, defaultFontSizePct: sizePct, pages: {} };
}

function makeTextBox(
  rect: NormRect,
  text: string,
  family: string,
  sizePct: number,
  presetId: string,
  z: number,
): TextBox {
  const preset = getPreset(presetId);
  return {
    id: uid(),
    rect,
    z,
    presetId,
    fontFamily: family,
    fontSizePct: sizePct,
    color: preset.defaults.text,
    align: "center",
    vAlign: "center",
    lineHeight: 1.25,
    paragraphs: wordParagraphs(text),
    fill: preset.defaults.fill,
    stroke: preset.defaults.stroke,
    padding: preset.padding,
    autoFit: true,
  };
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
      const titleBox = makeTextBox(
        { x: 0.1, y: 0.08, w: 0.8, h: 0.2 },
        page.seedTitle,
        design.defaultFontFamily,
        Math.min(0.13, design.defaultFontSizePct * 1.7),
        "shadowed",
        1,
      );
      // Front-cover title stays linked to the project / story title.
      if (page.id === COVER_FRONT_ID) titleBox.role = "book-title";
      boxes.push(titleBox);
    }
    if (page.seedSubtitle) {
      const subtitleBox = makeTextBox(
        { x: 0.15, y: 0.3, w: 0.7, h: 0.12 },
        page.seedSubtitle,
        design.defaultFontFamily,
        design.defaultFontSizePct,
        "shadowed",
        2,
      );
      // Tagged so toggling baked cover text can remove exactly the seeded
      // title/subtitle without touching any boxes the user added themselves.
      subtitleBox.role = "book-subtitle";
      boxes.push(subtitleBox);
    }
  } else if (page.seedText.trim()) {
    // Seed the text column on the page's outer edge per the active layout.
    boxes.push(
      makeTextBox(
        page.textRect,
        page.seedText,
        design.defaultFontFamily,
        design.defaultFontSizePct,
        "card",
        1,
      ),
    );
  }
  return { textBoxes: boxes };
}

export { uid as newTextBoxId };
export { uid as newImageId };
