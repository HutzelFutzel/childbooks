/**
 * Landing-page backend.
 *
 * Mirrors `blog.ts`: full pages live in a Firestore **collection**
 * (`landingPages/{locale}__{slug}`, drafts and retired pages included) written
 * only here (Admin SDK, behind `requireAdmin`), and a world-readable
 * **projection** (`appConfig/landingPagesIndex`) lists the published and retired
 * pages so the sitemap, footer links, redirects and `hreflang` read one small
 * document.
 *
 * What this module owns that the client must not:
 *
 *   - **Lifecycle stamps.** `publishedAt` and `retiredAt` are set here from the
 *     status transition, never taken from the request.
 *   - **Slug history.** Renaming a page that has been live records the old slug
 *     in `previousSlugs`, which the public route turns into a permanent redirect.
 *   - **Collisions.** A slug is unique per locale; creating or renaming onto a
 *     taken one is refused rather than silently overwriting someone's page.
 *   - **Publish readiness.** A page can't go live without a headline and button.
 *   - **Image lifetime.** Pages can share image files (translations and
 *     duplicates start as copies), so a file is deleted only once no other page
 *     references it.
 *
 * Mounted under `/admin`, which `app.ts` guards with `requireVerified` +
 * `requireAdmin`, so every handler assumes an admin caller.
 */
import express, { type Express, type Request, type Response } from "express";
import { ZodError } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin, uploadLandingImage, deletePublicObject } from "./storage";
import { triggerRevalidate } from "./blog";
import { getBlogStats, getAllBlogStats } from "./blogStats";
import {
  landingDocId,
  landingPageInputSchema,
  landingPath,
  landingPublishBlockers,
  landingStoragePaths,
  newTranslationGroupId,
  normalizeLandingPage,
  toLandingSummary,
  type LandingImage,
  type LandingPage,
  type LandingPagesIndex,
} from "../../books-frontend/src/core/config/landingPages";
import { LANDING_SEED_PAGES } from "../../books-frontend/src/core/config/landingPagesSeed";

const COLLECTION = "landingPages";
const INDEX_DOC = "appConfig/landingPagesIndex";
const STATS_PREFIX = "lp-";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** A failure the admin can act on — surfaced verbatim, with a 4xx status. */
class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof RequestError) {
    res.status(err.status).json({ error: { message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { message: "Invalid landing page.", issues: err.issues } });
    return;
  }
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Request failed." } });
}

