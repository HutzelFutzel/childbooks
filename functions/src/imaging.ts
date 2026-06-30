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
