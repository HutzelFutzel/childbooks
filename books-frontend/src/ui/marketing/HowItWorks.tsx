import { BookOpen, PenLine, Sparkles } from "lucide-react";
import { EditableImage } from "./EditableImage";
import { EditableText } from "./EditableText";
import { Reveal } from "./Reveal";
import type { SiteImageSlot } from "@/core/config/siteImages";
import type { SiteImagesMap, SiteTextMap } from "./content";

const STEPS = [
  {
    icon: PenLine,
    step: "Step 1",
    slot: "how.step1" as SiteImageSlot,
    titleSlot: "how.step1.title" as const,
    bodySlot: "how.step1.body" as const,
    title: "Write your story",
    body: "Paste or write your tale. We analyze it into characters, places, and a page-by-page screenplay you can fine-tune.",
    art: "Spot illustration — writing",
  },
  {
    icon: Sparkles,
    step: "Step 2",
    slot: "how.step2" as SiteImageSlot,
    titleSlot: "how.step2.title" as const,
    bodySlot: "how.step2.body" as const,
    title: "Illustrate with AI",
    body: "Design your references once. Every page reuses them, so your cast stays visually consistent from cover to cover.",
    art: "Spot illustration — illustrating",
  },
  {
    icon: BookOpen,
    step: "Step 3",
    slot: "how.step3" as SiteImageSlot,
    titleSlot: "how.step3.title" as const,
    bodySlot: "how.step3.body" as const,
    title: "Print & share",
    body: "Lay out text and art, then order a full-bleed, print-ready book — or get it instantly as a digital edition.",
    art: "Spot illustration — printing",
  },
];

/** Three-step explainer with alternating illustration rows. */
export function HowItWorks({ images, text }: { images: SiteImagesMap; text: SiteTextMap }) {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-20 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <EditableText
            slotId="how.heading"
            as="h2"
            multiline
            defaultValue="From blank page to bookshelf in three steps"
            serverValue={text["how.heading"]}
            className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl"
          />
          <EditableText
            slotId="how.subhead"
            as="p"
            multiline
            defaultValue="A guided flow takes you from an idea to a finished, printable book — no design skills required."
            serverValue={text["how.subhead"]}
            className="mt-4 text-lg text-ink-600"
          />
        </Reveal>

        <div className="mt-16 space-y-16">
          {STEPS.map(({ icon: Icon, step, slot, titleSlot, bodySlot, title, body, art }, i) => (
            <Reveal key={title} delay={i * 0.05}>
              <div className="grid items-center gap-8 lg:grid-cols-2">
                <div className={i % 2 === 1 ? "lg:order-2" : undefined}>
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-600">
                    <Icon className="size-3.5" />
                    {step}
                  </span>
                  <EditableText
                    slotId={titleSlot}
                    as="h3"
                    defaultValue={title}
                    serverValue={text[titleSlot]}
                    className="mt-4 font-display text-2xl font-bold text-ink-900"
                  />
                  <EditableText
                    slotId={bodySlot}
                    as="p"
                    multiline
                    defaultValue={body}
                    serverValue={text[bodySlot]}
                    className="mt-3 text-base text-ink-600"
                  />
                </div>
                <EditableImage
                  slotId={slot}
                  label={art}
                  ratio="16/10"
                  hint="1600×1000"
                  className={i % 2 === 1 ? "lg:order-1" : undefined}
                  serverUrl={images[slot]?.imageUrl}
                  alt={images[slot]?.alt}
                  sizes="(max-width: 1024px) 100vw, 500px"
                />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
