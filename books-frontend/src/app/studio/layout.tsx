"use client";

import dynamic from "next/dynamic";

// Keep one client-only studio shell mounted while the URL moves between books
// and workflow steps. The editor owns rich transient state (undo, selection,
// in-flight generation) that must not be recreated for every route segment.
const StudioApp = dynamic(() => import("./StudioApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-ink-400">
      Loading studio…
    </div>
  ),
});

export default function StudioLayout() {
  return <StudioApp />;
}
