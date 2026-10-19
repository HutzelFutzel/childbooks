/**
 * The Chat studio's settings, stored at `appConfig/guide` and world-readable so
 * the studio can read them before the first paint.
 *
 * Ownership follows every other config document here:
 *   - CODE owns the contract — the catalog of components, the shape of each
 *     setting, and what every one of them means. None of that is editable from
 *     the dashboard, so a config change can never invent behavior that has no
 *     implementation.
 *   - ADMINS own the values — the playlist order, extraction thresholds, fact
 *     policies, story details, wording and the agent's skills and persona.
 *
 * The document may be ABSENT, so {@link normalizeGuideConfig} is the real default
 * rather than a fallback that only fires on corruption. A document saved while
 * the studio still had a rollout setting keeps loading: the field is ignored.
 */
import { z } from "zod";
import { DEFAULT_GUIDE_CLAIM_THRESHOLDS } from "../guide/claims";
import {
  createDefaultGuidePlaylist,
  guidePlaylistSchema,
  normalizeGuidePlaylist,
  type GuidePlaylist,
} from "../guide/playlist";
import {
  createDefaultGuideFactPolicies,
  guideFactPoliciesSchema,
  normalizeGuideFactPolicies,
  type GuideFactPolicies,
} from "../guide/factPolicy";
import { normalizeGuideCopy, type GuideCopyOverrides } from "../guide/copy";
import {
  createDefaultGuideBriefConfig,
  guideBriefConfigSchema,
  normalizeGuideBriefConfig,
  type GuideBriefConfig,
} from "../guide/briefPolicy";
import {
  createDefaultGuideAgentConfig,
  guideAgentConfigSchema,
  normalizeGuideAgentConfig,
  type GuideAgentConfig,
} from "./guideAgent";

/** One saved-over version of the guide settings, for the admin's history list. */
export interface GuideVersionSummary {
  id: string;
  /** When these settings were replaced. */
  replacedAt: number;
  replacedBy: string | null;
  /** The settings areas the replacing save changed, in the admin's terms (agent.turn, wording…). */
  changed: string[];
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
  /**
   * Which components the guide runs, in what order (see
   * `core/guide/playlist.ts`). Editorial, not structural: the catalog in code
   * still decides what each component means and what it depends on, so no value
   * here can produce a book the pipeline refuses to make.
   */
  playlist: GuidePlaylist;
  extraction: GuideExtractionConfig;
  /**
   * Chat studio: for each fact the guide may collect, whether it is required,
   * whether the broad question may ask it, and what happens when it is unsaid.
   * Code owns the order of the look, the plates and the story.
   */
  facts: GuideFactPolicies;
  /**
   * Chat studio: which story details the story card offers or the guide asks,
   * and whether the draft waits for "Write the story" (see `core/guide/briefPolicy.ts`).
   */
  brief: GuideBriefConfig;
  /** Chat studio: admin overrides of the configured wording (see `core/guide/copy.ts`). */
  wording: GuideCopyOverrides;
  /** Chat studio: skills, persona, answer style, help and suggestions (see `./guideAgent.ts`). */
  agent: GuideAgentConfig;
  updatedAt?: number;
}

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
  playlist: guidePlaylistSchema,
  extraction: guideExtractionSchema,
  facts: guideFactPoliciesSchema,
  brief: guideBriefConfigSchema,
  wording: z.record(z.string(), z.string().max(400)),
  agent: guideAgentConfigSchema,
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
    playlist: createDefaultGuidePlaylist(),
    extraction: createDefaultGuideExtraction(),
    facts: createDefaultGuideFactPolicies(),
    brief: createDefaultGuideBriefConfig(),
    wording: {},
    agent: createDefaultGuideAgentConfig(),
  };
}

/**
 * Re-anchor a stored (absent, partial or hand-edited) document onto the shipped
 * defaults, field by field rather than all-or-nothing, so one unreadable field
 * doesn't discard settings an admin deliberately made.
 */
export function normalizeGuideConfig(input: unknown): GuideConfig {
  const stored = (input ?? {}) as Partial<GuideConfig>;

  return {
    version: 1,
    // Re-anchored onto the catalog rather than trusted: a stored playlist can
    // name a component that no longer exists, or be missing one that now does.
    playlist: normalizeGuidePlaylist(stored.playlist),
    extraction: normalizeGuideExtraction(stored.extraction),
    facts: normalizeGuideFactPolicies(stored.facts),
    brief: normalizeGuideBriefConfig(stored.brief),
    wording: normalizeGuideCopy(stored.wording),
    agent: normalizeGuideAgentConfig(stored.agent),
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
