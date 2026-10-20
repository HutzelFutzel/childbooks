/**
 * Landing-page invariants — the properties that don't throw when they break.
 *
 * A retired page that keeps serving; a draft that leaks into the sitemap; a
 * `javascript:` URL an admin (or a compromised admin session) turned into a
 * button; a German page whose hreflang points at a sibling that 404s; a renamed
 * slug that silently loses its ranking. None of them show up in a typecheck.
 *
 * Run by `yarn check:landing`, which bundles this against the shipped
 * `core/config/landingPages.ts` rather than restating the rules.
 */
import {
  DEFAULT_CTA_HREF,
  createDefaultLandingPage,
  landingDocId,
  landingFooterLinks,
  landingHreflang,
  landingPublishBlockers,
  landingSitemapEntries,
  landingSlug,
  normalizeLandingIndex,
  normalizeLandingPage,
  resolveCtaHref,
  resolveLandingRoute,
  resolveLandingSeo,
  sanitizeHref,
  toLandingSummary,
  truncateAtWord,
  type LandingPage,
  type LandingPagesIndex,
} from "../books-frontend/src/core/config/landingPages";
import { LANDING_SEED_PAGES } from "../books-frontend/src/core/config/landingPagesSeed";
import { findLocale } from "../books-frontend/src/core/i18n/locales";
import { jsonLdHtml } from "../books-frontend/src/ui/marketing/jsonLdHtml";

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

const SITE = "https://example.com";
const en = findLocale("en")!;
const de = findLocale("de")!;

function page(over: Partial<LandingPage> & { slug: string }): LandingPage {
  const base = createDefaultLandingPage(over.locale ?? "en");
  return {
    ...base,
    title: "A page",
    hero: { ...base.hero, title: "Headline", ctaLabel: "Go" },
    publishedAt: 1_000,
    ...over,
  };
}

function indexOf(...pages: LandingPage[]): LandingPagesIndex {
  return {
    version: 1,
    updatedAt: 0,
    pages: pages
      .filter((p) => p.status !== "draft")
      .map((p) => toLandingSummary({ ...p, publishedAt: p.publishedAt ?? 1_000 })),
  };
}

// ---- Links an admin types become hrefs on a public page -----------------------------
for (const bad of [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>1</script>",
  "//evil.example",
  "/\\evil.example",
  "http://insecure.example",
  "/stu dio",
  "/stu\ndio",
  "/stu\tdio",
  "studio",
  "",
]) {
  check(`sanitizeHref rejects ${JSON.stringify(bad)}`, sanitizeHref(bad) === "", sanitizeHref(bad));
}
check("sanitizeHref keeps /studio", sanitizeHref("/studio") === "/studio");
check("sanitizeHref keeps a path with a query", sanitizeHref("/studio?src=ad") === "/studio?src=ad");
check("sanitizeHref keeps https", sanitizeHref("https://example.com/x") === "https://example.com/x");
check("blank CTA resolves to the studio", resolveCtaHref({ ctaHref: "" }) === DEFAULT_CTA_HREF);
check("an unsafe CTA falls back to the studio", resolveCtaHref({ ctaHref: "javascript:1" }) === DEFAULT_CTA_HREF);
check("a custom CTA is honoured", resolveCtaHref({ ctaHref: "/blog" }) === "/blog");

// ---- JSON-LD can't break out of its script tag --------------------------------------
{
  const html = jsonLdHtml({ q: "</script><script>alert(1)</script>", sep: "a\u2028b" });
  check("jsonLdHtml escapes `<`", !html.includes("<"));
  check("jsonLdHtml escapes U+2028", !html.includes("\u2028"));
  check(
    "jsonLdHtml still round-trips",
    (JSON.parse(html) as { q: string }).q === "</script><script>alert(1)</script>",
  );
}

// ---- Slugs ------------------------------------------------------------------------
check("slug lowercases and hyphenates", landingSlug("en", "Bedtime Story Book!") === "bedtime-story-book");
check("German umlauts transliterate", landingSlug("de", "Gute-Nacht-Geschichte für Kinder") === "gute-nacht-geschichte-fuer-kinder", landingSlug("de", "Gute-Nacht-Geschichte für Kinder"));
check("German ß transliterates", landingSlug("de", "Straße") === "strasse", landingSlug("de", "Straße"));
check("slug never has leading/trailing hyphens", !/^-|-$/.test(landingSlug("en", "  --hello--  ")));
check("doc id is locale-scoped", landingDocId("en", "x") !== landingDocId("de", "x"));

