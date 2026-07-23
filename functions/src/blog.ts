/**
 * Blog / article backend.
 *
 * The blog is a Firestore **collection** (`blog/{slug}`) — full posts, drafts
 * included — written only here (Admin SDK, behind `requireAdmin`). A
 * world-readable **projection** (`appConfig/blogIndex`) mirrors the published
 * posts' card metadata so the public `/blog` index, the sitemap and
 * `generateStaticParams` read a single small doc instead of every body.
 *
 * All routes are mounted under `/admin`, which `app.ts` guards with
 * `requireVerified` + `requireAdmin`, so every handler assumes an admin caller.
 */
import express, { type Express, type Request, type Response } from "express";
import { ZodError } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin, uploadBlogImage, deletePublicObject } from "./storage";
import {
  blogPostSchema,
  normalizeBlogPost,
  toBlogSummary,
  type BlogImage,
  type BlogIndex,
  type BlogPost,
} from "../../books-frontend/src/core/config/blog";

const BLOG_COLLECTION = "blog";
const BLOG_INDEX_DOC = "appConfig/blogIndex";

function handleError(res: Response, err: unknown): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { message: "Invalid article.", issues: err.issues } });
    return;
  }
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Request failed." } });
}

/** All posts (draft + published), newest-edited first — for the admin list. */
export async function getBlogPostsAdmin(): Promise<BlogPost[]> {
  ensureAdmin();
  const snap = await getFirestore().collection(BLOG_COLLECTION).get();
  return snap.docs
    .map((d) => normalizeBlogPost(d.data()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Rebuild the world-readable published-posts projection. */
async function rebuildBlogIndex(): Promise<BlogIndex> {
  const snap = await getFirestore()
    .collection(BLOG_COLLECTION)
    .where("status", "==", "published")
    .get();
  const posts = snap.docs
    .map((d) => toBlogSummary(normalizeBlogPost(d.data())))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 500);
  const index: BlogIndex = { version: 1, posts, updatedAt: Date.now() };
  await getFirestore().doc(BLOG_INDEX_DOC).set(index, { merge: false });
  return index;
}

/**
 * Create or update a post. Handles slug renames (deletes the old doc) and stamps
 * `publishedAt` on the first publish. Rebuilds the projection, then returns both.
 */
export async function upsertBlogPost(
  input: unknown,
  originalSlug?: string,
): Promise<{ post: BlogPost; index: BlogIndex }> {
  ensureAdmin();
  const parsed = blogPostSchema.parse(input);
  const db = getFirestore();

  // Preserve the original publishedAt when re-saving an already-published post.
  let publishedAt = typeof parsed.publishedAt === "number" ? parsed.publishedAt : null;
  const prevSlug = (originalSlug ?? "").trim();
  const candidate = normalizeBlogPost({ ...parsed, publishedAt });
  if (!candidate.slug) throw new Error("A title (or slug) is required.");

  if (prevSlug && prevSlug !== candidate.slug) {
    const prevSnap = await db.collection(BLOG_COLLECTION).doc(prevSlug).get();
    if (prevSnap.exists && publishedAt === null) {
      publishedAt = (normalizeBlogPost(prevSnap.data()).publishedAt) ?? null;
    }
  } else {
    const existing = await db.collection(BLOG_COLLECTION).doc(candidate.slug).get();
    if (existing.exists && publishedAt === null) {
      publishedAt = normalizeBlogPost(existing.data()).publishedAt ?? null;
    }
  }

  // First publish stamps the timestamp; drafts keep it null.
  if (candidate.status === "published" && publishedAt === null) publishedAt = Date.now();

  const post = normalizeBlogPost({ ...candidate, publishedAt, updatedAt: Date.now() });
  await db.collection(BLOG_COLLECTION).doc(post.slug).set(post, { merge: false });

  // Clean up the old doc on a rename.
  if (prevSlug && prevSlug !== post.slug) {
    await db.collection(BLOG_COLLECTION).doc(prevSlug).delete().catch(() => {});
  }

  const index = await rebuildBlogIndex();
  await triggerRevalidate(["/blog", `/blog/${post.slug}`, ...(prevSlug ? [`/blog/${prevSlug}`] : [])]);
  return { post, index };
}

/** Delete a post + its cover image, then rebuild the projection. */
export async function deleteBlogPost(slug: string): Promise<{ index: BlogIndex }> {
  ensureAdmin();
  const db = getFirestore();
  const ref = db.collection(BLOG_COLLECTION).doc(slug);
  const snap = await ref.get();
  if (snap.exists) {
    const post = normalizeBlogPost(snap.data());
    if (post.coverImage?.storagePath) await deletePublicObject(post.coverImage.storagePath);
    await ref.delete();
  }
  const index = await rebuildBlogIndex();
  await triggerRevalidate(["/blog", `/blog/${slug}`]);
  return { index };
}

/**
 * Best-effort on-demand ISR revalidation. No-ops unless the frontend exposes a
 * revalidate route and its URL + shared secret are configured — so it never
 * breaks a save if the two services aren't wired together.
 */
async function triggerRevalidate(paths: string[]): Promise<void> {
  const url = process.env.FRONTEND_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ paths }),
    });
  } catch {
    // Time-based ISR will catch up regardless.
  }
}

export function registerBlogRoutes(app: Express): void {
  const json = express.json({ limit: "25mb" });

  app.get("/admin/blog", async (_req: Request, res: Response) => {
    try {
      res.json({ posts: await getBlogPostsAdmin() });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/blog", json, async (req: Request, res: Response) => {
    try {
      const { originalSlug, ...post } = (req.body ?? {}) as Record<string, unknown> & {
        originalSlug?: string;
      };
      res.json(await upsertBlogPost(post, typeof originalSlug === "string" ? originalSlug : undefined));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/admin/blog/:slug", async (req: Request, res: Response) => {
    try {
      res.json(await deleteBlogPost(String(req.params.slug)));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Upload a cover image. Body: { base64, mimeType, alt? }.
  app.post("/admin/blog/:slug/image", json, async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      const { base64, mimeType, alt } = (req.body ?? {}) as {
        base64?: string;
        mimeType?: string;
        alt?: string;
      };
      if (!base64 || !mimeType) {
        res.status(400).json({ error: { message: "base64 and mimeType are required." } });
        return;
      }
      const buf = Buffer.from(base64, "base64");
      const { storagePath, publicUrl } = await uploadBlogImage(slug, buf, mimeType);
      const image: BlogImage = { imageUrl: publicUrl, storagePath, alt: alt ?? "" };
      res.json(image);
    } catch (err) {
      handleError(res, err);
    }
  });
}
