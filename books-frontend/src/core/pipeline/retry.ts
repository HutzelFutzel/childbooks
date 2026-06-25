/**
 * Retry helper around p-retry with provider-aware behaviour:
 * only retries errors marked retryable (rate limits, transient 5xx/network).
 */
import pRetry, { AbortError } from "p-retry";
import { ProviderError } from "../errors";

export interface RetryOptions {
  retries?: number;
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
  onAttempt?: (info: { attempt: number; error: unknown }) => void;
  signal?: AbortSignal;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries = 3, minTimeoutMs = 600, maxTimeoutMs = 8000, onAttempt, signal } =
    options;

  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (err) {
        // Non-retryable provider errors should abort immediately.
        if (err instanceof ProviderError && !err.retryable) {
          throw new AbortError(err);
        }
        throw err;
      }
    },
    {
      retries,
      minTimeout: minTimeoutMs,
      maxTimeout: maxTimeoutMs,
      factor: 2,
      randomize: true,
      signal,
      onFailedAttempt: (error) => {
        onAttempt?.({ attempt: error.attemptNumber, error });
      },
    },
  );
}
