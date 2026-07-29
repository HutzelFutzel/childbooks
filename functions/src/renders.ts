/**
 * Render-once storage: a book is rasterized once, and every document made from
 * it is assembled here.
 *
 * Two problems, one mechanism.
 *
 * The first is waste. Rendering is the most expensive thing the product does —
 * twenty-five pages rasterized at 300dpi on whatever laptop the buyer happens
 * to own — and it was being redone in full for every purchase of a book that
 * hadn't changed, including a reorder of the exact same copy.
 *
 * The second is consistency. The printed interior and the digital edition are
 * the same book, but they were assembled by two client code paths that had
 * drifted apart. Assembling both here, from one set of rasters and the shared
 * `core/print` geometry, means the file the printer gets and the file the
 * customer downloads cannot disagree about what the book is.
 *
 * What's stored where, and why:
 *   - rasters live under `users/{uid}/renders/{fp}/` and are scaffolding. The
 *     interior/ebook ones are deleted as soon as the documents exist; the cover
 *     panels are kept, because a cover has to be rebuilt whenever the page
 *     count moves the spine and re-rendering two panels for that is silly.
 *   - the finished PDFs go to the print-asset bucket, which no client can read.
 *   - the index doc records object PATHS, never download URLs. A path is inert
 *     if it leaks; a URL would be a way around the gated, audited download
 *     endpoint that owned ebooks are served through.
 */
import express, { type Express, type Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { AuthedRequest } from "./auth";
import { createAdminAssetHost, publicUrlForPath } from "./assets";
import { ensureAdmin, storageBucketName } from "./storage";
import {
  buildCoverPdf,
  buildEbookPdf,
  buildInteriorPdf,
  pdfBlob,
  type RasterPage,
} from "../../books-frontend/src/core/print/assemble";

/** Which document a raster belongs to. */
export type RasterRole = "interior" | "ebook" | "cover-front" | "cover-back" | "spine";

interface RasterRecord {
  role: RasterRole;
  /** Position within its document. Ignored for the cover roles. */
  index: number;
  label: string;
  widthIn: number;
  heightIn: number;
  path: string;
  mimeType: string;
}

interface RenderDoc {
  projectId: string;
  createdAt: number;
  lastUsedAt: number;
  /** Object paths of the finished documents, keyed by {@link documentKey}. */
  documents?: Record<string, string>;
  /** Retained cover panels, so a new spine width doesn't need a new render. */
  panels?: Record<string, RasterRecord>;
  interiorPageCount?: number;
}

/**
 * Ceiling on how much scaffolding one render may hold. A 400-page book at
 * 300dpi is already generous; past this something is wrong and we'd rather
 * fail the upload than quietly fill a bucket.
 */
const MAX_RASTERS = 600;
const MAX_RASTER_BYTES = 24 * 1024 * 1024;

/** Renders untouched for this long are scaffolding nobody is coming back for. */
const RENDER_TTL_DAYS = 60;

function docRef(uid: string, fingerprint: string) {
  return getFirestore().doc(`users/${uid}/renders/${fingerprint}`);
}

function rastersRef(uid: string, fingerprint: string) {
  return getFirestore().collection(`users/${uid}/renders/${fingerprint}/rasters`);
}

/** Cache key for a finished document. Covers vary by binding and page count. */
export function documentKey(
  kind: "ebook" | "interior" | "cover",
  opts?: { sku?: string; pages?: number },
): string {
  if (kind !== "cover") return kind;
  return `cover:${opts?.sku ?? "?"}:${opts?.pages ?? 0}`;
}

/** A fingerprint is a cache key we generated; reject anything else outright. */
export function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8,64}$/.test(value);
}

function rasterObjectPath(uid: string, fingerprint: string, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._#-]+/g, "_");
  return `users/${uid}/renders/${fingerprint}/${safe}.jpg`;
}

// ---- Reading the cache ------------------------------------------------------

/**
 * Resolve a cached document to a URL a provider (or a download link) can use.
 *
 * A miss and a dead object are the same answer — null — so a caller never
 * places an order against a file that has since been cleaned up.
 */
