/**
 * Admin-managed **landing pages** — fixed-structure marketing pages whose copy
 * and images the admin edits, served at `/lp/{slug}`.
 *
 * Architecture mirrors the blog (`config/blog.ts`): full pages live in a
 * Firestore **collection** (`landingPages/{locale}__{slug}`), written only by
 * the admin-gated backend; a small world-readable **projection**
 * (`appConfig/landingPagesIndex`) lists the live pages so the sitemap, the
 * footer links, redirects and `hreflang` never read a full document.
 *
 * Three things deliberately differ from the blog:
 *
 *   - **Three lifecycle states.** `draft` is hidden, `published` is live,
 *     `retired` is taken offline *without deleting anything*. A retired page
 *     stays in the projection (with its optional redirect target) so old ad
 *     links and QR codes land somewhere sensible instead of a dead end —
 *     Firestore rules only expose `published` documents, so the projection is
 *     the only place that knowledge can live.
 *   - **Presentation is not stored.** Documents hold semantic content only
 *     (headline, steps, FAQ…), never class names or colours. `templateId`
 *     selects the renderer, so redesigning the template is a change to one
 *     component, and a second layout can live beside the first without
 *     migrating any page.
 *   - **Locale-ready.** Each language version is its OWN document (own slug,
 *     own status) linked to its siblings by `translationGroupId`. Pages are
 *     English-only today; the model, the doc id and the `hreflang` helpers
 *     already account for more, so publishing German later is an editor
 *     feature, not a data migration.
 *
 * Everything in this file is pure (no Firebase, no React) so it is importable
 * from the Next app, the Functions backend and `yarn check:landing` alike.
 */
import { z } from "zod";
import {
  DEFAULT_LOCALE,
  findLocale,
  localeOrDefault,
  localePath,
  transliterate,
  type LocaleDefinition,
} from "../i18n/locales";
import { localeUrl } from "../i18n/urls";

// ---- Constants ---------------------------------------------------------------

/** Renderers a page can select. Add an id here when a second layout ships. */
export const LANDING_TEMPLATE_IDS = ["story-v1"] as const;
export type LandingTemplateId = (typeof LANDING_TEMPLATE_IDS)[number];
export const DEFAULT_TEMPLATE_ID: LandingTemplateId = "story-v1";

export const LANDING_STATUSES = ["draft", "published", "retired"] as const;
export type LandingStatus = (typeof LANDING_STATUSES)[number];

/** Where every call-to-action points unless the admin overrides it. */
export const DEFAULT_CTA_HREF = "/studio";

/** The template is a fixed three-up layout in each of these places. */
export const STEP_COUNT = 3;
export const SHOWCASE_COUNT = 3;
export const BENEFIT_COUNT = 3;
export const MAX_HERO_BULLETS = 3;
export const MAX_FAQ_ITEMS = 12;
export const MAX_TAGS = 8;

/**
 * Slug ceiling. The analytics key is `lp-{locale}-{translationGroupId}`, which
 * is independent of the slug, so this only bounds the URL — but keep it short
 * enough to read in a share sheet.
 */
export const LANDING_SLUG_MAX = 60;

/** Path prefix every landing page lives under. */
export const LANDING_PATH_PREFIX = "/lp";

// ---- Types -------------------------------------------------------------------

export interface LandingImage {
  imageUrl: string;
  /** Storage path, so the backend can delete the file when it is no longer used. */
  storagePath?: string;
  /** Accessibility + image SEO. Falls back to the caption / headline when blank. */
  alt: string;
}

export interface LandingStep {
  title: string;
  body: string;
}

export interface LandingShowcaseItem {
  image: LandingImage | null;
  caption: string;
}

export interface LandingFaqItem {
  question: string;
  answer: string;
}

