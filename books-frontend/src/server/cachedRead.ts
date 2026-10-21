import { cache } from "react";

const SERVER_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value?: T;
  expiresAt: number;
  inFlight?: Promise<T>;
}

const memoryStore = new Map<string, CacheEntry<unknown>>();

/**
 * Wrap an async server reader with both React's per-request `cache()` and a
 * short-lived in-process TTL cache (60s).
 *
 * Why both:
 *   1. `React.cache()` deduplicates within a single RSC render pass, but does
 *      NOT share results across `generateMetadata`, `generateViewport` and
 *      `RootLayout`, nor across dynamic requests (`/pricing`) or `next dev`
 *      page navigations.
 *   2. The in-process TTL cache shares the in-flight promise and resolved
 *      value across all server phases and requests within the 60s window
 *      (matching the marketing routes' `revalidate = 60`), while preventing an
 *      offline local Firestore emulator from timing out sequentially on every
 *      reader call.
 */
export function cachedServerRead<T>(key: string, loader: () => Promise<T>): () => Promise<T> {
  return cache(async (): Promise<T> => {
    const now = Date.now();
    const hit = memoryStore.get(key) as CacheEntry<T> | undefined;
    if (hit) {
      if (hit.value !== undefined && now < hit.expiresAt) {
        return hit.value;
      }
      if (hit.inFlight) {
        return hit.inFlight;
      }
    }

    const inFlight = loader()
      .then((value) => {
        memoryStore.set(key, {
          value,
          expiresAt: Date.now() + SERVER_CACHE_TTL_MS,
        });
        return value;
      })
      .catch((err) => {
        memoryStore.delete(key);
        throw err;
      });

    memoryStore.set(key, {
      expiresAt: now + SERVER_CACHE_TTL_MS,
      inFlight,
    });
    return inFlight;
  });
}
