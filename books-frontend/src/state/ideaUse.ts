"use client";

/**
 * What this reader has already tried from the suggestions, kept on this device.
 *
 * `used` counts taps per idea, so the chips favour ideas they haven't met.
 * `dismissed` holds offers they set aside for one text of one book (see
 * `offerKey`). Neither is part of a book: losing them only means suggestions
 * come back in their first order.
 */
import { create } from "zustand";

const KEY = "guide:ideas";
const MAX_DISMISSED = 60;

interface Stored {
  used: Record<string, number>;
  dismissed: string[];
}

function load(): Stored {
  const empty: Stored = { used: {}, dismissed: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<Stored> | null;
    if (!raw || typeof raw !== "object") return empty;
    const used: Record<string, number> = {};
    for (const [id, count] of Object.entries(raw.used ?? {})) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) used[id] = Math.min(count, 1000);
    }
    const dismissed = Array.isArray(raw.dismissed)
      ? raw.dismissed.filter((key): key is string => typeof key === "string").slice(-MAX_DISMISSED)
      : [];
    return { used, dismissed };
  } catch {
    return empty;
  }
}

function save({ used, dismissed }: Stored): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ used, dismissed }));
  } catch {
    // Storage full or blocked: suggestions simply aren't remembered.
  }
}

interface IdeaUseState extends Stored {
  use: (id: string) => void;
  dismiss: (key: string) => void;
}

export const useIdeaUse = create<IdeaUseState>((set, get) => ({
  ...load(),
  use: (id) => {
    const used = { ...get().used, [id]: (get().used[id] ?? 0) + 1 };
    set({ used });
    save({ used, dismissed: get().dismissed });
  },
  dismiss: (key) => {
    if (get().dismissed.includes(key)) return;
    const dismissed = [...get().dismissed, key].slice(-MAX_DISMISSED);
    set({ dismissed });
    save({ used: get().used, dismissed });
  },
}));
