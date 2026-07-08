/**
 * **Prompt templates** — the admin-editable text of every LLM prompt the app
 * makes (`appConfig/prompts`, world-readable so the studio can render prompts
 * live). The goal: tune/improve prompts from the admin dashboard without ever
 * touching code.
 *
 * Split of ownership (see `core/prompts/registry.ts`):
 *   - CODE owns the *contract*: which variables/flags a template may reference,
 *     the ordered set of blocks, each block's runtime predicate (`enabledWhen`),
 *     the output schema, and the branch/variant selection. These are type-safe
 *     and can never be broken from the dashboard.
 *   - ADMINS own the *content*: the wording of each block, and whether an
 *     optional block is enabled. That's the 90% of prompt iteration.
 *
 * Stored docs are always re-anchored onto the built-in defaults by
 * {@link normalizePromptsConfig}, so a missing/partial/stale doc silently falls
 * back to the shipped prompts and the app keeps working.
 */
import { z } from "zod";
import {
  createDefaultPromptsConfig,
  DEFAULT_PARTIALS,
  PROMPT_ACTIONS,
  PROMPT_TEMPLATE_KEYS,
  defaultTemplate,
} from "../prompts/registry";

/** One ordered fragment of a prompt (mirrors the old `parts.push(...)` arrays). */
export interface PromptBlock {
  id: string;
  /** The fragment text. May contain `{{var}}` and `{{> partialId}}` tokens. */
  text: string;
  /**
   * Runtime predicate key (code-owned). When set, the block is only included if
   * the caller's flag of this name is truthy. Prefix with `!` to negate. Not
   * editable from the dashboard — it wires the block to pipeline state.
   */
  enabledWhen?: string;
  /** Admin manual toggle. When explicitly `false` the block is always skipped. */
  enabled?: boolean;
}

/** The three prompt segments. Text calls use system+user; image calls use single. */
export interface PromptTemplate {
  system?: PromptBlock[];
  user?: PromptBlock[];
  single?: PromptBlock[];
}

/** The full admin-editable prompt library (the `appConfig/prompts` document). */
export interface PromptsConfig {
  version: 1;
  /** Keyed by template key (`actionId` or `actionId/variantId`). */
  templates: Record<string, PromptTemplate>;
  /** Named, reusable sub-prompts referenced via `{{> id}}`. */
  partials: Record<string, string>;
}

export type PromptSegment = "system" | "user" | "single";

// ---- Validation (admin input) ---------------------------------------------

const blockSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(20000),
  enabledWhen: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
});

const templateSchema = z.object({
  system: z.array(blockSchema).optional(),
  user: z.array(blockSchema).optional(),
  single: z.array(blockSchema).optional(),
});

export const promptsConfigSchema = z.object({
  version: z.literal(1),
  templates: z.record(z.string(), templateSchema),
  partials: z.record(z.string(), z.string().max(20000)),
});

// ---- Normalization ---------------------------------------------------------

/**
 * Re-anchor a stored (possibly partial/stale) doc onto the code defaults. The
 * default block set, order, and `enabledWhen` predicates are authoritative; the
 * stored doc only contributes each known block's `text` and `enabled` toggle
 * (matched by id), plus overrides for known partials. Unknown keys/blocks are
 * dropped, so the config can never drift out of sync with the code contract.
 */
export function normalizePromptsConfig(input: unknown): PromptsConfig {
  const stored = (input ?? {}) as Partial<PromptsConfig>;
  const storedTemplates = (stored.templates ?? {}) as Record<string, PromptTemplate>;
  const storedPartials = (stored.partials ?? {}) as Record<string, string>;

  const templates: Record<string, PromptTemplate> = {};
  for (const key of PROMPT_TEMPLATE_KEYS) {
    templates[key] = mergeTemplate(defaultTemplate(key), storedTemplates[key]);
  }

  const partials: Record<string, string> = {};
  for (const [id, text] of Object.entries(DEFAULT_PARTIALS)) {
    const override = storedPartials[id];
    partials[id] = typeof override === "string" && override.trim() ? override : text;
  }

  return { version: 1, templates, partials };
}

function mergeTemplate(def: PromptTemplate, stored?: PromptTemplate): PromptTemplate {
  const out: PromptTemplate = {};
  for (const seg of ["system", "user", "single"] as const) {
    const defBlocks = def[seg];
    if (!defBlocks) continue;
    const overrides = new Map((stored?.[seg] ?? []).map((b) => [b.id, b]));
    out[seg] = defBlocks.map((b) => {
      const o = overrides.get(b.id);
      return {
        ...b,
        text: typeof o?.text === "string" ? o.text : b.text,
        ...(typeof o?.enabled === "boolean" ? { enabled: o.enabled } : {}),
      };
    });
  }
  return out;
}

// ---- Reference linting (run before persisting) ----------------------------

const TOKEN_RE = /\{\{\s*(>?)\s*([\w.-]+)\s*\}\}/g;

/**
 * Guard against a template referencing a variable the pipeline never supplies,
 * or a missing partial. Throws with a readable list so the admin gets immediate
 * feedback; the shipped defaults always pass.
 */
export function lintPromptsConfig(config: PromptsConfig): void {
  const varsByKey = new Map<string, Set<string>>();
  for (const action of PROMPT_ACTIONS) {
    for (const t of action.templates) {
      varsByKey.set(t.key, new Set(t.variables.map((v) => v.name)));
    }
  }
  const partialIds = new Set(Object.keys(config.partials));
  const errors: string[] = [];

  for (const [key, tpl] of Object.entries(config.templates)) {
    const allowed = varsByKey.get(key);
    for (const seg of ["system", "user", "single"] as const) {
      for (const block of tpl[seg] ?? []) {
        TOKEN_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = TOKEN_RE.exec(block.text)) !== null) {
          const [, isPartial, name] = m;
          if (isPartial) {
            if (!partialIds.has(name)) errors.push(`${key} · ${block.id}: unknown partial "${name}"`);
          } else if (allowed && !allowed.has(name)) {
            errors.push(`${key} · ${block.id}: unknown variable "${name}"`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid prompt template references:\n${errors.join("\n")}`);
  }
}

export { createDefaultPromptsConfig };