export interface LandingPage {
  version: 1;
  /** Which renderer draws this page. */
  templateId: LandingTemplateId;
  /** Language id from the locale manifest (`en`, `de`, …). */
  locale: string;
  /** Shared by every language version of one page; also keys the analytics. */
  translationGroupId: string;
  /** URL id within its locale. Unique per locale. */
  slug: string;
  /** Internal name: the admin list label and the public footer link text. */
  title: string;
  status: LandingStatus;
  /** Epoch ms of the first publish. */
  publishedAt: number | null;
  /** Epoch ms the page was last taken offline; null unless `retired`. */
  retiredAt: number | null;
  updatedAt: number;
  /**
   * The source version's `updatedAt` when this translation was last brought in
   * line with it. A source newer than this means the translation is stale.
   */
  translatedFromUpdatedAt: number | null;
  /** Earlier slugs of a page that was renamed — they redirect to the current one. */
  previousSlugs: string[];
  /** What a visitor to a RETIRED page is sent to. Blank = a clean 404. */
  retiredRedirect: string;
  /** Free-form topics; drive the "related reading" block on the page. */
  tags: string[];

  /** Where the call-to-action buttons go. Blank = {@link DEFAULT_CTA_HREF}. */
  ctaHref: string;

  hero: {
    eyebrow: string;
    /** The page's one `<h1>`. Also the default search title. */
    title: string;
    /** Also the default meta description. */
    subtitle: string;
    ctaLabel: string;
    bullets: string[];
    image: LandingImage | null;
    /** Authoring aid only (paste into an image model) — never rendered. */
    imagePrompt: string;
  };
  steps: { heading: string; items: LandingStep[] };
  showcase: { items: LandingShowcaseItem[] };
  benefits: {
    heading: string;
    items: LandingStep[];
    quote: { text: string; attribution: string };
  };
  faq: { heading: string; items: LandingFaqItem[] };
  closing: { heading: string; ctaLabel: string };

  seo: {
    /** Blank = the hero headline. */
    title: string;
    /** Blank = the hero subtitle, trimmed. */
    description: string;
    /** Blank = the hero image, then the site-wide share image. */
    ogImage: LandingImage | null;
    noindex: boolean;
  };
}

/** One live (published or retired) page in the public projection. */
export interface LandingPageSummary {
  /** `{locale}__{slug}` — the document id. */
  id: string;
  locale: string;
  translationGroupId: string;
  slug: string;
  title: string;
  status: "published" | "retired";
  noindex: boolean;
  publishedAt: number;
  retiredAt: number | null;
  updatedAt: number;
  previousSlugs: string[];
  retiredRedirect: string;
}

export interface LandingPagesIndex {
  version: 1;
  pages: LandingPageSummary[];
  updatedAt: number;
}

// ---- Identity ------------------------------------------------------------------

/**
 * URL-safe slug in a locale's own conventions (German `ü` → `ue`, `ß` → `ss`).
 *
 * `typing: true` is for a live input: it keeps a trailing dash so the admin can
 * type `bedtime-story` (the dash would otherwise vanish the moment it's typed,
 * before the next word). Finalise with the default on blur and on save.
 */
export function landingSlug(locale: string, input: string, opts: { typing?: boolean } = {}): string {
  const def = findLocale(locale) ?? localeOrDefault(DEFAULT_LOCALE);
  const slug = transliterate(def, input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .slice(0, LANDING_SLUG_MAX);
  return opts.typing ? slug : slug.replace(/-+$/g, "");
}

/** Document id: unique per locale so two languages can each own a slug. */
export function landingDocId(locale: string, slug: string): string {
  return `${locale}__${slug}`;
}

/** The inverse of {@link landingDocId}, or null for a malformed id. */
export function parseLandingDocId(id: string): { locale: string; slug: string } | null {
  const at = id.indexOf("__");
  if (at <= 0 || at === id.length - 2) return null;
  return { locale: id.slice(0, at), slug: id.slice(at + 2) };
}

/** A fresh group id: lowercase alphanumerics only, so it is safe in any key. */
export function newTranslationGroupId(): string {
  const raw =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return raw.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 16);
}

