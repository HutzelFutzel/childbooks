/**
 * Global, admin-managed **legal documents** configuration.
 *
 * A dynamic list of legal/policy links (Terms, Privacy, Refund, Imprint, Cookie
 * policy, …) — the admin can add or remove any number of them without a deploy.
 * Each entry is just a label + URL (the documents themselves are hosted
 * elsewhere), plus:
 *   - an optional `role` tag so other features can resolve a SPECIFIC document
 *     regardless of how many exist (the signup consent line needs "the privacy
 *     policy URL"; the cookie banner needs "the cookie policy URL");
 *   - a `version` (+ optional `effectiveDate`) that drives CONSENT VERSIONING —
 *     bump it and users are asked to re-accept / are re-notified;
 *   - `showInFooter` / `showAtSignup` placement flags.
 *
 * Stored at the world-readable `appConfig/legal` doc (URLs + labels are public
 * anyway). Writes go only through the admin-gated backend (`/admin/config/legal`).
 */
import { z } from "zod";

/** Well-known roles other features resolve by (a link may have at most one). */
export const LEGAL_ROLES = ["terms", "privacy", "refund", "imprint", "cookies"] as const;
export type LegalRole = (typeof LEGAL_ROLES)[number];

export interface LegalLink {
  /** Stable id (Firestore-independent); generated on add. */
  id: string;
  /** Human label shown in the footer / links, e.g. "Terms of Service". */
  label: string;
  /** Absolute URL to the hosted document. */
  url: string;
  /** Optional well-known role so features can find this specific document. */
  role: LegalRole | null;
  /** Consent version — bump to force re-consent / re-notification. */
  version: string;
  /** Optional ISO date (yyyy-mm-dd) the current version takes effect. */
  effectiveDate: string;
  /** Show this link in the site footer. */
  showInFooter: boolean;
  /** Include this link in the signup consent line. */
  showAtSignup: boolean;
  /**
   * EU-only document (e.g. the Imprint / Impressum). Hidden everywhere unless
   * {@link LegalConfig.euMode} is on — so you can add it now while testing in the
   * US and flip it on at EU launch.
   */
  euOnly: boolean;
}

export interface LegalConfig {
  version: 1;
  links: LegalLink[];
  /**
   * EU mode master switch. When off, `euOnly` documents (Imprint) stay hidden;
   * when on, they appear wherever they're placed. A deliberate business toggle,
   * not a per-visitor IP guess.
   */
  euMode: boolean;
  updatedAt: number;
}

const DEFAULT_DOMAIN = "https://childbook.studio";

