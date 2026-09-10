/**
 * Compiles a story brief plus the age band's Story-craft rules into the
 * variables and flags the `storyDraft/*` and `storyCheck/*` templates expect.
 *
 * Kept separate from the pipeline so the backend can resolve the exact same
 * rules when validating an incoming request, and so the admin preview and the
 * real call can never drift apart.
 */
import type { StoryBrief, BookConfig } from "../types";
import type { AgeBandStoryCraft } from "../config/storyCraftCatalog";
import { ageBandLabel } from "../config/storyCraftCatalog";
import { optionGuidance, optionsGuidance, resolveStoryCraft, type StoryCraftConfig } from "../config/storyCraft";
import { getBookLanguage } from "../config/bookLanguages";
import { castPromptLines, heroesLine } from "../story/brief";
import {
  resolveAudienceProfile,
  resolveAvoidList,
  type AudienceSource,
} from "../config/audience";
import type { AudienceProfile } from "../config/audienceCatalog";
import { evaluationRubric, resolveAudienceOverlays } from "./audience";
import { resolveAgeLlmGuidance } from "./age";
import type { PromptContext } from "./context";
import { resolvePromptsConfig } from "./context";
import { renderTextPrompt } from "./render";
import type { StoryRevisionSelection } from "../story/revision";

function craftFromCtx(
  ctx?: Pick<PromptContext, "storyCraft"> | StoryCraftConfig | null,
): StoryCraftConfig | null | undefined {
  if (!ctx) return null;
  return "storyCraft" in ctx ? ctx.storyCraft : (ctx as StoryCraftConfig);
}

/**
 * The rules in force for an age band.
 *
 * Story craft supplies the curated LISTS an author picks from; the audience
 * profile supplies every RULE — length, beats, sentence ceiling, hero age and
 * the avoid list — because those have to agree with the page pacing and the
 * rubric, which live there too. Rules an admin set under the old story-craft
 * editor are folded into the profile as a base layer, so this is a change of
 * owner rather than a loss of configuration.
 */
export function resolveStoryCraftFor(
  ageRangeId: string,
  ctx?: Pick<PromptContext, "storyCraft" | "audience" | "ageWriting"> | StoryCraftConfig | null,
): AgeBandStoryCraft {
  const lists = resolveStoryCraft(ageRangeId, craftFromCtx(ctx));
  const profile = resolveAudienceProfile(ageRangeId, audienceSourceFrom(ctx));
  return {
    ...lists,
    structure: {
      minWords: profile.structure.minWords,
      maxWords: profile.structure.maxWords,
      beats: profile.structure.beats,
      maxSentenceWords: profile.structure.maxSentenceWords,
    },
    protagonist: profile.protagonist,
    safety: { avoid: resolveAvoidList(profile), note: profile.safety.note },
  };
}

/**
 * A story-craft-shaped argument is not an audience source, and passing one as
 * if it were would silently resolve the shipped bands instead of the admin's.
 */
function audienceSourceFrom(
  ctx?: Pick<PromptContext, "storyCraft" | "audience" | "ageWriting"> | StoryCraftConfig | null,
): AudienceSource | null {
  if (!ctx) return null;
  if ("version" in ctx && "bands" in ctx) return { storyCraft: ctx as StoryCraftConfig };
  return ctx as AudienceSource;
}

function protagonistSentence(craft: AgeBandStoryCraft): string {
  return craft.protagonist.guidance
    .replace(/\{\{\s*min\s*\}\}/g, String(craft.protagonist.minAge))
    .replace(/\{\{\s*max\s*\}\}/g, String(craft.protagonist.maxAge));
}

export interface StoryPromptParts {
  system: string;
  user: string;
  craft: AgeBandStoryCraft;
  /** The band's full editorial profile — density targets, rubric, plot flag. */
  profile: AudienceProfile;
}

/**
 * Build the draft prompt for a brief. `repairInstruction` turns on the retry
 * block, which explains what the rejected attempt got wrong.
 */
