/**
 * Admin-managed **blog / articles** — the content-marketing surface.
 *
 * Unlike every other config here (a single small `appConfig/*` doc), the blog is
 * a **Firestore collection** (`blog/{slug}`) because article bodies + a growing
 * post count would blow past the 1 MB per-document limit. A lightweight,
 * world-readable **projection** (`appConfig/blogIndex`) lists just the published
 * posts' card metadata so the `/blog` index, the sitemap and `generateStatic
 * Params` never have to read every full body — mirroring the `modelCostsPublic`
 * / `plans` public-projection pattern.
 *
 * Bodies are authored as **Markdown** and rendered server-side through a
 * sanitizing pipeline (never `dangerouslySetInnerHTML` on raw input), keeping
 * the same XSS-averse posture as the rest of the marketing content.
 *
 * Reads are public (published only, enforced by Firestore rules); writes go
 * exclusively through the admin-gated backend (`/admin/blog`).
 */
import { z } from "zod";

export interface BlogAuthor {
  name: string;
  avatarUrl?: string;
  bio?: string;
}

export interface BlogImage {
  /** Public URL of the uploaded cover image. */
  imageUrl: string;
  /** Storage path, so the backend can replace/delete the old file. */
  storagePath?: string;
  /** Alt text — required for accessibility + image SEO. */
  alt: string;
}

/** Per-post SEO overrides. Empty strings fall back to the post's own fields. */
export interface BlogPostSeo {
  title: string;
  description: string;
  /** Canonical path override (defaults to `/blog/{slug}`). */
  canonicalPath: string;
  /** Exclude this single post from indexing. */
  noindex: boolean;
}

export interface BlogPost {
  version: 1;
  /** URL id, e.g. "how-to-write-a-bedtime-story". Stable, unique. */
  slug: string;
  title: string;
  /** 120–160 chars ideal; doubles as the default meta description. */
  excerpt: string;
  /** Markdown body. */
  body: string;
  coverImage: BlogImage | null;
  tags: string[];
  author: BlogAuthor;
  status: "draft" | "published";
  /** Epoch ms set on first publish; drives ordering + `datePublished`. */
  publishedAt: number | null;
  /** Epoch ms of the last edit; drives `dateModified` + sitemap lastmod. */
  updatedAt: number;
  seo: BlogPostSeo;
  /** Derived on save from the body word count. */
  readingMinutes: number;
}

/** Lightweight card metadata for the index projection. */
export interface BlogPostSummary {
  slug: string;
  title: string;
  excerpt: string;
  coverImage: BlogImage | null;
  tags: string[];
  author: BlogAuthor;
  publishedAt: number;
  updatedAt: number;
  readingMinutes: number;
}

/** World-readable projection of published posts, newest first. */
export interface BlogIndex {
  version: 1;
  posts: BlogPostSummary[];
  updatedAt: number;
}

// ---- Helpers ---------------------------------------------------------------

/** Turn an arbitrary title into a URL-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Estimate reading time in minutes from a Markdown body (~200 wpm). */
export function computeReadingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function str(v: unknown, fallback: string, max = 4000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function strArray(v: unknown, max = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 60))
    .slice(0, max);
}

function normalizeAuthor(v: unknown): BlogAuthor {
  const a = (v ?? {}) as Partial<BlogAuthor>;
  const out: BlogAuthor = { name: str(a.name, "", 120).trim() || "Childbook Studio" };
  const avatarUrl = str(a.avatarUrl, "", 2000).trim();
  const bio = str(a.bio, "", 500).trim();
  if (avatarUrl) out.avatarUrl = avatarUrl;
  if (bio) out.bio = bio;
  return out;
}

function normalizeImage(v: unknown): BlogImage | null {
  if (!v || typeof v !== "object") return null;
  const img = v as Partial<BlogImage>;
  const imageUrl = str(img.imageUrl, "", 2000).trim();
  if (!imageUrl) return null;
  const out: BlogImage = { imageUrl, alt: str(img.alt, "", 300).trim() };
  const storagePath = str(img.storagePath, "", 500).trim();
  if (storagePath) out.storagePath = storagePath;
  return out;
}

