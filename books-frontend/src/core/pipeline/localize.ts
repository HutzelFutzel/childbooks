/**
 * Subject localization: ask a vision-capable text model where a given subject
 * (character/place/object) sits inside a page image, returning a normalized
 * bounding box. Used to build a targeted mask so a single subject can be
 * updated in place without disturbing the rest of the illustration.
 */
import { z } from "zod";
import type { ProviderId } from "../config/options";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import { withRetry } from "./retry";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";

const boxSchema = z.object({
  found: z.boolean(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

/** A normalized (0..1, top-left origin) bounding box. */
export interface SubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalize/clamp a raw box; returns null when degenerate. */
function sanitizeBox(raw: {
  found?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): SubjectBox | null {
  if (!raw.found || raw.x == null || raw.y == null || raw.width == null || raw.height == null) {
    return null;
  }
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  let x = clamp01(raw.x);
  let y = clamp01(raw.y);
  let width = clamp01(raw.width);
  let height = clamp01(raw.height);
  if (width <= 0.02 || height <= 0.02) return null;
  if (x + width > 1) width = 1 - x;
  if (y + height > 1) height = 1 - y;
  return { x, y, width, height };
}

const multiBoxSchema = z.object({
  subjects: z.array(
    z.object({
      id: z.string(),
      found: z.boolean(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  ),
});

export interface LocateSubjectsInput {
  pageBase64: string;
  pageMime: string;
  subjects: { id: string; name: string; description?: string }[];
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/**
 * Locate several subjects in a single vision call (one round-trip), returning a
 * map of subject id → normalized box (or null when not found). The model is told
 * the subjects are distinct so it returns separate, non-identical regions.
 */
export async function locateSubjects(
  input: LocateSubjectsInput,
): Promise<Map<string, SubjectBox | null>> {
  const out = new Map<string, SubjectBox | null>();
  for (const s of input.subjects) out.set(s.id, null);
  if (input.subjects.length === 0) return out;

  const provider = getTextProvider(input.providerId);
  const list = input.subjects
    .map((s) => `- id "${s.id}": "${s.name}"${s.description ? ` — ${s.description}` : ""}`)
    .join("\n");
  const { system, user } = renderTextPrompt(resolvePromptsConfig(input.prompts), "localize/multi", {
    vars: { list },
  });
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  let res: z.infer<typeof multiBoxSchema>;
  try {
    res = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages,
          schema: multiBoxSchema,
          temperature: 0,
          images: [{ base64: input.pageBase64, mimeType: input.pageMime }],
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
  } catch {
    return out; // all null → caller treats as "not localized"
  }

  for (const entry of res.subjects) {
    if (out.has(entry.id)) out.set(entry.id, sanitizeBox(entry));
  }
  return out;
}

/** One subject located on a page, plus any DUPLICATE regions of the same subject. */
export interface SubjectBinding {
  /** Primary (best) region for the subject. */
  box: SubjectBox;
  /** Extra regions where the SAME subject was (wrongly) drawn again. */
  extras: SubjectBox[];
}

const bindingSchema = z.object({
  subjects: z.array(
    z.object({
      id: z.string(),
      found: z.boolean(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      /** Extra occurrences of the SAME subject (duplicates to remove). */
      extras: z
        .array(
          z.object({
            x: z.number().optional(),
            y: z.number().optional(),
            width: z.number().optional(),
            height: z.number().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

export interface LocateAndCountInput {
  pageBase64: string;
  pageMime: string;
  subjects: { id: string; name: string; description?: string }[];
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/**
 * Bind each subject to its region in the page AND detect duplicates — subjects
 * that must appear exactly once but were drawn more than once. Returns, per id,
 * the primary box plus any extra (duplicate) boxes to remove. One vision call
 * does both binding and duplicate detection. Best-effort: returns an empty map
 * on failure so callers degrade gracefully.
 */
export async function locateAndCountSubjects(
  input: LocateAndCountInput,
): Promise<Map<string, SubjectBinding>> {
  const out = new Map<string, SubjectBinding>();
  if (input.subjects.length === 0) return out;

  const provider = getTextProvider(input.providerId);
  const list = input.subjects
    .map((s) => `- id "${s.id}": "${s.name}"${s.description ? ` — ${s.description}` : ""}`)
    .join("\n");
  const { system, user } = renderTextPrompt(
    resolvePromptsConfig(input.prompts),
    "bindingPass/multi",
    { vars: { list } },
  );
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  let res: z.infer<typeof bindingSchema>;
  try {
    res = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages,
          schema: bindingSchema,
          temperature: 0,
          images: [{ base64: input.pageBase64, mimeType: input.pageMime }],
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
  } catch {
    return out;
  }

  for (const entry of res.subjects) {
    const box = sanitizeBox(entry);
    if (!box) continue;
    const extras: SubjectBox[] = [];
    for (const raw of entry.extras ?? []) {
      const b = sanitizeBox({ found: true, ...raw });
      if (b) extras.push(b);
    }
    out.set(entry.id, { box, extras });
  }
  return out;
}

/** Obsolete generic instance of an embedded child vs its anchored primary region. */
export interface EmbeddedBinding {
  childId: string;
  /** Region where the anchored (correct) instance appears — keep. */
  primary: SubjectBox;
  /** Generic/default duplicates to remove (same category, wrong design). */
  obsolete: SubjectBox[];
}

const embeddedSchema = z.object({
  embedded: z.array(
    z.object({
      id: z.string(),
      found: z.boolean(),
      primaryX: z.number().optional(),
      primaryY: z.number().optional(),
      primaryWidth: z.number().optional(),
      primaryHeight: z.number().optional(),
      obsolete: z
        .array(
          z.object({
            x: z.number().optional(),
            y: z.number().optional(),
            width: z.number().optional(),
            height: z.number().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

export interface LocateEmbeddedObsoleteInput {
  pageBase64: string;
  pageMime: string;
  /** Parent place/object that contains the embedded children. */
  parent: { name: string; description?: string };
  /** Embedded child anchors that must appear once with their anchored design. */
  children: { id: string; name: string; description?: string }[];
  /** "scene" = single illustration; "sheet" = multi-angle reference sheet. */
  mode: "scene" | "sheet";
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/**
 * For embedded anchors (e.g. a specific bed inside a hospital room), locate the
 * correct anchored instance and any obsolete generic duplicates of the same
 * object category that should be erased. On reference sheets, legitimate
 * multi-view repetitions across separate panels are NOT flagged — only within-panel
 * generic+anchored conflicts.
 */
export async function locateEmbeddedObsolete(
  input: LocateEmbeddedObsoleteInput,
): Promise<Map<string, EmbeddedBinding>> {
  const out = new Map<string, EmbeddedBinding>();
  if (input.children.length === 0) return out;

  const provider = getTextProvider(input.providerId);
  const childList = input.children
    .map((c) => `- id "${c.id}": "${c.name}"${c.description ? ` — ${c.description}` : ""}`)
    .join("\n");
  const template = input.mode === "sheet" ? "bindingPass/embeddedSheet" : "bindingPass/embeddedScene";
  const { system, user } = renderTextPrompt(resolvePromptsConfig(input.prompts), template, {
    vars: {
      parentName: input.parent.name,
      parentDescription: input.parent.description ? ` — ${input.parent.description}` : "",
      childList,
    },
  });

  let res: z.infer<typeof embeddedSchema>;
  try {
    res = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          schema: embeddedSchema,
          temperature: 0,
          images: [{ base64: input.pageBase64, mimeType: input.pageMime }],
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
  } catch {
    return out;
  }

  for (const entry of res.embedded) {
    const primary = sanitizeBox({
      found: entry.found,
      x: entry.primaryX,
      y: entry.primaryY,
      width: entry.primaryWidth,
      height: entry.primaryHeight,
    });
    if (!primary) continue;
    const obsolete: SubjectBox[] = [];
    for (const raw of entry.obsolete ?? []) {
      const b = sanitizeBox({ found: true, ...raw });
      if (b) obsolete.push(b);
    }
    out.set(entry.id, { childId: entry.id, primary, obsolete });
  }
  return out;
}

export interface LocateSubjectInput {
  pageBase64: string;
  pageMime: string;
  name: string;
  description?: string;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/**
 * Locate a subject in a page image. Returns a normalized box, or null when the
 * subject can't be found or the vision call fails (callers fall back gracefully).
 */
export async function locateSubject(input: LocateSubjectInput): Promise<SubjectBox | null> {
  const provider = getTextProvider(input.providerId);
  const { system, user } = renderTextPrompt(resolvePromptsConfig(input.prompts), "localize/single", {
    vars: {
      name: input.name,
      descriptionSuffix: input.description ? ` — ${input.description}` : "",
    },
  });
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  let res: z.infer<typeof boxSchema>;
  try {
    res = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages,
          schema: boxSchema,
          temperature: 0,
          images: [{ base64: input.pageBase64, mimeType: input.pageMime }],
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
  } catch {
    return null;
  }

  return sanitizeBox(res);
}
