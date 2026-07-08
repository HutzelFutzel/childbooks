import Link from "next/link";

export default function BookNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-grid px-6 text-center">
      <h1 className="text-3xl font-extrabold text-ink-900">Book not found</h1>
      <p className="max-w-md text-ink-600">
        This preview link may have expired or been unpublished.
      </p>
      <Link
        href="/studio"
        className="mt-2 rounded-2xl bg-brand-600 px-7 py-3 text-base font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700"
      >
        Make your own book
      </Link>
    </main>
  );
}