/** Every page (draft, published, retired), newest-edited first — for the admin list. */
export async function getLandingPagesAdmin(): Promise<LandingPage[]> {
  ensureAdmin();
  const snap = await getFirestore().collection(COLLECTION).get();
  return snap.docs
    .map((d) => normalizeLandingPage(d.data()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Rebuild the world-readable projection of published + retired pages. */
async function rebuildLandingIndex(): Promise<LandingPagesIndex> {
  const snap = await getFirestore()
    .collection(COLLECTION)
    .where("status", "in", ["published", "retired"])
    .get();
  const pages = snap.docs
    .map((d) => toLandingSummary(normalizeLandingPage(d.data())))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 500);
  const index: LandingPagesIndex = { version: 1, pages, updatedAt: Date.now() };
  await getFirestore().doc(INDEX_DOC).set(index, { merge: false });
  return index;
}

/** Of `paths`, those no page other than `exceptId` still references. */
async function unreferencedPaths(paths: string[], exceptId: string): Promise<string[]> {
  if (paths.length === 0) return [];
  const snap = await getFirestore().collection(COLLECTION).get();
  const used = new Set<string>();
  for (const doc of snap.docs) {
    if (doc.id === exceptId) continue;
    for (const p of landingStoragePaths(normalizeLandingPage(doc.data()))) used.add(p);
  }
  return paths.filter((p) => !used.has(p));
}

/** Paths whose rendered output changes when this page changes, siblings included. */
function pathsToRevalidate(page: LandingPage, index: LandingPagesIndex, extra: LandingPage[] = []): string[] {
  const out = new Set<string>(["/sitemap.xml"]);
  for (const p of [page, ...extra]) {
    out.add(landingPath(p.locale, p.slug));
    for (const old of p.previousSlugs) out.add(landingPath(p.locale, old));
  }
  // Sibling translations list this page in their `hreflang` cluster.
  for (const s of index.pages) {
    if (s.translationGroupId === page.translationGroupId) out.add(landingPath(s.locale, s.slug));
  }
  return [...out];
}

/**
 * Create or update a page. `originalId` is the document id the editor opened, so
 * a rename (or a locale change) moves the document instead of duplicating it.
 */
export async function upsertLandingPage(
  input: unknown,
  originalId?: string,
): Promise<{ page: LandingPage; index: LandingPagesIndex }> {
  ensureAdmin();
  const candidate = normalizeLandingPage(landingPageInputSchema.parse(input));
  if (!candidate.slug) throw new RequestError("A page name (or slug) is required.");

  const coll = getFirestore().collection(COLLECTION);
  const id = landingDocId(candidate.locale, candidate.slug);
  const prevId = (originalId ?? "").trim();

  const prevSnap = prevId ? await coll.doc(prevId).get() : null;
  const prev = prevSnap?.exists ? normalizeLandingPage(prevSnap.data()) : null;

  if (id !== prevId) {
    const clash = await coll.doc(id).get();
    if (clash.exists) {
      throw new RequestError(
        `A ${candidate.locale} landing page with the slug "${candidate.slug}" already exists.`,
        409,
      );
    }
  }

  // ---- Lifecycle: server-owned stamps ------------------------------------------
  const now = Date.now();
  let publishedAt = prev?.publishedAt ?? null;
  let retiredAt: number | null = null;

  if (candidate.status === "published") {
    const missing = landingPublishBlockers(candidate);
    if (missing.length > 0) {
      throw new RequestError(`This page can't go live yet — it needs ${missing.join(", ")}.`);
    }
    publishedAt ??= now;
  } else if (candidate.status === "retired") {
    retiredAt = prev?.status === "retired" ? (prev.retiredAt ?? now) : now;
  }

  // ---- Slug history -------------------------------------------------------------
  // Only a page that has been live can have inbound links worth redirecting.
  const previousSlugs = new Set(prev?.previousSlugs ?? []);
  if (prev && prev.locale === candidate.locale && prev.slug !== candidate.slug && prev.publishedAt !== null) {
    previousSlugs.add(prev.slug);
  }
  previousSlugs.delete(candidate.slug);

  const page = normalizeLandingPage({
    ...candidate,
    publishedAt,
    retiredAt,
    previousSlugs: [...previousSlugs],
    updatedAt: now,
  });
  await coll.doc(id).set(page, { merge: false });

  if (prevId && prevId !== id) await coll.doc(prevId).delete().catch(() => {});

  // Files this edit stopped using (a replaced hero, a removed share image).
  if (prev) {
    const kept = new Set(landingStoragePaths(page));
    const dropped = landingStoragePaths(prev).filter((p) => !kept.has(p));
    for (const p of await unreferencedPaths(dropped, id)) await deletePublicObject(p);
  }

  const index = await rebuildLandingIndex();
  await triggerRevalidate(pathsToRevalidate(page, index, prev ? [prev] : []));
  return { page, index };
}

/**
 * Seed starter pages, idempotent by locale + slug: existing pages are never
 * touched, so a seeded page the admin has since edited stays as they left it.
 */
export async function seedLandingPages(): Promise<{ added: number }> {
  ensureAdmin();
  const coll = getFirestore().collection(COLLECTION);
  let added = 0;
  for (const seed of LANDING_SEED_PAGES) {
    const base = normalizeLandingPage({ ...seed, translationGroupId: newTranslationGroupId() });
    const ref = coll.doc(landingDocId(base.locale, base.slug));
    if ((await ref.get()).exists) continue;
    // Seeds are always drafts, whatever a future edit to the seed file says.
    await ref.set(
      normalizeLandingPage({ ...base, status: "draft", publishedAt: null, updatedAt: Date.now() }),
      { merge: false },
    );
    added += 1;
  }
  return { added };
}

/** Delete a page and the images no other page still uses. */
export async function deleteLandingPage(id: string): Promise<{ index: LandingPagesIndex }> {
  ensureAdmin();
  const ref = getFirestore().collection(COLLECTION).doc(id);
  const snap = await ref.get();
  let page: LandingPage | null = null;
  if (snap.exists) {
    page = normalizeLandingPage(snap.data());
    const orphaned = await unreferencedPaths(landingStoragePaths(page), id);
    await ref.delete();
    for (const p of orphaned) await deletePublicObject(p);
  }
  const index = await rebuildLandingIndex();
  if (page) await triggerRevalidate(pathsToRevalidate(page, index));
  return { index };
}

/** Upload one image. Raster only: SVG can carry script and `next/image` refuses it. */
async function uploadImage(body: {
  slug?: string;
  base64?: string;
  mimeType?: string;
  alt?: string;
}): Promise<LandingImage> {
  ensureAdmin();
  const { base64, mimeType } = body;
  if (!base64 || !mimeType) throw new RequestError("base64 and mimeType are required.");
  if (!IMAGE_TYPES.has(mimeType.toLowerCase())) {
    throw new RequestError("Use a PNG, JPEG, WebP, AVIF or GIF image.");
  }
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new RequestError("The image is empty.");
  if (buf.length > MAX_IMAGE_BYTES) throw new RequestError("Images must be under 10 MB.", 413);
  const { storagePath, publicUrl } = await uploadLandingImage(body.slug || "page", buf, mimeType);
  return { imageUrl: publicUrl, storagePath, alt: (body.alt ?? "").slice(0, 300) };
}

export function registerLandingPageRoutes(app: Express): void {
  const json = express.json({ limit: "25mb" });

  app.get("/admin/landing-pages", async (_req: Request, res: Response) => {
    try {
      res.json({ pages: await getLandingPagesAdmin() });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/landing-pages", json, async (req: Request, res: Response) => {
    try {
      const { originalId, ...page } = (req.body ?? {}) as Record<string, unknown> & {
        originalId?: string;
      };
      res.json(await upsertLandingPage(page, typeof originalId === "string" ? originalId : undefined));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/landing-pages/seed", json, async (_req: Request, res: Response) => {
    try {
      res.json(await seedLandingPages());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Upload an image. Body: { slug?, base64, mimeType, alt? }.
  app.post("/admin/landing-pages/image", json, async (req: Request, res: Response) => {
    try {
      res.json(await uploadImage((req.body ?? {}) as Parameters<typeof uploadImage>[0]));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Analytics reuse the blog beacon + `blogStats` collection, namespaced by the
  // `lp-` key prefix; these readers are gated on the landing-pages grant instead
  // of the blog's so an analyst of one doesn't need the other.
  app.get("/admin/landing-pages/stats", async (_req: Request, res: Response) => {
    try {
      const all = await getAllBlogStats();
      res.json({ stats: all.filter((s) => s.slug.startsWith(STATS_PREFIX)) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/admin/landing-pages/stats/:key", async (req: Request, res: Response) => {
    try {
      const key = String(req.params.key);
      if (!key.startsWith(STATS_PREFIX)) throw new RequestError("Not a landing-page stats key.");
      res.json(await getBlogStats(key));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/admin/landing-pages/:id", async (req: Request, res: Response) => {
    try {
      res.json(await deleteLandingPage(String(req.params.id)));
    } catch (err) {
      handleError(res, err);
    }
  });
}
