/**
 * What the reader has typed into a chat card but not saved yet.
 *
 * A card can be taken off the screen and put back (a reply arriving, a
 * remount, a different layout): what was typed into it must still be there.
 * So a draft lives here, keyed by book and field, never in the card's own
 * state. It is cleared when the card saves it or the reader cancels.
 */
import { useCallback } from "react";
import { create } from "zustand";
import { useProjectsStore } from "./projectsStore";

interface WellDrafts {
  drafts: Record<string, unknown>;
  put: (key: string, value: unknown) => void;
  drop: (key: string) => void;
}

export const useWellDrafts = create<WellDrafts>((set) => ({
  drafts: {},
  put: (key, value) => set((state) => ({ drafts: { ...state.drafts, [key]: value } })),
  drop: (key) =>
    set((state) => {
      if (!(key in state.drafts)) return state;
      const { [key]: _dropped, ...rest } = state.drafts;
      void _dropped;
      return { drafts: rest };
    }),
}));

export function draftKey(projectId: string | null, field: string): string {
  return `${projectId ?? "-"}:${field}`;
}

/** Whether anything typed into a card is still unsaved for this book. */
export function hasUnsavedDraft(projectId: string | null): boolean {
  const prefix = draftKey(projectId, "");
  return Object.keys(useWellDrafts.getState().drafts).some((key) => key.startsWith(prefix));
}

/**
 * A card field's draft: `[value, set, clear]`. `value` is `fallback` until the
 * reader types.
 */
export function useWellDraft<T>(field: string, fallback: T): [T, (value: T) => void, () => void] {
  const projectId = useProjectsStore((s) => s.currentId);
  const key = draftKey(projectId, field);
  const stored = useWellDrafts((s) => s.drafts[key]) as T | undefined;
  const put = useWellDrafts((s) => s.put);
  const drop = useWellDrafts((s) => s.drop);
  const setValue = useCallback((value: T) => put(key, value), [put, key]);
  const clear = useCallback(() => drop(key), [drop, key]);
  return [stored === undefined ? fallback : stored, setValue, clear];
}