function normalizeSeo(v: unknown): BlogPostSeo {
  const s = (v ?? {}) as Partial<BlogPostSeo>;
  const canonicalPath = str(s.canonicalPath, "", 300).trim();
  return {
    title: str(s.title, "", 200).trim(),
    description: str(s.description, "", 400).trim(),
    canonicalPath: canonicalPath && !canonicalPath.startsWith("/") ? `/${canonicalPath}` : canonicalPath,
    noindex: s.noindex === true,
  };
}

export function createDefaultBlogPost(): BlogPost {
  const now = Date.now();
  return {
    version: 1,
    slug: "",
    title: "",
    excerpt: "",
    body: "",
    coverImage: null,
    tags: [],
    author: { name: "Childbook Studio" },
    status: "draft",
    publishedAt: null,
    updatedAt: now,
    seo: { title: "", description: "", canonicalPath: "", noindex: false },
    readingMinutes: 1,
  };
}

export function normalizeBlogPost(input: unknown): BlogPost {
  const d = createDefaultBlogPost();
  const s = (input ?? {}) as Partial<BlogPost>;
  const body = str(s.body, "", 100_000);
  const rawSlug = str(s.slug, "", 80).trim();
  const title = str(s.title, "", 200).trim();
  const status = s.status === "published" ? "published" : "draft";
  return {
    version: 1,
    slug: rawSlug ? slugify(rawSlug) : slugify(title),
    title,
    excerpt: str(s.excerpt, "", 400).trim(),
    body,
    coverImage: normalizeImage(s.coverImage),
    tags: strArray(s.tags),
    author: normalizeAuthor(s.author),
    status,
    publishedAt:
      typeof s.publishedAt === "number" && Number.isFinite(s.publishedAt)
        ? s.publishedAt
        : status === "published"
          ? Date.now()
          : null,
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : d.updatedAt,
    seo: normalizeSeo(s.seo),
    readingMinutes:
      typeof s.readingMinutes === "number" && s.readingMinutes > 0
        ? Math.round(s.readingMinutes)
        : computeReadingMinutes(body),
  };
}

/** Project a full post down to its index-card metadata. */
export function toBlogSummary(post: BlogPost): BlogPostSummary {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    coverImage: post.coverImage,
    tags: post.tags,
    author: post.author,
    publishedAt: post.publishedAt ?? post.updatedAt,
    updatedAt: post.updatedAt,
    readingMinutes: post.readingMinutes,
  };
}

export function normalizeBlogSummary(input: unknown): BlogPostSummary {
  const post = normalizeBlogPost(input);
  return toBlogSummary(post);
}

export function createDefaultBlogIndex(): BlogIndex {
  return { version: 1, posts: [], updatedAt: Date.now() };
}

export function normalizeBlogIndex(input: unknown): BlogIndex {
  const s = (input ?? {}) as Partial<BlogIndex>;
  const posts = Array.isArray(s.posts) ? s.posts.map(normalizeBlogSummary) : [];
  posts.sort((a, b) => b.publishedAt - a.publishedAt);
  return {
    version: 1,
    posts: posts.slice(0, 500),
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
  };
}

// ---- Validation (backend, before persisting) -------------------------------

export const blogPostSchema = z.object({
  version: z.literal(1).optional(),
  slug: z.string().max(120).optional(),
  title: z.string().max(200),
  excerpt: z.string().max(400).optional(),
  body: z.string().max(100_000).optional(),
  coverImage: z
    .object({
      imageUrl: z.string().max(2000),
      storagePath: z.string().max(500).optional(),
      alt: z.string().max(300).optional(),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string().max(60)).optional(),
  author: z
    .object({
      name: z.string().max(120),
      avatarUrl: z.string().max(2000).optional(),
      bio: z.string().max(500).optional(),
    })
    .partial()
    .optional(),
  status: z.enum(["draft", "published"]).optional(),
  publishedAt: z.number().nullable().optional(),
  updatedAt: z.number().optional(),
  seo: z
    .object({
      title: z.string().max(200),
      description: z.string().max(400),
      canonicalPath: z.string().max(300),
      noindex: z.boolean(),
    })
    .partial()
    .optional(),
  readingMinutes: z.number().optional(),
});
