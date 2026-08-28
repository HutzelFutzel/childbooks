/**
 * Converts a Zod schema into a Gemini-compatible response schema.
 *
 * Gemini's `responseSchema` is a small OpenAPI 3.0 subset. Anything outside it
 * is a 400 (`Unknown name "maxLength"` and friends), not a silent ignore —
 * which is how a `z.string().max(n)` on an otherwise-valid schema took down
 * the release-notes call. Zod still enforces those constraints on the parsed
 * output; they just must not appear in what we send.
 *
 * This walks the generated JSON Schema, inlines `$ref`s, drops unsupported
 * keys, and normalizes nullable types.
 *
 * OpenAI's structured-output subset is different (it wants `additionalProperties:
 * false` and `$defs`, and rejects a different set of keywords). That conversion
 * lives in `providers/openai/schema.ts`. Callers pass one Zod schema; each
 * provider converts it for its own API.
 */
import { z } from "zod";

/**
 * Keywords Gemini's `responseSchema` rejects. Kept as a denylist (not an
 * allowlist) so newly-documented fields like `propertyOrdering` still pass
 * through if Zod ever emits them.
 *
 * Length/pattern/numeric-exclusion keywords are the ones Zod emits for
 * `.max()` / `.min()` / `.regex()` on strings — supported as JSON Schema,
 * not as Gemini Schema. `maxItems` / `minItems` / `minimum` / `maximum` ARE
 * in Gemini's subset and are intentionally left alone.
 */
const UNSUPPORTED_KEYS = new Set([
  "$schema",
  "$id",
  "$comment",
  "additionalProperties",
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
  "$defs",
  "definitions",
  // JSON Schema string/number constraints Zod emits; Gemini 400s on these.
  "maxLength",
  "minLength",
  "pattern",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "uniqueItems",
  "contentEncoding",
  "contentMediaType",
]);

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function refKey(ref: string): string {
  return ref.replace(/^#\/\$defs\//, "").replace(/^#\/definitions\//, "");
}

/** Returns a sanitized schema object, or undefined if conversion fails. */
export function toGeminiSchema(schema: z.ZodType): unknown | undefined {
  let json: JsonObject;
  try {
    json = z.toJSONSchema(schema) as JsonObject;
  } catch {
    return undefined;
  }

  const defs: JsonObject = {
    ...((json.$defs as JsonObject) ?? {}),
    ...((json.definitions as JsonObject) ?? {}),
  };
  const resolving = new Set<string>();

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(walk);
    if (!isObject(node)) return node;

    // Inline $ref against the collected definitions.
    if (typeof node.$ref === "string") {
      const key = refKey(node.$ref);
      const target = defs[key];
      if (target && !resolving.has(key)) {
        resolving.add(key);
        const resolved = walk(target);
        resolving.delete(key);
        return resolved;
      }
      return { type: "object" };
    }

    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) {
      if (UNSUPPORTED_KEYS.has(k)) continue;

      // Normalize JSON-Schema's `type: ["string","null"]` to nullable.
      if (k === "type" && Array.isArray(v)) {
        const types = v.filter((t) => t !== "null");
        out.type = types[0] ?? "string";
        if (v.includes("null")) out.nullable = true;
        continue;
      }

      out[k] = walk(v);
    }
    return out;
  }

  return walk(json);
}
