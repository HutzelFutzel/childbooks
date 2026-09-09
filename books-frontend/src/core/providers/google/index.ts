/**
 * Google Gemini provider adapter (text, structured output, image generation).
 */
import { ProviderError } from "../../errors";
import { providerHttp } from "../httpContext";
import { requestJson } from "../http-helpers";
import { toGeminiSchema } from "./schema";
import { capabilitiesFor, ratioTokenForSize } from "../../config/modelCapabilities";
import type {
  ImageProvider,
  ImageRequest,
  ImageResult,
  ProviderCredentials,
  RawModel,
  StructuredRequest,
  TextMessage,
  TextProvider,
  TextRequest,
  TextResponse,
} from "../types";

function base(): string {
  return providerHttp().baseUrl("google");
}

function authHeaders(creds: ProviderCredentials): Record<string, string> {
  return {
    "x-goog-api-key": creds.apiKey,
    "Content-Type": "application/json",
  };
}

function stripModelsPrefix(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

interface GoogleModelList {
  models?: {
    name: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }[];
}

interface GenerateContentResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }[];
    };
  }[];
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

function toGeminiContents(messages: TextMessage[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: string; parts: { text: string }[] }[];
} {
  const systemParts: { text: string }[] = [];
  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push({ text: m.content });
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }
  }
  return {
    systemInstruction: systemParts.length ? { parts: systemParts } : undefined,
    contents,
  };
}

