/**
 * The user's image quality tier ("Fast" vs "High-Quality"), sourced from their
 * profile preferences. The choice is deliberately `null` until the user picks
 * one, so the studio can prompt a one-time selection on the first generation.
 *
 * These accessors are the single source of truth the UI and generation paths
 * read from; the server always re-resolves the concrete model from the tier, so
 * this is only a hint for stamping requests and showing the right cost.
 */
import { DEFAULT_IMAGE_TIER, type ImageTier } from "../core/config/modelConfig";
import { useProfileStore } from "./profileStore";

/** The user's chosen default tier, or null when they haven't picked one yet. */
export function preferredImageTier(): ImageTier | null {
  return useProfileStore.getState().profile?.preferences?.imageTier ?? null;
}

/** The tier to actually generate with (falls back to the "quick" tier). */
export function effectiveImageTier(): ImageTier {
  return preferredImageTier() ?? DEFAULT_IMAGE_TIER;
}

/** Persist the user's default tier choice to their profile. */
export async function setPreferredImageTier(tier: ImageTier): Promise<void> {
  await useProfileStore.getState().updateProfile({ preferences: { imageTier: tier } });
}

/** Reactive hook: the preferred tier, or null when the user hasn't chosen. */
export function usePreferredImageTier(): ImageTier | null {
  return useProfileStore((s) => s.profile?.preferences?.imageTier ?? null);
}
