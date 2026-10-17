/**
 * The lettering check: read back the words an image model painted on a front
 * cover and decide whether they can go to print.
 *
 * A vision model transcribes what it sees ({@link readCoverLettering}); a pure
 * judge compares that with what was asked for ({@link judgeLettering}). Kept
 * apart so the rule that decides what is printed can be tested without a model.
 * Every word must be spelled exactly (case and line breaks aside), sit inside
 * the print-safe area, and nothing else may be written on the cover.
 */
import { z } from "zod";
import { bookProductForConfig } from "../book";
import { coverSafetyMarginIn, nominalCoverExtensionIn } from "../book/format";
import type { ProviderId } from "../config/options";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import type { BakedCoverText, Project } from "../types";
import { withRetry } from "./retry";

export type LetteringRole = "title" | "subtitle" | "author";
const ROLES: readonly LetteringRole[] = ["title", "subtitle", "author"];

/** A normalized (0..1, top-left origin) rectangle. */
export interface LetteringBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReadLine {
  found: boolean;
  text: string;
  box?: LetteringBox;
}

export interface LetteringReading {
  lines: Partial<Record<LetteringRole, ReadLine>>;
  /** Any other writing on the image, as read. */
  other: string[];
}

export interface LetteringVerdict {
  ok: boolean;
  problems: string[];
  /**
   * The problems that make the printed words wrong: a line missing, misspelled
   * or not asked for, or real writing nobody wrote. What is left in `problems`
   * only concerns where a correct line sits or a stray mark, which a cover can
   * be delivered with.
   */
  blocking: string[];
}

const boxFields = {
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
};
const lineSchema = z.object({ found: z.boolean(), text: z.string().optional(), ...boxFields });
const readingSchema = z.object({
  title: lineSchema.optional(),
  subtitle: lineSchema.optional(),
  author: lineSchema.optional(),
  other: z.array(z.string()).optional(),
});

function boxOf(raw: z.infer<typeof lineSchema>): LetteringBox | undefined {
  if (raw.x == null || raw.y == null || raw.width == null || raw.height == null) return undefined;
  if (!(raw.width > 0) || !(raw.height > 0)) return undefined;
  return { x: raw.x, y: raw.y, w: raw.width, h: raw.height };
}

/**
 * Where the words may sit on the front-cover image, as fractions of it. The
 * image is drawn for the whole surface, bleed included, so the margin counts
 * the bleed that is cut off plus the safety margin inside the trim.
 */
export function coverLetteringSafeArea(config: Project["config"]): LetteringBox {
  const product = bookProductForConfig(config);
  // A hardcover's cover extends by the wrap, not a bleed, and needs a wider
  // safety margin; both come from the binding.
  const bleed = nominalCoverExtensionIn(product.binding, product.bleedIn ?? 0);
  const margin = coverSafetyMarginIn(product.binding);
  const width = product.trim.widthIn + bleed * 2;
  const height = product.trim.heightIn + bleed * 2;
  if (!(width > 0) || !(height > 0)) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  const mx = (bleed + margin) / width;
  const my = (bleed + margin) / height;
  return { x: mx, y: my, w: 1 - mx * 2, h: 1 - my * 2 };
}

