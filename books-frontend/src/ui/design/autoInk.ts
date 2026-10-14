/**
 * Apply the ink measured from a page's artwork to the text laid over it.
 *
 * The measurement happens once, where the picture is rendered
 * (`IllustrationImage.textInk`, one reading per layout text slot). This module
 * only decides which boxes may take it: layout-owned story text whose color the
 * reader has not chosen. Pure.
 */
import type { IllustrationImage, PageDesign, TextBox } from "../../core/types";
import type { InkChoice } from "../../core/book/regionAnalysis";
import { DARK_INK } from "../../core/book/regionAnalysis";
import { getPreset } from "./presets";

/** Plate laid under words the picture can't carry on its own (the calm treatment's scrim). */
const LIGHT_PLATE = "rgba(255,255,255,0.78)";

/** Whether new artwork may re-ink this box. */
export function boxTakesAutoInk(box: TextBox): boolean {
  if (box.colorSource === "user") return false;
  if (box.colorSource === "auto") return true;
  // Older boxes carry no flag: only those still wearing their preset's color.
  return box.color.toLowerCase() === getPreset(box.presetId).defaults.text.toLowerCase();
}

function halo(ink: InkChoice): NonNullable<TextBox["effects"]>["shadow"] {
  return {
    color: ink.tone === "dark" ? "#ffffff" : "#000000",
    blur: 0.008,
    offsetX: 0,
    offsetY: 0,
    opacity: ink.tone === "dark" ? 0.85 : 0.6,
    target: "text",
  };
}

function inked(box: TextBox, ink: InkChoice, plate: boolean, slotPresetId: string): TextBox {
  const { shadow: _drop, ...effects } = box.effects ?? {};
  void _drop;
  const base: TextBox = {
    ...box,
    colorSource: "auto",
    paragraphs: box.paragraphs.map((p) => ({
      ...p,
      spans: p.spans.map(({ color: _c, ...span }) => {
        void _c;
        return span;
      }),
    })),
  };
  if (plate) {
    const solid = getPreset("solid");
    return {
      ...base,
      color: DARK_INK,
      presetId: solid.id,
      fill: LIGHT_PLATE,
      stroke: solid.defaults.stroke,
      padding: solid.padding,
      ...(Object.keys(effects).length > 0 ? { effects } : { effects: undefined }),
    };
  }
  // A plate this module added for earlier artwork comes off again.
  const hadAutoPlate = box.presetId === "solid" && box.fill === LIGHT_PLATE;
  const preset = getPreset(hadAutoPlate ? slotPresetId : box.presetId);
  return {
    ...base,
    color: ink.color,
    ...(hadAutoPlate
      ? {
          presetId: preset.id,
          fill: preset.defaults.fill,
          stroke: preset.defaults.stroke,
          padding: preset.padding,
        }
      : {}),
    effects: ink.treatment === "shadow" ? { ...effects, shadow: halo(ink) } : effects,
  };
}

/**
 * Re-ink a page for its current artwork, once per artwork (`inkFor`). Returns
 * the page unchanged when nothing applies.
 */
export function applyMeasuredInk(
  pageDesign: PageDesign,
  art: Pick<IllustrationImage, "blobId" | "textInk" | "layoutCheck"> | undefined,
  /** Each layout slot's own preset, restored when an automatic plate comes off. */
  slotPresets: Record<string, string | undefined> = {},
): PageDesign {
  if (!art?.blobId || !art.textInk || pageDesign.inkFor === art.blobId) return pageDesign;
  const readings = art.textInk;
  const scrimAll = art.layoutCheck?.fallback === "scrim";
  let changed = false;
  const textBoxes = pageDesign.textBoxes.map((box) => {
    const ink = box.slotId ? readings[box.slotId] : undefined;
    if (!ink || box.role !== "story-body" || box.hidden || !boxTakesAutoInk(box)) return box;
    changed = true;
    const plate = scrimAll || ink.treatment === "scrim";
    return withoutUndefined(inked(box, ink, plate, slotPresets[box.slotId!] ?? "plain"));
  });
  return { ...pageDesign, ...(changed ? { textBoxes } : {}), inkFor: art.blobId };
}

/** The design is stored as a Firestore blob, which rejects undefined values. */
function withoutUndefined(box: TextBox): TextBox {
  const out = { ...box } as Record<string, unknown>;
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as unknown as TextBox;
}
