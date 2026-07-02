import { Users, Palette, FileDown, Share2, Zap, Coins } from "lucide-react";
import { EditableText } from "./EditableText";
import { Reveal } from "./Reveal";
import type { SiteTextSlot } from "@/core/config/siteContent";
import type { SiteTextMap } from "./content";

const FEATURES = [
  {
    icon: Users,
    titleSlot: "features.0.title" as SiteTextSlot,
    bodySlot: "features.0.body" as SiteTextSlot,
    title: "Consistent characters",
    body: "Design a character or place once and it stays on-model across every page — same face, outfit, and style.",
  },
  {
    icon: Palette,
    titleSlot: "features.1.title" as SiteTextSlot,
    bodySlot: "features.1.body" as SiteTextSlot,
    title: "Per-page AI art",
    body: "Each page is illustrated to match your story beat, in an art style you choose and can refine.",
  },
  {
    icon: FileDown,
    titleSlot: "features.2.title" as SiteTextSlot,
    bodySlot: "features.2.body" as SiteTextSlot,
    title: "Print-ready export",
    body: "We compose full-bleed, correctly-sized pages and hand off a print-ready book for real fulfillment.",
  },
  {
    icon: Share2,
    titleSlot: "features.3.title" as SiteTextSlot,
    bodySlot: "features.3.body" as SiteTextSlot,
    title: "Shareable book pages",
    body: "Publish a public preview link so grandparents and friends can flip through the book online.",
  },
  {
    icon: Zap,
    titleSlot: "features.4.title" as SiteTextSlot,
    bodySlot: "features.4.body" as SiteTextSlot,
    title: "Guest-first, zero setup",
    body: "Start creating immediately — no sign-up wall. Save and print whenever you're ready.",
  },
  {
    icon: Coins,
    titleSlot: "features.5.title" as SiteTextSlot,
    bodySlot: "features.5.body" as SiteTextSlot,
    title: "Sparks that roll over",
    body: "Paid plans include a monthly bundle of generation credits that carry over, plus cheaper prints.",
  },
];

/** Feature grid highlighting the real differentiators. */
export function Features({ text }: { text: SiteTextMap }) {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <EditableText
            slotId="features.heading"
            as="h2"
            multiline
            defaultValue="Everything you need to make a real book"
            serverValue={text["features.heading"]}
            className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl"
          />
          <EditableText
            slotId="features.subhead"
            as="p"
            multiline
            defaultValue="Powerful tools under a simple, playful surface — so the story stays the star."
            serverValue={text["features.subhead"]}
            className="mt-4 text-lg text-ink-600"
          />
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, titleSlot, bodySlot, title, body }, i) => (
            <Reveal key={title} delay={(i % 3) * 0.05}>
              <div className="h-full rounded-2xl border border-ink-200 bg-canvas p-6 shadow-soft transition hover:shadow-lifted">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon className="size-5.5" />
                </span>
                <EditableText
                  slotId={titleSlot}
                  as="h3"
                  defaultValue={title}
                  serverValue={text[titleSlot]}
                  className="mt-4 text-lg font-bold text-ink-900"
                />
                <EditableText
                  slotId={bodySlot}
                  as="p"
                  multiline
                  defaultValue={body}
                  serverValue={text[bodySlot]}
                  className="mt-2 text-sm leading-relaxed text-ink-600"
                />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
