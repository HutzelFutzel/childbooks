import Link from "next/link";
import Image from "next/image";
import { Clock } from "lucide-react";
import type { BlogPostSummary } from "@/core/config/blog";
import { formatPostDate } from "./date";

/** A single article card for the index + related-posts grids. */
export function BlogCard({ post }: { post: BlogPostSummary }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-soft transition hover:shadow-lifted"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-linear-to-br from-brand-100 to-accent-100">
        {post.coverImage?.imageUrl && (
          <Image
            src={post.coverImage.imageUrl}
            alt={post.coverImage.alt || post.title}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 380px"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {post.tags[0] && (
          <span className="mb-2 inline-flex w-fit rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-600">
            {post.tags[0]}
          </span>
        )}
        <h3 className="font-display text-lg font-bold leading-snug text-ink-900 transition group-hover:text-brand-700">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-600">{post.excerpt}</p>
        <div className="mt-4 flex items-center gap-2 text-xs text-ink-400">
          <span>{formatPostDate(post.publishedAt)}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {post.readingMinutes} min read
          </span>
        </div>
      </div>
    </Link>
  );
}
