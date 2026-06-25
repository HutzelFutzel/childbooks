/**
 * Builds the list of designable pages from a project and seeds default text
 * boxes/typography for the Final Design editor.
 */
import { bookProductForConfig } from "../../core/book";
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
  const pages: DesignPage[] = [];

  if (doc?.frontCover) {
    pages.push(coverPage(project, COVER_FRONT_ID, "Front cover", aspect, doc.frontCover));
  }
  if (doc) {
    doc.spreads.forEach((s, i) => {
      if (s.placeholder) return;
      pages.push({
        id: s.id,
        label: `Page ${i + 1}`,
        aspect: s.kind === "spread" ? aspect * 2 : aspect,
        blobId: blobFor(project, s.id),
        seedText: s.text,
        layoutNote: s.layoutNote,
        isCover: false,
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
  };
}

/** Region heuristic from a layout note (where to place the text block). */
function seedRect(layoutNote: string, isCover: boolean): NormRect {
  if (isCover) return { x: 0.1, y: 0.06, w: 0.8, h: 0.24 };
  const n = layoutNote.toLowerCase();
  if (n.includes("left")) return { x: 0.06, y: 0.12, w: 0.4, h: 0.76 };
  if (n.includes("right")) return { x: 0.54, y: 0.12, w: 0.4, h: 0.76 };
  if (n.includes("top")) return { x: 0.08, y: 0.06, w: 0.84, h: 0.24 };
  return { x: 0.08, y: 0.66, w: 0.84, h: 0.28 }; // default bottom band
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
  if (page.isCover) {
    if (page.seedTitle) {
      boxes.push(
        makeTextBox(
          { x: 0.1, y: 0.08, w: 0.8, h: 0.2 },
          page.seedTitle,
          design.defaultFontFamily,
          Math.min(0.13, design.defaultFontSizePct * 1.7),
          "shadowed",
          1,
        ),
      );
    }
    if (page.seedSubtitle) {
      boxes.push(
        makeTextBox(
          { x: 0.15, y: 0.3, w: 0.7, h: 0.12 },
          page.seedSubtitle,
          design.defaultFontFamily,
          design.defaultFontSizePct,
          "shadowed",
          2,
        ),
      );
    }
  } else if (page.seedText.trim()) {
    boxes.push(
      makeTextBox(
        seedRect(page.layoutNote, false),
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
