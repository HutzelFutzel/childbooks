"use client";

/**
 * One loading vocabulary for the whole admin dashboard, so every screen tells
 * the user "something is happening" the same way:
 *
 *  - {@link AdminProgressBar}     thin bar across the top while ANYTHING is loading
 *  - {@link useAdminBusy}         register a piece of loading work with that bar
 *  - {@link LoadingState}         centred spinner + label for a whole panel
 *  - {@link PanelSkeleton}        grey-block placeholder shaped like a page
 *  - {@link InlineError}          a failed load with a Retry
 *  - {@link useDelayedFlag}       only show a spinner once a wait is noticeable
 */
import { useEffect, useId, useState } from "react";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { create } from "zustand";
import { cn } from "../lib/cn";
import { Skeleton } from "../components/Skeleton";

/** Waits shorter than this finish before a spinner would be useful — showing one just flickers. */
const NOTICEABLE_MS = 150;

/**
 * `true` only once `active` has stayed true for `delayMs`. Fast loads never
 * flash a spinner; slow ones get feedback.
 */
export function useDelayedFlag(active: boolean, delayMs = NOTICEABLE_MS): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delayMs]);
  return active && elapsed;
}

// ---- Top progress bar ---------------------------------------------------------

interface AdminBusyState {
  /** Ids of the loads currently in flight; the bar is visible while any exist. */
  ids: string[];
  begin: (id: string) => void;
  end: (id: string) => void;
}

const useAdminBusyStore = create<AdminBusyState>((set) => ({
  ids: [],
  begin: (id) => set((s) => (s.ids.includes(id) ? s : { ids: [...s.ids, id] })),
  end: (id) => set((s) => (s.ids.includes(id) ? { ids: s.ids.filter((x) => x !== id) } : s)),
}));

/** Count this component as "loading" (drives the top progress bar) while `active` is true. */
export function useAdminBusy(active: boolean): void {
  const id = useId();
  const begin = useAdminBusyStore((s) => s.begin);
  const end = useAdminBusyStore((s) => s.end);
  useEffect(() => {
    if (!active) return;
    begin(id);
    return () => end(id);
  }, [active, begin, end, id]);
}

/**
 * The indeterminate bar pinned to the top of the viewport. Appears only after a
 * short delay so instant navigations don't blink it.
 */
export function AdminProgressBar() {
  const busy = useAdminBusyStore((s) => s.ids.length > 0);
  const visible = useDelayedFlag(busy, 120);
  if (!visible) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-busy="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden bg-brand-100"
    >
      <div className="admin-progress-bar h-full rounded-full bg-brand-500" />
    </div>
  );
}

// ---- Panel states ---------------------------------------------------------------

/** A centred spinner with a label. Use for a whole panel or page area. */
export function LoadingState({
  label = "Loading…",
  className,
  /** Show immediately (a full-screen step) instead of waiting out {@link NOTICEABLE_MS}. */
  immediate = false,
}: {
  label?: string;
  className?: string;
  immediate?: boolean;
}) {
  const noticeable = useDelayedFlag(true, NOTICEABLE_MS);
  return (
    <div
      className={cn("flex min-h-64 flex-col items-center justify-center gap-3 py-16 text-ink-500", className)}
      role="status"
      aria-live="polite"
    >
      {(immediate || noticeable) && (
        <>
          <Loader2 className="size-6 animate-spin text-brand-400" />
          <p className="text-sm font-medium">{label}</p>
        </>
      )}
    </div>
  );
}

/** Placeholder shaped like an admin page (a few cards) while its data arrives. */
export function PanelSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-4", className)} role="status" aria-busy="true" aria-label="Loading">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  );
}

/** A failed load, said plainly, with a way to try again. */
export function InlineError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span className="truncate">{message}</span>
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          <RotateCw className="size-3" />
          Retry
        </button>
      )}
    </div>
  );
}
