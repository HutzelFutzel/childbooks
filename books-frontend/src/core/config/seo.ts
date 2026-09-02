/**
 * Global, admin-managed **SEO** configuration for the marketing site.
 *
 * Owns everything the public landing page needs to rank and share well: page
 * title/description, canonical + social (Open Graph / Twitter) metadata, robots
 * indexing flags, search-console verification tokens, structured-data
 * (Organization + FAQ) inputs, and the FAQ content itself (single source of
 * truth for both the on-page accordion and the FAQPage JSON-LD).
 *
 * Stored at the world-readable `appConfig/seo` doc so it can be read live in the
 * browser AND server-side inside `generateMetadata` / `sitemap` / `robots`.
 * Writes go only through the admin-gated backend (`/admin/config/seo`).
 */
import { z } from "zod";

export interface SeoOrganization {
  /** Legal / brand name used in Organization structured data. */
  name: string;
  /** Social / authoritative profile URLs (schema.org `sameAs`). */
  sameAs: string[];
}

export interface SeoVerification {
  /** Google Search Console `google-site-verification` token. */
  google: string;
  /** Bing Webmaster Tools `msvalidate.01` token. */
  bing: string;
}

export interface SeoFaqItem {
  question: string;
  answer: string;
}

/**
 * Fixed marketing routes whose title/description can be overridden in Admin →
 * Marketing → SEO → Pages. The landing page (`/`) stays in the General fields
 * (`titleDefault` / `description`) so site identity isn't duplicated.
 */
export const SEO_PAGE_IDS = ["/contact", "/affiliates", "/blog", "/print-pricing"] as const;
export type SeoPageId = (typeof SEO_PAGE_IDS)[number];

export function isSeoPageId(v: unknown): v is SeoPageId {
  return typeof v === "string" && (SEO_PAGE_IDS as readonly string[]).includes(v);
}

/** Per-route meta overrides. Empty strings mean "use the code default". */
export interface SeoPageMeta {
  title: string;
  description: string;
}

export interface SeoConfig {
  version: 1;
  /** Brand/site name (used in titles + structured data). */
  siteName: string;
  /** Canonical base URL, no trailing slash, e.g. https://childbook.studio. */
  siteUrl: string;
  /** Default <title> for the landing page. */
  titleDefault: string;
  /** Title template for child pages, must contain "%s". */
  titleTemplate: string;
  /** Meta description (~155 chars is the sweet spot). */
  description: string;
  /** Meta keywords (largely legacy, but cheap to expose). */
  keywords: string[];
  /** Canonical path for the landing page (usually "/"). */
  canonicalPath: string;
  /** Twitter handle including the leading "@". */
  twitterHandle: string;
  /** Twitter card style. */
  twitterCard: "summary" | "summary_large_image";
  /** Robots directives; flip off to de-index staging. */
  robots: { index: boolean; follow: boolean };
  /** Organization structured data. */
  organization: SeoOrganization;
  /** Search-engine site verification tokens. */
  verification: SeoVerification;
  /** FAQ content — powers the on-page accordion AND the FAQPage JSON-LD. */
  faq: SeoFaqItem[];
  /**
   * Optional title/description overrides for fixed marketing routes. Missing or
   * blank fields fall back to {@link defaultSeoPageMeta}.
   */
  pages: Partial<Record<SeoPageId, SeoPageMeta>>;
  updatedAt: number;
}

/** Human labels for the admin Pages editor. */
export const SEO_PAGE_LABELS: Record<SeoPageId, string> = {
  "/contact": "Contact",
  "/affiliates": "Affiliate program",
  "/blog": "Blog",
  "/print-pricing": "Print pricing",
};

/** Code defaults when an admin override is empty. */
export function defaultSeoPageMeta(path: SeoPageId, siteName = "Childbook Studio"): SeoPageMeta {
  switch (path) {
    case "/contact":
      return {
        title: "Contact",
        description: `Get in touch with the ${siteName} team.`,
      };
    case "/affiliates":
      return {
        title: "Affiliate program",
        description: `Earn commission by sharing ${siteName} with your audience. Apply to join our curated affiliate program.`,
      };
    case "/blog":
      return {
        title: "Blog",
        description: `Guides, ideas and inspiration for making personalized children's books with ${siteName}.`,
      };
    case "/print-pricing":
      return {
        title: "Print pricing calculator",
        description:
          "See exactly what printing a custom children's book costs — by format, page count, paper, copies and destination. No account needed.",
      };
  }
}

/** Resolve title/description for a marketing route (admin override or default). */
export function resolveSeoPage(config: SeoConfig, path: SeoPageId): SeoPageMeta {
  const fallback = defaultSeoPageMeta(path, config.siteName);
  const override = config.pages[path];
  const title = override?.title?.trim();
  const description = override?.description?.trim();
  return {
    title: title || fallback.title,
    description: description || fallback.description,
  };
}

const DEFAULT_SITE_URL = "https://childbook.studio";