export async function cachedDocumentUrl(
  uid: string,
  fingerprint: string,
  key: string,
): Promise<string | null> {
  const path = await cachedDocumentPath(uid, fingerprint, key);
  if (!path) return null;
  const url = await publicUrlForPath(path);
  if (url) void touch(uid, fingerprint);
  return url;
}

/**
 * The cached document's OBJECT PATH, for callers that persist a reference to it
 * rather than fetching it now (ebook entitlements). A path stays correct across
 * a bucket or host change, which an absolute URL does not — so anything stored
 * long-term keeps the path and resolves it per request.
 *
 * Verifies the object still exists, so a caller can't record a reference to a
 * file that cleanup has already evicted.
 */
export async function cachedDocumentPath(
  uid: string,
  fingerprint: string,
  key: string,
): Promise<string | null> {
  if (!validFingerprint(fingerprint)) return null;
  const snap = await docRef(uid, fingerprint).get();
  const data = snap.data() as RenderDoc | undefined;
  const path = data?.documents?.[key];
  if (!path) return null;
  if (!(await publicUrlForPath(path))) return null;
  void touch(uid, fingerprint);
  return path;
}

/** Record that a render was used, so cleanup keeps what people come back to. */
async function touch(uid: string, fingerprint: string): Promise<void> {
  try {
    await docRef(uid, fingerprint).set({ lastUsedAt: Date.now() }, { merge: true });
  } catch {
    // A missed timestamp costs a re-render at worst.
  }
}

// ---- Writing the cache ------------------------------------------------------

/** One rasterized page on its way into the cache. */
export interface RasterUpload {
  id: string;
  role: RasterRole;
  index: number;
  label: string;
  widthIn: number;
  heightIn: number;
  base64: string;
  mimeType?: string;
}

async function storeRaster(
  uid: string,
  fingerprint: string,
  raster: RasterUpload,
): Promise<RasterRecord> {
  const buf = Buffer.from(raster.base64, "base64");
  if (buf.byteLength > MAX_RASTER_BYTES) {
    throw new Error(`Page "${raster.label}" is too large to upload.`);
  }
  const path = rasterObjectPath(uid, fingerprint, raster.id);
  await getStorage()
    .bucket(storageBucketName())
    .file(path)
    .save(buf, { contentType: raster.mimeType || "image/jpeg", resumable: false });

  return {
    role: raster.role,
    index: raster.index,
    label: raster.label,
    widthIn: raster.widthIn,
    heightIn: raster.heightIn,
    mimeType: raster.mimeType || "image/jpeg",
    path,
  };
}

/**
 * Store a batch of rasterized pages against a fingerprint.
 *
 * Called by the server-side renderer as it captures pages, and (still) by the
 * upload route. Same writes either way, so where the pixels came from can't
 * change what the cache looks like afterwards.
 */
export async function saveRasters(
  uid: string,
  fingerprint: string,
  projectId: string,
  pages: RasterUpload[],
): Promise<number> {
  if (pages.length === 0) return 0;
  const existing = await rastersRef(uid, fingerprint).count().get();
  if (existing.data().count + pages.length > MAX_RASTERS) {
    throw new Error("This book has too many pages to render.");
  }

  const now = Date.now();
  await docRef(uid, fingerprint).set(
    { projectId, createdAt: now, lastUsedAt: now },
    { merge: true },
  );

  const stored = await Promise.all(pages.map((p) => storeRaster(uid, fingerprint, p)));
  const batch = getFirestore().batch();
  const panels: Record<string, RasterRecord> = {};
  stored.forEach((record, i) => {
    batch.set(rastersRef(uid, fingerprint).doc(sanitizeDocId(pages[i].id)), record);
    // Cover panels are the one kind of raster worth keeping: they're what
    // makes a re-spined cover cheap.
    if (record.role.startsWith("cover-") || record.role === "spine") {
      panels[record.role] = record;
    }
  });
  await batch.commit();
  if (Object.keys(panels).length > 0) {
    await docRef(uid, fingerprint).set({ panels }, { merge: true });
  }
  return stored.length;
}

/** Which document to build out of a fingerprint's rasters. */
export type DocumentRequest =
  | { kind: "ebook" }
  | { kind: "interior"; padToPages: number }
  | {
      kind: "cover";
      sku?: string;
      padToPages?: number;
      cover: { widthIn: number; heightIn: number; panelWidthIn: number };
    };