export function buildStoryDraftPrompt(
  config: Pick<BookConfig, "ageRangeId" | "readingModeId" | "contentLocale">,
  brief: StoryBrief,
  ctx?: PromptContext | null,
  repairInstruction?: string,
): StoryPromptParts {
  const baseCraft = resolveStoryCraftFor(config.ageRangeId, ctx);
  const profile = resolveAudienceProfile(config.ageRangeId, ctx);
  const language = getBookLanguage(config.contentLocale);
  const craft: AgeBandStoryCraft = {
    ...baseCraft,
    structure: {
      ...baseCraft.structure,
      minWords: Math.max(1, Math.round(baseCraft.structure.minWords * language.wordCountFactor)),
      maxWords: Math.max(1, Math.round(baseCraft.structure.maxWords * language.wordCountFactor)),
    },
  };
  const effectiveDeviceIds =
    brief.deviceIds && brief.deviceIds.length > 0 ? brief.deviceIds : brief.deviceId ?? undefined;
  const themeGuidance = optionGuidance(craft.themes, brief.themeId ?? undefined, brief.customTheme);
  const deviceGuidance = optionsGuidance(craft.devices, effectiveDeviceIds, brief.customDevice);
  const settingGuidance = optionGuidance(
    craft.settings,
    brief.settingId ?? undefined,
    brief.customSetting,
  );

  const key = brief.mode === "co-write" ? "storyDraft/coWrite" : "storyDraft/guided";
  const { system, user } = renderTextPrompt(resolvePromptsConfig(ctx), key, {
    vars: {
      age: ageBandLabel(config.ageRangeId),
      ageGuidance: resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, ctx),
      languageInstruction: language.promptInstruction,
      heroLine: heroesLine(brief),
      cast: castPromptLines(brief),
      occasion: brief.occasion?.trim() ?? "",
      when: brief.when?.trim() ?? "",
      where: brief.where?.trim() ?? "",
      mustInclude: brief.mustInclude?.trim() ?? "",
      themeGuidance,
      deviceGuidance,
      settingGuidance,
      protagonistGuidance: protagonistSentence(craft),
      minWords: String(craft.structure.minWords),
      maxWords: String(craft.structure.maxWords),
      beats: String(craft.structure.beats),
      maxSentenceWords: String(craft.structure.maxSentenceWords),
      // Semicolons, not commas: individual entries contain commas of their own,
      // and a comma-joined list reads as one long sentence to the model.
      safetyList: craft.safety.avoid.join("; "),
      safetyNote: craft.safety.note,
      repairInstruction: repairInstruction ?? "",
    },
    flags: {
      hasTheme: Boolean(themeGuidance),
      hasDevice: Boolean(deviceGuidance),
      hasSetting: Boolean(settingGuidance),
      hasSentenceLimit: craft.structure.maxSentenceWords > 0,
      hasWhen: Boolean(brief.when?.trim()),
      hasWhere: Boolean(brief.where?.trim()),
      hasMustInclude: Boolean(brief.mustInclude?.trim()),
      isRepair: Boolean(repairInstruction),
      plotRequired: profile.structure.plotRequired,
    },
  });

  return { system, user, craft, profile };
}

/**
 * Build the advisory age-fit prompt for a story the author wrote themselves.
 *
 * `dimensionIds` is returned alongside the prompt because the caller has to
 * validate the model's structured answer against exactly the rows it was asked
 * about — a fit for a dimension nobody asked for is noise.
 */