/**
 * Key under which this page's analytics are aggregated. Keyed by the
 * translation group rather than the slug so a rename doesn't orphan the
 * history. It reuses the blog's cookieless beacon and `blogStats` collection.
 */
export function landingStatsKey(page: Pick<LandingPage, "locale" | "translationGroupId">): string {
  return `lp-${page.locale}-${page.translationGroupId}`;
}

/** Public path for a page in its locale: `/lp/x` for English, `/de/lp/x` for German. */
export function landingPath(locale: string, slug: string): string {
  return localePath(localeOrDefault(locale), `${LANDING_PATH_PREFIX}/${slug}`);
}

// ---- Link safety ---------------------------------------------------------------

/**
 * Accept only a same-site path or an `https://` URL; anything else returns
 * `fallback`. CTA and redirect targets are admin-typed text rendered into
 * `href`/`Location`, so `javascript:`, `data:`, protocol-relative `//host` and
 * backslash tricks (`/\host`, which browsers read as `//host`) must never get
 * through.
 */
export function sanitizeHref(raw: unknown, fallback = ""): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 500) return fallback;
  if (/[\u0000-\u001f\u007f\s\\]/.test(s)) return fallback;
  if (s.startsWith("//")) return fallback;
  if (s.startsWith("/")) return s;
  try {
    const url = new URL(s);
    return url.protocol === "https:" ? s : fallback;
  } catch {
    return fallback;
  }
}

/** The CTA target for a page, always a safe href. */
export function resolveCtaHref(page: Pick<LandingPage, "ctaHref">): string {
  return sanitizeHref(page.ctaHref, DEFAULT_CTA_HREF);
}

/** True for an absolute URL (needs `rel` + a plain anchor rather than `next/link`). */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

// ---- Normalization ---------------------------------------------------------------

function str(v: unknown, fallback: string, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function trimmed(v: unknown, max = 2000): string {
  return str(v, "", max).trim();
}

function strArray(v: unknown, max: number, itemMax = 120): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, itemMax))
    .slice(0, max);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeImage(v: unknown): LandingImage | null {
  if (!v || typeof v !== "object") return null;
  const img = v as Partial<LandingImage>;
  const imageUrl = trimmed(img.imageUrl, 2000);
  if (!/^https?:\/\//i.test(imageUrl)) return null;
  const out: LandingImage = { imageUrl, alt: trimmed(img.alt, 300) };
  const storagePath = trimmed(img.storagePath, 500);
  if (storagePath) out.storagePath = storagePath;
  return out;
}

function normalizeStep(v: unknown): LandingStep {
  const s = (v ?? {}) as Partial<LandingStep>;
  return { title: trimmed(s.title, 120), body: trimmed(s.body, 600) };
}

function normalizeShowcaseItem(v: unknown): LandingShowcaseItem {
  const s = (v ?? {}) as Partial<LandingShowcaseItem>;
  return { image: normalizeImage(s.image), caption: trimmed(s.caption, 160) };
}

/** Exactly `count` items: pad with blanks, drop extras. The layout is a fixed grid. */
function fixed<T>(raw: unknown, count: number, normalize: (v: unknown) => T): T[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: count }, (_, i) => normalize(list[i]));
}

function normalizeFaq(v: unknown): LandingFaqItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      const it = (item ?? {}) as Partial<LandingFaqItem>;
      return { question: trimmed(it.question, 300), answer: trimmed(it.answer, 2000) };
    })
    .filter((it) => it.question.length > 0 && it.answer.length > 0)
    .slice(0, MAX_FAQ_ITEMS);
}

function normalizeStatus(v: unknown): LandingStatus {
  return (LANDING_STATUSES as readonly string[]).includes(v as string) ? (v as LandingStatus) : "draft";
}

