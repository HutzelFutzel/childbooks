/**
 * The guide rollout: which studio flow a reader gets — the established wizard
 * ("legacy") or the chat-guided studio ("guide"). Stored at `appConfig/guide`,
 * world-readable so the studio can resolve it before the first paint.
 *
 * Ownership follows every other config document here:
 *   - CODE owns the contract — which rollout modes exist, and how one resolves
 *     to a flow for one reader (`core/guide/mode.ts`). Neither is editable from
 *     the dashboard, so a config change can never invent a flow that has no
 *     implementation.
 *   - ADMINS own the value — which mode is live, and the share of readers
 *     included while ramping.
 *
 * The document is expected to be ABSENT for the whole of the build-out, so
 * {@link normalizeGuideConfig} is the real default rather than a fallback that
 * only fires on corruption: a missing, partial or malformed document resolves to
 * the shipped `adminOnly` rollout, under which every customer stays on the
 * wizard and only an admin can opt themselves in. There is no value of this
 * document that a client can influence, and no failure mode that opts a
 * customer in.
 */
import { z } from "zod";
import { DEFAULT_GUIDE_CLAIM_THRESHOLDS } from "../guide/claims";
import {
  createDefaultGuidePlaylist,
  guidePlaylistSchema,
  normalizeGuidePlaylist,
  type GuidePlaylist,
} from "../guide/playlist";

/**
 * How wide the new flow is open:
 *   - `off`        — nobody, including admins. The kill switch: it overrides an
 *                    admin's own opt-in, so one write reverts everyone.
 *   - `adminOnly`  — customers stay on the wizard; admins choose per session.
 *   - `percentage` — a sticky share of customers, plus admin choice.
 *   - `on`         — everyone, unless they ask for the wizard explicitly.
 */
export const GUIDE_ROLLOUT_MODES = ["off", "adminOnly", "percentage", "on"] as const;

export type GuideRolloutMode = (typeof GUIDE_ROLLOUT_MODES)[number];

export interface GuideRollout {
  mode: GuideRolloutMode;
  /**
   * Share of customers included when `mode` is `percentage`, 0–100. Kept
   * whatever the mode is, so switching to `off` and back doesn't lose the ramp
   * an admin had dialled in. Ignored unless the mode reads it.
   */
  percent: number;
}

/**
 * How hard the interpreter tries, and how sure it has to be.
 *
 * All four of these were constants in the pipeline. They are the knobs anyone
 * tuning extraction quality actually reaches for, and having them in code meant
 * every experiment was a deploy — so in practice nobody ran one, and the values
 * that shipped were the values nobody had measured.
 *
 * They are bounded rather than free. A confidence floor of 1 would silently stop
 * the guide extracting anything at all, and a repair budget of 20 would spend a
 * reader's patience arguing with the schema, so the schema clamps both into a
 * range where the worst an admin can do is make the guide cautious or chatty.
 */
export interface GuideExtractionConfig {
  thresholds: {
    /** Below this a fact is not acted on at all. */
    floor: number;
    /** Below this an applied fact is named explicitly in the reply. */
    readBack: number;
    /** Below this, CHANGING something already decided is asked about first. */
    overwrite: number;
  };
  /** How many times a refused fact may be sent back for correction. 0 disables. */
  repairAttempts: number;
  /** Sampling temperature for the interpreter. Zero unless you are measuring. */
  temperature: number;
  /**
   * Longest message the guide will read, in characters.
   *
   * Larger than a sentence on purpose: the `storyText` slot takes 40,000
   * characters, so a parent pasting the story they wrote themselves was hitting a
   * 2,000-character wall built for conversational turns and being told their
   * message was too long — for the one path where a long message is exactly what
   * we asked them for.
   */
  maxMessageChars: number;
}

export interface GuideConfig {
  version: 1;
  rollout: GuideRollout;
  /**
   * Which components the guide runs, in what order (see
   * `core/guide/playlist.ts`). Editorial, not structural: the catalog in code
   * still decides what each component means and what it depends on, so no value
   * here can produce a book the pipeline refuses to make.
   */
  playlist: GuidePlaylist;
  extraction: GuideExtractionConfig;
  updatedAt?: number;
}

/**
 * What ships. `adminOnly` rather than `off` because the two are identical for
 * customers — neither reaches the new flow — while `adminOnly` lets an admin
 * exercise it on day one without first having to write a config document.
 * `off` stays available as the switch that also revokes admin opt-in.
 */
export const DEFAULT_GUIDE_ROLLOUT_MODE: GuideRolloutMode = "adminOnly";

export const guideExtractionSchema = z.object({
  thresholds: z.object({
    floor: z.number().min(0).max(0.9),
    readBack: z.number().min(0).max(1),
    overwrite: z.number().min(0).max(1),
  }),
  repairAttempts: z.number().int().min(0).max(3),
  temperature: z.number().min(0).max(1),
  maxMessageChars: z.number().int().min(500).max(50_000),
});

