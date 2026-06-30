"use client";

import dynamic from "next/dynamic";

// The admin dashboard is a client-only app (live Firestore config, uploads).
// It will keep growing, so it lives on its own route rather than in a modal.
const AdminApp = dynamic(() => import("@/ui/admin/AdminApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-ink-400">
      Loading admin…
    </div>
  ),
});

export default function AdminPage() {
  return <AdminApp />;
}
