import Link from "next/link";

/**
 * Marketing landing page — server-rendered for SEO. The interactive editor
 * lives at /studio (client-only). Public/shareable pages like this one are the
 * reason the app is on Next.js + App Hosting rather than a plain SPA.
 */
export default function Home() {
  return (
    <main className="min-h-screen bg-grid">
      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center">
        <span className="rounded-full bg-brand-100 px-4 py-1 text-sm font-semibold text-brand-700">
          Childbook Studio
        </span>
        <h1 className="mt-6 max-w-3xl text-5xl font-extrabold tracking-tight text-ink-900 sm:text-6xl">
          Turn a story into a printed picture book.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-ink-600">
          Write your tale, design recurring characters and places, and let AI
          illustrate every page with a consistent look — then export a
          print-ready book.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <Link
            href="/studio"
            className="rounded-2xl bg-brand-600 px-8 py-3.5 text-base font-semibold text-white shadow-soft transition hover:bg-brand-700"
          >
            Open the Studio
          </Link>
          <a
            href="#how-it-works"
            className="rounded-2xl border border-ink-200 bg-white px-8 py-3.5 text-base font-semibold text-ink-700 transition hover:border-ink-300"
          >
            How it works
          </a>
        </div>

        <section
          id="how-it-works"
          className="mt-24 grid w-full gap-6 text-left sm:grid-cols-3"
        >
          {[
            {
              title: "1. Write",
              body: "Paste or write your story. We analyze it into characters, places, and a page-by-page screenplay.",
            },
            {
              title: "2. Illustrate",
              body: "Design references once; every page reuses them so your cast stays visually consistent.",
            },
            {
              title: "3. Print",
              body: "Lay out text and art, then export a full-bleed, print-ready PDF for fulfillment.",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft"
            >
              <h2 className="text-lg font-bold text-ink-900">{card.title}</h2>
              <p className="mt-2 text-sm text-ink-600">{card.body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
