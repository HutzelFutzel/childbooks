import { create } from "zustand";
import type { StoryMark } from "../core/story/storyMark";

/**
 * The passage of the story the reader has marked right now.
 *
 * Its own store, not part of the chat's: the manuscript sets it and the chat
 * reads it, and the chat imports the skill layer that would otherwise have to
 * import the chat back. It holds the latest mark only; a message never reads it
 * while it runs. `takeMark` hands the mark to the message being sent and clears
 * it in the same step, so what a request acted on is fixed at the moment of
 * sending and a mark made afterwards belongs to the next message.
 */
export const useStoryMark = create<{
  mark: StoryMark | null;
  setMark: (mark: StoryMark | null) => void;
}>((set) => ({
  mark: null,
  setMark: (mark) => set({ mark }),
}));

/** The current mark, cleared: for the message that is being sent now. */
export function takeMark(): StoryMark | null {
  const { mark, setMark } = useStoryMark.getState();
  if (mark) setMark(null);
  return mark;
}
