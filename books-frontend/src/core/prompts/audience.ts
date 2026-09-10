/**
 * The audience overlay compiler.
 *
 * One function turns a resolved {@link AudienceProfile} into the handful of
 * strings the prompt templates interpolate. Everything downstream — the studio,
 * the backend `/ai/*` routes and the admin live preview — calls this, so the
 * preview an admin reads is byte-identical to what the model is sent.
 *
 * The channel table in `audienceCatalog` is what makes this safe to expand: a
 * new guardrail section reaches exactly the prompts it declares and no others.
 * The image models in particular get the visual consequences of an age band and
 * nothing about sentence length, because they ignore prose rules and the tokens
 * are not free.
 */
import {
  EDITORIAL_DIMENSIONS,
  GUARDRAIL_SECTIONS,
  type AudienceProfile,
  type OverlayChannel,
} from "../config/audienceCatalog";
import {
  resolveAudienceProfile,
  resolveAvoidList,
  resolveModeGuidance,
  type AudienceConfig,
  type AudienceSource,
} from "../config/audience";
import type { ReadingModeId } from "../config/readingModes";

/** Every compiled string a pipeline can interpolate for one book. */
export interface AudienceOverlays {
  profile: AudienceProfile;
  /** Shown in the wizard. Never sent to a model. */
  human: string;
  /** Drafting, translation, revision. */
  story: string;
  /** Pagination and illustration briefs. */
  screenplay: string;
  /** Page and cover image prompts. */
  illustration: string;
  /** Character reference sheets. */
  characterArt: string;
  /** The rubric the reading-level check scores against. */
  evaluation: string;
  /** Hard page-pacing sentence for the screenplay prompt. */
  density: string;
  /** `NEVER include` list, semicolon-joined (entries contain commas). */
  safetyList: string;
  safetyNote: string;
  /** Hero-age sentence with `{{min}}`/`{{max}}` already substituted. */
  protagonist: string;
}

/** Sections for one channel, in catalog order, headed and blank-line separated. */
function sectionsFor(profile: AudienceProfile, channel: OverlayChannel): string[] {
  const out: string[] = [];
  for (const def of GUARDRAIL_SECTIONS) {
    if (!def.channels.includes(channel)) continue;
    const text = (profile.sections[def.id] ?? "").trim();
    if (!text) continue;
    out.push(`${def.heading}\n${text}`);
  }
  return out;
}

/**
 * The rubric as one compact line per dimension: `Repetition: Very high — <prose>`.
 * A table would be clearer to a human and is worse for a model; a labelled list
 * keeps the level and its explanation bound together in the same token span.
 */
function dimensionLines(profile: AudienceProfile, channel: OverlayChannel): string[] {
  const out: string[] = [];
  for (const def of EDITORIAL_DIMENSIONS) {
    if (!def.channels.includes(channel)) continue;
    const value = profile.dimensions[def.id];
    if (!value) continue;
    const level = def.levels[Math.max(0, Math.min(def.levels.length - 1, value.level))];
    const guidance = value.guidance.trim();
    out.push(`- ${def.label}: ${level}${guidance ? ` — ${guidance}` : ""}`);
  }
  return out;
}

function joinBlocks(blocks: string[]): string {
  return blocks.filter((b) => b.trim()).join("\n\n");
}

function protagonistSentence(profile: AudienceProfile): string {
  return profile.protagonist.guidance
    .replace(/\{\{\s*min\s*\}\}/g, String(profile.protagonist.minAge))
    .replace(/\{\{\s*max\s*\}\}/g, String(profile.protagonist.maxAge));
}

function densitySentence(profile: AudienceProfile): string {
  const { density, structure } = profile;
  const parts: string[] = [];
  if (density.targetWordsPerPage > 0) {
    parts.push(
      `Aim for about ${density.targetWordsPerPage} words on a typical page` +
        (density.maxWordsPerPage > 0 ? `, and never more than ${density.maxWordsPerPage}` : ""),
    );
  } else if (density.maxWordsPerPage > 0) {
    parts.push(`Never put more than ${density.maxWordsPerPage} words on a page`);
  }
  if (density.targetSentencesPerPage > 0) {
    parts.push(
      `roughly ${density.targetSentencesPerPage} sentence${
        density.targetSentencesPerPage === 1 ? "" : "s"
      } per page`,
    );
  }
  if (structure.maxSentenceWords > 0) {
    parts.push(`no sentence longer than ${structure.maxSentenceWords} words`);
  }
  if (density.maxFocalCharactersPerScene > 0) {
    parts.push(
      `at most ${density.maxFocalCharactersPerScene} character${
        density.maxFocalCharactersPerScene === 1 ? "" : "s"
      } sharing any one illustration`,
    );
  }
  if (parts.length === 0) return "";
  const budget =
    density.minPages > 0 && density.maxPages > 0
      ? ` Plan the book to land between ${density.minPages} and ${density.maxPages} pages; add or merge pages to hit that, rather than overloading a page.`
      : "";
  return `PAGE PACING: ${parts.join("; ")}.${budget}`;
}

