import { Loader2 } from "lucide-react";

export default function RootLoading() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas text-ink-500"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-7 animate-spin text-brand-500" />
      <p className="text-sm font-medium">Loading…</p>
    </div>
  );
}
