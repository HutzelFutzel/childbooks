import Link from "next/link";
import type { PublishedBook } from "../../../core/share/types";
import type { BrandingWatermark } from "../../../core/config/branding";

/**
 * Server-rendered public preview of a published book. Pure HTML/CSS (no client
 * JS) so it's fast and fully crawlable. Page images are public Storage URLs.
 *
 * When a {@link BrandingWatermark} is supplied (and the book hasn't opted out),
 * it's overlaid centered on every page image.
 */
export function BookPreviewView({
  book,
  watermark,
}: {
  book: PublishedBook;
  watermark?: BrandingWatermark | null;
}) {
  const cover = book.pages.find((p) => p.id === "cover-front");
  const interior = book.pages.filter((p) => p.id !== "cover-front");

  const Watermark = watermark
    ? () => (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            width: `${Math.round(watermark.scale * 100)}%`,
            opacity: watermark.opacity,
            backgroundImage: `url(${watermark.imageUrl})`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            aspectRatio: "1 / 1",
          }}
        />
      )
    : null;

  return (
    <main className="min-h-screen bg-grid">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3">
          <Link href="/" className="text-sm font-bold text-ink-900">
            Childbook Studio
          </Link>
          <Link
            href="/studio"
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700"
          >
            Make your own
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-5 pb-8 pt-12 text-center">
        {cover && (
          <div className="relative mx-auto mb-8 w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-lifted ring-1 ring-ink-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover.url}
              alt={`Cover of ${book.title}`}
              className="block w-full"
              style={{ aspectRatio: cover.aspect }}
            />
            {Watermark && <Watermark />}
          </div>
        )}
        <h1 className="text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
          {book.title}
        </h1>
        {book.summary && (
          <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-600">{book.summary}</p>
        )}
        <p className="mt-3 text-sm text-ink-400">
          {book.pageCount} page{book.pageCount === 1 ? "" : "s"} · made with Childbook Studio
        </p>
      </section>

      <section className="mx-auto flex max-w-4xl flex-col items-center gap-8 px-5 pb-20">
        {interior.map((page) => (
          <figure
            key={page.id}
            className="relative w-full overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-ink-100"
            style={{ maxWidth: page.aspect >= 1.6 ? "100%" : "32rem" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={page.url}
              alt={`${page.label} of ${book.title}`}
              className="block w-full"
              style={{ aspectRatio: page.aspect }}
            />
            {Watermark && <Watermark />}
          </figure>
        ))}
      </section>

      <section className="border-t border-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-5 py-16 text-center">
          <h2 className="text-2xl font-bold text-ink-900">Want a book like this?</h2>
          <p className="max-w-xl text-ink-600">
            Write your own story and let Childbook Studio illustrate every page with consistent
            characters — then order it in print.
          </p>
          <Link
            href="/studio"
            className="mt-2 rounded-2xl bg-brand-600 px-8 py-3.5 text-base font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700"
          >
            Start your book
          </Link>
        </div>
      </section>
    </main>
  );
}
