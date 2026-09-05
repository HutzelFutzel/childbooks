"use client";

import dynamic from "next/dynamic";

const AdminApp = dynamic(() => import("@/ui/admin/AdminApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-ink-400">
      Loading admin…
    </div>
  ),
});

export default function AdminDeepLinkPage() {
  return <AdminApp />;
}