/** A short, stable-ish id for a new link (works in browser + node). */
export function newLegalLinkId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `legal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultLegalConfig(): LegalConfig {
  return {
    version: 1,
    euMode: false,
    links: [
      {
        id: "terms",
        label: "Terms of Service",
        url: `${DEFAULT_DOMAIN}/legal/terms`,
        role: "terms",
        version: "1",
        effectiveDate: "",
        showInFooter: true,
        showAtSignup: true,
        euOnly: false,
      },
      {
        id: "privacy",
        label: "Privacy Policy",
        url: `${DEFAULT_DOMAIN}/legal/privacy`,
        role: "privacy",
        version: "1",
        effectiveDate: "",
        showInFooter: true,
        showAtSignup: true,
        euOnly: false,
      },
      {
        id: "refund",
        label: "Refund Policy",
        url: `${DEFAULT_DOMAIN}/legal/refund`,
        role: "refund",
        version: "1",
        effectiveDate: "",
        showInFooter: true,
        showAtSignup: false,
        euOnly: false,
      },
      {
        id: "cookies",
        label: "Cookie Policy",
        url: `${DEFAULT_DOMAIN}/legal/cookies`,
        role: "cookies",
        version: "1",
        effectiveDate: "",
        showInFooter: true,
        showAtSignup: false,
        euOnly: false,
      },
      {
        // Pre-seeded but EU-only: appears once you enable EU mode. Set the real
        // URL in the admin Legal tab before launch.
        id: "imprint",
        label: "Imprint",
        url: `${DEFAULT_DOMAIN}/legal/imprint`,
        role: "imprint",
        version: "1",
        effectiveDate: "",
        showInFooter: true,
        showAtSignup: false,
        euOnly: true,
      },
    ],
    updatedAt: Date.now(),
  };
}

// ---- Normalization ---------------------------------------------------------

function str(v: unknown, fallback = "", max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function role(v: unknown): LegalRole | null {
  return typeof v === "string" && (LEGAL_ROLES as readonly string[]).includes(v)
    ? (v as LegalRole)
    : null;
}

function normalizeLink(input: unknown): LegalLink {
  const l = (input ?? {}) as Partial<LegalLink>;
  return {
    id: str(l.id, newLegalLinkId(), 120) || newLegalLinkId(),
    label: str(l.label, "", 120),
    url: str(l.url, "", 2000),
    role: role(l.role),
    version: str(l.version, "1", 40) || "1",
    effectiveDate: str(l.effectiveDate, "", 20),
    showInFooter: bool(l.showInFooter, true),
    showAtSignup: bool(l.showAtSignup, false),
    euOnly: bool(l.euOnly, false),
  };
}

export function normalizeLegalConfig(input: unknown): LegalConfig {
  const c = (input ?? {}) as Partial<LegalConfig>;
  const rawLinks = Array.isArray(c.links) ? c.links : [];
  // De-dupe roles: only the FIRST link claiming a role keeps it (so resolvers
  // are deterministic). Empty labels/urls are dropped.
  const seenRoles = new Set<LegalRole>();
  const links: LegalLink[] = [];
  const seenIds = new Set<string>();
  for (const raw of rawLinks.slice(0, 50)) {
    const link = normalizeLink(raw);
    if (!link.label && !link.url) continue;
    while (seenIds.has(link.id)) link.id = newLegalLinkId();
    seenIds.add(link.id);
    if (link.role) {
      if (seenRoles.has(link.role)) link.role = null;
      else seenRoles.add(link.role);
    }
    links.push(link);
  }
  return {
    version: 1,
    euMode: bool(c.euMode, false),
    links,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
  };
}

/** Resolve the first link tagged with a given role, or undefined. */
export function legalLinkByRole(config: LegalConfig, r: LegalRole): LegalLink | undefined {
  return config.links.find((l) => l.role === r);
}

/**
 * The legal links to actually show for a placement, honoring the EU-mode gate:
 * `euOnly` documents (Imprint) only appear when `euMode` is on. Drops entries
 * with no URL. Used by the footer, the in-app account menu, and the signup line.
 */
export function visibleLegalLinks(
  config: LegalConfig,
  placement: "footer" | "signup",
): LegalLink[] {
  return config.links.filter((l) => {
    if (!l.url) return false;
    if (l.euOnly && !config.euMode) return false;
    return placement === "footer" ? l.showInFooter : l.showAtSignup;
  });
}

/** Convenience: the URL for a role (empty string when absent). */
export function legalUrlByRole(config: LegalConfig, r: LegalRole): string {
  return legalLinkByRole(config, r)?.url ?? "";
}

// ---- Validation (backend, before persisting) -------------------------------

export const legalConfigSchema = z.object({
  version: z.literal(1).optional(),
  euMode: z.boolean().optional(),
  links: z
    .array(
      z
        .object({
          id: z.string().max(120),
          label: z.string().max(120),
          url: z.string().max(2000),
          role: z.enum(LEGAL_ROLES).nullable(),
          version: z.string().max(40),
          effectiveDate: z.string().max(20),
          showInFooter: z.boolean(),
          showAtSignup: z.boolean(),
          euOnly: z.boolean(),
        })
        .partial(),
    )
    .max(50)
    .optional(),
  updatedAt: z.number().optional(),
});
