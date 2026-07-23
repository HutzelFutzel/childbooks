/**
 * Admin-SDK access to a user's blob space in Firebase Storage
 * (`users/{uid}/blobs/{id}`). Shared by the image-render and pipeline-refresh
 * workers.
 */
import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

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

function bucket() {
  return getStorage().bucket(storageBucketName());
}

function blobPath(uid: string, id: string): string {
  return `users/${uid}/blobs/${id}`;
}

/** Download a blob's raw bytes. */
export async function downloadBlob(uid: string, id: string): Promise<Buffer> {
  const [buf] = await bucket().file(blobPath(uid, id)).download();
  return buf;
}

/** Download a blob as base64 with its stored content type (defaults to PNG). */
export async function downloadBlobBase64(
  uid: string,
  id: string,
): Promise<{ base64: string; mimeType: string }> {
  const file = bucket().file(blobPath(uid, id));
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
 * Download an object by its FULL storage path (not scoped to a user's blob
 * space) as base64 + content type. Used for world-readable admin assets such as
 * art-style example images under `public/artStyles/...`.
 */
export async function downloadPublicBase64(
  storagePath: string,
): Promise<{ base64: string; mimeType: string }> {
  const file = bucket().file(storagePath);
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

/** Upload bytes and return a fresh blob id. */
export async function uploadBlob(
  uid: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  const id = randomUUID();
  await bucket().file(blobPath(uid, id)).save(buf, { contentType, resumable: false });
  return id;
}

/** Public download URL for an object, honoring Storage rules (read: true). */
function publicMediaUrl(path: string): string {
  const b = bucket();
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
 */
export async function uploadArtStyleImage(
  styleId: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = (contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const storagePath = `public/artStyles/${encodeURIComponent(styleId)}/example-${randomUUID()}.${ext}`;
  await bucket().file(storagePath).save(buf, { contentType, resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/**
 * Upload an admin-managed product image to the world-readable
 * `public/products/{productId}/...` space and return its path + public URL.
 */
export async function uploadProductImage(
  productId: string,
  buf: Buffer,
  contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = (contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const storagePath = `public/products/${encodeURIComponent(productId)}/image-${randomUUID()}.${ext}`;
  await bucket().file(storagePath).save(buf, { contentType, resumable: false });
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
  await bucket().file(storagePath).save(buf, { contentType: contentType || "image/svg+xml", resumable: false });
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
  await bucket().file(storagePath).save(buf, { contentType: contentType || "image/png", resumable: false });
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
  await bucket().file(storagePath).save(buf, { contentType: contentType || "image/png", resumable: false });
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
  await bucket().file(storagePath).save(buf, { contentType: contentType || "image/png", resumable: false });
  return { storagePath, publicUrl: publicMediaUrl(storagePath) };
}

/** Delete a previously uploaded object (best-effort). */
export async function deletePublicObject(storagePath: string): Promise<void> {
  try {
    await bucket().file(storagePath).delete();
  } catch {
    // already gone / not found
  }
}
