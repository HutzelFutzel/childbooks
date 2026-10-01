/**
 * Per-action text parameters, mapped onto each provider's request body.
 *
 * The admin sets one vocabulary (Configuration → Models → parameters); each API
 * names it differently. This runs on the serialized body just before the HTTP
 * call, so pipeline functions never thread reasoning levels through their
 * signatures, and a body this does not recognize passes through untouched.
 */
import type { ProviderId } from "../config/options";
import type { ReasoningEffort, TextCallParams } from "../config/modelConfig";

/** Gemini 3 thinking levels. There is no "off"; `minimal` is the floor. */
const GEMINI_LEVEL: Record<ReasoningEffort, string> = {
  none: "minimal",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
};

/** Gemini 2.5 thinking budgets in tokens. Pro models refuse 0. */
const GEMINI_BUDGET: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 512,
  low: 1_024,
  medium: 4_096,
  high: 16_384,
};

function isGemini3(model: string): boolean {
  return /gemini-(3|[4-9])/.test(model);
}

function isGemini25(model: string): boolean {
  return /gemini-2\.5/.test(model);
}

/** OpenAI families that accept `reasoning_effort`. */
function acceptsReasoningEffort(model: string): boolean {
  return /^(gpt-(5|6|7)|o\d)/.test(model);
}

function geminiModelFromUrl(url: string): string {
  return /models\/([^:/?]+)/.exec(url)?.[1] ?? "";
}

/**
 * The same request with the parameters applied. Never throws: a body that is
 * not JSON, or not a text request, comes back unchanged.
 */
export function applyTextParams(
  provider: ProviderId,
  url: string,
  body: string,
  params: TextCallParams,
): string {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return body;
  }
  if (!json || typeof json !== "object") return body;

  if (provider === "google") {
    if (!url.includes(":generateContent") && !url.includes(":streamGenerateContent")) return body;
    const model = geminiModelFromUrl(url);
    if (model.includes("image")) return body;
    const config = { ...((json.generationConfig as Record<string, unknown> | undefined) ?? {}) };
    if (params.temperature !== undefined) config.temperature = params.temperature;
    if (params.maxOutputTokens !== undefined) config.maxOutputTokens = params.maxOutputTokens;
    if (params.reasoning) {
      if (isGemini3(model)) {
        config.thinkingConfig = { thinkingLevel: GEMINI_LEVEL[params.reasoning] };
      } else if (isGemini25(model)) {
        const budget = GEMINI_BUDGET[params.reasoning];
        config.thinkingConfig = { thinkingBudget: model.includes("pro") ? Math.max(128, budget) : budget };
      }
    }
    json.generationConfig = config;
    return JSON.stringify(json);
  }

  if (provider === "openai") {
    if (!url.includes("/chat/completions") && !url.includes("/responses")) return body;
    const model = typeof json.model === "string" ? json.model : "";
    if (model.includes("image")) return body;
    if (params.temperature !== undefined) json.temperature = params.temperature;
    if (params.maxOutputTokens !== undefined) {
      if (url.includes("/responses")) json.max_output_tokens = params.maxOutputTokens;
      else json.max_completion_tokens = params.maxOutputTokens;
    }
    if (params.reasoning && acceptsReasoningEffort(model)) {
      if (url.includes("/responses")) json.reasoning = { effort: params.reasoning };
      else json.reasoning_effort = params.reasoning;
    }
    return JSON.stringify(json);
  }

  return body;
}
