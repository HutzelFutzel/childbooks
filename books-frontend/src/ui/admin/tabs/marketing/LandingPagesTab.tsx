"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  Languages,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input, Textarea } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  DEFAULT_CTA_HREF,
  LANDING_SLUG_MAX,
  MAX_FAQ_ITEMS,
  MAX_HERO_BULLETS,
  MAX_TAGS,
  createDefaultLandingPage,
  landingDocId,
  landingPath,
  landingPublishBlockers,
  landingSlug,
  landingStatsKey,
  resolveCtaHref,
  resolveLandingSeo,
  sanitizeHref,
  type LandingImage,
  type LandingPage,
  type LandingStatus,
} from "../../../../core/config/landingPages";
import { LANDING_SEED_PAGES } from "../../../../core/config/landingPagesSeed";
import { DEFAULT_LOCALE, LOCALES, findLocale } from "../../../../core/i18n/locales";
import { isPublished } from "../../../../core/i18n/publish";
import type { BlogStatsListItem } from "../../../../core/config/blogStats";
import { LandingPageTemplate } from "../../../landing/LandingPageTemplate";
import { BlogStatsPanel } from "./BlogStatsPanel";
import { Disclosure, Grid, Section } from "../products/parts";

/** Below this view count, CTA rate is too noisy to compare — shown as "—". */
const MIN_VIEWS_FOR_RATE = 30;
const TITLE_MAX = 60;
const DESC_MIN = 120;
const DESC_MAX = 160;

type SortKey = "title" | "views" | "uniques" | "cta" | "ctaRate" | "updated";
type StatusFilter = "all" | LandingStatus;

const STATUS_LABEL: Record<LandingStatus, string> = {
  draft: "Draft",
  published: "Published",
  retired: "Retired",
};

const STATUS_HINT: Record<LandingStatus, string> = {
  draft: "Not public. Visitors get a 404.",
  published: "Live, indexable, in the sitemap and linked from the footer.",
  retired: "Offline. Removed from the sitemap and footer.",
};

// ---- helpers ----------------------------------------------------------------------

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

