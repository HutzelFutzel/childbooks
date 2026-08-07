"use client";

/**
 * Read-only rendering for the admin dashboard.
 *
 * An admin with only READ access to a tab must see the exact same screen a
 * writer sees, minus the ability to change anything — not a disabled-looking
 * form, but the actual values as plain text, with every Save/destructive
 * button gone. Rather than retrofit ~30 tabs by hand, the shared form
 * primitives (`Input`, `Textarea`, `Select`, `Toggle` — all in this same
 * `ui/components/` folder, deliberately, so the admin dashboard can wrap them
 * without those primitives depending on anything admin-specific) consult
 * this context and render themselves as static text/labels when it's
 * active — so most tabs get the "read-only renders as values" requirement
 * for free just by being wrapped in a `<ReadOnlyProvider readOnly>` in
 * `AdminApp.tsx` / `AnalysisTab.tsx`.
 *
 * Save/duplicate/delete buttons are NOT covered by this (a generic `Button`
 * is used for navigation and refresh too, which must keep working read-only)
 * — those are gated per-tab with `useReadOnly()` directly; see the tabs that
 * import this hook for the pattern.
 */
import { createContext, useContext, type ReactNode } from "react";

const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}

/** True when the current tab is being rendered for a read-only admin. */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
