"use client";

import dynamic from "next/dynamic";

const AccountApp = dynamic(() => import("@/ui/account/AccountApp"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center text-ink-400">
      Loading account…
    </div>
  ),
});

export default function AccountSectionPage() {
  return <AccountApp />;
}
