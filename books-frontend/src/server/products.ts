/**
 * Server-side readers for the public print catalog and the catalog-wide pricing
 * economics.
 *
 * Both documents are world-readable projections (`appConfig/products`,
 * `appConfig/pricingSettings`) with no cost or margin internals — see
 * `functions/src/products.ts` for what is deliberately left out of them. Reading
 * them here lets the print-pricing pages render real prices in the server HTML,
 * which is what makes them indexable and what lets a visitor see a number before
 * any JavaScript runs. Mirrors {@link getPublicPlans}.
 */
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import {
  createDefaultPricingSettings,
  normalizePricingSettings,
  normalizePublicProductsConfig,
  type PricingSettings,
  type PublicProductsConfig,
} from "../core/config/products";
import {
  createDefaultCatalogMediaConfig,
  normalizeCatalogMediaConfig,
  type CatalogMediaConfig,
} from "../core/config/catalogMedia";

/** Fetch the public product projection, or an empty catalog when unset/unreadable. */
export async function getPublicProducts(): Promise<PublicProductsConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "products"));
    const config = normalizePublicProductsConfig(snap.exists() ? snap.data() : undefined);
    // An empty result here reads to a visitor as "our catalog is being
    // updated," which is indistinguishable from a genuinely empty catalog. Log
    // which one it actually was, so "why is nothing showing" is a server-log
    // lookup instead of a guess — see `isOfferable` for the usual real cause
    // (a product that's Active but hasn't been Verified/priced/measured yet).
    if (config.products.length === 0) {
      console.warn(
        snap.exists()
          ? "getPublicProducts: appConfig/products exists but projected zero products (none are status=active AND offerable — check Admin \u2192 Products)."
          : "getPublicProducts: appConfig/products does not exist yet.",
      );
    }
    return config;
  } catch (err) {
    console.error("getPublicProducts: failed to read appConfig/products, falling back to an empty catalog.", err);
    return { version: 1, products: [] };
  }
}

/**
 * Fetch the catalog-wide pricing settings, falling back to the defaults.
 *
 * The defaults are a safe fallback rather than a guess: what these pages take
 * from the settings is rounding, price floors, the currency list and tax
 * behaviour, and a product's own tier prices — the numbers a customer actually
 * pays — come from the catalog either way.
 */
export async function getPricingSettings(): Promise<PricingSettings> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "pricingSettings"));
    return normalizePricingSettings(snap.exists() ? snap.data() : undefined);
  } catch {
    return createDefaultPricingSettings();
  }
}

/**
 * Fetch the catalog photography (product and print-option pictures).
 *
 * Passed down to the pickers as a prop so a public page can show real
 * photographs without subscribing to the whole live config store.
 */
export async function getCatalogMedia(): Promise<CatalogMediaConfig> {
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "appConfig", "catalogMedia"));
    return normalizeCatalogMediaConfig(snap.exists() ? snap.data() : undefined);
  } catch {
    return createDefaultCatalogMediaConfig();
  }
}
