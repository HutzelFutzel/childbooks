"use client";

/**
 * Shared access-gating helpers for the admin dashboard — used by `AdminApp.tsx`
 * (Configuration/Marketing/Communication/Legal) and `analysis/AnalysisTab.tsx`
 * (which owns its own tab-strip rendering, so it needs the same two pieces
 * rather than importing the page shell).
 */
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useAdminAccess } from "../../state/adminAccessStore";
import { ReadOnlyProvider } from "../components/ReadOnlyContext";
import type { PermissionKey } from "../../core/config/permissions";

/** Keep only the tabs a group's admin can at least read; drop empty groups. */
export function filterReadableTabs<T extends string>(
  prefix: string,
  tabs: T[],
  canRead: (key: PermissionKey) => boolean,
): T[] {
  return tabs.filter((t) => canRead(`${prefix}.${t}` as PermissionKey));
}

/**
 * Wraps one tab's content: shows a friendly "no access" card instead of the
 * real panel when the caller can't even read `permissionKey`, and otherwise
 * renders children inside a `ReadOnlyProvider` set from write access — the one
 * place every tab gets both halves of the access model for free, without each
 * tab component knowing permissions exist.
 */
export function SectionGate({
  permissionKey,
  children,
}: {
  permissionKey: PermissionKey;
  children: ReactNode;
}) {
  const canRead = useAdminAccess((s) => s.canRead);
  const canWrite = useAdminAccess((s) => s.canWrite);
  if (!canRead(permissionKey)) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-white px-6 py-16 text-center ring-1 ring-ink-100">
        <Lock className="size-6 text-ink-300" />
        <p className="text-sm font-medium text-ink-700">You don't have access to this section.</p>
        <p className="text-xs text-ink-400">Ask an owner to grant it from Permissions.</p>
      </div>
    );
  }
  return <ReadOnlyProvider readOnly={!canWrite(permissionKey)}>{children}</ReadOnlyProvider>;
}