/** A slug nobody in this locale already has: `base`, then `base-2`, `base-3`, … */
function uniqueSlug(locale: string, base: string, pages: LandingPage[]): string {
  const taken = new Set(pages.filter((p) => p.locale === locale).map((p) => p.slug));
  const root = base || "page";
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root.slice(0, LANDING_SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

function docIdOf(page: LandingPage): string {
  return landingDocId(page.locale, page.slug);
}

function localeName(id: string): string {
  return findLocale(id)?.englishName ?? id;
}

interface EditTarget {
  page: LandingPage;
  /** Doc id the editor opened (undefined = not saved yet). */
  originalId?: string;
}

// ---- the tab ----------------------------------------------------------------------

/**
 * Admin editor for **landing pages**. Every page follows one template, so the
 * admin only edits content; the slug, status and SEO overrides sit alongside.
 * Everything not configured here (title tags, canonical, hreflang, structured
 * data, sitemap, internal links) is derived automatically from the content.
 */
export function LandingPagesTab() {
  const loadAdminLandingPages = useAppConfigStore((s) => s.loadAdminLandingPages);
  const loadAllLandingStats = useAppConfigStore((s) => s.loadAllLandingStats);
  const seedLandingPages = useAppConfigStore((s) => s.seedLandingPages);
  const saveLandingPage = useAppConfigStore((s) => s.saveLandingPage);

  const [pages, setPages] = useState<LandingPage[]>([]);
  const [stats, setStats] = useState<Record<string, BlogStatsListItem>>({});
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "updated",
    dir: "desc",
  });

  const refresh = async () => {
    setLoading(true);
    try {
      setPages(await loadAdminLandingPages());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load landing pages.");
    } finally {
      setLoading(false);
    }
    // Stats are best-effort — a failure must not blank the list.
    try {
      const rows = await loadAllLandingStats();
      setStats(Object.fromEntries(rows.map((r) => [r.slug, r])));
    } catch {
      setStats({});
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statsOf = (p: LandingPage) => stats[landingStatsKey(p)];
  const rateOf = (p: LandingPage): number | null => {
    const s = statsOf(p);
    return !s || s.views < MIN_VIEWS_FOR_RATE ? null : s.ctaClicks / s.views;
  };

  /** Keep the list in step with a save made inside the editor. */
  const onSaved = (saved: LandingPage, previousId?: string) => {
    const id = docIdOf(saved);
    setPages((prev) => [...prev.filter((p) => docIdOf(p) !== previousId && docIdOf(p) !== id), saved]);
  };

  const startNew = () => setEditing({ page: createDefaultLandingPage(DEFAULT_LOCALE) });

  const duplicate = (page: LandingPage) => {
    const copy: LandingPage = {
      ...structuredClone(page),
      // A duplicate is a new page, not a translation: its own group, its own stats.
      translationGroupId: createDefaultLandingPage(page.locale).translationGroupId,
      title: `${page.title} (copy)`,
      slug: uniqueSlug(page.locale, landingSlug(page.locale, `${page.slug}-copy`), pages),
      status: "draft",
      publishedAt: null,
      retiredAt: null,
      previousSlugs: [],
      retiredRedirect: "",
      translatedFromUpdatedAt: null,
    };
    setEditing({ page: copy });
  };

  const changeStatus = async (page: LandingPage, status: LandingStatus) => {
    if (status === "published") {
      const blockers = landingPublishBlockers(page);
      if (blockers.length > 0) {
        toast.error(`Can't publish yet — it needs ${blockers.join(", ")}.`);
        return;
      }
    }
    if (status === "retired" && !window.confirm("Take this page offline? Its URL will stop showing the page.")) {
      return;
    }
    try {
      const { page: saved } = await saveLandingPage({ ...page, status }, docIdOf(page));
      onSaved(saved, docIdOf(page));
      toast.success(status === "published" ? "Page is live." : "Page taken offline.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the status.");
    }
  };

  const onSeed = async () => {
    setSeeding(true);
    try {
      const { added } = await seedLandingPages();
      toast.success(added > 0 ? `Added ${added} starter page${added === 1 ? "" : "s"} as drafts.` : "Starter pages already exist.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not seed landing pages.");
    } finally {
      setSeeding(false);
    }
  };

  if (editing) {
    return (
      <PageEditor
        key={editing.originalId ?? `new-${editing.page.slug}-${editing.page.locale}`}
        target={editing}
        pages={pages}
        onSaved={onSaved}
        onOpen={(page, originalId) => setEditing({ page, originalId })}
        onClose={async (didChange) => {
          setEditing(null);
          if (didChange) await refresh();
        }}
      />
    );
  }

  const counts = {
    all: pages.length,
    draft: pages.filter((p) => p.status === "draft").length,
    published: pages.filter((p) => p.status === "published").length,
    retired: pages.filter((p) => p.status === "retired").length,
  };

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "title" ? "asc" : "desc" },
    );

  const sortValue = (p: LandingPage): number | string => {
    switch (sort.key) {
      case "title":
        return p.title.toLowerCase();
      case "views":
        return statsOf(p)?.views ?? 0;
      case "uniques":
        return statsOf(p)?.uniques ?? 0;
      case "cta":
        return statsOf(p)?.ctaClicks ?? 0;
      case "ctaRate":
        return rateOf(p) ?? -1;
      case "updated":
      default:
        return p.updatedAt;
    }
  };

  const dir = sort.dir === "asc" ? 1 : -1;
  const q = search.toLowerCase();
  const filtered = pages
    .filter((p) => filter === "all" || p.status === filter)
    .filter((p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
    .sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });

  const multiLocale = new Set(pages.map((p) => p.locale)).size > 1;
  const allSeedsPresent =
    !loading &&
    LANDING_SEED_PAGES.every((s) =>
      pages.some((p) => p.slug === s.slug && p.locale === (s.locale ?? DEFAULT_LOCALE)),
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Campaign pages that all share one template: you write the content, and the title tag,
          canonical URL, structured data, sitemap entry and internal links are generated for you.
          Changes go live without a deploy.
        </p>
        <div className="flex gap-2">
          {!allSeedsPresent && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Sparkles className="size-3.5" />}
              onClick={onSeed}
              loading={seeding}
            >
              Seed starter page
            </Button>
          )}
          <Button size="sm" leftIcon={<Plus className="size-3.5" />} onClick={startNew}>
            New page
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={search}
            placeholder="Search pages…"
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-xl bg-ink-50 p-1" role="tablist" aria-label="Filter by status">
          {(["all", "published", "draft", "retired"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === f ? "bg-white text-ink-900 shadow-2xs" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              {f === "all" ? "All" : STATUS_LABEL[f]}
              <span className="ml-1.5 tabular-nums text-ink-400">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 py-12 text-center">
          <p className="text-sm text-ink-500">
            {pages.length === 0 ? "No landing pages yet." : "No pages match."}
          </p>
          {pages.length === 0 && (
            <div className="mt-3 flex justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Sparkles className="size-3.5" />}
                onClick={onSeed}
                loading={seeding}
              >
                Seed starter page
              </Button>
              <Button size="sm" leftIcon={<Plus className="size-3.5" />} onClick={startNew}>
                Create your first page
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-ink-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/60 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <SortHeader label="Page" col="title" sort={sort} onSort={toggleSort} />
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <SortHeader label="Views" col="views" sort={sort} onSort={toggleSort} align="right" />
                <SortHeader label="Unique" col="uniques" sort={sort} onSort={toggleSort} align="right" thClass="hidden sm:table-cell" />
                <SortHeader label="CTA" col="cta" sort={sort} onSort={toggleSort} align="right" thClass="hidden md:table-cell" />
                <SortHeader label="CTA %" col="ctaRate" sort={sort} onSort={toggleSort} align="right" thClass="hidden md:table-cell" />
                <SortHeader label="Updated" col="updated" sort={sort} onSort={toggleSort} thClass="hidden lg:table-cell" />
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((page) => {
                const s = statsOf(page);
                const rate = rateOf(page);
                const live = page.status === "published" && isPublished(page.locale);
                return (
                  <tr key={docIdOf(page)} className="bg-white hover:bg-ink-50/40">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => setEditing({ page, originalId: docIdOf(page) })}
                        className="text-left font-medium text-ink-800 hover:text-brand-700"
                      >
                        {page.title || <span className="text-ink-400">Untitled</span>}
                      </button>
                      <div className="text-[11px] text-ink-400">
                        {multiLocale && (
                          <span className="mr-1.5 rounded bg-ink-100 px-1 py-px font-semibold uppercase text-ink-500">
                            {page.locale}
                          </span>
                        )}
                        {landingPath(page.locale, page.slug)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={page.status} />
                    </td>
                    <StatCell value={s?.views} />
                    <StatCell value={s?.uniques} thClass="hidden sm:table-cell" />
                    <StatCell value={s?.ctaClicks} thClass="hidden md:table-cell" />
                    <td className="hidden px-4 py-2.5 text-right tabular-nums text-ink-600 md:table-cell">
                      {rate === null ? <span className="text-ink-300">—</span> : `${(rate * 100).toFixed(1)}%`}
                    </td>
                    <td className="hidden px-4 py-2.5 text-ink-500 lg:table-cell">
                      {new Date(page.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {page.status === "published" && (
                          <button
                            type="button"
                            onClick={() => void changeStatus(page, "retired")}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-amber-700 transition hover:bg-amber-50"
                          >
                            Retire
                          </button>
                        )}
                        {page.status === "retired" && (
                          <button
                            type="button"
                            onClick={() => void changeStatus(page, "published")}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-50"
                          >
                            Republish
                          </button>
                        )}
                        {live && (
                          <a
                            href={landingPath(page.locale, page.slug)}
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
                          onClick={() => duplicate(page)}
                          className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                          title="Duplicate"
                        >
                          <Copy className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing({ page, originalId: docIdOf(page) })}
                          className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                          title="Edit"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  col,
  sort,
  onSort,
  align = "left",
  thClass = "",
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  thClass?: string;
}) {
  const active = sort.key === col;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`px-4 py-2.5 font-semibold ${thClass}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        aria-label={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-ink-700 ${
          align === "right" ? "w-full justify-end" : ""
        } ${active ? "text-ink-700" : ""}`}
      >
        <span>{label}</span>
        <Icon className={`size-3 ${active ? "" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function StatCell({ value, thClass = "" }: { value?: number; thClass?: string }) {
  return (
    <td className={`px-4 py-2.5 text-right tabular-nums text-ink-600 ${thClass}`}>
      {value ? value.toLocaleString() : <span className="text-ink-300">—</span>}
    </td>
  );
}

function StatusPill({ status }: { status: LandingStatus }) {
  const tone =
    status === "published"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
      : status === "retired"
        ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
        : "bg-ink-100 text-ink-500";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ---- editor -----------------------------------------------------------------------

function PageEditor({
  target,
  pages,
  onSaved,
  onOpen,
  onClose,
}: {
  target: EditTarget;
  pages: LandingPage[];
  onSaved: (page: LandingPage, previousId?: string) => void;
  onOpen: (page: LandingPage, originalId?: string) => void;
  onClose: (didChange: boolean) => Promise<void>;
}) {
  const saveLandingPage = useAppConfigStore((s) => s.saveLandingPage);
  const deleteLandingPage = useAppConfigStore((s) => s.deleteLandingPage);
  const loadLandingStats = useAppConfigStore((s) => s.loadLandingStats);
  const siteUrl = useAppConfigStore((s) => s.seo.siteUrl);
  // The page you're editing, served by *this* environment (localhost in dev).
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const [draft, setDraft] = useState<LandingPage>(target.page);
  const [savedId, setSavedId] = useState<string | undefined>(target.originalId);
  // The status that's actually stored — the header switch can be ahead of it.
  const [savedStatus, setSavedStatus] = useState<LandingStatus>(
    target.originalId ? target.page.status : "draft",
  );
  const [dirty, setDirty] = useState(false);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [tagsText, setTagsText] = useState(target.page.tags.join(", "));
  // Keep the slug following the name until the admin edits it by hand.
  const [slugTouched, setSlugTouched] = useState(Boolean(target.originalId));

  const isNew = !savedId;
  const update = (fn: (d: LandingPage) => LandingPage) => {
    setDraft(fn);
    setDirty(true);
  };
  const set = (patch: Partial<LandingPage>) => update((d) => ({ ...d, ...patch }));

  const onTitle = (title: string) =>
    update((d) => ({
      ...d,
      title,
      ...(slugTouched ? {} : { slug: landingSlug(d.locale, title) }),
    }));

  const blockers = landingPublishBlockers({
    ...draft,
    slug: draft.slug || landingSlug(draft.locale, draft.title),
  });
  const ctaInvalid = draft.ctaHref.trim() !== "" && !sanitizeHref(draft.ctaHref);
  const redirectInvalid = draft.retiredRedirect.trim() !== "" && !sanitizeHref(draft.retiredRedirect);
  const path = landingPath(draft.locale, draft.slug || "…");
  const seoMeta = resolveLandingSeo(draft);

  const group = pages.filter(
    (p) => p.translationGroupId === draft.translationGroupId && docIdOf(p) !== savedId,
  );
  const source = draft.locale === DEFAULT_LOCALE ? null : group.find((p) => p.locale === DEFAULT_LOCALE);
  const stale =
    source != null &&
    draft.translatedFromUpdatedAt !== null &&
    source.updatedAt > draft.translatedFromUpdatedAt;

  const onSave = async () => {
    if (!draft.title.trim()) {
      toast.error("Give the page a name first.");
      return;
    }
    if (draft.status === "published" && blockers.length > 0) {
      toast.error(`Can't publish yet — it needs ${blockers.join(", ")}.`);
      return;
    }
    if (ctaInvalid || redirectInvalid) {
      toast.error("Fix the highlighted link first.");
      return;
    }
    setSaving(true);
    try {
      const toSave = {
        ...draft,
        slug: landingSlug(draft.locale, draft.slug) || landingSlug(draft.locale, draft.title),
      };
      const { page } = await saveLandingPage(toSave, savedId);
      onSaved(page, savedId);
      setDraft(page);
      setSavedId(docIdOf(page));
      setSavedStatus(page.status);
      setSlugTouched(true);
      setDirty(false);
      setChanged(true);
      toast.success(
        page.status === "published" ? "Saved — the page is live." : page.status === "retired" ? "Saved — the page is offline." : "Draft saved.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the page.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!savedId) {
      await onClose(changed);
      return;
    }
    if (!window.confirm("Delete this page permanently? Its URL will 404. To keep the URL working, retire it instead.")) return;
    setDeleting(true);
    try {
      await deleteLandingPage(savedId);
      toast.success("Page deleted.");
      await onClose(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the page.");
    } finally {
      setDeleting(false);
    }
  };

  const onBack = async () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    await onClose(changed);
  };

  const createTranslation = (localeId: string) => {
    const copy: LandingPage = {
      ...structuredClone(draft),
      locale: localeId,
      slug: uniqueSlug(localeId, landingSlug(localeId, draft.title), pages),
      status: "draft",
      publishedAt: null,
      retiredAt: null,
      previousSlugs: [],
      retiredRedirect: "",
      translatedFromUpdatedAt: draft.updatedAt,
    };
    onOpen(copy, undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="size-4" />} onClick={onBack}>
          All pages
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
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
          <Button
            variant="secondary"
            size="sm"
            leftIcon={showPreview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "Hide preview" : "Show preview"}
          </Button>
          <StatusSwitch value={draft.status} onChange={(status) => set({ status })} />
          <Button size="sm" onClick={onSave} loading={saving}>
            {draft.status === "published" && savedStatus !== "published" ? "Save & publish" : "Save"}
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-right text-xs text-ink-500">
        {STATUS_HINT[draft.status]}
        {draft.status !== savedStatus && (
          <span className="ml-1 font-medium text-amber-700">Takes effect when you save.</span>
        )}
      </p>

      <div className={showPreview ? "grid gap-4 xl:grid-cols-2" : ""}>
        <div className="min-w-0 space-y-4">
          {/* ---- Page ---- */}
          <Section title="Page" hint="The name is internal (admin list, footer link). The slug is the URL.">
            <Grid cols={2}>
              <Field label="Page name" required hint="Shown in the admin and as the footer link text.">
                <Input value={draft.title} onChange={(e) => onTitle(e.target.value)} placeholder="Personalized bedtime story book" />
              </Field>
              <Field
                label="Slug"
                required
                hint={
                  origin && origin !== siteUrl.replace(/\/$/, "")
                    ? `Public: ${siteUrl.replace(/\/$/, "")}${path} · This environment: ${origin}${path}`
                    : `${siteUrl.replace(/\/$/, "")}${path}`
                }
              >
                <Input
                  value={draft.slug}
                  maxLength={LANDING_SLUG_MAX}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set({ slug: landingSlug(draft.locale, e.target.value, { typing: true }) });
                  }}
                  onBlur={() => set({ slug: landingSlug(draft.locale, draft.slug) })}
                  placeholder="bedtime-story-book"
                />
              </Field>
            </Grid>
            {!isNew && draft.publishedAt !== null && (
              <p className="text-xs text-ink-500">
                Renaming the slug is safe: the old address keeps working and redirects to the new one.
              </p>
            )}

            <Grid cols={2}>
              {isNew && group.length === 0 ? (
                <Field label="Language" hint="Fixed once the page is saved.">
                  <Select
                    value={draft.locale}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        locale: e.target.value,
                        ...(slugTouched ? {} : { slug: landingSlug(e.target.value, d.title) }),
                      }))
                    }
                    options={LOCALES.map((l) => ({ value: l.id, label: `${l.englishName} (${l.endonym})` }))}
                  />
                </Field>
              ) : (
                <Field label="Language">
                  <div className="flex h-11 items-center rounded-xl2 bg-ink-50 px-3.5 text-sm text-ink-700">
                    {localeName(draft.locale)}
                  </div>
                </Field>
              )}
            </Grid>

            {draft.status === "retired" && (
              <Field
                label="Send visitors to"
                error={redirectInvalid ? "Use a path on this site (like /blog) or an https:// address." : undefined}
                hint="Blank shows a 404. Otherwise visitors are redirected (temporarily, so the page can come back)."
              >
                <Input
                  value={draft.retiredRedirect}
                  onChange={(e) => set({ retiredRedirect: e.target.value })}
                  placeholder="/blog"
                />
              </Field>
            )}

            {draft.status === "published" && !isPublished(draft.locale) && (
              <Notice tone="amber">
                {localeName(draft.locale)} isn&apos;t launched as a site language yet, so this page stays
                hidden until it is.
              </Notice>
            )}

            {blockers.length > 0 && draft.status === "published" && (
              <Notice tone="red">Can&apos;t publish yet — it needs {blockers.join(", ")}.</Notice>
            )}

            {stale && source && (
              <Notice tone="amber">
                The {localeName(source.locale)} version changed after this translation was made.
                <button
                  type="button"
                  className="ml-2 font-semibold underline underline-offset-2"
                  onClick={() => set({ translatedFromUpdatedAt: source.updatedAt })}
                >
                  Mark as up to date
                </button>
              </Notice>
            )}
          </Section>

          {/* ---- Translations ---- */}
          {LOCALES.length > 1 && (
            <Section
              title="Translations"
              hint="Each language is its own page with its own slug. Search engines are told they belong together."
            >
              <div className="flex flex-wrap gap-2">
                {LOCALES.filter((l) => l.id !== draft.locale).map((l) => {
                  const sibling = group.find((p) => p.locale === l.id);
                  if (sibling) {
                    const siblingStale =
                      draft.locale === DEFAULT_LOCALE &&
                      sibling.translatedFromUpdatedAt !== null &&
                      draft.updatedAt > sibling.translatedFromUpdatedAt;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        disabled={dirty}
                        title={dirty ? "Save first" : "Open"}
                        onClick={() => onOpen(sibling, docIdOf(sibling))}
                        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-inset ring-ink-200 transition hover:bg-ink-50 disabled:opacity-60"
                      >
                        <Languages className="size-3.5 text-ink-400" />
                        {l.englishName}
                        <StatusPill status={sibling.status} />
                        {siblingStale && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                            Out of date
                          </span>
                        )}
                      </button>
                    );
                  }
                  return (
                    <Button
                      key={l.id}
                      variant="secondary"
                      size="sm"
                      disabled={isNew || dirty}
                      title={isNew || dirty ? "Save this page first" : undefined}
                      leftIcon={<Plus className="size-3.5" />}
                      onClick={() => createTranslation(l.id)}
                    >
                      Create {l.englishName} version
                    </Button>
                  );
                })}
              </div>
              {draft.locale !== DEFAULT_LOCALE && !isPublished(draft.locale) && (
                <p className="text-xs text-ink-500">
                  {localeName(draft.locale)} isn&apos;t a live site language yet — you can prepare the page now;
                  it goes public when the language launches.
                </p>
              )}
            </Section>
          )}

          {/* ---- Button ---- */}
          <Section title="Call-to-action link" hint="Where every button on this page goes.">
            <Field
              label="Button link"
              error={ctaInvalid ? "Use a path on this site (like /studio) or an https:// address." : undefined}
              hint={`Blank uses the default, ${DEFAULT_CTA_HREF}. Resolves to: ${resolveCtaHref(draft)}`}
            >
              <Input
                value={draft.ctaHref}
                onChange={(e) => set({ ctaHref: e.target.value })}
                placeholder={DEFAULT_CTA_HREF}
              />
            </Field>
          </Section>

          {/* ---- Hero ---- */}
          <Section title="Hero" hint="The headline is the page's single H1 and, by default, its search title.">
            <Field label="Eyebrow" hint="Short line above the headline.">
              <Input value={draft.hero.eyebrow} onChange={(e) => update((d) => ({ ...d, hero: { ...d.hero, eyebrow: e.target.value } }))} />
            </Field>
            <Field label="Headline" required>
              <Input value={draft.hero.title} onChange={(e) => update((d) => ({ ...d, hero: { ...d.hero, title: e.target.value } }))} />
            </Field>
            <Field label="Subtitle" hint="Also the default meta description (trimmed to fit).">
              <Textarea rows={3} value={draft.hero.subtitle} onChange={(e) => update((d) => ({ ...d, hero: { ...d.hero, subtitle: e.target.value } }))} />
            </Field>
            <Grid cols={2}>
              <Field label="Button label" required>
                <Input value={draft.hero.ctaLabel} onChange={(e) => update((d) => ({ ...d, hero: { ...d.hero, ctaLabel: e.target.value } }))} />
              </Field>
              <Field label={`Reassurance bullets (one per line, max ${MAX_HERO_BULLETS})`}>
                <Textarea
                  rows={3}
                  value={draft.hero.bullets.join("\n")}
                  onChange={(e) =>
                    update((d) => ({
                      ...d,
                      hero: { ...d.hero, bullets: e.target.value.split("\n").slice(0, MAX_HERO_BULLETS) },
                    }))
                  }
                />
              </Field>
            </Grid>
            <ImageSlot
              label="Hero image"
              image={draft.hero.image}
              slug={draft.slug || landingSlug(draft.locale, draft.title) || "page"}
              onChange={(image) => update((d) => ({ ...d, hero: { ...d.hero, image } }))}
              prompt={draft.hero.imagePrompt}
              onPrompt={(imagePrompt) => update((d) => ({ ...d, hero: { ...d.hero, imagePrompt } }))}
            />
          </Section>

          {/* ---- Steps ---- */}
          <Section title="How it works">
            <Field label="Section heading">
              <Input value={draft.steps.heading} onChange={(e) => update((d) => ({ ...d, steps: { ...d.steps, heading: e.target.value } }))} />
            </Field>
            {draft.steps.items.map((item, i) => (
              <Grid key={i} cols={2}>
                <Field label={`Step ${i + 1} title`}>
                  <Input
                    value={item.title}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        steps: { ...d.steps, items: d.steps.items.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)) },
                      }))
                    }
                  />
                </Field>
                <Field label={`Step ${i + 1} text`}>
                  <Textarea
                    rows={2}
                    value={item.body}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        steps: { ...d.steps, items: d.steps.items.map((s, j) => (j === i ? { ...s, body: e.target.value } : s)) },
                      }))
                    }
                  />
                </Field>
              </Grid>
            ))}
          </Section>

          {/* ---- Showcase ---- */}
          <Section title="Showcase" hint="Three images with captions. Give each one real alt text — it's what search engines read.">
            {draft.showcase.items.map((item, i) => (
              <div key={i} className="space-y-3 rounded-xl bg-ink-50/50 p-3">
                <ImageSlot
                  label={`Image ${i + 1}`}
                  image={item.image}
                  slug={draft.slug || landingSlug(draft.locale, draft.title) || "page"}
                  onChange={(image) =>
                    update((d) => ({
                      ...d,
                      showcase: { items: d.showcase.items.map((s, j) => (j === i ? { ...s, image } : s)) },
                    }))
                  }
                />
                <Field label="Caption">
                  <Input
                    value={item.caption}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        showcase: { items: d.showcase.items.map((s, j) => (j === i ? { ...s, caption: e.target.value } : s)) },
                      }))
                    }
                  />
                </Field>
              </div>
            ))}
          </Section>

          {/* ---- Benefits ---- */}
          <Section title="Benefits & testimonial">
            <Field label="Section heading">
              <Input value={draft.benefits.heading} onChange={(e) => update((d) => ({ ...d, benefits: { ...d.benefits, heading: e.target.value } }))} />
            </Field>
            {draft.benefits.items.map((item, i) => (
              <Grid key={i} cols={2}>
                <Field label={`Benefit ${i + 1} title`}>
                  <Input
                    value={item.title}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        benefits: { ...d.benefits, items: d.benefits.items.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)) },
                      }))
                    }
                  />
                </Field>
                <Field label={`Benefit ${i + 1} text`}>
                  <Textarea
                    rows={2}
                    value={item.body}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        benefits: { ...d.benefits, items: d.benefits.items.map((s, j) => (j === i ? { ...s, body: e.target.value } : s)) },
                      }))
                    }
                  />
                </Field>
              </Grid>
            ))}
            <Field
              label="Testimonial"
              hint="Only use a real quote. The block stays hidden while this is empty, and a quote needs an attribution to publish."
            >
              <Textarea
                rows={3}
                value={draft.benefits.quote.text}
                onChange={(e) =>
                  update((d) => ({ ...d, benefits: { ...d.benefits, quote: { ...d.benefits.quote, text: e.target.value } } }))
                }
              />
            </Field>
            <Field label="Who said it" hint="e.g. “Sara, mom of two”">
              <Input
                value={draft.benefits.quote.attribution}
                onChange={(e) =>
                  update((d) => ({ ...d, benefits: { ...d.benefits, quote: { ...d.benefits.quote, attribution: e.target.value } } }))
                }
              />
            </Field>
          </Section>

          {/* ---- FAQ ---- */}
          <Section
            title="FAQ"
            hint="Answer the questions a parent actually asks. They're also published as structured data."
            action={
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="size-3.5" />}
                disabled={draft.faq.items.length >= MAX_FAQ_ITEMS}
                onClick={() =>
                  update((d) => ({ ...d, faq: { ...d.faq, items: [...d.faq.items, { question: "", answer: "" }] } }))
                }
              >
                Add question
              </Button>
            }
          >
            <Field label="Section heading">
              <Input value={draft.faq.heading} onChange={(e) => update((d) => ({ ...d, faq: { ...d.faq, heading: e.target.value } }))} />
            </Field>
            {draft.faq.items.map((item, i) => (
              <div key={i} className="space-y-2 rounded-xl bg-ink-50/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-500">Question {i + 1}</span>
                  <div className="flex gap-1">
                    <IconButton
                      label="Move up"
                      disabled={i === 0}
                      onClick={() => update((d) => ({ ...d, faq: { ...d.faq, items: move(d.faq.items, i, -1) } }))}
                    >
                      <ArrowUp className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label="Move down"
                      disabled={i === draft.faq.items.length - 1}
                      onClick={() => update((d) => ({ ...d, faq: { ...d.faq, items: move(d.faq.items, i, 1) } }))}
                    >
                      <ArrowDown className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label="Remove"
                      onClick={() =>
                        update((d) => ({ ...d, faq: { ...d.faq, items: d.faq.items.filter((_, j) => j !== i) } }))
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
                <Input
                  value={item.question}
                  placeholder="Question"
                  onChange={(e) =>
                    update((d) => ({
                      ...d,
                      faq: { ...d.faq, items: d.faq.items.map((f, j) => (j === i ? { ...f, question: e.target.value } : f)) },
                    }))
                  }
                />
                <Textarea
                  rows={3}
                  value={item.answer}
                  placeholder="Answer"
                  onChange={(e) =>
                    update((d) => ({
                      ...d,
                      faq: { ...d.faq, items: d.faq.items.map((f, j) => (j === i ? { ...f, answer: e.target.value } : f)) },
                    }))
                  }
                />
              </div>
            ))}
          </Section>

          {/* ---- Closing ---- */}
          <Section title="Closing call-to-action">
            <Grid cols={2}>
              <Field label="Heading">
                <Input value={draft.closing.heading} onChange={(e) => update((d) => ({ ...d, closing: { ...d.closing, heading: e.target.value } }))} />
              </Field>
              <Field label="Button label" hint="Blank reuses the hero button label.">
                <Input value={draft.closing.ctaLabel} onChange={(e) => update((d) => ({ ...d, closing: { ...d.closing, ctaLabel: e.target.value } }))} />
              </Field>
            </Grid>
          </Section>

          {/* ---- Related reading ---- */}
          <Section
            title="Related reading"
            hint="Blog articles sharing a tag appear under the page as internal links. Leave empty for none."
          >
            <Field label={`Tags (comma-separated, max ${MAX_TAGS})`}>
              <Input
                value={tagsText}
                placeholder="bedtime, personalization"
                onChange={(e) => {
                  setTagsText(e.target.value);
                  set({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .slice(0, MAX_TAGS),
                  });
                }}
              />
            </Field>
          </Section>

          {/* ---- SEO ---- */}
          <Section title="Search & sharing" hint="Everything here is optional — blank fields are filled in from the content above.">
            <SearchPreview
              url={`${siteUrl.replace(/\/$/, "")}${path}`}
              title={seoMeta.title}
              description={seoMeta.description}
            />
            <Disclosure label="Override title, description, share image">
              <div className="space-y-3 pt-1">
                <Field
                  label="Search title"
                  hint={`${draft.seo.title.length}/${TITLE_MAX} — blank uses the hero headline.`}
                  error={draft.seo.title.length > TITLE_MAX ? "Likely to be truncated in search results." : undefined}
                >
                  <Input value={draft.seo.title} onChange={(e) => update((d) => ({ ...d, seo: { ...d.seo, title: e.target.value } }))} />
                </Field>
                <Field
                  label="Meta description"
                  hint={`${draft.seo.description.length} characters (aim for ${DESC_MIN}–${DESC_MAX}) — blank uses the hero subtitle.`}
                >
                  <Textarea rows={3} value={draft.seo.description} onChange={(e) => update((d) => ({ ...d, seo: { ...d.seo, description: e.target.value } }))} />
                </Field>
                <ImageSlot
                  label="Share image"
                  image={draft.seo.ogImage}
                  slug={draft.slug || landingSlug(draft.locale, draft.title) || "page"}
                  onChange={(ogImage) => update((d) => ({ ...d, seo: { ...d.seo, ogImage } }))}
                  hint="1200×630 works best. Blank uses the hero image, then the site-wide share image."
                />
                <div className="flex items-center justify-between gap-4 rounded-xl bg-ink-50/50 p-3">
                  <div>
                    <p className="text-sm font-medium text-ink-700">Hide from search engines</p>
                    <p className="text-xs text-ink-500">
                      Adds <code>noindex</code> and drops the page from the sitemap. Use for ad-only pages that
                      duplicate another page.
                    </p>
                  </div>
                  <Toggle
                    checked={draft.seo.noindex}
                    label="Hide from search engines"
                    onChange={(noindex) => update((d) => ({ ...d, seo: { ...d.seo, noindex } }))}
                  />
                </div>
              </div>
            </Disclosure>
          </Section>

          {/* ---- Analytics ---- */}
          {!isNew && draft.status !== "draft" && (
            <Section title="Performance" hint="Cookieless first-party analytics, same as the blog.">
              <Disclosure label="Show analytics" defaultOpen>
                <BlogStatsPanel slug={landingStatsKey(draft)} load={loadLandingStats} />
              </Disclosure>
            </Section>
          )}
        </div>

        {showPreview && (
          <div className="min-w-0">
            <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white xl:sticky xl:top-4">
              <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/60 px-4 py-2 text-xs text-ink-500">
                <span>Live preview (unsaved)</span>
                <span className="font-mono">{path}</span>
              </div>
              <div className="max-h-[75vh] overflow-y-auto">
                <LandingPageTemplate page={draft} ctaHref={resolveCtaHref(draft)} embedded />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The page's status as one prominent control beside Save: a click, not a dropdown. */
function StatusSwitch({
  value,
  onChange,
}: {
  value: LandingStatus;
  onChange: (status: LandingStatus) => void;
}) {
  const active: Record<LandingStatus, string> = {
    draft: "bg-ink-600 text-white",
    published: "bg-emerald-600 text-white",
    retired: "bg-amber-500 text-white",
  };
  return (
    <div
      role="radiogroup"
      aria-label="Page status"
      className="inline-flex rounded-xl bg-ink-100 p-1"
    >
      {(["draft", "published", "retired"] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            value === s ? `${active[s]} shadow-2xs` : "text-ink-500 hover:text-ink-800"
          }`}
        >
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

function move<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Notice({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  const cls =
    tone === "red"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-amber-50 text-amber-800 ring-amber-200";
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ring-1 ring-inset ${cls}`}>
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** How the page will look as a Google result — a sanity check, not a guarantee. */
function SearchPreview({ url, title, description }: { url: string; title: string; description: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-ink-100">
      <p className="truncate text-xs text-ink-500">{url}</p>
      <p className="mt-0.5 truncate text-lg text-[#1a0dab]">{title || "Untitled"}</p>
      <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{description || "No description yet."}</p>
    </div>
  );
}

/** Upload / replace / remove one image, plus alt text (and optionally the image-model prompt). */
function ImageSlot({
  label,
  image,
  slug,
  onChange,
  hint,
  prompt,
  onPrompt,
}: {
  label: string;
  image: LandingImage | null;
  slug: string;
  onChange: (image: LandingImage | null) => void;
  hint?: string;
  prompt?: string;
  onPrompt?: (prompt: string) => void;
}) {
  const uploadLandingImage = useAppConfigStore((s) => s.uploadLandingImage);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      onChange(await uploadLandingImage(slug, base64, mimeType, image?.alt));
      toast.success("Image uploaded — save the page to keep it.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-28 w-40 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-ink-50 ring-1 ring-inset ring-ink-100">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.imageUrl} alt={image.alt} className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6 text-ink-300" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-ink-700">{label}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={uploading}
              leftIcon={<ImagePlus className="size-3.5" />}
              onClick={() => fileRef.current?.click()}
            >
              {image ? "Replace" : "Upload"}
            </Button>
            {image && (
              <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => onChange(null)}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
          {image && (
            <Input
              value={image.alt}
              placeholder="Alt text — describe what's in the image"
              onChange={(e) => onChange({ ...image, alt: e.target.value })}
            />
          )}
          {hint && <p className="text-xs text-ink-500">{hint}</p>}
        </div>
      </div>
      {onPrompt && (
        <Field
          label="Image prompt"
          hint="For you only — paste into an image model. Never shown on the page."
        >
          <div className="space-y-1.5">
            <Textarea rows={3} value={prompt ?? ""} onChange={(e) => onPrompt(e.target.value)} />
            {prompt && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Copy className="size-3.5" />}
                onClick={() => {
                  void navigator.clipboard.writeText(prompt);
                  toast.success("Prompt copied.");
                }}
              >
                Copy prompt
              </Button>
            )}
          </div>
        </Field>
      )}
    </div>
  );
}
