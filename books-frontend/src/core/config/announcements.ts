/**
 * Global, admin-managed **marketing announcement banners**
 * (`appConfig/announcements`).
 *
 * A list of promo/seasonal banners (a discount, a summer sale, a launch
 * countdown, …) the admin builds in Marketing → Announcements. Any number can
 * exist at once — each has its own enable switch, schedule window, audience and
 * dismissal rule — but only ONE is ever shown to a given visitor at a time (the
 * highest-`priority` one that's currently live and matches them; see
 * {@link eligibleAnnouncements}). The visitor-facing picking/dismissal logic
 * lives in `ui/marketing/AnnouncementBanner.tsx`; this module only owns the
 * config shape.
 *
 * Stored at the world-readable `appConfig/announcements` doc (same trust level
 * as `seo`/`legal`/`cookieConfig` — it's marketing copy, not a secret). Writes
 * go only through the admin-gated backend (`/admin/config/announcements`).
 */
import { z } from "zod";

/** Visual container the banner renders as. */
export const ANNOUNCEMENT_PLACEMENTS = ["bar", "floating", "pill"] as const;
export type AnnouncementPlacement = (typeof ANNOUNCEMENT_PLACEMENTS)[number];

/** Color treatment. Maps to the app's existing color tokens (see the banner
 *  component for the exact classes) — no free-form colors, so a banner can
 *  never clash with the rest of the brand palette. */