export function createDefaultLandingPage(locale: string = DEFAULT_LOCALE): LandingPage {
  return {
    version: 1,
    templateId: DEFAULT_TEMPLATE_ID,
    locale,
    translationGroupId: newTranslationGroupId(),
    slug: "",
    title: "",
    status: "draft",
    publishedAt: null,
    retiredAt: null,
    updatedAt: Date.now(),
    translatedFromUpdatedAt: null,
    previousSlugs: [],
    retiredRedirect: "",
    tags: [],
    ctaHref: "",
    hero: {
      eyebrow: "",
      title: "",
      subtitle: "",
      ctaLabel: "",
      bullets: [],
      image: null,
      imagePrompt: "",
    },
    steps: { heading: "", items: fixed(undefined, STEP_COUNT, normalizeStep) },
    showcase: { items: fixed(undefined, SHOWCASE_COUNT, normalizeShowcaseItem) },
    benefits: {
      heading: "",
      items: fixed(undefined, BENEFIT_COUNT, normalizeStep),
      quote: { text: "", attribution: "" },
    },
    faq: { heading: "", items: [] },
    closing: { heading: "", ctaLabel: "" },
    seo: { title: "", description: "", ogImage: null, noindex: false },
  };
}

/**
 * Coerce anything (a stored doc, an admin payload, `undefined`) into a complete
 * page. Every string and list is bounded here, so the input schema only has to
 * check the shape of the envelope — this is the one place limits live.
 */
export function normalizeLandingPage(input: unknown): LandingPage {
  const d = createDefaultLandingPage();
  const s = (input ?? {}) as Partial<LandingPage> & Record<string, unknown>;
  const locale = typeof s.locale === "string" && findLocale(s.locale) ? s.locale : DEFAULT_LOCALE;
  const title = trimmed(s.title, 200);
  const rawSlug = trimmed(s.slug, 120);
  const slug = landingSlug(locale, rawSlug || title);
  const status = normalizeStatus(s.status);

  const hero = (s.hero ?? {}) as Partial<LandingPage["hero"]>;
  const steps = (s.steps ?? {}) as Partial<LandingPage["steps"]>;
  const showcase = (s.showcase ?? {}) as Partial<LandingPage["showcase"]>;
  const benefits = (s.benefits ?? {}) as Partial<LandingPage["benefits"]>;
  const quote = (benefits.quote ?? {}) as Partial<LandingPage["benefits"]["quote"]>;
  const faq = (s.faq ?? {}) as Partial<LandingPage["faq"]>;
  const closing = (s.closing ?? {}) as Partial<LandingPage["closing"]>;
  const seo = (s.seo ?? {}) as Partial<LandingPage["seo"]>;

  const groupId = trimmed(s.translationGroupId, 40).replace(/[^a-z0-9]/gi, "").toLowerCase();

  return {
    version: 1,
    templateId: (LANDING_TEMPLATE_IDS as readonly string[]).includes(s.templateId as string)
      ? (s.templateId as LandingTemplateId)
      : DEFAULT_TEMPLATE_ID,
    locale,
    translationGroupId: groupId || d.translationGroupId,
    slug,
    title,
    status,
    publishedAt: num(s.publishedAt),
    retiredAt: status === "retired" ? num(s.retiredAt) : null,
    updatedAt: num(s.updatedAt) ?? d.updatedAt,
    translatedFromUpdatedAt: num(s.translatedFromUpdatedAt),
    previousSlugs: strArray(s.previousSlugs, 20, LANDING_SLUG_MAX).filter((p) => p !== slug),
    retiredRedirect: sanitizeHref(s.retiredRedirect),
    tags: strArray(s.tags, MAX_TAGS, 40),
    ctaHref: sanitizeHref(s.ctaHref),
    hero: {
      eyebrow: trimmed(hero.eyebrow, 160),
      title: trimmed(hero.title, 200),
      subtitle: trimmed(hero.subtitle, 600),
      ctaLabel: trimmed(hero.ctaLabel, 60),
      bullets: strArray(hero.bullets, MAX_HERO_BULLETS, 80),
      image: normalizeImage(hero.image),
      imagePrompt: trimmed(hero.imagePrompt, 1200),
    },
    steps: {
      heading: trimmed(steps.heading, 200),
      items: fixed(steps.items, STEP_COUNT, normalizeStep),
    },
    showcase: { items: fixed(showcase.items, SHOWCASE_COUNT, normalizeShowcaseItem) },
    benefits: {
      heading: trimmed(benefits.heading, 200),
      items: fixed(benefits.items, BENEFIT_COUNT, normalizeStep),
      quote: { text: trimmed(quote.text, 400), attribution: trimmed(quote.attribution, 160) },
    },
    faq: { heading: trimmed(faq.heading, 200), items: normalizeFaq(faq.items) },
    closing: { heading: trimmed(closing.heading, 200), ctaLabel: trimmed(closing.ctaLabel, 60) },
    seo: {
      title: trimmed(seo.title, 200),
      description: trimmed(seo.description, 400),
      ogImage: normalizeImage(seo.ogImage),
      noindex: seo.noindex === true,
    },
  };
}

