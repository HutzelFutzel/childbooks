/**
 * The countries we sell to — admin-managed, and the CEILING every geo check
 * goes through.
 *
 * This replaces the old `SUPPORTED_MARKETS` constant. The property that made
 * that constant trustworthy is preserved exactly: a product's own geo policy
 * can only ever NARROW this set, never widen it, because
 * {@link isDestinationAllowed} intersects with a {@link MarketRegistry} before
 * consulting the product at all. What changed is only where the list comes
 * from — a Firestore document an admin edits, rather than a deploy.
 *
 * Two documents (mirrors the product catalog):
 *   - PRIVATE `adminSettings/markets` — the full {@link MarketsConfig}.
 *   - PUBLIC  `appConfig/markets` — the enabled country codes, which the
 *     storefront needs to render a country picker.
 *
 * Deliberately NOT here: currency, tax treatment, legal documents, language.
 * Those are per-market decisions with real consequences and they get their own
 * fields once there's code that reads them. A market today answers exactly one
 * question — can we physically get a book there.
 */
import { z } from "zod";
import { isIsoCountry, SANCTIONS_DENYLIST } from "./countries";

export interface Market {
  /** ISO-3166-1 alpha-2, uppercase. */
  country: string;
  /**
   * Whether this country can be sold to. Default for anything the registry
   * learns about later is `false` — opening a market is a decision, not a
   * side effect of the printer adding coverage.
   */
  enabled: boolean;
  /**
   * Free-text operational note (why it was opened, what to watch).
   *
   * One unstructured field on purpose. Structured fields for facts nothing
   * reads — filing deadlines, registration numbers, thresholds — go stale
   * silently because no code ever disagrees with them.
   */
  notes: string;
  updatedAt: number;
  updatedBy: string;
}

export interface MarketsConfig {
  version: 1;
  /** Sparse: only countries an admin has actually touched. */
  markets: Market[];
  updatedAt: number;
}

/**
 * The snapshot every destination check takes.
 *
 * A set rather than the whole config so the check stays trivial, and so the
 * unloaded case fails CLOSED for free: an empty registry allows nothing, with
 * no sentinel value to remember and no "did the config load yet" branch for a
 * caller to get wrong.
 */
export interface MarketRegistry {
  enabled: ReadonlySet<string>;
}

/** A registry that permits nothing. The safe default before config loads. */
export const EMPTY_MARKET_REGISTRY: MarketRegistry = { enabled: new Set() };

/**
 * The markets seeded on first run.
 *
 * Not "nothing", even though nothing is the right default for every country
 * discovered afterwards: shipping the registry empty would take an operating
 * storefront dark until somebody opened the admin. These six are what the
 * business already sells to.
 */
export const SEED_MARKETS: readonly string[] = ["US", "DE", "GB", "FR", "CA", "AU"];

export function createDefaultMarketsConfig(): MarketsConfig {
  const now = Date.now();
  return {
    version: 1,
    markets: SEED_MARKETS.map((country) => ({
      country,
      enabled: true,
      notes: "",
      updatedAt: now,
      updatedBy: "seed",
    })),
    updatedAt: now,
  };
}

/**
 * Build the registry a geo check consumes.
 *
 * The sanctions denylist is applied HERE rather than only in the admin UI, so
 * it holds even for a document hand-edited in the Firestore console. Payment
 * for those destinations is declined anyway; letting one into the registry
 * would just move the failure to a worse place.
 */
export function registryFrom(config: MarketsConfig): MarketRegistry {
  const enabled = new Set<string>();
  for (const m of config.markets) {
    if (!m.enabled) continue;
    const country = m.country.trim().toUpperCase();
    if (!isIsoCountry(country) || SANCTIONS_DENYLIST.has(country)) continue;
    enabled.add(country);
  }
  return { enabled };
}

/** A registry from a bare list of codes (the public projection, tests). */
export function registryOf(countries: Iterable<string>): MarketRegistry {
  const enabled = new Set<string>();
  for (const raw of countries) {
    const country = (raw ?? "").trim().toUpperCase();
    if (!isIsoCountry(country) || SANCTIONS_DENYLIST.has(country)) continue;
    enabled.add(country);
  }
  return { enabled };
}

/** The enabled countries, sorted — for pickers and for stable projections. */
export function enabledMarkets(registry: MarketRegistry): string[] {
  return [...registry.enabled].sort();
}

// ---- Normalization ---------------------------------------------------------

function str(v: unknown, fallback = "", max = 500): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function normalizeMarketsConfig(input: unknown): MarketsConfig {
  const c = (input ?? {}) as Partial<MarketsConfig>;
  // A missing document is a first run, not an empty world — seed rather than
  // silently serving a storefront that ships nowhere.
  if (!Array.isArray(c.markets)) return createDefaultMarketsConfig();

  const seen = new Set<string>();
  const markets: Market[] = [];
  for (const raw of c.markets.slice(0, 400)) {
    const m = (raw ?? {}) as Partial<Market>;
    const country = str(m.country, "", 2).trim().toUpperCase();
    if (country.length !== 2 || !isIsoCountry(country) || seen.has(country)) continue;
    seen.add(country);
    markets.push({
      country,
      enabled: typeof m.enabled === "boolean" ? m.enabled : false,
      notes: str(m.notes, "", 2000),
      updatedAt: num(m.updatedAt),
      updatedBy: str(m.updatedBy, "", 120),
    });
  }
  markets.sort((a, b) => a.country.localeCompare(b.country));
  return { version: 1, markets, updatedAt: num(c.updatedAt) };
}

/** The public projection: just the codes a storefront may offer. */
export interface PublicMarketsConfig {
  version: 1;
  enabled: string[];
}

export function projectPublicMarkets(config: MarketsConfig): PublicMarketsConfig {
  return { version: 1, enabled: enabledMarkets(registryFrom(config)) };
}

export function normalizePublicMarkets(input: unknown): PublicMarketsConfig {
  const c = (input ?? {}) as Partial<PublicMarketsConfig>;
  const enabled = Array.isArray(c.enabled)
    ? enabledMarkets(registryOf(c.enabled.filter((v): v is string => typeof v === "string")))
    : [];
  return { version: 1, enabled };
}

// ---- Validation (backend, before persisting) -------------------------------

export const marketsConfigSchema = z.object({
  version: z.literal(1).optional(),
  markets: z
    .array(
      z.object({
        country: z.string().length(2),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        updatedAt: z.number().optional(),
        updatedBy: z.string().max(120).optional(),
      }),
    )
    .max(400),
  updatedAt: z.number().optional(),
});
