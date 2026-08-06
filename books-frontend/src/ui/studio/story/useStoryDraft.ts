"use client";

import { useCallback, useState } from "react";
import { storyDraftRemote } from "../../../platform/aiClient";
import { useProjectsStore } from "../../../state/projectsStore";
import type { StoryBrief } from "../../../core/types";
import { briefBlockers, isBriefReady, storyBriefSignature } from "../../../core/story/brief";
import { notify } from "../../lib/notify";

/** Session-scoped hand-off from the landing page's "who is it for?" on-ramp. */
export const HERO_NAME_KEY = "quickStartHeroName";

export interface UseStoryDraft {
  writing: boolean;
  /** The story that was on screen before the last generation, for one-tap undo. */
  undoable: string | null;
  write: (brief: StoryBrief) => Promise<void>;
  undo: () => void;
}

/**
 * Generating a draft, shared by the guided and co-write composers.
 *
 * Two things it deliberately does: it stamps the brief that produced the text
 * (so the UI can tell a current draft from a stale one after any later edit),
 * and it keeps the previous story in memory so a regenerate is never a
 * destructive act the reader can't take back.
 */
export function useStoryDraft(): UseStoryDraft {
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const rename = useProjectsStore((s) => s.renameProject);
  const [writing, setWriting] = useState(false);
  const [undoable, setUndoable] = useState<string | null>(null);

  const write = useCallback(
    async (brief: StoryBrief) => {
      const project = useProjectsStore.getState().current();
      if (!project || writing) return;
      if (!isBriefReady(brief)) {
        notify.info("Almost there", briefBlockers(brief)[0] ?? "Add a little more first.");
        return;
      }

      const previous = project.config.storyText;
      const isFirstDraft = !previous.trim();
      setWriting(true);
      try {
        const draft = await storyDraftRemote(project, brief);
        const { ageRangeId, readingModeId } = project.config;
        await updateConfig({
          storyText: draft.story,
          storyBrief: {
            ...brief,
            generatedAt: Date.now(),
            generatedSignature: storyBriefSignature(brief, ageRangeId, readingModeId),
            generatedForAge: ageRangeId,
          },
        });
        // Only title the book on the first draft — after that the title is the
        // reader's, and silently overwriting it on every regenerate is theft.
        if (isFirstDraft && draft.title) await rename(project.id, draft.title);
        setUndoable(isFirstDraft ? null : previous);
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
    [rename, updateConfig, writing],
  );

  const undo = useCallback(() => {
    if (!undoable) return;
    void updateConfig({ storyText: undoable });
    setUndoable(null);
  }, [undoable, updateConfig]);

  return { writing, undoable, write, undo };
}
