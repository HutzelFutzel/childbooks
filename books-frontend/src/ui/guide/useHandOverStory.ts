"use client";

/**
 * "My story is ready", from the chat card or from under the manuscript: one
 * tap in the conversation, so both read the same in the transcript.
 */
import { useCallback } from "react";
import { useChatStudio } from "../../state/chatStudio";
import { useGuideLabel } from "./intl";

export function useHandOverStory(): () => void {
  const tap = useChatStudio((s) => s.tap);
  const finish = useChatStudio((s) => s.finishManuscript);
  const label = useGuideLabel();
  return useCallback(() => {
    void tap(label("storyIsReady"), finish, { reply: [{ key: "storyHandedOver", priority: "result" }] });
  }, [tap, finish, label]);
}