/** Letters and digits only, case folded, accents kept: "Mama & Papa" and "MAMA &\nPAPA" read the same. */
export function letteringKey(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Author lines are often set as "by …"; that word alone is not a misspelling. */
const BYLINE = /^(by|von|par|por|de|di|door|av|af|przez)\s+/u;
const BYLINE_WORDS: ReadonlySet<string> = new Set(["by", "von", "par", "por", "de", "di", "door", "av", "af", "przez"]);

/**
 * Extra writing this short (a mark, an initial) is not worth another painting.
 * Anything longer is real text on the cover and blocks it.
 */
const STRAY_MARK_LETTERS = 3;

/**
 * Whether a piece of "other writing" is only the cover's own words again: a
 * line the reader split in two, or the byline word, listed apart from the line
 * it belongs to. The cover carries nothing it shouldn't.
 */
function repeatsExpectedWords(text: string, expected: BakedCoverText): boolean {
  const words = new Set(
    ROLES.flatMap((role) => letteringKey(expected[role] ?? "").split(" ")).filter(Boolean),
  );
  const parts = letteringKey(text).split(" ").filter(Boolean);
  return parts.length > 0 && parts.every((word) => words.has(word) || BYLINE_WORDS.has(word));
}

/**
 * How far in from every edge the words must stay, as a whole percent of the
 * image, for the prompt to ask for. A little more than the check's real margin,
 * so a model that is slightly off still lands inside it.
 */
export function coverMarginPercent(safe: LetteringBox): number {
  const margin = Math.max(safe.x, safe.y, 0);
  return Math.min(30, Math.max(8, Math.ceil(margin * 100) + 2));
}

function sameWords(expected: string, read: string, role: LetteringRole): boolean {
  const want = letteringKey(expected);
  const got = letteringKey(read);
  if (want === got) return true;
  return role === "author" && !BYLINE.test(want) && got.replace(BYLINE, "") === want;
}

/**
 * A vision model's boxes are good to a few percent, not a pixel, so a line is
 * only outside when it is clearly past the edge of the safe area.
 */
const BOX_TOLERANCE = 0.03;

function inside(box: LetteringBox, area: LetteringBox, tolerance = BOX_TOLERANCE): boolean {
  return (
    box.x >= area.x - tolerance &&
    box.y >= area.y - tolerance &&
    box.x + box.w <= area.x + area.w + tolerance &&
    box.y + box.h <= area.y + area.h + tolerance
  );
}

/** Whether the painted words can go to print. Pure. */
export function judgeLettering(
  expected: BakedCoverText,
  reading: LetteringReading,
  safe: LetteringBox,
): LetteringVerdict {
  const blocking: string[] = [];
  const soft: string[] = [];
  for (const role of ROLES) {
    const want = (expected[role] ?? "").trim();
    const line = reading.lines[role];
    if (!want) {
      if (line?.found && letteringKey(line.text)) blocking.push(`unexpected ${role}: "${line.text}"`);
      continue;
    }
    if (!line?.found) {
      blocking.push(`${role} missing`);
      continue;
    }
    if (!sameWords(want, line.text, role)) blocking.push(`${role} reads "${line.text}", wanted "${want}"`);
    if (line.box && !inside(line.box, safe)) soft.push(`${role} outside the safe area`);
  }
  for (const text of reading.other) {
    const letters = letteringKey(text).replace(/\s/g, "").length;
    if (letters < 2 || repeatsExpectedWords(text, expected)) continue;
    (letters <= STRAY_MARK_LETTERS ? soft : blocking).push(`extra text: "${text}"`);
  }
  const problems = [...blocking, ...soft];
  return { ok: problems.length === 0, problems, blocking };
}

export interface ReadCoverLetteringInput {
  imageBase64: string;
  imageMime: string;
  expected: BakedCoverText;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

/**
 * Transcribe the cover's words. Returns null when the check could not run, so
 * a vision outage never costs the reader a cover that may well be fine.
 */
export async function readCoverLettering(input: ReadCoverLetteringInput): Promise<LetteringReading | null> {
  const provider = getTextProvider(input.providerId);
  // A line the cover must not carry is listed too: a proofreader only told what
  // to expect reads past an author name nobody asked for.
  const expected = ROLES.map((role) => {
    const want = (input.expected[role] ?? "").trim();
    return want ? `- ${role}: "${want}"` : `- ${role}: NONE (this line must not be on the cover)`;
  }).join("\n");
  const { system, user } = renderTextPrompt(resolvePromptsConfig(input.prompts), "bindingPass/coverLettering", {
    vars: { expected },
  });
  try {
    const res = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages: [
            { role: "system" as const, content: system },
            { role: "user" as const, content: user },
          ],
          schema: readingSchema,
          temperature: 0,
          images: [{ base64: input.imageBase64, mimeType: input.imageMime }],
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
    const lines: LetteringReading["lines"] = {};
    for (const role of ROLES) {
      const raw = res[role];
      if (!raw) continue;
      lines[role] = { found: raw.found, text: (raw.text ?? "").trim(), box: boxOf(raw) };
    }
    return { lines, other: (res.other ?? []).map((text) => text.trim()).filter(Boolean) };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return null;
  }
}
