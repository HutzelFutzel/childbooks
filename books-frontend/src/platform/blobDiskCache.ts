/**
 * A copy of the small display pictures on this device's disk, so reopening a
 * book (or the dashboard) costs no network at all.
 *
 * Only the small copies are kept — never the full-size master, which is the
 * very thing this exists to avoid moving around. They are immutable (an id is
 * minted per render), so an entry can never be stale; the only reasons one goes
 * away are that its picture was deleted, the account left this device, or the
 * cap below trimmed it.
 *
 * These are private pictures, possibly of a child, so the cache is partitioned
 * by account: one cache per uid, every other account's cache is deleted the
 * moment a different account is seen, and signing out deletes all of them. It
 * is a best-effort layer throughout — no browser support, a full disk or a
 * private window just means the pictures come from the network as before.
 */

const CACHE_PREFIX = "childbooks-blobs-v1:";

/** Entries kept per account; the oldest go first. Small copies, so this is tens of MB. */
const MAX_ENTRIES = 600;

/** Trim only every so often: listing a cache is not free. */
const TRIM_EVERY = 40;

let puts = 0;
let lastUid: string | null = null;

function supported(): boolean {
  return typeof caches !== "undefined";
}

function cacheName(uid: string): string {
  return `${CACHE_PREFIX}${uid}`;
}

/** A cache key only has to be a unique http(s) URL; nothing is ever fetched from it. */
function requestFor(name: string): Request {
  return new Request(`https://blobs.invalid/${encodeURIComponent(name)}`);
}

/** Delete every account's cache except `keepUid`'s (all of them when omitted). */
async function dropCaches(keepUid?: string): Promise<void> {
  if (!supported()) return;
  const keep = keepUid ? cacheName(keepUid) : null;
  const names = await caches.keys();
  await Promise.all(
    names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== keep).map((n) => caches.delete(n)),
  );
}

/** First sight of an account on this device: nobody else's pictures may stay. */
function settleAccount(uid: string): void {
  if (lastUid === uid) return;
  lastUid = uid;
  void dropCaches(uid).catch(() => undefined);
}

/** A cached picture, or null. */
export async function diskCacheGet(uid: string, name: string): Promise<Blob | null> {
  if (!supported()) return null;
  try {
    settleAccount(uid);
    const hit = await (await caches.open(cacheName(uid))).match(requestFor(name));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

/** Remember a picture. Never throws: a full disk is not an error worth surfacing. */
export async function diskCachePut(uid: string, name: string, blob: Blob): Promise<void> {
  if (!supported()) return;
  try {
    settleAccount(uid);
    const cache = await caches.open(cacheName(uid));
    await cache.put(requestFor(name), new Response(blob));
    puts += 1;
    if (puts % TRIM_EVERY === 0) {
      const keys = await cache.keys();
      // Keys come back in insertion order, so the front of the list is the oldest.
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((k) => cache.delete(k)));
    }
  } catch {
    // Quota, private mode, storage cleared underneath us — fall back to the network.
  }
}

/** Forget these pictures (the picture was deleted). */
export async function diskCacheDelete(uid: string, names: string[]): Promise<void> {
  if (!supported()) return;
  try {
    const cache = await caches.open(cacheName(uid));
    await Promise.all(names.map((name) => cache.delete(requestFor(name))));
  } catch {
    // Nothing worth doing: an orphaned entry is harmless and gets trimmed in time.
  }
}

/** Remove every account's pictures from this device (sign-out, account switch). */
export async function clearBlobDiskCache(): Promise<void> {
  lastUid = null;
  try {
    await dropCaches();
  } catch {
    // Best effort.
  }
}