function firstText(json: GenerateContentResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

export const googleTextProvider: TextProvider = {
  provider: "google",

  async listModels(creds, signal): Promise<RawModel[]> {
    const json = await requestJson<GoogleModelList>(
      "google",
      `${base()}/v1beta/models?pageSize=200`,
      { method: "GET", headers: authHeaders(creds), signal },
    );
    return (json.models ?? []).map((m) => ({
      id: stripModelsPrefix(m.name),
      displayName: m.displayName,
      capabilities: m.supportedGenerationMethods,
    }));
  },

  async generateText(creds, req: TextRequest): Promise<TextResponse> {
    const { systemInstruction, contents } = toGeminiContents(req.messages);
    const json = await requestJson<GenerateContentResponse>(
      "google",
      `${base()}/v1beta/models/${req.model}:generateContent`,
      {
        method: "POST",
        headers: authHeaders(creds),
        signal: req.signal,
        body: JSON.stringify({
          systemInstruction,
          contents,
          generationConfig: {
            temperature: req.temperature,
            maxOutputTokens: req.maxOutputTokens,
          },
        }),
      },
    );
    return { text: firstText(json), model: req.model };
  },

  async generateStructured<T>(
    creds: ProviderCredentials,
    req: StructuredRequest<T>,
  ): Promise<T> {
    const { systemInstruction, contents } = toGeminiContents(req.messages);
    const responseSchema = toGeminiSchema(req.schema);

    // Attach any images to the final user content so vision-capable models can
    // reason over them (e.g. locate a subject in a page image).
    let finalContents: { role: string; parts: GeminiPart[] }[] = contents;
    if (req.images?.length) {
      finalContents = contents.map((c) => ({ role: c.role, parts: [...c.parts] as GeminiPart[] }));
      const imageParts: GeminiPart[] = [];
      for (const im of req.images) {
        if (im.label?.trim()) imageParts.push({ text: im.label.trim() });
        imageParts.push({ inlineData: { mimeType: im.mimeType, data: im.base64 } });
      }
      let idx = -1;
      for (let i = finalContents.length - 1; i >= 0; i--) {
        if (finalContents[i].role === "user") {
          idx = i;
          break;
        }
      }
      if (idx >= 0) finalContents[idx].parts.push(...imageParts);
      else finalContents.push({ role: "user", parts: imageParts });
    }

    const json = await requestJson<GenerateContentResponse>(
      "google",
      `${base()}/v1beta/models/${req.model}:generateContent`,
      {
        method: "POST",
        headers: authHeaders(creds),
        signal: req.signal,
        body: JSON.stringify({
          systemInstruction,
          contents: finalContents,
          generationConfig: {
            temperature: req.temperature ?? 0.4,
            maxOutputTokens: req.maxOutputTokens,
            responseMimeType: "application/json",
            ...(responseSchema ? { responseSchema } : {}),
          },
        }),
      },
    );
    const raw = firstText(json);
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (err) {
      throw new ProviderError("Model did not return valid JSON", {
        kind: "parse",
        provider: "google",
        cause: err,
        details: raw.slice(0, 500),
      });
    }
    const result = req.schema.safeParse(parsed);
    if (!result.success) {
      throw new ProviderError("Model JSON failed schema validation", {
        kind: "parse",
        provider: "google",
        details: result.error.message,
      });
    }
    return result.data;
  },
};

/**
 * Gemini's own name for the requested canvas's ratio.
 *
 * The bucket list lives in `config/modelCapabilities`, which is where the
 * pipeline picked this canvas from in the first place — so the token recovered
 * here is the exact bucket that was chosen, and a model whose buckets differ
 * (the 3.1 Flash Image panoramas) is handled without this adapter knowing.
 */
function aspectRatioFor(model: string, size?: string): string | undefined {
  return ratioTokenForSize(capabilitiesFor({ provider: "google", id: model }), size);
}

export const googleImageProvider: ImageProvider = {
  provider: "google",

  async generateImage(creds, req: ImageRequest): Promise<ImageResult> {
    // Interleave a labeled text part directly BEFORE each image so the model
    // binds the caption to the correct image (Gemini ignores order-based
    // numbering in a single prompt blob, but honors adjacent text labels).
    //
    // Every caption is explicitly marked as an instruction: with
    // `responseModalities: ["IMAGE"]` Gemini does not distinguish "text that
    // instructs" from "text to draw", and would otherwise render captions into
    // the artwork — most often when the output closely mirrors an input image.
    const parts: GeminiPart[] = [];
    for (const ref of req.references ?? []) {
      let label: string;
      if (ref.role === "composition") {
        label =
          "PREVIOUS version of this page — keep its exact composition, layout, poses, positions, framing, background and colors; only update what the instruction says:";
      } else if (ref.role === "restyleBase") {
        label =
          "BASE IMAGE to re-render — reproduce its CONTENT exactly: the same subjects, identities, outfits, poses, expressions, composition, layout, cell order, framing and scale. Change ONLY the rendering style, as described in the instruction. Do NOT add, remove, rearrange or re-pose anything:";
      } else if (ref.role === "style") {
        label =
          "ART-STYLE reference — copy ONLY its visual style: medium, rendering technique, linework, shading, color palette, texture and finish. Do NOT copy its subjects, characters, objects, composition or layout:";
      } else if (ref.role === "scale") {
        label =
          "SIZE CHART — these characters are drawn side by side on one ground line at their correct heights relative to each other. Copy ONLY those proportions; ignore its poses, spacing, blank background and flat arrangement:";
      } else if (ref.role === "relation") {
        label = `Context reference — this is ${ref.label ?? "a related subject"}, mentioned in the instructions. Match it where the instruction relates this subject to it (e.g. shared traits, or an item that appears in the scene):`;
      } else if (ref.role === "likeness") {
        label = `ONE-USE LIKENESS photo for ${ref.label ?? "the character"} — preserve the recognizable face, hair and key physical traits while fully redrawing them in the requested illustration style. Do NOT copy the photographic rendering, background, pose, lighting or incidental clothing:`;
      } else if (ref.role === "sourceArt") {
        label = `EXISTING ILLUSTRATION of ${ref.label ?? "the character"} — extract only this character from any background. Keep identity, design, outfit and colours. Follow the prompt for whether to keep this drawing's rendering or redraw it in the book's art style:`;
      } else {
        label = `Appearance reference for ${ref.label ?? "a subject"} — match this exactly (face, colors, design):`;
      }
      parts.push({ text: `INSTRUCTION (never draw this text) — ${label}` });
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
    }
    // Main instruction goes last so it applies to all the images above.
    parts.push({ text: req.prompt });
    // Closing guard, after the prompt because the final part carries the most
    // weight: the captions above are directions, never content to render.
    if (!req.allowText) {
      parts.push({
        text: "Output the illustration only. The text above consists of instructions — never copy, quote or render any of it, and do not draw any caption, label, letter, word, number or watermark anywhere in the image.",
      });
    }

    const aspectRatio = aspectRatioFor(req.model, req.size);
    const json = await requestJson<GenerateContentResponse>(
      "google",
      `${base()}/v1beta/models/${req.model}:generateContent`,
      {
        method: "POST",
        headers: authHeaders(creds),
        signal: req.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
          },
        }),
      },
    );
    const out = json.candidates?.[0]?.content?.parts ?? [];
    const img = out.find((p) => p.inlineData)?.inlineData;
    if (!img) {
      throw new ProviderError("No image returned", {
        kind: "parse",
        provider: "google",
      });
    }
    return { base64: img.data, mimeType: img.mimeType, model: req.model };
  },
};
