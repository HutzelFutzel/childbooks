import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EditableText } from "./EditableText";
import { Reveal } from "./Reveal";
import type { SiteTextMap } from "./content";

/** Full-width closing call-to-action on a brand gradient. */
export function CtaBand({ text }: { text: SiteTextMap }) {
  return (
    <section className="px-6 py-20 lg:py-28">
      <Reveal className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-3xl bg-linear-to-br from-brand-600 to-brand-800 px-8 py-16 text-center shadow-lifted">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-white/10 blur-2xl"
          />
          <EditableText
            slotId="cta.heading"
            as="h2"
            multiline
            defaultValue="Ready to make your first book?"
            serverValue={text["cta.heading"]}
            className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl"
          />
          <EditableText
            slotId="cta.subhead"
            as="p"
            multiline
            defaultValue="Start writing and illustrating in seconds. No account, no credit card."
            serverValue={text["cta.subhead"]}
            className="mx-auto mt-4 max-w-xl text-lg text-brand-100"
          />
          <Link
            href="/studio"
            className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-3.5 text-base font-semibold text-brand-700 shadow-soft transition hover:bg-brand-50"
          >
            <EditableText slotId="cta.button" as="span" defaultValue="Open the Studio" serverValue={text["cta.button"]} />
            <ArrowRight className="size-4.5" />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
