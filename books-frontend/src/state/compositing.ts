/**
 * Client-side mask compositing. After a masked (inpainting) edit, we paste the
 * model's output back over the ORIGINAL image only inside the painted region,
 * guaranteeing every pixel outside the mask is byte-for-byte identical — a
 * stronger promise than any provider gives on its own.
 */

interface CompositeInput {
  /** The image the edit was based on (the previous page version). */
  originalBase64: string;
  originalMime: string;
  /** The model's edited output. */
  editedBase64: string;
  editedMime: string;
  /** The brush mask PNG: painted area = transparent (the region that changed). */
  maskBase64: string;
}

function loadImage(base64: string, mime: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:${mime};base64,${base64}`;
  });
}

/**
 * Returns a PNG where the edited pixels appear only where the mask was painted
 * (transparent) and the original pixels are kept everywhere else.
 */
export async function compositeMaskedRegion(
  input: CompositeInput,
): Promise<{ base64: string; mimeType: string }> {
  const [original, edited, mask] = await Promise.all([
    loadImage(input.originalBase64, input.originalMime),
    loadImage(input.editedBase64, input.editedMime),
    loadImage(input.maskBase64, "image/png"),
  ]);

  const w = original.naturalWidth || 1024;
  const h = original.naturalHeight || 1024;

  const make = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    return { c, ctx };
  };

  // Base: the untouched original.
  const base = make();
  base.ctx.drawImage(original, 0, 0, w, h);

  // Edited output, scaled to the original's dimensions.
  const layer = make();
  layer.ctx.drawImage(edited, 0, 0, w, h);

  // Read the mask (scaled) to know which pixels were painted (alpha ~ 0).
  const maskCanvas = make();
  maskCanvas.ctx.drawImage(mask, 0, 0, w, h);
  const maskData = maskCanvas.ctx.getImageData(0, 0, w, h);

  // Zero-out the edited layer's alpha everywhere the mask is opaque (unpainted),
  // so only the painted region of the edited image remains.
  const layerData = layer.ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < maskData.data.length; i += 4) {
    const painted = maskData.data[i + 3] < 128; // transparent mask pixel = hole
    if (!painted) layerData.data[i + 3] = 0;
  }
  layer.ctx.putImageData(layerData, 0, 0);

  // Composite: original everywhere, edited only inside the painted region.
  base.ctx.drawImage(layer.c, 0, 0);

  const dataUrl = base.c.toDataURL("image/png");
  return { base64: dataUrl.split(",")[1] ?? "", mimeType: "image/png" };
}

interface BoxMaskInput {
  /** The page the mask will be applied to (sets the mask's dimensions). */
  pageBase64: string;
  pageMime: string;
  /** Normalized (0..1, top-left origin) region to regenerate. */
  box: { x: number; y: number; width: number; height: number };
  /** Fraction of the box size to pad on each side for context (default 0.12). */
  paddingFrac?: number;
}

/**
 * Build an inpainting mask PNG sized to the page: opaque everywhere except a
 * transparent "hole" over the (padded) box — the region to regenerate. The same
 * convention is understood by OpenAI's edits endpoint and by
 * compositeMaskedRegion above (transparent = the area that may change).
 */
export async function buildHoleMask(
  input: BoxMaskInput,
): Promise<{ base64: string; mimeType: string }> {
  const page = await loadImage(input.pageBase64, input.pageMime);
  const w = page.naturalWidth || 1024;
  const h = page.naturalHeight || 1024;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Opaque everywhere (the parts that must stay identical).
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.fillRect(0, 0, w, h);

  const pad = input.paddingFrac ?? 0.12;
  let bx = (input.box.x - input.box.width * pad) * w;
  let by = (input.box.y - input.box.height * pad) * h;
  let bw = input.box.width * (1 + 2 * pad) * w;
  let bh = input.box.height * (1 + 2 * pad) * h;
  bx = Math.max(0, bx);
  by = Math.max(0, by);
  bw = Math.min(w - bx, bw);
  bh = Math.min(h - by, bh);

  // Punch a transparent hole = the region the model may repaint.
  ctx.clearRect(bx, by, bw, bh);

  const dataUrl = canvas.toDataURL("image/png");
  return { base64: dataUrl.split(",")[1] ?? "", mimeType: "image/png" };
}
