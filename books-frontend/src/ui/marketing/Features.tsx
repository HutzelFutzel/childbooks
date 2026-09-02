import { SlidersHorizontal, BookOpen, BookCheck } from "lucide-react";
import { EditableText } from "./EditableText";
import { Reveal } from "./Reveal";
import type { SiteTextSlot } from "@/core/config/siteContent";
import type { SiteTextMap } from "./content";

/**
 * Three clean, minimal pillars that highlight customization, formats, and print options.
 */
export function Features({ text }: { text: SiteTextMap }) {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <EditableText
            slotId="features.heading"
            as="h2"
            multiline
            defaultValue="Why parents & kids love our books"
            serverValue={text["features.heading"]}
            className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl"
          />
          <EditableText
            slotId="features.subhead"
            as="p"
            multiline
            defaultValue="Crafted with love, built for bedtime, and printed to last generations."
            serverValue={text["features.subhead"]}
            className="mt-4 text-lg text-ink-600"
          />
        </Reveal>

        {/* 3 clean, minimal feature pillars */}
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {/* Pillar 1: 100% Customizable */}
          <Reveal delay={0}>
            <div className="flex h-full flex-col rounded-3xl border border-ink-200/80 bg-canvas p-8 transition-all duration-200 hover:border-ink-300 hover:shadow-soft sm:p-9">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-100/70 text-brand-700">
                <SlidersHorizontal className="size-5.5" />
              </div>
              <EditableText
                slotId={"features.0.title" as SiteTextSlot}
                as="h3"
                defaultValue="100% customizable stories"
                serverValue={text["features.0.title"]}
                className="mt-6 font-display text-xl font-bold text-ink-900"
              />
              <EditableText
                slotId={"features.0.body" as SiteTextSlot}
                as="p"
                multiline
                defaultValue="Every page is fully yours to shape. Personalize names, choose your art style, and fine-tune every sentence and illustration until it feels just right."
                serverValue={text["features.0.body"]}
                className="mt-3 text-sm leading-relaxed text-ink-600 sm:text-base"
              />
            </div>
          </Reveal>

          {/* Pillar 2: Digital & Print */}
          <Reveal delay={0.08}>
            <div className="flex h-full flex-col rounded-3xl border border-ink-200/80 bg-canvas p-8 transition-all duration-200 hover:border-ink-300 hover:shadow-soft sm:p-9">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-100/70 text-brand-700">
                <BookOpen className="size-5.5" />
              </div>
              <EditableText
                slotId={"features.1.title" as SiteTextSlot}
                as="h3"
                defaultValue="Digital, print, or both"
                serverValue={text["features.1.title"]}
                className="mt-6 font-display text-xl font-bold text-ink-900"
              />
              <EditableText
                slotId={"features.1.body" as SiteTextSlot}
                as="p"
                multiline
                defaultValue="Read together on your tablet or smartphone right away, order a real physical book delivered to your home, or enjoy both seamlessly."
                serverValue={text["features.1.body"]}
                className="mt-3 text-sm leading-relaxed text-ink-600 sm:text-base"
              />
            </div>
          </Reveal>

          {/* Pillar 3: Softcover or Hardcover */}
          <Reveal delay={0.16}>
            <div className="flex h-full flex-col rounded-3xl border border-ink-200/80 bg-canvas p-8 transition-all duration-200 hover:border-ink-300 hover:shadow-soft sm:p-9">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-100/70 text-brand-700">
                <BookCheck className="size-5.5" />
              </div>
              <EditableText
                slotId={"features.2.title" as SiteTextSlot}
                as="h3"
                defaultValue="Softcover or heirloom hardcover"
                serverValue={text["features.2.title"]}
                className="mt-6 font-display text-xl font-bold text-ink-900"
              />
              <EditableText
                slotId={"features.2.body" as SiteTextSlot}
                as="p"
                multiline
                defaultValue="Select the perfect format for your family: a durable, flexible softcover for everyday reading, or a sturdy library-grade hardcover keepsake."
                serverValue={text["features.2.body"]}
                className="mt-3 text-sm leading-relaxed text-ink-600 sm:text-base"
              />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