export function buildStoryFitPrompt(
  config: Pick<BookConfig, "ageRangeId" | "readingModeId" | "contentLocale">,
  story: string,
  actualWords: number,
  ctx?: PromptContext | null,
): StoryPromptParts & { dimensionIds: string[] } {
  const baseCraft = resolveStoryCraftFor(config.ageRangeId, ctx);
  const profile = resolveAudienceProfile(config.ageRangeId, ctx);
  const language = getBookLanguage(config.contentLocale);
  const craft: AgeBandStoryCraft = {
    ...baseCraft,
    structure: {
      ...baseCraft.structure,
      minWords: Math.max(1, Math.round(baseCraft.structure.minWords * language.wordCountFactor)),
      maxWords: Math.max(1, Math.round(baseCraft.structure.maxWords * language.wordCountFactor)),
    },
  };
  const overlays = resolveAudienceOverlays(config.ageRangeId, config.readingModeId, ctx);
  const rubric = evaluationRubric(profile);
  const { system, user } = renderTextPrompt(resolvePromptsConfig(ctx), "storyCheck/ageFit", {
    vars: {
      age: profile.label,
      // The evaluation channel, not the writing one: the check wants to know
      // what this age USUALLY reads like, not the instructions a drafting model
      // would have been given.
      ageGuidance: overlays.evaluation || overlays.story,
      dimensionRubric: rubric.instruction,
      dimensionIds: rubric.ids.join(", "),
      languageName: language.englishName,
      story,
      actualWords: String(actualWords),
      minWords: String(craft.structure.minWords),
      maxWords: String(craft.structure.maxWords),
      safetyList: craft.safety.avoid.join("; "),
    },
    flags: { hasRubric: rubric.ids.length > 0 },
  });
  return { system, user, craft, profile, dimensionIds: rubric.ids };
}

/** Build the translation and cultural adaptation prompt for an existing story. */
export function buildStoryTranslatePrompt(
  config: Pick<BookConfig, "ageRangeId" | "readingModeId" | "contentLocale" | "storyBrief">,
  story: string,
  title: string | undefined,
  sourceLocale?: string | null,
  ctx?: PromptContext | null,
): StoryPromptParts {
  const baseCraft = resolveStoryCraftFor(config.ageRangeId, ctx);
  const targetLanguage = getBookLanguage(config.contentLocale);
  const sourceLanguage = getBookLanguage(sourceLocale);
  const brief = config.storyBrief;
  const effectiveDeviceIds = brief?.deviceIds && brief.deviceIds.length > 0
    ? brief.deviceIds
    : brief?.deviceId ?? undefined;
  const deviceGuidance = brief
    ? optionsGuidance(baseCraft.devices, effectiveDeviceIds, brief.customDevice)
    : "";

  const { system, user } = renderTextPrompt(resolvePromptsConfig(ctx), "storyDraft/translate", {
    vars: {
      age: ageBandLabel(config.ageRangeId),
      ageGuidance: resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, ctx),
      languageInstruction: targetLanguage.promptInstruction,
      sourceLanguage: sourceLanguage.englishName,
      targetLanguage: targetLanguage.englishName,
      currentTitle: title?.trim() ?? "",
      currentStory: story.trim(),
      deviceGuidance,
    },
    flags: {
      hasTitle: Boolean(title?.trim()),
      hasDevice: Boolean(deviceGuidance),
    },
  });

  return {
    system,
    user,
    craft: baseCraft,
    profile: resolveAudienceProfile(config.ageRangeId, ctx),
  };
}

/** Build a surgical edit prompt whose output names every exact text replacement. */
export function buildStoryRevisionPrompt(
  config: Pick<BookConfig, "ageRangeId" | "readingModeId" | "contentLocale" | "storyBrief">,
  story: string,
  instruction: string,
  selection?: StoryRevisionSelection,
  ctx?: PromptContext | null,
): StoryPromptParts {
  const craft = resolveStoryCraftFor(config.ageRangeId, ctx);
  const language = getBookLanguage(config.contentLocale);
  const brief = config.storyBrief;
  const effectiveDeviceIds = brief?.deviceIds && brief.deviceIds.length > 0
    ? brief.deviceIds
    : brief?.deviceId ?? undefined;
  const deviceGuidance = brief
    ? optionsGuidance(craft.devices, effectiveDeviceIds, brief.customDevice)
    : "";

  const { system, user } = renderTextPrompt(resolvePromptsConfig(ctx), "storyEdit/revise", {
    vars: {
      age: ageBandLabel(config.ageRangeId),
      ageGuidance: resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, ctx),
      languageInstruction: language.promptInstruction,
      deviceGuidance,
      instruction: instruction.trim(),
      selectedPassage: selection?.text ?? "",
      currentStory: story,
    },
    flags: {
      hasDevice: Boolean(deviceGuidance),
      hasSelection: Boolean(selection),
    },
  });

  return { system, user, craft, profile: resolveAudienceProfile(config.ageRangeId, ctx) };
}
