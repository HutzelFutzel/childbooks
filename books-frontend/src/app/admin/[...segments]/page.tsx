"use client";

import dynamic from "next/dynamic";

const AdminApp = dynamic(() => import("@/ui/admin/AdminApp"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-screen flex-col items-center justify-center gap-3 bg-canvas text-ink-500"
      role="status"
      aria-live="polite"
    >
      <div className="size-7 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
      <p className="text-sm font-medium">Loading admin dashboard…</p>
    </div>
  ),
});

export default function AdminDeepLinkPage() {
  return <AdminApp />;
}
