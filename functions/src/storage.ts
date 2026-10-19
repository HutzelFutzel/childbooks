/**
 * Admin-SDK access to a user's blob space in Firebase Storage
 * (`users/{uid}/blobs/{id}`). Shared by the image-render and pipeline-refresh
 * workers.
 */
import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import sharp from "sharp";
import { PICTURE_FILE_MISSING } from "../../books-frontend/src/core/pipeline/pictureFileMessage";
import {
  BLOB_VARIANTS,
  BLOB_VARIANT_MIME,
  BLOB_VARIANT_SPECS,
  IMMUTABLE_BLOB_CACHE_CONTROL,
  blobObjectName,
  type BlobVariant,
} from "../../books-frontend/src/core/storage/blobVariants";

/**
 * The Storage bucket the backend reads/writes. This MUST match the client's
 * `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, or generated images land in a bucket
 * the browser can't read (the version exists but shows empty).
 *
 * Resolution order:
 *   1. `STORAGE_BUCKET` — explicit override for local/dev. (NOTE: the `FIREBASE_`
 *      prefix is reserved by Firebase and can't be set in a functions `.env`
 *      file, so the override uses an unprefixed name.)
 *   2. `FIREBASE_STORAGE_BUCKET` — present in the deployed runtime environment.
 *   3. Derive `<projectId>.firebasestorage.app` (the current default-bucket
 *      naming) so a missing env doesn't fall back to a mismatched legacy
 *      `.appspot.com` bucket — or throw "specify storageBucket via
 *      initializeApp" when no default resolves at all.
 */
export function storageBucketName(): string | undefined {
  if (process.env.STORAGE_BUCKET) return process.env.STORAGE_BUCKET;
  if (process.env.FIREBASE_STORAGE_BUCKET) return process.env.FIREBASE_STORAGE_BUCKET;
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    (() => {
      try {
        return (JSON.parse(process.env.FIREBASE_CONFIG || "{}") as { projectId?: string })
          .projectId;
      } catch {
        return undefined;
      }
    })();
  return projectId ? `${projectId}.firebasestorage.app` : undefined;
}

let firestoreConfigured = false;

export function ensureAdmin(): void {
  // Initialize with NO arguments so the Admin SDK picks up the full runtime
  // configuration (credentials, projectId, emulator wiring) from FIREBASE_CONFIG
  // / ADC. The bucket is controlled explicitly at the `getStorage().bucket(...)`
  // call site (see `bucket()`), so we must NOT pass a partial options object here
  // — doing so suppresses the auto-config and breaks the default app.
  if (getApps().length === 0) initializeApp();

  // Mirror the client's Firestore config (see `getFirebaseDb`): job documents
  // embed rich snapshots (full project, resolved models, render results) whose
  // optional fields are frequently `undefined` — e.g. a root anchor render has
  // no `parentId`. Without this, the Admin SDK throws "Cannot use undefined as a
  // Firestore value" on `.update()`/`.set()` and the whole job fails. Must be set
  // once, before any Firestore access; every DB entry point calls `ensureAdmin`
  // first, so this runs early enough.
  if (!firestoreConfigured) {
    firestoreConfigured = true;
    try {
      getFirestore().settings({ ignoreUndefinedProperties: true });
    } catch {
      // Firestore was already accessed/configured elsewhere — safe to ignore.
    }
  }
}

/**
 * The one bucket every backend Storage access goes through. Always pass the
 * resolved name — a bare `getStorage().bucket()` uses the app's default bucket,
 * which on older projects is the legacy `.appspot.com` one the client never
 * reads from.
 */
export function blobBucket() {
  return getStorage().bucket(storageBucketName());
}

export function blobPath(uid: string, id: string): string {
  return `users/${uid}/blobs/${id}`;
}

/** Path of a blob's small display copy (see `core/storage/blobVariants.ts`). */
export function blobVariantPath(uid: string, id: string, variant: BlobVariant): string {
  return `users/${uid}/blobs/${blobObjectName(id, variant)}`;
}

/** Shrink a picture into one of its display copies (WebP, transparency kept). */
export async function encodeBlobVariant(buf: Buffer, variant: BlobVariant): Promise<Buffer> {
  const spec = BLOB_VARIANT_SPECS[variant];
  return sharp(buf)
    .rotate()
    .resize({ width: spec.maxEdge, height: spec.maxEdge, fit: "inside", withoutEnlargement: true })
    .webp({ quality: spec.quality, alphaQuality: spec.alphaQuality })
    .toBuffer();
}

