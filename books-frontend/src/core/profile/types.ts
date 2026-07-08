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
}

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
    preferences: { imageTier: null },
    meta: {
      firstSeenAt: null,
      lastActiveAt: null,
      signupSource: null,
      lastUserAgent: null,
    },
    createdAt: 0,
    updatedAt: 0,
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
    preferences: { imageTier },
    meta: {
      firstSeenAt: numOrNull(meta.firstSeenAt),
      lastActiveAt: numOrNull(meta.lastActiveAt),
      signupSource: str(meta.signupSource),
      lastUserAgent: str(meta.lastUserAgent),
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
    country: str(d.country, "US"),
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