export const ANNOUNCEMENT_TONES = ["brand", "amber", "rose", "magic", "ink"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

/** Who is eligible to see it. */
export const ANNOUNCEMENT_AUDIENCES = ["everyone", "guests", "signedIn"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/**
 * How often a visitor who dismisses it sees it again:
 *   - "always": no memory — reappears on every page load (rare; mainly for a
 *     very short-lived, must-not-miss notice).
 *   - "session": remembered for the browser tab session (`sessionStorage`) —
 *     the default, matches {@link LowSparksBanner}'s nudge behavior.
 *   - "once": remembered forever on this device (`localStorage`) until the
 *     admin relaunches it as a new banner (a fresh `id`).
 */
export const ANNOUNCEMENT_FREQUENCIES = ["always", "session", "once"] as const;
export type AnnouncementFrequency = (typeof ANNOUNCEMENT_FREQUENCIES)[number];

/** Prefix reserved for non-URL "actions" inside `ctaUrl`/`secondaryUrl` (see
 *  {@link ANNOUNCEMENT_LINK_PRESETS}) — the button runs a client-side action
 *  (e.g. opening a dialog) instead of navigating. Everything else in those
 *  fields is treated as a plain URL. */
export const ANNOUNCEMENT_ACTION_PREFIX = "action:";

/** Whether a `ctaUrl`/`secondaryUrl` value is an `action:` link rather than a
 *  navigable URL — see `ui/marketing/AnnouncementBanner.tsx`, which is the
 *  only place that actually runs it. */
export function isAnnouncementActionLink(url: string): boolean {
  return url.startsWith(ANNOUNCEMENT_ACTION_PREFIX);
}

/**
 * Quick-fill destinations offered as a dropdown next to the raw URL field in
 * the admin editor (`AnnouncementsTab.tsx`) — picking one just writes its
 * `value` into `ctaUrl`/`secondaryUrl`, so the text field stays the source of
 * truth and anything not listed here (a specific blog post, a coupon landing
 * page, an external link) still works fine as free text.
 *
 * Two of these — "Sign up / sign in" and "Cookie settings" — aren't URLs at
 * all: this app is guest-first (no `/signup` route) and cookie preferences
 * are a client-side dialog, both toggled from Zustand state
 * (`useAuthStore.openAuthDialog`, `useConsentStore.openPreferences`), not
 * pages. They're encoded as `action:*` (see {@link ANNOUNCEMENT_ACTION_PREFIX})
 * and `AnnouncementBanner.tsx` runs the matching dialog instead of navigating.
 */
export const ANNOUNCEMENT_LINK_PRESETS = [
  { value: "/studio", label: "Open the Studio" },
  { value: "action:signup", label: "Sign up / sign in" },
  { value: "/#pricing", label: "Pricing section" },
  { value: "/#how-it-works", label: "How it works" },
  { value: "/#features", label: "Features" },
  { value: "/#faq", label: "FAQ" },
  { value: "/blog", label: "Blog" },
  { value: "/print-pricing", label: "Print costs" },
  { value: "/contact", label: "Contact" },
  { value: "/affiliates", label: "Affiliates" },
  { value: "action:cookie-prefs", label: "Cookie settings" },
] as const;

export interface Announcement {
  /** Stable id (Firestore-independent); generated on add. Also the dismissal-
   *  storage key, so relaunching a past campaign means creating a new one
   *  rather than re-enabling the old id (otherwise everyone who dismissed it
   *  the first time would never see it again). */
  id: string;
  /** Admin-only label (list view, never shown to visitors). */
  name: string;
  enabled: boolean;
  /** Main banner copy. */
  message: string;
  /** Optional leading emoji/glyph, e.g. "🎉". Plain text, not an icon picker. */
  emoji: string;
  /** Primary call-to-action. Blank `ctaLabel` hides the button entirely. */
  ctaLabel: string;
  ctaUrl: string;
  /** Optional lower-key second link (e.g. "Learn more" / terms). */
  secondaryLabel: string;
  secondaryUrl: string;
  placement: AnnouncementPlacement;
  tone: AnnouncementTone;
  /** Epoch ms. `null` = no restriction (show as soon as `enabled`). */
  startAt: number | null;
  /** Epoch ms. `null` = never auto-expires. */
  endAt: number | null;
  /** Render a live countdown to `endAt`. Ignored (never shown) when `endAt` is null. */
  showCountdown: boolean;
  audience: AnnouncementAudience;
  frequency: AnnouncementFrequency;
  /** Whether the visitor can close it. Rare to turn off — mainly for a very
   *  short, must-see notice paired with `frequency: "always"`. */
  dismissible: boolean;
  /** Higher wins when more than one banner is otherwise eligible at once. */
  priority: number;
}

export interface AnnouncementsConfig {
  version: 1;
  banners: Announcement[];
  updatedAt: number;
}

/** A short, stable-ish id for a new banner (works in browser + node). */
export function newAnnouncementId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `announcement_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** A blank draft for the "add banner" button — starts disabled so building it
 *  out never risks going live mid-edit. */
export function createDefaultAnnouncement(): Announcement {
  return {
    id: newAnnouncementId(),
    name: "Untitled announcement",
    enabled: false,
    message: "",
    emoji: "🎉",
    ctaLabel: "",
    ctaUrl: "",
    secondaryLabel: "",
    secondaryUrl: "",
    placement: "bar",
    tone: "brand",
    startAt: null,
    endAt: null,
    showCountdown: false,
    audience: "everyone",
    frequency: "session",
    dismissible: true,
    priority: 0,
  };
}

export function createDefaultAnnouncementsConfig(): AnnouncementsConfig {
  return {
    version: 1,
    banners: [],
    updatedAt: Date.now(),
  };
}

/** True when `enabled` and the current time is inside `[startAt, endAt]`. Pure
 *  time/enable check only — audience + dismissal are handled separately (see
 *  `eligibleAnnouncements` for audience; the banner component for dismissal). */
export function isAnnouncementLive(a: Announcement, now: number): boolean {
  if (!a.enabled) return false;
  if (a.startAt != null && now < a.startAt) return false;
  if (a.endAt != null && now > a.endAt) return false;
  return true;
}

/** Whether an announcement's `audience` includes a visitor at this sign-in state. */
export function announcementMatchesAudience(a: Announcement, isSignedIn: boolean): boolean {
  if (a.audience === "everyone") return true;
  if (a.audience === "signedIn") return isSignedIn;
  return !isSignedIn; // "guests"
}

/**
 * Every banner currently live and audience-matched, highest `priority` first
 * (ties keep the config's own order). Doesn't know about per-visitor
 * dismissal — the banner component walks this list and shows the first one
 * that visitor hasn't dismissed, so a dismissed top banner falls through to
 * the next-best one instead of just showing nothing.
 */
export function eligibleAnnouncements(
  config: AnnouncementsConfig,
  opts: { now: number; isSignedIn: boolean },
): Announcement[] {
  return config.banners
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => isAnnouncementLive(a, opts.now) && announcementMatchesAudience(a, opts.isSignedIn))
    .sort((x, y) => y.a.priority - x.a.priority || x.index - y.index)
    .map(({ a }) => a);
}

/** Milliseconds remaining until `endAt`, or `null` when there's no end date
 *  (or it's already passed — the caller should have already filtered that
 *  banner out via {@link isAnnouncementLive}, but this stays defensive). */
export function remainingMs(a: Announcement, now: number): number | null {
  if (a.endAt == null) return null;
  return Math.max(0, a.endAt - now);
}

/** Format a countdown as e.g. "2d 14h 36m" (or "36m 05s" under an hour). */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// ---- Normalization ---------------------------------------------------------

function str(v: unknown, fallback: string, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function nullableTimestamp(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function normalizeAnnouncement(input: unknown): Announcement {
  const d = createDefaultAnnouncement();
  const a = (input ?? {}) as Partial<Announcement>;
  return {
    id: str(a.id, d.id, 120) || d.id,
    name: str(a.name, d.name, 120),
    enabled: bool(a.enabled, d.enabled),
    message: str(a.message, d.message, 500),
    emoji: str(a.emoji, d.emoji, 8),
    ctaLabel: str(a.ctaLabel, d.ctaLabel, 60),
    ctaUrl: str(a.ctaUrl, d.ctaUrl, 2000),
    secondaryLabel: str(a.secondaryLabel, d.secondaryLabel, 60),
    secondaryUrl: str(a.secondaryUrl, d.secondaryUrl, 2000),
    placement: oneOf(a.placement, ANNOUNCEMENT_PLACEMENTS, d.placement),
    tone: oneOf(a.tone, ANNOUNCEMENT_TONES, d.tone),
    startAt: nullableTimestamp(a.startAt),
    endAt: nullableTimestamp(a.endAt),
    showCountdown: bool(a.showCountdown, d.showCountdown),
    audience: oneOf(a.audience, ANNOUNCEMENT_AUDIENCES, d.audience),
    frequency: oneOf(a.frequency, ANNOUNCEMENT_FREQUENCIES, d.frequency),
    dismissible: bool(a.dismissible, d.dismissible),
    priority: Math.round(num(a.priority, d.priority)),
  };
}

/** Cap on how many banners the admin can define at once — plenty for any real
 *  campaign calendar, and keeps the config doc small. */
const MAX_ANNOUNCEMENTS = 30;

export function normalizeAnnouncementsConfig(input: unknown): AnnouncementsConfig {
  const c = (input ?? {}) as Partial<AnnouncementsConfig>;
  const rawBanners = Array.isArray(c.banners) ? c.banners : [];
  const seenIds = new Set<string>();
  const banners: Announcement[] = [];
  for (const raw of rawBanners.slice(0, MAX_ANNOUNCEMENTS)) {
    const banner = normalizeAnnouncement(raw);
    while (seenIds.has(banner.id)) banner.id = newAnnouncementId();
    seenIds.add(banner.id);
    banners.push(banner);
  }
  return {
    version: 1,
    banners,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
  };
}

// ---- Validation (backend, before persisting) -------------------------------

const announcementSchema = z
  .object({
    id: z.string().max(120),
    name: z.string().max(120),
    enabled: z.boolean(),
    message: z.string().max(500),
    emoji: z.string().max(8),
    ctaLabel: z.string().max(60),
    ctaUrl: z.string().max(2000),
    secondaryLabel: z.string().max(60),
    secondaryUrl: z.string().max(2000),
    placement: z.enum(ANNOUNCEMENT_PLACEMENTS),
    tone: z.enum(ANNOUNCEMENT_TONES),
    startAt: z.number().nullable(),
    endAt: z.number().nullable(),
    showCountdown: z.boolean(),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    frequency: z.enum(ANNOUNCEMENT_FREQUENCIES),
    dismissible: z.boolean(),
    priority: z.number(),
  })
  .partial();

export const announcementsConfigSchema = z.object({
  version: z.literal(1).optional(),
  banners: z.array(announcementSchema).max(MAX_ANNOUNCEMENTS).optional(),
  updatedAt: z.number().optional(),
});
