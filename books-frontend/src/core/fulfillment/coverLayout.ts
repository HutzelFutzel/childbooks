/**
 * Pure geometry for a wraparound book cover.
 *
 * Lulu (and most POD providers) take a SINGLE cover PDF laid out as
 * `[back panel][spine][front panel]` on one canvas whose total size — including
 * bleed and the spine width (which grows with page count) — is returned by the
 * provider's cover-dimensions endpoint. This helper turns that physical size
 * (mm) into pixel panel rectangles at a chosen DPI, so the renderer just draws
 * the captured front/back rasters into `back`/`front` and fills `spine`.
 */
const MM_PER_IN = 25.4;

export interface CoverLayoutInput {
  coverWidthMm: number;
  coverHeightMm: number;
  /** Single-page trim, inches. */
  trimWidthIn: number;
  bleedIn: number;
  /** Pixels per inch for the rasterized cover. */
  dpi: number;
}

export interface CoverPanel {
  xPx: number;
  widthPx: number;
}

export interface CoverLayout {
  widthPx: number;
  heightPx: number;
  widthIn: number;
  heightIn: number;
  /** Left panel (back cover), includes the outer bleed. */
  back: CoverPanel;
  /** Right panel (front cover), includes the outer bleed. */
  front: CoverPanel;
  /** Center band between the panels (book spine). */
  spine: CoverPanel;
}

export function computeCoverLayout(i: CoverLayoutInput): CoverLayout {
  const widthIn = i.coverWidthMm / MM_PER_IN;
  const heightIn = i.coverHeightMm / MM_PER_IN;
  const widthPx = Math.round(widthIn * i.dpi);
  const heightPx = Math.round(heightIn * i.dpi);

  // Each outer panel spans one trim width plus the outer bleed edge.
  const panelPx = Math.round((i.trimWidthIn + i.bleedIn) * i.dpi);
  const back: CoverPanel = { xPx: 0, widthPx: panelPx };
  const front: CoverPanel = { xPx: widthPx - panelPx, widthPx: panelPx };
  const spineX = back.widthPx;
  const spine: CoverPanel = { xPx: spineX, widthPx: Math.max(0, front.xPx - spineX) };

  return { widthPx, heightPx, widthIn, heightIn, back, front, spine };
}
