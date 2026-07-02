import { create } from "zustand";

/**
 * Client-only "edit this page" mode for the marketing landing page.
 *
 * Toggled by {@link AdminEditBar}, which only renders for a signed-in admin. When
 * enabled, {@link EditableImage} and {@link EditableText} expose their inline
 * drag-&-drop / contentEditable affordances. The flag is intentionally NOT
 * persisted — it resets on reload so the public page is always the default.
 */
interface EditModeState {
  /** True while the admin is actively editing the landing page. */
  enabled: boolean;
  /** True once we've confirmed the current user is an admin (edit is available). */
  admin: boolean;
  setEnabled: (v: boolean) => void;
  setAdmin: (v: boolean) => void;
  toggle: () => void;
}

export const useEditMode = create<EditModeState>((set) => ({
  enabled: false,
  admin: false,
  setEnabled: (enabled) => set({ enabled }),
  setAdmin: (admin) => set({ admin }),
  toggle: () => set((s) => ({ enabled: !s.enabled })),
}));
