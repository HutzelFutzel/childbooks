/**
 * A tiny in-process TTL cache with single-flight, for expensive admin reads
 * (order scans, finance aggregation).
 *
 * - Concurrent callers for one key share a single loader run, so a dashboard
 *   that fires several requests which all need the same scan pays for it once.
 * - Only successful loads are cached; a failure is never remembered.
 * - Per-instance: a Cloud Functions instance has its own cache. That is fine for
 *   a dashboard — the worst case is one scan per warm instance per TTL window.
 * - `fresh` bypasses the cached value (an explicit "Refresh" click), and the
 *   result still repopulates the cache for everyone else.
 */
export interface TtlCache<T> {
  get(key: string, loader: () => Promise<T>, opts?: { fresh?: boolean }): Promise<T>;
  /** Drop one key, or everything when no key is given. */
  invalidate(key?: string): void;
}

interface Entry<T> {
  at: number;
  value: T;
}

export function createTtlCache<T>(ttlMs: number, maxEntries = 32): TtlCache<T> {
  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();
  /** Bumped by `invalidate` so a load that started before it can't repopulate stale data. */
  let generation = 0;

  const remember = (key: string, value: T) => {
    entries.delete(key);
    entries.set(key, { at: Date.now(), value });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    async get(key, loader, opts) {
      const fresh = opts?.fresh === true;
      if (!fresh) {
        const hit = entries.get(key);
        if (hit && Date.now() - hit.at < ttlMs) return hit.value;
        const pending = inflight.get(key);
        if (pending) return pending;
      }
      const startedIn = generation;
      const run = loader()
        .then((value) => {
          if (startedIn === generation) remember(key, value);
          return value;
        })
        .finally(() => {
          if (inflight.get(key) === run) inflight.delete(key);
        });
      inflight.set(key, run);
      return run;
    },
    invalidate(key) {
      generation += 1;
      if (key === undefined) {
        entries.clear();
        inflight.clear();
      } else {
        entries.delete(key);
        inflight.delete(key);
      }
    },
  };
}
