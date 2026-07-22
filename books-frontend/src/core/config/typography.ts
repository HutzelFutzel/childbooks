/**
 * Age- and format-aware font-size recommendations, expressed in real typographic
 * points (1 pt = 1/72 inch) — the same absolute unit Word, InDesign and Canva
 * use. Points are the bullet-proof measure because they are *physical*: a 16 pt
 * letter is the same size on a tiny pocket book and a large landscape book.
 *
 * Readability is driven primarily by the reader's age/reading skill (an absolute
 * point band), floored by an accessibility minimum, and only *capped* by the book
 * format via a characters-per-line (measure) target. Trim size therefore sets the
 * upper bound and the line-length math — never the readable lower bound.
 *
 * Built-in defaults reflect children's-publishing practice; admins can retune
 * every coefficient from the dashboard (`appConfig/typography`). The recommender
 * is a pure function of the trim + text-box width, so adding a new book format
 * requires no change here.
 */
import { z } from "zod";
import type { AgeBandId, ReadingModeId } from "./ageWritingCatalog";

/** Recommended point band + line-length targets for one age band. */
export interface FontBand {
  /** Smallest age-appropriate size (before the global floor is applied). */
  minPt: number;
  /** The suggested "just right" size for this age. */
  idealPt: number;
  /** Largest age-appropriate size (before the line-length cap is applied). */
  maxPt: number;
  /** Fewest characters per line that still reads comfortably (caps max size). */
  cplMin: number;
  /** Most characters per line before text feels dense (informs the ideal). */
  cplMax: number;
}

/** Admin-overridable typography coefficients. All fields optional (merged over defaults). */
export interface TypographyConfig {
  version: 1;
  /** Absolute readability floor (pt) — recommendations never go below this. */
  floorPt?: number;
  /** Average glyph advance as a fraction of the em, for the CPL ↔ size math. */
  avgAdvanceEm?: number;
  /** Multipliers applied to the band by reading mode (6–8 / 9–12). */
  readingModeScale?: Partial<Record<ReadingModeId, number>>;
  /** Per-age-band point ranges + line-length targets. */
  bands?: Partial<Record<AgeBandId, Partial<FontBand>>>;
}

/** Fully-resolved coefficients (defaults merged with admin overrides). */
export interface ResolvedTypography {
  floorPt: number;
  avgAdvanceEm: number;
  readingModeScale: Record<ReadingModeId, number>;
  bands: Record<AgeBandId, FontBand>;
}

/**
 * State-of-the-art defaults. Point ranges follow common children's-publishing
 * guidance: very large type for pre-readers (few words per page) tapering to
 * near-adult trade sizes for confident middle-grade readers.
 */
export const DEFAULT_TYPOGRAPHY: ResolvedTypography = {
  floorPt: 12,
  avgAdvanceEm: 0.5,
  readingModeScale: {
    "read-aloud": 0.95,
    "with-help": 1.0,
    independent: 1.08,
  },
  bands: {
    "0-2": { minPt: 24, idealPt: 32, maxPt: 44, cplMin: 8, cplMax: 24 },
    "3-5": { minPt: 18, idealPt: 22, maxPt: 30, cplMin: 12, cplMax: 34 },
    "6-8": { minPt: 14, idealPt: 17, maxPt: 22, cplMin: 20, cplMax: 45 },
    "9-12": { minPt: 11, idealPt: 13, maxPt: 16, cplMin: 30, cplMax: 60 },
  },
};

/** Fallback band for unknown age ids (mirrors the 3–5 picture-book range). */
const FALLBACK_BAND: FontBand = DEFAULT_TYPOGRAPHY.bands["3-5"];

const fontBandSchema = z
  .object({
    minPt: z.number().positive().max(400),
    idealPt: z.number().positive().max(400),
    maxPt: z.number().positive().max(400),
    cplMin: z.number().positive().max(200),
    cplMax: z.number().positive().max(200),
  })
  .partial();

export const typographyConfigSchema = z.object({
  version: z.literal(1),
  floorPt: z.number().positive().max(200).optional(),
  avgAdvanceEm: z.number().positive().max(2).optional(),
  readingModeScale: z
    .record(z.enum(["read-aloud", "with-help", "independent"]), z.number().positive().max(4))
    .optional(),
  bands: z.record(z.string(), fontBandSchema).optional(),
});

export function createDefaultTypographyConfig(): TypographyConfig {
  return { version: 1 };
}

export function normalizeTypographyConfig(input: unknown): TypographyConfig {
  const parsed = typographyConfigSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return createDefaultTypographyConfig();
}

/** Merge admin overrides over the built-in defaults into a full coefficient set. */
export function resolveTypography(config?: TypographyConfig | null): ResolvedTypography {
  if (!config) return DEFAULT_TYPOGRAPHY;
  const bands = {} as Record<AgeBandId, FontBand>;
  for (const key of Object.keys(DEFAULT_TYPOGRAPHY.bands) as AgeBandId[]) {
    bands[key] = { ...DEFAULT_TYPOGRAPHY.bands[key], ...(config.bands?.[key] ?? {}) };
  }
  return {
    floorPt: config.floorPt ?? DEFAULT_TYPOGRAPHY.floorPt,
    avgAdvanceEm: config.avgAdvanceEm ?? DEFAULT_TYPOGRAPHY.avgAdvanceEm,
    readingModeScale: { ...DEFAULT_TYPOGRAPHY.readingModeScale, ...(config.readingModeScale ?? {}) },
    bands,
  };
}

/** A recommended type-size window (all in real points). */
export interface FontSizeRec {
  /** Lowest recommended size — the max of the age minimum and the global floor. */
  minPt: number;
  /** Suggested default size for this age + format. */
  idealPt: number;
  /** Highest recommended size, capped so lines aren't too short for the box. */
  maxPt: number;
  /** The absolute accessibility floor (for "below readable" warnings). */
  floorPt: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const round = (v: number) => Math.round(v * 2) / 2;

/**
 * Recommend a font-size window for a text box, in real points.
 *
 * Pure function of the age band, reading mode, physical trim and the text box's
 * inner width — so new book formats need no code changes here.
 */
export function recommendFontSize(input: {
  ageRangeId: string;
  readingModeId?: ReadingModeId | null;
  /** Real single-page trim (inches). */
  trim: { widthIn: number; heightIn: number };
  /** Text-box content width (inches). Drives the characters-per-line cap. */
  boxWidthIn?: number;
  config?: TypographyConfig | null;
}): FontSizeRec {
  const t = resolveTypography(input.config);
  const band = t.bands[input.ageRangeId as AgeBandId] ?? FALLBACK_BAND;
  const scale = input.readingModeId ? t.readingModeScale[input.readingModeId] ?? 1 : 1;

  const minPt = Math.max(band.minPt * scale, t.floorPt);
  let maxPt = band.maxPt * scale;

  // Characters-per-line cap: a wider box tolerates larger type; a narrow box must
  // not blow up so much that only a couple of words fit per line.
  if (input.boxWidthIn && input.boxWidthIn > 0) {
    const boxWidthPt = input.boxWidthIn * 72;
    const ptForCpl = (cpl: number) => boxWidthPt / (cpl * t.avgAdvanceEm);
    maxPt = Math.min(maxPt, ptForCpl(band.cplMin));
  }
  maxPt = Math.max(maxPt, minPt);

  const idealPt = clamp(band.idealPt * scale, minPt, maxPt);
  return {
    minPt: round(minPt),
    idealPt: round(idealPt),
    maxPt: round(maxPt),
    floorPt: round(t.floorPt),
  };
}
