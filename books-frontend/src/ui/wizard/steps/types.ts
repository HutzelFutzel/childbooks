/** @legacy guide-v2 L4 — deleted with the wizard. See docs/LEGACY-GUIDE.md. */
import type { BookConfig } from "../../../core/types";
import type { StoryHistoryOptions } from "../../studio/story/storyUndo";

export interface StepProps {
  config: BookConfig;
  update: (
    patch: Partial<BookConfig>,
    options?: StoryHistoryOptions,
  ) => void;
  storyToolsOpen?: boolean;
  onStoryToolsOpenChange?: (open: boolean) => void;
}
