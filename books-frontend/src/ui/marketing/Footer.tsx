import Link from "next/link";
import { Sparkles } from "lucide-react";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "#how-it-works", label: "How it works" },
      { href: "#features", label: "Features" },
      { href: "#pricing", label: "Pricing" },
      { href: "/studio", label: "Open the Studio" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "#faq", label: "FAQ" },
      { href: "/studio", label: "Sign in" },
    ],
  },
];

/** Site footer with brand + navigation columns. */
export function Footer({ siteName, logoUrl }: { siteName: string; logoUrl?: string | null }) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-ink-100 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2 font-bold text-ink-900" aria-label={siteName}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={siteName} className="h-8 w-auto" />
            ) : (
              <>
                <span className="flex size-8 items-center justify-center rounded-xl bg-brand-600 text-white shadow-soft">
                  <Sparkles className="size-4.5" />
                </span>
                {siteName}
              </>
            )}
          </Link>
          <p className="mt-4 max-w-xs text-sm text-ink-500">
            Write, illustrate, and print custom children's picture books with AI.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">{col.title}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-sm text-ink-600 transition-colors hover:text-ink-900">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-ink-100">
        <div className="mx-auto max-w-6xl px-6 py-6 text-sm text-ink-400">
          © {year} {siteName}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
