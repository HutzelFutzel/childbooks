/**
 * Global, admin-managed **landing-page copy overrides**.
 *
 * Every editable string on the marketing site keeps its default text hardcoded
 * at the call site (in the section component). This config only stores the
 * admin's *overrides*, keyed by a stable slot id — so an absent key means "use
 * the code default". Admins edit the copy inline on the landing page (in edit
 * mode) and it persists here without a deploy.
 *
 * Stored at the world-readable `appConfig/siteContent` doc. Values are plain
 * text (rendered as text nodes, never as HTML) so there's no XSS surface.
 */

/** The stable ids for every inline-editable string on the landing page. */
export const SITE_TEXT_SLOTS = [
  // Hero
  "hero.badge",
  "hero.title",
  "hero.subtitle",
  "hero.ctaPrimary",
  "hero.ctaSecondary",
  "hero.note",
  // Trust strip
  "trust.0",
  "trust.1",
  "trust.2",
  "trust.3",
  // How it works
  "how.heading",
  "how.subhead",
  "how.step1.title",
  "how.step1.body",
  "how.step2.title",
  "how.step2.body",
  "how.step3.title",
  "how.step3.body",
  // Features
  "features.heading",
  "features.subhead",
  "features.0.title",
  "features.0.body",
  "features.1.title",
  "features.1.body",
  "features.2.title",
  "features.2.body",
  "features.3.title",
  "features.3.body",
  "features.4.title",
  "features.4.body",
  "features.5.title",
  "features.5.body",
  // Closing CTA band
  "cta.heading",
  "cta.subhead",
  "cta.button",
] as const;

export type SiteTextSlot = (typeof SITE_TEXT_SLOTS)[number];

export function isSiteTextSlot(v: unknown): v is SiteTextSlot {
  return typeof v === "string" && (SITE_TEXT_SLOTS as readonly string[]).includes(v);
}

/** Max stored length of a single override (defensive cap). */
export const MAX_TEXT_LEN = 2000;

export interface SiteContentConfig {
  version: 1;
  /** slotId → override text (absent = use the code default). */
  text: Record<string, string>;
}

export function createDefaultSiteContentConfig(): SiteContentConfig {
  return { version: 1, text: {} };
}

export function normalizeSiteContentConfig(input: unknown): SiteContentConfig {
  const out = createDefaultSiteContentConfig();
  if (!input || typeof input !== "object") return out;
  const text = ((input as Partial<SiteContentConfig>).text ?? {}) as Record<string, unknown>;
  for (const slot of SITE_TEXT_SLOTS) {
    const v = text[slot];
    if (typeof v === "string") out.text[slot] = v.slice(0, MAX_TEXT_LEN);
  }
  return out;
}
