"use client";

/**
 * Why the last thing the reader asked for didn't happen. The store keeps one
 * `error` for every chat action (a confirm, a button skill, a typed turn, a
 * start); it shows here, once, above whatever card is open, until the next
 * action clears it or the reader dismisses it.
 */
import { AlertCircle, X } from "lucide-react";
import { useChatStudio } from "../../../state/chatStudio";

export function ChatErrorLine() {
  const error = useChatStudio((s) => s.error);
  const clear = useChatStudio((s) => s.clearError);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex w-full items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm leading-snug text-red-800 ring-1 ring-inset ring-red-200/80"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{error}</p>
      <button
        type="button"
        onClick={clear}
        aria-label="Dismiss"
        className="-m-1 shrink-0 rounded-full p-1 text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