// ---- Normalisation: templates can rely on fixed shapes ------------------------------
{
  const n = normalizeLandingPage({ title: "x", steps: { items: [{ title: "only one" }] } });
  check("steps are padded to three", n.steps.items.length === 3);
  check("showcase is padded to three", n.showcase.items.length === 3);
  check("benefits are padded to three", n.benefits.items.length === 3);
  const many = normalizeLandingPage({
    title: "x",
    hero: { bullets: ["a", "b", "c", "d", "e"] },
    faq: { items: Array.from({ length: 40 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` })) },
  });
  check("hero bullets are capped", many.hero.bullets.length <= 3);
  check("FAQ is capped", many.faq.items.length <= 12);
  const hostile = normalizeLandingPage({ title: "x", ctaHref: "javascript:alert(1)", retiredRedirect: "//evil.example" });
  check("normalize strips an unsafe CTA", hostile.ctaHref === "");
  check("normalize strips an unsafe retire redirect", hostile.retiredRedirect === "");
  const garbage = normalizeLandingPage(null);
  check("garbage normalizes to a draft", garbage.status === "draft");
  check("an unknown status becomes a draft", normalizeLandingPage({ status: "live" }).status === "draft");
  check("an unknown template falls back", normalizeLandingPage({ templateId: "nope" }).templateId === "story-v1");
}

// ---- Publishing needs the basics ----------------------------------------------------
{
  const ok = page({ slug: "a" });
  check("a complete page has no blockers", landingPublishBlockers(ok).length === 0, landingPublishBlockers(ok).join(", "));
  check("no slug blocks publishing", landingPublishBlockers({ ...ok, slug: "" }).length > 0);
  check(
    "no headline blocks publishing",
    landingPublishBlockers({ ...ok, hero: { ...ok.hero, title: "" } }).length > 0,
  );
  const quoted = {
    ...ok,
    benefits: { ...ok.benefits, quote: { text: "Loved it", attribution: "" } },
  };
  check("an unattributed testimonial blocks publishing", landingPublishBlockers(quoted).length > 0);
  check(
    "an attributed testimonial publishes",
    landingPublishBlockers({ ...quoted, benefits: { ...quoted.benefits, quote: { text: "Loved it", attribution: "Sara" } } }).length === 0,
  );
}

// ---- Routing: what a visitor to /lp/{slug} gets -------------------------------------
{
  const live = page({ slug: "live", status: "published", previousSlugs: ["old-name"] });
  const retired = page({ slug: "gone", status: "retired", retiredAt: 5 });
  const retiredTo = page({ slug: "gone-redirect", status: "retired", retiredRedirect: "/blog" });
  const draft = page({ slug: "secret", status: "draft" });
  const index = indexOf(live, retired, retiredTo, draft);

  check("published page is served", resolveLandingRoute(index, "en", "live").kind === "page");
  check("draft is a 404", resolveLandingRoute(index, "en", "secret").kind === "notFound");
  check("unknown slug is a 404", resolveLandingRoute(index, "en", "nope").kind === "notFound");
  check("retired without a target is a 404", resolveLandingRoute(index, "en", "gone").kind === "notFound");
  const r = resolveLandingRoute(index, "en", "gone-redirect");
  check(
    "retired with a target redirects there, temporarily",
    r.kind === "redirect" && r.to === "/blog" && r.permanent === false,
  );
  const moved = resolveLandingRoute(index, "en", "old-name");
  check(
    "an old slug redirects permanently to the current one",
    moved.kind === "redirect" && moved.permanent === true && moved.to === "/lp/live",
    JSON.stringify(moved),
  );
  check("slugs don't leak across locales", resolveLandingRoute(index, "de", "live").kind === "notFound");
  check("a draft never reaches the public index", !index.pages.some((p) => p.slug === "secret"));
}

// ---- hreflang: reciprocal, only live siblings ---------------------------------------
{
  const group = "grp-1";
  const enPage = page({ slug: "bedtime-story-book", status: "published", translationGroupId: group });
  const dePage = page({
    slug: "gute-nacht-geschichte",
    locale: "de",
    status: "published",
    translationGroupId: group,
  });
  const index = indexOf(enPage, dePage);

  const alone = landingHreflang(SITE, index, enPage, [en]);
  check("one live locale emits no hreflang", alone === undefined);

  const both = landingHreflang(SITE, index, enPage, [en, de]);
  const fromDe = landingHreflang(SITE, index, dePage, [en, de]);
  check("two live locales emit hreflang", both !== undefined && Object.keys(both).length >= 2);
  check(
    "each locale links to the sibling's own slug",
    both?.de?.endsWith("/de/lp/gute-nacht-geschichte") === true && both?.en?.endsWith("/lp/bedtime-story-book") === true,
    JSON.stringify(both),
  );
  check("hreflang is identical from both pages (reciprocal)", JSON.stringify(both) === JSON.stringify(fromDe));
  check("x-default is present", both !== undefined && "x-default" in both);

  const retiredDe = indexOf(enPage, { ...dePage, status: "retired" });
  check(
    "a retired sibling drops out",
    landingHreflang(SITE, retiredDe, enPage, [en, de]) === undefined,
  );
  const noindexDe = indexOf(enPage, { ...dePage, seo: { ...dePage.seo, noindex: true } });
  check(
    "a noindex sibling drops out",
    landingHreflang(SITE, noindexDe, enPage, [en, de]) === undefined,
  );
  check(
    "an unlaunched locale's sibling is never advertised",
    landingHreflang(SITE, index, enPage, [en]) === undefined,
  );
}

// ---- Sitemap and footer: only what is public and indexable --------------------------
{
  const pub = page({ slug: "pub", status: "published", title: "Public one" });
  const hidden = page({ slug: "hidden", status: "published", seo: { ...createDefaultLandingPage().seo, noindex: true } });
  const ret = page({ slug: "ret", status: "retired" });
  const deLive = page({ slug: "de-seite", locale: "de", status: "published", title: "Deutsche Seite" });
  const index = indexOf(pub, hidden, ret, deLive);

  const urls = landingSitemapEntries(SITE, index, [en]).map((e) => e.url);
  check("sitemap lists the published page", urls.includes(`${SITE}/lp/pub`), urls.join(","));
  check("sitemap omits noindex pages", !urls.some((u) => u.endsWith("/hidden")));
  check("sitemap omits retired pages", !urls.some((u) => u.endsWith("/ret")));
  check("sitemap omits pages in an unlaunched locale", !urls.some((u) => u.includes("de-seite")));
  check(
    "sitemap includes a launched locale",
    landingSitemapEntries(SITE, index, [en, de]).some((e) => e.url.endsWith("/de/lp/de-seite")),
  );

  const links = landingFooterLinks(index, "en", [en]);
  check("footer links the published page", links.some((l) => l.href === "/lp/pub" && l.label === "Public one"));
  check("footer omits noindex and retired pages", links.length === 1, JSON.stringify(links));
  check("footer is per-locale", !links.some((l) => l.href.includes("de-seite")));
  const many = indexOf(
    ...Array.from({ length: 12 }, (_, i) => page({ slug: `p${i}`, status: "published", publishedAt: i + 1 })),
  );
  check("footer links are capped", landingFooterLinks(many, "en", [en]).length <= 6);
  check("footer lists newest first", landingFooterLinks(many, "en", [en])[0]?.href === "/lp/p11");
}

// ---- SEO derivation: blank overrides fall back to content ---------------------------
{
  const p = page({ slug: "s" });
  const meta = resolveLandingSeo({ ...p, hero: { ...p.hero, title: "The headline", subtitle: "A sentence. ".repeat(40) } });
  check("title defaults to the hero headline", meta.title === "The headline");
  check("description is trimmed to fit", meta.description.length <= 160, String(meta.description.length));
  check(
    "an override wins",
    resolveLandingSeo({ ...p, seo: { ...p.seo, title: "Custom" } }).title === "Custom",
  );
  check("truncateAtWord leaves short text alone", truncateAtWord("short") === "short");
  check("truncateAtWord cuts on a word", !/\s…$/.test(truncateAtWord("word ".repeat(60), 50)));
}

// ---- Index normalisation tolerates junk --------------------------------------------
{
  const idx = normalizeLandingIndex({ pages: [null, { slug: "" }, { id: "en__x", slug: "x", locale: "en", status: "draft" }] });
  check("a draft in the stored index is dropped", !idx.pages.some((p) => (p.status as string) === "draft"));
  check("garbage index normalizes to empty", normalizeLandingIndex(undefined).pages.length === 0);
}

// ---- Seeds ship as safe drafts ----------------------------------------------------
for (const seed of LANDING_SEED_PAGES) {
  const normalized = normalizeLandingPage({ ...seed, translationGroupId: "seed" });
  check(`seed "${seed.slug}" is a draft`, normalized.status === "draft");
  check(`seed "${seed.slug}" has no invented testimonial`, normalized.benefits.quote.text === "");
  check(`seed "${seed.slug}" is complete enough to publish`, landingPublishBlockers(normalized).length === 0, landingPublishBlockers(normalized).join(", "));
}

// ---- Report ---------------------------------------------------------------------
for (const name of checks) console.log(`  ✓ ${name}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failed:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} checks passed.`);
}
