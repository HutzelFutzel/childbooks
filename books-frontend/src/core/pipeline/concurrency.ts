/**
 * Bounded-concurrency helpers built on p-limit, used to parallelize
 * independent LLM / image generation tasks without flooding provider rate limits.
 */
import pLimit from "p-limit";

/**
 * Default fan-out for batch image generation ("Generate all", "Update affected
 * pages"). Tuned to be noticeably faster than fully serial while staying under
 * typical provider images-per-minute limits (above this, 429s trigger backoff
 * retries and the batch ends up slower).
 */
export const GENERATION_CONCURRENCY = 4;

export interface MapOptions {
  /** Max concurrent tasks. */
  concurrency?: number;
}

/**
 * Run an async mapper over items with bounded concurrency, preserving input
 * order in the result array. Rejects on the first error (use mapSettled to
 * collect partial results instead).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: MapOptions = {},
): Promise<R[]> {
  const limit = pLimit(options.concurrency ?? 4);
  return Promise.all(items.map((item, i) => limit(() => mapper(item, i))));
}

export type SettledResult<R> =
  | { status: "fulfilled"; value: R; index: number }
  | { status: "rejected"; reason: unknown; index: number };

/** Like mapWithConcurrency but never short-circuits; returns per-item results. */
export async function mapSettled<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: MapOptions = {},
): Promise<SettledResult<R>[]> {
  const limit = pLimit(options.concurrency ?? 4);
  return Promise.all(
    items.map((item, index) =>
      limit(async (): Promise<SettledResult<R>> => {
        try {
          return { status: "fulfilled", value: await mapper(item, index), index };
        } catch (reason) {
          return { status: "rejected", reason, index };
        }
      }),
    ),
  );
}
