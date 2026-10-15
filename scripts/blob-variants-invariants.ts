/**
 * Invariants for the small display copies of stored pictures.
 *
 * What would hurt a parent or the bill:
 *
 * - A copy is never mistaken for a picture: its name can't be any blob id, so
 *   the original is never shadowed, deleted or served in its place.
 * - A copy keeps the picture's shape (so a page is framed the same on screen as
 *   in print), is never larger than asked, never enlarges a small picture, and
 *   keeps transparency (cut-outs stay cut out).
 * - The copies are far smaller than a lossless original, or none of this pays.
 *
 * Offline and deterministic: sharp over synthesized pictures, no Storage.
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  BLOB_ID_PATTERN,
  BLOB_VARIANTS,
  BLOB_VARIANT_MIME,
  BLOB_VARIANT_SPECS,
  blobObjectName,
} from "../books-frontend/src/core/storage/blobVariants";
import { styleAssetBlobId } from "../books-frontend/src/core/config/customArtStyles";
import { encodeBlobVariant } from "../functions/src/storage";

// --- Names -------------------------------------------------------------------

const uuid = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
assert.equal(blobObjectName(uuid, "master"), uuid, "The original is stored under its own id.");
assert.equal(blobObjectName(uuid, "web"), `${uuid}.web`);
assert.equal(blobObjectName(uuid, "thumb"), `${uuid}.thumb`);

const styleId = styleAssetBlobId("cs_Ab12", "cover", "a1b2c3");
for (const id of [uuid, styleId, styleAssetBlobId("cs__x", "sample", 3)]) {
  assert.ok(BLOB_ID_PATTERN.test(id), `${id} is a well-formed blob id`);
  assert.ok(!id.includes("."), `${id} has no dot, so no copy's name can equal it`);
  for (const variant of BLOB_VARIANTS) {
    assert.ok(!BLOB_ID_PATTERN.test(blobObjectName(id, variant)), "A copy's name is never itself a blob id.");
  }
}
assert.ok(!BLOB_ID_PATTERN.test("../other-user"), "A path is not a blob id.");
assert.ok(!BLOB_ID_PATTERN.test(`${uuid}.web`), "A copy can't be passed off as a picture to copy again.");

// --- Pixels ------------------------------------------------------------------

/** Noise defeats PNG's compression the way a painted picture does. */
async function picture(width: number, height: number, channels: 3 | 4): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * channels);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    raw[i] = seed >>> 24;
  }
  if (channels === 4) {
    // The left half is fully transparent: a cut-out with its background gone.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width / 2; x++) raw[(y * width + x) * 4 + 3] = 0;
      for (let x = Math.floor(width / 2); x < width; x++) raw[(y * width + x) * 4 + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

const master = await picture(1536, 1024, 3);

for (const variant of BLOB_VARIANTS) {
  const spec = BLOB_VARIANT_SPECS[variant];
  const out = await encodeBlobVariant(master, variant);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "webp", `${variant} is WebP`);
  assert.equal(BLOB_VARIANT_MIME, "image/webp");
  assert.ok(Math.max(meta.width ?? 0, meta.height ?? 0) <= spec.maxEdge, `${variant} is within ${spec.maxEdge}px`);
  const wanted = 1536 / 1024;
  const got = (meta.width ?? 1) / (meta.height ?? 1);
  assert.ok(Math.abs(got - wanted) < 0.02, `${variant} keeps the picture's shape (${got.toFixed(3)} vs ${wanted.toFixed(3)})`);
  assert.ok(out.length < master.length / 2, `${variant} is much smaller than the original (${out.length} vs ${master.length})`);
}

const web = await encodeBlobVariant(master, "web");
const thumb = await encodeBlobVariant(master, "thumb");
assert.ok(thumb.length < web.length, "The thumbnail is smaller than the page copy.");

const small = await picture(300, 200, 3);
const smallWeb = await sharp(await encodeBlobVariant(small, "web")).metadata();
assert.equal(smallWeb.width, 300, "A picture smaller than the copy is never enlarged.");
assert.equal(smallWeb.height, 200);

const tall = await picture(1024, 1536, 3);
const tallThumb = await sharp(await encodeBlobVariant(tall, "thumb")).metadata();
assert.ok((tallThumb.height ?? 0) <= BLOB_VARIANT_SPECS.thumb.maxEdge && (tallThumb.width ?? 0) < (tallThumb.height ?? 0), "A tall picture stays tall.");

// Transparency survives, or every cut-out would sit on a black or white box.
const cutout = await picture(800, 600, 4);
for (const variant of BLOB_VARIANTS) {
  const out = await encodeBlobVariant(cutout, variant);
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (fx: number, fy: number) => data[(Math.floor(fy * info.height) * info.width + Math.floor(fx * info.width)) * 4 + 3]!;
  assert.ok(alphaAt(0.1, 0.5) < 16, `${variant}: the transparent half stays transparent`);
  assert.ok(alphaAt(0.9, 0.5) > 240, `${variant}: the opaque half stays opaque`);
}

// Not a picture: encoding throws, which the writer turns into "no copy" rather than a failed render.
await assert.rejects(() => encodeBlobVariant(Buffer.from("not a picture"), "web"), "Bytes that aren't a picture can't become a copy.");

console.log("blob variants: ok");
