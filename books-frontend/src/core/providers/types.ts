/**
 * Provider abstraction. Adding a new provider means implementing these
 * interfaces in a new folder and registering it in ./index.ts — no UI changes.
 */
import type { z } from "zod";
import type { ProviderId } from "../config/options";

export interface ProviderCredentials {
  apiKey: string;
}

export interface RawModel {
  id: string;
  displayName?: string;
  /** Generation methods / capabilities reported by the provider, if any. */
  capabilities?: string[];
}

export interface TextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextRequest {
  model: string;
  messages: TextMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface TextResponse {
  text: string;
  model: string;
}

/** An image attached to a (vision) request, e.g. for subject localization. */
export interface InputImage {
  /** base64-encoded image data (no data: prefix). */
  base64: string;
  mimeType: string;
}

export interface StructuredRequest<T> {
  model: string;
  messages: TextMessage[];
  schema: z.ZodType<T>;
  /**
   * Name for the schema. OpenAI's structured-output endpoint requires one
   * (`^[A-Za-z0-9_-]{1,64}$`); Gemini ignores it. Each provider converts this
   * Zod schema into its own JSON-Schema subset — see `providers/google/schema.ts`
   * and `providers/openai/schema.ts`.
   */
  schemaName?: string;
  /**
   * Images appended to the final user message for vision-capable models. Used by
   * the localization step to find where a subject sits inside a page image.
   */
  images?: InputImage[];
  temperature?: number;
  /** Upper bound for structured responses that may contain many book pages. */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/** A reference image fed to image generation for consistency (e.g. anchors). */
export interface ReferenceImage {
  /** base64-encoded image data (no data: prefix). */
  base64: string;
  mimeType: string;
  /**
   * Short caption describing what this image is (e.g. an anchor's name). Used to
   * emit a labeled text part immediately before the image so providers reliably
   * bind the caption to the correct image rather than guessing from order.
   */
  label?: string;
  /**
   * What this reference is for:
   *   - "subject": an appearance reference (an anchor/character/place).
   *   - "composition": the previous/current page, used only for layout & pose.
   *   - "relation": a related subject for context (a relative to resemble, or an
   *     object/place contained in the subject being drawn).
   *   - "style": an art-style exemplar — only its rendering technique/palette/
   *     texture should be copied, never its subjects, layout or composition.
   *   - "scale": a size chart of several characters on one ground line — only
   *     their relative heights should be copied, never their poses or spacing.
   *   - "restyleBase": the image being re-rendered in a new art style. Its
   *     CONTENT must be reproduced exactly (subjects, layout, poses, framing);
   *     only the rendering technique changes. Never "match this exactly", which
   *     would preserve the very style we're replacing.
   */
  role?: "subject" | "composition" | "relation" | "style" | "scale" | "restyleBase";
}

export interface ImageRequest {
  model: string;
  prompt: string;
  /** WxH, e.g. "1024x1024". Providers map this to supported sizes. */
  size?: string;
  /**
   * Rendering quality hint. Lower quality is dramatically faster/cheaper and is
   * used for in-place region edits where final fidelity matters less. Providers
   * that don't support it (e.g. Gemini) ignore it.
   */
  quality?: "low" | "medium" | "high" | "auto";
  /** Reference images for character/place consistency. */
  references?: ReferenceImage[];
  /**
   * Optional inpainting mask (PNG with transparent areas marking the region to
   * regenerate). Applied against the first reference image. Provider support
   * varies; ignored by providers that lack a mask/edit endpoint.
   */
  mask?: ReferenceImage;
  /**
   * Whether rendered text belongs in the output (cover typography). Default
   * false, which lets providers that interleave caption text parts with the
   * reference images (Gemini) close with a hard "never draw these captions"
   * instruction — without it, labels get baked into the artwork.
   */
  allowText?: boolean;
  signal?: AbortSignal;
}

export interface ImageResult {
  /** base64-encoded image (no data: prefix). */
  base64: string;
  mimeType: string;
  model: string;
}

export interface TextProvider {
  readonly provider: ProviderId;
  listModels(creds: ProviderCredentials, signal?: AbortSignal): Promise<RawModel[]>;
  generateText(creds: ProviderCredentials, req: TextRequest): Promise<TextResponse>;
  generateStructured<T>(
    creds: ProviderCredentials,
    req: StructuredRequest<T>,
  ): Promise<T>;
}

export interface ImageProvider {
  readonly provider: ProviderId;
  generateImage(creds: ProviderCredentials, req: ImageRequest): Promise<ImageResult>;
}
