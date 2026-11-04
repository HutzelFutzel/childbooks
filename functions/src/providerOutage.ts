/**
 * Pages ops when an AI provider refuses us for reasons no retry can fix: the
 * account is out of credit (`billing`) or our key was rejected (`auth`).
 *
 * Callers invoke this only once retrying is over — the last Cloud Tasks attempt,
 * or an interactive request whose in-pipeline retries are spent — so a blip that
 * recovers on its own never pages. Deduped per provider, kind and hour: a batch of
 * twenty pages failing on one empty balance is one Slack message, and an outage
 * that lasts the afternoon is reminded hourly rather than forgotten.
 */
import { ProviderError } from "../../books-frontend/src/core/errors";
import type { LogSource } from "../../books-frontend/src/core/logging/types";
import { log } from "./logs";

function outageOf(err: unknown): ProviderError | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof ProviderError) {
      return current.kind === "billing" || current.kind === "auth" ? current : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export async function reportProviderOutage(
  err: unknown,
  ctx: {
    source: LogSource;
    uid?: string | null;
    projectId?: string | null;
    jobId?: string | null;
    action?: string;
  },
): Promise<void> {
  const outage = outageOf(err);
  if (!outage) return;
  const provider = outage.provider ?? "unknown";
  const what =
    outage.kind === "billing"
      ? `${provider} refused the call for billing (account out of credit or over its limit)`
      : `${provider} rejected our API key`;
  await log.fatal({
    source: ctx.source,
    domain: "ai",
    event: `ai.provider.${outage.kind}`,
    message: `${what}${ctx.action ? ` during ${ctx.action}` : ""}: ${outage.message}`,
    ...(ctx.uid !== undefined ? { uid: ctx.uid } : {}),
    ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
    ...(ctx.jobId !== undefined ? { jobId: ctx.jobId } : {}),
    error: outage,
    context: { provider, kind: outage.kind, status: outage.status ?? null, action: ctx.action ?? null },
    ref: `${provider}_${outage.kind}_${Math.floor(Date.now() / 3_600_000)}`,
  });
}