async function writeBlobVariant(
  uid: string,
  id: string,
  master: Buffer,
  variant: BlobVariant,
): Promise<void> {
  const bytes = await encodeBlobVariant(master, variant);
  await blobBucket().file(blobVariantPath(uid, id, variant)).save(bytes, {
    contentType: BLOB_VARIANT_MIME,
    resumable: false,
    metadata: { cacheControl: IMMUTABLE_BLOB_CACHE_CONTROL },
  });
}

/**
 * Write every display copy of a picture, best effort: a copy that fails to
 * encode or upload just means readers fall back to the master (and a later
 * backfill fills it in), so it must never fail the render that made the picture.
 */
async function writeBlobVariants(
  uid: string,
  id: string,
  master: Buffer,
  only: readonly BlobVariant[] = BLOB_VARIANTS,
): Promise<void> {
  await Promise.all(
    only.map((variant) =>
      writeBlobVariant(uid, id, master, variant).catch((err) => {
        logger.warn("[blobs] could not write a display copy", {
          id,
          variant,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    ),
  );
}

/**
 * Make sure a stored picture has all its display copies: the lazy backfill for
 * pictures stored before copies existed (and for any whose copy failed).
 * Idempotent. Returns false when there is no master to copy from, or it is not
 * a picture.
 */
export async function ensureBlobVariants(uid: string, id: string): Promise<boolean> {
  const bucket = blobBucket();
  const present = await Promise.all(
    BLOB_VARIANTS.map(async (variant) => {
      const [exists] = await bucket.file(blobVariantPath(uid, id, variant)).exists();
      return exists;
    }),
  );
  const missing = BLOB_VARIANTS.filter((_, index) => !present[index]);
  if (missing.length === 0) return true;

  let master: Buffer;
  try {
    [master] = await bucket.file(blobPath(uid, id)).download();
  } catch {
    return false;
  }
  try {
    await sharp(master).metadata();
  } catch {
    return false;
  }
  await writeBlobVariants(uid, id, master, missing);
  return true;
}

export interface UploadBlobOptions {
  /**
   * Write the small display copies too. Off for pictures nobody looks at
   * directly (an inpainting mask), where they would only be clutter.
   */
  variants?: boolean;
}

/**
 * A picture the book lists whose file is not in storage. Thrown instead of the
 * raw "No such object: bucket/path" so the reader gets a sentence they can act
 * on; the blob id stays on the error (and in the log) for whoever debugs it.
 */
export class BlobMissingError extends Error {
  readonly name = "BlobMissingError";
  constructor(
    readonly blobId: string,
    readonly storagePath: string,
  ) {
    super(PICTURE_FILE_MISSING);
  }
}

function isObjectMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  return e.code === 404 || (typeof e.message === "string" && /No such object/i.test(e.message));
}

/** Download a file, turning "it is not there" into a {@link BlobMissingError}. */
async function downloadFile(file: ReturnType<ReturnType<typeof blobBucket>["file"]>, id: string): Promise<Buffer> {
  try {
    const [buf] = await file.download();
    return buf;
  } catch (err) {
    if (!isObjectMissing(err)) throw err;
    logger.warn("[storage] a picture file the book lists is missing", { blobId: id, path: file.name });
    throw new BlobMissingError(id, file.name);
  }
}

/** Download a blob's raw bytes. */
export async function downloadBlob(uid: string, id: string): Promise<Buffer> {
  return downloadFile(blobBucket().file(blobPath(uid, id)), id);
}

/** Download a blob as base64 with its stored content type (defaults to PNG). */
export async function downloadBlobBase64(
  uid: string,
  id: string,
): Promise<{ base64: string; mimeType: string }> {
  const file = blobBucket().file(blobPath(uid, id));
  const buf = await downloadFile(file, id);
  let mimeType = "image/png";
  try {
    const [meta] = await file.getMetadata();
    if (meta.contentType) mimeType = meta.contentType;
  } catch {
    // Metadata is best-effort; the bytes are what matter.
  }
  return { base64: buf.toString("base64"), mimeType };
}

/**
 * Download an object by its FULL storage path (not scoped to a user's blob
 * space) as base64 + content type. Used for world-readable admin assets such as
 * art-style example images under `public/artStyles/...`.
 */
export async function downloadPublicBase64(
  storagePath: string,
): Promise<{ base64: string; mimeType: string }> {
  const file = blobBucket().file(storagePath);
  const [buf] = await file.download();
  let mimeType = "image/png";
  try {
    const [meta] = await file.getMetadata();
    if (meta.contentType) mimeType = meta.contentType;
  } catch {
    // Metadata is best-effort; the bytes are what matter.
  }
  return { base64: buf.toString("base64"), mimeType };
}

/**
 * Upload bytes and return a fresh blob id. A picture is written with its small
 * display copies, in parallel, so by the time the id is handed out the studio
 * can already show it without downloading the full-size master.
 */
export async function uploadBlob(
  uid: string,
  buf: Buffer,
  contentType: string,
  options: UploadBlobOptions = {},
): Promise<string> {
  const id = randomUUID();
  const withVariants = (options.variants ?? true) && contentType.startsWith("image/");
  await Promise.all([
    blobBucket().file(blobPath(uid, id)).save(buf, {
      contentType,
      resumable: false,
      // An id is minted for exactly one render and never rewritten.
      metadata: { cacheControl: IMMUTABLE_BLOB_CACHE_CONTROL },
    }),
    withVariants ? writeBlobVariants(uid, id, buf) : Promise.resolve(),
  ]);
  return id;
}

/**
 * Upload bytes under a caller-chosen blob id. Used for pictures a custom art
 * style owns: the id is derived from the style, so storing the same picture
 * twice (a retry, two requests racing) lands on the same object.
 */
export async function uploadBlobAs(
  uid: string,
  id: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  await Promise.all([
    blobBucket().file(blobPath(uid, id)).save(buf, {
      contentType,
      resumable: false,
      // Unlike a render, this id is derived, so the bytes behind it can change.
      metadata: { cacheControl: "private, max-age=3600" },
    }),
    contentType.startsWith("image/") ? writeBlobVariants(uid, id, buf) : Promise.resolve(),
  ]);
  return id;
}

/** Delete a user blob and its display copies (best-effort). */
export async function deleteBlobById(uid: string, id: string): Promise<void> {
  const bucket = blobBucket();
  const names = [blobPath(uid, id), ...BLOB_VARIANTS.map((variant) => blobVariantPath(uid, id, variant))];
  await Promise.all(
    names.map((name) =>
      bucket
        .file(name)
        .delete({ ignoreNotFound: true })
        .catch(() => undefined),
    ),
  );
}

/** Public download URL for an object, honoring Storage rules (read: true). */
function publicMediaUrl(path: string): string {
  const b = blobBucket();
  const encoded = encodeURIComponent(path);
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST;
  if (emulatorHost) {
    const host = emulatorHost.startsWith("http") ? emulatorHost : `http://${emulatorHost}`;
    return `${host}/v0/b/${b.name}/o/${encoded}?alt=media`;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${b.name}/o/${encoded}?alt=media`;
}

/**
 * Upload an admin-managed art-style example image to the world-readable
 * `public/artStyles/{styleId}/...` space and return its path + public URL.
 * Styles keep an ordered gallery, so uploads accumulate until explicitly
 * removed. These assets are customer previews and never model references.
 */
export async function uploadArtStyleImage(
  styleId: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = (contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const storagePath = `public/artStyles/${encodeURIComponent(styleId)}/example-${randomUUID()}.${ext}`;
  await blobBucket().file(storagePath).save(buf, { contentType, resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Upload an immutable generation-only exemplar. Replacements get a new path;
 * old objects remain because existing books snapshot their selected version.
 */
export async function uploadArtStyleReference(
  styleId: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = (contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const storagePath = `public/artStyles/${encodeURIComponent(styleId)}/generation-${randomUUID()}.${ext}`;
  await blobBucket().file(storagePath).save(buf, { contentType, resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Upload a layout showcase image to the world-readable
 * `public/layouts/{layoutId}/...` space and return its path + public URL.
 *
 * Layouts keep several (a page shape and side each), so unlike an art-style
 * example these accumulate rather than replace; deletion is explicit.
 */
export async function uploadLayoutImage(
  layoutId: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = (contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const storagePath = `public/layouts/${encodeURIComponent(layoutId)}/example-${randomUUID()}.${ext}`;
  await blobBucket().file(storagePath).save(buf, { contentType, resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Store one immutable, normalized image-shape PNG. The id is the revision:
 * uploads are never overwritten, so books that reference an archived shape
 * keep rendering exactly as authored.
 */
export async function uploadImageMask(
  id: string,
  png: Buffer,
): Promise<{ storagePath: string; publicUrl: string }> {
  const safeId = id.replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
  if (!safeId) throw new Error("The image-shape id is invalid.");
  const storagePath = `public/imageMasks/${safeId}/mask.png`;
  await blobBucket().file(storagePath).save(png, {
    contentType: "image/png",
    resumable: false,
    metadata: { cacheControl: "public,max-age=31536000,immutable" },
  });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Upload a catalog picture — of a print option, a book, the digital edition or a
 * Spark pack — to the world-readable `public/catalogMedia/{scope}/{id}/...`
 * space. The caller passes an already-parsed key; the segments are sanitized
 * again here so a bad key can never escape the public prefix.
 */
export async function uploadCatalogPhoto(
  scope: string,
  segments: string[],
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const safe = (s: string) => s.replace(/[^a-z0-9._-]/gi, "").slice(0, 80) || "other";
  const dir = [scope, ...segments].map(safe).join("/");
  const storagePath = `public/catalogMedia/${dir}/photo-${randomUUID()}.${extForMime(contentType)}`;
  await blobBucket().file(storagePath).save(buf, { contentType: contentType || "image/jpeg", resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/** Map a MIME type to a clean file extension (handles svg+xml → svg). */
function extForMime(contentType: string): string {
  const sub = (contentType.split("/")[1] || "png").toLowerCase();
  if (sub.includes("svg")) return "svg";
  return sub.replace(/[^a-z0-9]/gi, "") || "png";
}

/**
 * Upload the admin-managed branding watermark to the world-readable
 * `public/branding/...` space and return its path + public URL. SVG preferred,
 * but any image type works.
 */
export async function uploadBrandingWatermark(
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const storagePath = `public/branding/watermark-${randomUUID()}.${extForMime(contentType)}`;
  await blobBucket().file(storagePath).save(buf, { contentType: contentType || "image/svg+xml", resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Upload an admin-managed brand asset (logo, icon, favicon, social image, …) to
 * the world-readable `public/branding/{slot}-...` space and return its path +
 * public URL. `slot` only shapes the filename (sanitized), never the ACL.
 */
export async function uploadBrandingAsset(
  slot: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const safeSlot = slot.replace(/[^a-z0-9]/gi, "").slice(0, 40) || "asset";
  const storagePath = `public/branding/${safeSlot}-${randomUUID()}.${extForMime(contentType)}`;
  await blobBucket().file(storagePath).save(buf, { contentType: contentType || "image/png", resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Upload an admin-managed landing-page illustration to the world-readable
 * `public/site/{slot}-...` space and return its path + public URL. `slot` only
 * shapes the filename (sanitized), never the ACL.
 */
export async function uploadSiteImage(
  slot: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const safeSlot = slot.replace(/[^a-z0-9]/gi, "").slice(0, 40) || "image";
  const storagePath = `public/site/${safeSlot}-${randomUUID()}.${extForMime(contentType)}`;
  await blobBucket().file(storagePath).save(buf, { contentType: contentType || "image/png", resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Upload an admin-managed blog cover image to the world-readable
 * `public/blog/{slug}-...` space and return its path + public URL. `slug` only
 * shapes the filename (sanitized), never the ACL.
 */
export async function uploadBlogImage(
  slug: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "").slice(0, 80) || "post";
  const storagePath = `public/blog/${safeSlug}-${randomUUID()}.${extForMime(contentType)}`;
  await blobBucket().file(storagePath).save(buf, { contentType: contentType || "image/png", resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/** Delete a previously uploaded object (best-effort). */
export async function deletePublicObject(storagePath: string): Promise<void> {
  try {
    await blobBucket().file(storagePath).delete();
  } catch {
    // already gone / not found
  }
}

/**
 * Upload a rendered QR code image to the world-readable
 * `public/qrcodes/{id}/render-...` space and return its path + public URL.
 * `id` only shapes the filename (sanitized), never the ACL.
 */
export async function uploadQrCode(
  id: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const safeId = id.replace(/[^a-z0-9-]/gi, "").slice(0, 60) || "qr";
  const storagePath = `public/qrcodes/${safeId}/render-${randomUUID()}.${extForMime(contentType)}`;
  await blobBucket().file(storagePath).save(buf, { contentType, resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Upload the source logo image a QR code's center was composited from — a copy
 * kept independent of whatever branding asset it might have been picked from,
 * so a later change there doesn't retroactively change an already-saved code.
 */
export async function uploadQrLogo(
  id: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const safeId = id.replace(/[^a-z0-9-]/gi, "").slice(0, 60) || "qr";
  const storagePath = `public/qrcodes/${safeId}/logo-${randomUUID()}.${extForMime(contentType)}`;
  await blobBucket().file(storagePath).save(buf, { contentType, resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Fetch a public image's bytes over HTTP (e.g. an existing branding asset's
 * `imageUrl`) so it can be re-uploaded as an independent copy or composited
 * in-memory. Used only for admin-picked, already-public URLs — never
 * user-supplied ones.
 */
export async function fetchPublicBytes(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the image at ${url} (${res.status}).`);
  const contentType = res.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}
