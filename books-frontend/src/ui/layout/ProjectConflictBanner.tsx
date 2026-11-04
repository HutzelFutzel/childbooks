"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useProjectsStore, type SaveFailureReason } from "@/state/projectsStore";
import { Button } from "@/ui/components/Button";

/**
 * Shown when the open book's local copy is stale — a save was rejected because
 * another tab or device advanced the stored version. Rather than silently
 * clobbering (or trying to merge) the newer state, we freeze auto-save for this
 * project and ask the user to reload the latest. Reloading discards this tab's
 * unsaved edits, which is the safe, predictable choice for a single-user tool.
 */
export function ProjectConflictBanner() {
  const staleId = useProjectsStore((s) => s.staleProjectId);
  const reloadProject = useProjectsStore((s) => s.reloadProject);
  const [reloading, setReloading] = useState(false);

  if (!staleId) return null;

  const onReload = async () => {
    setReloading(true);
    try {
      await reloadProject(staleId);
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        This book was changed in another tab or on another device. Reload to continue —
        unsaved changes made here will be discarded.
      </span>
      <Button size="sm" loading={reloading} onClick={() => void onReload()}>
        Reload
      </Button>
    </div>
  );
}

const SAVE_FAILURE_COPY: Record<SaveFailureReason, string> = {
  transient:
    "Your latest changes couldn't be saved — check your connection. We'll keep retrying; don't close this tab yet.",
  tooLarge:
    "This book has grown too large to save, so your latest changes are only in this tab. Keep it open and contact us — we'll help you save it.",
  rejected:
    "Your latest changes couldn't be saved, and retrying won't help. Keep this tab open and contact us — we'll help you save them.",
};

/**
 * Shown when the open book's latest edits could NOT be saved. Edits stay in
 * memory; a transient failure is retried automatically, the others wait for a
 * manual retry or the next edit. The conflict banner takes precedence (a
 * conflicted project is frozen from saving entirely).
 */
export function SaveFailureBanner() {
  const failedId = useProjectsStore((s) => s.saveFailedProjectId);
  const reason = useProjectsStore((s) => s.saveFailureReason) ?? "transient";
  const staleId = useProjectsStore((s) => s.staleProjectId);
  const retrySave = useProjectsStore((s) => s.retrySave);
  const [retrying, setRetrying] = useState(false);

  if (!failedId || staleId) return null;

  const onRetry = async () => {
    setRetrying(true);
    try {
      await retrySave(failedId);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        {SAVE_FAILURE_COPY[reason]}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {reason !== "transient" && (
          <Link href="/contact" target="_blank" className="font-medium underline">
            Contact us
          </Link>
        )}
        <Button size="sm" loading={retrying} onClick={() => void onRetry()}>
          Retry now
        </Button>
      </span>
    </div>
  );
}
