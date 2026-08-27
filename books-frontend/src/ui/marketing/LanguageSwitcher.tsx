"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Languages } from "lucide-react";
import { publishedLocales } from "../../core/i18n/publish";
import { usePathname, useRouter } from "../../i18n/navigation";
import { cn } from "../lib/cn";
import { Popover } from "../components/Popover";

/**
 * Language control for the marketing chrome.
 *
 * Three deliberate choices:
 *
 *   - **Endonyms, never flags.** A flag is a country and a language is not:
 *     one Union Jack cannot stand for `en-US`, and Austrian and German readers
 *     share `/de/`. Every entry reads in its own language, so someone who
 *     landed on the wrong one can still recognise theirs.
 *   - **Stays on the page.** Switching swaps only the locale segment of the
 *     current path, rather than sending everyone to the homepage — a reader
 *     three paragraphs into an article wants that article, in their language.
 *   - **Only published locales.** The list comes from the publish gate, so a
 *     language in the manifest but not yet live is not offered. Offering it
 *     would advertise a 404.
 *
 * Renders nothing at all while a single locale is published: a dropdown whose
 * only option is the current one is furniture, not a choice.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locales = publishedLocales();
  const active = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const t = useTranslations("nav");

  if (locales.length < 2) return null;

  const current = locales.find((l) => l.id === active) ?? locales[0];

  const select = (id: string) => {
    // `pathname` is already locale-stripped by the navigation helpers, so this
    // re-renders the same route under the new prefix. The middleware records the
    // choice in a cookie on the way through, which is what makes it stick on the
    // reader's next visit.
    startTransition(() => router.replace(pathname, { locale: id }));
  };

  return (
    <Popover
      align="end"
      panelClassName="w-44 overflow-hidden p-0"
      trigger={(open) => (
        <button
          type="button"
          aria-label={t("language")}
          aria-expanded={open}
          data-pending={pending || undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100/70 hover:text-ink-900",
            pending && "opacity-60",
            className,
          )}
        >
          <Languages className="size-4" />
          {/* The code, not the endonym: "Deutsch" next to a nav full of links
              is wide enough to push the layout around on small screens. */}
          <span className="uppercase">{current.id}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="py-1">
          {locales.map((locale) => {
            const isActive = locale.id === active;
            return (
              <button
                key={locale.id}
                type="button"
                lang={locale.id}
                aria-current={isActive || undefined}
                onClick={() => {
                  close();
                  if (!isActive) select(locale.id);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-ink-100/70",
                  isActive ? "font-semibold text-ink-900" : "text-ink-700",
                )}
              >
                {locale.endonym}
                {isActive && <Check className="size-4 text-brand-600" />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
