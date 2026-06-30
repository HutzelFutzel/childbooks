"use client";

import dynamic from "next/dynamic";

// The studio is a heavy interactive client app (Konva canvas, drag/resize,
// local persistence). Mount it client-only so it never runs during SSR.
const StudioApp = dynamic(() => import("./StudioApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-ink-400">
      Loading studio…
    </div>
  ),
});

export default function StudioPage() {
  return <StudioApp />;
}