/**
 * Why a page can't go live yet, as human-readable reasons. Empty means it can.
 * Checked by the backend on publish and shown live in the editor, so the admin
 * learns what's missing before pressing the button rather than after.
 */
export function landingPublishBlockers(page: LandingPage): string[] {
  const out: string[] = [];
  if (!page.slug) out.push("a slug");
  if (!page.title) out.push("a page name");
  if (!page.hero.title) out.push("a hero headline");
  if (!page.hero.ctaLabel) out.push("a hero button label");
  if (page.ctaHref && !sanitizeHref(page.ctaHref)) out.push("a valid button link");
  // A quote with no source reads as invented, and an invented review on a public
  // page is a trust and legal problem — so a testimonial must say who said it.
  if (page.benefits.quote.text && !page.benefits.quote.attribution) {
    out.push("an attribution for the testimonial (or remove the quote)");
  }
  return out;
}

/** All Storage paths a page's images occupy (deduped), for cleanup on delete. */
export function landingStoragePaths(page: LandingPage): string[] {
  const paths = [
    page.hero.image?.storagePath,
    page.seo.ogImage?.storagePath,
    ...page.showcase.items.map((i) => i.image?.storagePath),
  ].filter((p): p is string => Boolean(p));
  return [...new Set(paths)];
}

// ---- Projection ------------------------------------------------------------------

/** Project a published/retired page down to its index entry. */
export function toLandingSummary(page: LandingPage): LandingPageSummary {
  return {
    id: landingDocId(page.locale, page.slug),
    locale: page.locale,
    translationGroupId: page.translationGroupId,
    slug: page.slug,
    title: page.title || page.hero.title,
    status: page.status === "retired" ? "retired" : "published",
    noindex: page.seo.noindex,
    publishedAt: page.publishedAt ?? page.updatedAt,
    retiredAt: page.retiredAt,
    updatedAt: page.updatedAt,
    previousSlugs: page.previousSlugs,
    retiredRedirect: page.retiredRedirect,
  };
}

export function createDefaultLandingIndex(): LandingPagesIndex {
  return { version: 1, pages: [], updatedAt: Date.now() };
}

