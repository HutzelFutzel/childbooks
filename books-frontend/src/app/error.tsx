"use client";

/**
 * The page crashed while rendering. Without this, React unmounts the whole tree
 * and the person is left on a blank screen with no idea whether their book is
 * still there. Say what happened, record it, and offer the two ways out.
 */
import Link from "next/link";
import { useEffect } from "react";
import { clientLog } from "../platform/clientLogger";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    clientLog.error({
      domain: "system",
      event: "ui.render_crash",
      message: error.message || "A page failed to render",
      error,
    });
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center" role="alert">
      <h1 className="font-display text-xl font-semibold text-ink-900">Something went wrong on this page.</h1>
      <p className="max-w-md text-sm leading-relaxed text-ink-600">
        Your books are stored safely. Anything you changed in the last few seconds may need to be done again. Try
        reloading this page; if it keeps happening, go back to your library.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-full bg-brand-500 px-5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-600"
        >
          Try again
        </button>
        <Link
          href="/studio"
          className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-medium text-ink-700 ring-1 ring-ink-200 transition hover:ring-ink-400"
        >
          Back to my library
        </Link>
      </div>
    </main>
  );
}
