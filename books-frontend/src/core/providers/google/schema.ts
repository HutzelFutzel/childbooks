/**
 * Converts a Zod schema into a Gemini-compatible response schema.
 *
 * Gemini's `responseSchema` only accepts a restricted OpenAPI 3.0 subset and
 * rejects JSON-Schema metadata that Zod emits (e.g. `$schema`,
 * `additionalProperties`, `$ref`/`$defs`). This walks the generated JSON
 * Schema, inlines refs, drops unsupported keys, and normalizes nullable types.
 */
import { z } from "zod";

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
