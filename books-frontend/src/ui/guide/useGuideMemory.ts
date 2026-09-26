"use client";

/**
 * What survives a refresh on this device: the unsent draft, the view the
 * reader chose and the thing in the composer chip. Everything else comes back
 * from the book and its jobs.
 */
import { useCallback, useEffect, useState } from "react";
import type { BookViewId } from "../../core/guide/journey";
import type { GuideTarget } from "../../core/guide/target";
import { useChatStudio } from "../../state/chatStudio";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null || value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the draft simply isn't kept.
  }
}

export function useGuideMemory(projectId: string): { draft: string; setDraft: (value: string) => void } {
  const draftKey = `guide:draft:${projectId}`;
  const uiKey = `guide:ui:${projectId}`;
  const [draft, setDraftState] = useState(() => read(draftKey) ?? "");

  const setDraft = useCallback(
    (value: string) => {
      setDraftState(value);
      write(draftKey, value);
    },
    [draftKey],
  );

  useEffect(() => {
    // Opening a book resets the view and chip, so restore only once it has loaded.
    let restored = false;
    const restore = () => {
      restored = true;
      const saved = read(uiKey);
      if (!saved) return;
      try {
        const { view, chip } = JSON.parse(saved) as { view?: BookViewId | null; chip?: GuideTarget | null };
        const store = useChatStudio.getState();
        if (view) store.setView(view);
        if (chip) store.setChip(chip);
      } catch {
        write(uiKey, null);
      }
    };
    const initial = useChatStudio.getState();
    if (initial.loaded && initial.projectId === projectId) restore();
    return useChatStudio.subscribe((state, prev) => {
      if (state.projectId !== projectId) return;
      if (!restored) {
        if (state.loaded) restore();
        return;
      }
      if (state.view === prev.view && state.chip === prev.chip) return;
      write(uiKey, state.view || state.chip ? JSON.stringify({ view: state.view, chip: state.chip }) : null);
    });
  }, [uiKey, projectId]);

  return { draft, setDraft };
}
