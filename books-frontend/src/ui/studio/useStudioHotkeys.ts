/**
 * Global keyboard shortcuts for the Studio. Mounted once inside the provider.
 * Operates on the current selection: delete, duplicate, copy/cut/paste
 * (in place — see `StudioContext.pasteSelection`), nudge with arrows, z-order,
 * undo/redo and escape-to-deselect. Ignores events while typing in
 * inputs/textareas.
 */
import { useEffect, useRef } from "react";
import { useStudio } from "./StudioContext";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function useStudioHotkeys() {
  const studio = useStudio();
  const studioRef = useRef(studio);
  studioRef.current = studio;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = studioRef.current;
      const sel = s.selection;
      const hasEl = sel.kind === "box" || sel.kind === "shape" || sel.kind === "image";
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Design undo/redo always wins — including inside inputs / contentEditable
      // (inline text editing handles ⌘Z itself and stopPropagation's first).
      if (mod && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) s.redo();
        else s.undo();
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (mod) {
        switch (key) {
          case "c":
            if (hasEl) {
              e.preventDefault();
              s.copySelection();
            }
            return;
          case "x":
            if (hasEl) {
              e.preventDefault();
              s.cutSelection();
            }
            return;
          case "v":
            e.preventDefault();
            s.pasteSelection();
            return;
          case "d":
            if (hasEl) {
              e.preventDefault();
              s.duplicateSelected();
            }
            return;
          case "]":
            if (hasEl) {
              e.preventDefault();
              s.reorderSelected(1);
            }
            return;
          case "[":
            if (hasEl) {
              e.preventDefault();
              s.reorderSelected(-1);
            }
            return;
          default:
            return;
        }
      }

      if (e.key === "Escape") {
        if (s.selection.kind !== "none") s.select({ kind: "none" });
        return;
      }

      if (!hasEl) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        s.deleteSelected();
        return;
      }

      if (e.key === "]" || e.key === "[") {
        e.preventDefault();
        s.reorderSelected(e.key === "]" ? 1 : -1);
        return;
      }

      const step = e.shiftKey ? 0.02 : 0.005;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      s.nudgeSelected(dx, dy);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
