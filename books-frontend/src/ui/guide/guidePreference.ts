/**
 * An admin's own choice of flow, remembered across reloads.
 *
 * Unlike the landing page's `editMode` — which deliberately resets, so the public
 * page is always the default — this one persists. Authoring a book takes days,
 * and the flag has to survive every reload and every route change in between or
 * it cannot be evaluated at all. Route changes matter especially: the studio
 * rewrites its own path as the reader moves, so a `?guide=new` search param would
 * be dropped by the first navigation.
 *
 * It is a PREFERENCE, not permission. {@link resolveGuideMode} consults it only
 * for admins, and the rollout's `off` mode overrides it, so nothing here can put a
 * customer in the new flow — and a stale value in someone's browser cannot keep
 * them there after the rollout is reverted.
 */
import { create } from "zustand";
import type { GuideMode } from "../../core/guide/mode";

const STORAGE_KEY = "childbooks.guideMode";

function read(): GuideMode | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "guide" || stored === "legacy" ? stored : null;
  } catch {
    // Private mode / storage disabled: no preference, which resolves to the
    // rollout's answer.
    return null;
  }
}

function write(mode: GuideMode | null): void {
  if (typeof window === "undefined") return;
  try {
    if (mode) window.localStorage.setItem(STORAGE_KEY, mode);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal: the choice just won't outlive the tab.
  }
}

interface GuidePreferenceState {
  /** null = no stated preference; the rollout decides. */
  preference: GuideMode | null;
  /** True once the stored value has been read (see {@link hydrateGuidePreference}). */
  hydrated: boolean;
  set: (mode: GuideMode | null) => void;
}

export const useGuidePreference = create<GuidePreferenceState>((set) => ({
  // Starts empty on purpose: reading localStorage during module evaluation would
  // make the server and the first client render disagree.
  preference: null,
  hydrated: false,
  set: (preference) => {
    write(preference);
    set({ preference, hydrated: true });
  },
}));

/** Load the stored preference. Called once from the studio shell after mount. */
export function hydrateGuidePreference(): void {
  if (useGuidePreference.getState().hydrated) return;
  useGuidePreference.setState({ preference: read(), hydrated: true });
}
