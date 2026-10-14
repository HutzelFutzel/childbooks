"use client";

import dynamic from "next/dynamic";

const AccountApp = dynamic(() => import("@/ui/account/AccountApp"), {
  ssr: false,
  loading: () => (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas text-ink-500"
      role="status"
      aria-live="polite"
    >
      <div className="size-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
      <p className="text-sm font-medium">Loading your account…</p>
    </div>
  ),
});

export default function AccountSectionPage() {
  return <AccountApp />;
}
