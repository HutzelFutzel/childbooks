/**
 * Pages whose redraw the chat is about to offer or start.
 *
 * A change that puts somebody on a page makes the picture "out of date" the
 * moment it is saved, a beat before the redraw is quoted and started. Without
 * this, the page's own "Redraw" card flashes up and then becomes pointless, or
 * sits beside the chat's priced card as a second button for the same thing.
 * Anything that offers a redraw for a stale page skips the pages held here.
 */
import { create } from "zustand";

/** A hold that never gets released (a turn that failed halfway) lets go by itself. */
const HOLD_MAX_MS = 30_000;

interface RedrawHoldState {
  units: readonly string[];
  hold: (unitIds: readonly string[]) => void;
  release: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useRedrawHold = create<RedrawHoldState>((set) => ({
  units: [],
  hold: (unitIds) => {
    if (timer) clearTimeout(timer);
    set({ units: [...unitIds] });
    timer = setTimeout(() => set({ units: [] }), HOLD_MAX_MS);
  },
  release: () => {
    if (timer) clearTimeout(timer);
    timer = null;
    set((state) => (state.units.length === 0 ? state : { units: [] }));
  },
}));
