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
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a precise vision system that locates DISTINCT subjects in an image and returns one bounding box per subject. " +
        "Coordinates are normalized between 0 and 1 with the origin at the TOP-LEFT corner. Each subject is a different entity, so return a different region for each. Reply with JSON only.",
    },
    {
      role: "user" as const,
      content:
        `Locate each of these subjects in the image and return its tightest bounding box:\n${list}\n\n` +
        `Return {"subjects": [{"id", "found", "x", "y", "width", "height"}, ...]} with one entry per id above, ` +
        `where (x, y) is the TOP-LEFT corner and width/height the size, all normalized 0..1. ` +
        `For any subject not clearly visible, set "found": false.`,
    },
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

export interface LocateSubjectInput {
  pageBase64: string;
  pageMime: string;
  name: string;
  description?: string;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
}

/**
 * Locate a subject in a page image. Returns a normalized box, or null when the
 * subject can't be found or the vision call fails (callers fall back gracefully).
 */
export async function locateSubject(input: LocateSubjectInput): Promise<SubjectBox | null> {
  const provider = getTextProvider(input.providerId);
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a precise vision system that locates a single subject in an image and returns its bounding box. " +
        "Coordinates are normalized between 0 and 1 with the origin at the TOP-LEFT corner. Reply with JSON only.",
    },
    {
      role: "user" as const,
      content:
        `Locate this subject in the image: "${input.name}"` +
        (input.description ? ` — ${input.description}` : "") +
        `. Return {"found": true|false, "x", "y", "width", "height"} where (x, y) is the TOP-LEFT corner of the ` +
        `tightest box around the subject and width/height are its size, all normalized 0..1. ` +
        `If the subject is not clearly visible, return {"found": false}.`,
    },
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
