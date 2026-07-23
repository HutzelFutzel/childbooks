/**
 * Global, admin-managed **Slack notification** configuration.
 *
 * A tiny document holding one on/off toggle per Slack message the product can
 * send (see `core/notify/registry`). All default ON; toggling one OFF stops that
 * particular message from being posted. The webhook URLs themselves are NOT here
 * — they live in Cloud Secret Manager (`SLACK_WEBHOOK_URL`,
 * `SLACK_OPS_WEBHOOK_URL`). Writes go only through the admin-gated backend
 * (`/admin/config/slack`); reads are world-readable at `appConfig/slackConfig`.
 */
import { z } from "zod";
import { SLACK_MESSAGE_IDS, type SlackMessageKey } from "../notify/registry";

export interface SlackConfig {
  version: 1;
  /** Per-message enable toggles, keyed by message id. Missing = enabled. */
  messages: Record<SlackMessageKey, boolean>;
  updatedAt: number;
}

export function createDefaultSlackConfig(): SlackConfig {
  const messages = {} as Record<SlackMessageKey, boolean>;
  for (const id of SLACK_MESSAGE_IDS) messages[id] = true;
  return { version: 1, messages, updatedAt: Date.now() };
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function normalizeSlackConfig(input: unknown): SlackConfig {
  const c = (input ?? {}) as Partial<SlackConfig>;
  const min = (c.messages ?? {}) as Record<string, unknown>;
  const messages = {} as Record<SlackMessageKey, boolean>;
  // Default-ON: an absent key means "enabled" so newly-added messages start on.
  for (const id of SLACK_MESSAGE_IDS) messages[id] = bool(min[id], true);
  return {
    version: 1,
    messages,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
  };
}

/** Whether a given Slack message is enabled in this config (default ON). */
export function slackMessageEnabled(config: SlackConfig, key: SlackMessageKey): boolean {
  return config.messages[key] !== false;
}

// ---- Validation (backend, before persisting) -------------------------------

export const slackConfigSchema = z.object({
  version: z.literal(1).optional(),
  messages: z.record(z.string(), z.boolean()).optional(),
  updatedAt: z.number().optional(),
});
