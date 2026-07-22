/**
 * Keyboard-accessibility behavior shared by the Modal and Drawer dialogs:
 *
 *   - INITIAL FOCUS: when the dialog opens, focus moves to its first focusable
 *     element (or the panel itself as a fallback), so keyboard/screen-reader
 *     users land inside the dialog instead of the page behind it.
 *   - FOCUS TRAP: Tab / Shift+Tab wrap within the dialog while it's open.
 *   - FOCUS RESTORE: when the dialog closes, focus returns to the element that
 *     had it before opening (usually the button that opened it).
 *
 * Attach the returned ref to the dialog panel element (which must have
 * `tabIndex={-1}` so the fallback focus works).
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useDialogFocus<T extends HTMLElement>(open: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    if (!panel) return;
    const opener = document.activeElement as HTMLElement | null;

    // Initial focus — deferred a frame so it wins over the open animation.
    const raf = requestAnimationFrame(() => {
      if (panel.contains(document.activeElement)) return; // e.g. autoFocus input
      (focusables(panel)[0] ?? panel).focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        // Focus escaped (portal edge case) — pull it back in.
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus to the opener (if it's still in the document).
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  return ref;
}
