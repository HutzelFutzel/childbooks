/**
 * Converts a Zod schema into OpenAI Structured Outputs JSON Schema.
 *
 * OpenAI's `response_format.json_schema` is a different subset from Gemini's
 * `responseSchema`: it WANTS `additionalProperties: false` and `$ref`/`$defs`
 * (Gemini 400s on both), and it rejects string length/pattern and numeric
 * range keywords. Strict mode additionally requires every object property to
 * be listed in `required` — schemas with Zod `.optional()` fields therefore
 * go out with `strict: false` so the model may omit them instead of emitting
 * `null` (which `.optional()` rejects).
 *
 * Zod still enforces `.max()` / `.optional()` on the parsed output; those
 * constraints just must not appear in what we send.
 *
 * Gemini's converter is `providers/google/schema.ts`. Callers pass one Zod
 * schema; each provider converts it for its own API.
 */
import { z } from "zod";

/**
 * Keywords OpenAI structured outputs reject. Distinct from Gemini's list: we
 * KEEP `additionalProperties` (and force it false), `$defs`, `$ref`. We DROP
 * length/range/pattern keywords and OpenAPI `nullable`.
 *
 * `minItems` / `maxItems` / `minimum` / `maximum` are also dropped — unlike
 * Gemini, OpenAI strict (and most json_schema models) 400 on them.
 */
const UNSUPPORTED_KEYS = new Set([
  "$schema",
  "$id",
  "$comment",
  "patternProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "additionalItems",
  "const",
  "examples",
  "default",
  "not",
  "if",
  "then",
  "else",
  "dependentRequired",
  "dependentSchemas",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "contains",
  "prefixItems",
  "maxLength",
  "minLength",
  "pattern",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "uniqueItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "nullable",
  "contentEncoding",
  "contentMediaType",
]);

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** OpenAI schema names: 1–64 letters, digits, underscore, hyphen. */
export function openaiSchemaName(raw: string | undefined): string {
  const cleaned = (raw ?? "Result").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "Result";
}

/**
 * Strict mode needs every property in `required`. If any object has an
 * optional field we must not set `strict: true`, or OpenAI 400s.
 */
function allPropertiesRequired(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(allPropertiesRequired);
  if (!isObject(node)) return true;
  if (isObject(node.properties)) {
    const keys = Object.keys(node.properties);
    const required = new Set(
      Array.isArray(node.required) ? node.required.filter((x) => typeof x === "string") : [],
    );
    if (keys.some((k) => !required.has(k))) return false;
  }
  return Object.values(node).every(allPropertiesRequired);
}

export interface OpenAIJsonSchema {
  schema: JsonObject;
  /** False when the Zod schema has optional fields OpenAI strict cannot express. */
  strict: boolean;
}

/** Returns a sanitized schema, or undefined if conversion fails. */
export function toOpenAISchema(schema: z.ZodType): OpenAIJsonSchema | undefined {
  let json: JsonObject;
  try {
    json = z.toJSONSchema(schema) as JsonObject;
  } catch {
    return undefined;
  }

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(walk);
    if (!isObject(node)) return node;

    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) {
      if (UNSUPPORTED_KEYS.has(k)) continue;

      // JSON Schema `type: ["string","null"]` → anyOf, which OpenAI accepts.
      if (k === "type" && Array.isArray(v)) {
        out.anyOf = v.map((t) => ({ type: t }));
        continue;
      }

      out[k] = walk(v);
    }

    if (isObject(out.properties) && Object.keys(out.properties).length > 0) {
      out.additionalProperties = false;
      if (!out.type) out.type = "object";
    }

    return out;
  }

  const result = walk(json);
  if (!isObject(result)) return undefined;
  return { schema: result, strict: allPropertiesRequired(result) };
}
