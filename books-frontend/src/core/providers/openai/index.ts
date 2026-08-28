/**
 * OpenAI provider adapter (text, structured output, image generation).
 */
import { z } from "zod";
import { ProviderError } from "../../errors";
import { providerHttp } from "../httpContext";
import { requestJson } from "../http-helpers";
import { openaiSchemaName, toOpenAISchema } from "./schema";
import type {
  ImageProvider,
  ImageRequest,
  ImageResult,
  ProviderCredentials,
  RawModel,
  StructuredRequest,
  TextProvider,
  TextRequest,
  TextResponse,
} from "../types";

function headers(creds: ProviderCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
  };
}

function base(): string {
  return providerHttp().baseUrl("openai");
}

interface OpenAIModelList {
  data: { id: string; owned_by?: string }[];
}

interface ChatCompletion {
  choices: { message: { content: string | null } }[];
}

interface ImagesResponse {
  data: { b64_json?: string; url?: string }[];
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  // Strip ```json fences if present.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  // Otherwise grab the outermost braces.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

type VisionPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Chat messages for a structured call, with optional vision parts on the last user turn. */
function structuredMessages(
  req: StructuredRequest<unknown>,
  extraSystem?: string,
): { role: string; content: string | VisionPart[] }[] {
  const messages: { role: string; content: string | VisionPart[] }[] = [];
  if (extraSystem) messages.push({ role: "system", content: extraSystem });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });
  if (!req.images?.length) return messages;

  const imageParts: VisionPart[] = req.images.map((im) => ({
    type: "image_url",
    image_url: { url: `data:${im.mimeType};base64,${im.base64}` },
  }));
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      idx = i;
      break;
    }
  }
  if (idx >= 0) {
    const existing = messages[idx].content;
    const text = typeof existing === "string" ? existing : "";
    messages[idx] = { role: "user", content: [{ type: "text", text }, ...imageParts] };
  } else {
    messages.push({ role: "user", content: imageParts });
  }
  return messages;
}

function jsonObjectHint(schema: z.ZodType): string {
  let schemaHint = "";
  try {
    schemaHint = JSON.stringify(z.toJSONSchema(schema));
  } catch {
    schemaHint = "";
  }
  return (
    "You are a precise assistant that replies with a single valid JSON object and nothing else." +
    (schemaHint ? ` It must conform to this JSON schema: ${schemaHint}` : "")
  );
}

export const openaiTextProvider: TextProvider = {
  provider: "openai",

  async listModels(creds, signal): Promise<RawModel[]> {
    const json = await requestJson<OpenAIModelList>("openai", `${base()}/v1/models`, {
      method: "GET",
      headers: headers(creds),
      signal,
    });
    return json.data.map((m) => ({ id: m.id }));
  },

  async generateText(creds, req: TextRequest): Promise<TextResponse> {
    const json = await requestJson<ChatCompletion>(
      "openai",
      `${base()}/v1/chat/completions`,
      {
        method: "POST",
        headers: headers(creds),
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          max_completion_tokens: req.maxOutputTokens,
        }),
      },
    );
    const text = json.choices[0]?.message?.content ?? "";
    return { text, model: req.model };
  },

  async generateStructured<T>(
    creds: ProviderCredentials,
    req: StructuredRequest<T>,
  ): Promise<T> {
    const openaiSchema = toOpenAISchema(req.schema);

    const complete = (
      messages: { role: string; content: string | VisionPart[] }[],
      responseFormat: unknown,
    ) =>
      requestJson<ChatCompletion>("openai", `${base()}/v1/chat/completions`, {
        method: "POST",
        headers: headers(creds),
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          messages,
          temperature: req.temperature ?? 0.4,
          response_format: responseFormat,
        }),
      });

    // Prefer native structured outputs. Some models (or a schema we couldn't
    // make strict) 400 — fall back to json_object + a schema hint, which is
    // what this adapter used before json_schema existed.
    let json: ChatCompletion;
    if (openaiSchema) {
      try {
        json = await complete(structuredMessages(req), {
          type: "json_schema",
          json_schema: {
            name: openaiSchemaName(req.schemaName),
            strict: openaiSchema.strict,
            schema: openaiSchema.schema,
          },
        });
      } catch (err) {
        if (!(err instanceof ProviderError) || err.kind !== "invalid_request") throw err;
        json = await complete(structuredMessages(req, jsonObjectHint(req.schema)), {
          type: "json_object",
        });
      }
    } else {
      json = await complete(structuredMessages(req, jsonObjectHint(req.schema)), {
        type: "json_object",
      });
    }

    const raw = json.choices[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (err) {
      throw new ProviderError("Model did not return valid JSON", {
        kind: "parse",
        provider: "openai",
        cause: err,
        details: raw.slice(0, 500),
      });
    }
    const result = req.schema.safeParse(parsed);
    if (!result.success) {
      throw new ProviderError("Model JSON failed schema validation", {
        kind: "parse",
        provider: "openai",
        details: result.error.message,
      });
    }
    return result.data;
  },
};

export const openaiImageProvider: ImageProvider = {
  provider: "openai",

  async generateImage(creds, req: ImageRequest): Promise<ImageResult> {
    // With references we use the edits endpoint (multipart); otherwise generations.
    if (req.references && req.references.length > 0) {
      const form = new FormData();
      form.append("model", req.model);
      form.append("prompt", req.prompt);
      if (req.size) form.append("size", req.size);
      if (req.quality) form.append("quality", req.quality);
      req.references.forEach((ref, i) => {
        const bytes = Uint8Array.from(atob(ref.base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: ref.mimeType });
        const ext = ref.mimeType.split("/")[1] || "png";
        form.append("image[]", blob, `ref_${i}.${ext}`);
      });
      // Inpainting: a transparent-hole PNG mask aligned to the first image.
      if (req.mask) {
        const mbytes = Uint8Array.from(atob(req.mask.base64), (c) => c.charCodeAt(0));
        const mblob = new Blob([mbytes], { type: req.mask.mimeType });
        form.append("mask", mblob, "mask.png");
      }
      const json = await requestJson<ImagesResponse>(
        "openai",
        `${base()}/v1/images/edits`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.apiKey}` },
          body: form,
          signal: req.signal,
        },
      );
      const b64 = json.data[0]?.b64_json;
      if (!b64) {
        throw new ProviderError("No image returned", {
          kind: "parse",
          provider: "openai",
        });
      }
      return { base64: b64, mimeType: "image/png", model: req.model };
    }

    const json = await requestJson<ImagesResponse>(
      "openai",
      `${base()}/v1/images/generations`,
      {
        method: "POST",
        headers: headers(creds),
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          prompt: req.prompt,
          size: req.size ?? "1024x1024",
          n: 1,
        }),
      },
    );
    const b64 = json.data[0]?.b64_json;
    if (!b64) {
      throw new ProviderError("No image returned", {
        kind: "parse",
        provider: "openai",
      });
    }
    return { base64: b64, mimeType: "image/png", model: req.model };
  },
};
