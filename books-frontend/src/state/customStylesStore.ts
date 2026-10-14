/**
 * The reader's saved custom styles and the covers drawn in each look, live.
 *
 * Nothing starts until something on screen needs a preview: `useStylePreviews`
 * retains the subscription for as long as it is mounted, and the last one to
 * leave closes it.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import type { CustomArtStyle, StyleShowcase } from "../core/config/customArtStyles";
import { subscribeCustomStyles, subscribeStyleShowcase } from "../platform/customStyles";

interface CustomStylesState {
  styles: Record<string, CustomArtStyle>;
  showcase: Record<string, StyleShowcase>;
  /** Start listening for `uid`; returns the release. Calls nest, one listener per uid. */
  retain: (uid: string) => () => void;
}

let holders = 0;
let activeUid: string | null = null;
let stops: Unsubscribe[] = [];

function stopAll(): void {
  for (const stop of stops) stop();
  stops = [];
  activeUid = null;
}

export const useCustomStylesStore = create<CustomStylesState>((set) => ({
  styles: {},
  showcase: {},
  retain: (uid) => {
    if (activeUid !== uid) {
      stopAll();
      set({ styles: {}, showcase: {} });
      activeUid = uid;
      stops = [
        subscribeCustomStyles(uid, (list) =>
          set({ styles: Object.fromEntries(list.map((style) => [style.id, style])) }),
        ),
        subscribeStyleShowcase(uid, (showcase) => set({ showcase })),
      ];
    }
    holders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holders -= 1;
      if (holders <= 0) {
        holders = 0;
        stopAll();
      }
    };
  },
}));