export function createDefaultSeoConfig(): SeoConfig {
  return {
    version: 1,
    siteName: "Childbook Studio",
    siteUrl: DEFAULT_SITE_URL,
    titleDefault: "Childbook Studio — AI-illustrated children's books",
    titleTemplate: "%s · Childbook Studio",
    description:
      "Write, illustrate, and print custom children's picture books with AI. Consistent characters, beautiful layouts, and print-ready export.",
    keywords: [
      "children's books",
      "AI illustration",
      "picture book maker",
      "personalized books",
      "print-on-demand books",
    ],
    canonicalPath: "/",
    twitterHandle: "@childbook",
    twitterCard: "summary_large_image",
    robots: { index: true, follow: true },
    organization: {
      name: "Childbook Studio",
      sameAs: [],
    },
    verification: { google: "", bing: "" },
    faq: [
      {
        question: "Do I need an account or credit card to start?",
        answer:
          "No. You can jump straight in, write your story, choose an art style, and preview your complete illustrated book for free without creating an account or entering a credit card.",
      },
      {
        question: "Can I make a story with multiple siblings or characters?",
        answer:
          "Yes! You can add multiple names (e.g. 'Noah & Mia'). Our guided story writer creates adventures where each child plays an active role, and each character receives their own consistent design across every page.",
      },
      {
        question: "Can I edit the words and change the illustrations?",
        answer:
          "Absolutely. You have full creative control. You can edit every sentence, change page layouts, re-roll illustrations with refined directions, or adjust character details anytime.",
      },
      {
        question: "What is the quality of the printed books?",
        answer:
          "We produce library-grade heirloom hardcovers with thick, smudge-resistant paper and vivid full-color printing. Books are professionally bound and shipped worldwide in protective packaging.",
      },
      {
        question: "Do I have to subscribe to order a printed book?",
        answer:
          "No. Subscriptions are completely optional for regular makers who want monthly creation credits and print discounts. You can always create and order single books on demand whenever you like.",
      },
    ],
    pages: {},
    updatedAt: Date.now(),
  };
}

// ---- Normalization ---------------------------------------------------------

function str(v: unknown, fallback: string, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function strArray(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max);
}

function normalizeFaq(v: unknown): SeoFaqItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      const it = (item ?? {}) as Partial<SeoFaqItem>;
      return {
        question: str(it.question, "", 300).trim(),
        answer: str(it.answer, "", 2000).trim(),
      };
    })
    .filter((it) => it.question.length > 0 && it.answer.length > 0)
    .slice(0, 30);
}

function normalizePages(v: unknown): SeoConfig["pages"] {
  if (!v || typeof v !== "object") return {};
  const raw = v as Record<string, unknown>;
  const pages: SeoConfig["pages"] = {};
  for (const id of SEO_PAGE_IDS) {
    const entry = raw[id];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<SeoPageMeta>;
    pages[id] = {
      title: str(e.title, "", 200).trim(),
      description: str(e.description, "", 500).trim(),
    };
  }
  return pages;
}

export function normalizeSeoConfig(input: unknown): SeoConfig {
  const d = createDefaultSeoConfig();
  const s = (input ?? {}) as Partial<SeoConfig>;
  const org = (s.organization ?? {}) as Partial<SeoOrganization>;
  const ver = (s.verification ?? {}) as Partial<SeoVerification>;
  const robots = (s.robots ?? {}) as Partial<SeoConfig["robots"]>;

  const canonicalPath = str(s.canonicalPath, d.canonicalPath, 300);

  return {
    version: 1,
    siteName: str(s.siteName, d.siteName, 200),
    siteUrl: stripTrailingSlash(str(s.siteUrl, d.siteUrl, 500)),
    titleDefault: str(s.titleDefault, d.titleDefault, 200),
    titleTemplate: (() => {
      const t = str(s.titleTemplate, d.titleTemplate, 200);
      return t.includes("%s") ? t : d.titleTemplate;
    })(),
    description: str(s.description, d.description, 500),
    keywords: strArray(s.keywords),
    canonicalPath: canonicalPath.startsWith("/") ? canonicalPath : `/${canonicalPath}`,
    twitterHandle: str(s.twitterHandle, d.twitterHandle, 60),
    twitterCard: s.twitterCard === "summary" ? "summary" : "summary_large_image",
    robots: {
      index: robots.index !== false,
      follow: robots.follow !== false,
    },
    organization: {
      name: str(org.name, d.organization.name, 200),
      sameAs: strArray(org.sameAs, 25),
    },
    verification: {
      google: str(ver.google, "", 200),
      bing: str(ver.bing, "", 200),
    },
    faq: normalizeFaq(s.faq),
    pages: normalizePages(s.pages),
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
  };
}

// ---- Validation (backend, before persisting) -------------------------------

export const seoConfigSchema = z.object({
  version: z.literal(1).optional(),
  siteName: z.string().max(200).optional(),
  siteUrl: z.string().max(500).optional(),
  titleDefault: z.string().max(200).optional(),
  titleTemplate: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  keywords: z.array(z.string()).optional(),
  canonicalPath: z.string().max(300).optional(),
  twitterHandle: z.string().max(60).optional(),
  twitterCard: z.enum(["summary", "summary_large_image"]).optional(),
  robots: z.object({ index: z.boolean(), follow: z.boolean() }).partial().optional(),
  organization: z
    .object({
      name: z.string().max(200),
      sameAs: z.array(z.string()),
    })
    .partial()
    .optional(),
  verification: z
    .object({ google: z.string().max(200), bing: z.string().max(200) })
    .partial()
    .optional(),
  faq: z
    .array(z.object({ question: z.string().max(300), answer: z.string().max(2000) }))
    .optional(),
  pages: z
    .record(
      z.string(),
      z.object({
        title: z.string().max(200),
        description: z.string().max(500),
      }),
    )
    .optional(),
  updatedAt: z.number().optional(),
});
