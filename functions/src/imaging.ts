/**
 * Server-side image compositing with `sharp` — the Node equivalent of the
 * browser-canvas operations in books-frontend `state/compositing.ts`.
 *
 * Mask convention (shared with OpenAI's edits endpoint): a PNG that is OPAQUE
 * everywhere it must stay unchanged and TRANSPARENT (alpha < 128) over the
 * region that may be repainted ("the hole").
 */
import sharp from "sharp";

async function rawRGBA(
  buf: Buffer,
  width?: number,
  height?: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  let pipeline = sharp(buf);
  if (width && height) pipeline = pipeline.resize(width, height, { fit: "fill" });
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Shrink a reference exemplar (e.g. the art-style image) that is sent on EVERY
 * generation. Resizes so the longest side is at most `maxDim` and re-encodes as
 * JPEG — a multi-megabyte lossless source otherwise inflates every request
 * (client→proxy→provider) and dominates latency. A style reference doesn't need
 * alpha or pixel-exactness, so JPEG at moderate quality cuts size ~10x. Returns
 * the original bytes (as-is) when it can't be processed.
 */
export async function downscaleReference(
  buf: Buffer,
  maxDim = 1024,
  quality = 80,
): Promise<{ buf: Buffer; mimeType: string } | null> {
  try {
    const out = await sharp(buf)
      .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { buf: out, mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}

/**
 * Force a reference sheet's background to pure white.
 *
 * The prompt asks for "plain pure-white seamless background", but a prompt is a
 * request, not a guarantee — and it actively conflicts with the art-style
 * reference, which tells the model to match the exemplar's "texture and
 * finish". A watercolour style reference reliably bleeds cream paper grain into
 * the background. Since thumbnail crops and the height lineup are built on the
 * assumption of white, we make it true instead of asking for it.
 *
 * Flood fills inward from the image border rather than thresholding globally:
 * a global "light pixels are background" rule shreds a character wearing a
 * white dress into disconnected fragments, because it cannot tell the dress
 * from the paper. Only background reachable from the edge is cleared.
 *
 * Returns the original bytes unchanged on any failure — a slightly grey sheet
 * is much better than a failed render.
 */
export async function flattenSheetBackground(
  buf: Buffer,
  opts: { tolerance?: number } = {},
): Promise<Buffer> {
  // Distance from pure white (per channel) still considered background. Loose
  // enough for JPEG ringing and faint paper texture, tight enough to leave
  // shaded white clothing alone.
  const tolerance = opts.tolerance ?? 26;
  try {
    const { data, width: w, height: h } = await rawRGBA(buf);
    const isLight = (i: number) =>
      data[i] >= 255 - tolerance &&
      data[i + 1] >= 255 - tolerance &&
      data[i + 2] >= 255 - tolerance;

    // Iterative flood fill (an explicit stack, not recursion — a 1536x1024
    // background is ~1.5M pixels and would blow the call stack).
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    const push = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = y * w + x;
      if (seen[p]) return;
      seen[p] = 1;
      if (isLight(p * 4)) stack.push(p);
    };
    for (let x = 0; x < w; x++) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      push(0, y);
      push(w - 1, y);
    }
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      const i = p * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
    return await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toBuffer();
  } catch {
    return buf;
  }
}

/**
 * Crop one cell of a reference sheet down to a square thumbnail.
 *
 * A crop rather than a generated portrait: a model asked to "make a thumbnail
 * of this character" produces a NEW image, so the thumbnail would show someone
 * subtly different from the reference it stands for — which defeats its only
 * purpose. Cropping is pixel-identical by construction, costs no Sparks and
 * adds no latency.
 *
 * `box` is the cell's normalized rectangle. The crop is tightened to the ink
 * inside that cell (the drawn subject rarely fills its cell), then squared off
 * around the subject's centre so faces don't end up against an edge.
 */
export async function cropSheetThumbnail(
  buf: Buffer,
  box: { x: number; y: number; width: number; height: number },
  opts: { size?: number; tolerance?: number } = {},
): Promise<{ buf: Buffer; mimeType: string } | null> {
  const out = opts.size ?? 256;
  const tolerance = opts.tolerance ?? 26;
  try {
    const meta = await sharp(buf).metadata();
    const iw = meta.width ?? 0;
    const ih = meta.height ?? 0;
    if (!iw || !ih) return null;

    const cellLeft = Math.max(0, Math.round(box.x * iw));
    const cellTop = Math.max(0, Math.round(box.y * ih));
    const cellW = Math.min(iw - cellLeft, Math.round(box.width * iw));
    const cellH = Math.min(ih - cellTop, Math.round(box.height * ih));
    if (cellW < 8 || cellH < 8) return null;

    const cell = await sharp(buf)
      .extract({ left: cellLeft, top: cellTop, width: cellW, height: cellH })
      .toBuffer();

    // Tighten to the drawn content within the cell.
    const { data } = await rawRGBA(cell, cellW, cellH);
    let minX = cellW;
    let minY = cellH;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const i = (y * cellW + x) * 4;
        const light =
          data[i] >= 255 - tolerance &&
          data[i + 1] >= 255 - tolerance &&
          data[i + 2] >= 255 - tolerance;
        if (light || data[i + 3] < 8) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    // Empty cell (the model left it blank) — nothing worth showing.
    if (maxX < 0 || maxY < 0) return null;

    const inkW = maxX - minX + 1;
    const inkH = maxY - minY + 1;
    const cx = minX + inkW / 2;
    const cy = minY + inkH / 2;
    const side = Math.min(cellW, cellH, Math.round(Math.max(inkW, inkH) * 1.18));
    const left = Math.max(0, Math.min(cellW - side, Math.round(cx - side / 2)));
    const top = Math.max(0, Math.min(cellH - side, Math.round(cy - side / 2)));

    const thumb = await sharp(cell)
      .extract({ left, top, width: side, height: side })
      .resize(out, out, { fit: "cover", kernel: "lanczos3" })
      .flatten({ background: "#ffffff" })
      .webp({ quality: 82 })
      .toBuffer();
    return { buf: thumb, mimeType: "image/webp" };
  } catch {
    return null;
  }
}

/**
 * Build a single "size chart": the given characters standing side by side on a
 * common ground line, each drawn at their true height relative to the tallest.
 *
 * This is how relative size gets communicated to the illustration model. The
 * alternatives are both worse. Words alone ("she comes up to his chest") are
 * routinely ignored because the reference sheets say otherwise — every sheet is
 * generated filling its own canvas, so a toddler's reference is exactly as big
 * as an adult's. Shrinking each character's own sheet to fix that would destroy
 * the thing the sheet is for: at 40% of a six-cell grid there aren't enough
 * pixels left to carry a face. One extra composite image costs one reference
 * slot and leaves every likeness sheet at full fidelity.
 *
 * Each entry contributes one cell of its sheet (the whole-body view), trimmed
 * to its ink so the figure's drawn height — not the empty space around it —
 * is what gets scaled.
 *
 * Returns null when fewer than two figures survive, since a chart of one
 * subject compares nothing.
 */
export async function buildScaleChart(
  entries: {
    buf: Buffer;
    /** Normalized cell rectangle of the whole-body view within the sheet. */
    box: { x: number; y: number; width: number; height: number };
    /** Height relative to the tallest character in the set (0..1]. */
    heightFraction: number;
  }[],
  opts: { height?: number; gap?: number; tolerance?: number } = {},
): Promise<Buffer | null> {
  const canvasH = opts.height ?? 768;
  const gap = opts.gap ?? 32;
  const tolerance = opts.tolerance ?? 26;
  try {
    const figures: { buf: Buffer; width: number; height: number }[] = [];
    for (const entry of entries) {
      const meta = await sharp(entry.buf).metadata();
      const iw = meta.width ?? 0;
      const ih = meta.height ?? 0;
      if (!iw || !ih) continue;

      const left = Math.max(0, Math.round(entry.box.x * iw));
      const top = Math.max(0, Math.round(entry.box.y * ih));
      const cw = Math.min(iw - left, Math.round(entry.box.width * iw));
      const ch = Math.min(ih - top, Math.round(entry.box.height * ih));
      if (cw < 8 || ch < 8) continue;

      // Trim the white margin around the figure, so the scaling applies to the
      // character's own height rather than to how much of its cell it happened
      // to fill.
      const cell = await sharp(entry.buf)
        .extract({ left, top, width: cw, height: ch })
        .trim({ threshold: tolerance })
        .toBuffer();

      const trimmed = await sharp(cell).metadata();
      const tw = trimmed.width ?? 0;
      const th = trimmed.height ?? 0;
      if (!tw || !th) continue;

      const targetH = Math.max(
        16,
        Math.round(canvasH * Math.max(0.08, Math.min(1, entry.heightFraction))),
      );
      const targetW = Math.max(8, Math.round((tw / th) * targetH));
      figures.push({
        buf: await sharp(cell)
          .resize(targetW, targetH, { fit: "fill", kernel: "lanczos3" })
          .toBuffer(),
        width: targetW,
        height: targetH,
      });
    }
    if (figures.length < 2) return null;

    const canvasW =
      figures.reduce((sum, f) => sum + f.width, 0) + gap * (figures.length + 1);
    let x = gap;
    const layers = figures.map((f) => {
      const layer = { input: f.buf, left: x, top: canvasH - f.height };
      x += f.width + gap;
      return layer;
    });

    return await sharp({
      create: {
        width: canvasW,
        height: canvasH,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(layers)
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Paste `edited` over `original` only where `mask` is painted (transparent),
 * keeping every other pixel byte-identical to the original. Returns a PNG.
 */
export async function compositeMaskedRegion(args: {
  original: Buffer;
  edited: Buffer;
  mask: Buffer;
}): Promise<Buffer> {
  const base = await rawRGBA(args.original);
  const { width: w, height: h } = base;
  const edited = await rawRGBA(args.edited, w, h);
  const mask = await rawRGBA(args.mask, w, h);

  const out = Buffer.from(base.data); // copy of the original
  for (let i = 0; i < out.length; i += 4) {
    const painted = mask.data[i + 3] < 128; // transparent mask pixel = hole
    if (painted) {
      out[i] = edited.data[i];
      out[i + 1] = edited.data[i + 1];
      out[i + 2] = edited.data[i + 2];
      out[i + 3] = edited.data[i + 3];
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * Build an inpainting mask sized to `page`: opaque everywhere except a
 * transparent hole over the (padded) normalized box. Returns a PNG.
 */
export async function buildHoleMask(args: {
  page: Buffer;
  box: { x: number; y: number; width: number; height: number };
  paddingFrac?: number;
}): Promise<Buffer> {
  const meta = await sharp(args.page).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1024;

  const pad = args.paddingFrac ?? 0.12;
  let bx = Math.round((args.box.x - args.box.width * pad) * w);
  let by = Math.round((args.box.y - args.box.height * pad) * h);
  let bw = Math.round(args.box.width * (1 + 2 * pad) * w);
  let bh = Math.round(args.box.height * (1 + 2 * pad) * h);
  bx = Math.max(0, bx);
  by = Math.max(0, by);
  bw = Math.min(w - bx, bw);
  bh = Math.min(h - by, bh);

  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255; // opaque everywhere by default
  }
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      data[(y * w + x) * 4 + 3] = 0; // punch transparent hole
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * Build a "continue this cover" outpaint seed: crops a strip from the FRONT
 * cover's LEFT edge (the edge that touches the spine — see the standard
 * back-spine-front unfolded wrap layout) and pastes it flush against the
 * RIGHT edge (the back cover's own spine-adjacent edge) of a blank
 * `width`x`height` canvas. Everything else is filler — its exact pixels don't
 * matter, since the mask marks that area for full regeneration.
 *
 * Returns the seed canvas and a matching mask: opaque (protected) over the
 * pasted strip, transparent (the "hole" to fill) everywhere else. Fed to an
 * edit/outpaint call, this makes the seam genuinely pixel-continuous — the
 * model is extending real front-cover pixels, not imagining a similar-looking
 * new picture from a loose reference.
 */
export async function buildCoverContinuationSeed(args: {
  front: Buffer;
  width: number;
  height: number;
  /** Fraction of the canvas width the seeded strip occupies. */
  seamFrac?: number;
}): Promise<{ seed: Buffer; mask: Buffer }> {
  const seamFrac = args.seamFrac ?? 0.22;
  const seamWidthPx = Math.max(1, Math.min(args.width - 1, Math.round(args.width * seamFrac)));

  // Match the front to the back's own canvas size first (front/back are
  // always rendered at the same trim size, but this guards against any
  // drift), then take its LEFT edge — the side that touches the spine.
  const resizedFront = await sharp(args.front)
    .resize(args.width, args.height, { fit: "cover" })
    .toBuffer();
  const strip = await sharp(resizedFront)
    .extract({ left: 0, top: 0, width: seamWidthPx, height: args.height })
    .toBuffer();

  const seed = await sharp({
    create: {
      width: args.width,
      height: args.height,
      channels: 4,
      // Neutral filler — never seen in the final image, since the mask marks
      // this whole area as a hole for the model to repaint.
      background: { r: 128, g: 128, b: 128, alpha: 1 },
    },
  })
    .composite([{ input: strip, left: args.width - seamWidthPx, top: 0 }])
    .png()
    .toBuffer();

  const maskData = Buffer.alloc(args.width * args.height * 4);
  for (let y = 0; y < args.height; y++) {
    for (let x = 0; x < args.width; x++) {
      const i = (y * args.width + x) * 4;
      const protectedStrip = x >= args.width - seamWidthPx;
      maskData[i] = 0;
      maskData[i + 1] = 0;
      maskData[i + 2] = 0;
      maskData[i + 3] = protectedStrip ? 255 : 0; // opaque = keep, transparent = hole
    }
  }
  const mask = await sharp(maskData, { raw: { width: args.width, height: args.height, channels: 4 } })
    .png()
    .toBuffer();

  return { seed, mask };
}
