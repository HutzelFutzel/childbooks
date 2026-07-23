/**
 * Server-side readers for the public blog.
 *
 * Runs in the App Router (Node) using the isomorphic Firebase client SDK,
 * mirroring {@link getSeoConfig}. The `/blog` index + sitemap read the tiny,
 * world-readable projection (`appConfig/blogIndex`); an article reads its full
 * `blog/{slug}` doc (Firestore rules expose only published posts). All readers
 * degrade to empty/null on error so page rendering never throws.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import {
  normalizeBlogIndex,
  normalizeBlogPost,
  type BlogPost,
  type BlogPostSummary,
} from "../core/config/blog";

/** Published posts (card metadata), newest first. */
export async function getPublishedPosts(): Promise<BlogPostSummary[]> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "blogIndex"));
    return normalizeBlogIndex(snap.exists() ? snap.data() : undefined).posts;
  } catch {
    return [];
  }
}

/** A single published post by slug, or null when missing/draft/unreadable. */
export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "blog", slug));
    if (!snap.exists()) return null;
    const post = normalizeBlogPost(snap.data());
    if (post.status !== "published") return null;
    return post;
  } catch {
    return null;
  }
}
