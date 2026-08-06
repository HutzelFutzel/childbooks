/**
 * Docked inspector chrome (illustration / text edit sheets + Add-dock tools).
 * Kept out of StudioContext so opening a panel doesn't re-render the Konva stage.
 */
import { create } from "zustand";
import type { ImageEditSection } from "../design/ImageEditPanel";
import type { TextEditSection } from "../design/TextEditPanel";

/** Docked tools opened from the Add dock (mutually exclusive). */
export type StudioToolPanel = "layers" | "view" | "setup";

type ImageEditCloseGuard = ((proceed: () => void) => boolean) | null;

type StudioPanelState = {
  textEditSection: TextEditSection | null;
  imageEditSection: ImageEditSection | null;
  toolPanel: StudioToolPanel | null;
  imageEditCloseGuard: ImageEditCloseGuard;

  openTextEdit: (section: TextEditSection) => void;
  toggleTextEdit: (section: TextEditSection) => void;
  closeTextEdit: () => void;

  openImageEdit: (section: ImageEditSection) => void;
  toggleImageEdit: (section: ImageEditSection) => void;
  closeImageEdit: () => void;
  setImageEditCloseGuard: (guard: ImageEditCloseGuard) => void;

  openToolPanel: (panel: StudioToolPanel) => void;
  closeToolPanel: () => void;
  toggleToolPanel: (panel: StudioToolPanel) => void;
  openLayersPanel: () => void;

  /** Clear edit sheets when selection leaves that element kind. */
  onSelectionKind: (kind: "box" | "image" | "other") => void;
  /** Reset all dock chrome (e.g. leaving Design). */
  reset: () => void;
};

function runGuard(guard: ImageEditCloseGuard, action: () => void): void {
  if (!guard) {
    action();
    return;
  }
  const ok = guard(action);
  if (ok) action();
}

export const useStudioPanelStore = create<StudioPanelState>((set, get) => ({
  textEditSection: null,
  imageEditSection: null,
  toolPanel: null,
  imageEditCloseGuard: null,

  openTextEdit: (section) =>
    set({ textEditSection: section, imageEditSection: null, toolPanel: null }),
  toggleTextEdit: (section) => {
    const cur = get().textEditSection;
    if (cur === section) set({ textEditSection: null });
    else set({ textEditSection: section, imageEditSection: null, toolPanel: null });
  },
  closeTextEdit: () => set({ textEditSection: null }),

  openImageEdit: (section) => {
    if (get().imageEditSection === section) return;
    runGuard(get().imageEditCloseGuard, () =>
      set({ imageEditSection: section, textEditSection: null, toolPanel: null }),
    );
  },
  toggleImageEdit: (section) => {
    if (get().imageEditSection === section) {
      get().closeImageEdit();
      return;
    }
    get().openImageEdit(section);
  },
  closeImageEdit: () => {
    runGuard(get().imageEditCloseGuard, () => set({ imageEditSection: null }));
  },
  setImageEditCloseGuard: (guard) => set({ imageEditCloseGuard: guard }),

  openToolPanel: (panel) => {
    runGuard(get().imageEditCloseGuard, () =>
      set({ toolPanel: panel, textEditSection: null, imageEditSection: null }),
    );
  },
  closeToolPanel: () => set({ toolPanel: null }),
  toggleToolPanel: (panel) => {
    if (get().toolPanel === panel) set({ toolPanel: null });
    else get().openToolPanel(panel);
  },
  openLayersPanel: () => get().openToolPanel("layers"),

  onSelectionKind: (kind) => {
    // Match prior StudioContext.select behaviour: clear sheets without the
    // dirty-cast guard when the selection simply moves away.
    if (kind !== "box") set({ textEditSection: null });
    if (kind !== "image") set({ imageEditSection: null });
  },
  reset: () =>
    set({
      textEditSection: null,
      imageEditSection: null,
      toolPanel: null,
      imageEditCloseGuard: null,
    }),
}));
