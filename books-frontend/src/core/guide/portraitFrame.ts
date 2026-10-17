/**
 * The shape of a portrait: one canvas the worker draws on and the cast sheet
 * shows, so a preview is never a crop of what was generated. The portrait is a
 * head-and-upper-body preview; the full body is drawn later, in the hidden
 * reference-sheet step.
 */
export const PORTRAIT_SIZE = "1024x1536";

const [width, height] = PORTRAIT_SIZE.split("x").map(Number) as [number, number];

/** Width over height, for CSS `aspect-ratio`. */
export const PORTRAIT_ASPECT = width / height;
