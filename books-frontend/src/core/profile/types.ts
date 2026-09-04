/**
 * User profile + saved address book — the evolvable per-user data model.
 *
 * Two Firestore locations back this:
 *   - `users/{uid}`              — the profile root doc (small, read on login).
 *   - `users/{uid}/addresses/{id}` — the saved address book (a subcollection so
 *     it can grow without bloating the profile doc or hitting the 1 MB limit).
 *
 * `schemaVersion` is stamped on every profile write so fields can be added,
 * renamed or migrated later without guessing what a given doc predates. Bump
 * {@link PROFILE_SCHEMA_VERSION} and add a migration in `migrateProfile` when the
 * shape changes; old docs are upgraded lazily on read.
 *
 * Keep PII (addresses) operational-only here — the AUTHORITATIVE shipping data
 * for a placed order still lives on the order record. A saved address is purely
 * a convenience source for prefilling the checkout form.
 */
import type { Address, Recipient } from "../fulfillment/types";
import type { ImageTier } from "../config/modelConfig";

/** Current profile-document schema version. Bump on any breaking field change. */
export const PROFILE_SCHEMA_VERSION = 1;

/** Per-user application preferences (editable in Settings). */
export interface UserPreferences {
  /**
   * The user's default image quality tier. `null` means "not chosen yet" — the
   * studio prompts a one-time pick on the first generation so the choice is
   * always deliberate.
   */
  imageTier: ImageTier | null;
  /**
   * They pressed "don't ask again" on a profiling question card.
   *
   * A stated preference, so it lives here rather than being inferred from a run of
   * dismissals — and it lives on the profile rather than beside the answers,
   * because a GDPR erasure hard-deletes those and would otherwise resurrect the
   * asking. Covers every survey, present and future: a per-survey opt-out just
   * recreates the annoyance under a new name.
   */
  surveyOptOut: boolean;
}

/**
 * A partial profile update.
 *
 * `preferences` is partial in its own right because Firestore merges nested maps
 * field by field: sending one preference leaves the others alone, and demanding the
 * whole object would make every caller read-modify-write a map it doesn't care
 * about — the pattern that eventually clobbers somebody's setting.
 */
export type ProfilePatch = Partial<Omit<UserProfile, "preferences">> & {
  preferences?: Partial<UserPreferences>;
};

/**
 * One entry in the user's address book. Field names mirror the checkout form
 * (flat, UI-friendly) rather than the provider {@link Address} shape; convert
 * with {@link addressToRecipient}.
 */
export interface SavedAddress {
  /** Stable client-generated id (also the Firestore document id). */
  id: string;
  /** A short human label, e.g. "Home" or "Grandma". */
  label: string;
  recipientName: string;
  phone: string;
  /** Optional contact email for shipping updates. */
  email: string;
  line1: string;
  line2: string;
  city: string;
  /** State / province / county. */
  region: string;
  /** Postal / ZIP code. */
  postal: string;
  /** Two-letter ISO country code. */
  country: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
}

/**
 * The profile root document. A single cheap read on login. Lists (addresses,
 * future payment methods, …) live in subcollections, never inline here.
 */
export interface UserProfile {
  schemaVersion: number;
  /** Mirrored from auth for convenience (so the UI needn't read the token). */
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  /** The address book entry to default the checkout form to, if any. */
  defaultAddressId: string | null;
  /** BCP-47 locale for future personalization, e.g. "en-US". */
  locale: string | null;
  /** Preferred ISO currency for pricing, e.g. "USD". */
  currency: string | null;
  /** Whether the user opted in to marketing email. */
  marketingOptIn: boolean;
  /** Per-user app preferences (image quality tier, …). */
  preferences: UserPreferences;
  /** Small, denormalized analytics/metadata summary (NOT an event log). */
  meta: ProfileMeta;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
}

/**
 * Lightweight, denormalized metadata for coarse analysis. Keep this to small
 * scalars/timestamps — real behavioral analytics belong in GA4 / BigQuery, not
 * a growing Firestore doc.
 */
export interface ProfileMeta {
  /** Epoch ms the profile was first created. */
  firstSeenAt: number | null;
  /** Epoch ms of the most recent app session we recorded. */
  lastActiveAt: number | null;
  /** How the account was first created, e.g. "guest", "password", "google". */
  signupSource: string | null;
  /** Most recent user-agent string (coarse device/browser analysis). */
  lastUserAgent: string | null;
  /** Server-written device rollup. Null until a session has been recorded. */
  device: ProfileDeviceMeta | null;
}

/**
 * What we know about the devices one account uses — a fixed-size rollup, never
 * a log.
 *
 * BACKEND-AUTHORITATIVE. Written only by `functions/src/deviceStats.ts` (from
 * the User-Agent on the request) and the auth blocking functions, never by the
 * client: a form factor the browser could assert is a form factor that can be
 * asserted wrongly, and "which device do our buyers use" is not a question
 * worth answering from a field the answer's subject can set. The Firestore rules
 * pin it against client writes (`deviceMetaUnchanged`).
 *
 * Everything here is a scalar or a 4-key map, so the profile doc stays a single
 * cheap read no matter how long somebody uses the product.
 */
