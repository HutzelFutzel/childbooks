"use client";

import { useEffect } from "react";

/**
 * Browsers treat a wheel gesture over a focused `<input type="number">` as a
 * request to increment/decrement its value. That is especially dangerous in
 * long admin forms: an ordinary page scroll can silently edit pricing, limits,
 * or percentages.
 *
 * Blur before the browser performs its default wheel action. The wheel event
 * remains un-cancelled, so the surrounding page or panel still scrolls.
 * Registered on `document` to cover native inputs as well as the shared Input
 * component, including fields rendered later in dialogs.
 */
export function NumberInputWheelGuard() {
  useEffect(() => {
    const blurFocusedNumberInput = (event: WheelEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        target.type === "number" &&
        document.activeElement === target
      ) {
        target.blur();
      }
    };

    document.addEventListener("wheel", blurFocusedNumberInput, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("wheel", blurFocusedNumberInput, {
        capture: true,
      });
    };
  }, []);

  return null;
}
