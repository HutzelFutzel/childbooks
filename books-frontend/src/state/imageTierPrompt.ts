/**
 * The gate that forces the user to pick an image quality tier ("Fast" vs
 * "High-Quality") before anything is generated. Generation entry points call
 * {@link requireImageTier}; when no tier has been chosen it opens the selection
 * prompt and returns null so the caller aborts. Once the user picks, the choice
 * is saved to their profile and every later generation proceeds without asking.
 *
 * There is deliberately NO fallback tier. Rendering on a tier the user never
 * chose spends their Sparks on a quality decision they didn't make — so when we
 * don't know, we ask, for guests and full accounts alike.
 */
import { create } from "zustand";
import type { ImageTier } from "../core/config/modelConfig";
import { preferredImageTier } from "./imageTier";
import { useAuthStore, whenAuthReady } from "./authStore";
import { whenProfileLoaded } from "./profileStore";

interface ImageTierPromptState {
  open: boolean;
  requestSelection: () => void;
  select: (tier: ImageTier) => void;
  close: () => void;
}

let pendingSelection: ((tier: ImageTier | null) => void) | null = null;

export const useImageTierPromptStore = create<ImageTierPromptState>((set) => ({
  open: false,
  requestSelection: () => set({ open: true }),
  select: (tier) => {
    pendingSelection?.(tier);
    pendingSelection = null;
    set({ open: false });
  },
  close: () => {
    pendingSelection?.(null);
    pendingSelection = null;
    set({ open: false });
  },
}));

/**
 * Return the user's chosen tier, or null when they haven't picked one yet —
 * opening the selection prompt as a side effect. Callers must abort when this
 * returns null so nothing is generated until a tier is explicitly selected.
 *
 * Awaits auth + the profile snapshot first: a saved choice that simply hasn't
 * arrived yet must not read as "never chose", or every reload would re-prompt.
 */
export async function requireImageTier(): Promise<ImageTier | null> {
  await whenAuthReady();
  const accessLevel = useAuthStore.getState().accessLevel;
  // No identity resolved — generation would be rejected by the backend anyway,
  // and there's nowhere to record a choice. Don't prompt into the void.
  if (accessLevel === "loading") return null;

  await whenProfileLoaded();
  const tier = preferredImageTier();

  // Guests render on the guest tier only (the server downgrades them). A saved
  // premium preference can't be honored here, so ask rather than quietly
  // charging for one tier and delivering another.
  if (!tier || (accessLevel === "guest" && tier === "premium")) {
    return new Promise<ImageTier | null>((resolve) => {
      pendingSelection?.(null);
      pendingSelection = resolve;
      useImageTierPromptStore.getState().requestSelection();
    });
  }
  return tier;
}