/**
 * Compile every overlay for one book.
 *
 * `readingModeId` only matters on bands that offer the choice; the resolver
 * falls back to the band's `default` mode otherwise, so passing a stale mode id
 * from an older project is harmless.
 */
export function resolveAudienceOverlays(
  ageRangeId: string,
  readingModeId?: ReadingModeId | string | null,
  src?: AudienceSource | AudienceConfig | null,
): AudienceOverlays {
  const profile = resolveAudienceProfile(ageRangeId, src);
  const mode = resolveModeGuidance(profile, readingModeId);

  const storyBlocks = [
    `WRITING FOR: ${profile.label}.`,
    mode.storyGuidance.trim(),
    ...sectionsFor(profile, "story"),
  ];
  const storyDims = dimensionLines(profile, "story");
  if (storyDims.length > 0) {
    storyBlocks.push(`HOW THIS AGE READS — hold every one of these:\n${storyDims.join("\n")}`);
  }

  const screenplayBlocks = sectionsFor(profile, "screenplay");
  const screenplayDims = dimensionLines(profile, "screenplay");
  if (screenplayDims.length > 0) {
    screenplayBlocks.push(`PAGE-LEVEL TARGETS:\n${screenplayDims.join("\n")}`);
  }

  const illustrationBlocks = sectionsFor(profile, "illustration");
  const illustrationDims = dimensionLines(profile, "illustration");
  if (illustrationDims.length > 0) {
    illustrationBlocks.push(
      `What this reader needs from a picture:\n${illustrationDims.join("\n")}`,
    );
  }

  const evaluationBlocks = sectionsFor(profile, "evaluation");
  const evaluationDims = dimensionLines(profile, "evaluation");

  return {
    profile,
    human: mode.humanGuidance.trim(),
    story: joinBlocks(storyBlocks),
    screenplay: joinBlocks(screenplayBlocks),
    illustration: joinBlocks([
      `This book is for ${profile.label}.`,
      ...illustrationBlocks,
    ]),
    characterArt: joinBlocks([
      `These characters appear in a book for ${profile.label}.`,
      ...sectionsFor(profile, "characterArt"),
    ]),
    evaluation: joinBlocks([
      ...evaluationBlocks,
      evaluationDims.length > 0
        ? `TYPICAL FOR THIS AGE:\n${evaluationDims.join("\n")}`
        : "",
    ]),
    density: densitySentence(profile),
    safetyList: resolveAvoidList(profile).join("; "),
    safetyNote: profile.safety.note.trim(),
    protagonist: protagonistSentence(profile),
  };
}

/**
 * The dimensions the reading-level check is asked to score, as an instruction
 * list. Kept separate from the overlay because the evaluator needs the ids back
 * in its structured output, and the ids must match exactly.
 */
export function evaluationRubric(profile: AudienceProfile): {
  ids: string[];
  instruction: string;
} {
  const wanted =
    profile.evaluatedDimensionIds.length > 0
      ? profile.evaluatedDimensionIds
      : EDITORIAL_DIMENSIONS.map((d) => d.id);
  const rows = EDITORIAL_DIMENSIONS.filter((def) => wanted.includes(def.id)).filter(
    (def) => profile.dimensions[def.id],
  );
  const ids = rows.map((r) => r.id);
  const instruction = rows
    .map((def) => {
      const value = profile.dimensions[def.id]!;
      const level = def.levels[Math.max(0, Math.min(def.levels.length - 1, value.level))];
      const guidance = value.guidance.trim();
      return `- ${def.id} (${def.label}) — books at this age usually sit at "${level}"${
        guidance ? `: ${guidance}` : ""
      }`;
    })
    .join("\n");
  return { ids, instruction };
}
