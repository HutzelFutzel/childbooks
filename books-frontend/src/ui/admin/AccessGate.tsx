"use client";

/**
 * Shared access-gating helpers for the admin dashboard — used by `AdminApp.tsx`
 * (Configuration/Marketing/Communication/Legal) and `analysis/AnalysisTab.tsx`
 * (which owns its own tab-strip rendering, so it needs the same two pieces
 * rather than importing the page shell).
 */
import { Loader2, Lock, RotateCw, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useAdminAccess } from "../../state/adminAccessStore";
import { Button } from "../components/Button";
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
 * Shown instead of the dashboard while `/admin/permissions/me` is in flight or
 * has failed. Rendering the gated shell before that fetch lands is what made a
 * T1 owner look grantless: `canRead` is false while `me` is null, so every
 * inner tab vanished and every panel showed "ask an owner".
 */
export function AccessLoadState({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  if (!error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-7 animate-spin text-brand-400" />
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
        <ShieldAlert className="size-6" />
      </span>
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Couldn't load your admin access</h2>
        <p className="mt-1 max-w-sm text-sm text-ink-500">{error}</p>
      </div>
      <Button variant="secondary" size="sm" leftIcon={<RotateCw className="size-4" />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
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
  const loaded = useAdminAccess((s) => s.loaded);
  const error = useAdminAccess((s) => s.error);
  const reload = useAdminAccess((s) => s.reload);
  const canRead = useAdminAccess((s) => s.canRead);
  const canWrite = useAdminAccess((s) => s.canWrite);
  if (!loaded) {
    return (
      <div className="flex min-h-48 flex-1 items-center justify-center">
        <AccessLoadState error={error} onRetry={() => void reload()} />
      </div>
    );
  }
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
