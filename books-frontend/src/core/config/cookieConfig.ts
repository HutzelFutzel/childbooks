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
 *   - the per-category display names (`categoryLabels`) and the button/link
 *     text (`buttonLabels`) — e.g. rewording "Accept all" or "Reject
 *     non-essential",
 *   - a `consentVersion` — bump it to force every visitor to re-consent,
 *   - an `entranceDelayMs` — how long to wait before the banner appears.
 *
 * `buttonLabels.rejectAll` MUST keep stating a real, one-click "reject/refuse"
 * action — GDPR Art. 7(3) requires withdrawing/declining consent to be as easy
 * as giving it, and EDPB guidance treats vague or softened refusal wording as a
 * "Fickle"/deceptive-design pattern. Admins can restyle or translate this
 * button, but shouldn't rename it into something that obscures what it does
 * (see the hint text next to the field in the admin UI).
 *
 * `entranceDelayMs` only changes WHEN the prompt is shown, never whether
 * tracking is allowed: Consent Mode defaults stay "denied" and analytics/ads
 * stay uninitialized the entire time regardless of banner visibility (see
 * `ui/consent/ConsentManager.tsx`), so a short delay can't be used to sneak in
 * non-essential cookies before the visitor decides. It's still clamped to
 * {@link MAX_ENTRANCE_DELAY_MS} so it can't be pushed long enough to undermine
 * the "notice at first visit" expectation regulators apply to cookie banners.
 *
 * The *categories* themselves are code-defined (they map to real scripts). The
 * admin edits copy, toggles the banner, and bumps the version. Stored at the
 * world-readable `appConfig/cookieConfig` doc; writes go only through the
 * admin-gated backend (`/admin/config/cookies`).
 */
import { z } from "zod";

/**
 * Upper bound for `entranceDelayMs`. Kept short (8s) so the delay can only be
 * used for a brief "let the page settle" effect, not to meaningfully hide the
 * notice — enforced both here (server-side, via `cookieConfigSchema`) and in
 * `normalizeCookieConfig` so a bad value can never make it to the client.
 */
export const MAX_ENTRANCE_DELAY_MS = 8_000;

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

/** Visitor-facing button/link text on the banner. All admin-editable. */
export interface CookieButtonLabels {
  acceptAll: string;
  rejectAll: string;
  customize: string;
  save: string;
  close: string;
  learnMore: string;
}

export const COOKIE_BUTTON_LABEL_KEYS = [
  "acceptAll",
  "rejectAll",
  "customize",
  "save",
  "close",
  "learnMore",
] as const satisfies readonly (keyof CookieButtonLabels)[];

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
  /** Per-category short display names (e.g. "Analytics"). */
  categoryLabels: Record<CookieCategory, string>;
  /** Button/link text on the banner (Accept all, Reject non-essential, …). */
  buttonLabels: CookieButtonLabels;
  /** Bump to force every visitor to re-consent (stored per-visitor + per-user). */
  consentVersion: string;
  /**
   * Milliseconds to wait after page load before showing the banner (0 = show
   * immediately). Clamped to [0, {@link MAX_ENTRANCE_DELAY_MS}]. Does not
   * affect compliance — see the module doc comment above.
   */
  entranceDelayMs: number;
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
    categoryLabels: {
      necessary: "Strictly necessary",
      analytics: "Analytics",
      marketing: "Marketing",
    },
    buttonLabels: {
      acceptAll: "Accept all",
      rejectAll: "Reject non-essential",
      customize: "Customize",
      save: "Save choices",
      close: "Close",
      learnMore: "Learn more",
    },
    consentVersion: "1",
    entranceDelayMs: 0,
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

/** Clamp a numeric field into [min, max], falling back + rounding on bad input. */
function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

export function normalizeCookieConfig(input: unknown): CookieConfig {
  const d = createDefaultCookieConfig();
  const c = (input ?? {}) as Partial<CookieConfig>;
  const ct = (c.categoryText ?? {}) as Record<string, unknown>;
  const categoryText = {} as Record<CookieCategory, string>;
  const cl = (c.categoryLabels ?? {}) as Record<string, unknown>;
  const categoryLabels = {} as Record<CookieCategory, string>;
  for (const cat of COOKIE_CATEGORIES) {
    categoryText[cat] = str(ct[cat], d.categoryText[cat], 500);
    // Short display names — empty strings would make a toggle unreadable, so
    // (unlike the free-length body copy) an empty value falls back to default.
    categoryLabels[cat] = str(cl[cat], d.categoryLabels[cat], 60) || d.categoryLabels[cat];
  }
  const bl = (c.buttonLabels ?? {}) as Record<string, unknown>;
  const buttonLabels = {} as CookieButtonLabels;
  for (const key of COOKIE_BUTTON_LABEL_KEYS) {
    // Same rule: a blank button label would leave visitors an unreadable
    // control (or, worse, an unlabeled "Reject" button), so fall back to the
    // shipped default rather than allow empty text.
    buttonLabels[key] = str(bl[key], d.buttonLabels[key], 60) || d.buttonLabels[key];
  }
  return {
    version: 1,
    enabled: bool(c.enabled, d.enabled),
    title: str(c.title, d.title, 200),
    body: str(c.body, d.body, 1000),
    categoryText,
    categoryLabels,
    buttonLabels,
    consentVersion: str(c.consentVersion, d.consentVersion, 40) || d.consentVersion,
    entranceDelayMs: clampInt(c.entranceDelayMs, d.entranceDelayMs, 0, MAX_ENTRANCE_DELAY_MS),
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
  categoryLabels: z.record(z.string(), z.string().max(60)).optional(),
  buttonLabels: z
    .object({
      acceptAll: z.string().max(60).optional(),
      rejectAll: z.string().max(60).optional(),
      customize: z.string().max(60).optional(),
      save: z.string().max(60).optional(),
      close: z.string().max(60).optional(),
      learnMore: z.string().max(60).optional(),
    })
    .partial()
    .optional(),
  consentVersion: z.string().max(40).optional(),
  // Server-enforced cap — see MAX_ENTRANCE_DELAY_MS doc comment above.
  entranceDelayMs: z.number().min(0).max(MAX_ENTRANCE_DELAY_MS).optional(),
  updatedAt: z.number().optional(),
});
