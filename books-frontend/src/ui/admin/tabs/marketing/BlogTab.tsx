"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Search,
  ImagePlus,
  Eye,
  Pencil,
  Clock,
  ExternalLink,
} from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input, Textarea } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  computeReadingMinutes,
  createDefaultBlogPost,
  slugify,
  type BlogPost,
} from "../../../../core/config/blog";
import { Prose } from "../../../blog/Prose";
import { Grid, Section, TextField, Disclosure } from "../products/parts";

const EXCERPT_MIN = 120;
const EXCERPT_MAX = 160;

/** Read a File as bare base64 (no data: prefix) + its mime type. */
function readBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        base64: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || "image/png",
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Editor for the **blog / articles**. Lists all posts (drafts + published) and
 * edits a single post: title/slug, excerpt, cover image, Markdown body (with a
 * live rendered preview), tags, author, per-post SEO overrides and publish
 * state. Saves through the admin backend, which rebuilds the public projection
 * and triggers ISR revalidation — no redeploy needed.
 */
export function BlogTab() {
  const loadAdminPosts = useAppConfigStore((s) => s.loadAdminPosts);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BlogPost | null>(null);
  const [originalSlug, setOriginalSlug] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      setPosts(await loadAdminPosts());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load posts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = () => {
    setEditing({ ...createDefaultBlogPost() });
    setOriginalSlug(undefined);
  };

  const startEdit = (post: BlogPost) => {
    setEditing({ ...post });
    setOriginalSlug(post.slug);
  };

  const onClose = async (didChange: boolean) => {
    setEditing(null);
    setOriginalSlug(undefined);
    if (didChange) await refresh();
  };

  if (editing) {
    return (
      <PostEditor post={editing} originalSlug={originalSlug} onClose={onClose} />
    );
  }

  const filtered = posts.filter(
    (p) =>
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Articles power your organic search traffic. Each published post gets its own SEO metadata,
          structured data and sitemap entry automatically. Changes go live without a deploy.
        </p>
        <Button size="sm" leftIcon={<Plus className="size-3.5" />} onClick={startNew}>
          New post
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
        <Input
          value={search}
          placeholder="Search posts…"
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 py-12 text-center">
          <p className="text-sm text-ink-500">
            {posts.length === 0 ? "No articles yet." : "No posts match your search."}
          </p>
          {posts.length === 0 && (
            <Button size="sm" className="mt-3" leftIcon={<Plus className="size-3.5" />} onClick={startNew}>
              Write your first post
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-ink-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/60 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Title</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Updated</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((post) => (
                <tr key={post.slug} className="bg-white hover:bg-ink-50/40">
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => startEdit(post)}
                      className="text-left font-medium text-ink-800 hover:text-brand-700"
                    >
                      {post.title || <span className="text-ink-400">Untitled</span>}
                    </button>
                    <div className="text-[11px] text-ink-400">/blog/{post.slug}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={post.status} />
                  </td>
                  <td className="hidden px-4 py-2.5 text-ink-500 sm:table-cell">
                    {new Date(post.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {post.status === "published" && (
                        <a
                          href={`/blog/${post.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                          title="View live"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(post)}
                        className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: BlogPost["status"] }) {
  return status === "published" ? (
    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      Published
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
      Draft
    </span>
  );
}

function PostEditor({
  post,
  originalSlug,
  onClose,
}: {
  post: BlogPost;
  originalSlug?: string;
  onClose: (didChange: boolean) => Promise<void>;
}) {
  const savePost = useAppConfigStore((s) => s.savePost);
  const deletePost = useAppConfigStore((s) => s.deletePost);
  const uploadPostImage = useAppConfigStore((s) => s.uploadPostImage);

  const [draft, setDraft] = useState<BlogPost>(post);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  // Keep the slug in lockstep with the title until the admin hand-edits it.
  const [slugTouched, setSlugTouched] = useState(Boolean(originalSlug));
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<BlogPost>) => setDraft((d) => ({ ...d, ...patch }));

  const onTitle = (title: string) => {
    set(slugTouched ? { title } : { title, slug: slugify(title) });
  };

  const excerptLen = draft.excerpt.length;
  const readingMinutes = useMemo(() => computeReadingMinutes(draft.body), [draft.body]);
  const isNew = !originalSlug;

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      const slug = draft.slug || slugify(draft.title) || "post";
      const image = await uploadPostImage(slug, base64, mimeType, draft.coverImage?.alt);
      set({ coverImage: image });
      toast.success("Cover uploaded — save the post to keep it.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onSave = async () => {
    if (!draft.title.trim()) {
      toast.error("A title is required.");
      return;
    }
    setSaving(true);
    try {
      await savePost({ ...draft, readingMinutes }, originalSlug);
      toast.success(draft.status === "published" ? "Post published." : "Draft saved.");
      await onClose(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save post.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!originalSlug) {
      await onClose(false);
      return;
    }
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deletePost(originalSlug);
      toast.success("Post deleted.");
      await onClose(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete post.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft className="size-4" />}
          onClick={() => onClose(false)}
        >
          All posts
        </Button>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 className="size-3.5" />}
              onClick={onDelete}
              loading={deleting}
            >
              Delete
            </Button>
          )}
          <Button size="sm" onClick={onSave} loading={saving}>
            {draft.status === "published" ? "Save & publish" : "Save draft"}
          </Button>
        </div>
      </div>

      {/* ---- Article ---- */}
      <Section title="Article" hint="Title, URL slug and the summary used on cards + as the default meta description.">
        <Field label="Title">
          <Input value={draft.title} placeholder="How to write a bedtime story" onChange={(e) => onTitle(e.target.value)} />
        </Field>
        <Grid cols={2}>
          <Field label="Slug" hint={`URL: /blog/${draft.slug || "…"}`}>
            <Input
              value={draft.slug}
              placeholder="how-to-write-a-bedtime-story"
              onChange={(e) => {
                setSlugTouched(true);
                set({ slug: slugify(e.target.value) });
              }}
            />
          </Field>
          <Field label="Status">
            <Select
              value={draft.status}
              options={[
                { value: "draft", label: "Draft (hidden)" },
                { value: "published", label: "Published (live)" },
              ]}
              onChange={(e) => set({ status: e.target.value as BlogPost["status"] })}
            />
          </Field>
        </Grid>
        <Field label="Excerpt" hint={`${excerptLen} characters — the sweet spot is ${EXCERPT_MIN}–${EXCERPT_MAX}.`}>
          <Textarea
            rows={2}
            value={draft.excerpt}
            onChange={(e) => set({ excerpt: e.target.value })}
            className={excerptLen > EXCERPT_MAX ? "ring-amber-400" : undefined}
          />
        </Field>
      </Section>

      {/* ---- Cover image ---- */}
      <Section title="Cover image" hint="Shown on cards, at the top of the article, and as the social share image.">
        <div className="flex flex-wrap items-start gap-4">
          <div className="relative aspect-video w-56 overflow-hidden rounded-xl bg-linear-to-br from-brand-100 to-accent-100 ring-1 ring-inset ring-ink-100">
            {draft.coverImage?.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.coverImage.imageUrl} alt={draft.coverImage.alt || ""} className="size-full object-cover" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickImage(e.target.files?.[0])}
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ImagePlus className="size-3.5" />}
              onClick={() => fileRef.current?.click()}
              loading={uploading}
            >
              {draft.coverImage ? "Replace image" : "Upload image"}
            </Button>
            <TextField
              label="Alt text (accessibility + image SEO)"
              value={draft.coverImage?.alt ?? ""}
              placeholder="A parent and child reading a picture book"
              onChange={(v) =>
                set({
                  coverImage: draft.coverImage
                    ? { ...draft.coverImage, alt: v }
                    : { imageUrl: "", alt: v },
                })
              }
            />
          </div>
        </div>
      </Section>

      {/* ---- Body ---- */}
      <Section
        title="Body (Markdown)"
        hint="Supports headings, lists, links, quotes, tables and images. Renders into styled article content."
        action={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={showPreview ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "Editor only" : "Show preview"}
          </Button>
        }
      >
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Clock className="size-3" /> ~{readingMinutes} min read
        </div>
        <div className={showPreview ? "grid gap-3 lg:grid-cols-2" : undefined}>
          <Textarea
            rows={20}
            value={draft.body}
            placeholder={"## A great subheading\n\nWrite your article in **Markdown**.\n\n- Point one\n- Point two\n\n> A memorable quote."}
            onChange={(e) => set({ body: e.target.value })}
            className="font-mono text-sm"
          />
          {showPreview && (
            <div className="max-h-128 overflow-y-auto rounded-lg bg-white p-4 ring-1 ring-inset ring-ink-100">
              {draft.body.trim() ? (
                <Prose markdown={draft.body} />
              ) : (
                <p className="text-sm text-ink-400">Preview appears here as you write.</p>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ---- Details ---- */}
      <Section title="Details" hint="Author and tags. The first tag shows as the post's category label.">
        <Field label="Tags" hint="Comma-separated.">
          <Input
            value={draft.tags.join(", ")}
            placeholder="Guides, Bedtime, Personalization"
            onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
          />
        </Field>
        <Grid cols={2}>
          <TextField
            label="Author name"
            value={draft.author.name}
            onChange={(v) => set({ author: { ...draft.author, name: v } })}
          />
          <TextField
            label="Author avatar URL"
            value={draft.author.avatarUrl ?? ""}
            onChange={(v) => set({ author: { ...draft.author, avatarUrl: v } })}
          />
        </Grid>
        <Field label="Author bio" hint="Optional — shown in the byline card at the end of the article.">
          <Textarea
            rows={2}
            value={draft.author.bio ?? ""}
            onChange={(e) => set({ author: { ...draft.author, bio: e.target.value } })}
          />
        </Field>
      </Section>

      {/* ---- SEO overrides ---- */}
      <Disclosure label="SEO overrides (optional)">
        <p className="text-[11px] leading-relaxed text-ink-400">
          Leave blank to use the title and excerpt above. These override the article&apos;s search +
          social metadata.
        </p>
        <TextField
          label="SEO title"
          value={draft.seo.title}
          placeholder={draft.title}
          onChange={(v) => set({ seo: { ...draft.seo, title: v } })}
        />
        <Field label="SEO description">
          <Textarea
            rows={2}
            value={draft.seo.description}
            placeholder={draft.excerpt}
            onChange={(e) => set({ seo: { ...draft.seo, description: e.target.value } })}
          />
        </Field>
        <Grid cols={2}>
          <TextField
            label="Canonical path"
            value={draft.seo.canonicalPath}
            placeholder={`/blog/${draft.slug || "…"}`}
            onChange={(v) => set({ seo: { ...draft.seo, canonicalPath: v } })}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-700">
            <Toggle
              checked={draft.seo.noindex}
              onChange={(v) => set({ seo: { ...draft.seo, noindex: v } })}
              label="Exclude from search"
            />
            Exclude from search (noindex)
          </label>
        </Grid>
      </Disclosure>
    </div>
  );
}
