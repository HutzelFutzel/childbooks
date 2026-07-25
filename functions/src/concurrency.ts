/**
 * Bounded-concurrency helpers for provider fan-out.
 *
 * Catalog-wide operations (verify every SKU, re-measure every cost) are dozens
 * of provider round trips. Firing them all at once risks the provider's rate
 * limits; firing them one at a time risks the function timeout. A small worker
 * pool is the middle ground.
 */

/** Run `fn` over `items` with at most `limit` in flight, preserving input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
