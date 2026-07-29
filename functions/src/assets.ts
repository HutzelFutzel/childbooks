/**
 * Asset host backed by Firebase Storage via the Admin SDK.
 *
 * Implements the `AssetHost` port the print provider depends on. Uploads as
 * admin (no Storage rules needed) and returns a Firebase download URL with an
 * embedded token (`?alt=media&token=...`) that the provider's servers can fetch
 * anonymously.
 *
 * Why a download-token URL and not `getSignedUrl`: signed URLs require a signer
 * (a service-account private key, or the "Service Account Token Creator" IAM
 * role for SignBlob). That isn't available with plain ADC or in the Storage
 * emulator, so signing throws and order placement fails. A download token is a
 * piece of object metadata — no signer required — and works identically with
 * ADC, a key, or the emulator.
 *
 * NOTE: local development runs against the REAL Storage bucket (only Auth,
 * Firestore, Functions and Pub/Sub are emulated) precisely so these URLs are
 * fetchable by the print provider — see `scripts/dev-emulators.mjs`. Opting into
 * the Storage emulator with `USE_STORAGE_EMULATOR=true` makes them localhost
 * URLs, which the browser can still read (so ebooks work) but Lulu cannot, so
 * print checkout fails its pre-payment reachability check by design.
 */
import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { ensureAdmin, storageBucketName } from "./storage";
import type { AssetHost, UploadedAsset } from "../../books-frontend/src/core/fulfillment/types";

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

/** Normalize a base origin to include a scheme and no trailing slash. */
function normalizeBase(value: string): string {
  const withScheme = value.startsWith("http") ? value : `http://${value}`;
  return withScheme.replace(/\/$/, "");
}

/**
 * Build a public Firebase download URL for an object guarded by a token.
 *
 * `FIREBASE_STORAGE_EMULATOR_HOST` is set by the emulator suite only when the
 * Storage emulator is actually running; otherwise this is the real, deployed
 * host — which is the case in local dev too.
 */
function downloadUrl(bucketName: string, objectPath: string, token: string): string {
  const encoded = encodeURIComponent(objectPath);
  const emulatorHost =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST;
  const base = emulatorHost
    ? normalizeBase(emulatorHost)
    : "https://firebasestorage.googleapis.com";
  return `${base}/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

/**
 * Confirm a print file is actually downloadable at the URL we're about to hand
 * the print provider. Returns null when it is, or a reason when it isn't.
 *
 * This exists because the provider fetches these files ASYNCHRONOUSLY, minutes
 * after the job is accepted — so an unreachable URL surfaces as a rejected print
 * job with the customer already charged, which is the worst possible ordering.
 * Checking costs one ranged request against a URL we just wrote, and it happens
 * before the Stripe session exists, so a failure is a retryable checkout error
 * rather than a refund.
 *
 * It catches the whole family at once: a bucket the caller can't actually serve
 * from, a local run that emulated Storage (localhost URLs the provider can't
 * fetch), a reorder pointing at files that have since been removed.
 *
 * A ranged GET rather than HEAD: it's the request shape a downloader actually
 * makes, so a proxy that mishandles HEAD can't produce a false verdict either way.
 */
export async function printFileUnreachableReason(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(10_000),
    });
    // 206 for an honoured range, 200 for a server that ignored it.
    if (res.ok || res.status === 206) return null;
    return `HTTP ${res.status}`;
  } catch (err) {
    return err instanceof Error ? err.message : "request failed";
  }
}

export function createAdminAssetHost(): AssetHost {
  ensureAdmin();
  const bucket = getStorage().bucket(storageBucketName());

  return {
    id: "firebase-admin",
    async upload(blob: Blob, name: string): Promise<UploadedAsset> {
      const buf = Buffer.from(await blob.arrayBuffer());
      const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const objectPath = `print-assets/${stamp}-${safeName(name)}`;
      const token = randomUUID();
      const file = bucket.file(objectPath);
      await file.save(buf, {
        contentType: blob.type || "application/octet-stream",
        resumable: false,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      return { url: downloadUrl(bucket.name, objectPath, token), path: objectPath };
    },
  };
}

/**
 * Re-derive the public download URL for an object we uploaded earlier.
 *
 * The token lives in the object's own metadata, so a stored PATH is enough to
 * rebuild a working link — and a path, unlike a link, is inert if it leaks
 * (Storage rules deny `print-assets/**` to every client). That's what lets a
 * cached render be recorded somewhere the owner can read without handing out a
 * download that bypasses the gated, audited link endpoint.
 *
 * Returns null when the object is gone or was never token-tagged, so callers
 * treat a cache entry as a miss instead of placing an order against a dead URL.
 */
export async function publicUrlForPath(objectPath: string): Promise<string | null> {
  ensureAdmin();
  const bucket = getStorage().bucket(storageBucketName());
  try {
    const file = bucket.file(objectPath);
    const [metadata] = await file.getMetadata();
    const token = (metadata.metadata?.firebaseStorageDownloadTokens as string | undefined)
      ?.split(",")[0]
      ?.trim();
    if (!token) return null;
    return downloadUrl(bucket.name, objectPath, token);
  } catch {
    return null;
  }
}
