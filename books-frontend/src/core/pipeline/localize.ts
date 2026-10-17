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

const panelCountSchema = z.object({
  count: z.number(),
});

export interface CountSheetPanelsInput {
  sheetBase64: string;
  sheetMime: string;
  subjectName: string;
  expectedCount: number;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/**
 * Counts how many distinct view panels a just-rendered reference sheet
 * actually contains. The generation prompt already asks for an exact grid
 * ("draw exactly N cells, no more, no fewer"), but vision-image models don't
 * reliably obey a cell count baked into text — observed with Gemini Flash
 * rendering 6 or 8 panels for the same 6-cell instruction, inconsistently
 * between runs. A cheap follow-up vision call closes that loop: the caller
 * compares the result to what was requested and, on a mismatch, retries the
 * render once with the actual count named in the prompt.
 *
 * Returns null when the vision call itself fails — callers then assume the
 * request was honored rather than looping on a check that can't answer.
 */
export async function countSheetPanels(input: CountSheetPanelsInput): Promise<number | null> {
  const provider = getTextProvider(input.providerId);
  const { system, user } = renderTextPrompt(resolvePromptsConfig(input.prompts), "gridCheck/count", {
    vars: {
      subjectName: input.subjectName,
      expectedCount: String(input.expectedCount),
    },
  });
  try {
    const res = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          schema: panelCountSchema,
          temperature: 0,
          images: [{ base64: input.sheetBase64, mimeType: input.sheetMime }],
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
    return Math.round(res.count);
  } catch {
    return null;
  }
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

const partSchema = z.object({
  found: z.boolean(),
  part: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export interface LocateEditPartInput {
  pageBase64: string;
  pageMime: string;
  name: string;
  description?: string;
  /** The change asked for, in the reader's words. */
  instruction: string;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/**
 * Find the part of a subject a change affects ("make Arthur's hair yellow" →
 * the hair), so only that part is redrawn and the rest of the subject, and the
 * page, stay as they are. Returns null when the part can't be told or the
 * vision call fails; the caller then falls back to the subject's whole box.
 */
export async function locateEditPart(
  input: LocateEditPartInput,
): Promise<{ box: SubjectBox; part: string } | null> {
  let res: z.infer<typeof partSchema>;
  try {
    res = await requestEditPart(input);
  } catch {
    return null;
  }
  const box = sanitizeBox(res);
  return box ? { box, part: (res.part ?? "").trim().slice(0, 40) } : null;
}

/** A part covering this much of the picture is the whole subject, not a part. */
export const WHOLE_SUBJECT_AREA = 0.6;
/**
 * The smallest side, as a share of the picture, a located part is given. An eye
 * on a full portrait is a couple of percent across; a box that thin gives the
 * model nothing to repaint and used to be thrown away, sending the edit to a
 * whole-picture redraw.
 */
export const MIN_PART_SIDE = 0.08;

/**
 * What a portrait or picture edit should do about the part it names:
 * - `part`: repaint just this box, composite the rest back unchanged.
 * - `whole`: the change is about most of the picture (an age, a size); there is
 *   no part to protect, so the picture is edited as a whole.
 * - `absent`: the part is not in the picture (boots in a chest-up portrait).
 *   Nothing can be changed there, so nothing is drawn.
 * - `failed`: the vision call or its answer was unusable; worth another try,
 *   never worth silently redrawing everything.
 */
export type EditPartOutcome =
  | { kind: "part"; box: SubjectBox; part: string }
  | { kind: "whole"; box: SubjectBox; part: string }
  | { kind: "absent" }
  | { kind: "failed"; reason: string };

/** Turn the vision model's raw answer into an {@link EditPartOutcome}. Pure. */
export function classifyLocatedPart(raw: {
  found?: boolean;
  part?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): EditPartOutcome {
  if (!raw.found) return { kind: "absent" };
  const { x, y, width, height } = raw;
  if (
    x == null || y == null || width == null || height == null ||
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 || height <= 0
  ) {
    return { kind: "failed", reason: "The located part had no usable box." };
  }
  const box = growToMinPartSide({ x, y, width, height });
  const part = (raw.part ?? "").trim().slice(0, 40);
  return box.width * box.height >= WHOLE_SUBJECT_AREA ? { kind: "whole", box, part } : { kind: "part", box, part };
}

/**
 * Give a located part at least {@link MIN_PART_SIDE} on each side: grown around
 * its centre, then slid back inside the picture. A hand on a full page is a few
 * percent across, and a hole that small gives the model nothing to repaint.
 */
export function growToMinPartSide(box: SubjectBox): SubjectBox {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const w = Math.max(MIN_PART_SIDE, clamp01(box.width));
  const h = Math.max(MIN_PART_SIDE, clamp01(box.height));
  const left = Math.min(1 - w, Math.max(0, clamp01(box.x) + clamp01(box.width) / 2 - w / 2));
  const top = Math.min(1 - h, Math.max(0, clamp01(box.y) + clamp01(box.height) / 2 - h / 2));
  return { x: left, y: top, width: w, height: h };
}

/** What the worker does with an {@link EditPartOutcome}. */
export type EditPlan =
  | { path: "masked"; box: SubjectBox; part: string }
  /** Edit the whole picture: the model can't mask, or the change is about all of it. */
  | { path: "whole"; reason: "cannot_mask" | "whole_subject" | "locate_gave_up"; detail?: string }
  /** Nothing usable came back; try the task again rather than redraw everything. */
  | { path: "retry"; detail: string }
  /** The part isn't in the picture: nothing to draw. */
  | { path: "notVisible" };

/**
 * One decision for every edit, so a failure can never quietly become a
 * whole-picture redraw. The only fall-through after a failed locate is the last
 * attempt, which is logged by the caller: a picture that changed too much beats
 * a request that never completes.
 */
export function planPartEdit(
  outcome: EditPartOutcome | { kind: "unsupported" },
  options: { finalAttempt: boolean },
): EditPlan {
  switch (outcome.kind) {
    case "unsupported":
      return { path: "whole", reason: "cannot_mask" };
    case "part":
      return { path: "masked", box: outcome.box, part: outcome.part };
    case "whole":
      return { path: "whole", reason: "whole_subject" };
    case "absent":
      return { path: "notVisible" };
    case "failed":
      return options.finalAttempt
        ? { path: "whole", reason: "locate_gave_up", detail: outcome.reason }
        : { path: "retry", detail: outcome.reason };
  }
}

/** Like {@link locateEditPart}, but says why it found nothing. */
export async function locateEditPartOutcome(input: LocateEditPartInput): Promise<EditPartOutcome> {
  try {
    return classifyLocatedPart(await requestEditPart(input));
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function requestEditPart(input: LocateEditPartInput): Promise<z.infer<typeof partSchema>> {
  const provider = getTextProvider(input.providerId);
  const { system, user } = renderTextPrompt(resolvePromptsConfig(input.prompts), "localize/part", {
    vars: {
      name: input.name,
      descriptionSuffix: input.description ? ` — ${input.description}` : "",
      instruction: input.instruction,
    },
  });
  return withRetry(
    () =>
      provider.generateStructured(input.creds, {
        model: input.model,
        messages: [
          { role: "system" as const, content: system },
          { role: "user" as const, content: user },
        ],
        schema: partSchema,
        temperature: 0,
        images: [{ base64: input.pageBase64, mimeType: input.pageMime }],
        signal: input.signal,
      }),
    { signal: input.signal, retries: 1 },
  );
}

/**
 * A located part is believed only when it sits on the subject: its centre lies
 * inside the subject's box (grown a little for hair and hats that stick out)
 * and it is not bigger than that box grown the same way. Otherwise the whole
 * subject box is used, which is wider but never somewhere else.
 */
export function partOnSubject(subject: SubjectBox, part: SubjectBox): boolean {
  const grow = 0.15;
  const left = subject.x - subject.width * grow;
  const right = subject.x + subject.width * (1 + grow);
  const top = subject.y - subject.height * grow;
  const bottom = subject.y + subject.height * (1 + grow);
  const cx = part.x + part.width / 2;
  const cy = part.y + part.height / 2;
  const inside = cx >= left && cx <= right && cy >= top && cy <= bottom;
  const fits = part.width <= right - left && part.height <= bottom - top;
  return inside && fits;
}
