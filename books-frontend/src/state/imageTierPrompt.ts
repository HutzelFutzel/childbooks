/**
 * A one-time gate that forces the user to pick an image quality tier ("Fast" vs
 * "High-Quality") before anything is generated. Generation entry points call
 * {@link requireImageTier}; when no tier has been chosen it opens the selection
 * prompt and returns null so the caller aborts. Once the user picks, generation
 * proceeds normally on every subsequent action.
 */
import { create } from "zustand";
import { DEFAULT_IMAGE_TIER, type ImageTier } from "../core/config/modelConfig";
import { preferredImageTier } from "./imageTier";
import { useAuthStore } from "./authStore";

interface ImageTierPromptState {
  open: boolean;
  requestSelection: () => void;
  close: () => void;
}

export const useImageTierPromptStore = create<ImageTierPromptState>((set) => ({
  open: false,
  requestSelection: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/**
 * Return the user's chosen tier, or null when they haven't picked one yet —
 * opening the selection prompt as a side effect. Callers must abort when this
 * returns null so nothing is generated until a tier is explicitly selected.
 */
export function requireImageTier(): ImageTier | null {
  // Guests always render on the cheap tier (the server enforces this anyway),
  // and they have no profile to persist a choice to — skip the prompt.
  if (useAuthStore.getState().accessLevel !== "full") return DEFAULT_IMAGE_TIER;
  const tier = preferredImageTier();
  if (!tier) {
    useImageTierPromptStore.getState().requestSelection();
    return null;
  }
  return tier;
}
