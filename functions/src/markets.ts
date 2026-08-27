/**
 * Server-side access to the **selling markets** (which countries we ship to)
 * and the **provider coverage** discovered for them.
 *
 * Three documents, and the split matters:
 *   - PRIVATE `adminSettings/markets` — the full {@link MarketsConfig} (admin
 *     intent: which countries are switched on, plus operational notes).
 *   - PUBLIC  `appConfig/markets` — just the enabled codes, so the storefront
 *     can render a country picker without reading admin notes.
 *   - PUBLIC  `appConfig/marketCapability` — what the provider was DISCOVERED
 *     to do, written only by the sweep.
 *
 * Intent and capability never share a document. The sweep rewrites capability
 * wholesale on a schedule; if it also owned the enabled flags it would either
 * clobber an admin's choice or have to merge around it. Keeping them apart
 * makes the interesting case ("enabled here, but coverage disappeared") a
 * derived comparison instead of a write conflict.
 */
import { getFirestore } from "firebase-admin/firestore";
import {
  createDefaultMarketsConfig,
  marketsConfigSchema,
  normalizeMarketsConfig,
  projectPublicMarkets,
  registryFrom,
  type MarketRegistry,
  type MarketsConfig,
} from "../../books-frontend/src/core/config/markets";
import {
  createEmptyMarketCapability,
  normalizeMarketCapability,
  type MarketCapability,
  type MarketCapabilityConfig,
} from "../../books-frontend/src/core/config/marketCapability";
import { ensureAdmin } from "./storage";

const PRIVATE_DOC = "adminSettings/markets";
const PUBLIC_DOC = "appConfig/markets";
const CAPABILITY_DOC = "appConfig/marketCapability";

const CACHE_TTL_MS = 30_000;
let cache: { value: MarketsConfig; at: number } | null = null;
let capabilityCache: { value: MarketCapabilityConfig; at: number } | null = null;

/** Deep-strip `undefined` (Firestore rejects it). */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function getMarketsConfig(): Promise<MarketsConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  ensureAdmin();
  let raw: unknown = undefined;
  try {
    const snap = await getFirestore().doc(PRIVATE_DOC).get();
    raw = snap.exists ? snap.data() : undefined;
  } catch {
    // fall through to the seeded default
  }
  const value = normalizeMarketsConfig(raw);
  cache = { value, at: Date.now() };
  return value;
}

/**
 * The registry every destination check takes.
 *
 * Note what this does NOT do: swallow a read failure into an empty registry.
 * `normalizeMarketsConfig` seeds the established markets when the document is
 * missing, so a first run sells to the countries the business already serves —
 * and a genuinely empty `markets` array (every country switched off) is an
 * explicit admin decision that is honoured as written.
 */
export async function getMarketRegistry(): Promise<MarketRegistry> {
  return registryFrom(await getMarketsConfig());
}

export async function saveMarketsConfig(input: unknown): Promise<MarketsConfig> {
  ensureAdmin();
  const parsed = marketsConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid markets config: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  const config = normalizeMarketsConfig({ ...parsed.data, updatedAt: Date.now() });
  const db = getFirestore();
  await db
    .doc(PRIVATE_DOC)
    .set(stripUndefined(config) as unknown as Record<string, unknown>, { merge: false });
  await db
    .doc(PUBLIC_DOC)
    .set(stripUndefined(projectPublicMarkets(config)) as unknown as Record<string, unknown>, {
      merge: false,
    });
  cache = { value: config, at: Date.now() };
  return config;
}

/**
 * Write the seeded default when no document exists yet, so the very first admin
 * page load shows the markets the storefront is already serving rather than an
 * empty table that implies nothing is sold anywhere.
 */
export async function ensureMarketsSeeded(): Promise<MarketsConfig> {
  ensureAdmin();
  const snap = await getFirestore().doc(PRIVATE_DOC).get();
  if (snap.exists) return getMarketsConfig();
  return saveMarketsConfig(createDefaultMarketsConfig());
}

export async function getMarketCapability(): Promise<MarketCapabilityConfig> {
  if (capabilityCache && Date.now() - capabilityCache.at < CACHE_TTL_MS) {
    return capabilityCache.value;
  }
  ensureAdmin();
  let raw: unknown = undefined;
  try {
    const snap = await getFirestore().doc(CAPABILITY_DOC).get();
    raw = snap.exists ? snap.data() : undefined;
  } catch {
    // fall through
  }
  const value = raw ? normalizeMarketCapability(raw) : createEmptyMarketCapability();
  capabilityCache = { value, at: Date.now() };
  return value;
}

/**
 * Discovered coverage for ONE country, or undefined if no sweep has reached it.
 *
 * Undefined is not "nothing ships there" — the resolvers read a missing entry
 * as "unknown, don't filter on it". Distinguishing the two matters most right
 * after a market is opened, when the admin's intent is recorded but no sweep
 * has run yet.
 */
export async function capabilityFor(country: string): Promise<MarketCapability | undefined> {
  const code = country.trim().toUpperCase();
  if (!code) return undefined;
  const config = await getMarketCapability();
  return config.countries.find((c) => c.country === code);
}

export async function saveMarketCapability(
  config: MarketCapabilityConfig,
): Promise<MarketCapabilityConfig> {
  ensureAdmin();
  const value = normalizeMarketCapability(config);
  await getFirestore()
    .doc(CAPABILITY_DOC)
    .set(stripUndefined(value) as unknown as Record<string, unknown>, { merge: false });
  capabilityCache = { value, at: Date.now() };
  return value;
}
