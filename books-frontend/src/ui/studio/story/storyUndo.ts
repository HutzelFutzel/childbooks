import type { BookConfig, Project, StoryBrief } from "../../../core/types";
import type { BookLanguageId } from "../../../core/config/bookLanguages";

/** The complete authoring state restored by Story undo/redo. */
export interface StorySnapshot {
  title: string;
  storyText: string;
  storyBrief: StoryBrief | undefined;
  contentLocale: BookLanguageId | undefined;
  ageRangeId: string;
  readingModeId: BookConfig["readingModeId"];
}

export type StorySnapshotPatch = Partial<StorySnapshot>;

export interface StoryHistoryOptions {
  /** Merge consecutive edits with the same key into one undo step. */
  coalesce?: string;
  /** Used for hydration/defaults which were not explicit user actions. */
  skipHistory?: boolean;
}

export function takeStorySnapshot(project: Project): StorySnapshot {
  return {
    title: project.title,
    storyText: project.config.storyText,
    storyBrief: project.config.storyBrief
      ? structuredClone(project.config.storyBrief)
      : undefined,
    contentLocale: project.config.contentLocale,
    ageRangeId: project.config.ageRangeId,
    readingModeId: project.config.readingModeId,
  };
}

export function patchStorySnapshot(
  snapshot: StorySnapshot,
  patch: StorySnapshotPatch,
): StorySnapshot {
  return {
    ...snapshot,
    ...patch,
    storyBrief:
      "storyBrief" in patch && patch.storyBrief
        ? structuredClone(patch.storyBrief)
        : patch.storyBrief === undefined && "storyBrief" in patch
          ? undefined
          : snapshot.storyBrief,
  };
}

export function storySnapshotsEqual(a: StorySnapshot, b: StorySnapshot): boolean {
  return (
    a.title === b.title &&
    a.storyText === b.storyText &&
    a.contentLocale === b.contentLocale &&
    a.ageRangeId === b.ageRangeId &&
    a.readingModeId === b.readingModeId &&
    JSON.stringify(a.storyBrief) === JSON.stringify(b.storyBrief)
  );
}