export interface ProfileDeviceMeta {
  /** Form factor of the most recent session. */
  device: string | null;
  os: string | null;
  browser: string | null;
  /** Major version only, e.g. 17. */
  browserMajor: number | null;
  /**
   * Form factor of the FIRST session ever recorded — the entry-device
   * attribution the dashboard's device filter selects on. Write-once.
   */
  firstDevice: string | null;
  /** Form factor the account was created on, per the signup blocking event. */
  signupDevice: string | null;
  /** Form factor of the first COMPLETED purchase, stamped at checkout. */
  purchaseDevice: string | null;
  /** Sessions per form factor. At most four keys, so it can't grow. */
  counts: Record<string, number>;
  /** Total sessions recorded. */
  sessions: number;
  /** Viewport bucket last reported — only present with analytics consent. */
  viewport: string | null;
  /**
   * Epoch ms of the first session on a form factor other than
   * {@link firstDevice}, or null if they've never switched. Write-once, and the
   * basis of the cross-device switch-lag metric.
   */
  switchedAt: number | null;
  /** Epoch ms the current session began (server-derived, 30-minute idle gap). */
  sessionStartedAt: number | null;
  /** Epoch ms of the last session ping. */
  lastSeenAt: number | null;
}

/** A blank profile for a brand-new user. */
export function emptyProfile(): UserProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    displayName: null,
    email: null,
    photoURL: null,
    defaultAddressId: null,
    locale: null,
    currency: null,
    marketingOptIn: false,
    preferences: { imageTier: null, surveyOptOut: false },
    meta: {
      firstSeenAt: null,
      lastActiveAt: null,
      signupSource: null,
      lastUserAgent: null,
      device: null,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Coerce a stored device rollup, tolerating docs written before it existed. */
function migrateDeviceMeta(raw: unknown): ProfileDeviceMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const counts: Record<string, number> = {};
  if (d.counts && typeof d.counts === "object") {
    for (const [k, v] of Object.entries(d.counts as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) counts[k] = v;
    }
  }
  return {
    device: str(d.device),
    os: str(d.os),
    browser: str(d.browser),
    browserMajor: numOrNull(d.browserMajor),
    firstDevice: str(d.firstDevice),
    signupDevice: str(d.signupDevice),
    purchaseDevice: str(d.purchaseDevice),
    counts,
    sessions: typeof d.sessions === "number" ? d.sessions : 0,
    viewport: str(d.viewport),
    switchedAt: numOrNull(d.switchedAt),
    sessionStartedAt: numOrNull(d.sessionStartedAt),
    lastSeenAt: numOrNull(d.lastSeenAt),
  };
}

/**
 * Coerce an arbitrary Firestore payload into a {@link UserProfile}, filling
 * missing fields with defaults and running forward migrations. Tolerant by
 * design so a partially-written or older doc never crashes the client.
 */
export function migrateProfile(raw: unknown): UserProfile {
  const base = emptyProfile();
  if (!raw || typeof raw !== "object") return base;
  const d = raw as Record<string, unknown>;
  const meta = (d.meta ?? {}) as Record<string, unknown>;
  const prefs = (d.preferences ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const imageTier: ImageTier | null =
    prefs.imageTier === "quick" || prefs.imageTier === "premium" ? prefs.imageTier : null;

  // schemaVersion < 1 docs (pre-versioning) simply fall through to the defaults
  // above for any missing field; add explicit per-version steps here as needed.
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    displayName: str(d.displayName),
    email: str(d.email),
    photoURL: str(d.photoURL),
    defaultAddressId: str(d.defaultAddressId),
    locale: str(d.locale),
    currency: str(d.currency),
    marketingOptIn: d.marketingOptIn === true,
    preferences: { imageTier, surveyOptOut: prefs.surveyOptOut === true },
    meta: {
      firstSeenAt: numOrNull(meta.firstSeenAt),
      lastActiveAt: numOrNull(meta.lastActiveAt),
      signupSource: str(meta.signupSource),
      lastUserAgent: str(meta.lastUserAgent),
      device: migrateDeviceMeta(meta.device),
    },
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
  };
}

/** Coerce an arbitrary Firestore payload into a {@link SavedAddress}. */
export function migrateAddress(id: string, raw: unknown): SavedAddress {
  const d = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  return {
    id,
    label: str(d.label),
    recipientName: str(d.recipientName),
    phone: str(d.phone),
    email: str(d.email),
    line1: str(d.line1),
    line2: str(d.line2),
    city: str(d.city),
    region: str(d.region),
    postal: str(d.postal),
    country: str(d.country),
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
  };
}

/** Project a saved address into the provider-neutral {@link Recipient} shape. */
export function addressToRecipient(a: SavedAddress): Recipient {
  const address: Address = {
    line1: a.line1.trim(),
    line2: a.line2.trim() || undefined,
    townOrCity: a.city.trim(),
    stateOrCounty: a.region.trim() || undefined,
    postalOrZipCode: a.postal.trim(),
    countryCode: a.country,
  };
  return {
    name: a.recipientName.trim(),
    email: a.email.trim() || undefined,
    phoneNumber: a.phone.trim() || undefined,
    address,
  };
}

/**
 * A short, human one-line summary of an address for pickers/labels, e.g.
 * "Jane Doe · 123 Market St, San Francisco, CA".
 */
export function addressSummary(a: SavedAddress): string {
  const parts = [a.line1, a.city, a.region].map((s) => s.trim()).filter(Boolean);
  const loc = parts.join(", ");
  return [a.recipientName.trim(), loc].filter(Boolean).join(" · ") || "Saved address";
}

/**
 * True when two addresses describe the same destination (ignores label, id and
 * timestamps). Used to dedupe when saving an address from checkout.
 */
export function sameAddress(a: SavedAddress, b: SavedAddress): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  return (
    norm(a.recipientName) === norm(b.recipientName) &&
    norm(a.line1) === norm(b.line1) &&
    norm(a.line2) === norm(b.line2) &&
    norm(a.city) === norm(b.city) &&
    norm(a.region) === norm(b.region) &&
    norm(a.postal) === norm(b.postal) &&
    norm(a.country) === norm(b.country)
  );
}
