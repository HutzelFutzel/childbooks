"use client";

import { useCallback, useRef, useState } from "react";
import { storyDraftRemote, storyTranslateRemote } from "../../../platform/aiClient";
import { useProjectsStore } from "../../../state/projectsStore";
import type { StoryBrief } from "../../../core/types";
import { getBookLanguage, type BookLanguageId } from "../../../core/config/bookLanguages";
import { ageBandLabel } from "../../../core/config/storyCraftCatalog";
import {
  briefBlockers,
  createDefaultStoryBrief,
  isBriefReady,
  storyBriefSignature,
} from "../../../core/story/brief";
import { notify } from "../../lib/notify";
import { useStudio } from "../StudioContext";

/** Session-scoped hand-off from the landing page's "who is it for?" on-ramp. */
export const HERO_NAME_KEY = "quickStartHeroName";

export interface UseStoryDraft {
  writing: boolean;
  translating: boolean;
  write: (brief: StoryBrief) => Promise<void>;
  translate: (sourceLocale?: BookLanguageId, targetLocale?: BookLanguageId) => Promise<void>;
  confirmWithoutRewrite: () => Promise<void>;
}

/**
 * Generating or translating a draft, shared by the guided/co-write composers and
 * the story step language-transfer actions.
 */
export function useStoryDraft(): UseStoryDraft {
  const { updateStory, endStoryHistoryGesture } = useStudio();
  const [writing, setWriting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const writingRef = useRef(false);
  const translatingRef = useRef(false);

  const write = useCallback(
    async (brief: StoryBrief) => {
      const project = useProjectsStore.getState().current();
      if (!project || writingRef.current || translatingRef.current) return;
      if (!isBriefReady(brief)) {
        notify.info("Almost there", briefBlockers(brief)[0] ?? "Add a little more first.");
        return;
      }

      const isFirstDraft = !project.config.storyText.trim();

      writingRef.current = true;
      setWriting(true);
      try {
        const draft = await storyDraftRemote(project, brief);
        const live = useProjectsStore.getState().current();
        if (!live || live.id !== project.id) return;
        const { ageRangeId, readingModeId, contentLocale } = live.config;
        endStoryHistoryGesture();
        await updateStory({
          storyText: draft.story,
          storyBrief: {
            ...brief,
            generatedAt: Date.now(),
            generatedSignature: storyBriefSignature(
              brief,
              ageRangeId,
              readingModeId,
              contentLocale,
            ),
            generatedForAge: ageRangeId,
            generatedForLocale: contentLocale,
          },
          ...(isFirstDraft && draft.title ? { title: draft.title } : {}),
        });
        try {
          sessionStorage.removeItem(HERO_NAME_KEY);
        } catch {
          /* ignore */
        }
        notify.success(
          isFirstDraft ? "Your story is written" : "A fresh take on your story",
          "Read it below and change anything you like — it's yours now.",
        );
      } catch (err) {
        notify.error(err);
      } finally {
        writingRef.current = false;
        setWriting(false);
      }
    },
    [endStoryHistoryGesture, updateStory],
  );

  const translate = useCallback(
    async (sourceLocale?: BookLanguageId, targetLocale?: BookLanguageId) => {
      const project = useProjectsStore.getState().current();
      if (!project || writingRef.current || translatingRef.current) return;
      const story = project.config.storyText?.trim() ?? "";
      if (!story) return;

      const target = targetLocale ?? project.config.contentLocale ?? "en-US";
      const source =
        sourceLocale ??
        project.config.storyBrief?.generatedForLocale ??
        "en-US";
      const targetLang = getBookLanguage(target);
      const sourceLang = getBookLanguage(source);

      translatingRef.current = true;
      setTranslating(true);
      try {
        const result = await storyTranslateRemote(project, source, target);
        const live = useProjectsStore.getState().current();
        if (!live || live.id !== project.id) return;
        const { ageRangeId, readingModeId } = live.config;
        const brief: StoryBrief =
          live.config.storyBrief ?? createDefaultStoryBrief("own");
        const prevAge = brief.generatedForAge ?? (story ? "0-2" : undefined);
        const ageChanged = Boolean(prevAge) && prevAge !== ageRangeId;
        const langChanged = source !== target;

        endStoryHistoryGesture();
        await updateStory({
          storyText: result.story,
          contentLocale: target,
          storyBrief: {
            ...brief,
            generatedAt: Date.now(),
            generatedSignature: storyBriefSignature(
              brief,
              ageRangeId,
              readingModeId,
              target,
            ),
            generatedForAge: ageRangeId,
            generatedForLocale: target,
          },
          ...(result.title ? { title: result.title } : {}),
        });

        if (langChanged && ageChanged) {
          notify.success(
            `Story adapted to ${targetLang.endonym} for ${ageBandLabel(ageRangeId)}`,
            `Translated into ${targetLang.englishName} and calibrated for ${ageBandLabel(ageRangeId)}.`,
          );
        } else if (langChanged) {
          notify.success(
            `Story translated to ${targetLang.endonym}`,
            `Culturally adapted from ${sourceLang.endonym} into ${targetLang.englishName}.`,
          );
        } else {
          notify.success(
            `Story adapted for ${ageBandLabel(ageRangeId)}`,
            `Calibrated vocabulary and pacing for ${ageBandLabel(ageRangeId)}.`,
          );
        }
      } catch (err) {
        notify.error(err);
      } finally {
        translatingRef.current = false;
        setTranslating(false);
      }
    },
    [endStoryHistoryGesture, updateStory],
  );

  const confirmWithoutRewrite = useCallback(async () => {
    const project = useProjectsStore.getState().current();
    if (!project) return;
    const brief: StoryBrief =
      project.config.storyBrief ?? createDefaultStoryBrief("own");
    const { ageRangeId, readingModeId } = project.config;
    const currentLocale = (project.config.contentLocale as BookLanguageId) ?? "en-US";
    endStoryHistoryGesture();
    await updateStory({
      contentLocale: currentLocale,
      storyBrief: {
        ...brief,
        generatedForLocale: currentLocale,
        generatedForAge: ageRangeId,
        generatedSignature: storyBriefSignature(
          brief,
          ageRangeId,
          readingModeId,
          currentLocale,
        ),
      },
    });
    notify.info(
      "Story settings confirmed",
      "Kept your current story words with updated settings.",
    );
  }, [endStoryHistoryGesture, updateStory]);

  return {
    writing,
    translating,
    write,
    translate,
    confirmWithoutRewrite,
  };
}
