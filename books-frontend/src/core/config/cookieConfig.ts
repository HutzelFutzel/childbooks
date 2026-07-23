/**
 * Global, admin-managed **cookie consent** configuration.
 *
 * Drives the first-party cookie banner (see `ui/consent/*`). The banner UI is
 * built from our own component kit and stores the visitor's choice locally; this
 * config owns everything the admin should be able to change WITHOUT a deploy:
 *   - a master enable toggle,
 *   - the banner title + body copy,
 *   - the per-category descriptions (necessary is always on; analytics/marketing
 *     are opt-in and gate Google Consent Mode v2 signals + tracker loading),
 *   - a `consentVersion` — bump it to force every visitor to re-consent.
 *
 * The *categories* themselves are code-defined (they map to real scripts). The
 * admin edits copy, toggles the banner, and bumps the version. Stored at the
 * world-readable `appConfig/cookieConfig` doc; writes go only through the
 * admin-gated backend (`/admin/config/cookies`).
 */
import { z } from "zod";

/**
 * Consentable categories. `necessary` is always granted (strictly-necessary
 * storage — auth/session); the others are opt-in and map to Google Consent Mode
 * v2 signals. Add a category here + map it in `ui/consent/consentMode.ts`.
 */
export const COOKIE_CATEGORIES = ["necessary", "analytics", "marketing"] as const;
export type CookieCategory = (typeof COOKIE_CATEGORIES)[number];

/** Opt-in categories (everything except the always-on `necessary`). */
export const OPTIONAL_COOKIE_CATEGORIES = COOKIE_CATEGORIES.filter(
  (c) => c !== "necessary",
) as Exclude<CookieCategory, "necessary">[];

export interface CookieConfig {
  version: 1;
  /** Master switch — when false, the banner never shows (and nothing is gated). */
  enabled: boolean;
  /** Banner heading. */
  title: string;
  /** Banner body copy (plain text). */
  body: string;
  /** Per-category descriptions shown in the "customize" panel. */
  categoryText: Record<CookieCategory, string>;
  /** Bump to force every visitor to re-consent (stored per-visitor + per-user). */
  consentVersion: string;
  updatedAt: number;
}

export function createDefaultCookieConfig(): CookieConfig {
  return {
    version: 1,
    enabled: true,
    title: "We value your privacy",
    body: "We use cookies to keep you signed in and, with your permission, to understand how the site is used and to improve our marketing. You can accept all, reject non-essential, or choose what to allow.",
    categoryText: {
      necessary:
        "Required for the site to work — sign-in, security and your session. Always on.",
      analytics:
        "Help us understand how the site is used so we can improve it. Off unless you allow it.",
      marketing:
        "Used to measure and improve our advertising. Off unless you allow it.",
    },
    consentVersion: "1",
    updatedAt: Date.now(),
  };
}

// ---- Normalization ---------------------------------------------------------

function str(v: unknown, fallback: string, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function normalizeCookieConfig(input: unknown): CookieConfig {
  const d = createDefaultCookieConfig();
  const c = (input ?? {}) as Partial<CookieConfig>;
  const ct = (c.categoryText ?? {}) as Record<string, unknown>;
  const categoryText = {} as Record<CookieCategory, string>;
  for (const cat of COOKIE_CATEGORIES) {
    categoryText[cat] = str(ct[cat], d.categoryText[cat], 500);
  }
  return {
    version: 1,
    enabled: bool(c.enabled, d.enabled),
    title: str(c.title, d.title, 200),
    body: str(c.body, d.body, 1000),
    categoryText,
    consentVersion: str(c.consentVersion, d.consentVersion, 40) || d.consentVersion,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
  };
}

// ---- Validation (backend, before persisting) -------------------------------

export const cookieConfigSchema = z.object({
  version: z.literal(1).optional(),
  enabled: z.boolean().optional(),
  title: z.string().max(200).optional(),
  body: z.string().max(1000).optional(),
  categoryText: z.record(z.string(), z.string().max(500)).optional(),
  consentVersion: z.string().max(40).optional(),
  updatedAt: z.number().optional(),
});
