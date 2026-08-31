"use client";

import { useCallback, useState } from "react";
import { storyDraftRemote, storyTranslateRemote } from "../../../platform/aiClient";
import { useProjectsStore } from "../../../state/projectsStore";
import type { StoryBrief } from "../../../core/types";
import { getBookLanguage, type BookLanguageId } from "../../../core/config/bookLanguages";
import {
  briefBlockers,
  createDefaultStoryBrief,
  isBriefReady,
  storyBriefSignature,
} from "../../../core/story/brief";
import { notify } from "../../lib/notify";

/** Session-scoped hand-off from the landing page's "who is it for?" on-ramp. */
export const HERO_NAME_KEY = "quickStartHeroName";

export interface StoryDraftSnapshot {
  storyText: string;
  title?: string;
  contentLocale?: BookLanguageId;
  storyBrief?: StoryBrief;
}

export interface UseStoryDraft {
  writing: boolean;
  translating: boolean;
  /** The story that was on screen before the last generation/translation, for one-tap undo. */
  undoable: string | null;
  /** The story that was undone, for one-tap redo. */
  redoable: string | null;
  write: (brief: StoryBrief) => Promise<void>;
  translate: (sourceLocale?: BookLanguageId, targetLocale?: BookLanguageId) => Promise<void>;
  confirmLanguageWithoutTranslate: () => Promise<void>;
  undo: () => void;
  redo: () => void;
}

/**
 * Generating or translating a draft, shared by the guided/co-write composers and
 * the story step language-transfer actions.
 */
export function useStoryDraft(): UseStoryDraft {
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const rename = useProjectsStore((s) => s.renameProject);
  const [writing, setWriting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<StoryDraftSnapshot | null>(null);
  const [redoSnapshot, setRedoSnapshot] = useState<StoryDraftSnapshot | null>(null);

  const write = useCallback(
    async (brief: StoryBrief) => {
      const project = useProjectsStore.getState().current();
      if (!project || writing || translating) return;
      if (!isBriefReady(brief)) {
        notify.info("Almost there", briefBlockers(brief)[0] ?? "Add a little more first.");
        return;
      }

      const previous = project.config.storyText ?? "";
      const isFirstDraft = !previous.trim();
      const previousSnapshot: StoryDraftSnapshot = {
        storyText: previous,
        title: project.title,
        contentLocale: project.config.contentLocale,
        storyBrief: project.config.storyBrief,
      };

      setWriting(true);
      try {
        const draft = await storyDraftRemote(project, brief);
        const { ageRangeId, readingModeId, contentLocale } = project.config;
        await updateConfig({
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
        });
        // Only title the book on the first draft — after that the title is the
        // reader's, and silently overwriting it on every regenerate is theft.
        if (isFirstDraft && draft.title) await rename(project.id, draft.title);
        setUndoSnapshot(isFirstDraft ? null : previousSnapshot);
        setRedoSnapshot(null);
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
        setWriting(false);
      }
    },
    [rename, translating, updateConfig, writing],
  );

  const translate = useCallback(
    async (sourceLocale?: BookLanguageId, targetLocale?: BookLanguageId) => {
      const project = useProjectsStore.getState().current();
      if (!project || writing || translating) return;
      const story = project.config.storyText?.trim() ?? "";
      if (!story) return;

      const target = targetLocale ?? project.config.contentLocale ?? "en-US";
      const source =
        sourceLocale ??
        project.config.storyBrief?.generatedForLocale ??
        "en-US";
      const targetLang = getBookLanguage(target);
      const sourceLang = getBookLanguage(source);

      const previousSnapshot: StoryDraftSnapshot = {
        storyText: project.config.storyText ?? "",
        title: project.title,
        contentLocale: (project.config.contentLocale as BookLanguageId) ?? "en-US",
        storyBrief: project.config.storyBrief,
      };

      setTranslating(true);
      try {
        const result = await storyTranslateRemote(project, source, target);
        const { ageRangeId, readingModeId } = project.config;
        const brief: StoryBrief =
          project.config.storyBrief ?? createDefaultStoryBrief("own");

        await updateConfig({
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
        });
        if (result.title) await rename(project.id, result.title);
        setUndoSnapshot(previousSnapshot);
        setRedoSnapshot(null);
        notify.success(
          `Story translated to ${targetLang.endonym}`,
          `Culturally adapted from ${sourceLang.endonym} into ${targetLang.englishName}.`,
        );
      } catch (err) {
        notify.error(err);
      } finally {
        setTranslating(false);
      }
    },
    [rename, translating, updateConfig, writing],
  );

  const confirmLanguageWithoutTranslate = useCallback(async () => {
    const project = useProjectsStore.getState().current();
    if (!project) return;
    const brief: StoryBrief =
      project.config.storyBrief ?? createDefaultStoryBrief("own");
    const { ageRangeId, readingModeId } = project.config;
    const currentLocale = project.config.contentLocale ?? "en-US";
    await updateConfig({
      contentLocale: currentLocale,
      storyBrief: {
        ...brief,
        generatedForLocale: currentLocale,
        generatedSignature: storyBriefSignature(
          brief,
          ageRangeId,
          readingModeId,
          currentLocale,
        ),
      },
    });
    notify.info(
      "Language choice confirmed",
      `Kept your current story words with ${getBookLanguage(currentLocale).endonym} selected.`,
    );
  }, [updateConfig]);

  const undo = useCallback(async () => {
    if (!undoSnapshot) return;
    const project = useProjectsStore.getState().current();
    if (!project) return;
    const currentSnapshot: StoryDraftSnapshot = {
      storyText: project.config.storyText ?? "",
      title: project.title,
      contentLocale: project.config.contentLocale,
      storyBrief: project.config.storyBrief,
    };
    setRedoSnapshot(currentSnapshot);
    await updateConfig({
      storyText: undoSnapshot.storyText,
      contentLocale: undoSnapshot.contentLocale,
      storyBrief: undoSnapshot.storyBrief,
    });
    if (undoSnapshot.title && undoSnapshot.title !== project.title) {
      await rename(project.id, undoSnapshot.title);
    }
    setUndoSnapshot(null);
    notify.info("Change undone", "Reverted story to previous version.");
  }, [rename, undoSnapshot, updateConfig]);

  const redo = useCallback(async () => {
    if (!redoSnapshot) return;
    const project = useProjectsStore.getState().current();
    if (!project) return;
    const currentSnapshot: StoryDraftSnapshot = {
      storyText: project.config.storyText ?? "",
      title: project.title,
      contentLocale: project.config.contentLocale,
      storyBrief: project.config.storyBrief,
    };
    setUndoSnapshot(currentSnapshot);
    await updateConfig({
      storyText: redoSnapshot.storyText,
      contentLocale: redoSnapshot.contentLocale,
      storyBrief: redoSnapshot.storyBrief,
    });
    if (redoSnapshot.title && redoSnapshot.title !== project.title) {
      await rename(project.id, redoSnapshot.title);
    }
    setRedoSnapshot(null);
    notify.success("Change restored", "Restored story.");
  }, [redoSnapshot, rename, updateConfig]);

  return {
    writing,
    translating,
    undoable: undoSnapshot ? undoSnapshot.storyText : null,
    redoable: redoSnapshot ? redoSnapshot.storyText : null,
    write,
    translate,
    confirmLanguageWithoutTranslate,
    undo,
    redo,
  };
}