export function normalizeLandingIndex(input: unknown): LandingPagesIndex {
  const s = (input ?? {}) as Partial<LandingPagesIndex>;
  const pages: LandingPageSummary[] = [];
  for (const raw of Array.isArray(s.pages) ? s.pages : []) {
    const p = (raw ?? {}) as Partial<LandingPageSummary>;
    const locale = typeof p.locale === "string" && findLocale(p.locale) ? p.locale : "";
    const slug = trimmed(p.slug, 120);
    if (!locale || !slug) continue;
    if (p.status !== "published" && p.status !== "retired") continue;
    pages.push({
      id: landingDocId(locale, slug),
      locale,
      translationGroupId: trimmed(p.translationGroupId, 40),
      slug,
      title: trimmed(p.title, 200),
      status: p.status,
      noindex: p.noindex === true,
      publishedAt: num(p.publishedAt) ?? 0,
      retiredAt: num(p.retiredAt),
      updatedAt: num(p.updatedAt) ?? 0,
      previousSlugs: strArray(p.previousSlugs, 20, LANDING_SLUG_MAX),
      retiredRedirect: sanitizeHref(p.retiredRedirect),
    });
  }
  pages.sort((a, b) => b.publishedAt - a.publishedAt);
  return {
    version: 1,
    pages: pages.slice(0, 500),
    updatedAt: num(s.updatedAt) ?? Date.now(),
  };
}

// ---- Routing ---------------------------------------------------------------------

export type LandingRoute =
  | { kind: "page"; entry: LandingPageSummary }
  | { kind: "redirect"; to: string; permanent: boolean }
  | { kind: "notFound" };

/**
 * Decide what a request for `/lp/{slug}` in `locale` should do.
 *
 *  1. A published page → serve it.
 *  2. A retired page → its redirect target if the admin set one, else 404.
 *  3. A slug the page used to have → a permanent redirect to wherever that
 *     page is now (or its retire target), so a rename never costs the ranking.
 *  4. Anything else → 404.
 *
 * A draft is not in the projection at all, so it falls through to 404 — exactly
 * the response an unknown slug gets, which is the point.
 */
export function resolveLandingRoute(
  index: LandingPagesIndex,
  locale: string,
  slug: string,
): LandingRoute {
  const here = index.pages.filter((p) => p.locale === locale);

  const exact = here.find((p) => p.slug === slug);
  if (exact) return routeFor(exact, false);

  const moved = here.find((p) => p.previousSlugs.includes(slug));
  if (moved) return routeFor(moved, true);

  return { kind: "notFound" };
}

function routeFor(entry: LandingPageSummary, viaOldSlug: boolean): LandingRoute {
  if (entry.status === "published") {
    return viaOldSlug
      ? { kind: "redirect", to: landingPath(entry.locale, entry.slug), permanent: true }
      : { kind: "page", entry };
  }
  // Retired: a temporary redirect — the page may come back, and a permanent one
  // would be cached by browsers well past that.
  return entry.retiredRedirect
    ? { kind: "redirect", to: entry.retiredRedirect, permanent: false }
    : { kind: "notFound" };
}

// ---- hreflang / sitemap / links -------------------------------------------------------

/** Pages that are publicly indexable: published, not noindex, in a live locale. */
function indexable(
  index: LandingPagesIndex,
  liveLocales: readonly LocaleDefinition[],
): LandingPageSummary[] {
  const live = new Set(liveLocales.map((l) => l.id));
  return index.pages.filter((p) => p.status === "published" && !p.noindex && live.has(p.locale));
}

/**
 * The `hreflang` map for one page: itself plus every *live* sibling in its
 * translation group, in `alternates.languages` shape.
 *
 * Differs from `hreflangLanguages` in `core/i18n/urls.ts` in one way that
 * matters: that helper assumes one path for every locale, which is true of
 * `/blog` and false here, where the German page has its own German slug.
 *
 * A sibling that is draft, retired, `noindex`, or in an unpublished locale is
 * left out — and since every page computes the same cluster, leaving it out of
 * one page's map leaves it out of all of them, which is what keeps the links
 * reciprocal. `undefined` while there is only one version: a one-entry map
 * tells a crawler nothing its canonical hasn't.
 */
