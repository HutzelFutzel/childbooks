/**
 * Converts a Zod schema into a Gemini-compatible response schema.
 *
 * Gemini's `responseSchema` is a small OpenAPI 3.0 subset. Anything outside it
 * is a 400 (`Unknown name "maxLength"` / `"maxItems"` / `"Request contains an
 * invalid argument."`), not a silent ignore. Zod still enforces `.max()` on
 * the parsed output; those constraints just must not appear in what we send.
 *
 * An allowlist, not a denylist: Zod keeps growing JSON-Schema keywords, and
 * every new one we don't strip is another 400. The keys below are the ones
 * production structured calls already succeed with.
 *
 * OpenAI's subset is different — see `providers/openai/schema.ts`. Callers pass
 * one Zod schema; each provider converts it for its own API.
 */
import { z } from "zod";

/** Keywords Gemini's `responseSchema` accepts. Everything else is dropped. */
const ALLOWED_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "anyOf",
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
      if (k === "properties" && isObject(v)) {
        // Field names are not schema keywords — only the values are schemas.
        const props: JsonObject = {};
        for (const [name, schema] of Object.entries(v)) props[name] = walk(schema);
        out.properties = props;
        continue;
      }
      if (!ALLOWED_KEYS.has(k)) continue;

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
