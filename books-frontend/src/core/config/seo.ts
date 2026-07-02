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
  updatedAt: number;
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
        question: "Do I need an account to start?",
        answer:
          "No. Childbook Studio is guest-first — you can start writing and illustrating a book right away, then create an account whenever you want to save or print.",
      },
      {
        question: "How does the AI keep characters consistent?",
        answer:
          "You design your characters and places once as references. Every page reuses them, so your cast keeps the same look, outfits, and style across the whole book.",
      },
      {
        question: "Can I get a real printed book?",
        answer:
          "Yes. When you're happy with your story, we lay it out as a full-bleed, print-ready book and handle fulfillment so a physical copy ships to your door.",
      },
      {
        question: "What are Sparks?",
        answer:
          "Sparks are the credits used for AI generation. Paid plans include a monthly bundle of Sparks that roll over, plus cheaper prints and no watermark on shared books.",
      },
    ],
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
  updatedAt: z.number().optional(),
});