/**
 * Build one document from a fingerprint's rasters and record it on the index.
 *
 * Returns the cache key it was filed under, so a caller can hand that straight
 * to {@link cachedDocumentUrl} without reconstructing it.
 */
export async function assembleDocument(
  uid: string,
  fingerprint: string,
  request: DocumentRequest,
): Promise<{ key: string; pageCount?: number }> {
  if (request.kind === "ebook") {
    const path = await assembleEbook(uid, fingerprint);
    const key = documentKey("ebook");
    await docRef(uid, fingerprint).set(
      { documents: { [key]: path }, lastUsedAt: Date.now() },
      { merge: true },
    );
    await discardRasters(uid, fingerprint, ["ebook"]);
    return { key };
  }

  if (request.kind === "interior") {
    const pad = Math.max(1, Math.floor(request.padToPages));
    const { path, pageCount } = await assembleInterior(uid, fingerprint, pad);
    const key = documentKey("interior");
    await docRef(uid, fingerprint).set(
      { documents: { [key]: path }, interiorPageCount: pageCount, lastUsedAt: Date.now() },
      { merge: true },
    );
    await discardRasters(uid, fingerprint, ["interior"]);
    return { key, pageCount };
  }

  const path = await assembleCover(uid, fingerprint, request.cover);
  const key = documentKey("cover", { sku: request.sku, pages: request.padToPages });
  await docRef(uid, fingerprint).set(
    { documents: { [key]: path }, lastUsedAt: Date.now() },
    { merge: true },
  );
  return { key };
}

async function readRaster(record: RasterRecord): Promise<RasterPage> {
  const [buf] = await getStorage().bucket(storageBucketName()).file(record.path).download();
  return {
    id: record.path,
    label: record.label,
    bytes: new Uint8Array(buf),
    mimeType: record.mimeType,
    widthIn: record.widthIn,
    heightIn: record.heightIn,
  };
}

async function loadRasters(uid: string, fingerprint: string): Promise<RasterRecord[]> {
  const snap = await rastersRef(uid, fingerprint).get();
  return snap.docs.map((d) => d.data() as RasterRecord);
}

/** Drop the scaffolding for one role once the document built from it exists. */
async function discardRasters(uid: string, fingerprint: string, roles: RasterRole[]): Promise<void> {
  const snap = await rastersRef(uid, fingerprint).get();
  const bucket = getStorage().bucket(storageBucketName());
  const batch = getFirestore().batch();
  const deletions: Promise<unknown>[] = [];
  for (const doc of snap.docs) {
    const record = doc.data() as RasterRecord;
    if (!roles.includes(record.role)) continue;
    batch.delete(doc.ref);
    deletions.push(bucket.file(record.path).delete().catch(() => undefined));
  }
  await Promise.all([batch.commit(), ...deletions]);
}

// ---- Assembly ---------------------------------------------------------------

async function assembleEbook(uid: string, fingerprint: string): Promise<string> {
  const rasters = (await loadRasters(uid, fingerprint))
    .filter((r) => r.role === "ebook")
    .sort((a, b) => a.index - b.index);
  if (rasters.length === 0) throw new Error("The book's pages haven't been uploaded yet.");

  const pages = await Promise.all(rasters.map(readRaster));
  const bytes = await buildEbookPdf(pages);
  const { path } = await createAdminAssetHost().upload(
    pdfBlob(bytes),
    "ebook.pdf",
  );
  return path!;
}

async function assembleInterior(
  uid: string,
  fingerprint: string,
  padToPages: number,
): Promise<{ path: string; pageCount: number }> {
  const rasters = (await loadRasters(uid, fingerprint))
    .filter((r) => r.role === "interior")
    .sort((a, b) => a.index - b.index);
  if (rasters.length === 0) throw new Error("The book's pages haven't been uploaded yet.");

  const pages = await Promise.all(rasters.map(readRaster));
  const bytes = await buildInteriorPdf(pages, { padToPages });
  const { path } = await createAdminAssetHost().upload(
    pdfBlob(bytes),
    "interior.pdf",
  );
  return { path: path!, pageCount: Math.max(padToPages, pages.length) };
}

