"use client";

import dynamic from "next/dynamic";

// Keep one client-only studio shell mounted while the URL moves between books
// and workflow steps. The editor owns rich transient state (undo, selection,
// in-flight generation) that must not be recreated for every route segment.
const StudioApp = dynamic(() => import("./StudioApp"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-screen flex-col items-center justify-center gap-3 bg-canvas text-ink-500"
      role="status"
      aria-live="polite"
    >
      <div className="size-7 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
      <p className="text-sm font-medium">Loading studio…</p>
    </div>
  ),
});

export default function StudioLayout() {
  return <StudioApp />;
}
