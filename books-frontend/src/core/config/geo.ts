/**
 * Geographic targeting primitives, shared by the catalog and the shipping
 * policy.
 *
 * Extracted into their own module for one reason: `products.ts` and
 * `shipping.ts` both need the schema at RUNTIME (each validates a document that
 * embeds a policy), and importing it from either one into the other would make
 * a real import cycle. This module imports nothing, so both edges terminate.
 *
 * The countries we sell to are NOT declared by a {@link GeoPolicy}. They live
 * in the admin-managed market registry (`markets.ts`), and every geo check
 * intersects with that registry BEFORE consulting a policy — so a policy can
 * only ever narrow the set, never widen it. See `isDestinationAllowed`.
 */
import { z } from "zod";

export interface GeoMatch {
  country?: string; // ISO-2
  region?: string; // state / province code
}

export interface GeoPolicy {
  /**
   * How `countries` is read.
   *
   * `"all"` means "everywhere we sell", not everywhere — the market registry
   * bounds every mode. It is stored as a mode rather than expanded into a
   * snapshot list precisely BECAUSE the registry is dynamic: a frozen copy of
   * today's markets would silently exclude a country opened tomorrow.
   */
  mode: "all" | "allowlist" | "blocklist";
  countries: string[]; // ISO-2
  /** Per-country state/province restrictions (e.g. ship to US but not AK/HI). */
  regions: Record<string, { mode: "allowlist" | "blocklist"; codes: string[] }>;
}

export const geoMatchSchema = z.object({
  country: z.string().optional(),
  region: z.string().optional(),
});

export const geoPolicySchema = z.object({
  mode: z.enum(["all", "allowlist", "blocklist"]),
  countries: z.array(z.string()),
  regions: z.record(
    z.string(),
    z.object({ mode: z.enum(["allowlist", "blocklist"]), codes: z.array(z.string()) }),
  ),
});
