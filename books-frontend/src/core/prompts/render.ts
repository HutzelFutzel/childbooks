/**
 * Pure prompt compiler. Turns an admin-editable {@link PromptTemplate} plus a
 * typed runtime context (variables + boolean flags) into the final prompt
 * string(s). No side effects — the same function runs on the client, the
 * backend `/ai/*` endpoints and the worker.
 *
 * Template syntax (kept deliberately tiny so it can't misbehave):
 *   - `{{ name }}`      → interpolate `ctx.vars.name` (missing → "").
 *   - `{{> partialId }}` → inline a named partial (recursively rendered).
 * A block is emitted only when its `enabled` toggle isn't `false`, its
 * `enabledWhen` predicate flag is satisfied, and its rendered text is non-empty.
 */
import type {
  PromptBlock,
  PromptSegment,
  PromptTemplate,
  PromptsConfig,
} from "../config/prompts";

export interface PromptRenderContext {
  vars?: Record<string, string | number | boolean | null | undefined>;
  flags?: Record<string, boolean>;
}

/** Segment join separators — match the original hand-written prompt assembly. */
const SEGMENT_SEP: Record<PromptSegment, string> = {
  system: " ",
  user: "\n",
  single: " ",
};

const VAR_RE = /\{\{\s*(>?)\s*([\w.-]+)\s*\}\}/g;

function toText(value: unknown): string {
  if (value == null || value === false) return "";
  return String(value);
}

/** Interpolate a single string against the context + partials (recursion-safe). */
function interpolate(
  text: string,
  ctx: PromptRenderContext,
  partials: Record<string, string>,
  seen: Set<string>,
): string {
  return text.replace(VAR_RE, (_m, isPartial: string, name: string) => {
    if (isPartial) {
      if (seen.has(name)) return ""; // guard against cyclic partial includes
      const partial = partials[name];
      if (partial == null) return "";
      return interpolate(partial, ctx, partials, new Set(seen).add(name));
    }
    return toText(ctx.vars?.[name]);
  });
}

/** Is a block active given its manual toggle + runtime predicate? */
function blockActive(block: PromptBlock, flags: Record<string, boolean>): boolean {
  if (block.enabled === false) return false;
  const cond = block.enabledWhen?.trim();
  if (!cond) return true;
  const negate = cond.startsWith("!");
  const key = negate ? cond.slice(1).trim() : cond;
  const value = Boolean(flags[key]);
  return negate ? !value : value;
}

/** Compile one segment (system/user/single) into a joined string. */
function renderSegment(
  blocks: PromptBlock[] | undefined,
  seg: PromptSegment,
  ctx: PromptRenderContext,
  partials: Record<string, string>,
): string {
  if (!blocks?.length) return "";
  const flags = ctx.flags ?? {};
  const out: string[] = [];
  for (const block of blocks) {
    if (!blockActive(block, flags)) continue;
    const rendered = interpolate(block.text, ctx, partials, new Set()).trim();
    if (rendered) out.push(rendered);
  }
  return out.join(SEGMENT_SEP[seg]);
}

function template(config: PromptsConfig, key: string): PromptTemplate {
  return config.templates[key] ?? {};
}

/** Render a text prompt (system + user messages) for a template key. */
export function renderTextPrompt(
  config: PromptsConfig,
  key: string,
  ctx: PromptRenderContext,
): { system: string; user: string } {
  const tpl = template(config, key);
  return {
    system: renderSegment(tpl.system, "system", ctx, config.partials),
    user: renderSegment(tpl.user, "user", ctx, config.partials),
  };
}

/** Render a single-string prompt (image generation) for a template key. */
export function renderSinglePrompt(
  config: PromptsConfig,
  key: string,
  ctx: PromptRenderContext,
): string {
  const tpl = template(config, key);
  return renderSegment(tpl.single, "single", ctx, config.partials);
}