export const guideConfigSchema = z.object({
  version: z.literal(1),
  rollout: z.object({
    mode: z.enum(GUIDE_ROLLOUT_MODES),
    percent: z.number().int().min(0).max(100),
  }),
  playlist: guidePlaylistSchema,
  extraction: guideExtractionSchema,
  updatedAt: z.number().optional(),
});

export function createDefaultGuideExtraction(): GuideExtractionConfig {
  return {
    thresholds: { ...DEFAULT_GUIDE_CLAIM_THRESHOLDS },
    // One. The second pass recovers the shape mistakes, which are most of them;
    // a third has nothing new to tell the model and costs a reader real seconds.
    repairAttempts: 1,
    temperature: 0,
    // Comfortably past the longest story a parent is likely to paste, and still
    // far short of a payload worth paying to read.
    maxMessageChars: 40_000,
  };
}

export function createDefaultGuideConfig(): GuideConfig {
  return {
    version: 1,
    rollout: { mode: DEFAULT_GUIDE_ROLLOUT_MODE, percent: 0 },
    playlist: createDefaultGuidePlaylist(),
    extraction: createDefaultGuideExtraction(),
  };
}

/**
 * Re-anchor a stored (absent, partial or hand-edited) document onto the shipped
 * defaults. Field by field rather than all-or-nothing, so one unreadable field
 * doesn't discard a rollout an admin deliberately set — but every fallback
 * lands on a value that includes fewer readers, never more:
 *
 *   - an unknown mode falls back to `adminOnly`, not to the mode it looks like;
 *   - an unreadable percent falls back to 0, so a `percentage` rollout whose
 *     share is corrupt includes nobody instead of everybody.
 */
export function normalizeGuideConfig(input: unknown): GuideConfig {
  const defaults = createDefaultGuideConfig();
  const stored = (input ?? {}) as Partial<GuideConfig>;
  const rollout = (stored.rollout ?? {}) as Partial<GuideRollout>;

  const mode = GUIDE_ROLLOUT_MODES.includes(rollout.mode as GuideRolloutMode)
    ? (rollout.mode as GuideRolloutMode)
    : defaults.rollout.mode;
  const percent =
    typeof rollout.percent === "number" && Number.isFinite(rollout.percent)
      ? Math.min(100, Math.max(0, Math.round(rollout.percent)))
      : defaults.rollout.percent;

  return {
    version: 1,
    rollout: { mode, percent },
    // Re-anchored onto the catalog rather than trusted: a stored playlist can
    // name a component that no longer exists, or be missing one that now does.
    playlist: normalizeGuidePlaylist(stored.playlist),
    extraction: normalizeGuideExtraction(stored.extraction),
    ...(typeof stored.updatedAt === "number" ? { updatedAt: stored.updatedAt } : {}),
  };
}

/**
 * Field by field, clamping rather than discarding.
 *
 * A number outside its range is an admin who meant something — 150 in a percent
 * field means "as much as possible" — so it lands at the nearest legal value.
 * Only a value that is not a number at all falls back to the default, because
 * there is nothing to interpret.
 */
export function normalizeGuideExtraction(input: unknown): GuideExtractionConfig {
  const defaults = createDefaultGuideExtraction();
  const stored = (input ?? {}) as Partial<GuideExtractionConfig>;
  const thresholds = (stored.thresholds ?? {}) as Partial<GuideExtractionConfig["thresholds"]>;

  const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;

  return {
    thresholds: {
      floor: clamp(thresholds.floor, 0, 0.9, defaults.thresholds.floor),
      readBack: clamp(thresholds.readBack, 0, 1, defaults.thresholds.readBack),
      overwrite: clamp(thresholds.overwrite, 0, 1, defaults.thresholds.overwrite),
    },
    repairAttempts: Math.round(clamp(stored.repairAttempts, 0, 3, defaults.repairAttempts)),
    temperature: clamp(stored.temperature, 0, 1, defaults.temperature),
    maxMessageChars: Math.round(
      clamp(stored.maxMessageChars, 500, 50_000, defaults.maxMessageChars),
    ),
  };
}

/** One line for the admin dashboard and the rollout invariants report. */
export function describeGuideRollout(rollout: GuideRollout): string {
  switch (rollout.mode) {
    case "off":
      return "Off for everyone, including admins";
    case "adminOnly":
      return "Admins only — every customer stays on the wizard";
    case "percentage":
      return rollout.percent > 0
        ? `${rollout.percent}% of customers, plus admins`
        : "0% of customers — nobody is included yet";
    case "on":
      return "Everyone";
  }
}
