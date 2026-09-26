/**
 * Docked inspector chrome (illustration sheets + Arrange / Setup tools).
 * Kept out of StudioContext so opening a panel doesn't re-render the Konva stage.
 */
import { create } from "zustand";
import type { ImageEditSection } from "../design/ImageEditPanel";

/** Docked tools opened from the page toolbar (mutually exclusive). */
export type StudioToolPanel = "layers" | "setup";

type ImageEditCloseGuard = ((proceed: () => void) => boolean) | null;

type StudioPanelState = {
  imageEditSection: ImageEditSection | null;
  toolPanel: StudioToolPanel | null;
  imageEditCloseGuard: ImageEditCloseGuard;
  /**
   * Set while the Chat studio mounts the page canvas. The composer is then the
   * only natural-language input, so the canvas's own instruction field stays shut.
   */
  instructionsOff: boolean;
  setInstructionsOff: (off: boolean) => void;

  openImageEdit: (section: ImageEditSection) => void;
  toggleImageEdit: (section: ImageEditSection) => void;
  closeImageEdit: () => void;
  setImageEditCloseGuard: (guard: ImageEditCloseGuard) => void;

  openToolPanel: (panel: StudioToolPanel) => void;
  closeToolPanel: () => void;
  toggleToolPanel: (panel: StudioToolPanel) => void;
  openLayersPanel: () => void;

  /** Clear illustration sheets when selection leaves that element kind. */
  onSelectionKind: (kind: "box" | "image" | "shape" | "other") => void;
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
  imageEditSection: null,
  toolPanel: null,
  imageEditCloseGuard: null,
  instructionsOff: false,
  setInstructionsOff: (off) => set({ instructionsOff: off }),

  openImageEdit: (section) => {
    if (get().instructionsOff && section === "refine") return;
    if (get().imageEditSection === section) return;
    runGuard(get().imageEditCloseGuard, () =>
      set({ imageEditSection: section, toolPanel: null }),
    );
  },
  toggleImageEdit: (section) => {
    if (get().instructionsOff && section === "refine") return;
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
      set({
        toolPanel: panel,
        imageEditSection: null,
      }),
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
    if (kind !== "image") set({ imageEditSection: null });
  },
  reset: () =>
    set({
      imageEditSection: null,
      toolPanel: null,
      imageEditCloseGuard: null,
    }),
}));