async function assembleCover(
  uid: string,
  fingerprint: string,
  opts: { widthIn: number; heightIn: number; panelWidthIn: number },
): Promise<string> {
  const rasters = await loadRasters(uid, fingerprint);
  const find = (role: RasterRole) => rasters.find((r) => r.role === role);
  const front = find("cover-front");
  if (!front) throw new Error("The front cover hasn't been uploaded yet.");
  const back = find("cover-back");
  const spine = find("spine");

  const bytes = await buildCoverPdf(
    {
      front: await readRaster(front),
      back: back ? await readRaster(back) : undefined,
      spine: spine ? await readRaster(spine) : undefined,
    },
    { ...opts, background: { r: 1, g: 1, b: 1 } },
  );
  const { path } = await createAdminAssetHost().upload(
    pdfBlob(bytes),
    "cover.pdf",
  );
  return path!;
}

// ---- Routes -----------------------------------------------------------------

function clientError(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: { message } });
}

export function registerRenderRoutes(app: Express): void {
  /**
   * What this book already has rendered.
   *
   * Availability only — never a URL. The client uses it to decide whether to
   * spend a minute rasterizing, and the ebook's actual link keeps coming from
   * the gated download endpoint.
   */
  app.get("/account/renders/:fingerprint", async (req: AuthedRequest, res: Response) => {
    try {
      ensureAdmin();
      const { fingerprint } = req.params;
      if (!validFingerprint(fingerprint)) {
        clientError(res, "Unknown render.", 404);
        return;
      }
      const snap = await docRef(req.uid!, fingerprint).get();
      const data = snap.data() as RenderDoc | undefined;
      const documents = data?.documents ?? {};
      res.json({
        ebook: Boolean(documents[documentKey("ebook")]),
        interior: Boolean(documents[documentKey("interior")]),
        covers: Object.keys(documents).filter((k) => k.startsWith("cover:")),
        // Panels survive their cover, so a new page count only costs a spine.
        hasCoverPanels: Boolean(data?.panels && Object.keys(data.panels).length > 0),
        interiorPageCount: data?.interiorPageCount ?? null,
      });
    } catch (err) {
      console.error("[renders] lookup failed", err);
      clientError(res, "We couldn't check your saved render.", 500);
    }
  });

}

function sanitizeDocId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._#-]+/g, "_").slice(0, 300) || "page";
}

// ---- Retention --------------------------------------------------------------

/**
 * Delete renders nobody has come back to.
 *
 * A cache with no eviction is a bucket that only grows, and these are the
 * largest objects the product creates. Sixty days is well past the window in
 * which someone reorders the same book; after that, re-rendering costs a
 * minute and storing it costs forever.
 *
 * Documents already attached to a real order aren't touched by this — those
 * URLs live on the order record and in the print asset bucket, not here.
 */
export const cleanupStaleRenders = onSchedule(
  { schedule: "every day 04:30", timeZone: "UTC", memory: "512MiB", timeoutSeconds: 540 },
  async () => {
    ensureAdmin();
    const db = getFirestore();
    const cutoff = Date.now() - RENDER_TTL_DAYS * 86_400_000;
    const stale = await db
      .collectionGroup("renders")
      .where("lastUsedAt", "<", cutoff)
      .limit(500)
      .get();

    let removed = 0;
    for (const doc of stale.docs) {
      // users/{uid}/renders/{fingerprint}
      const parts = doc.ref.path.split("/");
      const uid = parts[1];
      const fingerprint = parts[3];
      try {
        await getStorage()
          .bucket(storageBucketName())
          .deleteFiles({ prefix: `users/${uid}/renders/${fingerprint}/` });
        await db.recursiveDelete(doc.ref);
        removed++;
      } catch (err) {
        console.warn("[renders] cleanup failed for", doc.ref.path, err);
      }
    }
    if (removed > 0) console.log(`[renders] cleaned up ${removed} stale renders`);
  },
);

// Erasure needs no special handling here: renders live entirely under
// `users/{uid}/renders/**` in Firestore and `users/{uid}/renders/` in Storage,
// both of which the GDPR erase path already removes wholesale.
