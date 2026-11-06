"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { saveFailureNote, type SaveFailureNote } from "@/core/storage/saveRecovery";
import { useAuthStore } from "@/state/authStore";
import { useProjectsStore } from "@/state/projectsStore";
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

const SAVE_FAILURE_COPY: Record<SaveFailureNote, string> = {
  transient:
    "Your latest changes couldn't be saved yet. Check your connection; we'll keep trying. A copy is kept on this device in case you need to reload.",
  stubborn:
    "Your changes still aren't saving, even though you're online. A browser extension, VPN or network may be blocking the connection. Try again, or contact us if it keeps happening. A copy is kept on this device.",
  signedOut:
    "You've been signed out, so your latest changes can't be saved. Sign in again and they will be saved. A copy is kept on this device.",
  tooLarge:
    "This book has grown too large to save, so your latest changes are only on this device. Download a copy and contact us; we'll help you save it.",
  rejected:
    "Your latest changes couldn't be saved, and trying again won't help. Download a copy and contact us; we'll help you save them.",
};

/** The book's own text and layout as a file. Pictures stay in the account; they aren't part of the book's data. */
function downloadBook(bookId: string): void {
  const book = useProjectsStore.getState().projects.find((p) => p.id === bookId);
  if (!book) return;
  const file = new Blob([JSON.stringify(book, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${book.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "book"}-backup.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Shown when the open book's latest edits could NOT be saved. A copy is kept on the device, and a
 * temporary failure is retried automatically (and at once when the connection or the tab comes
 * back); the others wait for the reader. The conflict banner takes precedence (a conflicted
 * project is frozen from saving entirely).
 */
export function SaveFailureBanner() {
  const failedId = useProjectsStore((s) => s.saveFailedProjectId);
  const reason = useProjectsStore((s) => s.saveFailureReason) ?? "transient";
  const attempts = useProjectsStore((s) => s.saveFailureAttempts);
  const staleId = useProjectsStore((s) => s.staleProjectId);
  const retrySave = useProjectsStore((s) => s.retrySave);
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const [retrying, setRetrying] = useState(false);

  const onRetry = async () => {
    if (!failedId) return;
    setRetrying(true);
    try {
      await retrySave(failedId);
    } finally {
      setRetrying(false);
    }
  };

  // Signing in again is what fixes a signed-out save: try as soon as there is a session.
  useEffect(() => {
    if (failedId && reason === "signedOut" && uid) void retrySave(failedId);
  }, [failedId, reason, uid, retrySave]);

  if (!failedId || staleId) return null;

  const note = saveFailureNote(reason, attempts, typeof navigator === "undefined" ? true : navigator.onLine);
  const stuck = reason === "tooLarge" || reason === "rejected";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        {SAVE_FAILURE_COPY[note]}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {(stuck || note === "stubborn") && (
          <Link href="/contact" target="_blank" className="font-medium underline">
            Contact us
          </Link>
        )}
        {stuck && (
          <Button size="sm" variant="secondary" onClick={() => downloadBook(failedId)}>
            Download a copy
          </Button>
        )}
        {reason === "signedOut" && !uid && (
          <Button size="sm" onClick={() => openAuthDialog("saveBook", { mode: "signin" })}>
            Sign in
          </Button>
        )}
        <Button size="sm" loading={retrying} variant={reason === "signedOut" && !uid ? "secondary" : "primary"} onClick={() => void onRetry()}>
          Try again now
        </Button>
      </span>
    </div>
  );
}

/**
 * Said once when changes the last session never saved were found on this device and put back, so a
 * reader who refreshed in the middle of a failed save sees that nothing was lost.
 */
export function RecoveredChangesNotice() {
  const notice = useProjectsStore((s) => s.recoveredNotice);
  const dismiss = useProjectsStore((s) => s.dismissRecovered);
  if (!notice) return null;
  const detail =
    notice.kind === "merged"
      ? notice.conflicts > 0
        ? ` They were merged with a newer version; where both changed the same thing, your newer change was kept (${notice.conflicts}).`
        : " They were merged with a newer version of the book."
      : "";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
      <span className="flex items-center gap-2">
        <CheckCircle2 className="size-4 shrink-0" />
        <span>
          We found changes to “{notice.title}” that weren&apos;t saved last time, and put them back.{detail}
        </span>
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