export function landingHreflang(
  siteUrl: string,
  index: LandingPagesIndex,
  page: Pick<LandingPageSummary, "locale" | "translationGroupId" | "slug">,
  liveLocales: readonly LocaleDefinition[],
): Record<string, string> | undefined {
  const siblings = indexable(index, liveLocales).filter(
    (p) => p.translationGroupId === page.translationGroupId,
  );
  // One version per locale; if an admin duplicated within a locale, the page
  // being rendered wins, then the oldest.
  const byLocale = new Map<string, LandingPageSummary>();
  for (const p of [...siblings].sort((a, b) => a.publishedAt - b.publishedAt)) {
    if (!byLocale.has(p.locale)) byLocale.set(p.locale, p);
  }
  const self = siblings.find((p) => p.locale === page.locale && p.slug === page.slug);
  if (self) byLocale.set(self.locale, self);
  if (byLocale.size < 2 || !byLocale.has(page.locale)) return undefined;

  const languages: Record<string, string> = {};
  for (const entry of byLocale.values()) {
    const def = findLocale(entry.locale);
    if (!def) continue;
    const url = localeUrl(siteUrl, def, `${LANDING_PATH_PREFIX}/${entry.slug}`);
    for (const tag of def.hreflang) languages[tag] = url;
    if (def.xDefault) languages["x-default"] = url;
  }
  return languages;
}

export interface LandingSitemapEntry {
  url: string;
  lastModified: Date;
  languages?: Record<string, string>;
}

/** Sitemap rows for every indexable landing page, with their `hreflang` alternates. */
export function landingSitemapEntries(
  siteUrl: string,
  index: LandingPagesIndex,
  liveLocales: readonly LocaleDefinition[],
): LandingSitemapEntry[] {
  return indexable(index, liveLocales).map((p) => {
    const def = localeOrDefault(p.locale);
    return {
      url: localeUrl(siteUrl, def, `${LANDING_PATH_PREFIX}/${p.slug}`),
      lastModified: new Date(p.updatedAt),
      languages: landingHreflang(siteUrl, index, p, liveLocales),
    };
  });
}

export interface LandingLink {
  href: string;
  label: string;
}

/**
 * Footer links to the live pages in a locale. Every indexable page that no
 * other page links to is an "orphan" crawlers rank poorly, so publishing a page
 * puts it here automatically — site-wide internal links, no admin step.
 */
export function landingFooterLinks(
  index: LandingPagesIndex,
  locale: string,
  liveLocales: readonly LocaleDefinition[],
  limit = 6,
): LandingLink[] {
  return indexable(index, liveLocales)
    .filter((p) => p.locale === locale && p.title)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, limit)
    .map((p) => ({ href: landingPath(p.locale, p.slug), label: p.title }));
}

// ---- SEO derivation ----------------------------------------------------------------

/** Trim to `max` characters on a word boundary, adding an ellipsis when cut. */
export function truncateAtWord(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

export interface LandingSeo {
  title: string;
  description: string;
  /** Resolved share image, or null to fall back to the site-wide one. */
  image: LandingImage | null;
  /** The page's own robots stance, before the global switch is applied. */
  noindex: boolean;
}

/**
 * Everything a search result or share card needs, derived from the content so
 * the admin only has to fill the overrides they care about.
 */
export function resolveLandingSeo(page: LandingPage): LandingSeo {
  return {
    title: page.seo.title || page.hero.title || page.title,
    description: page.seo.description || truncateAtWord(page.hero.subtitle),
    image: page.seo.ogImage ?? page.hero.image,
    noindex: page.seo.noindex,
  };
}

/** Alt text that is never empty: the admin's, else the caption, else the headline. */
export function imageAlt(image: LandingImage | null, ...fallbacks: string[]): string {
  return image?.alt || fallbacks.find((f) => f.trim()) || "";
}

// ---- Validation (backend, before persisting) ---------------------------------------

/**
 * Envelope check only. `normalizeLandingPage` clamps every field, so listing
 * each one here would just be a second copy of the limits to keep in step.
 */
export const landingPageInputSchema = z.looseObject({
  title: z.string().max(200),
  slug: z.string().max(120).optional(),
  locale: z.string().max(10).optional(),
  status: z.enum(LANDING_STATUSES).optional(),
});
